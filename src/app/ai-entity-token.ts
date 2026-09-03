// src/app/ai-entity-token.ts
// Optimistic-concurrency tokens for the AI write path. Pure: no React, no DOM,
// no i18n.
//
// ★★★ THE TOKEN IS DERIVED, NOT STAMPED, AND THAT IS THE WHOLE POINT. The
// obvious alternative is `Task.localModifiedAt` ("used for sync conflict
// detection"), and it was rejected: a stamp is only as good as the set of
// writers that set it, and a write path that forgets to stamp leaves the field
// UNCHANGED after a human edit. The guard then compares two identical values,
// concludes nothing moved, and permits the very overwrite it exists to stop —
// a false PERMIT, the dangerous direction. Measured 2026-09-03 at 68 stamp
// sites across 27 non-test files against 45 `setTasks(` call sites across 17,
// for tasks alone, one of six AI-updatable entities. Deriving from the
// entity's own content makes any change by any writer visible by construction,
// including write paths added years from now.
//
// ★★ IT RIDES THE BYTE-STABLE CSV SERIALIZERS ON PURPOSE. `golden-workspace.test`
// pins their exact output, so a silent change to what they emit fails CI. That
// is the property this module borrows; do not reimplement the projection.
import {
  CSV_COLUMNS, fieldToString,
  RAID_CSV_COLUMNS, raidFieldToString,
  MILESTONES_CSV_COLUMNS, milestoneFieldToString,
  CHANGES_CSV_COLUMNS, changeFieldToString,
  STAKEHOLDERS_CSV_COLUMNS, stakeholderFieldToString,
  RESOURCES_CSV_COLUMNS, resourceFieldToString,
} from "./csv-codecs-core";

export type TokenEntity =
  | "task" | "raid" | "milestone" | "change" | "stakeholder" | "resource";

/** Columns deliberately OUTSIDE the token, per entity.
 *
 *  ★★★ A FIELD MAY BE EXCLUDED ONLY IF NO AI TOOL CAN WRITE IT. Excluding a
 *  writable field reintroduces a false permit for exactly that field — two
 *  writers could both change it with neither detected. This is not a
 *  convention to remember: `ai-entity-token.test.ts` asserts the exclusion set
 *  is disjoint from the AI-writable field set, so adding a tool that writes an
 *  excluded field turns that test red.
 *
 *  Each entry is bookkeeping that moves without anyone editing the substance
 *  the model is acting on:
 *    localModifiedAt  self-referential — including it makes this the stamp
 *                     approach the header rejects
 *    lastSyncedAt     Jira sync bookkeeping
 *    outlookEventId   calendar write-back bookkeeping
 *    inquiriesSent    a counter bumped by sending a status inquiry
 *    noteLog          a dated append; adding a note does not invalidate an
 *                     edit to other fields */
export const TOKEN_EXCLUDED: Readonly<Record<TokenEntity, readonly string[]>> = {
  task: ["localModifiedAt", "lastSyncedAt", "outlookEventId", "inquiriesSent", "noteLog"],
  raid: ["localModifiedAt", "outlookEventId", "inquiriesSent", "noteLog"],
  milestone: ["localModifiedAt", "outlookEventId"],
  change: ["localModifiedAt", "outlookEventId", "noteLog"],
  stakeholder: ["localModifiedAt"],
  resource: ["localModifiedAt"],
};

type Projector = {
  columns: readonly string[];
  render: (entity: never, column: never) => string;
};

const PROJECTORS: Readonly<Record<TokenEntity, Projector>> = {
  task: { columns: CSV_COLUMNS as readonly string[], render: fieldToString as Projector["render"] },
  raid: { columns: RAID_CSV_COLUMNS as readonly string[], render: raidFieldToString as Projector["render"] },
  milestone: { columns: MILESTONES_CSV_COLUMNS as readonly string[], render: milestoneFieldToString as Projector["render"] },
  change: { columns: CHANGES_CSV_COLUMNS as readonly string[], render: changeFieldToString as Projector["render"] },
  stakeholder: { columns: STAKEHOLDERS_CSV_COLUMNS as readonly string[], render: stakeholderFieldToString as Projector["render"] },
  resource: { columns: RESOURCES_CSV_COLUMNS as readonly string[], render: resourceFieldToString as Projector["render"] },
};

/** Two independent FNV-1a passes over the same bytes, emitted as one string.
 *
 *  ★★ NOT CRYPTOGRAPHIC, AND IT DOES NOT NEED TO BE — this detects concurrent
 *  edits, it does not resist an attacker; both versions of the record come from
 *  the same trusted store. It IS sync, which `crypto.subtle` is not, and the
 *  token has to be produced inside a synchronous tool dispatch.
 *  ★★ TWO passes with different offsets rather than one: a single 32-bit hash
 *  collides often enough to matter across a long session, and a collision here
 *  is a false PERMIT. Two passes make the effective width 64 bits. */
function hash(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The concurrency token for one entity. Equal tokens mean no covered field
 *  changed; different tokens mean at least one did. */
export function entityToken(kind: TokenEntity, entity: object): string {
  const { columns, render } = PROJECTORS[kind];
  const excluded = new Set(TOKEN_EXCLUDED[kind]);
  const parts: string[] = [];
  for (const column of columns) {
    if (excluded.has(column)) continue;
    // The column name rides along so a value moving BETWEEN columns cannot
    // leave the concatenation unchanged.
    parts.push(column + " " + (render as (e: object, c: string) => string)(entity, column));
  }
  return hash(parts.join(""));
}
