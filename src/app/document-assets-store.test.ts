// src/app/document-assets-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAssetData, saveAssetData, deleteAssetData, loadAssetDataIds,
} from "./document-assets-store";
import { DOCUMENT_ASSET_DATA_DDL, SINGLE_TENANT_ASSET_PARTITION, ASSET_PARTITION_FALLBACK, ASSET_DELETED_PARTITION } from "./document-assets-schema";
import { saveRegistry } from "./projects-registry";
import type { PipelineResultLike } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn() }));
import { runTursoPipeline } from "./turso-pipeline";

const config: TursoConfig = { httpUrl: "https://db.example.turso.io", authToken: "t" };

// Every fixture below is a real PipelineResultLike, not an `as never`-masked
// stub — `type` is REQUIRED on the interface and the previous cut of this
// suite hid a mismatch there behind a blanket `as never` on the whole array.
const ddlAck: PipelineResultLike = { type: "ok" };
const selectResult = (cols: string[], rows: (string | null)[][]): PipelineResultLike => ({
  type: "ok",
  response: {
    type: "execute",
    result: {
      cols: cols.map((name) => ({ name })),
      rows: rows.map((row) => row.map((value) => ({ value: value ?? undefined }))),
    },
  },
});

beforeEach(() => { vi.mocked(runTursoPipeline).mockReset(); });

describe("document-assets-store", () => {
  it("prepends the DDL to every call so a fresh database self-heals", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck, selectResult([], [])]);
    await loadAssetData(config, "a1", "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[0].sql).toContain("CREATE TABLE IF NOT EXISTS document_asset_data");
  });

  it("reads the result AFTER the DDL statements, not at index 0", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([
      ddlAck,
      selectResult(["id", "project_id", "data"], [["a1", "p1", "QUJD"]]),
    ]);
    expect(await loadAssetData(config, "a1", "p1")).toBe("QUJD");
  });

  it("returns null when the asset has no byte row — the dangling case", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck, selectResult([], [])]);
    expect(await loadAssetData(config, "missing", "p1")).toBeNull();
  });

  it("returns an empty string for a present-but-empty row, distinct from the dangling null", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([
      ddlAck,
      selectResult(["id", "project_id", "data"], [["a1", "p1", ""]]),
    ]);
    expect(await loadAssetData(config, "a1", "p1")).toBe("");
  });

  it("writes exactly one upsert statement after the DDL", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck]);
    await saveAssetData(config, { id: "a1", projectId: "p1", data: "QUJD" });
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts).toHaveLength(DOCUMENT_ASSET_DATA_DDL.length + 1);
    expect(stmts[stmts.length - 1].sql).toContain("INSERT OR REPLACE");
  });

  it("deletes scoped to the project", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck]);
    await deleteAssetData(config, "a1", "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[stmts.length - 1].sql).toContain("project_id = ?");
  });

  it("lists ids without pulling any bytes", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([
      ddlAck,
      selectResult(["id", "project_id", "data"], [["a1", "p1", ""]]),
    ]);
    expect(await loadAssetDataIds(config, "p1")).toEqual(["a1"]);
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts[stmts.length - 1].sql).toContain("'' AS data");
  });
});

// §207: under the single-tenant key the store reads and lists one SCOPE — its own key,
// ASSET_PARTITION_FALLBACK and EVERY registry id (a pre-§207 build wrote this database's
// bytes under whichever project was current, and production only ever stores FILE-kind
// registry entries) — and a delete writes a tombstone under its own key alone, so a file
// project sharing the id keeps its copy (owner decision, 2026-10-08).
describe("document-assets-store — the single-tenant scope (§207)", () => {
  const stmtOf = (call: number) => vi.mocked(runTursoPipeline).mock.calls[call][1].at(-1)!;
  const argsOf = (call: number) => stmtOf(call).args!.map((a) => a.value);

  beforeEach(() => {
    // A registry production can write: addProject stores only file and browser kinds.
    saveRegistry({
      projects: [
        { id: "r-json", name: "J", code: "J", storageConfig: { kind: "local-json" } },
        { id: "r-browser", name: "B", code: "B", storageConfig: { kind: "browser" } },
      ],
      currentProjectId: "r-json",
    } as unknown as Parameters<typeof saveRegistry>[0]);
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck]);
  });

  it("reads and lists across the scope: its key, the fallback and every registry id", async () => {
    await loadAssetData(config, "a1", SINGLE_TENANT_ASSET_PARTITION);
    await loadAssetDataIds(config, SINGLE_TENANT_ASSET_PARTITION);
    for (const call of [0, 1]) {
      expect(argsOf(call)).toEqual(expect.arrayContaining([SINGLE_TENANT_ASSET_PARTITION, ASSET_PARTITION_FALLBACK, "r-json", "r-browser"]));
    }
  });

  it("deletes by a tombstone row, then its own row, touching no registry project's row", async () => {
    await deleteAssetData(config, "a1", SINGLE_TENANT_ASSET_PARTITION);
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1].slice(DOCUMENT_ASSET_DATA_DDL.length);
    expect(stmts.map((s) => s.sql.split(" ")[0])).toEqual(["INSERT", "DELETE"]);
    expect(stmts.map((s) => s.args!.map((a) => a.value))).toEqual([["a1", ASSET_DELETED_PARTITION], ["a1", SINGLE_TENANT_ASSET_PARTITION]]);
  });

  it("keeps a tenant key strict, whatever the registry holds", async () => {
    await loadAssetData(config, "a1", "t1");
    await deleteAssetData(config, "a1", "t1");
    expect(argsOf(0)).toEqual(["a1", "t1"]);
    expect(argsOf(1)).toEqual(["a1", "t1"]);
  });
});
