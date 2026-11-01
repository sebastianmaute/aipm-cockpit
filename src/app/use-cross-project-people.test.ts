import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Resource, ResourcePlan } from "./types";
import type { TursoConfig } from "./turso-config";
import type { Workspace } from "./workspace";
import type { PersonLinkRow } from "./cross-project/person-match";

vi.mock("./person-links-store", () => ({
  loadPersonLinks: vi.fn(async () => []),
  savePersonLink: vi.fn(async () => undefined),
  deletePersonLink: vi.fn(async () => undefined),
}));
vi.mock("./turso-backend", () => ({ TursoBackend: class {} }));

import { deletePersonLink, loadPersonLinks, savePersonLink } from "./person-links-store";
import { configKeyOf, useCrossProjectPeople, type CrossProjectDeps } from "./use-cross-project-people";

const CONFIG = { httpUrl: "https://x.turso.io", authToken: "t" } as TursoConfig;
const PLAN: ResourcePlan = { startDate: "2026-11-02", endDate: "2026-11-29", granularity: "week", currency: "EUR" };
const res = (id: number, firstName: string, lastName: string, extra: Partial<Resource> = {}): Resource =>
  ({ id, firstName, lastName, ...extra }) as Resource;
const ws = (resources: Resource[]): Workspace => ({ resources, absences: [], tasks: [], plan: PLAN }) as unknown as Workspace;

const PROJECTS = [
  { id: "p-here", name: "Here" },
  { id: "p-b", name: "B" },
  { id: "p-c", name: "C" },
];
const HERE_RES = [res(1, "Ann", "Lee")];

function setup(over: Partial<CrossProjectDeps> = {}) {
  const load = vi.fn(async () => ws([res(10, "Ann", "Lee")]));
  const deps: CrossProjectDeps = {
    tursoConfig: CONFIG, portfolioMode: "turso", projects: PROJECTS, currentProjectId: "p-here",
    resources: HERE_RES, plan: PLAN, workdayHours: 8, holidaySet: new Set(), loadPending: false,
    getScopeEpoch: () => 0, load, ...over,
  };
  return { load, deps, hook: renderHook((p: CrossProjectDeps) => useCrossProjectPeople(p), { initialProps: deps }) };
}

beforeEach(() => {
  vi.mocked(loadPersonLinks).mockReset().mockResolvedValue([]);
  vi.mocked(savePersonLink).mockReset().mockResolvedValue(undefined);
  vi.mocked(deletePersonLink).mockReset().mockResolvedValue(undefined);
});

