# Version History — Slice 3 (Selective Restore) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a version-vs-now comparison, let the user tick whole records or individual fields and restore exactly those, non-destructively (the restore is applied to current data and saved as a new version), with an activity-log entry.

**Architecture:** A pure `version-restore.ts` takes the current workspace, a chosen version's workspace, the diff, and a selection, and returns a new workspace with only the selected changes reverted. The diff view gains an optional selectable mode (record + field checkboxes). The history hook gains `restore(versionId, selection)` which loads the version, computes the result, applies it to live state via an injected `applyWorkspace`, and logs a `history.restore` activity entry; the existing autosave then captures the new version.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + RTL, Tailwind (AIPM palette).

**Spec:** `docs/superpowers/specs/2026-06-11-version-history-design.md`. **Branch:** `feat-version-history-slice3` (already created). Do NOT edit `eslint.config.mjs`.

**Scope of THIS slice:** the restore engine + interactive record/field selection on the **vs-now** compare + non-destructive apply + `history.restore` activity entry. OUT of scope: the retention Settings stepper + `history` feature-module (Slice 4). Compare-two-versions stays view-only (restore is offered only when comparing a version with the current state).

**Builds on Slices 1–2 (merged):** `version-diff.ts` (`diffWorkspaces`, `VersionChange`, `ChangeType`, `COLLECTION_SPECS`), `version-diff-view.tsx` (read-only grouped diff), `use-version-history.ts` (`loadDiff(fromId, to)`), `history-panel.tsx` (per-row "Compared with current" + two-version "Compare selected").

**Verified facts:**
- A `VersionChange` = `{ collection, collectionLabel, kind: "list"|"singleton", recordId: number|null, recordLabel, type: "added"|"removed"|"modified", fields: { field, label, before, after }[] }`. The vs-now diff is `diffWorkspaces(version, now)`, so for a change: `before` = the VERSION's value, `after` = NOW's value; `added` = in now not version; `removed` = in version not now.
- `COLLECTION_SPECS` (version-diff.ts) lists every collection with `{ key: keyof Workspace, kind: "list"|"singleton" }`. List entities are keyed by numeric `id`.
- The setter cascade to apply a Workspace to live state (use-storage-backend.ts:145 `applyWorkspace`): set each collection, `?? []`/`?? {}`/`?? null` defaults, `if (workspace.plan) setPlan(...)`, `setProject(workspace.project)`. task-manager has all these setters from `useWorkspace()`.
- `ActivityKind` (activity-log.ts:12) is an exhaustive union; `ACTIVITY_KIND_TO_KEY: Record<ActivityKind, TranslationKey>` forces a translation key per kind; `activityGroupOf(kind)` maps kind→group; `logActivity(kind, ...args: (string|number)[])` is available in task-manager.
- `workspaceToJson`/`jsonToWorkspace` (workspace.ts); `loadVersionPayload(config,id,projectId)` (version-store.ts).

---

## Task 1: `version-restore.ts` — pure selective restore

