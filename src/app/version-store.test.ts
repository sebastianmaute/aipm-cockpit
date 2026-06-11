import { afterEach, describe, expect, it, vi } from "vitest";
import * as pipeline from "./turso-pipeline";
import {
  appendVersion, deleteVersion, listVersionMeta, loadVersionPayload, pruneVersions,
} from "./version-store";
import { VERSION_DDL } from "./version-schema";
import type { TursoConfig } from "./turso-config";
import type { ProjectVersion } from "./version-history";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

vi.mock("./turso-pipeline", { spy: true });

const cfg: TursoConfig = { httpUrl: "https://db.example.com", authToken: "tok" };

const version: ProjectVersion = {
  id: "v1", projectId: "p1", capturedAt: "2026-06-11T10:00:00Z",
  trigger: "auto", label: null, summary: null, payload: '{"tasks":[]}',
};

/** A nested-shape "ok execute" result (cols are {name}[], rows are {value}[][]). */
function execResult(
  cols: string[],
  rows: string[][],
): PipelineResultLike {
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: cols.map((name) => ({ name })),
        rows: rows.map((row) => row.map((value) => ({ value }))),
      },
    },
  } as PipelineResultLike;
}

function spyOnPipeline(results: PipelineResultLike[]) {
  return vi.spyOn(pipeline, "runTursoPipeline").mockResolvedValue(results as never);
}

/** SQL strings of the statements passed to runTursoPipeline at a given call. */
function sqlsAt(spy: ReturnType<typeof spyOnPipeline>, callIndex = 0): string[] {
  const stmts = spy.mock.calls[callIndex][1] as SqlStmt[];
  return stmts.map((s) => s.sql);
}

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("version-store", () => {
  it("appendVersion prepends CREATE TABLE then the INSERT", async () => {
    const spy = spyOnPipeline([]);
    await appendVersion(cfg, version, "p1");
    const sqls = sqlsAt(spy);
    expect(sqls.some((s) => /CREATE TABLE IF NOT EXISTS project_versions/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO project_versions/.test(s))).toBe(true);
  });

  it("listVersionMeta decodes a nested metadata result", async () => {
    const meta = execResult(
      ["id", "project_id", "captured_at", "trigger", "label", "summary"],
      [["v1", "p1", "2026-06-11T10:00:00Z", "auto", "", ""]],
    );
    // DDL occupies results[0]; the SELECT result is at results[VERSION_DDL.length].
    const results: PipelineResultLike[] = [];
    results[VERSION_DDL.length] = meta;
    spyOnPipeline(results);

    const out = await listVersionMeta(cfg, "p1");
    expect(out).toEqual([{
      id: "v1", projectId: "p1", capturedAt: "2026-06-11T10:00:00Z",
      trigger: "auto", label: null, summary: null,
    }]);
  });

  it("loadVersionPayload returns the payload string from a nested result", async () => {
    const results: PipelineResultLike[] = [];
    results[VERSION_DDL.length] = execResult(["payload"], [['{"tasks":[]}']]);
    spyOnPipeline(results);

    const out = await loadVersionPayload(cfg, "v1", "p1");
    expect(out).toBe('{"tasks":[]}');
  });

  it("pruneVersions issues a DELETE ... NOT IN statement", async () => {
    const spy = spyOnPipeline([]);
    await pruneVersions(cfg, "p1", 10);
    const sqls = sqlsAt(spy);
    expect(sqls.some((s) => /DELETE FROM project_versions/.test(s) && /NOT IN/.test(s))).toBe(true);
  });

  it("null config short-circuits without calling runTursoPipeline", async () => {
    const spy = vi.spyOn(pipeline, "runTursoPipeline");
    const out = await listVersionMeta(null, "p1");
    expect(out).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    // sibling no-op paths
    await appendVersion(null, version, "p1");
    await loadVersionPayload(null, "v1", "p1");
    await pruneVersions(null, "p1", 10);
    await deleteVersion(null, "v1", "p1");
    expect(spy).not.toHaveBeenCalled();
  });
});
