import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ASSET_DATA_DDL, assetDataSelect, assetDataIdsSelect, assetDataUpsert,
  assetDataDelete, rowsToAssetData, ASSET_PARTITION_FALLBACK,
} from "./document-assets-schema";

describe("document-assets-schema", () => {
  it("creates the table if it does not exist", () => {
    expect(DOCUMENT_ASSET_DATA_DDL[0]).toContain("CREATE TABLE IF NOT EXISTS document_asset_data");
  });

  it("keys on (id, project_id) so tenant mode cannot collide across projects", () => {
    expect(DOCUMENT_ASSET_DATA_DDL[0]).toContain("PRIMARY KEY (id, project_id)");
  });

  it("selects one asset's bytes, scoped by project", () => {
    const [stmt] = assetDataSelect("a1", "p1");
    expect(stmt.sql).toContain("WHERE id = ? AND project_id = ?");
    expect(stmt.args?.map((a) => a.value)).toEqual(["a1", "p1"]);
  });

  // ★★ The library lists names/sizes from the metadata slice — this statement
  //    must never carry real bytes back, or listing a project's documents
  //    would pull every image's base64 payload just to render a row count.
  it("selects an ids-only row shape, never the real data column contents", () => {
    const [stmt] = assetDataIdsSelect("p1");
    expect(stmt.sql).toContain("'' AS data");
    expect(stmt.sql).not.toMatch(/SELECT id, project_id, data FROM/);
    expect(stmt.args?.map((a) => a.value)).toEqual(["p1"]);
  });

  // ★★ INSERT OR REPLACE, never DELETE-then-INSERT: runTursoPipeline only opens
  //    a transaction when the FIRST statement is literally BEGIN, so a
  //    delete/insert pair is two unprotected statements and a failure between
  //    them loses the bytes.
  it("upserts atomically in a single statement", () => {
    const stmts = assetDataUpsert({ id: "a1", projectId: "p1", data: "QUJD" });
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toContain("INSERT OR REPLACE INTO document_asset_data");
  });

  it("binds bytes as a text arg, since SqlArg.value is string-only", () => {
    const [stmt] = assetDataUpsert({ id: "a1", projectId: "p1", data: "QUJD" });
    expect(stmt.args?.every((a) => a.type === "text")).toBe(true);
  });

  it("requires a project id to delete, so a delete cannot reach across projects", () => {
    const [stmt] = assetDataDelete("a1", "p1");
    expect(stmt.sql).toContain("WHERE id = ? AND project_id = ?");
  });

  it("decodes rows back into id/data pairs", () => {
    const res = {
      type: "ok" as const,
      response: {
        type: "execute",
        result: {
          cols: [{ name: "id" }, { name: "project_id" }, { name: "data" }],
          rows: [[{ value: "a1" }, { value: "p1" }, { value: "QUJD" }]],
        },
      },
    };
    expect(rowsToAssetData(res)).toEqual([{ id: "a1", projectId: "p1", data: "QUJD" }]);
  });

  it("returns an empty list for an undefined result rather than throwing", () => {
    expect(rowsToAssetData(undefined)).toEqual([]);
  });

  // ★★ The value is asserted as a LITERAL on purpose. `AssetDataRow.projectId`
  //    documented `""` as the single-tenant key for as long as this feature has
  //    existed and NO call site ever produced one, so bytes are keyed the way
  //    this constant spells it and by nothing else. Changing it re-partitions
  //    every library that has ever stored a byte, with no version marker on the
  //    table to migrate behind — so it has to fail loudly here.
  it("names one fallback partition key, and it is not the empty sentinel", () => {
    expect(ASSET_PARTITION_FALLBACK).toBe("default");
    expect(ASSET_PARTITION_FALLBACK).not.toBe("");
  });
});
