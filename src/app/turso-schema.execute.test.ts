// Turso schema — EXECUTED against a real SQLite engine.
//
// ★★★ WHY THIS FILE EXISTS. Every other Turso test in this repo proves the
// schema by STRING-MATCHING the generated SQL (`entity-persistence-registry`
// asserts `SCHEMA_DDL.some(ddl => ddl.includes("CREATE TABLE IF NOT EXISTS
// document_assets"))`) and never executes a statement. That is blind to the
// only thing SQLite actually enforces: `id INTEGER PRIMARY KEY` is a rowid
// ALIAS, and binding a non-numeric id to one is rejected with
// "datatype mismatch". The whole workspace save rides ONE BEGIN…COMMIT, so a
// single rejected row aborts the transaction and NOTHING saves — which is
// exactly what `document_assets` (crypto.randomUUID() ids) did until
// `EntitySpec.idKind` landed. The string-matching suite was green throughout,
// and its fixture id "a1" would itself have been rejected by a real engine.
//
// So: this suite runs the REAL statement builders against `node:sqlite`
// (built into Node, no new dependency), for BOTH backends, GENERALISED over
// ENTITY_SPECS — every future entity is pinned the day it is added to the
// registry, with no edit here.
//
// ★★ It also checks the WIRE type, which SQLite alone cannot catch. The tenant
// DDL emits a plain `id INTEGER` inside a composite PK, whose affinity SQLite
// does NOT enforce (a uuid stores fine), so a uuid-vs-INTEGER mismatch is
// invisible to the engine on that path — but `{"type":"integer","value":…}` in
// the Hrana protocol carries a decimal i64 as a string, and a uuid there is a
// protocol violation the real server rejects. `expectWireConformantArgs` is the
// only detector for that half.

import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ENTITY_SPECS, SCHEMA_DDL, workspaceToStatements,
  type EntitySpec, type SqlStmt,
} from "./turso-schema";
import { tenantSchemaDdl, tenantWorkspaceToStatements } from "./turso-tenant-schema";
import { emptyWorkspace, type Workspace } from "./workspace";

const PROJECT_ID = "proj-exec-1";

// ★★ `node:sqlite` is built into the Node this repo runs on (24.x) but carries
// NO type declarations here — `@types/node` is pinned at ^20, which predates the
// module — so the import above resolves at runtime and would fail
// `npx tsc --noEmit` (TS2591) on its own. `node-sqlite.d.ts` supplies a trimmed
// ambient stub; read its DELETE-WHEN note before touching either file.

// --- fixtures -------------------------------------------------------------

/** Columns whose value must satisfy a domain check before the spec's own
 *  `fromObj` will build a row at all (it returns null otherwise). Keyed
 *  `<table>.<column>` so a generic value never leaks into an unrelated table.
 *  Everything else takes the generic value below — a new entity needs an entry
 *  here ONLY if its builder rejects the generic one, and it says so by failing
 *  the "builds a fixture" expectation rather than passing silently. */
const FIXTURE_OVERRIDES: Readonly<Record<string, string>> = {
  "raid.category": "R",
  "raid.status": "Open",
  "roles.disciplineId": "1",
  "roles.gradeId": "1",
};

/**
 * Which id kind an entity ACTUALLY mints, derived from its own decode builder
 * and NOT from `EntitySpec.idKind`.
 *
 * ★★★ THIS INDEPENDENCE IS THE WHOLE TEST. Reading `spec.idKind` here would
 * make the fixture adapt to the very field under test: reverting
 * `idKind: "text"` on `document_assets` would silently switch the fixture to a
 * numeric id, the INTEGER DDL would accept it, and EVERY assertion in this file
 * would stay green over the restored bug. Measured, not reasoned — the first cut of this
 * file did exactly that and the mutant survived.
 *
 * Feeding every builder a uuid separates them cleanly instead: the thirteen
 * numeric entities all coerce it (`Number()` / `toNumber()`) to NaN and reject
 * the row outright, while `document_assets` keeps it as a string.
 */
function observedIdKind(spec: EntitySpec<unknown>): "integer" | "text" {
  const built = buildFixture(spec, crypto.randomUUID()) as { id?: unknown } | null;
  return built !== null && typeof built.id === "string" ? "text" : "integer";
}

/**
 * The id for a spec's fixture row, in the kind that entity really mints.
 *
 * ★★★ THE TEXT ID MUST NOT BE A NUMERIC STRING. `"42"` binds happily to an
 * `id INTEGER PRIMARY KEY` and is silently stored as the integer 42, so a
 * fixture using one passes against the UNFIXED code and re-masks the exact bug
 * this file exists to catch. A real crypto.randomUUID() is the only fixture
 * that can distinguish the two id kinds.
 */
