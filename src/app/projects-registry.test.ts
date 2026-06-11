import { afterEach, describe, it, expect, vi } from "vitest";
import { addProject, removeProject, setCurrentProject, renameProject,
  emptyRegistry, loadRegistry, saveRegistry,
  type ProjectRegistryEntry } from "./projects-registry";

const entry = (id: string): ProjectRegistryEntry =>
  ({ id, name: "P" + id, code: "C" + id, storageConfig: { kind: "local-json" } as never });

describe("projects-registry (pure)", () => {
  it("adds and selects", () => {
    const r = addProject(emptyRegistry(), entry("1"), true);
    expect(r.projects).toHaveLength(1);
    expect(r.currentProjectId).toBe("1");
  });
  it("adding without select keeps currentProjectId null", () => {
    const r = addProject(emptyRegistry(), entry("1"), false);
    expect(r.currentProjectId).toBeNull();
  });
  it("removing the current selects another or null", () => {
    let r = addProject(emptyRegistry(), entry("1"), true);
    r = addProject(r, entry("2"), false);
    r = removeProject(r, "1");
    expect(r.currentProjectId).toBe("2");
    r = removeProject(r, "2");
    expect(r.currentProjectId).toBeNull();
  });
  it("removing a non-current project leaves current intact", () => {
    let r = addProject(emptyRegistry(), entry("1"), true);
    r = addProject(r, entry("2"), false);
    r = removeProject(r, "2");
    expect(r.currentProjectId).toBe("1");
    expect(r.projects).toHaveLength(1);
  });
  it("setCurrentProject ignores unknown ids", () => {
    const r = addProject(emptyRegistry(), entry("1"), true);
    expect(setCurrentProject(r, "nope").currentProjectId).toBe("1");
  });
  it("renameProject updates name and code immutably", () => {
    const r = addProject(emptyRegistry(), entry("1"), true);
    const r2 = renameProject(r, "1", "New", "NC");
    expect(r2.projects[0].name).toBe("New");
    expect(r2.projects[0].code).toBe("NC");
    expect(r.projects[0].name).toBe("P1"); // original unchanged (immutability)
  });
  it("addProject does not mutate the input registry", () => {
    const r0 = emptyRegistry();
    addProject(r0, entry("1"), true);
    expect(r0.projects).toHaveLength(0);
  });
  it("emptyRegistry returns a fresh empty registry", () => {
    expect(emptyRegistry()).toEqual({ projects: [], currentProjectId: null });
  });
});

describe("projects-registry (IO)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("saveRegistry returns true on success and round-trips through loadRegistry", () => {
    const reg = addProject(emptyRegistry(), entry("1"), true);
    expect(saveRegistry(reg)).toBe(true);
    expect(loadRegistry()).toEqual(reg);
  });

  it("saveRegistry returns false when localStorage.setItem throws (quota / disabled)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(saveRegistry(addProject(emptyRegistry(), entry("1"), true))).toBe(false);
  });
});
