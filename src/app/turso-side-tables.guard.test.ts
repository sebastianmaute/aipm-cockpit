// ★★★ open-followups §204 guard (Ruling Q6). Executes EVERY schema DDL the
// repo declares in node:sqlite, reads each table's columns, and fails on a table
// with a `project_id` column that is neither a TABLE_NAMES member (swept by the
// tenant transaction) nor in PROJECT_SCOPED_SIDE_TABLES (swept after it).
// DISCOVERED, not hardcoded: every `export const <NAME>_DDL` in src/app is
// imported, and a file whose CODE holds a quoted CREATE TABLE literal without
// exporting one must be on the allowlist below with a reason. ★ Comments are
// stripped before that check (pre-flight I2): seven files mention CREATE TABLE
// only in comments, and allowlisting them would hide a real table added to one
// of them later.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { TABLE_NAMES } from "./turso-schema";
import { tenantSchemaDdl } from "./turso-tenant-schema";
import { PROJECT_SCOPED_SIDE_TABLES, sideTableColumns } from "./project-side-tables";

const APP = resolve(__dirname);
// Real DDL only, each with a reason. Never add a comment-only file here.
const NO_EXPORTED_DDL_ALLOWLIST: Record<string, string> = {
  "turso-tenant-schema.ts": "DDL is the tenantSchemaDdl() function, executed explicitly below",
  "turso-backend.ts": "OLD_BLOB_DDL: the legacy single-row `workspace` blob table, no project_id",
  "turso-migrate.ts": "§211 idKindRebuild re-CREATEs an EXISTING ENTITY_SPECS table from its own columns (`textIdDdl`, built by `colDdl`), never a new table",
};
const EXPORT_RE = /export const ([A-Z0-9_]+_DDL)\b/g;
export const DDL_LITERAL_RE = /[`"']\s*CREATE TABLE/;
/** Drops block comments and line comments (a `//` at line start or after
 *  whitespace; a `://` inside a URL is kept). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** A column that names a project: `project_id`, or a pair side such as `project_a` / `project_b` (§785). */
const PROJECT_REF_RE = /^project_(id|[a-z])$/;
const projectRefColumns = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).filter((n) => PROJECT_REF_RE.test(n));

/** Tables with a project-reference column that no sweep covers, or covers only in part. */
export function unsweptProjectTables(
  db: DatabaseSync,
  swept: ReadonlyMap<string, readonly string[]>,
): string[] {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  return tables.filter((name) => {
    const refs = projectRefColumns(db, name);
    if (refs.length === 0) return false;
    const covered = swept.get(name);
    return !covered || refs.some((c) => !covered.includes(c));
  });
}

async function discoverDdl(): Promise<{ statements: string[]; sources: string[] }> {
  const statements = [...tenantSchemaDdl()];
  const sources: string[] = [];
  for (const file of readdirSync(APP).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
    const text = readFileSync(join(APP, file), "utf8");
    const names = [...text.matchAll(EXPORT_RE)].map((m) => m[1]);
    if (names.length === 0) {
      if (DDL_LITERAL_RE.test(stripComments(text))) expect(NO_EXPORTED_DDL_ALLOWLIST[file], `${file} creates a table without an exported *_DDL`).toBeDefined();
      continue;
    }
    const mod = (await import(pathToFileURL(join(APP, file)).href)) as Record<string, unknown>;
    for (const name of names) {
      sources.push(`${file}:${name}`);
      statements.push(...(mod[name] as string[]));
    }
  }
  return { statements, sources };
}

describe("project-scoped side tables (open-followups §204)", () => {
  it("the discovery ignores comment mentions and sees a quoted DDL literal", () => {
    expect(DDL_LITERAL_RE.test(stripComments("// SCHEMA_DDL uses `CREATE TABLE IF NOT EXISTS`\n/* CREATE TABLE x */\n"))).toBe(false);
    expect(DDL_LITERAL_RE.test(stripComments('const X = ["CREATE TABLE IF NOT EXISTS t (id TEXT)"];\n'))).toBe(true);
  });

  it("a table with a project_a / project_b pair that no sweep covers is reported (§785)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE pair_links (project_a TEXT, project_b TEXT, note TEXT)");
    db.exec("CREATE TABLE half (project_a TEXT, project_b TEXT)");
    const swept = new Map<string, readonly string[]>([["half", ["project_a"]]]);
    expect(unsweptProjectTables(db, swept).sort()).toEqual(["half", "pair_links"]);
    expect(unsweptProjectTables(db, new Map([["pair_links", ["project_a", "project_b"]], ["half", ["project_a", "project_b"]]]))).toEqual([]);
  });

  it("every table with a project-reference column is swept by a project hard delete", async () => {
    const { statements, sources } = await discoverDdl();
    const db = new DatabaseSync(":memory:");
    for (const sql of statements) db.exec(sql);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    const scoped = tables.filter((name) => projectRefColumns(db, name).length > 0);
    // TABLE_NAMES are swept by the tenant transaction (project_id); side tables by the registry, each over its own columns.
    const swept = new Map<string, readonly string[]>([
      ...TABLE_NAMES.map((n): [string, readonly string[]] => [n, ["project_id"]]),
      ...PROJECT_SCOPED_SIDE_TABLES.map((e): [string, readonly string[]] => [e.table, sideTableColumns(e)]),
    ]);
    expect(unsweptProjectTables(db, swept)).toEqual([]);
    // Anti-vacuity floors: the discovery saw real DDL, and the registry is live.
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(tables.length).toBeGreaterThanOrEqual(TABLE_NAMES.length + PROJECT_SCOPED_SIDE_TABLES.length);
    for (const entry of PROJECT_SCOPED_SIDE_TABLES) expect(scoped, entry.table).toContain(entry.table);
  });
});