function fixtureId(spec: EntitySpec<unknown>): string {
  return observedIdKind(spec) === "text" ? crypto.randomUUID() : "1";
}

function fixtureValue(table: string, col: string, id: string): string {
  if (col === "id") return id;
  const override = FIXTURE_OVERRIDES[`${table}.${col}`];
  if (override !== undefined) return override;
  if (/date|At$/i.test(col)) return "2026-02-01";
  return `v-${col}`;
}

/** Build one minimal-but-realistic entity through the spec's OWN decode
 *  builder, so the fixture is whatever a real load would have produced —
 *  no hand-listed entity shapes, and a new registry row is covered for free. */
function buildFixture(spec: EntitySpec<unknown>, id: string): unknown {
  const row: Record<string, string> = {};
  for (const c of spec.columns) row[c] = fixtureValue(spec.table, c, id);
  return spec.fromObj(row);
}

function workspaceWith(spec: EntitySpec<unknown>, entity: unknown): Workspace {
  const ws = emptyWorkspace();
  (ws[spec.wsKey] as unknown) = [entity];
  return ws;
}

// --- the engine -----------------------------------------------------------

/**
 * Bind one Hrana arg the way a permissive driver would, so SQLite's OWN type
 * enforcement is what decides the outcome:
 *  - a well-formed `integer` becomes a BigInt (the i64 the wire type promises);
 *  - a MALFORMED one is passed through as the raw string, so an
 *    `INTEGER PRIMARY KEY` rejects it with "datatype mismatch" rather than the
 *    test throwing on BigInt() first and hiding which layer refused it.
 */
function bindArg(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}

function runStatements(db: DatabaseSync, statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    if (!s.args || s.args.length === 0) {
      db.exec(s.sql);
      continue;
    }
    db.prepare(s.sql).run(...s.args.map(bindArg));
  }
}

/** Every `{type:"integer"}` arg must carry a decimal i64 — the Hrana protocol
 *  admits nothing else, and SQLite cannot see a violation on a plain-affinity
 *  column (the tenant `id`). */
function expectWireConformantArgs(statements: readonly SqlStmt[]): void {
  for (const s of statements) {
    for (const a of s.args ?? []) {
      if (a.type !== "integer") continue;
      expect(
        { sql: s.sql, value: a.value },
        `integer arg is not a decimal i64 — the Hrana wire type would be rejected`,
      ).toMatchObject({ value: expect.stringMatching(/^-?\d+$/) as unknown as string });
    }
  }
}

