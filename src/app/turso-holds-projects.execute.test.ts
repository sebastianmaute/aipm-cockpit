// open-followups §790 — runs the REAL "does this database hold projects?" probe against
// node:sqlite, in every database shape a conversion into Turso can meet. The probe is
// what stands between the single-project conversion write and a shared database.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { SCHEMA_DDL, workspaceToStatements, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import { tenantSchemaDdl, tenantWorkspaceToStatements } from "./turso-tenant-schema";
import { buildColumnEnsureAlters, pragmaStatements, tenantTableColumns } from "./turso-migrate";
import { holdsProjectsProbeTables, holdsProjectsStatement, holdsProjectsFromResult, tursoDatabaseHoldsProjects } from "./turso-holds-projects";
import { jsonToWorkspace } from "./workspace";
import type { TursoConfig } from "./turso-config";

// Only the network call is replaced: each test answers it from a real node:sqlite database.
vi.mock("./turso-pipeline", async (importActual) => ({
  ...(await importActual<typeof import("./turso-pipeline")>()),
  runTursoPipeline: vi.fn(),
}));
import { runTursoPipeline } from "./turso-pipeline";

/** One statement through node:sqlite, answered in the pipeline's result shape. */
function step(db: DatabaseSync, s: SqlStmt): PipelineResultLike {
  const st = db.prepare(s.sql);
  const args = (s.args ?? []).map((a) => a.value ?? null);
  if (st.columns().length === 0) {
    st.run(...args);
    return { type: "ok", response: { type: "execute", result: { cols: [], rows: [] } } };
  }
  const cols = st.columns().map((c) => ({ name: c.name }));
  const rows = st.all(...args) as Record<string, unknown>[];
  return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] }))) } } };
}

/** Before §637 a save was separate requests: a failing statement was skipped and COMMIT still ran. */
function runKeepGoing(db: DatabaseSync, stmts: readonly SqlStmt[]): void {
  for (const s of stmts) {
    try { step(db, s); } catch { /* skipped, as the old pipeline did */ }
  }
}

function runAll(db: DatabaseSync, stmts: readonly SqlStmt[]): void {
  for (const s of stmts) step(db, s);
}

/** The probe exactly as the app sends it: PRAGMAs first, then the one statement built from them. */
function probe(db: DatabaseSync): boolean {
  const tables = holdsProjectsProbeTables();
  const pragma = pragmaStatements(tables).map((s) => step(db, s));
  const stmt = holdsProjectsStatement(tables, pragma);
  return stmt === null ? false : holdsProjectsFromResult(step(db, stmt));
}

const ws = jsonToWorkspace(readFileSync("sample-workspace-small.json", "utf8"));
const forProject = (p: string) => ({ ...ws, tasks: ws.tasks.map((t) => ({ ...t, id: t.id + (p === "p2" ? 100000 : 0) })) });
const tasks = (db: DatabaseSync) => Number((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number | bigint }).n);

describe("tursoDatabaseHoldsProjects probe against a real engine (open-followups §790)", () => {
  it("answers no for a fresh database: there is nothing to protect", () => {
    const db = new DatabaseSync(":memory:");
    expect(probe(db)).toBe(false);
  });

  it("answers no for a single-project database with data: overwriting it is the conversion's job", () => {
    const db = new DatabaseSync(":memory:");
    runAll(db, workspaceToStatements(ws, undefined, { expected: null }));
    expect(tasks(db)).toBeGreaterThan(0);
    expect(probe(db)).toBe(false);
  });

  it("answers no for a single-project database that merely carries an empty projects table", () => {
    const db = new DatabaseSync(":memory:");
    runAll(db, workspaceToStatements(ws, undefined, { expected: null }));
    db.exec("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT)");
    expect(probe(db)).toBe(false);
  });

  it("answers yes for a database created for several projects", () => {
    const db = new DatabaseSync(":memory:");
    runAll(db, tenantSchemaDdl().map((sql) => ({ sql })));
    for (const p of ["p1", "p2"]) runAll(db, tenantWorkspaceToStatements(forProject(p), p, undefined, { expected: null }));
    expect(probe(db)).toBe(true);
  });

  it("answers yes when only the projects table holds a row", () => {
    const db = new DatabaseSync(":memory:");
    runAll(db, tenantSchemaDdl().map((sql) => ({ sql })));
    db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run("p1", "One");
    expect(probe(db)).toBe(true);
  });

  // The shape the conversion actually wipes: begun single-project (`plan` keeps its `id`, so the
  // single-project INSERT succeeds), later written for several projects by a pre-§637 build.
  it("answers yes for a database begun single-project and later used for several projects", () => {
    const db = new DatabaseSync(":memory:");
    runAll(db, SCHEMA_DDL.map((sql) => ({ sql })));
    const specs = tenantTableColumns();
    const alters = buildColumnEnsureAlters(specs, pragmaStatements(specs.map((s) => s.table)).map((s) => step(db, s)));
    runAll(db, alters);
    runAll(db, tenantSchemaDdl().map((sql) => ({ sql })));
    for (const p of ["p1", "p2"]) runKeepGoing(db, tenantWorkspaceToStatements(forProject(p), p, undefined, { expected: null }));
    expect(Number((db.prepare("SELECT COUNT(DISTINCT project_id) AS n FROM tasks").get() as { n: number | bigint }).n)).toBe(2);
    expect(probe(db)).toBe(true);
    // Control: this shape really is the dangerous one. Unrefused, the single-project write
    // runs to COMMIT and leaves only the local copy's rows, none of them tied to a project.
    const before = tasks(db);
    runAll(db, workspaceToStatements({ ...ws, tasks: ws.tasks.slice(0, 2) }, undefined, { expected: null }));
    expect(before).toBeGreaterThan(2);
    expect(tasks(db)).toBe(2);
  });
});

describe("tursoDatabaseHoldsProjects over the pipeline (open-followups §790)", () => {
  const config = { httpUrl: "https://x.turso.io", authToken: "tok" } as unknown as TursoConfig;
  const answerFrom = (db: DatabaseSync) =>
    vi.mocked(runTursoPipeline).mockImplementation(async (_cfg, stmts) => stmts.map((s) => step(db, s)));

  it("answers yes for a database that holds projects, and no for an empty one", async () => {
    const shared = new DatabaseSync(":memory:");
    runAll(shared, tenantSchemaDdl().map((sql) => ({ sql })));
    runAll(shared, tenantWorkspaceToStatements(forProject("p1"), "p1", undefined, { expected: null }));
    answerFrom(shared);
    await expect(tursoDatabaseHoldsProjects(config)).resolves.toBe(true);
    answerFrom(new DatabaseSync(":memory:"));
    await expect(tursoDatabaseHoldsProjects(config)).resolves.toBe(false);
  });

  it("throws when the database cannot be read, rather than answering no", async () => {
    vi.mocked(runTursoPipeline).mockRejectedValue(new Error("network down"));
    await expect(tursoDatabaseHoldsProjects(config)).rejects.toThrow("network down");
  });
});
