# Version History — Slice 2 (Diff Engine & Compare UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare any two project versions (or a version vs. the current state) field-by-field, with a read-only diff view, and enrich the capture timeline with change summaries. Selective restore comes in Slice 3.

**Architecture:** A pure `version-diff.ts` diffs two `Workspace` objects via an entity registry (list collections matched by `id`; singletons compared whole), producing per-record added/removed/modified changes with field-level before/after. The history hook gains a `loadDiff(from, to)` that loads payloads, parses them with `jsonToWorkspace`, and runs the diff. A `version-diff-view.tsx` renders the result; the history panel gains a 1-or-2 version selection model. Capture summaries are backfilled from the diff.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL, Tailwind (AIPM palette).

**Spec:** `docs/superpowers/specs/2026-06-11-version-history-design.md`. **Branch:** `feat-version-history-slice2` (already created). Do NOT edit `eslint.config.mjs`.

**Scope of THIS slice:** the diff engine + read-only compare UI (vs-now and vs-version) + diff-derived capture summaries. OUT of scope: selective restore + restore controls/checkboxes (Slice 3), the retention Settings stepper + `history` feature-module (Slice 4).

**Builds on Slice 1 (already merged):** `version-history.ts` (`ProjectVersion`, `ProjectVersionMeta`), `version-store.ts` (`loadVersionPayload(config,id,projectId): Promise<string|null>`), `use-version-history.ts` (the hook, with a `lastPayload` ref of the last captured payload string), `history-panel.tsx` (read-only timeline). The `summary` field on versions is currently always `null`.

**Verified facts:**
- `workspaceToJson(ws: Workspace): string` and `jsonToWorkspace(text: string): Workspace` (workspace.ts).
- Every list collection entity has `id: number`: tasks(Task), raid(RaidItem), absences(Absence), shifts(Shift), resources(Resource), roles(Role), disciplines(Discipline), grades(Grade), budgets(BudgetBucket), milestones(Milestone), changes(ChangeItem), stakeholders(Stakeholder).
- Singletons (objects, no id): plan(ResourcePlan), status(ProjectStatus), project(ProjectMeta), fxRates(FxRates|null).
- `Workspace` array fields may be `undefined` on older data (budgets/milestones/changes/stakeholders/status are optional) — default to `[]`/`{}` when diffing.
- `localModifiedAt` is a per-entity bookkeeping timestamp that changes on every edit — it MUST be excluded from field diffs or every record shows as "modified".

---

## Task 1: `version-diff.ts` — entity registry + `diffWorkspaces` + `summarizeDiff`

