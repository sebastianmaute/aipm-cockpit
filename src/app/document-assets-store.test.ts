// src/app/document-assets-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAssetData, saveAssetData, deleteAssetData, loadAssetDataIds, deleteAllAssetDataForProject,
} from "./document-assets-store";
import { DOCUMENT_ASSET_DATA_DDL } from "./document-assets-schema";
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

  it("deletes every row of a project in one statement after the DDL, for project-deletion cleanup", async () => {
    vi.mocked(runTursoPipeline).mockResolvedValue([ddlAck]);
    await deleteAllAssetDataForProject(config, "p1");
    const stmts = vi.mocked(runTursoPipeline).mock.calls[0][1];
    expect(stmts).toHaveLength(DOCUMENT_ASSET_DATA_DDL.length + 1);
    expect(stmts[stmts.length - 1].sql).toContain("DELETE FROM document_asset_data WHERE project_id = ?");
  });
});