**Files:**
- Create: `src/app/version-restore.ts`
- Test: `src/app/version-restore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/version-restore.test.ts
import { describe, it, expect } from "vitest";
import { applyRestore, changeKey, type RestoreSelection } from "./version-restore";
import { diffWorkspaces } from "./version-diff";
import type { Workspace } from "./workspace";

function ws(over: Partial<Workspace>): Workspace {
  return { tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
    disciplines: [], grades: [], plan: {} as never, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} as never, ...over } as Workspace;
}
const task = (id: number, over: Record<string, unknown> = {}) => ({ id, title: `T${id}`, ...over } as never);

describe("applyRestore", () => {
  it("reverts a selected modified field, leaving unselected fields as-is", () => {
    const version = ws({ tasks: [task(1, { title: "Old", owner: "Ann" })] });
    const now = ws({ tasks: [task(1, { title: "New", owner: "Bob" })] });
    const changes = diffWorkspaces(version, now); // 1 modified change (title, owner)
    const sel: RestoreSelection = { [changeKey("tasks", 1)]: ["title"] }; // restore title only
    const out = applyRestore(now, version, changes, sel);
    const t1 = out.tasks.find((t) => (t as { id: number }).id === 1) as Record<string, unknown>;
    expect(t1.title).toBe("Old"); // reverted
    expect(t1.owner).toBe("Bob"); // untouched
  });

  it("re-adds a record that was removed since the version", () => {
    const version = ws({ tasks: [task(1), task(2)] });
    const now = ws({ tasks: [task(1)] }); // task 2 deleted since
    const changes = diffWorkspaces(version, now); // task 2 = removed
    const sel: RestoreSelection = { [changeKey("tasks", 2)]: "all" };
    const out = applyRestore(now, version, changes, sel);
    expect(out.tasks.map((t) => (t as { id: number }).id).sort()).toEqual([1, 2]);
  });

  it("removes a record that was added since the version (opt-in)", () => {
    const version = ws({ tasks: [task(1)] });
    const now = ws({ tasks: [task(1), task(2)] }); // task 2 added since
    const changes = diffWorkspaces(version, now); // task 2 = added
    const sel: RestoreSelection = { [changeKey("tasks", 2)]: "all" };
    const out = applyRestore(now, version, changes, sel);
    expect(out.tasks.map((t) => (t as { id: number }).id)).toEqual([1]);
  });

  it("leaves everything unchanged when nothing is selected", () => {
    const version = ws({ tasks: [task(1, { title: "Old" })] });
    const now = ws({ tasks: [task(1, { title: "New" })] });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, {});
    expect((out.tasks[0] as { title: string }).title).toBe("New");
  });

  it("restores selected fields of a singleton (project)", () => {
    const version = ws({ project: { name: "A", code: "X" } as never });
    const now = ws({ project: { name: "B", code: "Y" } as never });
    const changes = diffWorkspaces(version, now);
    const sel: RestoreSelection = { [changeKey("project", null)]: ["name"] };
    const out = applyRestore(now, version, changes, sel);
    expect((out.project as { name: string; code: string }).name).toBe("A"); // reverted
    expect((out.project as { name: string; code: string }).code).toBe("Y"); // untouched
  });

  it("does not mutate the input workspaces", () => {
    const version = ws({ tasks: [task(1, { title: "Old" })] });
    const now = ws({ tasks: [task(1, { title: "New" })] });
    const changes = diffWorkspaces(version, now);
    applyRestore(now, version, changes, { [changeKey("tasks", 1)]: "all" });
    expect((now.tasks[0] as { title: string }).title).toBe("New"); // original untouched
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/version-restore.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `version-restore.ts`**

```ts
// src/app/version-restore.ts
// Pure selective restore. Given the current workspace, a chosen version's
// workspace, the diff between them (diffWorkspaces(version, now)), and a
// selection of changes/fields, returns a NEW workspace with only the selected
// changes reverted toward the version. Immutable; never mutates inputs.

import type { Workspace } from "./workspace";
import { COLLECTION_SPECS, type VersionChange } from "./version-diff";

/** Selection keyed by changeKey(collection, recordId); value is "all" (whole
 *  record / all changed fields) or an explicit list of field names. */
export type RestoreSelection = Record<string, "all" | string[]>;

export function changeKey(collection: string, recordId: number | null): string {
  return `${collection}:${recordId ?? "_"}`;
}

type Rec = Record<string, unknown>;
const byId = (arr: unknown[]): Map<number, Rec> =>
  new Map((arr ?? []).map((r) => [(r as { id: number }).id, { ...(r as Rec) }]));

function mergeFields(target: Rec, source: Rec, fields: string[] | "all", allChanged: string[]): Rec {
  const picks = fields === "all" ? allChanged : fields;
  const next = { ...target };
  for (const f of picks) {
    if (f in source) next[f] = source[f];
    else delete next[f]; // field existed in `now` but not in the version → drop it
  }
  return next;
}

