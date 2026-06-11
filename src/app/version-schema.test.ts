import { describe, it, expect } from "vitest";
import {
  VERSION_TABLE_NAME, VERSION_DDL,
  appendVersionStatements, versionListStatements, versionPayloadStatements,
  pruneStatements, deleteVersionStatements, rowsToVersionMeta,
} from "./version-schema";
import type { ProjectVersion } from "./version-history";

const v: ProjectVersion = {
  id: "v1", projectId: "p1", capturedAt: "2026-06-11T10:00:00.000Z",
  trigger: "manual", label: "Before review", summary: null, payload: '{"tasks":[]}',
};

describe("version-schema", () => {
  it("names the table project_versions and keeps it out of the workspace tables", async () => {
    const { TABLE_NAMES } = await import("./turso-schema");
    expect(VERSION_TABLE_NAME).toBe("project_versions");
    expect(TABLE_NAMES).not.toContain("project_versions");
    expect(VERSION_DDL.join("\n")).toMatch(/CREATE TABLE IF NOT EXISTS project_versions/);
  });

  it("append inserts all columns including the payload and project_id", () => {
    const stmts = appendVersionStatements(v, "p1");
    const insert = stmts.find((s) => s.sql.startsWith("INSERT INTO project_versions"));
    expect(insert).toBeTruthy();
    const values = (insert!.args ?? []).map((a) => a.value);
    expect(values).toContain("v1");
    expect(values).toContain('{"tasks":[]}');
    expect(values).toContain("p1");
    expect(values).toContain("manual");
  });

  it("list selects metadata WITHOUT the payload column, newest first, scoped to project", () => {
    const [sel] = versionListStatements("p1");
    expect(sel.sql).toMatch(/SELECT .* FROM project_versions/);
    expect(sel.sql).not.toMatch(/payload/);
    expect(sel.sql).toMatch(/WHERE project_id = \?/);
    expect(sel.sql).toMatch(/ORDER BY captured_at DESC/);
    expect(sel.args?.[0].value).toBe("p1");
  });

  it("payload select fetches one row's payload by id + project", () => {
    const [sel] = versionPayloadStatements("v1", "p1");
    expect(sel.sql).toMatch(/SELECT payload FROM project_versions WHERE id = \? AND project_id = \?/);
    expect(sel.args?.map((a) => a.value)).toEqual(["v1", "p1"]);
  });

  it("prune deletes auto rows beyond the newest N, never manual rows", () => {
    const [del] = pruneStatements("p1", 50);
    expect(del.sql).toMatch(/DELETE FROM project_versions/);
    expect(del.sql).toMatch(/trigger = 'auto'/);
    expect(del.sql).toMatch(/project_id = \?/);
    expect(del.sql).toMatch(/NOT IN/);
    expect(del.args?.some((a) => a.value === "50")).toBe(true);
  });

  it("rowsToVersionMeta maps rows and coerces trigger/label", () => {
    const res = {
      type: "ok" as const,
      response: {
        type: "execute",
        result: {
          cols: [
            { name: "id" }, { name: "project_id" }, { name: "captured_at" },
            { name: "trigger" }, { name: "label" }, { name: "summary" },
          ],
          rows: [
            [
              { value: "v1" }, { value: "p1" }, { value: "2026-06-11T10:00:00.000Z" },
              { value: "auto" }, { value: "" }, { value: "" },
            ],
          ],
        },
      },
    };
    const metas = rowsToVersionMeta(res as never);
    expect(metas[0]).toMatchObject({ id: "v1", projectId: "p1", trigger: "auto", label: null, summary: null });
  });

  it("deleteVersionStatements removes one row scoped by id + project", () => {
    const [del] = deleteVersionStatements("v1", "p1");
    expect(del.sql).toMatch(/DELETE FROM project_versions WHERE id = \? AND project_id = \?/);
    expect(del.args?.map((a) => a.value)).toEqual(["v1", "p1"]);
  });
});
