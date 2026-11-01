// src/app/person-links-schema.ts — pure SQL builders + row decoder for the
// GLOBAL person_links table: "same person" / "not the same person" answers
// that span projects (§785). MUST stay OUT of turso-schema's TABLE_NAMES (guard
// test in person-links-store.test.ts) so a workspace save's per-table DELETE
// never touches it. Mirrors chat-threads-schema.ts.
import { rowObjects, txt, int, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import { canonicalPair, type PersonLinkRow } from "./cross-project/person-match";

export const PERSON_LINKS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS person_links (project_a TEXT, resource_a INTEGER, project_b TEXT, resource_b INTEGER, verdict TEXT, first_a TEXT, last_a TEXT, first_b TEXT, last_b TEXT, decided_at TEXT, decided_by TEXT, PRIMARY KEY (project_a, resource_a, project_b, resource_b))`,
];

export interface PersonLinkPair {
  projectA: string;
  resourceA: number;
  projectB: string;
  resourceB: number;
}

export const selectPersonLinks = (): SqlStmt[] => [{ sql: `SELECT * FROM person_links` }];

/** Put a row into canonical order (`projectA <= projectB`), swapping EVERY
 *  side-specific field together so each side's names and emails stay attached
 *  to its own resource. */
export function canonicalRow(row: PersonLinkRow): PersonLinkRow {
  const c = canonicalPair(row.projectA, row.resourceA, row.projectB, row.resourceB);
  if (c.projectA === row.projectA && c.resourceA === row.resourceA) return row;
  return {
    ...row,
    ...c,
    firstA: row.firstB, lastA: row.lastB,
    firstB: row.firstA, lastB: row.lastA,
  };
}

/** One atomic `INSERT OR REPLACE` (see chat-threads-schema for why not delete+insert). */
export function upsertPersonLinkStatements(row: PersonLinkRow): SqlStmt[] {
  const c = canonicalRow(row);
  return [
    {
      sql: `INSERT OR REPLACE INTO person_links (project_a,resource_a,project_b,resource_b,verdict,first_a,last_a,first_b,last_b,decided_at,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        txt(c.projectA), int(c.resourceA), txt(c.projectB), int(c.resourceB), txt(c.verdict),
        txt(c.firstA), txt(c.lastA), txt(c.firstB), txt(c.lastB),
        txt(c.decidedAt), txt(c.decidedBy),
      ],
    },
  ];
}

export function deletePersonLinkStatements(pair: PersonLinkPair): SqlStmt[] {
  const c = canonicalPair(pair.projectA, pair.resourceA, pair.projectB, pair.resourceB);
  return [
    {
      sql: `DELETE FROM person_links WHERE project_a = ? AND resource_a = ? AND project_b = ? AND resource_b = ?`,
      args: [txt(c.projectA), int(c.resourceA), txt(c.projectB), int(c.resourceB)],
    },
  ];
}

export function rowsToPersonLinks(res: PipelineResultLike | undefined): PersonLinkRow[] {
  return rowObjects(res)
    .filter((r) => (r.verdict === "same" || r.verdict === "different") && r.project_a && r.project_b)
    .map((r): PersonLinkRow => ({
      projectA: r.project_a,
      resourceA: Number(r.resource_a),
      projectB: r.project_b,
      resourceB: Number(r.resource_b),
      verdict: r.verdict as PersonLinkRow["verdict"],
      firstA: r.first_a ?? "", lastA: r.last_a ?? "",
      firstB: r.first_b ?? "", lastB: r.last_b ?? "",
      decidedAt: r.decided_at ?? "", decidedBy: r.decided_by ?? "",
    }));
}
