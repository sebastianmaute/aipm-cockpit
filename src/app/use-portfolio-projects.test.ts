// Pins the multi-project wiring `usePortfolioProjects` owns (§491): the
// empty-state / project handlers (new / load-from-file / restore / delete with
// its survivor switch), the mode-aware project and archive lists, the key-facts snapshot
// effect's gate, the mode-aware switch, and how it wires `useTursoProjects`.
// The device stores (registry write, file handles, key-facts cache) are mocked;
// `removeProject` and `useTursoProjects` are real.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { t } from "./i18n";
import type { ProjectMeta } from "./types";
import type { ProjectListEntry } from "./turso-tenant-schema";
import type { ProjectRegistryEntry, ProjectsRegistry } from "./projects-registry";
import { usePortfolioProjects, type PortfolioProjectsDeps } from "./use-portfolio-projects";

const { saveRegistry, deleteHandle, saveKeyFactsSnapshot, removeKeyFactsSnapshot } = vi.hoisted(() => ({
  saveRegistry: vi.fn<(reg: unknown) => boolean>(),
  deleteHandle: vi.fn<(id: string) => Promise<void>>(),
  saveKeyFactsSnapshot: vi.fn(),
  removeKeyFactsSnapshot: vi.fn(),
}));
vi.mock("./projects-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./projects-registry")>()),
  saveRegistry,
}));
vi.mock("./project-file-handles", () => ({ deleteHandle }));
vi.mock("./project-key-facts-cache", () => ({
  keyFactsSnapshot: (meta: ProjectMeta, at: string) => ({ customer: meta.customer, at }),
  saveKeyFactsSnapshot,
  removeKeyFactsSnapshot,
}));

const LANG = "en-US" as const;
const META = { name: "Apollo", code: "AP", customer: "ACME" } as ProjectMeta;

function entry(id: string): ProjectRegistryEntry {
  return { id, name: id.toUpperCase(), code: id, storageConfig: { kind: "turso" } };
}
function listed(id: string, name: string): ProjectListEntry {
  return { id, meta: { ...META, name, code: id }, archived: false };
}
const REGISTRY: ProjectsRegistry = { projects: [entry("a"), entry("b")], currentProjectId: "a" };

function setup(over: Partial<PortfolioProjectsDeps> = {}) {
  const deps: PortfolioProjectsDeps = {
    portfolioMode: "file",
    lang: LANG,
    showToast: vi.fn(),
    isPopout: false,
    setActiveTab: vi.fn(),
    project: undefined,
    setProject: vi.fn(),
    portfolioCurrentId: null,
    registry: REGISTRY,
    setRegistry: vi.fn(),
    tursoProjects: [],
    tursoArchived: [],
    tursoDatabaseUrl: undefined,
    tursoAuthToken: undefined,
    tursoProjectId: null,
    switchToProject: vi.fn(async () => {}),
    createProject: vi.fn(async () => {}),
    loadProjectFromFile: vi.fn(async () => {}),
    switchToTursoProject: vi.fn(async () => {}),
    createTursoProject: vi.fn(async () => {}),
    archiveTursoProject: vi.fn(async () => {}),
    restoreTursoProject: vi.fn(async () => {}),
    hardDeleteTursoProject: vi.fn(async () => {}),
    refreshTursoProjects: vi.fn(async () => null),
    ...over,
  };
  const hook = renderHook((d: PortfolioProjectsDeps) => usePortfolioProjects(d), { initialProps: deps });
  return { ...hook, deps };
}

beforeEach(() => {
  saveRegistry.mockReset().mockReturnValue(true);
  deleteHandle.mockReset().mockResolvedValue(undefined);
  saveKeyFactsSnapshot.mockReset();
  removeKeyFactsSnapshot.mockReset();
});

