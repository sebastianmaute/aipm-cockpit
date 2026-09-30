import { describe, expect, it } from "vitest";
import { syncScopeKey } from "./sync-scope";

// §643 — the tab-sync scope must name the DATA a window edits, not just its registry entry: two
// windows that share a scope apply and autosave each other's slices.
describe("syncScopeKey (§643)", () => {
  it("keys a Turso project by database URL and project id, and never by the token", () => {
    const a = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p1", fileBinding: null, isolationToken: "w1" });
    const b = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://b.turso.io", tursoProjectId: "p1", fileBinding: null, isolationToken: "w1" });
    const c = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p2", fileBinding: null, isolationToken: "w1" });
    expect(a).not.toBeNull();
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBe(syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: "p1", fileBinding: null, isolationToken: "w1" }));
  });

  it("keys a Turso database with no project id by its URL, and gives no scope without a URL", () => {
    const one = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://a.turso.io", tursoProjectId: null, fileBinding: null, isolationToken: "w1" });
    const two = syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: "https://b.turso.io", tursoProjectId: null, fileBinding: null, isolationToken: "w1" });
    expect(one).not.toBeNull();
    expect(one).not.toBe(two);
    expect(syncScopeKey({ storageConfig: { kind: "turso" }, tursoDatabaseUrl: undefined, tursoProjectId: "p1", fileBinding: null, isolationToken: "w1" })).toBeNull();
  });

  it("keys a SharePoint project by its file location", () => {
    const sp = (itemPath: string, kind: "sp-json" | "sp-csv" = "sp-json") =>
      syncScopeKey({ storageConfig: { kind, hostname: "h.sharepoint.com", sitePath: "/sites/x", itemPath }, tursoDatabaseUrl: undefined, tursoProjectId: null, fileBinding: null, isolationToken: "w1" });
    expect(sp("/a.json")).not.toBeNull();
    expect(sp("/a.json")).not.toBe(sp("/b.json"));
    expect(sp("/a.json")).not.toBe(sp("/a.json", "sp-csv"));
  });

  // Review I1/I2 on §643 — browser storage is ONE IndexedDB store, so windows on it write the same
  // data whatever registry project they show and must share a scope: split apart, each one's
  // whole-workspace autosave silently overwrote the other's.
  it("keys browser storage by kind alone, whatever file binding is passed", () => {
    const browser = (fileBinding: string | null) => syncScopeKey({ storageConfig: { kind: "browser" }, tursoDatabaseUrl: undefined, tursoProjectId: null, fileBinding, isolationToken: "w1" });
    expect(browser(null)).not.toBeNull();
    expect(browser("p1")).toBe(browser(null));
    expect(browser("p1")).toBe(browser("p2"));
  });

  // §645 (final review C1) — a local file is NOT one store any more: each window writes the file it
  // is bound to, so two windows of one kind on two files must not share a scope, or one applies the
  // other's slices and saves them into its own file. ★★ Final re-review 2 RI2: an UNKNOWN binding
  // (`null`) is never the kind alone either; it keys on the window's own token, so it syncs with nobody.
  it("keys a local file by kind and the window's file binding, and an unknown binding by the window's own token", () => {
    const k = (kind: "local-json" | "local-csv" | "local-md", fileBinding: string | null, isolationToken = "w1") =>
      syncScopeKey({ storageConfig: { kind }, tursoDatabaseUrl: undefined, tursoProjectId: null, fileBinding, isolationToken });
    expect(k("local-json", "a")).toBe(k("local-json", "a"));
    expect(k("local-json", "a", "w1")).toBe(k("local-json", "a", "w2")); // a known binding ignores the token
    expect(k("local-json", "a")).not.toBe(k("local-json", "b"));
    expect(k("local-json", "a")).not.toBe(k("local-csv", "a"));
    expect(k("local-json", null, "w1")).not.toBe(k("local-json", null, "w2")); // two unknown windows never share
    expect(k("local-json", null)).not.toBe(JSON.stringify(["local-json"])); // and never the kind alone
    for (const kind of ["local-json", "local-csv", "local-md"] as const) expect(k(kind, null)).not.toBeNull();
  });

  it("does not depend on the registry's current project, which every tab shares through localStorage", () => {
    window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({ currentProjectId: "p1", projects: [] }));
    try {
      const before = syncScopeKey({ storageConfig: { kind: "local-json" }, tursoDatabaseUrl: undefined, tursoProjectId: null, fileBinding: null, isolationToken: "w1" });
      window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({ currentProjectId: "p2", projects: [] }));
      expect(syncScopeKey({ storageConfig: { kind: "local-json" }, tursoDatabaseUrl: undefined, tursoProjectId: null, fileBinding: null, isolationToken: "w1" })).toBe(before);
    } finally {
      window.localStorage.removeItem("aipm-cockpit:projects");
    }
  });
});
