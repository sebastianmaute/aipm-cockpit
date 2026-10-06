// Pins useTursoProjectList (use-turso-project-list.ts, §491): the Turso
// portfolio's active and archived project lists, the load-once flag,
// `refreshTursoProjects`, and the effect that runs it once settings hydrate.
// The DB reads and the config resolver are mocked.
//
// ★★ `tursoListLoaded` flips only on SUCCESS: task-manager's empty-state and
// list-loading gates read it, so a failed fetch must not mark the list loaded.
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTursoProjectList, type TursoProjectListDeps } from "./use-turso-project-list";
import type { ProjectListEntry } from "./turso-tenant-schema";
import type { ProjectMeta } from "./types";

vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn(),
  listArchivedProjects: vi.fn(),
}));
vi.mock("./turso-config", () => ({
  getTursoConfig: vi.fn(),
}));

import { listProjects, listArchivedProjects } from "./turso-portfolio";
import { getTursoConfig } from "./turso-config";

const CFG = { httpUrl: "https://db.example", authToken: "tok" };
const entry = (id: string, archived = false): ProjectListEntry => ({ id, meta: { name: id } as ProjectMeta, archived });
const ACTIVE = [entry("p-1"), entry("p-2")];
const ARCHIVED = [entry("p-9", true)];

function makeDeps(over: Partial<TursoProjectListDeps> = {}): TursoProjectListDeps {
  return {
    portfolioMode: "turso",
    hydrated: true,
    tursoDatabaseUrl: "libsql://db.example",
    tursoAuthToken: "tok",
    reportStorageOutcome: vi.fn(),
    ...over,
  };
}

function mount(over: Partial<TursoProjectListDeps> = {}) {
  let current = makeDeps(over);
  const view = renderHook((d: TursoProjectListDeps) => useTursoProjectList(d), { initialProps: current });
  const rerender = (next: Partial<TursoProjectListDeps>) => {
    current = { ...current, ...next };
    view.rerender(current);
  };
  return { ...view, deps: () => current, rerender };
}

beforeEach(() => {
  vi.mocked(getTursoConfig).mockReset().mockReturnValue(CFG as ReturnType<typeof getTursoConfig>);
  vi.mocked(listProjects).mockReset().mockResolvedValue(ACTIVE);
  vi.mocked(listArchivedProjects).mockReset().mockResolvedValue(ARCHIVED);
});

describe("useTursoProjectList — first load", () => {
  it("loads both lists once hydrated in Turso mode, marks them loaded and reports success", async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.tursoListLoaded).toBe(true));
    expect(h.result.current.tursoProjects).toEqual(ACTIVE);
    expect(h.result.current.tursoArchived).toEqual(ARCHIVED);
    expect(listProjects).toHaveBeenCalledWith(CFG);
    expect(listArchivedProjects).toHaveBeenCalledWith(CFG);
    expect(getTursoConfig).toHaveBeenCalledWith("libsql://db.example", "tok");
    expect(h.deps().reportStorageOutcome).toHaveBeenCalledWith(null);
  });

  it("starts empty and unloaded, and does not fetch before hydration", async () => {
    const h = mount({ hydrated: false });
    expect(h.result.current).toMatchObject({ tursoProjects: [], tursoArchived: [], tursoListLoaded: false });
    await act(async () => {});
    expect(listProjects).not.toHaveBeenCalled();

    h.rerender({ hydrated: true });
    await waitFor(() => expect(h.result.current.tursoListLoaded).toBe(true));
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("never fetches in file mode, from the effect or from a direct refresh", async () => {
    const h = mount({ portfolioMode: "file" });
    await act(async () => {});
    let got: ProjectListEntry[] | null | undefined;
    await act(async () => { got = await h.result.current.refreshTursoProjects(); });
    expect(got).toBeNull();
    expect(getTursoConfig).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
    expect(h.result.current.tursoListLoaded).toBe(false);
  });

  it("returns null without fetching when no Turso config resolves", async () => {
    vi.mocked(getTursoConfig).mockReturnValue(null);
    const h = mount();
    let got: ProjectListEntry[] | null | undefined;
    await act(async () => { got = await h.result.current.refreshTursoProjects(); });
    expect(got).toBeNull();
    expect(listProjects).not.toHaveBeenCalled();
    expect(h.result.current.tursoListLoaded).toBe(false);
    expect(h.deps().reportStorageOutcome).not.toHaveBeenCalled();
  });
});

