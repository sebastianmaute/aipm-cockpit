// src/app/version-diff.ts
// Pure diff between two Workspace snapshots, driven by a collection registry.
// List collections are matched by numeric id; singletons are compared as one
// object. Field changes exclude bookkeeping noise (localModifiedAt). The result
// powers the read-only compare view and (Slice 3) selective restore.

import type { Workspace } from "./workspace";
import { PRE_FORMAT_2_BLIND_SLICES } from "./version-capture-format";
import { resourceDisplayName, roleLabel } from "./resource-foundation";

export type ChangeType = "added" | "removed" | "modified";

/** A list record's id. Almost every slice mints numbers; `knowledgeItems` ids are
 *  strings (a Graph driveItem id, or a generated one for manual entries), so the
 *  diff must carry both without coercing either. Never do arithmetic on this. */
export type RecordId = number | string;

export interface FieldChange { field: string; label: string; before: unknown; after: unknown; }

export interface VersionChange {
  collection: string;
  collectionLabel: string;
  kind: "list" | "singleton";
  recordId: RecordId | null;
  recordLabel: string;
  type: ChangeType;
  fields: FieldChange[];
  /** Mirrors the spec's flag so a renderer can tell an informational row from a
   *  revertible one without importing the registry. */
  restorable?: false;
}

/** THE one reading of a CHANGE's `restorable` flag. ★ A layout forgetting one
 *  of its two gates is named in `docs/open-followups.md` §256 as a way to
 *  re-open the defect this closes.
 *  ★ `applyRestore` deliberately does NOT use this — it gates on the SPEC
 *  (`spec.restorable === false`), not the change, and the two readings are
 *  different facts that must not be collapsed. `diffSingleton`'s comment carries
 *  why. */
export function isRestorableChange(c: Pick<VersionChange, "restorable">): boolean {
  return c.restorable !== false;
}

// ★ `diffList` holds records as `Record<string, unknown>`. These narrow a field
// to the primitive a label helper expects WITHOUT a cast — a cast here would
// re-admit exactly the class this repair exists to close: a spec naming a field
// the record does not carry, invisible to tsc.
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : -1);

/** Compose a record's label when a single field cannot express it. Receives the
 *  workspace the record came from — the OLDER one for a removed record, the
 *  NEWER one otherwise — because a role names itself through `disciplines` and
 *  `grades`, which is a cross-slice lookup a bare `nameField` cannot do. */
type RecordNameOf = (rec: Record<string, unknown>, ws: Workspace) => string;

/** ★★★ `nameField` IS A BARE STRING WHILE `key` IS `keyof Workspace`, so tsc
 *  cannot pair the two and a row naming a field its records do not carry is
 *  invisible. Five of them shipped that way — `tasks`/`title`,
 *  `resources`/`name`, `roles`/`name`, `absences`/`reason`, `shifts`/`label` —
 *  and `recordLabel`'s `#${id}` fallback is the ONLY symptom. Pinned by
 *  version-diff.test.ts's "never falls back to #id for a fully-populated
 *  record"; add a row here and seed it in `arraysFixture` or that guard is
 *  silent about it.
 *  Omitted `restorable` = restorable. `false` = diff-visible but `applyRestore`
 *  SKIPS it, because the slice owns its own history elsewhere and must keep a
 *  single writer. The diff row is still required: the diff is what arms a
 *  capture, so without one a session editing only this slice produces NO
 *  version. */
interface CollectionSpec {
  key: keyof Workspace; label: string; kind: "list" | "singleton";
  nameField?: string; nameOf?: RecordNameOf; restorable?: false;
}

