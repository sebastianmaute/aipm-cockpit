// src/app/person-links-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import {
  PERSON_LINKS_DDL, selectPersonLinks, upsertPersonLinkStatements, deletePersonLinkStatements, deletePersonLinksForStatements, rowsToPersonLinks,
} from "./person-links-schema";
import { loadPersonLinks, savePersonLink, deletePersonLink, deletePersonLinksFor } from "./person-links-store";
import { TABLE_NAMES, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import type { PersonLinkRow } from "./cross-project/person-match";

const row: PersonLinkRow = {
  projectA: "p-alpha", resourceA: 3, projectB: "p-beta", resourceB: 9, verdict: "same",
  firstA: "Ada", lastA: "Lovelace", firstB: "Ada", lastB: "Byron",
  decidedAt: "2026-10-31", decidedBy: "me",
};
const reversed: PersonLinkRow = {
  ...row, projectA: row.projectB, resourceA: row.resourceB, projectB: row.projectA, resourceB: row.resourceA,
  firstA: row.firstB, lastA: row.lastB, firstB: row.firstA, lastB: row.lastA,
};

function bindArg(arg: { type: string; value?: string }): string | bigint | null {
  if (arg.type === "null" || arg.value === undefined) return null;
  if (arg.type === "integer" && /^-?\d+$/.test(arg.value)) return BigInt(arg.value);
  return arg.value;
}
function run(db: DatabaseSync, stmts: readonly SqlStmt[]): void {
  for (const s of stmts) {
    if (!s.args || s.args.length === 0) db.exec(s.sql);
    else db.prepare(s.sql).run(...s.args.map(bindArg));
  }
}
function select(db: DatabaseSync): PersonLinkRow[] {
  const rows = db.prepare(selectPersonLinks()[0].sql).all() as Record<string, unknown>[];
  const cols = rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [];
  const res: PipelineResultLike = {
    type: "ok",
    response: { type: "execute", result: { cols, rows: rows.map((r) => cols.map((c) => ({ value: r[c.name] }))) } },
  };
  return rowsToPersonLinks(res);
}
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const ddl of PERSON_LINKS_DDL) db.exec(ddl);
  return db;
}

describe("person_links schema", () => {
  it("person_links is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("person_links");
  });

  it("the DDL creates the table with the binding column list", () => {
    const db = freshDb();
    const cols = (db.prepare("PRAGMA table_info(person_links)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual([
      "project_a", "resource_a", "project_b", "resource_b", "verdict", "first_a", "last_a", "first_b", "last_b",
      "decided_at", "decided_by",
    ]);
  });

  it("upsert then select round-trips a row, ids read back as numbers", () => {
    const db = freshDb();
    run(db, upsertPersonLinkStatements(row));
    const got = select(db);
    expect(got).toEqual([row]);
    expect(typeof got[0].resourceA).toBe("number");
    expect(typeof got[0].resourceB).toBe("number");
  });

  it("a row given in reverse order lands canonical with every side-specific field swapped together", () => {
    const db = freshDb();
    run(db, upsertPersonLinkStatements(reversed));
    expect(select(db)).toEqual([row]);
  });

  it("a reverse-order upsert replaces the existing row", () => {
    const db = freshDb();
    run(db, upsertPersonLinkStatements(row));
    run(db, upsertPersonLinkStatements({ ...reversed, verdict: "different" }));
    const got = select(db);
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ ...row, verdict: "different" });
  });

  it("delete removes the row whichever order the pair is given in", () => {
    const db = freshDb();
    run(db, upsertPersonLinkStatements(row));
    run(db, deletePersonLinkStatements({ projectA: "p-beta", resourceA: 9, projectB: "p-alpha", resourceB: 3 }));
    expect(select(db)).toEqual([]);
  });
});

describe("person_links delete for a person (§788)", () => {
  const mk = (pa: string, ra: number, pb: string, rb: number): PersonLinkRow => ({ ...row, projectA: pa, resourceA: ra, projectB: pb, resourceB: rb });
  const keys = (db: DatabaseSync): string[] =>
    select(db).map((r) => `${r.projectA}:${r.resourceA}|${r.projectB}:${r.resourceB}`).sort();

  it("removes the person's rows on BOTH sides; other people's rows and other projects' same-numbered ids stay", () => {
    const db = freshDb();
    run(db, upsertPersonLinkStatements(mk("p-alpha", 3, "p-beta", 9))); // 3 on side A
    run(db, upsertPersonLinkStatements(mk("p-aaa", 5, "p-alpha", 3))); // 3 on side B
    run(db, upsertPersonLinkStatements(mk("p-beta", 3, "p-gamma", 4))); // id 3 in ANOTHER project
    run(db, upsertPersonLinkStatements(mk("p-alpha", 4, "p-beta", 9))); // another person here
    run(db, deletePersonLinksForStatements("p-alpha", [3]));
    expect(keys(db)).toEqual(["p-alpha:4|p-beta:9", "p-beta:3|p-gamma:4"]);
  });

  it("removes several people in one statement list", () => {
    const db = freshDb();
    run(db, upsertPersonLinkStatements(mk("p-alpha", 3, "p-beta", 9)));
    run(db, upsertPersonLinkStatements(mk("p-alpha", 4, "p-beta", 8)));
    run(db, upsertPersonLinkStatements(mk("p-alpha", 5, "p-beta", 7)));
    run(db, deletePersonLinksForStatements("p-alpha", [3, 5]));
    expect(keys(db)).toEqual(["p-alpha:4|p-beta:8"]);
  });

  it("a list longer than one chunk still removes every id, the boundary ones included", () => {
    const db = freshDb();
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    for (const id of ids) run(db, upsertPersonLinkStatements(mk("p-alpha", id, "p-beta", 1000 + id)));
    const stmts = deletePersonLinksForStatements("p-alpha", ids);
    expect(stmts).toHaveLength(3);
    run(db, stmts);
    expect(select(db)).toEqual([]); // an off-by-one chunk slice leaves ids 200, 400 behind
  });

  it("an empty id list builds no statement", () => {
    expect(deletePersonLinksForStatements("p-alpha", [])).toEqual([]);
  });
});

describe("person_links store", () => {
  beforeEach(() => vi.mocked(runTursoPipeline).mockClear());

  it("returns empty for a null config without touching the pipeline", async () => {
    expect(await loadPersonLinks(null)).toEqual([]);
    expect(vi.mocked(runTursoPipeline)).not.toHaveBeenCalled();
  });

  it("runs the DDL ahead of each call", async () => {
    await loadPersonLinks({} as never);
    await savePersonLink({} as never, row);
    await deletePersonLink({} as never, row);
    await deletePersonLinksFor({} as never, "p-alpha", [3]);
    for (const call of vi.mocked(runTursoPipeline).mock.calls) {
      expect(call[1][0].sql).toMatch(/CREATE TABLE IF NOT EXISTS person_links/);
    }
    expect(vi.mocked(runTursoPipeline)).toHaveBeenCalledTimes(4);
  });

  it("deletePersonLinksFor with no ids or no config never touches the pipeline", async () => {
    vi.mocked(runTursoPipeline).mockClear();
    await deletePersonLinksFor({} as never, "p-alpha", []);
    await deletePersonLinksFor(null, "p-alpha", [3]);
    expect(vi.mocked(runTursoPipeline)).not.toHaveBeenCalled();
  });
});