describe("useTursoProjectList — refresh", () => {
  it("returns the fetched ACTIVE list so callers can reuse it", async () => {
    const h = mount({ hydrated: false });
    let got: ProjectListEntry[] | null | undefined;
    await act(async () => { got = await h.result.current.refreshTursoProjects(); });
    expect(got).toEqual(ACTIVE);
  });

  it("a failed fetch reports the error, returns null and leaves the list UNLOADED", async () => {
    const err = new Error("unreachable");
    vi.mocked(listProjects).mockRejectedValue(err);
    const h = mount({ hydrated: false });
    let got: ProjectListEntry[] | null | undefined;
    await act(async () => { got = await h.result.current.refreshTursoProjects(); });
    expect(got).toBeNull();
    expect(h.deps().reportStorageOutcome).toHaveBeenCalledWith(err);
    expect(h.deps().reportStorageOutcome).not.toHaveBeenCalledWith(null);
    expect(h.result.current.tursoListLoaded).toBe(false);
    expect(h.result.current.tursoProjects).toEqual([]);
  });

  it("a failure after a successful load keeps the loaded lists", async () => {
    const h = mount();
    await waitFor(() => expect(h.result.current.tursoListLoaded).toBe(true));
    vi.mocked(listProjects).mockRejectedValue(new Error("blip"));
    await act(async () => { await h.result.current.refreshTursoProjects(); });
    expect(h.result.current.tursoListLoaded).toBe(true);
    expect(h.result.current.tursoProjects).toEqual(ACTIVE);
  });
});

describe("useTursoProjectList — refreshTursoProjects identity", () => {
  it("keeps one identity across a rerender with the same deps", async () => {
    const h = mount({ hydrated: false });
    const first = h.result.current.refreshTursoProjects;
    h.rerender({});
    expect(h.result.current.refreshTursoProjects).toBe(first);
  });

  // ★ One test per dependency, each changing only that one value: a dropped
  // dep would leave a stale closure reading the old value.
  it.each([
    ["tursoDatabaseUrl", { tursoDatabaseUrl: "libsql://other.example" }, ["libsql://other.example", "tok"]],
    ["tursoAuthToken", { tursoAuthToken: "tok-2" }, ["libsql://db.example", "tok-2"]],
  ] as const)("a new %s gives a new refresh that reads it", async (_name, next, args) => {
    const h = mount({ hydrated: false });
    const first = h.result.current.refreshTursoProjects;
    h.rerender(next);
    expect(h.result.current.refreshTursoProjects).not.toBe(first);
    await act(async () => { await h.result.current.refreshTursoProjects(); });
    expect(getTursoConfig).toHaveBeenLastCalledWith(...args);
  });

  it("a new reportStorageOutcome is the one a later refresh reports to", async () => {
    const h = mount({ hydrated: false });
    const second = vi.fn();
    h.rerender({ reportStorageOutcome: second });
    await act(async () => { await h.result.current.refreshTursoProjects(); });
    expect(second).toHaveBeenCalledWith(null);
  });

  it("a switch to Turso mode gives a refresh that fetches", async () => {
    const h = mount({ portfolioMode: "file", hydrated: false });
    h.rerender({ portfolioMode: "turso" });
    let got: ProjectListEntry[] | null | undefined;
    await act(async () => { got = await h.result.current.refreshTursoProjects(); });
    expect(got).toEqual(ACTIVE);
  });
});