describe("usePortfolioProjects — empty-state / project handlers", () => {
  it("new project navigates to the Projects view", () => {
    const { result, deps } = setup();
    act(() => result.current.handleNewProject());
    expect(deps.setActiveTab).toHaveBeenCalledWith("projects");
  });

  it("load-from-file flips the portfolio to file mode only from Turso mode", () => {
    const file = setup();
    file.result.current.handleLoadFromFileEmptyState();
    expect(file.deps.loadProjectFromFile).toHaveBeenCalledWith(undefined, undefined);
    const turso = setup({ portfolioMode: "turso" });
    turso.result.current.handleLoadFromFileEmptyState();
    expect(turso.deps.loadProjectFromFile).toHaveBeenCalledWith(undefined, { switchPortfolioToFileOnSuccess: true });
  });

  it("restore un-archives, refreshes the list, then switches — each step waiting for the last", async () => {
    const order: string[] = [];
    let finishRestore!: () => void;
    let finishRefresh!: () => void;
    const { result, deps } = setup({
      restoreTursoProject: vi.fn((id: string) => {
        order.push(`restore:${id}`);
        return new Promise<void>((r) => { finishRestore = r; });
      }),
      refreshTursoProjects: vi.fn(() => {
        order.push("refresh");
        return new Promise<null>((r) => { finishRefresh = () => r(null); });
      }),
      switchToTursoProject: vi.fn(async (id: string) => { order.push(`switch:${id}`); }),
    });
    await act(async () => { result.current.handleRestoreFromEmptyState("p9"); });
    expect(order).toEqual(["restore:p9"]);
    await act(async () => { finishRestore(); });
    expect(order).toEqual(["restore:p9", "refresh"]);
    expect(deps.switchToTursoProject).not.toHaveBeenCalled();
    await act(async () => { finishRefresh(); });
    expect(order).toEqual(["restore:p9", "refresh", "switch:p9"]);
  });

  it("deleting an unknown id changes nothing", () => {
    const { result, deps } = setup();
    act(() => result.current.handleDeleteProject("zz"));
    expect(deleteHandle).not.toHaveBeenCalled();
    expect(removeKeyFactsSnapshot).not.toHaveBeenCalled();
    expect(saveRegistry).not.toHaveBeenCalled();
    expect(deps.setRegistry).not.toHaveBeenCalled();
  });

  it("deleting a non-current project drops its handle and cache entry and persists without switching", () => {
    const { result, deps } = setup();
    act(() => result.current.handleDeleteProject("b"));
    const next = { projects: [entry("a")], currentProjectId: "a" };
    expect(deleteHandle).toHaveBeenCalledWith("b");
    expect(removeKeyFactsSnapshot).toHaveBeenCalledWith("b");
    expect(saveRegistry).toHaveBeenCalledWith(next);
    expect(deps.setRegistry).toHaveBeenCalledWith(next);
    expect(deps.switchToProject).not.toHaveBeenCalled();
  });

  it("deleting the current project persists it with no current id, then switches to the survivor", () => {
    const { result, deps } = setup();
    act(() => result.current.handleDeleteProject("a"));
    const persisted = { projects: [entry("b")], currentProjectId: null };
    expect(saveRegistry).toHaveBeenCalledWith(persisted);
    expect(deps.setRegistry).toHaveBeenCalledWith(persisted);
    expect(deps.switchToProject).toHaveBeenCalledWith("b");
  });

  it("deleting the last project persists the empty registry and switches nowhere", () => {
    const { result, deps } = setup({ registry: { projects: [entry("a")], currentProjectId: "a" } });
    act(() => result.current.handleDeleteProject("a"));
    expect(deps.setRegistry).toHaveBeenCalledWith({ projects: [], currentProjectId: null });
    expect(deps.switchToProject).not.toHaveBeenCalled();
  });

  it("a failed registry write toasts but still updates the in-memory copy", () => {
    saveRegistry.mockReturnValue(false);
    const { result, deps } = setup();
    act(() => result.current.handleDeleteProject("b"));
    expect(deps.showToast).toHaveBeenCalledWith("error", t(LANG, "projectsRegistrySaveFailed"));
    expect(deps.setRegistry).toHaveBeenCalledTimes(1);
  });
});