**Files:**
- Create: `src/app/version-diff.ts`
- Test: `src/app/version-diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/version-diff.test.ts
import { describe, it, expect } from "vitest";
import { diffWorkspaces, summarizeDiff } from "./version-diff";
import type { Workspace } from "./workspace";

// Minimal workspace factory — only the fields under test; cast the rest.
function ws(over: Partial<Workspace>): Workspace {
  return {
    tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
    disciplines: [], grades: [], plan: { } as never, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} as never, ...over,
  } as Workspace;
}

const task = (id: number, over: Record<string, unknown> = {}) =>
  ({ id, title: `T${id}`, ...over } as never);

describe("diffWorkspaces", () => {
  it("detects an added record", () => {
    const changes = diffWorkspaces(ws({ tasks: [] }), ws({ tasks: [task(1)] }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "added" });
  });

  it("detects a removed record", () => {
    const changes = diffWorkspaces(ws({ tasks: [task(1)] }), ws({ tasks: [] }));
    expect(changes[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "removed" });
  });

  it("detects a modified record with field before/after", () => {
    const changes = diffWorkspaces(
      ws({ tasks: [task(1, { title: "Old", pct: 10 })] }),
      ws({ tasks: [task(1, { title: "New", pct: 10 })] }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("modified");
    const f = changes[0].fields.find((x) => x.field === "title");
    expect(f).toMatchObject({ before: "Old", after: "New" });
    // unchanged field not reported
    expect(changes[0].fields.find((x) => x.field === "pct")).toBeUndefined();
  });

  it("ignores localModifiedAt churn (no change reported)", () => {
    const changes = diffWorkspaces(
      ws({ tasks: [task(1, { localModifiedAt: "a" })] }),
      ws({ tasks: [task(1, { localModifiedAt: "b" })] }),
    );
    expect(changes).toHaveLength(0);
  });

  it("diffs a singleton (project meta) as field changes", () => {
    const changes = diffWorkspaces(
      ws({ project: { name: "A" } as never }),
      ws({ project: { name: "B" } as never }),
    );
    expect(changes[0]).toMatchObject({ collection: "project", type: "modified" });
    expect(changes[0].fields[0]).toMatchObject({ field: "name", before: "A", after: "B" });
  });

  it("treats undefined collections as empty", () => {
    const changes = diffWorkspaces(ws({ milestones: undefined }), ws({ milestones: [{ id: 5, name: "M" } as never] }));
    expect(changes[0]).toMatchObject({ collection: "milestones", recordId: 5, type: "added" });
  });
});

describe("summarizeDiff", () => {
  it("groups counts by collection label", () => {
    const changes = diffWorkspaces(
      ws({ tasks: [task(1, { title: "a" })], raid: [] }),
      ws({ tasks: [task(1, { title: "b" }), task(2)], raid: [{ id: 9 } as never] }),
    );
    // tasks: 1 modified + 1 added = 2; raid: 1 added
    expect(summarizeDiff(changes)).toMatch(/2 Tasks/);
    expect(summarizeDiff(changes)).toMatch(/1 RAID/);
  });

  it("returns an empty-string for no changes", () => {
    expect(summarizeDiff([])).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/version-diff.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `version-diff.ts`**

```ts
// src/app/version-diff.ts
// Pure diff between two Workspace snapshots, driven by a collection registry.
// List collections are matched by numeric id; singletons are compared as one
// object. Field changes exclude bookkeeping noise (localModifiedAt). The result
// powers the read-only compare view and (Slice 3) selective restore.

import type { Workspace } from "./workspace";

export type ChangeType = "added" | "removed" | "modified";

export interface FieldChange {
  field: string;
  label: string;          // humanized field name
  before: unknown;
  after: unknown;
}

export interface VersionChange {
  collection: string;     // Workspace key, e.g. "tasks"
  collectionLabel: string;// human label, e.g. "Tasks"
  kind: "list" | "singleton";
  recordId: number | null;// null for singletons
  recordLabel: string;    // e.g. a task title or "#3"
  type: ChangeType;
  fields: FieldChange[];  // for added/removed: the full field set (after/before)
}

interface CollectionSpec {
  key: keyof Workspace;
  label: string;
  kind: "list" | "singleton";
  /** field used as a human record label for list rows */
  nameField?: string;
}

// Order here is the display order in the compare view.
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
];

const IGNORED_FIELDS = new Set(["localModifiedAt"]);

function humanize(field: string): string {
  const s = field.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (!eq(before?.[k], after?.[k])) out.push({ field: k, label: humanize(k), before: before?.[k], after: after?.[k] });
  }
  return out;
}

function recordLabel(rec: Record<string, unknown> | undefined, id: number, nameField?: string): string {
  const name = nameField ? rec?.[nameField] : undefined;
  return typeof name === "string" && name.trim() ? name : `#${id}`;
}

function diffList(spec: CollectionSpec, older: unknown[], newer: unknown[]): VersionChange[] {
  const byId = (arr: unknown[]) => new Map(arr.map((r) => [(r as { id: number }).id, r as Record<string, unknown>]));
  const a = byId(older ?? []);
  const b = byId(newer ?? []);
  const out: VersionChange[] = [];
  const base = (id: number, rec: Record<string, unknown> | undefined, type: ChangeType, fields: FieldChange[]): VersionChange => ({
    collection: spec.key, collectionLabel: spec.label, kind: "list",
    recordId: id, recordLabel: recordLabel(rec, id, spec.nameField), type, fields,
  });
  for (const [id, rec] of b) {
    if (!a.has(id)) out.push(base(id, rec, "added", fieldChanges({}, rec)));
    else {
      const fields = fieldChanges(a.get(id)!, rec);
      if (fields.length) out.push(base(id, rec, "modified", fields));
    }
  }
  for (const [id, rec] of a) {
    if (!b.has(id)) out.push(base(id, rec, "removed", fieldChanges(rec, {})));
  }
  return out;
}