export function applyRestore(
  current: Workspace,
  version: Workspace,
  changes: VersionChange[],
  selection: RestoreSelection,
): Workspace {
  // Index changes by key for quick lookup of type + changed field list.
  const changeByKey = new Map(changes.map((c) => [changeKey(c.collection, c.recordId), c]));
  const result: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };

  for (const spec of COLLECTION_SPECS) {
    const key = spec.key as string;
    if (spec.kind === "list") {
      const cur = byId(current[spec.key] as unknown[]);
      const ver = byId(version[spec.key] as unknown[]);
      let touched = false;
      for (const [selKey, sel] of Object.entries(selection)) {
        const change = changeByKey.get(selKey);
        if (!change || change.collection !== key) continue;
        const id = change.recordId as number;
        if (change.type === "removed") { cur.set(id, ver.get(id)!); touched = true; } // re-add
        else if (change.type === "added") { cur.delete(id); touched = true; }          // remove
        else { // modified — revert selected fields toward the version
          const verRec = ver.get(id) ?? {};
          const allChanged = change.fields.map((f) => f.field);
          cur.set(id, mergeFields(cur.get(id) ?? {}, verRec, sel, allChanged));
          touched = true;
        }
      }
      if (touched) result[key] = [...cur.values()];
    } else {
      const selKey = changeKey(key, null);
      const sel = selection[selKey];
      const change = changeByKey.get(selKey);
      if (!sel || !change) continue;
      const allChanged = change.fields.map((f) => f.field);
      const reverted = mergeFields((current[spec.key] ?? {}) as Rec, (version[spec.key] ?? {}) as Rec, sel, allChanged);
      result[key] = reverted;
    }
  }
  return result as unknown as Workspace;
}
```

- [ ] **Step 4: Run — expect PASS; tsc; lint; commit**

Run: `npx vitest run src/app/version-restore.test.ts` → PASS (6 tests). `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/version-restore.ts src/app/version-restore.test.ts
git commit -m "feat: pure selective restore engine (slice 3)"
```

---

## Task 2: Selectable mode in `version-diff-view.tsx`

**Files:**
- Modify: `src/app/version-diff-view.tsx`
- Test: `src/app/version-diff-view.test.tsx` (extend)

- [ ] **Step 1: Add a failing test**

```tsx
import { changeKey } from "./version-restore";
// ... existing imports/tests stay ...

it("renders record + field checkboxes in selectable mode and reports toggles", () => {
  const onToggleRecord = vi.fn();
  const onToggleField = vi.fn();
  render(
    <VersionDiffView
      lang="en-US"
      changes={changes}
      selectable
      selection={{}}
      onToggleRecord={onToggleRecord}
      onToggleField={onToggleField}
    />,
  );
  // record checkbox for the modified task
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]);
  expect(onToggleRecord).toHaveBeenCalledWith(changeKey("tasks", 1));
});

it("renders NO checkboxes when not selectable (read-only, default)", () => {
  render(<VersionDiffView lang="en-US" changes={changes} />);
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
});
```
(`changes` is the existing fixture at the top of the file. The modified task is `recordId: 1`. The removed RAID `recordId: 9` has no fields → record checkbox only.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/app/version-diff-view.test.tsx` → the new selectable test FAILS.

- [ ] **Step 3: Add optional selection props to `version-diff-view.tsx`**

Extend the component's props (keep them all optional so the read-only Slice-2 usage is unchanged):
```ts
import { changeKey, type RestoreSelection } from "./version-restore";

export function VersionDiffView({
  lang, changes,
  selectable = false,
  selection = {},
  onToggleRecord,
  onToggleField,
}: {
  lang: Lang;
  changes: VersionChange[];
  selectable?: boolean;
  selection?: RestoreSelection;
  onToggleRecord?: (key: string) => void;
  onToggleField?: (key: string, field: string) => void;
}) {
```
In the record `<li>`, when `selectable`, render a record checkbox before the label:
```tsx
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={selection[keyOf(c)] !== undefined}
                      onChange={() => onToggleRecord?.(keyOf(c))}
                      aria-label={c.recordLabel}
                      className="accent-AIPM-dark-blue mr-2"
                    />
                  )}
```
where `keyOf` becomes `changeKey(c.collection, c.recordId)` (replace the existing `keyOf`). In the expanded field row, when `selectable`, render a field checkbox; a field is checked when the record's selection is `"all"` OR an array containing the field:
```tsx
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={(() => { const s = selection[keyOf(c)]; return s === "all" || (Array.isArray(s) && s.includes(f.field)); })()}
                            onChange={() => onToggleField?.(keyOf(c), f.field)}
                            aria-label={f.label}
                            className="accent-AIPM-dark-blue mr-1"
                          />
                        )}
```
Keep all read-only rendering intact when `selectable` is false (no checkboxes). The expand/collapse still works.

