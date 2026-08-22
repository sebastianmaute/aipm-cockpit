import { describe, it, expect } from "vitest";
import {
  pragmaStatements,
  existingColumnsFromPragma,
  missingColumnAlters,
  columnRenameAlters,
  buildColumnEnsureAlters,
  singleTenantTableColumns,
  tenantTableColumns,
  type TableColumns,
} from "./turso-migrate";
import { ENTITY_SPECS, PLAN_COLUMNS, type PipelineResultLike } from "./turso-schema";

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
  it("returns the null sentinel for ZERO ROWS even when cols metadata is present (table absent)", () => {
    // ★★ A table that EXISTS always has at least one column, so `PRAGMA
    // table_info` returning zero rows means the table is ABSENT — not that it
    // exists with no columns. Reporting `[]` here would make every expected
    // column look "missing" and emit `ALTER TABLE … ADD COLUMN` against a table
    // that is not there, which errors. The null sentinel says "do not ALTER";
    // the DDL both load paths prepend is what creates the table.
    expect(existingColumnsFromPragma(pragmaResult([]))).toBeNull();
  });
  it("returns the null sentinel when cols metadata is absent and no name column found (schema drift)", () => {
    expect(existingColumnsFromPragma(undefined)).toBeNull();
    const noCols: PipelineResultLike = { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } };
    expect(existingColumnsFromPragma(noCols)).toBeNull();
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

  it("emits NO alters for a table whose PRAGMA result has empty cols (unknown schema → null sentinel)", () => {
    const driftResult: PipelineResultLike = { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } };
    const results = [
      driftResult, // tasks: schema drift / unknown — must NOT ALTER
      pragmaResult(["id", "name"]), // milestones missing outlookEventId
    ];
    expect(buildColumnEnsureAlters(specs, results)).toEqual([
      { sql: 'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT' },
    ]);
  });

  it("aligns specs to pragmaResults by index", () => {
    // ★★ BOTH TABLES ARE PRESENT here (non-empty PRAGMA rows) — an absent-table
    // fixture cannot test alignment any more, because a zero-row result is the
    // null sentinel for EVERY spec and so produces the same empty output
    // whichever spec it is paired with.
    //
    // ★★★ The two results are deliberately CROSS-SHAPED: result[0] holds the
    // MILESTONES column set and result[1] holds the TASKS one. Correct
    // index-alignment therefore finds every expected column missing, while ANY
    // mispairing (results reversed, or one result reused for both specs) finds
    // them all present and emits a DIFFERENT list — so this genuinely fails on a
    // pairing bug rather than merely on a counting one.
    const results = [
      pragmaResult(["id", "name", "outlookEventId"]), // paired with the TASKS spec
      pragmaResult(["id", "taskName"]), // paired with the MILESTONES spec
    ];
    const alters = buildColumnEnsureAlters(specs, results).map((s) => s.sql);
    expect(alters).toEqual([
      'ALTER TABLE "tasks" ADD COLUMN "taskName" TEXT',
      'ALTER TABLE "milestones" ADD COLUMN "name" TEXT',
      'ALTER TABLE "milestones" ADD COLUMN "outlookEventId" TEXT',
    ]);
    // The control for the paragraph above: swap the results and NOTHING is
    // emitted, because each spec then meets a table that already has its
    // columns. Without this, an implementation ignoring `pragmaResults`
    // entirely and altering everything would satisfy the assertion above.
    expect(buildColumnEnsureAlters(specs, [results[1], results[0]])).toEqual([]);
  });

  it("emits NO alters for tables the PRAGMA reports as ABSENT (zero rows)", () => {
    // ★★★ This is what the alignment case above used to assert the OPPOSITE of.
    // Zero PRAGMA rows means the table does not exist, so an `ALTER TABLE …
    // ADD COLUMN` against it would error out the whole migrate pipeline. It went
    // unnoticed while every table was created by the full DDL both load paths
    // prepend before any save; `document_assets` is the first brand-new table
    // to reach this helper without that cover.
    const results = [pragmaResult([]), pragmaResult([])]; // both tables absent
    expect(buildColumnEnsureAlters(specs, results)).toEqual([]);
  });
});

describe("column-set sources", () => {
  it("singleTenantTableColumns mirrors ENTITY_SPECS tables + columns, plus the plan table", () => {
    const cols = singleTenantTableColumns();
    expect(cols.map((c) => c.table)).toEqual([...ENTITY_SPECS.map((s) => s.table), "plan"]);
    const milestones = cols.find((c) => c.table === "milestones");
    expect(milestones?.columns).toContain("outlookEventId");
    expect(milestones?.columns).not.toContain("project_id");
  });

  it("tenantTableColumns appends project_id to every entity table, plus the plan and projects tables", () => {
    const cols = tenantTableColumns();
    expect(cols.map((c) => c.table)).toEqual([...ENTITY_SPECS.map((s) => s.table), "plan", "projects"]);
    // Every table EXCEPT the shared projects table carries project_id.
    expect(cols.filter((c) => c.table !== "projects").every((c) => c.columns.includes("project_id"))).toBe(true);
    const milestones = cols.find((c) => c.table === "milestones");
    expect(milestones?.columns).toContain("outlookEventId");
    expect(milestones?.columns).toContain("project_id");
    // The projects table holds ProjectMeta columns (incl. knowledgeLinks), no project_id.
    const projects = cols.find((c) => c.table === "projects");
    expect(projects?.columns).toContain("id");
    expect(projects?.columns).toContain("knowledgeLinks");
    expect(projects?.columns).not.toContain("project_id");
  });
});