export const COLLECTION_SPECS: CollectionSpec[] = [
  { key: "tasks", label: "Tasks", kind: "list", nameField: "taskName" },
  { key: "raid", label: "RAID", kind: "list", nameField: "title" },
  { key: "changes", label: "Changes", kind: "list", nameField: "title" },
  { key: "milestones", label: "Milestones", kind: "list", nameField: "name" },
  { key: "stakeholders", label: "Stakeholders", kind: "list", nameField: "name" },
  { key: "resources", label: "Resources", kind: "list",
    nameOf: (r) => resourceDisplayName({ firstName: str(r.firstName), lastName: str(r.lastName) }) },
  // ★ `num`'s `-1` is deliberate: no minted id is negative, so an unresolvable
  // discipline or grade misses the lookup and `roleLabel` returns "n/a n/a",
  // which `recordLabel` then treats as a real name. That is honest — the record
  // genuinely has no resolvable role — and matches what the Resources report
  // shows for the same case.
  { key: "roles", label: "Roles", kind: "list",
    nameOf: (r, ws) => roleLabel({ disciplineId: num(r.disciplineId), gradeId: num(r.gradeId) },
                                 ws.disciplines, ws.grades) },
  { key: "disciplines", label: "Disciplines", kind: "list", nameField: "name" },
  { key: "grades", label: "Grades", kind: "list", nameField: "name" },
  { key: "budgets", label: "Budget buckets", kind: "list", nameField: "name" },
  // ★★ `note` is OPTIONAL on both while `assignee` is REQUIRED, so naming these
  //  by `note` alone left a record with no note reading `#id` while every other
  //  absence surface in the app names it by person. That is the same shape as
  //  the five repairs above — a non-identifying field chosen over an
  //  identifying one — so `note` stays the PREFERRED label (it is what a user
  //  wrote about this row) with `assignee` as the fallback that guarantees one.
  // ★★ THE FALLBACK CARRIES THE DATE, and dropping it re-introduces a DIFFERENT
  //  defect than the one above. `recordLabel` is rendered BARE
  //  (`version-diff-view.tsx`); `buildRowTokens` occurrence-indexes the
  //  aria-labels ONLY. So `assignee` alone would render two note-less absences
  //  by the same person as two visually IDENTICAL rows, where the `#id` this
  //  replaces was at least distinct. `startDate` is required on `Absence`, so
  //  person+date is always AVAILABLE. ★ It is not always UNIQUE — two untitled
  //  absences for one person STARTING THE SAME DAY still collide, and no field
  //  on the record separates them. That is a narrower residue than the one this
  //  closes, not its elimination.
  { key: "absences", label: "Absences", kind: "list",
    nameOf: (r) => str(r.note).trim()
      || [str(r.assignee), str(r.startDate)].filter(Boolean).join(" · ") },
  // ★ `Shift` carries NO date — it is a weekday-hours pattern — so there is no
  //  second field to qualify it with and this one stays bare. Two note-less
  //  shifts for the SAME person would still collide visually; that is a data
  //  anomaly (a shift is a person's working pattern), and AT users are covered
  //  by the row tokens either way. Recorded rather than silently accepted.
  { key: "shifts", label: "Shifts", kind: "list",
    nameOf: (r) => str(r.note).trim() || str(r.assignee) },
  { key: "plan", label: "Resource plan", kind: "singleton" },
  { key: "status", label: "Project status", kind: "singleton" },
  { key: "project", label: "Project info", kind: "singleton" },
  { key: "fxRates", label: "FX rates", kind: "singleton" },
  { key: "steeringCommittee", label: "Steering committee", kind: "singleton" },
  { key: "timelogLinks", label: "TimeLog links", kind: "singleton" },
  // ★★★ AN ARRAY SLICE TAKES `kind: "list"`. NEVER `"singleton"` — that is a
  //   silent data-loss bug, not a style choice. A singleton spec routes the key
  //   through `version-restore.ts`'s `mergeFields`, whose `{ ...target }` turns
  //   the array into an OBJECT with numeric keys. `workspaceToJson` then gates
  //   the slice on `.length` — `undefined` on an object — so the key is omitted
  //   and all six write paths drop the slice on the next save, permanently.
  //   It shipped exactly once, when `getVersionPayload` grew to emit all 24
  //   slices and `history-panel`'s Restore button (which auto-selects EVERY
  //   change) could finally reach two mis-declared rows.
  //   Pinned by `version-restore.test.ts`'s "turns no array-typed slice of the
  //   workspace into an object", whose diagnostic NAMES the offending slice.
  //   ★★ THAT TEST IS NOT GENERIC OVER THIS REGISTRY — measured by mutation,
  //   not reasoned. THREE conditions must ALL hold before it can see a slice,
  //   and an earlier revision of this comment listed only the first two:
  //     1. its own `arrays()` fixture POPULATES the slice, *and*
  //     2. the slice CHANGES between the two workspaces — `applyRestore`'s
  //        singleton branch bails on a slice with no diff change, so an
  //        empty-in-both slice is never corrupted and there is nothing to
  //        detect. Flipping `milestones` (registered, empty in both fixtures)
  //        to `"singleton"` left the test GREEN; the identical edit to
  //        `calendarEvents` (populated, and differing) turned it RED, naming
  //        the slice. *and*
  //     3. the slice is RESTORABLE. `applyRestore` hits
  //        `if (spec.restorable === false) continue;` BEFORE the kind branch,
  //        so a `restorable: false` row can never reach `mergeFields` at all.
  //        Measured: flipping `documents` — populated AND differing, so 1 and 2
  //        both hold — to `"singleton"` left the test GREEN.
  //   SO: adding an array row to that fixture buys coverage only for a
  //   RESTORABLE row. For a `restorable: false` one it buys NOTHING, and there
  //   is nothing to buy — the kind is unreachable for it. Declare the kind
  //   correctly anyway: the flag is not a type, and dropping it later would
  //   arm the bug with no test in sight.
  { key: "knowledgeItems", label: "Knowledge", kind: "list", nameField: "name" },
  { key: "insights", label: "Insights", kind: "list", nameField: "key" },
  { key: "calendarEvents", label: "Calendar events", kind: "list", nameField: "title" },
  // ★★ DIFF-VISIBLE, NOT RESTORABLE — see the `restorable` docstring on
  // CollectionSpec. `applyDocMutation` owns document history (before-images,
  // tombstones, retention: docs/AGENTS/documents.md); a workspace-level restore
  // would bypass it, minting no before-image while rewriting documentVersions
  // underneath, so one document would have two histories and two writers. The
  // row still has to exist: without it a documents-only session produces an
  // empty diff and `writeVersion` captures NOTHING.
  { key: "documents", label: "Documents", kind: "list", nameField: "title", restorable: false },
  { key: "documentVersions", label: "Document versions", kind: "list", restorable: false },
  { key: "settingsOverrides", label: "Project overrides", kind: "singleton" },
];