function diffSingleton(spec: CollectionSpec, older: unknown, newer: unknown): VersionChange[] {
  const fields = fieldChanges((older ?? {}) as Record<string, unknown>, (newer ?? {}) as Record<string, unknown>);
  if (!fields.length) return [];
  return [{
    collection: spec.key, collectionLabel: spec.label, kind: "singleton",
    recordId: null, recordLabel: spec.label, type: "modified", fields,
  }];
}

export function diffWorkspaces(older: Workspace, newer: Workspace): VersionChange[] {
  const out: VersionChange[] = [];
  for (const spec of COLLECTION_SPECS) {
    if (spec.kind === "list") {
      out.push(...diffList(spec, older[spec.key] as unknown[], newer[spec.key] as unknown[]));
    } else {
      out.push(...diffSingleton(spec, older[spec.key], newer[spec.key]));
    }
  }
  return out;
}

/** "2 Tasks, 1 RAID changed" caption (added+removed+modified, grouped). */
export function summarizeDiff(changes: VersionChange[]): string {
  if (!changes.length) return "";
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(c.collectionLabel, (counts.get(c.collectionLabel) ?? 0) + 1);
  return [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ");
}
```

- [ ] **Step 4: Run — expect PASS; tsc; commit**

Run: `npx vitest run src/app/version-diff.test.ts` → PASS (8 tests). `npx tsc --noEmit` (0).
```bash
git add src/app/version-diff.ts src/app/version-diff.test.ts
git commit -m "feat: version-diff engine + registry + summary (slice 2)"
```

---

## Task 2: Enrich capture summaries from the diff

**Files:**
- Modify: `src/app/use-version-history.ts`
- Test: `src/app/use-version-history.test.tsx` (extend)

- [ ] **Step 1: Add a failing test**

Add to the existing describe block (the store spy-mock + fake timers are already set up; keep the `vi.clearAllMocks()` afterEach):
```tsx
it("stores a change-summary computed against the previous capture", async () => {
  const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
  vi.spyOn(store, "pruneVersions").mockResolvedValue();
  vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
  let payload = JSON.stringify({ tasks: [{ id: 1, title: "A" }], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [], plan: {}, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} });
  const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));
  // first manual capture — no previous → summary null
  await act(async () => { await result.current.captureNow("v1"); });
  expect(append.mock.calls[0][1].summary).toBeNull();
  // change a task title, capture again → summary mentions Tasks
  payload = JSON.stringify({ tasks: [{ id: 1, title: "B" }], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [], plan: {}, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} });
  await act(async () => { await result.current.captureNow("v2"); });
  expect(append.mock.calls[1][1].summary).toMatch(/1 Tasks/);
});
```
NOTE: `args` here must allow overriding `getPayload` (it already does via `...over`). The `lastPayload` ref is set after the first capture, so the second capture has a previous payload to diff against.

- [ ] **Step 2: Run — expect FAIL** (summary is currently always null)

Run: `npx vitest run src/app/use-version-history.test.tsx` → the new test FAILS.

- [ ] **Step 3: Implement the summary in `writeVersion`**

In `use-version-history.ts`, add imports:
```ts
import { diffWorkspaces, summarizeDiff } from "./version-diff";
import { jsonToWorkspace } from "./workspace";
```
In `writeVersion`, after computing `payload` and before building `v`, compute the summary against the previous payload (the `lastPayload` ref):
```ts
    let summary: string | null = null;
    const prev = lastPayload.current;
    if (prev && prev !== payload) {
      try { summary = summarizeDiff(diffWorkspaces(jsonToWorkspace(prev), jsonToWorkspace(payload))) || null; }
      catch { summary = null; } // never let a summary failure block capture
    }
