// src/app/version-diff.ts
// Pure diff between two Workspace snapshots, driven by a collection registry.
// List collections are matched by numeric id; singletons are compared as one
// object. Field changes exclude bookkeeping noise (localModifiedAt). The result
// powers the read-only compare view and (Slice 3) selective restore.

import type { Workspace } from "./workspace";

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
}

interface CollectionSpec { key: keyof Workspace; label: string; kind: "list" | "singleton"; nameField?: string; }

export const COLLECTION_SPECS: CollectionSpec[] = [
  { key: "tasks", label: "Tasks", kind: "list", nameField: "title" },
  { key: "raid", label: "RAID", kind: "list", nameField: "title" },
  { key: "changes", label: "Changes", kind: "list", nameField: "title" },
  { key: "milestones", label: "Milestones", kind: "list", nameField: "name" },
  { key: "stakeholders", label: "Stakeholders", kind: "list", nameField: "name" },
  { key: "resources", label: "Resources", kind: "list", nameField: "name" },
  { key: "roles", label: "Roles", kind: "list", nameField: "name" },
  { key: "disciplines", label: "Disciplines", kind: "list", nameField: "name" },
  { key: "grades", label: "Grades", kind: "list", nameField: "name" },
  { key: "budgets", label: "Budget buckets", kind: "list", nameField: "name" },
  { key: "absences", label: "Absences", kind: "list", nameField: "reason" },
  { key: "shifts", label: "Shifts", kind: "list", nameField: "label" },
  { key: "plan", label: "Resource plan", kind: "singleton" },
  { key: "status", label: "Project status", kind: "singleton" },
  { key: "project", label: "Project info", kind: "singleton" },
  { key: "fxRates", label: "FX rates", kind: "singleton" },
  { key: "steeringCommittee", label: "Steering committee", kind: "singleton" },
  { key: "timelogLinks", label: "TimeLog links", kind: "singleton" },
  // ★★★ `knowledgeItems` and `insights` are DELIBERATELY ABSENT, and adding
  //   them back is a data-loss bug, not a feature. Both are ARRAYS on
  //   `Workspace`; a "singleton" spec routes the key through
  //   `version-restore.ts`'s `mergeFields`, whose `{ ...target }` turns the
  //   array into an object with numeric keys. `workspaceToJson` then gates the
  //   slice on `.length` — `undefined` on an object — so the key is omitted and
  //   all six write paths drop the slice on the next save. They sat here
  //   harmlessly only while `getVersionPayload` emitted neither one; the moment
  //   it emitted all 24 slices, `history-panel`'s plain Restore button (which
  //   auto-selects EVERY change) could reach them. Absent from this list they
  //   are carried through a restore from the LIVE workspace, exactly like
  //   `documents` / `documentVersions` / `calendarEvents` already are — the
  //   capture still records all 24 slices. Making them genuinely restorable
  //   needs a `kind: "list"` model and is tracked in `docs/open-followups.md`.
  //   Pinned by `version-restore.test.ts`'s array-typed-slice tests.
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
function recordLabel(rec: Record<string, unknown> | undefined, id: RecordId, nameField?: string): string {
  const name = nameField ? rec?.[nameField] : undefined;
  return typeof name === "string" && name.trim() ? name : `#${id}`;
}
function diffList(spec: CollectionSpec, older: unknown[], newer: unknown[]): VersionChange[] {
  const byId = (arr: unknown[]) => new Map<RecordId, Record<string, unknown>>(
    arr.map((r) => [(r as { id: RecordId }).id, r as Record<string, unknown>]),
  );
  const a = byId(older ?? []);
  const b = byId(newer ?? []);
  const out: VersionChange[] = [];
  const base = (id: RecordId, rec: Record<string, unknown> | undefined, type: ChangeType, fields: FieldChange[]): VersionChange => ({
    collection: spec.key, collectionLabel: spec.label, kind: "list",
    recordId: id, recordLabel: recordLabel(rec, id, spec.nameField), type, fields,
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
  return [{ collection: spec.key, collectionLabel: spec.label, kind: "singleton", recordId: null, recordLabel: spec.label, type: "modified", fields }];
}

export function diffWorkspaces(older: Workspace, newer: Workspace): VersionChange[] {
  const out: VersionChange[] = [];
  for (const spec of COLLECTION_SPECS) {
    if (spec.kind === "list") out.push(...diffList(spec, older[spec.key] as unknown[], newer[spec.key] as unknown[]));
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
