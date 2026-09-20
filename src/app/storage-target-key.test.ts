// §591 — the identity of the stored project a backend reads. Pure; coverage-gated.
import { describe, expect, it } from "vitest";
import { storageTargetKey, type StorageTargetInput } from "./storage-target-key";

const NO_TURSO = { tursoDatabaseUrl: undefined, tursoAuthToken: undefined, tursoProjectId: null };
const turso = (url: string | undefined, token: string | undefined, projectId: string | null): StorageTargetInput => ({
  storageConfig: { kind: "turso" }, tursoDatabaseUrl: url, tursoAuthToken: token, tursoProjectId: projectId,
});
const sp = (kind: "sp-json" | "sp-csv", itemPath: string, hostname = "contoso.sharepoint.com", sitePath = "/sites/pm"): StorageTargetInput => ({
  storageConfig: { kind, hostname, sitePath, itemPath }, ...NO_TURSO,
});

describe("storageTargetKey", () => {
  it("is stable for the same Turso target", () => {
    expect(storageTargetKey(turso("libsql://a", "t1", "p1"))).toBe(storageTargetKey(turso("libsql://a", "t1", "p1")));
  });

  it("keys a Turso target on the URL, the token and the project id", () => {
    const base = storageTargetKey(turso("libsql://a", "t1", "p1"));
    expect(storageTargetKey(turso("libsql://b", "t1", "p1"))).not.toBe(base);
    expect(storageTargetKey(turso("libsql://a", "t2", "p1"))).not.toBe(base); // a token-only edit is a new target (spec)
    expect(storageTargetKey(turso("libsql://a", "t1", "p2"))).not.toBe(base);
    expect(storageTargetKey(turso("libsql://a", "t1", null))).not.toBe(base);
  });

  it("treats a missing Turso field like an empty one", () => {
    expect(storageTargetKey(turso(undefined, undefined, null))).toBe(storageTargetKey(turso("", "", null)));
  });

  it("cannot be fooled by a delimiter inside a field", () => {
    expect(storageTargetKey(turso("a|b", "c", null))).not.toBe(storageTargetKey(turso("a", "b|c", null)));
  });

  it("keys a SharePoint target on the hostname, the site path and the item path", () => {
    const base = storageTargetKey(sp("sp-json", "/a.json"));
    expect(storageTargetKey(sp("sp-json", "/a.json"))).toBe(base);
    expect(storageTargetKey(sp("sp-json", "/b.json"))).not.toBe(base);
    expect(storageTargetKey(sp("sp-json", "/a.json", "fabrikam.sharepoint.com"))).not.toBe(base);
    expect(storageTargetKey(sp("sp-json", "/a.json", "contoso.sharepoint.com", "/sites/other"))).not.toBe(base);
    expect(storageTargetKey(sp("sp-csv", "/a.json"))).not.toBe(base);
  });

  it("keys browser and each local-file kind by the kind alone, and ignores the Turso fields there", () => {
    const kinds = ["browser", "local-json", "local-csv", "local-md"] as const;
    const keys = kinds.map((kind) => storageTargetKey({ storageConfig: { kind }, ...NO_TURSO }));
    expect(new Set(keys).size).toBe(kinds.length);
    expect(storageTargetKey({ storageConfig: { kind: "browser" }, tursoDatabaseUrl: "libsql://x", tursoAuthToken: "t", tursoProjectId: "p" }))
      .toBe(keys[0]);
  });

  it("never equals a Turso key for a non-Turso kind with the same strings", () => {
    expect(storageTargetKey({ storageConfig: { kind: "browser" }, ...NO_TURSO })).not.toBe(storageTargetKey(turso(undefined, undefined, null)));
  });
});
