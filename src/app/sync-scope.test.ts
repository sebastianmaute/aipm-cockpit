import { describe, expect, it } from "vitest";
import { syncScopeKey } from "./sync-scope";

// §643 — the tab-sync scope must name the DATA a window edits, not just its registry entry: two
// windows that share a scope apply and autosave each other's slices.
describe("syncScopeKey (§643)", () => {
  it("keys a Turso project by database URL and project id, and never by the token", () => {
    const a = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p1", registryProjectId: null });
    const b = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://b.turso.io", tursoProjectId: "p1", registryProjectId: null });
    const c = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p2", registryProjectId: null });
    expect(a).not.toBeNull();
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBe(syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p1", registryProjectId: "ignored" }));
  });

  it("keys a Turso database with no project id by its URL, and gives no scope without a URL", () => {
    const one = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: null, registryProjectId: null });
    const two = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://b.turso.io", tursoProjectId: null, registryProjectId: null });
    expect(one).not.toBeNull();
    expect(one).not.toBe(two);
    expect(syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: undefined, tursoProjectId: "p1", registryProjectId: null })).toBeNull();
  });

  it("keys a SharePoint project by its file location", () => {
    const sp = (itemPath: string, kind: "sp-json" | "sp-csv" = "sp-json") =>
      syncScopeKey({ storageConfig: { kind, hostname: "h.sharepoint.com", sitePath: "/sites/x", itemPath }, tursoDatabaseUrl: undefined, tursoProjectId: null, registryProjectId: null });
    expect(sp("/a.json")).not.toBeNull();
    expect(sp("/a.json")).not.toBe(sp("/b.json"));
    expect(sp("/a.json")).not.toBe(sp("/a.json", "sp-csv"));
  });

  it("keys browser storage and local files by kind and registry project", () => {
    const k = (kind: "browser" | "local-json" | "local-csv" | "local-md", id: string | null) =>
      syncScopeKey({ storageConfig: { kind }, tursoDatabaseUrl: undefined, tursoProjectId: null, registryProjectId: id });
    expect(k("local-json", "p1")).not.toBe(k("local-json", "p2"));
    expect(k("local-json", "p1")).not.toBe(k("local-csv", "p1"));
    expect(k("browser", "p1")).not.toBe(k("browser", "p2"));
  });

  it("gives browser storage with no registry entry one shared scope: it is the one default store", () => {
    const k = () => syncScopeKey({ storageConfig: { kind: "browser" }, tursoDatabaseUrl: undefined, tursoProjectId: null, registryProjectId: null });
    expect(k()).not.toBeNull();
    expect(k()).toBe(k());
  });

  it("gives a local file with no registry entry NO scope: nothing identifies which file it is", () => {
    for (const kind of ["local-json", "local-csv", "local-md"] as const) {
      expect(syncScopeKey({ storageConfig: { kind }, tursoDatabaseUrl: undefined, tursoProjectId: null, registryProjectId: null })).toBeNull();
      expect(syncScopeKey({ storageConfig: { kind }, tursoDatabaseUrl: undefined, tursoProjectId: null, registryProjectId: "" })).toBeNull();
    }
  });
});
