// src/app/document-assets-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAssetData, saveAssetData, deleteAssetData, loadAssetDataIds,
} from "./document-assets-store";
import { DOCUMENT_ASSET_DATA_DDL, SINGLE_TENANT_ASSET_PARTITION, ASSET_PARTITION_FALLBACK } from "./document-assets-schema";
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

// §207 final review: under the single-tenant key the store reaches the same SCOPE for
// read, list and delete — its own key, ASSET_PARTITION_FALLBACK and the registry ids of
// Turso-storage projects (where a pre-§207 build wrote this database's bytes). A
// registry project on other storage is never in it.
describe("document-assets-store — the single-tenant scope (§207)", () => {
  const argsOf = (call: number) =>
    vi.mocked(runTursoPipeline).mock.calls[call][1].at(-1)!.args!.map((a) => a.value);

  beforeEach(() => {
    saveRegistry({
      projects: [
        { id: "r-turso", name: "T", code: "T", storageConfig: { kind: "turso" } },
        { id: "r-file", name: "F", code: "F", storageConfig: { kind: "local-json" } },
      ],
      currentProjectId: "r-turso",
    } as unknown as Parameters<typeof saveRegistry>[0]);
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck]);
  });

  it("reads, lists and deletes across the scope, and never a file project's partition", async () => {
    await loadAssetData(config, "a1", SINGLE_TENANT_ASSET_PARTITION);
    await loadAssetDataIds(config, SINGLE_TENANT_ASSET_PARTITION);
    await deleteAssetData(config, "a1", SINGLE_TENANT_ASSET_PARTITION);
    for (const call of [0, 1, 2]) {
      const args = argsOf(call);
      expect(args).toEqual(expect.arrayContaining([SINGLE_TENANT_ASSET_PARTITION, ASSET_PARTITION_FALLBACK, "r-turso"]));
      expect(args).not.toContain("r-file");
    }
  });

  it("keeps a tenant key strict, whatever the registry holds", async () => {
    await deleteAssetData(config, "a1", "t1");
    expect(argsOf(0)).toEqual(["a1", "t1"]);
  });
});