describe("useCrossProjectPeople", () => {
  test("unavailable outside Turso portfolio mode, and request loads nothing", () => {
    const { hook, load } = setup({ portfolioMode: "file" });
    expect(hook.result.current.status).toBe("unavailable");
    act(() => hook.result.current.request());
    expect(load).not.toHaveBeenCalled();
    expect(loadPersonLinks).not.toHaveBeenCalled();
  });

  test("unavailable with a single project", () => {
    const { hook } = setup({ projects: [PROJECTS[0]] });
    expect(hook.result.current.status).toBe("unavailable");
  });

  test("does not start while loadPending", () => {
    const { hook, load } = setup({ loadPending: true });
    act(() => hook.result.current.request());
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });

  test("request loads every other project sequentially, never the open one", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const load = vi.fn(async (_c: TursoConfig, id: string) => {
      order.push(id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return ws([res(10, "Ann", "Lee")]);
    });
    const { hook } = setup({ load });
    act(() => hook.result.current.request());
    expect(hook.result.current.status).toBe("loading");
    act(() => hook.result.current.request()); // ignored while loading
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(order).toEqual(["p-b", "p-c"]);
    expect(maxActive).toBe(1);
    expect(loadPersonLinks).toHaveBeenCalledTimes(1);
  });

  test("a project that fails to load is skipped and named in failures; the rest still count", async () => {
    const load = vi.fn(async (_c: TursoConfig, id: string) => {
      if (id === "p-b") throw new Error("boom");
      return ws([res(10, "Ann", "Lee", { email: "ann@x.test" })]);
    });
    const { hook } = setup({ load, resources: [res(1, "Ann", "Lee", { email: "ann@x.test" })] });
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(hook.result.current.failures).toEqual([{ projectId: "p-b", projectName: "B" }]);
    expect(hook.result.current.matches.get(1)?.matched.map((m) => m.projectId)).toEqual(["p-c"]);
  });

  test("a project switch mid-load drops the result", async () => {
    let epoch = 0;
    const load = vi.fn(async (_c: TursoConfig, id: string) => {
      if (id === "p-c") epoch += 1;
      return ws([res(10, "Ann", "Lee", { email: "ann@x.test" })]);
    });
    const { hook } = setup({ load, getScopeEpoch: () => epoch, resources: [res(1, "Ann", "Lee", { email: "ann@x.test" })] });
    act(() => hook.result.current.request());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.status).toBe("idle"));
    expect(hook.result.current.matches.size).toBe(0);
    expect(loadPersonLinks).not.toHaveBeenCalled();
  });

  test("a result loaded for another project is not shown after the open project changes", async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    hook.rerender({ ...deps, currentProjectId: "p-b" });
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.matches.size).toBe(0);
  });

  test("every request reloads", async () => {
    const { hook, load } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    act(() => hook.result.current.request());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(4));
  });

  async function ready() {
    const s = setup();
    act(() => s.hook.result.current.request());
    await waitFor(() => expect(s.hook.result.current.status).toBe("ready"));
    return s;
  }

  test("confirm writes a same row and the suggestion becomes a confirmed match without reloading projects", async () => {
    const { hook, load } = await ready();
    const rel = { projectId: "p-b", projectName: "B", resourceId: 10 };
    expect(hook.result.current.matches.get(1)?.suggestions).toHaveLength(2);
    await act(async () => hook.result.current.confirm(1, rel));
    const row = vi.mocked(savePersonLink).mock.calls[0][1] as PersonLinkRow;
    expect(row).toMatchObject({
      projectA: "p-here", resourceA: 1, projectB: "p-b", resourceB: 10, verdict: "same",
      firstA: "Ann", lastA: "Lee", firstB: "Ann", lastB: "Lee", decidedBy: "",
    });
    expect(Number.isNaN(Date.parse(row.decidedAt))).toBe(false);
    expect(hook.result.current.matches.get(1)?.matched).toEqual([{ ...rel, via: "confirmed" }]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("reject writes a different row", async () => {
    const { hook } = await ready();
    const rel = { projectId: "p-b", projectName: "B", resourceId: 10 };
    await act(async () => hook.result.current.reject(1, rel));
    expect(vi.mocked(savePersonLink).mock.calls[0][1]).toMatchObject({ verdict: "different" });
    expect(hook.result.current.matches.get(1)?.rejected).toEqual([rel]);
  });

  test("undo deletes the row", async () => {
    const { hook } = await ready();
    const rel = { projectId: "p-b", projectName: "B", resourceId: 10 };
    await act(async () => hook.result.current.confirm(1, rel));
    await act(async () => hook.result.current.undo(1, rel));
    expect(deletePersonLink).toHaveBeenCalledWith(CONFIG, { projectA: "p-here", resourceA: 1, projectB: "p-b", resourceB: 10 });
    expect(hook.result.current.matches.get(1)?.matched).toEqual([]);
    expect(hook.result.current.matches.get(1)?.suggestions).toHaveLength(2);
  });

  test("a failed write leaves the matches unchanged and reports it", async () => {
    const onWriteError = vi.fn();
    const s = setup({ onWriteError });
    act(() => s.hook.result.current.request());
    await waitFor(() => expect(s.hook.result.current.status).toBe("ready"));
    vi.mocked(savePersonLink).mockRejectedValueOnce(new Error("down"));
    await act(async () => s.hook.result.current.confirm(1, { projectId: "p-b", projectName: "B", resourceId: 10 }));
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.matches.get(1)?.matched).toEqual([]);
    expect(s.hook.result.current.status).toBe("ready");
  });
  test("a request after a scope change starts, and the dropped run never decides the new status", async () => {
    let epoch = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const load = vi.fn(async (_c: TursoConfig, id: string) => {
      if (first && id === "p-b") { first = false; await gate; }
      return ws([res(10, "Ann", "Lee")]);
    });
    const { hook } = setup({ load, getScopeEpoch: () => epoch });
    act(() => hook.result.current.request());
    epoch += 1;
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    await act(async () => { release(); await gate; });
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.matches.get(1)?.suggestions).toHaveLength(2);
  });

  test("a dropped older run finishing first never clears the newer run's loading state", async () => {
    let epoch = 0;
    const releases: (() => void)[] = [];
    const load = vi.fn(async (_c: TursoConfig, id: string) => {
      if (id === "p-b") await new Promise<void>((r) => { releases.push(r); });
      return ws([res(10, "Ann", "Lee")]);
    });
    const { hook } = setup({ load, getScopeEpoch: () => epoch });
    act(() => hook.result.current.request());
    await waitFor(() => expect(releases).toHaveLength(1));
    epoch += 1;
    act(() => hook.result.current.request());
    await waitFor(() => expect(releases).toHaveLength(2));
    // Run 1 resolves into a changed scope and is dropped; run 2 is still in flight.
    await act(async () => { releases[0](); await Promise.resolve(); });
    expect(hook.result.current.status).toBe("loading");
    await act(async () => { releases[1](); });
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  });

  test("confirm whose write straddles a scope change leaves the in-memory links alone", async () => {
    let epoch = 0;
    const s = setup({ getScopeEpoch: () => epoch });
    act(() => s.hook.result.current.request());
    await waitFor(() => expect(s.hook.result.current.status).toBe("ready"));
    vi.mocked(savePersonLink).mockImplementationOnce(async () => { epoch += 1; });
    await act(async () => s.hook.result.current.confirm(1, { projectId: "p-b", projectName: "B", resourceId: 10 }));
    expect(savePersonLink).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.matches.get(1)?.matched).toEqual([]);
  });

  test.each([
    ["portfolio mode off", { portfolioMode: "file" as const }],
    ["a different Turso config", { tursoConfig: { httpUrl: "https://other.turso.io", authToken: "t" } as TursoConfig }],
  ])("a loaded result is hidden after %s, and confirm writes nothing", async (_n, change) => {
    const { hook, deps } = await ready();
    hook.rerender({ ...deps, ...change });
    expect(hook.result.current.matches.size).toBe(0);
    expect(hook.result.current.elsewhere(1)).toEqual([]);
    await act(async () => hook.result.current.confirm(1, { projectId: "p-b", projectName: "B", resourceId: 10 }));
    await act(async () => hook.result.current.undo(1, { projectId: "p-b", projectName: "B", resourceId: 10 }));
    expect(savePersonLink).not.toHaveBeenCalled();
    expect(deletePersonLink).not.toHaveBeenCalled();
  });
});

