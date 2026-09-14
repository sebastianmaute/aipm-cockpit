// open-followups §204 — runs the REAL hard-delete statements (tenant transaction
// + the side-table sweep) against node:sqlite. Rows are inserted generically
// from PRAGMA columns: the subject is the DELETE, not each store's insert.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { tenantSchemaDdl, hardDeleteProjectStatements } from "./turso-tenant-schema";
import { PROJECT_SCOPED_SIDE_TABLES, projectSideTableSweepStatements } from "./project-side-tables";
import type { SqlStmt } from "./turso-schema";

function run(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) { db.exec(s.sql); continue; }
    db.prepare(s.sql).run(...s.args.map((a) => a.value ?? null));
  }
}

function insertFor(db: DatabaseSync, table: string, projectId: string, n: number): void {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]);
  const values = cols.map((c) => {
    if (c.name === "project_id") return projectId;
    if (/INT/i.test(c.type)) return n;
    return `${projectId}-${n}`;
  });
  db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c.name}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...values);
}

const count = (db: DatabaseSync, table: string, projectId: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as { n: number | bigint }).n);

describe("hardDeleteProject statements against a real engine (open-followups §204)", () => {
  it("empties every registered side table for p1 and leaves p2 untouched", () => {
    const db = new DatabaseSync(":memory:");
    run(db, tenantSchemaDdl().map((sql) => ({ sql })));
    run(db, projectSideTableSweepStatements("setup-only").filter((s) => !s.sql.startsWith("DELETE")));
    for (const { table } of PROJECT_SCOPED_SIDE_TABLES) {
      insertFor(db, table, "p1", 1);
      insertFor(db, table, "p2", 2);
    }
    run(db, hardDeleteProjectStatements("p1"));
    run(db, projectSideTableSweepStatements("p1"));
    for (const { table } of PROJECT_SCOPED_SIDE_TABLES) {
      expect(count(db, table, "p1"), table).toBe(0);
      expect(count(db, table, "p2"), table).toBe(1);
    }
  });
});