```
Then set `summary` on the `v` object (replace the existing `summary: null`). Keep everything else identical (the no-op guard for auto still runs BEFORE this — note for `auto` it already returns early when `payload === lastPayload.current`, so `prev !== payload` holds when we reach here).

- [ ] **Step 4: Run — expect PASS; tsc; lint; commit**

Run: `npx vitest run src/app/use-version-history.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/use-version-history.ts src/app/use-version-history.test.tsx
git commit -m "feat: diff-derived capture summaries (slice 2)"
```

---

## Task 3: `version-diff-view.tsx` — read-only diff display

**Files:**
- Create: `src/app/version-diff-view.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/version-diff-view.test.tsx`

- [ ] **Step 1: i18n keys (EN then DE)**

Add to `src/app/i18n.ts` (near the `history*` keys from Slice 1):
```ts
  historyCompareTitle: "Changes",
  historyNoChanges: "No differences between the selected versions.",
  historyAdded: "Added",
  historyRemoved: "Removed",
  historyModified: "Modified",
  historyCompareVsNow: "Compared with current",
```
Add the same keys to `src/app/i18n.de.ts`:
```ts
  historyCompareTitle: "Änderungen",
  historyNoChanges: "Keine Unterschiede zwischen den gewählten Versionen.",
  historyAdded: "Hinzugefügt",
  historyRemoved: "Entfernt",
  historyModified: "Geändert",
  historyCompareVsNow: "Mit aktuellem Stand verglichen",
```
After editing `i18n.de.ts`, `grep -n historyAdded src/app/i18n.de.ts` and confirm straight ASCII quotes (the Edit tool can corrupt them).

- [ ] **Step 2: Write the failing test**

```tsx
// src/app/version-diff-view.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VersionDiffView } from "./version-diff-view";
import type { VersionChange } from "./version-diff";