// §785 — Resources → Planning is memo()'d: its `crossProject` prop must keep one identity while nothing it shows changed.
describe("useCrossProjectPeople — stable result (§785)", () => {
  test("a re-render with unchanged inputs returns the same object, writers included", async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const first = hook.result.current;
    hook.rerender({ ...deps }); // fresh deps object, same values
    expect(hook.result.current).toBe(first);
    expect(hook.result.current.confirm).toBe(first.confirm);
  });

  test("a stable writer still acts on the LATEST render's scope", async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const confirm = hook.result.current.confirm;
    const renamed = [res(1, "Ann", "Lee", { email: "ann@x.io" })];
    hook.rerender({ ...deps, resources: renamed });
    const rel = hook.result.current.matches.get(1)!.suggestions[0];
    await act(async () => { await confirm(1, rel); });
    expect(savePersonLink).toHaveBeenCalledWith(CONFIG, expect.objectContaining({ emailsA: "ann@x.io" }));
  });

  test("a status change gives a new object", async () => {
    const { hook } = setup();
    const idle = hook.result.current;
    act(() => hook.result.current.request());
    expect(hook.result.current).not.toBe(idle);
  });
});

describe("useCrossProjectPeople — loadFailed (§785)", () => {
  test("a failed person_links load sets loadFailed, and the next request clears it", async () => {
    vi.mocked(loadPersonLinks).mockRejectedValueOnce(new Error("down"));
    const { hook } = setup();
    expect(hook.result.current.loadFailed).toBe(false);
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.loadFailed).toBe(true));
    expect(hook.result.current.status).toBe("idle");
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(hook.result.current.loadFailed).toBe(false);
  });
});

describe("useCrossProjectPeople — nameOf (§785)", () => {
  test("names the person in another project from the loaded data, empty when unknown or not loaded", async () => {
    const { hook } = setup();
    expect(hook.result.current.nameOf("p-b", 10)).toBe("");
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(hook.result.current.nameOf("p-b", 10)).toBe("Ann Lee");
    expect(hook.result.current.nameOf("p-b", 99)).toBe("");
    expect(hook.result.current.nameOf("p-zzz", 10)).toBe("");
  });

  test("is empty after the open project changes, and keeps one identity across unrelated renders", async () => {
    const { hook, deps } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    const nameOf = hook.result.current.nameOf;
    hook.rerender({ ...deps });
    expect(hook.result.current.nameOf).toBe(nameOf);
    hook.rerender({ ...deps, currentProjectId: "p-b" });
    expect(hook.result.current.nameOf("p-c", 10)).toBe("");
  });
});

