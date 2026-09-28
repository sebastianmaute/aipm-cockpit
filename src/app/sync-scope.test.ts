import { describe, expect, it } from "vitest";
import { syncScopeKey } from "./sync-scope";

// §643 — the tab-sync scope must name the DATA a window edits, not just its registry entry: two
// windows that share a scope apply and autosave each other's slices.
describe("syncScopeKey (§643)", () => {
  it("keys a Turso project by database URL and project id, and never by the token", () => {
    const a = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p1" });
    const b = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://b.turso.io", tursoProjectId: "p1" });
    const c = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p2" });
    expect(a).not.toBeNull();
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBe(syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p1" }));
  });

  it("keys a Turso database with no project id by its URL, and gives no scope without a URL", () => {
    const one = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: null });
    const two = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://b.turso.io", tursoProjectId: null });
    expect(one).not.toBeNull();
    expect(one).not.toBe(two);
    expect(syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: undefined, tursoProjectId: "p1" })).toBeNull();
  });

  it("keys a SharePoint project by its file location", () => {
    const sp = (itemPath: string, kind: "sp-json" | "sp-csv" = "sp-json") =>
      syncScopeKey({ storageConfig: { kind, hostname: "h.sharepoint.com", sitePath: "/sites/x", itemPath }, tursoDatabaseUrl: undefined, tursoProjectId: null });
    expect(sp("/a.json")).not.toBeNull();
    expect(sp("/a.json")).not.toBe(sp("/b.json"));
    expect(sp("/a.json")).not.toBe(sp("/a.json", "sp-csv"));
  });

  // Review I1/I2 on §643 — browser storage is ONE IndexedDB store and a local file is read through
  // ONE handle slot per kind (`file-handle:<kind>`) that any tab's project switch re-points. Windows
  // on the same kind write the same data whatever registry project they show, so they must share a
  // scope: split apart, each one's whole-workspace autosave silently overwrote the other's.
  it("keys browser storage and local files by kind alone", () => {
    const k = (kind: "browser" | "local-json" | "local-csv" | "local-md") =>
      syncScopeKey({ storageConfig: { kind }, tursoDatabaseUrl: undefined, tursoProjectId: null });
    const all = [k("browser"), k("local-json"), k("local-csv"), k("local-md")];
    for (const key of all) expect(key).not.toBeNull();
    expect(new Set(all).size).toBe(4);
    expect(k("local-json")).toBe(k("local-json"));
  });

  it("does not depend on the registry's current project, which every tab shares through localStorage", () => {
    window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({ currentProjectId: "p1", projects: [] }));
    try {
      const before = syncScopeKey({ storageConfig: { kind: "local-json" }, tursoDatabaseUrl: undefined, tursoProjectId: null });
      window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({ currentProjectId: "p2", projects: [] }));
      expect(syncScopeKey({ storageConfig: { kind: "local-json" }, tursoDatabaseUrl: undefined, tursoProjectId: null })).toBe(before);
    } finally {
      window.localStorage.removeItem("aipm-cockpit:projects");
    }
  });
});
