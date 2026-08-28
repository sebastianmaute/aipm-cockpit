// src/app/workspace-metrics.ts
//
// Pure record-counting helpers over a Workspace: the empty-workspace guard
// and the Layer-B mass-deletion invariant. Extracted from workspace.ts when
// that file crossed the 800-line file-size ratchet — re-exported from there
// unchanged, so every existing `from "./workspace"` import of these names
// keeps working.

import type { Workspace } from "./workspace";

/** True when a workspace holds NO user records in any collection (a default
 *  plan / empty config does not count). Guards a reload from silently replacing
 *  a populated project with an empty backend read — a real data-loss vector. */
export function isWorkspaceEmpty(ws: Workspace): boolean {
  return (ws.tasks?.length ?? 0) === 0
    && (ws.raid?.length ?? 0) === 0
    && (ws.absences?.length ?? 0) === 0
    && (ws.shifts?.length ?? 0) === 0
    && (ws.resources?.length ?? 0) === 0
    && (ws.roles?.length ?? 0) === 0
    && (ws.disciplines?.length ?? 0) === 0
    && (ws.grades?.length ?? 0) === 0
    && (ws.budgets?.length ?? 0) === 0
    && (ws.milestones?.length ?? 0) === 0
    && (ws.changes?.length ?? 0) === 0
    && (ws.stakeholders?.length ?? 0) === 0
    && (ws.calendarEvents?.length ?? 0) === 0
    // ★★ documents belongs here even though the other JSON-blob slices
    //    (insights, knowledgeItems, timelogLinks) do NOT. This feeds the LOAD
    //    guard, which refuses an incoming empty workspace only when the current
    //    one is non-empty. "Only documents" is an ordinary state — someone
    //    drafting a charter before entering any task — and without this a
    //    transient empty read applies, wipes them, and autosave persists it.
    //    ★ documents is NOW counted by nonEmptyCollectionCount /
    //    workspaceRecordCount too — read the rule block on those two below.
    //    It was held back while §98 was open, because widening the SAVE-time
    //    thresholds changes when saves are REFUSED for every existing project;
    //    that is now done, with the destructive-save bypass armed on the
    //    delete path so a legitimate delete is still allowed through.
    && (ws.documents?.length ?? 0) === 0
    && (ws.documentVersions?.length ?? 0) === 0;
    // ★★★ activityLog is deliberately ABSENT here, INVERTING the documents rule
    //     directly above. The log is auto-appended by ordinary use, so counting
    //     it would make a workspace with log entries and NO user records read as
    //     non-empty — slipping past this guard and letting a transient empty
    //     backend read replace a populated project. That converts a data-loss
    //     guard into a data-loss vector. Pinned by workspace.test.ts
    //     ("ONLY activity entries is still EMPTY"). Do not "complete" the
    //     documents precedent by adding it.
    //     Same reasoning keeps it out of nonEmptyCollectionCount /
    //     workspaceRecordCount (SAVE-time mass-deletion thresholds, §98).
}

/** ★★★ WHICH SLICES COUNT, AND WHY THE EXCLUSIONS ARE LOAD-BEARING.
 *
 *  THE RULE: a slice counts toward these SAVE-time guards iff it holds
 *  user-authored records that cannot be regenerated, AND its size is not driven
 *  by automatic append.
 *
 *  COUNTED beyond the thirteen entity collections: documents, knowledgeItems,
 *  documentAssets — all user-authored and unrecoverable.
 *
 *  NOT COUNTED, each for a reason that would break a guard if ignored:
 *   - activityLog: auto-appended by ordinary use. Counting it here means
 *     nonEmptyCollectionCount can never reach 0 in a project that has ever been
 *     used, and reaching 0 is L3's entire trigger — the full-wipe guard would be
 *     dead for good. isWorkspaceEmpty documents the identical inversion for
 *     itself and warns against "completing" the documents precedent.
 *   - documentVersions: auto-captured and pruned by retention, so counting it
 *     would make an ordinary prune read as a mass deletion and refuse a
 *     legitimate save.
 *   - insights: derived by detection, regenerable.
 *   - features: config, not records.
 *
 *  Every line of this is pinned by is-workspace-empty.test.ts, in both
 *  directions — each exclusion was mutation-checked, so adding one of these
 *  slices to a counter turns that exclusion's test red. A NEW slice is caught
 *  by workspace-slice-policy.test.ts, which parses the Workspace type and fails
 *  when a slice has no recorded decision in workspace-slice-policy.ts — the
 *  registry of these decisions, which does NOT drive the counters below.
 *  See docs/open-followups.md §98. */

/** Number of user collections that hold at least one record. Used by the
 *  persistence-layer data-loss guard to tell a MULTI-collection simultaneous
 *  wipe (the applyWorkspace(empty) bug signature) from an incremental single-
 *  collection user delete/clear. */
export function nonEmptyCollectionCount(ws: Workspace): number {
  let n = 0;
  if (ws.tasks?.length) n++;
  if (ws.raid?.length) n++;
  if (ws.absences?.length) n++;
  if (ws.shifts?.length) n++;
  if (ws.resources?.length) n++;
  if (ws.roles?.length) n++;
  if (ws.disciplines?.length) n++;
  if (ws.grades?.length) n++;
  if (ws.budgets?.length) n++;
  if (ws.milestones?.length) n++;
  if (ws.changes?.length) n++;
  if (ws.stakeholders?.length) n++;
  if (ws.calendarEvents?.length) n++;
  if (ws.documents?.length) n++;
  if (ws.knowledgeItems?.length) n++;
  if (ws.documentAssets?.length) n++;
  return n;
}

/** Total user records across all collections. Drives the Layer-B save invariant
 *  that refuses an unexplained MASS deletion (a large fraction lost in one save). */
export function workspaceRecordCount(ws: Workspace): number {
  return (ws.tasks?.length ?? 0)
    + (ws.raid?.length ?? 0)
    + (ws.absences?.length ?? 0)
    + (ws.shifts?.length ?? 0)
    + (ws.resources?.length ?? 0)
    + (ws.roles?.length ?? 0)
    + (ws.disciplines?.length ?? 0)
    + (ws.grades?.length ?? 0)
    + (ws.budgets?.length ?? 0)
    + (ws.milestones?.length ?? 0)
    + (ws.changes?.length ?? 0)
    + (ws.stakeholders?.length ?? 0)
    + (ws.calendarEvents?.length ?? 0)
    + (ws.documents?.length ?? 0)
    + (ws.knowledgeItems?.length ?? 0)
    + (ws.documentAssets?.length ?? 0);
}

/** Layer-B invariant: is this save an unexplained MASS deletion? True when it
 *  removes at least `floor` records AND leaves ≤ `fraction` of the previous
 *  total — the "lost almost everything in one step" signature. Normal edits
 *  (remove a few) and moderate bulk deletes are NOT flagged. `prev`/`cur` are
 *  total record counts. */
export function isMassDeletion(prev: number, cur: number, floor = 5, fraction = 0.1): boolean {
  if (cur >= prev) return false;
  return (prev - cur) >= floor && cur <= prev * fraction;
}