const changes: VersionChange[] = [
  { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "Design sign-off",
    type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
  { collection: "raid", collectionLabel: "RAID", kind: "list", recordId: 9, recordLabel: "Vendor delay",
    type: "removed", fields: [] },
];

describe("VersionDiffView", () => {
  it("groups changes by collection and shows record labels", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Design sign-off")).toBeInTheDocument();
    expect(screen.getByText("Vendor delay")).toBeInTheDocument();
  });

  it("reveals field before/after when a modified record is expanded", () => {
    render(<VersionDiffView lang="en-US" changes={changes} />);
    fireEvent.click(screen.getByText("Design sign-off"));
    expect(screen.getByText(/Old/)).toBeInTheDocument();
    expect(screen.getByText(/New/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no changes", () => {
    render(<VersionDiffView lang="en-US" changes={[]} />);
    expect(screen.getByText(/No differences/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run src/app/version-diff-view.test.tsx` → FAIL (module not found).

- [ ] **Step 4: Implement `version-diff-view.tsx`**

A presentational, read-only grouped diff. Records are collapsible; modified records reveal field before/after. (No checkboxes — those arrive in Slice 3.)

```tsx
// src/app/version-diff-view.tsx
// Read-only grouped diff display for version compare (Slice 2). Restore controls
// (checkboxes) are added in Slice 3. Presentational only.

import { useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { VersionChange, ChangeType } from "./version-diff";

const TYPE_KEY: Record<ChangeType, "historyAdded" | "historyRemoved" | "historyModified"> = {
  added: "historyAdded", removed: "historyRemoved", modified: "historyModified",
};
const TYPE_CLASS: Record<ChangeType, string> = {
  added: "text-AIPM-green", removed: "text-AIPM-pink", modified: "text-muted-foreground",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function VersionDiffView({ lang, changes }: { lang: Lang; changes: VersionChange[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "historyNoChanges")}</p>;
  }
  const groups = new Map<string, VersionChange[]>();
  for (const c of changes) groups.set(c.collectionLabel, [...(groups.get(c.collectionLabel) ?? []), c]);

  const keyOf = (c: VersionChange) => `${c.collection}:${c.recordId}`;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([label, items]) => (
        <div key={label}>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
          <ul className="flex flex-col gap-1">
            {items.map((c) => {
              const k = keyOf(c);
              const expandable = c.fields.length > 0;
              return (
                <li key={k} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <button
                    type="button"
                    onClick={() => expandable && toggle(k)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="text-foreground">{c.recordLabel}</span>
                    <span className={`text-xs ${TYPE_CLASS[c.type]}`}>{t(lang, TYPE_KEY[c.type])}</span>
                  </button>
                  {expandable && open.has(k) && (
                    <ul className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
                      {c.fields.map((f) => (
                        <li key={f.field} className="flex flex-wrap gap-1 text-xs">
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-AIPM-pink line-through">{fmt(f.before)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-AIPM-green">{fmt(f.after)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
```
If any Tailwind token (`text-AIPM-pink`, `border-line`, `bg-surface`, `text-muted-foreground`) is invalid here, substitute the nearest token a neighbor panel uses (read `history-panel.tsx`). AIPM palette only.

- [ ] **Step 5: Run — expect PASS; tsc; lint; commit**

Run: `npx vitest run src/app/version-diff-view.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/version-diff-view.tsx src/app/version-diff-view.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: read-only version diff view + i18n (slice 2)"
```

---

## Task 4: Wire compare — hook `loadDiff` + panel selection

**Files:**
- Modify: `src/app/use-version-history.ts` (add `loadDiff`)
- Modify: `src/app/history-panel.tsx` (selection + render `VersionDiffView`)
- Test: `src/app/use-version-history.test.tsx` (extend), `src/app/history-panel.test.tsx` (extend)

- [ ] **Step 1: Add a failing hook test for `loadDiff`**

```tsx
it("loadDiff compares a version payload against the current workspace", async () => {
  const older = JSON.stringify({ tasks: [{ id: 1, title: "A" }], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [], plan: {}, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} });
  vi.spyOn(store, "loadVersionPayload").mockResolvedValue(older);
  vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
  const now = JSON.stringify({ tasks: [{ id: 1, title: "B" }], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [], plan: {}, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} });
  const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now })));
  let changes;
  await act(async () => { changes = await result.current.loadDiff("v1", "now"); });
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "modified" });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/use-version-history.test.tsx` → the new test FAILS (no `loadDiff`).

- [ ] **Step 3: Add `loadDiff` to the hook**

Add to imports: `loadVersionPayload` from `./version-store`, `diffWorkspaces` + type `VersionChange` from `./version-diff` (jsonToWorkspace already imported in Task 2). Add to the result type `loadDiff: (fromId: string, to: string | "now") => Promise<VersionChange[]>` and implement:
```ts
  const loadDiff = useCallback(async (fromId: string, to: string | "now"): Promise<VersionChange[]> => {
    if (!active) return [];
    try {
      const fromStr = await loadVersionPayload(config, fromId, projectId);
      const toStr = to === "now" ? getPayload() : await loadVersionPayload(config, to, projectId);
      if (!fromStr || !toStr) return [];
      return diffWorkspaces(jsonToWorkspace(fromStr), jsonToWorkspace(toStr));
    } catch (err) { onError?.(err); return []; }
  }, [active, config, projectId, getPayload, onError]);
```
Return `loadDiff` from the hook. Update `UseVersionHistoryResult`.

- [ ] **Step 4: Add a failing panel test for selection + compare**

```tsx
it("compares a clicked version against now and renders the diff", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: "1 Tasks" }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "A", after: "B" }] },
  ]);
  render(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} />);
  fireEvent.click(screen.getByText(/Compared with current/i)); // the per-row compare action (matches historyCompareVsNow)
  expect(await screen.findByText("T1")).toBeInTheDocument();
  expect(loadDiff).toHaveBeenCalledWith("v1", "now");
});
```
(The exact trigger text comes from a new i18n key `historyCompareVsNow` / a per-row "Compare" button — match whatever you render; keep the assertion aligned with the implementation.)

- [ ] **Step 5: Run — expect FAIL**

Run: `npx vitest run src/app/history-panel.test.tsx` → the new test FAILS.

- [ ] **Step 6: Add selection + compare to `history-panel.tsx`**

Extend `HistoryPanelProps` with `loadDiff: (fromId: string, to: string | "now") => Promise<VersionChange[]>`. Add state: `selected: string[]` (max 2) and `diff: VersionChange[] | null` + `comparing: boolean`. Per row, add a "Compare with current" button calling `runDiff(v.id, "now")`; allow ticking up to two versions then a "Compare selected" button calling `runDiff(olderId, newerId)` (order by `capturedAt`). `runDiff` sets `comparing`, awaits `loadDiff`, sets `diff`. Render `<VersionDiffView lang={lang} changes={diff} />` below the timeline when `diff !== null`, with a heading `t(lang,"historyCompareTitle")`. Keep it simple and read-only.

Example wiring (adapt to the existing JSX):
```tsx
  const [diff, setDiff] = useState<VersionChange[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const runDiff = async (fromId: string, to: string | "now") => {
    setComparing(true);
    try { setDiff(await loadDiff(fromId, to)); } finally { setComparing(false); }
  };
```
Add a per-row button: `<button type="button" onClick={() => void runDiff(v.id, "now")}>{t(lang, "historyCompareVsNow")}</button>` styled like a small secondary action. (Two-version selection can reuse the same `runDiff` with the two ids ordered by capturedAt; if you add checkboxes, keep them minimal.)

- [ ] **Step 7: Run all touched tests — expect PASS**

Run: `npx vitest run src/app/use-version-history.test.tsx src/app/history-panel.test.tsx src/app/version-diff-view.test.tsx` → PASS. `npx tsc --noEmit` (0 — also fixes the `workspace-section.test.tsx` mock if `HistoryPanel`/`versionHistory` now needs `loadDiff`; add `loadDiff: vi.fn().mockResolvedValue([])` to the `versionHistory` mock and pass `loadDiff` from the hook in `workspace-section.tsx`'s render).

- [ ] **Step 8: Thread `loadDiff` through the render**

In `workspace-section.tsx` where `<HistoryPanel .../>` is rendered, add `loadDiff={versionHistory.loadDiff}`. tsc will confirm the prop is required. Run `npx tsc --noEmit` (0), `npm run lint` (0).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: wire version compare (loadDiff + panel selection) (slice 2)"
```

---

## Task 5: Release 0.67.0 "Niven"

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version bump**

`package.json`: `0.66.0` → `0.67.0`. `src/app/version.ts`: `APP_VERSION = "0.67.0"`, update `APP_BUILD_DATE` comment, `APP_MILESTONE = "Niven"` (Larry Niven), update the codename JSDoc to the 0.67.x line "Niven".

- [ ] **Step 2: CHANGELOG entry**

Prepend above `## [0.66.0]`:
```markdown
## [0.67.0] - 2026-06-11 "Niven"

Version history — compare (Turso only; second slice).

### Added
- The History view can now compare versions: pick a version to see what changed
  versus the current data, or select two versions to compare them with each
  other. Changes are grouped by type (tasks, RAID, milestones, …) and each record
  expands to show field-level before/after. The timeline now captions each
  automatic version with a short summary of what changed.
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts; golden fixtures unchanged), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.67.0 \"Niven\" — version compare (slice 2)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual (mental trace, Turso): open History → click "Compared with current" on a version → the diff lists changed records grouped by collection; expanding a modified record shows field before→after; an auto-version's row shows a "N Tasks, …" summary.

## Notes / landmines

- `localModifiedAt` MUST be excluded from field diffs (it changes on every edit) — `IGNORED_FIELDS` handles it. If a whole collection shows as "modified" for every record, a noise field leaked in.
- Diffs compare via `JSON.stringify` equality (order-sensitive for arrays/objects) — acceptable here since payloads come from the same canonical `workspaceToJson` serializer, so key order is stable.
- The summary computation is best-effort and wrapped in try/catch — a malformed previous payload must never block a capture.
- No restore yet — `version-diff-view` is display-only; do NOT add checkboxes (Slice 3).
- `i18n.de.ts` quote-corruption: verify after editing.
- Golden fixtures untouched (no serializer change). No Turso schema change (payloads already stored in Slice 1).
