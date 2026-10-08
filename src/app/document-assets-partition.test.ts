import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataIdsSelect, assetDataUpsert, assetDataDelete,
  assetPartitionKey, ASSET_PARTITION_FALLBACK, SINGLE_TENANT_ASSET_PARTITION,
} from "./document-assets-schema";
import type { SqlStmt } from "./turso-schema";

// §207: single-tenant asset METADATA is global to the database, but the BYTES
// were keyed on the file registry's current project, so a registry switch read
// every image under a different key and every asset turned dangling. The key
// now follows the backend layout `createBackend` builds, and a read finds an
// asset's bytes by its id in any partition (ids are `crypto.randomUUID()`),
// preferring the current key — which is also how bytes already stored under
// an old key stay readable without a re-key migration.

describe("assetPartitionKey (§207)", () => {
  it("keys a tenant Turso backend on its tenant project id", () => {
    expect(assetPartitionKey({ storageKind: "turso", tursoProjectId: "t1", portfolioMode: "turso", registryProjectId: "r1" })).toBe("t1");
  });

  // createBackend builds the tenant backend from the stored id whatever the
  // portfolio mode says, so the key must follow it there too.
  it("follows the tenant id in file portfolio mode too, as createBackend does", () => {
    expect(assetPartitionKey({ storageKind: "turso", tursoProjectId: "t1", portfolioMode: "file", registryProjectId: "r1" })).toBe("t1");
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

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    for (const sql of DOCUMENT_ASSET_DATA_DDL) db.exec(sql);
  });

  it("reads bytes written under another key, so a registry switch leaves no asset dangling", () => {
    put("a1", "r1", "OLD");
    expect(run(assetDataSelect("a1", SINGLE_TENANT_ASSET_PARTITION)).map((r) => r.data)).toEqual(["OLD"]);
  });

  it("prefers the current key's row when the id sits in several partitions", () => {
    put("a1", "r1", "OLD");
    put("a1", SINGLE_TENANT_ASSET_PARTITION, "NEW");
    put("a1", "r2", "OTHER");
    expect(run(assetDataSelect("a1", SINGLE_TENANT_ASSET_PARTITION)).map((r) => r.data)).toEqual(["NEW"]);
  });

  it("returns no row for an id stored nowhere", () => {
    put("a1", "r1", "OLD");
    expect(run(assetDataSelect("a2", "r1"))).toEqual([]);
  });

  it("lists each stored id once across partitions, without bytes", () => {
    put("a1", "r1", "X");
    put("a1", "r2", "Y");
    put("a2", "r2", "Z");
    const rows = run(assetDataIdsSelect());
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
    expect(rows.every((r) => r.data === "")).toBe(true);
  });

  it("a single-tenant delete removes the asset's bytes from every partition", () => {
    put("a1", "r1", "OLD");
    put("a1", SINGLE_TENANT_ASSET_PARTITION, "NEW");
    put("a2", "r1", "KEEP");
    run(assetDataDelete("a1", SINGLE_TENANT_ASSET_PARTITION));
    expect(run(assetDataIdsSelect()).map((r) => r.id)).toEqual(["a2"]);
  });

  it("a tenant delete stays inside its own partition", () => {
    put("a1", "t1", "MINE");
    put("a1", "t2", "THEIRS");
    run(assetDataDelete("a1", "t1"));
    expect(run(assetDataSelect("a1", "t1")).map((r) => r.data)).toEqual(["THEIRS"]);
  });
});