// Regression / data-safety: the persisted embedded links column was renamed
// `documentLinks` → `knowledgeLinks`. An existing Turso DB must RENAME the column
// in place (never drop it) so no user loses their links, and a second migration
// run must be a no-op (idempotent).
describe("documentLinks → knowledgeLinks column rename", () => {
  it("emits RENAME COLUMN when the old column is present and the new one absent", () => {
    const { alters, renamed } = columnRenameAlters(
      "tasks",
      ["id", "taskName", "documentLinks"],
      ["id", "taskName", "knowledgeLinks"],
    );
    expect(alters).toEqual([
      { sql: 'ALTER TABLE "tasks" RENAME COLUMN "documentLinks" TO "knowledgeLinks"' },
    ]);
    expect([...renamed]).toEqual(["knowledgeLinks"]);
  });

  it("emits nothing once already renamed (idempotent)", () => {
    const { alters, renamed } = columnRenameAlters(
      "tasks",
      ["id", "taskName", "knowledgeLinks"],
      ["id", "taskName", "knowledgeLinks"],
    );
    expect(alters).toEqual([]);
    expect(renamed.size).toBe(0);
  });

  it("does NOT rename a legacy column on a table that does not expect the new name", () => {
    const { alters } = columnRenameAlters("other", ["id", "documentLinks"], ["id", "somethingElse"]);
    expect(alters).toEqual([]);
  });

  it("renames in place — the just-renamed column is NOT also ADDed (no empty-column data loss)", () => {
    const specs: TableColumns[] = [{ table: "tasks", columns: ["id", "taskName", "knowledgeLinks"] }];
    // Existing DB: old documentLinks column present, new knowledgeLinks absent.
    const results = [pragmaResult(["id", "taskName", "documentLinks"])];
    const sql = buildColumnEnsureAlters(specs, results).map((s) => s.sql);
    expect(sql).toEqual([
      'ALTER TABLE "tasks" RENAME COLUMN "documentLinks" TO "knowledgeLinks"',
    ]);
    // Critically: NO `ADD COLUMN "knowledgeLinks"` (that would overwrite the data).
    expect(sql.some((s) => /ADD COLUMN "knowledgeLinks"/.test(s))).toBe(false);
  });

  it("is a no-op on a fresh/up-to-date DB that already has knowledgeLinks", () => {
    const specs: TableColumns[] = [{ table: "tasks", columns: ["id", "taskName", "knowledgeLinks"] }];
    const results = [pragmaResult(["id", "taskName", "knowledgeLinks"])];
    expect(buildColumnEnsureAlters(specs, results)).toEqual([]);
  });

  it("renames the tenant projects table's legacy documentLinks column", () => {
    const specs = tenantTableColumns();
    const results = specs.map((s) =>
      s.table === "projects"
        ? pragmaResult(["id", "archived", "name", "documentLinks"])
        : pragmaResult([...s.columns]),
    );
    const sql = buildColumnEnsureAlters(specs, results).map((s) => s.sql);
    expect(sql).toContain('ALTER TABLE "projects" RENAME COLUMN "documentLinks" TO "knowledgeLinks"');
    expect(sql.some((s) => /ADD COLUMN "knowledgeLinks"/.test(s))).toBe(false);
  });
});

// Regression: a new TEXT column (budgetFollowsPlan) was added to PLAN_COLUMNS +
// both plan INSERTs. The plan table must be part of the column-ensure spec so an
// EXISTING Turso DB (created before the column) self-heals via ALTER TABLE — else
// the next named-column INSERT throws "table plan has no column named …" and every
// workspace save fails. fx_rates/meta stay excluded (their column sets are stable).
describe("plan table self-heal (budgetFollowsPlan)", () => {
  // The pre-change plan table: single-tenant carries `id`, tenant carries `project_id`.
  const LEGACY_PLAN = ["startDate", "endDate", "granularity", "currency"];
  const hasPlanBudgetFollowsPlanAlter = (alters: { sql: string }[]): boolean =>
    alters.some((a) => /ALTER TABLE .*plan.* ADD COLUMN .*budgetFollowsPlan.* TEXT/i.test(a.sql));

  it("single-tenant spec includes the plan table carrying budgetFollowsPlan", () => {
    const plan = singleTenantTableColumns().find((c) => c.table === "plan");
    expect(plan?.columns).toContain("budgetFollowsPlan");
  });

  it("tenant spec includes the plan table carrying budgetFollowsPlan + project_id", () => {
    const plan = tenantTableColumns().find((c) => c.table === "plan");
    expect(plan?.columns).toContain("budgetFollowsPlan");
    expect(plan?.columns).toContain("project_id");
  });

  it("self-heals an existing plan table missing budgetFollowsPlan (single-tenant)", () => {
    const specs = singleTenantTableColumns();
    const results = specs.map((s) =>
      s.table === "plan" ? pragmaResult(["id", ...LEGACY_PLAN]) : pragmaResult([...s.columns]),
    );
    expect(hasPlanBudgetFollowsPlanAlter(buildColumnEnsureAlters(specs, results))).toBe(true);
  });

  it("self-heals an existing plan table missing budgetFollowsPlan (tenant)", () => {
    const specs = tenantTableColumns();
    const results = specs.map((s) =>
      s.table === "plan" ? pragmaResult([...LEGACY_PLAN, "project_id"]) : pragmaResult([...s.columns]),
    );
    expect(hasPlanBudgetFollowsPlanAlter(buildColumnEnsureAlters(specs, results))).toBe(true);
  });

  it("emits NO plan ALTER for an up-to-date plan table (single-tenant)", () => {
    const specs = singleTenantTableColumns();
    const results = specs.map((s) =>
      s.table === "plan" ? pragmaResult(["id", ...PLAN_COLUMNS]) : pragmaResult([...s.columns]),
    );
    expect(hasPlanBudgetFollowsPlanAlter(buildColumnEnsureAlters(specs, results))).toBe(false);
  });
});
