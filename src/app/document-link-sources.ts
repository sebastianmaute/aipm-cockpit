// src/app/document-link-sources.ts — the picker's inputs, derived from a Workspace.
//
// Pure and i18n-free, so the four per-kind field names below are unit-testable
// without rendering the Documents pane.
//
// ★★★ THE FOUR DISPLAY FIELDS ARE NOT UNIFORM, and guessing is the mistake this
// module exists to contain: a Task's is `taskName`, a Milestone's is `name`, and
// RaidItem/ChangeItem both use `title`. Read `types.ts` before adding a fifth
// kind — a wrong guess compiles to `undefined` and every chip renders blank.
//
// ★★ `milestones` and `changes` are OPTIONAL on `Workspace` (`tasks` and `raid`
// are not), so both reads need `?? []`. A project that never created one would
// otherwise crash the pane on `.map`.

import type { AppView } from "./nav-config";
import type { DocRefKind, DocRefLookups } from "./document-ref";
import type { DocLinkCandidate } from "./document-links-field";
import type { Workspace } from "./workspace";

/** Which view a chip's click-through navigates to, per kind. */
export const VIEW_BY_KIND: Record<DocRefKind, AppView> = {
  task: "open-points",
  milestone: "milestones",
  raid: "raid",
  change: "changes",
};

/** id → display title, per kind. Feeds `resolveDocRef`, which is the ONLY reader
 *  of a ref's stored `label` — a hit here means the live title wins. */
export function buildDocRefLookups(ws: Workspace): DocRefLookups {
  return {
    task: new Map(ws.tasks.map((x) => [x.id, x.taskName])),
    milestone: new Map((ws.milestones ?? []).map((x) => [x.id, x.name])),
    raid: new Map(ws.raid.map((x) => [x.id, x.title])),
    change: new Map((ws.changes ?? []).map((x) => [x.id, x.title])),
  };
}

/** Every linkable entity, flattened across the four kinds. Built from the same
 *  field accessors as the lookups above, so a chip and its picker option can
 *  never show different text for the same entity. */
export function buildDocLinkCandidates(ws: Workspace): DocLinkCandidate[] {
  const out: DocLinkCandidate[] = [];
  for (const x of ws.tasks) out.push({ kind: "task", id: x.id, title: x.taskName });
  for (const x of ws.milestones ?? []) out.push({ kind: "milestone", id: x.id, title: x.name });
  for (const x of ws.raid) out.push({ kind: "raid", id: x.id, title: x.title });
  for (const x of ws.changes ?? []) out.push({ kind: "change", id: x.id, title: x.title });
  return out;
}