- [ ] **Step 4: Run — expect PASS; tsc; lint; commit**

Run: `npx vitest run src/app/version-diff-view.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/version-diff-view.tsx src/app/version-diff-view.test.tsx
git commit -m "feat: selectable record/field checkboxes in diff view (slice 3)"
```

---

## Task 3: `history.restore` activity kind + hook `restore()`

**Files:**
- Modify: `src/app/activity-log.ts` (add the kind + translation key mapping + group)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (the activity message)
- Modify: `src/app/use-version-history.ts` (add `restore`)
- Test: `src/app/use-version-history.test.tsx` (extend)

- [ ] **Step 1: Add the activity kind**

In `src/app/activity-log.ts`: add `| "history.restore"` to the `ActivityKind` union; add `"history.restore": "activityHistoryRestore",` to `ACTIVITY_KIND_TO_KEY` (tsc forces this). In `activityGroupOf`, map `history.restore` to the same group the "general"/settings-like kinds use (read the function; if it switches on a prefix, add a `history` case returning the general group). 

In `src/app/i18n.ts` add `activityHistoryRestore: "Restored {0} change(s) from version {1}",` and in `src/app/i18n.de.ts` add `activityHistoryRestore: "{0} Änderung(en) aus Version {1} wiederhergestellt",` — match the EXISTING activity-message interpolation style in these files (grep an existing `activity*` key like `activityTaskCreated` to see whether it uses `{0}`/`%s`/function args; mirror it exactly). Verify straight ASCII quotes in `i18n.de.ts` after editing.

- [ ] **Step 2: Add a failing hook test**

```tsx
it("restore applies the reverted workspace and logs the restore", async () => {
  const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
    grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
  const version = JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base });
  vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
  vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
  const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
  const applyWorkspace = vi.fn();
  const logActivity = vi.fn();
  const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace, logActivity })));
  await act(async () => {
    await result.current.restore("v1", { "tasks:1": ["title"] }, "v1-label");
  });
  expect(applyWorkspace).toHaveBeenCalledTimes(1);
  const applied = applyWorkspace.mock.calls[0][0];
  expect(applied.tasks[0].title).toBe("Old"); // reverted
  expect(logActivity).toHaveBeenCalledWith("history.restore", 1, "v1-label");
});
```
Extend the `args()` helper in the test file to pass through `applyWorkspace`/`logActivity` (they spread via `...over`, so just include them in the `over` object as above — but the hook's arg type must accept them; see Step 3).

- [ ] **Step 3: Add `restore` to the hook**

In `use-version-history.ts`: add to `UseVersionHistoryArgs`:
```ts
  applyWorkspace?: (ws: Workspace) => void;
  logActivity?: (kind: "history.restore", ...args: (string | number)[]) => void;
```
(import `Workspace` type from `./workspace`.) Add imports `loadVersionPayload` (already imported in Slice 2), `applyRestore` + type `RestoreSelection` from `./version-restore`, `diffWorkspaces` (already imported), `jsonToWorkspace` (already imported). Add to `UseVersionHistoryResult`:
```ts
  restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<void>;
```
Implement:
```ts
  const restore = useCallback(async (versionId: string, selection: RestoreSelection, versionLabel: string) => {
    if (!active) return;
    const count = Object.keys(selection).length;
    if (count === 0) return;
    try {
      const verStr = await loadVersionPayload(config, versionId, projectId);
      if (!verStr) return;
      const version = jsonToWorkspace(verStr);
      const now = jsonToWorkspace(getPayload());
      const changes = diffWorkspaces(version, now);
      const restored = applyRestore(now, version, changes, selection);
      applyWorkspace?.(restored);              // pushes to live state → autosave → new version
      logActivity?.("history.restore", count, versionLabel);
    } catch (err) { onError?.(err); }
  }, [active, config, projectId, getPayload, applyWorkspace, logActivity, onError]);
```
Return `restore` from the hook.

- [ ] **Step 4: Run — expect PASS; tsc; lint; commit**

Run: `npx vitest run src/app/use-version-history.test.tsx` → PASS. `npx tsc --noEmit` (0). `npm run lint` (0).
```bash
git add src/app/activity-log.ts src/app/i18n.ts src/app/i18n.de.ts src/app/use-version-history.ts src/app/use-version-history.test.tsx
git commit -m "feat: history.restore activity + hook restore() (slice 3)"
```

---

## Task 4: Wire restore — panel selection + apply cascade from task-manager

**Files:**
- Modify: `src/app/history-panel.tsx` (selection state + Restore button on the vs-now diff)
- Modify: `src/app/task-manager.tsx` (provide `applyWorkspace` + `logActivity` to the hook)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`historyRestoreSelected`)
- Test: `src/app/history-panel.test.tsx` (extend)