const IGNORED_FIELDS = new Set(["localModifiedAt"]);

function humanize(field: string): string {
  const s = field.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function eq(a: unknown, b: unknown): boolean { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (!eq(before?.[k], after?.[k])) out.push({ field: k, label: humanize(k), before: before?.[k], after: after?.[k] });
  }
  return out;
}
/** ★★ `nameOf` takes precedence over `nameField` but FALLS THROUGH to it on a
 *  blank result — and NO SPEC EXERCISES THAT FALL-THROUGH TODAY. Two successive
 *  revisions of this docstring claimed one did, each naming a different pair, so
 *  the claim is worth stating in the negative: every `nameOf` spec carries no
 *  `nameField`. A blank result ends at `#id` rather than at an empty string,
 *  which is the property that matters, and it reaches `#id` directly.
 *  ★ Settle it by READING `COLLECTION_SPECS` above, not by grepping the two
 *  field names: a row declaring both puts them on different LINES, so a
 *  line-number comparison reports "disjoint" either way and cannot see the
 *  state this paragraph denies. */
function recordLabel(
  rec: Record<string, unknown> | undefined,
  id: RecordId,
  spec: CollectionSpec,
  ws: Workspace,
): string {
  const composed = rec && spec.nameOf ? spec.nameOf(rec, ws) : undefined;
  if (typeof composed === "string" && composed.trim()) return composed;
  const name = spec.nameField ? rec?.[spec.nameField] : undefined;
  return typeof name === "string" && name.trim() ? name : `#${id}`;
}
function diffList(
  spec: CollectionSpec, older: unknown[], newer: unknown[],
  olderWs: Workspace, newerWs: Workspace,
): VersionChange[] {
  const byId = (arr: unknown[]) => new Map<RecordId, Record<string, unknown>>(
    arr.map((r) => [(r as { id: RecordId }).id, r as Record<string, unknown>]),
  );
  const a = byId(older ?? []);
  const b = byId(newer ?? []);
  const out: VersionChange[] = [];
  const base = (id: RecordId, rec: Record<string, unknown> | undefined, type: ChangeType, fields: FieldChange[]): VersionChange => ({
    collection: spec.key, collectionLabel: spec.label, kind: "list",
    recordId: id, recordLabel: recordLabel(rec, id, spec, type === "removed" ? olderWs : newerWs), type, fields,
    ...(spec.restorable === false ? { restorable: false as const } : {}),
  });
  for (const [id, rec] of b) {
    if (!a.has(id)) out.push(base(id, rec, "added", fieldChanges({}, rec)));
    else { const fields = fieldChanges(a.get(id)!, rec); if (fields.length) out.push(base(id, rec, "modified", fields)); }
  }
  for (const [id, rec] of a) { if (!b.has(id)) out.push(base(id, rec, "removed", fieldChanges(rec, {}))); }
  return out;
}
function diffSingleton(spec: CollectionSpec, older: unknown, newer: unknown): VersionChange[] {
  const fields = fieldChanges((older ?? {}) as Record<string, unknown>, (newer ?? {}) as Record<string, unknown>);
  if (!fields.length) return [];
  // ★★ THE SAME CLAUSE `diffList`'s `base()` carries, and it must stay in step.
  // `applyRestore` gates on the SPEC (`spec.restorable === false`), while
  // `VersionDiffView` and `selectableSelection` gate on the CHANGE
  // (`c.restorable === false`) — two readings of one fact. Drop it here and a
  // `{ kind: "singleton", restorable: false }` spec would be SKIPPED by the
  // restore while the UI rendered it a checkbox and a "Restore this" button and
  // the selection carried its key: exactly the silent no-op the flag exists to
  // remove. Unreachable today (no singleton declares it), which is why it went
  // missing unnoticed — pinned by version-diff.test.ts's synthetic spec.
  return [{
    collection: spec.key, collectionLabel: spec.label, kind: "singleton",
    recordId: null, recordLabel: spec.label, type: "modified", fields,
    ...(spec.restorable === false ? { restorable: false as const } : {}),
  }];
}

