import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataIdsSelect, assetDataUpsert, assetDataDelete,
  assetPartitionKey, ASSET_PARTITION_FALLBACK, SINGLE_TENANT_ASSET_PARTITION,
} from "./document-assets-schema";
import type { SqlStmt } from "./turso-schema";

// §207: single-tenant asset METADATA is global to the database, but the BYTES
// were keyed on the file registry's current project, so a registry switch read
// every image under a different key and every asset turned dangling. A
// single-tenant backend now writes under one fixed key, and under that key ALONE
// a read reaches every partition, which keeps bytes written under an old key
// readable without a re-key. A tenant project stays strict: an imported
// workspace shares asset ids with the project it came from, so a tenant read
// across partitions would show another project's bytes (review of §207).

describe("assetPartitionKey (§207)", () => {
  it("keys a tenant project in Turso portfolio mode on its id", () => {
    expect(assetPartitionKey({ storageKind: "turso", tursoProjectId: "t1", portfolioMode: "turso", registryProjectId: "r1" })).toBe("t1");
  });

  // A tenant id left stored from an earlier Turso-portfolio session: its bytes were
  // written under the registry id until §207, which only the single-tenant key reads.
  it("takes the single-tenant key for a stale tenant id in file portfolio mode", () => {
    expect(assetPartitionKey({ storageKind: "turso", tursoProjectId: "t1", portfolioMode: "file", registryProjectId: "r1" })).toBe(SINGLE_TENANT_ASSET_PARTITION);
  });

  it("keys a single-tenant Turso backend on one fixed key, whatever registry project is current", () => {
    const a = assetPartitionKey({ storageKind: "turso", tursoProjectId: null, portfolioMode: "file", registryProjectId: "r1" });
    const b = assetPartitionKey({ storageKind: "turso", tursoProjectId: null, portfolioMode: "file", registryProjectId: "r2" });
    expect(a).toBe(SINGLE_TENANT_ASSET_PARTITION);
    expect(b).toBe(a);
  });

  it("treats an empty tenant id as single-tenant, as createBackend does", () => {
    expect(assetPartitionKey({ storageKind: "turso", tursoProjectId: "", portfolioMode: "turso", registryProjectId: null })).toBe(SINGLE_TENANT_ASSET_PARTITION);
  });

  // File storage: the metadata rides each registry project's own file, so the
  // registry id is still the right key, unchanged.
  it("keeps the registry key for non-Turso storage", () => {
    expect(assetPartitionKey({ storageKind: "local-json", tursoProjectId: "t1", portfolioMode: "file", registryProjectId: "r1" })).toBe("r1");
    expect(assetPartitionKey({ storageKind: "browser", tursoProjectId: null, portfolioMode: "file", registryProjectId: null })).toBe(ASSET_PARTITION_FALLBACK);
    expect(assetPartitionKey({ storageKind: "browser", tursoProjectId: "t1", portfolioMode: "turso", registryProjectId: "r1" })).toBe("t1");
  });

  it("never collides with the fallback key or the empty sentinel", () => {
    expect(SINGLE_TENANT_ASSET_PARTITION).not.toBe(ASSET_PARTITION_FALLBACK);
    expect(SINGLE_TENANT_ASSET_PARTITION).not.toBe("");
  });
});

describe("asset byte statements executed against SQLite (§207)", () => {
  let db: DatabaseSync;
  const run = (stmts: SqlStmt[]) =>
    stmts.flatMap((s) => db.prepare(s.sql).all(...(s.args ?? []).map((a) => a.value ?? null)) as Record<string, string>[]);
  const put = (id: string, projectId: string, data: string) => run(assetDataUpsert({ id, projectId, data }));
  const ST = SINGLE_TENANT_ASSET_PARTITION;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    for (const sql of DOCUMENT_ASSET_DATA_DDL) db.exec(sql);
  });

  // The single-tenant SCOPE: its own key plus the keys a pre-§207 build wrote a
  // single-tenant database's bytes under — the registry ids of Turso-storage projects
  // and ASSET_PARTITION_FALLBACK. Read, list and delete reach the same set and
  // nothing outside it (final review of §207).
  const LEGACY = ["r1", ASSET_PARTITION_FALLBACK];

  describe("under the single-tenant key", () => {
    it("reads bytes written under a legacy key, so a registry switch leaves no asset dangling", () => {
      put("a1", "r1", "OLD");
      expect(run(assetDataSelect("a1", ST, LEGACY)).map((r) => r.data)).toEqual(["OLD"]);
    });

    it("prefers its own row when the id sits in several partitions of the scope", () => {
      put("a1", "r1", "OLD");
      put("a1", ST, "NEW");
      put("a1", ASSET_PARTITION_FALLBACK, "OTHER");
      expect(run(assetDataSelect("a1", ST, LEGACY)).map((r) => r.data)).toEqual(["NEW"]);
    });

    it("does not read a partition outside the scope (another tenant, a file project)", () => {
      put("a1", "t2", "THEIRS");
      expect(run(assetDataSelect("a1", ST, LEGACY))).toEqual([]);
    });

    it("lists each id in the scope once, without bytes, and nothing outside it", () => {
      put("a1", "r1", "X");
      put("a1", ST, "Y");
      put("a2", ASSET_PARTITION_FALLBACK, "Z");
      put("a3", "t2", "THEIRS");
      const rows = run(assetDataIdsSelect(ST, LEGACY));
      expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
      expect(rows.every((r) => r.data === "")).toBe(true);
    });

    // A pre-§207 image deleted from the library must stop rendering: before the scope,
    // a strict delete left the legacy row and the cross-partition read found it again.
    it("deletes the id across the scope, after which its read is honestly empty", () => {
      put("a1", ST, "NEW");
      put("a1", "r1", "OLD");
      put("a1", ASSET_PARTITION_FALLBACK, "OLDER");
      run(assetDataDelete("a1", ST, LEGACY));
      expect(run(assetDataSelect("a1", ST, LEGACY))).toEqual([]);
    });

    it("leaves a shared id outside the scope alone when it deletes", () => {
      put("a1", ST, "NEW");
      put("a1", "t2", "THEIRS");
      run(assetDataDelete("a1", ST, LEGACY));
      expect(run(assetDataSelect("a1", "t2")).map((r) => r.data)).toEqual(["THEIRS"]);
    });

    it("reaches its own key alone when no legacy keys are given", () => {
      put("a1", "r1", "OLD");
      expect(run(assetDataSelect("a1", ST))).toEqual([]);
    });
  });

  describe("under a tenant key", () => {
    it("does not read another project's bytes for a shared id", () => {
      put("a1", "t2", "THEIRS");
      expect(run(assetDataSelect("a1", "t1"))).toEqual([]);
    });

    it("lists only its own ids", () => {
      put("a1", "t1", "MINE");
      put("a2", "t2", "THEIRS");
      expect(run(assetDataIdsSelect("t1")).map((r) => r.id)).toEqual(["a1"]);
    });

    it("deletes inside its own partition, after which its read is honestly empty", () => {
      put("a1", "t1", "MINE");
      put("a1", "t2", "THEIRS");
      run(assetDataDelete("a1", "t1"));
      expect(run(assetDataSelect("a1", "t1"))).toEqual([]);
      expect(run(assetDataSelect("a1", "t2")).map((r) => r.data)).toEqual(["THEIRS"]);
    });
  });

  it("returns no row for an id stored nowhere", () => {
    put("a1", "r1", "OLD");
    expect(run(assetDataSelect("a2", ST))).toEqual([]);
  });
});
