// src/test/fake-turso.ts
//
// A `/v2/pipeline` endpoint over a REAL SQLite engine (`node:sqlite`), for tests that need a Turso
// store which actually enforces what the statements say: the §4 revision guard, the §637 conditional
// batch. `execute` requests run one by one and each reports its own error; a `batch` runs each step only
// when its condition holds (the Hrana `ok` / `not` / `and` / `or` conditions), so a failing step skips the
// steps that depend on it and the trailing conditional ROLLBACK runs — exactly what `runTursoPipeline`
// relies on. Values come back as strings, as the real wire carries them.
import { DatabaseSync } from "node:sqlite";

interface WireArg { type: string; value?: string }
interface WireStmt { sql: string; args?: WireArg[] }
type Condition =
  | { type: "ok"; step: number }
  | { type: "error"; step: number }
  | { type: "not"; cond: Condition }
  | { type: "and"; conds: Condition[] }
  | { type: "or"; conds: Condition[] };
interface WireRequest { type: string; stmt?: WireStmt; batch?: { steps: { stmt: WireStmt; condition?: Condition }[] } }

function bind(arg: WireArg): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function run(db: DatabaseSync, stmt: WireStmt) {
  const rows = db.prepare(stmt.sql).all(...(stmt.args ?? []).map(bind));
  const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [];
  return {
    cols,
    rows: rows.map((r) => cols.map((c) => {
      const v = r[c.name];
      return v === null || v === undefined ? { type: "null" } : { type: "text", value: String(v) };
    })),
  };
}

function holds(cond: Condition | undefined, results: unknown[], errors: unknown[]): boolean {
  if (!cond) return true;
  switch (cond.type) {
    case "ok": return results[cond.step] != null && errors[cond.step] == null;
    case "error": return errors[cond.step] != null;
    case "not": return !holds(cond.cond, results, errors);
    case "and": return cond.conds.every((c) => holds(c, results, errors));
    case "or": return cond.conds.some((c) => holds(c, results, errors));
  }
}

function answer(db: DatabaseSync, request: WireRequest) {
  if (request.type === "execute" && request.stmt) {
    try {
      return { type: "ok", response: { type: "execute", result: run(db, request.stmt) } };
    } catch (err) {
      return { type: "error", error: { message: (err as Error).message } };
    }
  }
  const steps = request.batch?.steps ?? [];
  const results: unknown[] = [];
  const errors: unknown[] = [];
  steps.forEach((step, i) => {
    results[i] = null;
    errors[i] = null;
    if (!holds(step.condition, results, errors)) return;
    try {
      results[i] = run(db, step.stmt);
    } catch (err) {
      errors[i] = { message: `SQLite error: ${(err as Error).message}` };
    }
  });
  return { type: "ok", response: { type: "batch", result: { step_results: results, step_errors: errors } } };
}

/** A `fetch` double serving `/v2/pipeline` from `db`. Every request body is also kept, for assertions. */
export function fakeTursoFetch(db: DatabaseSync): typeof fetch & { bodies: WireRequest[][] } {
  const bodies: WireRequest[][] = [];
  const impl = async (_url: unknown, init?: RequestInit) => {
    const requests = (JSON.parse(String(init?.body ?? "{}")) as { requests?: WireRequest[] }).requests ?? [];
    bodies.push(requests);
    return new Response(JSON.stringify({ results: requests.map((r) => answer(db, r)) }), { status: 200 });
  };
  return Object.assign(impl, { bodies }) as unknown as typeof fetch & { bodies: WireRequest[][] };
}

/** The value of this DB's (tenant: this project's) revision row, or `null` when there is none. */
export function storedRevision(db: DatabaseSync, projectId?: string): string | null {
  const rows = projectId === undefined
    ? db.prepare("SELECT value FROM meta WHERE key = 'revision'").all()
    : db.prepare("SELECT value FROM meta WHERE key = 'revision' AND project_id = ?").all(projectId);
  return rows.length ? String(rows[0].value) : null;
}