/** ★★★ `olderSpeaksForEmptySlices` — pass `speaksForEmptySlices(readCaptureFormat(payload))`
 *  for the OLDER side whenever it came from a stored capture. It defaults to
 *  FALSE, which is the safe reading and the correct one for every caller that
 *  cannot know (a synthetic workspace in a test, a caller yet to be threaded).
 *  ★★ WHY THE SUPPRESSION LIVES HERE AND NOT ONLY IN `applyRestore`: a row the
 *  restore will refuse to act on must never be OFFERED. `applyRestore` skipping
 *  a slice is invisible to the UI — the row still renders a checkbox and a
 *  "Restore this" button, `selectableSelection` includes it, the empty-selection
 *  toast does not fire, and `restore()` returns `true` and logs
 *  "Restored N change(s)" for a restore that changed nothing. Emitting no row is
 *  the only version of this that cannot lie: a capture that cannot speak about a
 *  slice has no opinion to show. The guard in `applyRestore` then becomes
 *  defence in depth rather than the whole mechanism. */
export function diffWorkspaces(
  older: Workspace,
  newer: Workspace,
  opts?: { olderSpeaksForEmptySlices?: boolean },
): VersionChange[] {
  const out: VersionChange[] = [];
  const blind = !opts?.olderSpeaksForEmptySlices;
  for (const spec of COLLECTION_SPECS) {
    if (blind && PRE_FORMAT_2_BLIND_SLICES.has(spec.key) && older[spec.key] === undefined) continue;
    if (spec.kind === "list") out.push(...diffList(spec, older[spec.key] as unknown[], newer[spec.key] as unknown[], older, newer));
    else out.push(...diffSingleton(spec, older[spec.key], newer[spec.key]));
  }
  return out;
}

export function summarizeDiff(changes: VersionChange[]): string {
  if (!changes.length) return "";
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.collectionLabel, (counts.get(c.collectionLabel) ?? 0) + 1);
  return [...counts.entries()].map(([label, n]) => `${label} (${n})`).join(", ");
}