- [ ] **Step 1: i18n key**

Add `historyRestoreSelected: "Restore selected"` to `i18n.ts` and `historyRestoreSelected: "Auswahl wiederherstellen"` to `i18n.de.ts` (near the other `history*` keys; verify ASCII quotes in the DE file).

- [ ] **Step 2: Add a failing panel test**

```tsx
it("restores ticked changes from a vs-now comparison", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  render(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  // tick the record, then restore
  const box = await screen.findByLabelText("T1");
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));
  expect(restore).toHaveBeenCalledWith("v1", { "tasks:1": "all" }, "Baseline");
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run src/app/history-panel.test.tsx` → the new test FAILS (no `restore` prop / no selectable diff).

- [ ] **Step 4: Implement restore UI in `history-panel.tsx`**

- Add prop `restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<void>` (import `RestoreSelection` + `changeKey` from `./version-restore`).
- Track which version the current diff came from and whether it is a vs-now diff: store `compareFrom: { id: string; label: string } | null` set when running a vs-now diff (`runDiff(v.id, "now")` → also `setCompareFrom({ id: v.id, label: v.label ?? new Date(v.capturedAt).toLocaleString() })`; clear it for two-version compares and on close).
- Add `selection` state `useState<RestoreSelection>({})`.
- Toggle handlers:
```tsx
  const toggleRecord = (key: string) =>
    setSelection((s) => { const n = { ...s }; if (n[key] !== undefined) delete n[key]; else n[key] = "all"; return n; });
  const toggleField = (key: string, field: string) =>
    setSelection((s) => {
      const cur = s[key];
      const fields = cur === "all" ? [] : Array.isArray(cur) ? [...cur] : [];
      const next = fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field];
      const n = { ...s };
      if (next.length === 0) delete n[key]; else n[key] = next;
      return n;
    });
```
- Render the diff in selectable mode ONLY for a vs-now compare: `<VersionDiffView lang={lang} changes={diff} selectable={compareFrom !== null} selection={selection} onToggleRecord={toggleRecord} onToggleField={toggleField} />`.
- Below the diff, when `compareFrom !== null`, a "Restore selected" button (disabled when `Object.keys(selection).length === 0` or busy):
```tsx
  <button type="button" disabled={Object.keys(selection).length === 0}
    onClick={() => { if (compareFrom) void restore(compareFrom.id, selection, compareFrom.label).then(() => { setSelection({}); setDiff(null); setCompareFrom(null); }); }}>
    {t(lang, "historyRestoreSelected")}
  </button>
```
- Reset `selection`/`compareFrom` when the diff panel close button is clicked.

- [ ] **Step 5: Run — expect PASS** for the panel test.

Run: `npx vitest run src/app/history-panel.test.tsx` → PASS.

- [ ] **Step 6: Provide `applyWorkspace` + `logActivity` + `restore` from task-manager**

