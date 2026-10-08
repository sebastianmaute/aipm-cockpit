import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataIdsSelect, assetDataUpsert, assetDataDelete,
  assetPartitionKey, ASSET_PARTITION_FALLBACK, SINGLE_TENANT_ASSET_PARTITION, ASSET_DELETED_MARKER,
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
  // single-tenant database's bytes under — the registry id of whichever project was
  // current (a FILE project's id: no production path stores a Turso-kind registry
  // entry) and ASSET_PARTITION_FALLBACK. A delete writes a TOMBSTONE under the
  // single-tenant key, which hides the id from the scoped read and list, and leaves
  // the legacy rows alone: a file project in the registry may share them (owner
  // decision, 2026-10-08).
  const LEGACY = ["r-file", ASSET_PARTITION_FALLBACK];

  describe("under the single-tenant key", () => {
    it("reads bytes written under a file project's registry id before §207", () => {
      put("a1", "r-file", "OLD");
      expect(run(assetDataSelect("a1", ST, LEGACY)).map((r) => r.data)).toEqual(["OLD"]);
    });

    it("prefers its own row when the id sits in several partitions of the scope", () => {
      put("a1", "r-file", "OLD");
      put("a1", ST, "NEW");
      put("a1", ASSET_PARTITION_FALLBACK, "OTHER");
      expect(run(assetDataSelect("a1", ST, LEGACY)).map((r) => r.data)).toEqual(["NEW"]);
    });

    it("does not read a partition outside the scope (another tenant)", () => {
      put("a1", "t2", "THEIRS");
      expect(run(assetDataSelect("a1", ST, LEGACY))).toEqual([]);
    });

    it("lists each id in the scope once, without bytes, and nothing outside it", () => {
      put("a1", "r-file", "X");
      put("a1", ST, "Y");
      put("a2", ASSET_PARTITION_FALLBACK, "Z");
      put("a3", "t2", "THEIRS");
      const rows = run(assetDataIdsSelect(ST, LEGACY));
      expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
      expect(rows.every((r) => r.data === "")).toBe(true);
    });

    // A pre-§207 image deleted from the library must stop rendering in the documents
    // that still embed it: a strict delete left the legacy row for the read to find.
    it("a delete hides the id from the read, legacy copies included", () => {
      put("a1", ST, "NEW");
      put("a1", "r-file", "OLD");
      put("a1", ASSET_PARTITION_FALLBACK, "OLDER");
      run(assetDataDelete("a1", ST, LEGACY));
      expect(run(assetDataSelect("a1", ST, LEGACY))).toEqual([]);
    });

    it("a delete hides the id from the list", () => {
      put("a1", "r-file", "OLD");
      put("a2", ST, "KEEP");
      run(assetDataDelete("a1", ST, LEGACY));
      expect(run(assetDataIdsSelect(ST, LEGACY)).map((r) => r.id)).toEqual(["a2"]);
    });

    // The file project that shares the id keeps its copy, under its own key.
    it("a delete leaves the file project's copy readable under that project's key", () => {
      put("a1", "r-file", "OLD");
      run(assetDataDelete("a1", ST, LEGACY));
      expect(run(assetDataSelect("a1", "r-file", [])).map((r) => r.data)).toEqual(["OLD"]);
    });

    it("a delete removes this database's own bytes, not just hides them", () => {
      put("a1", ST, "NEW");
      run(assetDataDelete("a1", ST, LEGACY));
      const stored = db.prepare("SELECT data FROM document_asset_data WHERE id = ? AND project_id = ?").all("a1", ST) as { data: string }[];
      expect(stored.map((r) => r.data)).toEqual([ASSET_DELETED_MARKER]);
    });

    it("leaves a shared id outside the scope alone when it deletes", () => {
      put("a1", ST, "NEW");
      put("a1", "t2", "THEIRS");
      run(assetDataDelete("a1", ST, LEGACY));
      expect(run(assetDataSelect("a1", "t2", [])).map((r) => r.data)).toEqual(["THEIRS"]);
    });

    it("the deleted marker is no valid base64, so no image's bytes can equal it", () => {
      expect(/^[A-Za-z0-9+/]*={0,2}$/.test(ASSET_DELETED_MARKER)).toBe(false);
    });
  });

  describe("under a tenant key", () => {
    it("does not read another project's bytes for a shared id", () => {
      put("a1", "t2", "THEIRS");
      expect(run(assetDataSelect("a1", "t1", []))).toEqual([]);
    });

    it("lists only its own ids", () => {
      put("a1", "t1", "MINE");
      put("a2", "t2", "THEIRS");
      expect(run(assetDataIdsSelect("t1", [])).map((r) => r.id)).toEqual(["a1"]);
    });

    it("deletes inside its own partition, after which its read is honestly empty", () => {
      put("a1", "t1", "MINE");
      put("a1", "t2", "THEIRS");
      run(assetDataDelete("a1", "t1", []));
      expect(run(assetDataSelect("a1", "t1", []))).toEqual([]);
      expect(run(assetDataSelect("a1", "t2", [])).map((r) => r.data)).toEqual(["THEIRS"]);
    });
  });

  it("returns no row for an id stored nowhere", () => {
    put("a1", "r1", "OLD");
    expect(run(assetDataSelect("a2", ST, LEGACY))).toEqual([]);
  });
});