describe("usePortfolioProjects — mode-aware lists and switch", () => {
  it("file mode reads the registry, has no archive and no live meta", () => {
    const { result } = setup({ tursoProjects: [listed("t1", "T1")], tursoArchived: [listed("t2", "T2")] });
    expect(result.current.portfolioProjects).toBe(REGISTRY.projects);
    expect(result.current.portfolioArchived).toEqual([]);
    expect(result.current.portfolioLiveMetaById).toBeUndefined();
  });

  it("Turso mode maps the shared lists into registry entries and indexes the live meta", () => {
    const t1 = listed("t1", "Tee One");
    const t2 = listed("t2", "Tee Two");
    const { result } = setup({ portfolioMode: "turso", tursoProjects: [t1], tursoArchived: [t2] });
    expect(result.current.portfolioProjects).toEqual([
      { id: "t1", name: "Tee One", code: "t1", storageConfig: { kind: "turso" } },
    ]);
    expect(result.current.portfolioArchived).toEqual([
      { id: "t2", name: "Tee Two", code: "t2", storageConfig: { kind: "turso" } },
    ]);
    expect(result.current.portfolioLiveMetaById?.get("t1")).toBe(t1.meta);
    expect(result.current.portfolioLiveMetaById?.size).toBe(1);
  });

  it("switch routes to the active backend", () => {
    const file = setup();
    file.result.current.handleSwitchProjectByMode("b");
    expect(file.deps.switchToProject).toHaveBeenCalledWith("b");
    expect(file.deps.switchToTursoProject).not.toHaveBeenCalled();
    const turso = setup({ portfolioMode: "turso" });
    turso.result.current.handleSwitchProjectByMode("t1");
    expect(turso.deps.switchToTursoProject).toHaveBeenCalledWith("t1");
    expect(turso.deps.switchToProject).not.toHaveBeenCalled();
  });

  it("wires the file-mode create and update-meta through useTursoProjects", () => {
    const { result, deps } = setup();
    result.current.handleCreateProjectByMode(META, "csv");
    expect(deps.createProject).toHaveBeenCalledWith(META, "csv", {});
    act(() => result.current.handleUpdateCurrentProjectByMode(META));
    expect(deps.setProject).toHaveBeenCalledWith(META);
  });
});

describe("usePortfolioProjects — key-facts snapshot", () => {
  it("files the current project's snapshot under its id, again when the project or the id changes", () => {
    const { rerender, deps } = setup({ project: META, portfolioCurrentId: "a" });
    expect(saveKeyFactsSnapshot).toHaveBeenCalledTimes(1);
    expect(saveKeyFactsSnapshot).toHaveBeenCalledWith("a", expect.objectContaining({ customer: "ACME" }));
    const globex = { ...META, customer: "Globex" };
    rerender({ ...deps, project: globex });
    expect(saveKeyFactsSnapshot).toHaveBeenLastCalledWith("a", expect.objectContaining({ customer: "Globex" }));
    rerender({ ...deps, project: globex, portfolioCurrentId: "b" });
    expect(saveKeyFactsSnapshot).toHaveBeenCalledTimes(3);
    expect(saveKeyFactsSnapshot).toHaveBeenLastCalledWith("b", expect.objectContaining({ customer: "Globex" }));
  });

  it("writes nothing in a popout, without a project, or without an id", () => {
    setup({ project: META, portfolioCurrentId: "a", isPopout: true });
    setup({ project: undefined, portfolioCurrentId: "a" });
    setup({ project: META, portfolioCurrentId: null });
    expect(saveKeyFactsSnapshot).not.toHaveBeenCalled();
  });
});
