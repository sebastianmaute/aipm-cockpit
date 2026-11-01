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
import { useCrossProjectPeople, type CrossProjectDeps } from "./use-cross-project-people";

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
  const load = vi.fn(async (_c: TursoConfig, id: string) => ws([res(10, "Ann", "Lee", { email: id === "p-b" ? "" : "" })]));
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
});