// §785 — fix round: a request made during the load hold, the single-project signal, a reload racing a write.
describe("useCrossProjectPeople — request during the load hold (§785)", () => {
  test("a request made while loadPending runs once the hold ends", async () => {
    const { hook, load, deps } = setup({ loadPending: true });
    act(() => hook.result.current.request());
    expect(load).not.toHaveBeenCalled();
    hook.rerender({ ...deps, loadPending: false });
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("nothing starts when the hold ends if nobody asked", async () => {
    const { hook, load, deps } = setup({ loadPending: true });
    hook.rerender({ ...deps, loadPending: false });
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });
});

describe("useCrossProjectPeople — singleProject (§785)", () => {
  test("true for Turso portfolio mode with one project; false when there are several or the mode is off", () => {
    expect(setup({ projects: [PROJECTS[0]] }).hook.result.current.singleProject).toBe(true);
    expect(setup().hook.result.current.singleProject).toBe(false);
    expect(setup({ portfolioMode: "file", projects: [PROJECTS[0]] }).hook.result.current.singleProject).toBe(false);
    expect(setup({ tursoConfig: null, projects: [PROJECTS[0]] }).hook.result.current.singleProject).toBe(false);
  });
});

describe("useCrossProjectPeople — a reload racing a write (§785)", () => {
  test("a confirm whose write lands while a reload is in flight survives a reload that read the links before it", async () => {
    const { hook } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    let release: (l: PersonLinkRow[]) => void = () => {};
    let finishWrite: () => void = () => {};
    vi.mocked(loadPersonLinks).mockImplementationOnce(() => new Promise<PersonLinkRow[]>((r) => { release = r; }));
    vi.mocked(savePersonLink).mockImplementationOnce(() => new Promise<void>((r) => { finishWrite = r; }));
    const rel = { projectId: "p-b", projectName: "B", resourceId: 10 };
    let confirmed: Promise<void> = Promise.resolve();
    act(() => { confirmed = hook.result.current.confirm(1, rel); }); // accepted: nothing is loading yet
    act(() => hook.result.current.request());
    await waitFor(() => expect(loadPersonLinks).toHaveBeenCalledTimes(2));
    await act(async () => { finishWrite(); await confirmed; });
    await act(async () => release([]));
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(hook.result.current.matches.get(1)?.matched).toEqual([{ ...rel, via: "confirmed" }]);
  });
});

// §785 — final minor fixes.
describe("useCrossProjectPeople — final fixes (§785)", () => {
  test("a request made while unavailable is not remembered: becoming available starts no load", async () => {
    const { hook, load, deps } = setup({ loadPending: true });
    act(() => hook.result.current.request()); // remembered during the hold
    hook.rerender({ ...deps, loadPending: false, projects: [PROJECTS[0]] }); // hold ends, but now unavailable
    hook.rerender({ ...deps, loadPending: false, projects: PROJECTS });
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
  });

  test("confirm, reject and undo write nothing while a load is running", async () => {
    const { hook } = setup();
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    let release: (l: PersonLinkRow[]) => void = () => {};
    vi.mocked(loadPersonLinks).mockImplementationOnce(() => new Promise<PersonLinkRow[]>((r) => { release = r; }));
    act(() => hook.result.current.request());
    await waitFor(() => expect(hook.result.current.status).toBe("loading"));
    const rel = { projectId: "p-b", projectName: "B", resourceId: 10 };
    await act(async () => hook.result.current.confirm(1, rel));
    await act(async () => hook.result.current.reject(1, rel));
    await act(async () => hook.result.current.undo(1, rel));
    expect(savePersonLink).not.toHaveBeenCalled();
    expect(deletePersonLink).not.toHaveBeenCalled();
    await act(async () => release([]));
  });

  test("the stored config key carries no copy of the token, and still tells configs apart", () => {
    const a = configKeyOf({ httpUrl: "https://x.turso.io", authToken: "secret-token-aaa" } as TursoConfig);
    const b = configKeyOf({ httpUrl: "https://x.turso.io", authToken: "secret-token-bbb" } as TursoConfig);
    expect(a).not.toContain("secret-token");
    expect(a).not.toBe(b);
    expect(a).toBe(configKeyOf({ httpUrl: "https://x.turso.io", authToken: "secret-token-aaa" } as TursoConfig));
  });
});