function selectRow(db: DatabaseSync, sql: string, ...args: string[]): Record<string, unknown> {
  const rows = db.prepare(sql).all(...args);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Compare the stored row against what the spec's own encoder said it wrote.
 *  SQLite hands INTEGER columns back as numbers/bigints, so both sides are
 *  stringified — the point is the VALUE survived, not its JS type. */
function expectRowMatchesEncoder(
  spec: EntitySpec<unknown>,
  entity: unknown,
  row: Record<string, unknown>,
): void {
  for (const c of spec.columns) {
    expect(String(row[c] ?? ""), `${spec.table}.${c}`).toBe(spec.toRow(entity, c));
  }
}

/** The declared SQL type of a table's `id` column, read out of its CREATE
 *  statement. ★ Deliberately NOT a `toContain("id TEXT")` — every tenant DDL
 *  ends `, project_id TEXT`, so that substring is present on EVERY table and
 *  the assertion would pass for all of them. Anchored on the opening paren
 *  instead (`id` is the first column of every entity spec). */
function idDdlType(statements: readonly string[], table: string): string {
  const ddl = statements.find((d) => d.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`));
  expect(ddl, `${table} has no DDL`).toBeDefined();
  const match = /\(id (INTEGER|TEXT)\b/.exec(ddl ?? "");
  expect(match, `${table} DDL does not open with an id column: ${ddl}`).not.toBeNull();
  return match?.[1] ?? "";
}

// --- the suites -----------------------------------------------------------

describe.each(ENTITY_SPECS.map((s) => [s.table, s] as const))(
  "turso schema executes for %s",
  (table, spec) => {
    it("builds a fixture its own decode builder accepts", () => {
      // A null here means the generic fixture missed a domain-required column —
      // add a FIXTURE_OVERRIDES entry. It is deliberately a hard failure: a
      // skipped entity would make every assertion below vacuous for it.
      expect(buildFixture(spec, fixtureId(spec))).not.toBeNull();
    });

    it("round-trips a row through the single-tenant DDL + INSERT", () => {
      const id = fixtureId(spec);
      const entity = buildFixture(spec, id);
      const db = new DatabaseSync(":memory:");
      try {
        for (const ddl of SCHEMA_DDL) db.exec(ddl);
        const statements = workspaceToStatements(workspaceWith(spec, entity));
        // Engine first, wire check second: SQLite is the harsher and more
        // fundamental judge on the single-tenant path (`id INTEGER PRIMARY KEY`
        // is a rowid alias and rejects a uuid with "datatype mismatch"), while
        // the tenant path's plain-affinity `id` accepts anything and only the
        // wire check can fail it. Checking the wire first would mask the
        // engine's verdict behind an assertion error on BOTH paths.
        runStatements(db, statements);
        expectWireConformantArgs(statements);

        const row = selectRow(db, `SELECT * FROM ${table}`);
        expect(String(row.id)).toBe(id);
        expectRowMatchesEncoder(spec, entity, row);
      } finally {
        db.close();
      }
    });

    it("round-trips a row through the multi-tenant DDL + INSERT", () => {
      const id = fixtureId(spec);
      const entity = buildFixture(spec, id);
      const db = new DatabaseSync(":memory:");
      try {
        for (const ddl of tenantSchemaDdl()) db.exec(ddl);
        const statements = tenantWorkspaceToStatements(workspaceWith(spec, entity), PROJECT_ID);
        // Engine first, wire check second: SQLite is the harsher and more
        // fundamental judge on the single-tenant path (`id INTEGER PRIMARY KEY`
        // is a rowid alias and rejects a uuid with "datatype mismatch"), while
        // the tenant path's plain-affinity `id` accepts anything and only the
        // wire check can fail it. Checking the wire first would mask the
        // engine's verdict behind an assertion error on BOTH paths.
        runStatements(db, statements);
        expectWireConformantArgs(statements);

        const row = selectRow(db, `SELECT * FROM ${table} WHERE project_id = ?`, PROJECT_ID);
        expect(String(row.id)).toBe(id);
        expect(row.project_id).toBe(PROJECT_ID);
        expectRowMatchesEncoder(spec, entity, row);
      } finally {
        db.close();
      }
    });
  },
);

describe("turso schema id kinds", () => {
  it("declares an idKind matching the kind its own decode builder accepts", () => {
    for (const spec of ENTITY_SPECS) {
      expect(spec.idKind ?? "integer", spec.table).toBe(observedIdKind(spec));
    }
  });

  it("gives every entity an id column whose DDL type matches the kind it mints", () => {
    for (const spec of ENTITY_SPECS) {
      expect(spec.columns, `${spec.table} has no id column`).toContain("id");
      expect(idDdlType(SCHEMA_DDL, spec.table), spec.table)
        .toBe(observedIdKind(spec) === "text" ? "TEXT" : "INTEGER");
    }
  });

  it("gives every entity a tenant DDL id type matching the kind it mints", () => {
    const tenantDdl = tenantSchemaDdl();
    for (const spec of ENTITY_SPECS) {
      expect(idDdlType(tenantDdl, spec.table), spec.table)
        .toBe(observedIdKind(spec) === "text" ? "TEXT" : "INTEGER");
    }
  });

  it("saves the whole workspace in one transaction when every entity is populated at once", () => {
    // The defect was never about one table in isolation: the failing INSERT sat
    // inside the same BEGIN…COMMIT as every other table, so ONE rejected row
    // stopped tasks, RAID, milestones, budgets, plan and meta from saving too.
    const ws = emptyWorkspace();
    const ids = new Map<string, string>();
    for (const spec of ENTITY_SPECS) {
      const id = fixtureId(spec);
      ids.set(spec.table, id);
      (ws[spec.wsKey] as unknown) = [buildFixture(spec, id)];
    }
    const db = new DatabaseSync(":memory:");
    try {
      runStatements(db, workspaceToStatements(ws));
      for (const spec of ENTITY_SPECS) {
        const row = selectRow(db, `SELECT * FROM ${spec.table}`);
        expect(String(row.id), spec.table).toBe(ids.get(spec.table));
      }
      // The singletons + meta that ride the same transaction.
      expect(db.prepare("SELECT * FROM plan").all()).toHaveLength(1);
      expect(
        (db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").all() as { value: string }[]),
      ).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
