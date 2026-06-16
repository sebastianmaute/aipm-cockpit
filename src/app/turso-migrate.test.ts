import { describe, it, expect } from "vitest";
import {
  pragmaStatements,
  existingColumnsFromPragma,
  missingColumnAlters,
  buildColumnEnsureAlters,
  singleTenantTableColumns,
  tenantTableColumns,
  type TableColumns,
} from "./turso-migrate";
import { ENTITY_SPECS, type PipelineResultLike } from "./turso-schema";

/** Build a realistic PRAGMA table_info result: rows of (cid,name,type,notnull,dflt_value,pk). */
function pragmaResult(columnNames: string[]): PipelineResultLike {
  return {
    type: "ok",
    response: {
      type: "execute",
      result: {
        cols: ["cid", "name", "type", "notnull", "dflt_value", "pk"].map((name) => ({ name })),
        rows: columnNames.map((name, i) => [
          { value: String(i) }, // cid
          { value: name }, // name
          { value: name === "id" ? "INTEGER" : "TEXT" }, // type
          { value: "0" }, // notnull
          { value: undefined }, // dflt_value
          { value: name === "id" ? "1" : "0" }, // pk
        ]),
      },
    },
  };
}

describe("pragmaStatements", () => {
  it("emits one PRAGMA table_info per table, quoted, in order", () => {
    expect(pragmaStatements(["tasks", "milestones"])).toEqual([
      { sql: 'PRAGMA table_info("tasks")' },
      { sql: 'PRAGMA table_info("milestones")' },
    ]);
  });
  it("returns [] for no tables", () => {
    expect(pragmaStatements([])).toEqual([]);
  });
});

describe("existingColumnsFromPragma", () => {
  it("extracts the name column from a realistic table_info result", () => {
    const res = pragmaResult(["id", "name", "date", "outlookEventId"]);
    expect(existingColumnsFromPragma(res)).toEqual(["id", "name", "date", "outlookEventId"]);
  });
  it("locates name by cols metadata even when reordered", () => {
    const res: PipelineResultLike = {
      type: "ok",
      response: {
        type: "execute",
        result: {
          cols: [{ name: "name" }, { name: "cid" }, { name: "type" }],
          rows: [
            [{ value: "id" }, { value: "0" }, { value: "INTEGER" }],
            [{ value: "title" }, { value: "1" }, { value: "TEXT" }],
          ],
        },
      },
    };
    expect(existingColumnsFromPragma(res)).toEqual(["id", "title"]);
  });
  it("returns [] for a missing/empty result (table absent)", () => {
    expect(existingColumnsFromPragma(undefined)).toEqual([]);
    expect(existingColumnsFromPragma(pragmaResult([]))).toEqual([]);
  });
  it("skips rows with a null name cell", () => {
    const res: PipelineResultLike = {
      type: "ok",
      response: {
        type: "execute",
        result: {
          cols: [{ name: "cid" }, { name: "name" }],
          rows: [
            [{ value: "0" }, { value: "id" }],
            [{ value: "1" }, { value: undefined }],
          ],
        },
      },
    };
    expect(existingColumnsFromPragma(res)).toEqual(["id"]);
  });
});

describe("missingColumnAlters", () => {
  it("emits ALTER only for expected columns absent from existing", () => {
    const alters = missingColumnAlters("milestones", ["id", "name", "date"], ["id", "name", "date", "outlookEventId"]);
    expect(alters).toEqual([{ sql: 'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT' }]);
  });
  it("never alters the id column even if (impossibly) absent", () => {
    const alters = missingColumnAlters("tasks", ["name"], ["id", "name"]);
    expect(alters).toEqual([]);
  });
  it("emits nothing when every expected column already exists", () => {
    expect(missingColumnAlters("tasks", ["id", "a", "b"], ["id", "a", "b"])).toEqual([]);
  });
  it("quotes table and column names", () => {
    const alters = missingColumnAlters("changes", [], ["foo"]);
    expect(alters[0].sql).toBe('ALTER TABLE "changes" ADD COLUMN "foo" TEXT');
  });
  it("emits an ALTER per missing column across multiple", () => {
    const alters = missingColumnAlters("t", ["id"], ["id", "a", "b", "c"]);
    expect(alters.map((s) => s.sql)).toEqual([
      'ALTER TABLE "t" ADD COLUMN "a" TEXT',
      'ALTER TABLE "t" ADD COLUMN "b" TEXT',
      'ALTER TABLE "t" ADD COLUMN "c" TEXT',
    ]);
  });
});

describe("buildColumnEnsureAlters", () => {
  const specs: TableColumns[] = [
    { table: "tasks", columns: ["id", "taskName"] },
    { table: "milestones", columns: ["id", "name", "outlookEventId"] },
  ];

  it("emits ALTERs only for the tables/columns that are missing", () => {
    const results = [
      pragmaResult(["id", "taskName"]), // tasks up to date
      pragmaResult(["id", "name"]), // milestones missing outlookEventId
    ];
    expect(buildColumnEnsureAlters(specs, results)).toEqual([
      { sql: 'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT' },
    ]);
  });

  it("returns [] when every table is up to date", () => {
    const results = [pragmaResult(["id", "taskName"]), pragmaResult(["id", "name", "outlookEventId"])];
    expect(buildColumnEnsureAlters(specs, results)).toEqual([]);
  });

  it("aligns specs to pragmaResults by index", () => {
    const results = [pragmaResult([]), pragmaResult([])]; // both tables absent
    const alters = buildColumnEnsureAlters(specs, results).map((s) => s.sql);
    expect(alters).toEqual([
      'ALTER TABLE "tasks" ADD COLUMN "taskName" TEXT',
      'ALTER TABLE "milestones" ADD COLUMN "name" TEXT',
      'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT',
    ]);
  });
});

describe("column-set sources", () => {
  it("singleTenantTableColumns mirrors ENTITY_SPECS tables + columns", () => {
    const cols = singleTenantTableColumns();
    expect(cols.map((c) => c.table)).toEqual(ENTITY_SPECS.map((s) => s.table));
    const milestones = cols.find((c) => c.table === "milestones");
    expect(milestones?.columns).toContain("outlookEventId");
    expect(milestones?.columns).not.toContain("project_id");
  });

  it("tenantTableColumns appends project_id to every entity table", () => {
    const cols = tenantTableColumns();
    expect(cols.map((c) => c.table)).toEqual(ENTITY_SPECS.map((s) => s.table));
    expect(cols.every((c) => c.columns.includes("project_id"))).toBe(true);
    const milestones = cols.find((c) => c.table === "milestones");
    expect(milestones?.columns).toContain("outlookEventId");
    expect(milestones?.columns).toContain("project_id");
  });
});