In `task-manager.tsx`:
- Build an `applyWorkspace` callback mirroring use-storage-backend.ts:145, using the setters from `useWorkspace()` already in scope:
```ts
  const applyRestoredWorkspace = useCallback((w: Workspace) => {
    setTasks(w.tasks ?? []); setRaid(w.raid ?? []); setAbsences(w.absences ?? []); setShifts(w.shifts ?? []);
    setResources(w.resources ?? []); setRoles(w.roles ?? []); setDisciplines(w.disciplines ?? []); setGrades(w.grades ?? []);
    if (w.plan) setPlan(w.plan); setBudgets(w.budgets ?? []); setFxRates(w.fxRates ?? null); setStatus(w.status ?? {});
    setProject(w.project); setMilestones(w.milestones ?? []); setChanges(w.changes ?? []); setStakeholders(w.stakeholders ?? []);
  }, [setTasks, setRaid, setAbsences, setShifts, setResources, setRoles, setDisciplines, setGrades, setPlan, setBudgets, setFxRates, setStatus, setProject, setMilestones, setChanges, setStakeholders]);
```
- Pass `applyWorkspace: applyRestoredWorkspace` and `logActivity` into the `useVersionHistory({...})` args (the hook arg types from Task 3 accept them).
- Pass `restore={versionHistory.restore}` to `<HistoryPanel>` (via `workspace-section.tsx`, threading like `loadDiff`). Add `restore` to `WorkspaceSectionProps`/its `versionHistory` usage and the `versionHistory` mock in `workspace-section.test.tsx` (`restore: vi.fn().mockResolvedValue(undefined)`). tsc drives this.

- [ ] **Step 7: Gates + commit**

Run: `npx tsc --noEmit` (0), `npm run lint` (0), `npx vitest run src/app` (report counts; all green), `npm run build` (succeeds).
```bash
git add -A
git commit -m "feat: wire selective restore into the History panel (slice 3)"
```

---

## Task 5: Release 0.68.0 "Brin"

**Files:** `package.json`, `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Version bump**

`package.json`: `0.67.0` → `0.68.0`. `src/app/version.ts`: `APP_VERSION = "0.68.0"`, update `APP_BUILD_DATE` comment, `APP_MILESTONE = "Brin"` (David Brin), update the codename JSDoc to the 0.68.x line "Brin".

- [ ] **Step 2: CHANGELOG entry**

Prepend above `## [0.67.0]`:
```markdown
## [0.68.0] - 2026-06-11 "Brin"

Version history — selective restore (Turso only; third slice).

### Added
- From a "Compared with current" view you can now restore selectively: tick whole
  records or individual fields and click "Restore selected". Restoring reverts a
  changed field to the version's value, brings back a record deleted since, or
  removes a record added since — only for what you tick. Restore is
  non-destructive: it applies to your current data and is saved as a new version,
  and it is recorded in the activity log.
```

- [ ] **Step 3: Full gates + build**

Run: `npm run lint` (0), `npx tsc --noEmit` (0), `npx vitest run` (full suite green — report counts; golden fixtures unchanged), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add package.json src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.68.0 \"Brin\" — selective restore (slice 3)"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean; `npm run lint` clean; full `npx vitest run` green; `npm run build` succeeds; golden fixtures unchanged.
- [ ] Manual (mental trace, Turso): compare a version with current → tick one field of a modified task and one deleted record → "Restore selected" → the live data shows the reverted field + the re-added record, a NEW version is captured, and an activity entry "Restored 2 change(s) from version X" appears.

## Notes / landmines

- The vs-now diff is `diffWorkspaces(version, now)`: `before` = version value, `after` = now value. Restore reverts toward `before` (the version). `added` (in now, not version) → remove; `removed` (in version, not now) → re-add. Keep this direction straight or restore does the opposite.
- Restore is offered ONLY on a vs-now compare (`compareFrom !== null`); two-version compares stay view-only (no current state to restore into).
- `applyRestore` is immutable — it rebuilds only the touched collections and never mutates inputs (tested).
- Applying the restored workspace via the setters triggers the existing autosave, which captures the new version automatically — do NOT also call captureNow (would double-capture).
- `ACTIVITY_KIND_TO_KEY` is exhaustive: adding `history.restore` forces a translation key (tsc) and a group in `activityGroupOf` — handle both.
- `i18n.de.ts` quote-corruption: verify after editing.
- No Turso schema change; golden fixtures untouched (no serializer change).
