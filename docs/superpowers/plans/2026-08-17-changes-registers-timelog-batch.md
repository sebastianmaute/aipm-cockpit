# Changes register, task row, chat sidebar, Timelog re-apply — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six user-reported items as one slice — inline status + a note log on the Changes register, a visible Send-inquiry button on task rows, a drag-resizable AI chat sidebar, a Timelog re-fetch/re-apply path, and a Configure-Timelog gate on the Time bookings page.

**Architecture:** Every item reuses an existing primitive rather than introducing one. The note log is the only schema change; it rides `note-log.ts` unchanged and reaches the six write paths through the codec functions CSV and Markdown already share. The one genuinely new module is `change-status-select.tsx`, modelled byte-for-byte on `task-status-select.tsx`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest + Testing Library, Playwright + axe, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-17-changes-registers-timelog-batch-design.md`

**Branch:** `feat/changes-registers-timelog-batch` (already created off `origin/main`).

---

## Before you start — house rules that will bite

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status. Redirect, check unpiped, then read the file.
- **`npm run lint` does not reproduce CI.** It is bare `eslint` with no `--max-warnings`, so it exits 0 on warnings. Use `npx eslint --max-warnings=0 src/app`.
- **Run `npx tsc --noEmit` after editing ANY test.** `next build` does not typecheck tests and vitest never typechecks.
- **Never run two vitest processes at once.** Machine saturation is the load-sensitive-flake condition.
- **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it with a node UTF-8 write matching `\r\n`, then re-verify the bytes.
- **`git checkout --` and `git restore` are deny-listed.** Use `git checkout-index -f -- <path>` to revert a file.
- Commit with a Bash heredoc (`git commit -F - <<'EOF'`), not a PowerShell here-string.

---

## File structure

**New files**

| Path | Responsibility |
|---|---|
| `src/app/change-status-select.tsx` | Shared inline change-status `<select>`; owns the row-unique accessible name and the status→label mapping. |
| `src/app/change-status-select.test.tsx` | Unit tests incl. the ≥2-row name-collision guard. |
| `src/app/budget-unapplied-notice.tsx` | Read-only Budget-panel notice: N buckets carry booked hours not yet applied. |
| `src/app/budget-unapplied-notice.test.tsx` | Tests incl. the malformed-cache case. |

**Modified**

| Path | Change |
|---|---|
| `src/app/types.ts` | `ChangeItem.noteLog?: NoteLogEntry[]` |
| `src/app/change-log.ts` | `withStoredNoteLog` helper (DOM-free) |
| `src/app/csv-codecs-core.ts` | `noteLog` in `CHANGES_CSV_COLUMNS`, `changeFieldToString`, `buildChangeFromObj` |
| `src/app/markdown-columns.ts` | `noteLog` in `CHANGES_MD_COLUMNS` |
| `src/app/markdown-codecs-core.ts` | `notelog` alias in `CHANGE_ALIASES` |
| `src/app/workspace.ts` | preserve `noteLog` across `sanitizeChangeItem` in `jsonToWorkspace` |
| `src/app/note-log.ts` | correct the `sanitizeChangeRichFields` docblock |
| `src/app/use-chat-dispatcher.ts` | `updateChange` re-applies the stored log |
| `src/app/use-change-log.ts` | save takes `noteLog` from the stored row; `handleChangeStatusChange` |
| `src/app/use-notes-window.ts` | widen to a third entity kind |
| `src/app/change-panel.tsx` | status select + notes badge cell |
| `src/app/change-edit-modal.tsx` | "Notes (N)" button |
| `src/app/task-manager.tsx` | thread `openChangeNotes` + change status handler |
| `src/app/task-row.tsx` | promote Send inquiry out of `⋮` |
| `src/app/chat-thread-sidebar.tsx` | resizable |
| `src/app/chat-panel.tsx` | `useResizable` + `ResetSizeButton` |
| `src/app/timelog-guards.ts` | `canRefreshAndReapply` |
| `src/app/timelog-panel.tsx` | Refresh & re-apply; Configure gate |
| `src/app/timelog-panel-toolbar.tsx` | new toolbar button |
| `src/app/budget-panel.tsx` | mount the notice |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new EN/DE pairs |

---

# Item 1 — Changes: inline status select

### Task 1: `change-status-select.tsx`

**Files:**
- Create: `src/app/change-status-select.tsx`
- Create: `src/app/change-status-select.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/app/change-status-select.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeStatusSelect } from "./change-status-select";
import { t } from "./i18n";

const item = (id: number, title: string) =>
  ({ id, title, status: "Proposed" as const });

describe("ChangeStatusSelect", () => {
  it("calls onStatusChange with the row id and the picked status", () => {
    const onStatusChange = vi.fn();
    render(<ChangeStatusSelect lang="en-US" item={item(7, "Scope cut")} onStatusChange={onStatusChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Approved" } });
    expect(onStatusChange).toHaveBeenCalledWith(7, "Approved");
  });

  // ★ The axe gate provably cannot see two controls sharing an accessible name
  //   (measured against axe-core 4.12.1). A multi-row unit test is the ONLY
  //   possible detector, so it must render TWO rows — one row cannot express
  //   a collision at any assertion count.
  it("gives two rows DIFFERENT accessible names", () => {
    render(
      <>
        <ChangeStatusSelect lang="en-US" item={item(1, "Scope cut")} onStatusChange={() => {}} />
        <ChangeStatusSelect lang="en-US" item={item(2, "Budget uplift")} onStatusChange={() => {}} />
      </>,
    );
    expect(screen.getByRole("combobox", { name: `${t("en-US", "changeFieldStatus")} – Scope cut` })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: `${t("en-US", "changeFieldStatus")} – Budget uplift` })).toBeTruthy();
  });

  it("renders every status as an option", () => {
    render(<ChangeStatusSelect lang="en-US" item={item(1, "Scope cut")} onStatusChange={() => {}} />);
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```
npx vitest run src/app/change-status-select.test.tsx --reporter=dot
```
Expected: FAIL — `Failed to resolve import "./change-status-select"`.

- [ ] **Step 3: Write the component**

`src/app/change-status-select.tsx`:

```tsx
"use client";
// src/app/change-status-select.tsx — shared inline change-status <select>.
// Mirrors task-status-select.tsx: the row-UNIQUE accessible name lives in one
// place, because the Changes view is axe-scanned and the gate cannot see N
// identical "Status" labels (WCAG 2.4.6). The label mapping lives here too, so
// the panel and any future consumer cannot drift.
import { type Lang, type TranslationKey, t } from "./i18n";
import { CHANGE_STATUSES, type ChangeItem, type ChangeStatus } from "./types";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

/** Status → i18n key. MOVED here verbatim from change-panel.tsx so the row
 *  select, the filter dropdown and any future consumer share one mapping. */
export const CHANGE_STATUS_KEY: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

export function changeStatusLabel(s: ChangeStatus, lang: Lang): string {
  return t(lang, CHANGE_STATUS_KEY[s]);
}

interface ChangeStatusSelectProps {
  lang: Lang;
  item: Pick<ChangeItem, "id" | "title" | "status">;
  onStatusChange: (id: number, next: ChangeStatus) => void;
}

export function ChangeStatusSelect({ lang, item, onStatusChange }: ChangeStatusSelectProps) {
  return (
    <select
      aria-label={`${t(lang, "changeFieldStatus")} – ${item.title}`}
      value={item.status}
      onChange={(e) => onStatusChange(item.id, e.target.value as ChangeStatus)}
      className={`rounded border border-line px-1.5 py-0.5 text-xs font-medium hover:border-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
    >
      {CHANGE_STATUSES.map((s) => (
        <option key={s} value={s}>{changeStatusLabel(s, lang)}</option>
      ))}
    </select>
  );
}
```

`CHANGE_STATUS_KEY` is `change-panel.tsx`'s existing `STATUS_KEY` record moved out verbatim; all six keys were confirmed present in `i18n.ts` at plan time (`grep -n "changeStatus" src/app/i18n.ts` → six hits). Delete the panel's local copy in Task 2 Step 5 rather than leaving two.

- [ ] **Step 4: Run the test**

```
npx vitest run src/app/change-status-select.test.tsx --reporter=dot
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-status-select.tsx src/app/change-status-select.test.tsx
git commit -F - <<'EOF'
feat(changes): add a shared inline change-status select

Mirrors task-status-select: one module owns the row-unique accessible name
and the status label mapping, so the panel and any future consumer cannot
drift. The two-row test is deliberate — the axe gate cannot see two controls
sharing an accessible name at any seed size, so a multi-row unit test is the
only possible detector of that collision.
EOF
```

---

### Task 2: wire the select into the panel through `applyChangeStatus`

**Files:**
- Modify: `src/app/use-change-log.ts`
- Modify: `src/app/change-panel.tsx`
- Modify: `src/app/task-manager.tsx`
- Test: `src/app/use-change-log.test.ts` (extend), `src/app/change-panel.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-change-log.test.ts`:

```ts
it("inline status change routes through applyChangeStatus and fills decisionDate", () => {
  const { result } = renderChangeLog({ today: "2026-08-17", changes: [
    { id: 1, title: "Scope cut", status: "Proposed", raisedDate: "2026-08-01",
      description: "", type: "Scope", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
  ]});
  act(() => result.current.handleChangeStatusChange(1, "Approved"));
  const row = currentChanges()[0];
  expect(row.status).toBe("Approved");
  expect(row.decisionDate).toBe("2026-08-17");
});

it("clears decisionDate when an inline status change returns the item to pending", () => {
  const { result } = renderChangeLog({ today: "2026-08-17", changes: [
    { id: 1, title: "Scope cut", status: "Approved", decisionDate: "2026-08-10", raisedDate: "2026-08-01",
      description: "", type: "Scope", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] },
  ]});
  act(() => result.current.handleChangeStatusChange(1, "Under Review"));
  expect(currentChanges()[0].decisionDate).toBeUndefined();
});
```

Match the file's existing harness — read the top of `use-change-log.test.ts` and reuse whatever it already uses to mount the hook and read `changes` back. `renderChangeLog`/`currentChanges()` above are placeholders for that existing harness, not new helpers to invent.

- [ ] **Step 2: Run it and confirm it fails**

```
npx vitest run src/app/use-change-log.test.ts --reporter=dot
```
Expected: FAIL — `result.current.handleChangeStatusChange is not a function`.

- [ ] **Step 3: Add the handler**

In `src/app/use-change-log.ts`, after `handleSaveChange`, add:

```ts
  // Inline status change from the table row. Routes through applyChangeStatus —
  // the SOLE writer of the status/decisionDate invariant — so the row cannot
  // acquire a status without its matching decision date, or keep a stale one.
  // Functional updater: a bulk status sweep would otherwise have N saves in one
  // tick all read the same stale closure and the last write clobber the rest.
  const handleChangeStatusChange = useCallback((id: number, next: ChangeStatus) => {
    const previous = changes.find((c) => c.id === id);
    if (!previous) return;
    const updated: ChangeItem = {
      ...applyChangeStatus(previous, next, args.today),
      localModifiedAt: new Date().toISOString(),
    };
    setChanges((prev) => prev.map((c) => (c.id === id ? updated : c)));
    captureFieldChanges(args.captureFieldEdit, {
      setter: setChanges, kind: "change.updated", id,
      prev: previous, next: updated, groups: CHANGE_UNDO_GROUPS,
      stampField: "localModifiedAt", name: previous.title,
    });
    args.logActivityChanges?.("change.updated", diffFields(previous, updated), id, previous.title);
  }, [changes, setChanges, args]);
```

Add `handleChangeStatusChange` to the hook's return object.

`CHANGE_UNDO_GROUPS` is already `[["status", "decisionDate"]]`, so the pair is captured as one undo entry — no new grouping work. Verify with `sed -n '80,86p' src/app/undo/field-groups.ts`.

- [ ] **Step 4: Run the test**

```
npx vitest run src/app/use-change-log.test.ts --reporter=dot
```
Expected: PASS.

- [ ] **Step 5: Render the select in the panel**

In `src/app/change-panel.tsx`:
1. Add `onStatusChange: (id: number, next: ChangeStatus) => void;` to `ChangePanelProps`, destructure it in `ChangePanelBody`.
2. Import `ChangeStatusSelect` and `changeStatusLabel`.
3. Replace the panel's local `statusLabel` with `changeStatusLabel` (delete the local one; keep using it for the FILTER dropdown's option labels).
4. In the status `<td>`, replace `{statusLabel(item.status, lang)}` with:

```tsx
<ChangeStatusSelect lang={lang} item={item} onStatusChange={onStatusChange} />
```

In `src/app/task-manager.tsx`, take `handleChangeStatusChange` off `useChangeLog(...)` and thread it to the panel as `onStatusChange` (follow the existing `onSave`/`onDelete` threading through `workspace-section`).

- [ ] **Step 6: Guard the row against the select swallowing the row click**

`change-panel.tsx` rows are clickable (they open the editor). An in-`<tr>` control needs `stopPropagation` or picking a status also opens the modal. Add to the `<td>` wrapping the select:

```tsx
<td className="px-3 py-2 text-foreground" onClick={(e) => e.stopPropagation()}>
```

Add a panel test asserting that changing the select does **not** call the row's edit handler.

- [ ] **Step 7: Run the panel tests + typecheck**

```
npx vitest run src/app/change-panel.test.tsx src/app/use-change-log.test.ts --reporter=dot
npx tsc --noEmit
```
Expected: both PASS / exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/use-change-log.ts src/app/change-panel.tsx src/app/task-manager.tsx src/app/use-change-log.test.ts src/app/change-panel.test.tsx
git commit -F - <<'EOF'
feat(changes): change status inline from the register table

The handler routes through applyChangeStatus rather than writing status
directly, so an inline change cannot leave decisionDate stale or unset — that
helper is the sole writer of the invariant and the modal already used it.
CHANGE_UNDO_GROUPS already pairs status with decisionDate, so one undo
restores both.

The status cell stops click propagation: the row opens the editor, and
without it picking a status would also open the modal.
EOF
```

---

# Item 2 — Changes: note log

### Task 3: the field, the codecs, and the DOM-free helper

**Files:**
- Modify: `src/app/types.ts`, `src/app/change-log.ts`, `src/app/csv-codecs-core.ts`, `src/app/markdown-columns.ts`, `src/app/markdown-codecs-core.ts`
- Test: `src/app/change-log.test.ts`, `src/app/csv-codecs.test.ts` (or whichever file already round-trips changes — find it with `grep -rln "buildChangeFromObj" src/app --include=*.test.ts`)

- [ ] **Step 1: Write the failing test**

Append to `src/app/change-log.test.ts`:

```ts
import { withStoredNoteLog } from "./change-log";

describe("withStoredNoteLog", () => {
  const base = { id: 1, title: "x", status: "Proposed", type: "Scope", description: "",
    raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] } as ChangeItem;

  it("re-attaches a non-empty log", () => {
    const log = [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a" }];
    expect(withStoredNoteLog(base, log).noteLog).toEqual(log);
  });

  it("leaves the item untouched for an absent or empty log", () => {
    expect(withStoredNoteLog(base, undefined)).toBe(base);
    expect(withStoredNoteLog(base, [])).toBe(base);
  });

  // The JSON boundary hands it raw parsed data, so a non-array must not land
  // on the entity as a noteLog.
  it("ignores a non-array", () => {
    expect(withStoredNoteLog(base, "nope" as never)).toBe(base);
  });
});
```

And a round-trip test in the change codec test file:

```ts
it("round-trips a change noteLog through CSV", () => {
  const log = [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>note</p>", text: "note" }];
  const row: Record<string, string> = {
    id: "1", title: "Scope cut", status: "Proposed", type: "Scope", raisedDate: "2026-01-01",
    noteLog: changeFieldToString({ ...baseChange, noteLog: log }, "noteLog"),
  };
  expect(buildChangeFromObj(row)?.noteLog).toEqual(log);
});
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/change-log.test.ts --reporter=dot
```
Expected: FAIL — `withStoredNoteLog` is not exported.

- [ ] **Step 3: Add the field**

`src/app/types.ts`, inside `ChangeItem` beside `knowledgeLinks`:

```ts
  /** Dated note log, shared model with Task/RaidItem. Optional; absent on
   *  legacy data. JSON-in-cell on the text backends (encodeNoteLog). */
  noteLog?: NoteLogEntry[];
```

- [ ] **Step 4: Add the helper**

`src/app/change-log.ts` (DOM-free — it only moves an array, never sanitizes):

```ts
/**
 * Put a note log back onto a change that has just been through
 * `sanitizeChangeItem`.
 *
 * ★★★ `sanitizeChangeItem` builds its output from an explicit field list and is
 * DOM-free by contract, so it DROPS `noteLog` and CANNOT be taught to keep it
 * (`sanitizeNoteLog` reaches DOMPurify). Every caller that sanitizes a row which
 * may already carry a log therefore has to re-attach it, or the log is destroyed.
 *
 * ★★ THREE call sites, and they are not obvious from a call-shaped grep:
 * `buildChangeFromObj` (CSV + Markdown + both Turso layouts), `jsonToWorkspace`,
 * and the AI dispatcher's `updateChange`. RAID does NOT need this at its decode
 * or JSON boundaries because neither calls `sanitizeRaidItem`; changes call
 * theirs, which is why this helper exists at all.
 *
 * ★ Takes `unknown` for the log because the JSON boundary hands it raw parsed
 * data. A non-array is dropped rather than trusted.
 */
export function withStoredNoteLog(item: ChangeItem, log: unknown): ChangeItem {
  return Array.isArray(log) && log.length ? { ...item, noteLog: log as NoteLogEntry[] } : item;
}
```

- [ ] **Step 5: Wire the codecs**

`src/app/csv-codecs-core.ts`:

1. Append `"noteLog"` to the end of `CHANGES_CSV_COLUMNS`.
2. In `changeFieldToString`, before the trailing `const v = c[col];`:

```ts
  if (col === "noteLog") return encodeNoteLog(c.noteLog);
```

3. In `buildChangeFromObj`, wrap the return:

```ts
export function buildChangeFromObj(obj: Record<string, string>): ChangeItem | null {
  const item = sanitizeChangeItem({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    scheduleImpactDays: obj.scheduleImpactDays ? Number(obj.scheduleImpactDays) : undefined,
    costImpact: obj.costImpact ? Number(obj.costImpact) : undefined,
    linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds),
    linkedRaidIds: parseLinkedTaskIds(obj.linkedRaidIds),
    stakeholderIds: parseLinkedTaskIds(obj.stakeholderIds),
    knowledgeLinks: decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks),
  });
  // sanitizeChangeItem drops noteLog (DOM-free). decodeNoteLog has ALREADY
  // sanitized the entries, so re-attaching is safe here.
  return item === null ? null : withStoredNoteLog(item, decodeNoteLog(obj.noteLog));
}
```

Import `withStoredNoteLog` from `./change-log` and confirm `decodeNoteLog` is already imported (it is — the RAID and task codecs use it).

`src/app/markdown-columns.ts`: append `{ key: "noteLog", label: "NoteLog" }` to `CHANGES_MD_COLUMNS`.

`src/app/markdown-codecs-core.ts`: add `notelog: "noteLog",` to `CHANGE_ALIASES`.

Markdown needs nothing else — `changesToMarkdown` already maps through `changeFieldToString`, and `markdownToChanges` through `buildChangeFromObj`.

- [ ] **Step 6: Run the tests**

```
npx vitest run src/app/change-log.test.ts src/app/csv-codecs.test.ts src/app/markdown-codecs.test.ts --reporter=dot
npx tsc --noEmit
```
Expected: PASS. `golden-workspace.test` will now FAIL — that is correct and Task 7 regenerates it. Do not regenerate here.

- [ ] **Step 7: Commit**

```bash
git add src/app/types.ts src/app/change-log.ts src/app/csv-codecs-core.ts src/app/markdown-columns.ts src/app/markdown-codecs-core.ts src/app/change-log.test.ts
git commit -F - <<'EOF'
feat(changes): persist a note log on the change register

Adds ChangeItem.noteLog and routes it through the codec functions CSV and
Markdown already share, which covers four of the six write paths in one edit
set (CSV, Markdown, Turso single, Turso tenant). Existing Turso databases
self-heal via turso-migrate's PRAGMA diff.

withStoredNoteLog exists because sanitizeChangeItem builds from an explicit
field list and is DOM-free, so it drops noteLog and cannot be taught to keep
it. RAID needs no equivalent: its decode and JSON boundaries never call
sanitizeRaidItem. Changes call theirs at three separate sites, which is the
whole reason this helper is shared rather than inlined.

Golden fixtures are deliberately left failing here; they are regenerated once
the remaining write paths land.
EOF
```

---

### Task 4: close the three `sanitizeChangeItem` drop sites

**Files:**
- Modify: `src/app/workspace.ts`, `src/app/use-chat-dispatcher.ts`, `src/app/note-log.ts`
- Test: `src/app/workspace.test.ts`, `src/app/use-chat-dispatcher.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/app/workspace.test.ts`:

```ts
it("preserves a change noteLog through jsonToWorkspace", () => {
  const ws = jsonToWorkspace(JSON.stringify({
    changes: [{ id: 1, title: "Scope cut", status: "Proposed", type: "Scope",
      raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
      noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>kept</p>", text: "kept" }] }],
  }));
  expect(ws.changes[0].noteLog).toHaveLength(1);
  expect(ws.changes[0].noteLog?.[0].text).toBe("kept");
});

it("sanitizes a change noteLog arriving through jsonToWorkspace", () => {
  const ws = jsonToWorkspace(JSON.stringify({
    changes: [{ id: 1, title: "x", status: "Proposed", type: "Scope",
      raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
      noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<script>alert(1)</script><p>ok</p>", text: "ok" }] }],
  }));
  expect(ws.changes[0].noteLog?.[0].html).not.toContain("script");
});
```

`src/app/use-chat-dispatcher.test.tsx` — mirror the existing `updateRaid` note-log test (find it with `grep -n "noteLog" src/app/use-chat-dispatcher.test.tsx` and reuse that test's harness):

```tsx
it("update_change preserves the stored note log", () => {
  const log = [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>keep me</p>", text: "keep me" }];
  const { dispatcher, currentChanges } = renderDispatcher({
    changes: [{ id: 1, title: "Scope cut", status: "Proposed", type: "Scope", description: "",
      raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], noteLog: log }],
  });
  // A title-only patch: the model never mentions noteLog, so nothing but the
  // sanitizer can be responsible if the log disappears.
  dispatcher.updateChange(1, { title: "Scope cut v2" });
  expect(currentChanges()[0].title).toBe("Scope cut v2");
  expect(currentChanges()[0].noteLog).toEqual(log);
});
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/workspace.test.ts src/app/use-chat-dispatcher.test.tsx --reporter=dot
```
Expected: FAIL — the log is `undefined` in both.

- [ ] **Step 3: Fix the JSON boundary**

`src/app/workspace.ts`, the `changes:` line inside `jsonToWorkspace`:

```ts
      // ★★★ sanitizeChangeItem DROPS noteLog (explicit field list, DOM-free), so
      //     the log must be carried across it. The rich pass that follows runs
      //     sanitizeNoteLog, so attaching the RAW array here is correct — it is
      //     sanitized one step later, exactly as tasks and RAID are.
      //     RAID needs none of this: its branch never calls sanitizeRaidItem.
      changes: ((p.changes as unknown[]) ?? [])
        .map((c) => {
          const s = sanitizeChangeItem(c);
          return s === null ? null : withStoredNoteLog(s, (c as { noteLog?: unknown } | null)?.noteLog);
        })
        .filter((c): c is ChangeItem => c !== null)
        .map(sanitizeChangeRichFields),
```

Import `withStoredNoteLog` from `./change-log`.

- [ ] **Step 4: Fix the AI dispatcher**

`src/app/use-chat-dispatcher.ts`, in `updateChange`, replace the `next` line:

```ts
        // ★★★ Re-apply the STORED log — `sanitizeChangeItem` drops `noteLog` and
        //     cannot keep it (DOM-free). Same defect class as §49 on RAID, and
        //     AI writes have no undo, so the loss would be unrecoverable.
        const next = changesRef.current.map((c) =>
          (c.id === id ? withStoredNoteLog(merged, existing.noteLog) : c));
```

- [ ] **Step 5: Correct the stale docblock**

`src/app/note-log.ts` — `sanitizeChangeRichFields`'s comment currently says `(no noteLog)`, which the new field makes false. `sanitizeRichFields` handles `noteLog` unconditionally via its own `Array.isArray` arm, so:

```ts
/** Changes: `description` + `impactDescription` + `resolutionNotes` + `noteLog`. */
```

Leave the `sanitizeMilestoneRichFields` comment alone — milestones still have no log.

- [ ] **Step 6: Sweep for any fourth site**

```bash
grep -rn "sanitizeChangeItem" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Grep the **bare name**, not `sanitizeChangeItem(`. A sanitizer passed by reference into a `.map` or a `buildList` callback does not match a call-shaped grep — that trap has already under-counted one sweep in this repo. Every hit that holds an EXISTING row (rather than building a new one) needs `withStoredNoteLog`. Record the hit list in the commit message.

- [ ] **Step 7: Run the tests**

```
npx vitest run src/app/workspace.test.ts src/app/use-chat-dispatcher.test.tsx --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/workspace.ts src/app/use-chat-dispatcher.ts src/app/note-log.ts src/app/workspace.test.ts src/app/use-chat-dispatcher.test.tsx
git commit -F - <<'EOF'
fix(changes): stop sanitizeChangeItem destroying the new note log

sanitizeChangeItem builds from an explicit field list and is DOM-free, so it
drops noteLog at every site that sanitizes an existing row. Three such sites
exist and all three are now closed: the CSV/Markdown/Turso decoder, the JSON
load boundary, and the AI dispatcher's update_change.

The JSON boundary attaches the raw array before the rich pass rather than
after, because that pass runs sanitizeNoteLog — the same order tasks and RAID
already rely on. The dispatcher fix mirrors updateRaid, where this defect was
found first; AI writes have no undo, so the loss would have been permanent.

Also corrects sanitizeChangeRichFields' docblock, which claimed changes carry
no note log.
EOF
```

---

### Task 5: the write-through clobber in the save path

**Files:**
- Modify: `src/app/use-change-log.ts`
- Test: `src/app/use-change-log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ★ The collision must be SEEDED. A save against an untouched log passes
//   whichever way the handler decides, so a realistic fixture cannot tell a
//   correct implementation from a reverted one.
it("keeps a note added while the editor was open (write-through, not the draft snapshot)", () => {
  const stored = { id: 1, title: "Scope cut", status: "Proposed", type: "Scope", description: "",
    raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
    noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>added mid-edit</p>", text: "added mid-edit" }] };
  const { result } = renderChangeLog({ today: "2026-08-17", changes: [stored] });
  // The modal's draft was snapshotted BEFORE the note existed, so it carries none.
  const draft = { ...stored, title: "Scope cut v2", noteLog: undefined };
  act(() => result.current.handleSaveChange(draft, false));
  expect(currentChanges()[0].noteLog).toHaveLength(1);
  expect(currentChanges()[0].title).toBe("Scope cut v2");
});

// ★ Asserts on the SPY's argument, not on the resulting array. The array is
//   correct either way once the log is restored — only the capture argument
//   distinguishes "fixed on withStamp" from "fixed inside setChanges", and the
//   latter leaves a stale log as undoable state.
it("does not put a stale note log into the undo capture", () => {
  const captureFieldEdit = vi.fn();
  const stored = { id: 1, title: "Scope cut", status: "Proposed", type: "Scope", description: "",
    raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
    noteLog: [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>added mid-edit</p>", text: "added mid-edit" }] };
  const { result } = renderChangeLog({ today: "2026-08-17", changes: [stored], captureFieldEdit });
  act(() => result.current.handleSaveChange({ ...stored, title: "Scope cut v2", noteLog: undefined }, false));
  expect(captureFieldEdit).toHaveBeenCalled();
  const arg = captureFieldEdit.mock.calls[0][0];
  expect(arg.next.noteLog).toEqual(stored.noteLog);
});
```

`captureFieldEdit` is reached through `captureFieldChanges`, which reshapes its
arguments. Read `src/app/undo/capture-field-changes.ts` and assert on whatever
it actually forwards — `arg.next` above assumes the `next` row is passed
through unchanged. If it is not, assert on the equivalent field; do not delete
the test, because it is the only one that distinguishes the two fix sites.

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/use-change-log.test.ts --reporter=dot
```
Expected: FAIL — `noteLog` is `undefined` (the draft's value replaced the stored log).

- [ ] **Step 3: Fix `handleSaveChange`**

In `src/app/use-change-log.ts`, reorder so `previous` is resolved **before** `withStamp`, and take the log from it:

```ts
  const handleSaveChange = useCallback((item: ChangeItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => {
    const { create, id } = resolveEntitySave(changes, item.id, isNew, () => nextChangeId(changes));
    const previous = create ? undefined : changes.find((c) => c.id === id);
    // Editing a row a concurrent writer already deleted: the map-replace below
    // would silently no-op. Surface it instead of dropping the edit in silence.
    if (!create && !previous) {
      if (args.showToast && args.lang) {
        reportSilentFailure(args.showToast, args.lang, "change.editVanished", "concurrent delete during edit", "guardEditVanished");
      }
      return;
    }
    // ★★★ The note log is WRITE-THROUGH and owns itself. change-panel snapshots
    //     the whole row at edit-open and this save REPLACES it, so a draft that
    //     predates a note would destroy it. Take the log from the STORED row.
    // ★★ The task fix (omit the field from the payload) would be WORSE here:
    //     because this save replaces rather than merges, a payload without
    //     noteLog erases the log outright. This is the RAID shape, not the task
    //     shape.
    // ★★ It must land on `withStamp`, not inside setChanges — otherwise the
    //     stale log reaches captureFieldChanges below and becomes undoable state.
    const withStamp: ChangeItem = {
      ...item,
      ...(create ? {} : { noteLog: previous?.noteLog }),
      id,
      localModifiedAt: new Date().toISOString(),
    };
```

The rest of the function is unchanged.

`create ? {} : …` matters: on create there is no stored row, and `item.noteLog` (normally absent) is the only truth available.

- [ ] **Step 4: Run the test**

```
npx vitest run src/app/use-change-log.test.ts --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-change-log.ts src/app/use-change-log.test.ts
git commit -F - <<'EOF'
fix(changes): stop a stale editor draft destroying the note log on save

change-panel seeds its draft with a full-row snapshot at edit-open and this
save replaces the row, so a note added while the editor was open would be
destroyed. The log is write-through and owns itself, so the saved row takes it
from the stored row.

Deliberately NOT the task fix. Tasks omit noteLog from the payload, which works
only because their save merges; this one replaces, so an absent field erases
the log outright. This is the RAID shape.

It lands on withStamp rather than inside setChanges so the stale value never
reaches captureFieldChanges and becomes undoable state.

The test seeds the collision explicitly: a save against an untouched log
passes whichever way the handler decides.
EOF
```

---

### Task 6: the note-log UI

**Files:**
- Modify: `src/app/use-notes-window.ts`, `src/app/change-panel.tsx`, `src/app/change-edit-modal.tsx`, `src/app/task-manager.tsx`
- Test: `src/app/use-notes-window.test.ts`, `src/app/change-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/app/use-notes-window.test.ts` — mirror the existing RAID cases for a third kind:

```ts
it("opens, adds and edits a note on a change", () => {
  // openChangeNotes(id) sets notesTarget to { kind: "change", id }
  // the window's add handler writes back through setChanges
});
```

`src/app/change-panel.test.tsx`:

```tsx
it("renders a row-unique notes badge carrying the entry count", () => {
  const onOpenNotes = vi.fn();
  renderPanel(makeProps({ changes: [
    { ...baseChange, id: 1, title: "Scope cut", noteLog: [note(1), note(2)] },
    { ...baseChange, id: 2, title: "Budget uplift", noteLog: [note(1)] },
  ], onOpenNotes }));
  const btn = screen.getByRole("button", { name: `${t("en-US", "noteLogTitle")} – Scope cut` });
  expect(btn.textContent).toContain("2");
  fireEvent.click(btn);
  expect(onOpenNotes).toHaveBeenCalledWith(1);
  // second row proves the names do not collide
  expect(screen.getByRole("button", { name: `${t("en-US", "noteLogTitle")} – Budget uplift` })).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/use-notes-window.test.ts src/app/change-panel.test.tsx --reporter=dot
```
Expected: FAIL.

- [ ] **Step 3: Widen the hook**

`src/app/use-notes-window.ts`:

```ts
export interface NotesWindowDeps {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  setChanges: Dispatch<SetStateAction<readonly ChangeItem[]>>;
  // …unchanged
}

export type NotesTargetKind = "task" | "raid" | "change";

export interface UseNotesWindowResult {
  notesTarget: { kind: NotesTargetKind; id: number } | null;
  openTaskNotes: (id: number) => void;
  openRaidNotes: (id: number) => void;
  openChangeNotes: (id: number) => void;
  notesWindowProps: NotesWindowProps;
  notePanelPropsFor: (kind: NotesTargetKind, id: number) => NoteLogPanelProps;
}
```

Follow the RAID arm exactly for the change arm — same `noteHandlersFor` write path, same entity-name resolution (a change's display name is `title`), so both surfaces share ONE write path. Do not add a second.

- [ ] **Step 4: Wire the surfaces**

- `change-panel.tsx`: `onOpenNotes: (id: number) => void` prop; render `NotesBadgeButton` in the row's actions area with `count={item.noteLog?.length ?? 0}` and `entityName={item.title}`. Wrap its `<td>` in `onClick={(e) => e.stopPropagation()}` for the same reason as the status cell.
- `change-edit-modal.tsx`: a "Notes (N)" button mirroring `raid-edit-modal.tsx` — `{t(lang, "noteLogTitle")} ({draft.noteLog?.length ?? 0})`.
- `task-manager.tsx`: pass `changes` + `setChanges` into `useNotesWindow`, thread `openChangeNotes` to the panel.

**Known cosmetic limitation, do not "fix":** the modal's `draft.noteLog?.length ?? 0` reads the stale snapshot, so it can under-report while the notes window is open. The log itself is safe (Task 5). RAID has the identical behaviour and it is recorded as left-open there.

- [ ] **Step 5: Run the tests**

```
npx vitest run src/app/use-notes-window.test.ts src/app/change-panel.test.tsx src/app/change-edit-modal.test.tsx --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-notes-window.ts src/app/change-panel.tsx src/app/change-edit-modal.tsx src/app/task-manager.tsx src/app/use-notes-window.test.ts src/app/change-panel.test.tsx
git commit -F - <<'EOF'
feat(changes): surface the note log on the register row and in the editor

Widens useNotesWindow from two entity kinds to three. The change arm reuses
the RAID arm's write path rather than adding a second, so the floating window
and the in-editor panel stay on one path.

The row badge's accessible name is row-unique and a two-row test pins it: the
axe gate cannot see two controls sharing a name at any seed size.

The modal's count reads the draft snapshot, so it can under-report while the
notes window is open. Cosmetic and deliberate — the log itself is safe, and
RAID behaves identically.
EOF
```

---

### Task 7: golden fixtures + the persistence registry

**Files:**
- Modify: `src/app/__fixtures__/golden-*`, `src/app/entity-persistence-registry.test.ts`

- [ ] **Step 1: Add the registry row**

Add a `changes` / `noteLog` case to `entity-persistence-registry.test.ts`, mirroring the RAID row.

**Count to six by hand.** That file exercises different widths per slice — `documents` is CSV + Markdown, `documentVersions` adds JSON, `activityLog` is CSV + Markdown only. Read the row you are copying rather than trusting the file's name to mean "all six". The IndexedDB path is covered by `sanitizeChangeRichFields`; JSON by Task 4's `workspace.test.ts` case; both Turso layouts derive from `CHANGES_CSV_COLUMNS`.

- [ ] **Step 2: Regenerate the goldens**

```bash
npx vite-node scripts/generate-sample-workspace.ts
```

Then regenerate `__fixtures__/golden-*` by whatever the repo's documented route is — find it with `grep -rn "golden" package.json scripts/*.mjs scripts/*.ts`.

- [ ] **Step 3: Verify the regen did not truncate**

```bash
git diff --stat src/app/__fixtures__/
```

**A golden regen has silently written 378-byte fixtures over 23,916-byte ones in this repo and reported success.** If any fixture SHRANK by more than the new column can account for, stop and investigate — do not commit it. The change is one added column per change row; the byte delta should be positive.

- [ ] **Step 4: Run the byte-stability suite**

```
npx vitest run src/app/golden-workspace.test.ts src/app/entity-persistence-registry.test.ts --reporter=dot
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/__fixtures__ src/app/entity-persistence-registry.test.ts src/app/sample-workspace-*.json
git commit -F - <<'EOF'
test(changes): regenerate goldens for the change note-log column

A legitimate new-column format change, not a masked diff. Fixture sizes were
checked for shrinkage before committing — a regen in this repo has previously
written near-empty fixtures over full ones and reported success.
EOF
```

---

# Item 3 — Promote "Send inquiry" to a task row button

### Task 8

**Files:**
- Modify: `src/app/task-row.tsx`
- Test: `src/app/task-row.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders a row-unique Send inquiry button for an open task", () => {
  const onSendInquiry = vi.fn();
  renderRow({ task: { ...baseTask, id: 7, taskName: "Draft SOW", status: "To Do" }, onSendInquiry });
  const btn = screen.getByRole("button", { name: `${t("en-US", "sendInquiry")} – Draft SOW` });
  fireEvent.click(btn);
  expect(onSendInquiry).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
});

it("hides the button for a closed task", () => {
  renderRow({ task: { ...baseTask, taskName: "Done thing", status: "Done", completedDate: "2026-08-01" }, onSendInquiry: vi.fn() });
  expect(screen.queryByRole("button", { name: /Send inquiry/ })).toBeNull();
});

// ★ Exactly ONE control per row. Two controls sharing an accessible name is
//   the WCAG 2.4.6 defect the axe gate provably cannot see, so keeping the
//   menu item alongside the button would create it silently.
it("no longer offers Send inquiry inside the overflow menu", () => {
  renderRow({ task: { ...baseTask, taskName: "Draft SOW", status: "To Do" }, onSendInquiry: vi.fn() });
  fireEvent.click(screen.getByRole("button", { name: `${t("en-US", "actionMoreActions")} – Draft SOW` }));
  expect(screen.queryByRole("menuitem", { name: t("en-US", "sendInquiry") })).toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/task-row.test.tsx --reporter=dot
```
Expected: FAIL on the first and third tests.

- [ ] **Step 3: Move the control**

In `src/app/task-row.tsx`, delete the `{showSendInquiry && (…)}` `menuitem` block from the `PopoverPanel`, and render the button before the `⋮` trigger's `<span className="relative">`:

```tsx
      {showSendInquiry && onSendInquiry && (
        <TextButton
          onClick={(e) => { stop(e); onSendInquiry(task); }}
          aria-label={`${t(lang, "sendInquiry")} – ${task.taskName}`}
          className="mr-1 text-xs"
        >
          {t(lang, "sendInquiry")}
        </TextButton>
      )}
```

Import `TextButton` if it is not already imported — this mirrors `raid-panel-rows.tsx`, so check that file for the exact import path and the `stopPropagation` idiom it uses (`e.stopPropagation()` there, `stop(e)` here — use whichever the file already has).

- [ ] **Step 4: Correct the comment the change contradicts**

`task-row.tsx` currently states that all row verbs live in the `⋮` overflow menu. Replace with:

```tsx
  // Row verbs live in the ⋮ overflow menu, EXCEPT Send inquiry, which is a
  // visible button — it is the one verb used often enough to be worth the
  // width, and it matches the RAID row. It is deliberately NOT also a menu
  // item: two controls with the same accessible name in one row is a WCAG
  // 2.4.6 failure the axe gate cannot see.
```

No AGENTS.md correction is owed — `grep -n "overflow menu" AGENTS.md` returns nothing (verified at plan time; re-run it).

- [ ] **Step 5: Run tests + typecheck**

```
npx vitest run src/app/task-row.test.tsx --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-row.tsx src/app/task-row.test.tsx
git commit -F - <<'EOF'
feat(tasks): make Send inquiry a visible row button, matching RAID

The verb already existed but was buried in the row's overflow menu. It is now
a visible button in the action cell with a row-unique accessible name, the
same shape raid-panel-rows already uses.

Removed from the menu rather than duplicated: two controls sharing an
accessible name within one row is a WCAG 2.4.6 failure, and the axe gate
provably cannot detect it at any seed size. The file comment asserting that
all row verbs live in the menu is corrected in the same commit.
EOF
```

---

# Item 4 — Drag-resize the chat thread sidebar

### Task 9

**Files:**
- Modify: `src/app/chat-thread-sidebar.tsx`, `src/app/chat-panel.tsx`
- Test: `src/app/chat-thread-sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("applies a saved width from localStorage on mount", () => {
  window.localStorage.setItem("aipm-cockpit:chat-sidebar-size", JSON.stringify({ width: 320, height: null }));
  const { container } = render(<ChatThreadSidebar {...baseProps} />);
  expect((container.firstChild as HTMLElement).style.width).toBe("320px");
});

it("is horizontally resizable and bounded", () => {
  const { container } = render(<ChatThreadSidebar {...baseProps} />);
  const el = container.firstChild as HTMLElement;
  expect(el.className).toContain("resize-x");
  expect(el.className).toMatch(/min-w-/);
  expect(el.className).toMatch(/max-w-/);
});
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/chat-thread-sidebar.test.tsx --reporter=dot
```
Expected: FAIL — no inline width, no `resize-x`.

- [ ] **Step 3: Make the sidebar resizable**

`src/app/chat-thread-sidebar.tsx` — accept a forwarded ref and add the classes:

```tsx
export interface ChatThreadSidebarProps {
  // …existing props
  /** Ref from the caller's useResizable, attached to the resizable container. */
  containerRef?: React.Ref<HTMLDivElement>;
}
```

```tsx
    <div
      ref={containerRef}
      className="flex w-56 min-w-[10rem] max-w-[24rem] shrink-0 resize-x flex-col gap-2 overflow-auto border-r border-line pr-3"
    >
```

`src/app/chat-panel.tsx`, in the `{tursoMode && (…)}` block:

```tsx
const { ref: chatSidebarRef, reset: resetChatSidebar } = useResizable("aipm-cockpit:chat-sidebar-size");
```

Pass `containerRef={chatSidebarRef}` and render a `ResetSizeButton` for it.

**Use `labelKey` on that button.** `ResetSizeButton` takes a `labelKey` override precisely because two reset controls with the same accessible name doing different things is a WCAG 2.4.6 failure axe passes. Add a dedicated EN/DE pair (e.g. `chatSidebarResetSize`) rather than reusing `tableResetSizeHint`.

- [ ] **Step 4: Run the tests**

```
npx vitest run src/app/chat-thread-sidebar.test.tsx src/app/chat-panel.test.tsx --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 5: Verify in a real browser — this step cannot be skipped**

```
npm run dev
```

Open AI Assistant against a **Turso** project (the sidebar does not mount in file mode).

1. Drag the sidebar's right edge. It should widen and stop at the bounds.
2. Reload. The width persists.
3. **Scroll the thread list.** The list relies on `min-h-0 flex-1`; adding `overflow-auto` to its parent can steal that scroll. jsdom has no layout, so **no unit test can see this** — if the list no longer scrolls independently, move `overflow-auto` off the flex container and onto a wrapper that is not the flex parent.
4. Press the reset button; the width returns to the `w-56` default.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-thread-sidebar.tsx src/app/chat-panel.tsx src/app/chat-thread-sidebar.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(ai): make the chat thread sidebar drag-resizable

Reuses useResizable, the primitive already backing eight panes, rather than
hand-rolling a drag handler. Width persists per device and a reset button
restores the default.

The reset button takes its own label key: ResetSizeButton offers the override
because two reset controls sharing an accessible name while doing different
things is a WCAG 2.4.6 failure that axe passes.

Two known limits, both pre-existing properties of the primitive rather than
new: native CSS resize is not keyboard-operable, and this surface mounts only
under Turso so the axe gate never renders it. Unit tests are its only
automated coverage. Independent scrolling of the thread list was verified in
a browser, which jsdom cannot do.
EOF
```

---

# Item 5 — Timelog re-fetch and re-apply

### Task 10: reproduce the defect — investigation, no code — ✅ DONE (static trace, 2026-08-17)

**Files:** none. Findings below; they REVISE Tasks 11 and 12.

- [x] **Step 1–3 — findings**

**The cause is a fourth one, and it refutes this plan's original premise.**

Attribution is **baked at fetch time**. `aggregateActuals` (`timelog-actuals.ts`) resolves BOTH dimensions — TimeLog user→`resourceId` via `userToRes`, TimeLog project→`bucketId` via `projToBucket` — at aggregation time. Anything resolving to neither is folded into a single **scalar** `unattributed: HourCell` carrying `{hours, billableHours}` and **no resource, project, period or bucket dimension**. Those hours are unrecoverable from the cache.

`use-timelog-sync.ts` `finish()` builds `effectiveLinks` from `autoMatchUsers`/`autoMatchProjects` at fetch time, aggregates, then `setAggregates` + `saveActualsCache`. Nothing recomputes it afterwards: `timelog-panel.tsx` seeds `sync.aggregates` from a `useState` **initializer** over `loadActualsCache`, with no effect re-deriving it. So only *bucket allocation shape* is re-evaluated per render; *identity resolution* is frozen.

The original premise — "Apply does not consume the overlay, so re-clicking Apply should have produced a non-empty diff" — was correct about `timelog-apply.ts` and **wrong about the layer**. The drop happens one stage earlier. The exact rule: if `overlay[bucketId][period].byResource[resourceId]` exists with non-zero hours, adding an allocation line that `allocationIndexFor` resolves for that `resourceId` **necessarily** produces a plan row. The button stayed disabled, therefore those hours were never in `byBucket` at all.

Candidate 1 ("bookings never fetched — the fetch scopes to ticked people") is **false as stated**: `fetchBookings`, the per-user path whose `userIds` scopes to ticked people, is not wired into the panel at all. The live fetch is `fetchBookingsForProjects` — scoped to ticked **projects**; people are derived from who booked.

**Does a re-fetch fix it?** Depends on the sub-cause, and two are unfixable by any button:

| Sub-cause | Re-fetch fixes |
|---|---|
| Resource absent from the directory at fetch time (the literal "new resources") | **Yes** |
| Resource existed but auto-match missed; now manually linked | **Yes** |
| Project→bucket link created after the fetch | **Yes** |
| Cached cell predates the optional `byResource` field | **Yes** |
| Person booked on a project never ticked in the picker | **No** — refresh re-fetches the persisted `links.projectIds`, not a widened set |
| Resource is `isExternal` | **No, ever** — excluded from `matchableResources` and from `allocationIndexFor`'s gate |
| Bucket is `planningMode === "blended"` and the person was added to `allocations[].resourceIds` | **No** — `targetAllocations` reads `disciplineAllocations`; the edit is invisible to apply |

**A refresh button largely already exists.** `handleRefreshBookings` is wired to a "Refresh bookings" toolbar button (`timelogRefresh`, guarded by `canRefreshBookings`) and already re-runs the fetch against live links. What it does NOT do is re-apply. So Item 5's button is still worth building — as *refresh + open the existing confirm dialog* — but it must sit beside the existing control, not duplicate it.

**The genuine defect is staleness with no signal, and the UI asserts the opposite of the data.** The People/Projects tables render `effectiveUserLinks`/`effectiveProjectLinks` recomputed LIVE from `links` + current `resources`/`budgets`, so a link created after the fetch displays as "Auto"/"Manual" — linked and healthy — while the cached aggregate still holds those hours in `unattributed`. Meanwhile the user was in the **Budget** view, where `workspace-section.tsx` feeds `BudgetPanel` a `loadActualsCache` snapshot memoised on `[currentProjectId]` and refreshed only on remount, with no affordance pointing at Timelog. **This needs a notice more than it needs a button.**

**Copy guidance: write against the STALENESS, not the cause.** After aggregation the panel cannot distinguish an unlinked person from an unlinked project from an external resource, because `unattributed` retains no dimensions — naming a specific failure would be guessing. Cause-agnostic precedent already exists (`timelogAttributionHint`, and the tail of `timelogApplyUnmatched`). What no existing string says, and what the copy must: **attribution is frozen at fetch time, so links you fix now are not reflected until you re-fetch.**

**Facts Tasks 11–12 depend on (each corrects something this plan had wrong):**

1. **Neither call returns the fresh aggregate.** `handleRefreshBookings` is `Promise<void>`; `fetchBookingsForProjects(projectIds, startDate, endDate)` returns `Promise<{failedProjects, projectCount} | undefined>` — counts only. But `finish()` calls `saveActualsCache` **synchronously** before returning, so after the `await` the fresh aggregate is readable via `loadActualsCache(projectKey)?.aggregates` with no React state involved. `runGuarded<T>` is already generic over the resolved value, so widening the return type is the cleaner option.
2. **The cache key is a SINGLE key holding a map.** `TIMELOG_ACTUALS_KEY = "aipm-cockpit:timelog-actuals"` holds `Record<projectId, ActualsCacheEntry>`, keyed by `TimelogPanel`'s `projectKey` (`portfolioCurrentId ?? "default"`). There is **no per-project key suffix** — this plan's `"aipm-cockpit:timelog-actuals:<projectId>"` and its `cacheKey("p1")` helper are both wrong.
3. **`loadActualsCache` never throws.** `readDeviceJson` wraps `JSON.parse` in try/catch → `null` → `{}` → `undefined`. It is SSR-safe, and per-entry `isEntry` validation drops malformed entries silently. The planned `try/catch` is unnecessary; the malformed-cache test is still worth keeping as a regression pin.
4. **`matchableResources` is `resources.filter((r) => !r.isExternal)`, an inline `useMemo` in `timelog-panel.tsx`, not exported.** `workspace-section.tsx` passes `BudgetPanel` the FULL unfiltered list. Calling `buildApplyPlan` from the Budget panel with that list would resolve an external's `roleId` and cost their hours at an internal rate — the exact defect the filter exists to prevent. **It must be extracted, not approximated.**
5. Nearest i18n precedents for the Item 6 empty state: `aiDisabledSectionHint` (closest structurally), `guardTrendsNotConfigured` (integration-gated), `chatConfigureAi`, `emptyStateConfigAi`, `setupWizardNotConfigured`. Neighbours to sit beside: `timelogApplyNoAllocation`, `timelogApplyUnmatched`, `timelogAttributionHint`, `timelogRefresh`, `timelogRefreshHint`.

**Still owed, and only a live project can settle it** (does not block Tasks 11–12, which are now cause-agnostic):

- Which sub-cause the user actually hit. One read of `localStorage["aipm-cockpit:timelog-actuals"]` decides it: is `unattributed.hours > 0`, and does `byBucket[<bucket>][<period>].byResource` carry the new resources' ids? The panel's **Unattributed** KPI tile is the user-visible proxy.
- Whether "added to the bucket" meant allocation lines or `resourceIds`, and whether that bucket is `blended` — a blended bucket edited on `allocations[]` is a silent no-op regardless of freshness.
- Whether any added resource is `isExternal`, in which case nothing in this slice helps and nothing in the UI says why.

**Noted, out of scope:** period keys are derived at fetch time from `granularity`, so changing granularity between fetch and apply lands applied hours under keys the budget report never reads. It would not suppress plan rows, so it is not this symptom — but it is a live corruption path in the same cache. Worth an open-followups entry.

---

### Task 11: "Refresh & re-apply"

**Files:**
- Modify: `src/app/timelog-guards.ts`, `src/app/timelog-panel.tsx`, `src/app/timelog-panel-toolbar.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/timelog-guards.test.ts`, `src/app/timelog-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/app/timelog-guards.test.ts`:

```ts
describe("canRefreshAndReapply", () => {
  const ok = { isPopout: false, syncBusy: false, confirming: false, isMisconfigured: false, canRefresh: true };
  it("allows the action when every precondition holds", () => {
    expect(canRefreshAndReapply(ok)).toBe(true);
  });
  // ★ Each arm gets its own case. timelog-guards.ts records FOUR instances of a
  //   handler guard drifting from its button's predicate; a partial mirror
  //   reads as a complete one.
  it.each(["isPopout", "syncBusy", "confirming", "isMisconfigured"] as const)(
    "refuses when %s is set", (k) => expect(canRefreshAndReapply({ ...ok, [k]: true })).toBe(false));
  it("refuses when there is nothing to refresh", () =>
    expect(canRefreshAndReapply({ ...ok, canRefresh: false })).toBe(false));
});
```

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/timelog-guards.test.ts --reporter=dot
```
Expected: FAIL — not exported.

- [ ] **Step 3: Add the guard**

`src/app/timelog-guards.ts` — reuse the existing state type that already carries `canRefresh` (read the file; `canRefreshBookings` takes it):

```ts
/**
 * Refresh the booking window and immediately open the apply confirm dialog.
 *
 * ★★ Identical preconditions to `canRefreshBookings` — it IS a refresh, plus a
 * confirm-open afterwards. Expressed as its own export rather than an alias so
 * the button and the handler share ONE predicate: this file records four
 * separate instances of a handler guard drifting from its button's `disabled`,
 * and a fifth is not wanted.
 */
export function canRefreshAndReapply(state: TimelogRefreshState): boolean {
  return canRefreshBookings(state);
}
```

- [ ] **Step 4: Wire the action**

★★★ **Task 10 changed this step. Read its findings before writing code.** Two corrections:

**(a) A "Refresh bookings" button already exists** (`timelogRefresh`, guarded by `canRefreshBookings`, calling `handleRefreshBookings`). What it does not do is re-apply. So this action is *refresh + open the existing confirm dialog*, and it belongs **beside** that button, not as a near-duplicate of it. Read the existing one first and match its shape.

**(b) `sync.aggregates` after the `await` is a STALE read and must not ship.** `handleRefreshBookings` is `Promise<void>` and `fetchBookingsForProjects` resolves to `{failedProjects, projectCount} | undefined` — counts only. Fix it by **widening the sync hook's return to carry the fresh aggregate**; `runGuarded<T>` is already generic over the resolved value, so this is a type change, not a restructure. (A fallback exists — `finish()` calls `saveActualsCache` synchronously before returning, so `loadActualsCache(projectKey)?.aggregates` is fresh after the await with no React state involved — but prefer the typed return; the localStorage round-trip is a second source of truth for the same value.)

```ts
  // Refresh, then open the SAME confirm dialog the manual Apply uses. Nothing
  // about the write path is new: pendingApply freezes the overlay, pendingBudgets
  // freezes the baseline, and applyToBudget still refuses on a drifted baseline
  // with timelogApplyStale. Money figures never get a second write path.
  //
  // ★★ The fresh aggregate comes back from the call, NOT from sync.aggregates —
  //    that state has not updated in this closure and reading it re-applies the
  //    stale overlay, which is the exact bug this button exists to fix.
  async function handleRefreshAndReapply() {
    if (!canRefreshAndReapply({ isPopout, syncBusy: sync.busy, confirming, isMisconfigured, canRefresh })) return;
    const fresh = await handleRefreshBookings();   // widened to return the aggregate
    if (!fresh?.byBucket) return;
    setPendingApply(fresh.byBucket);
    setPendingBudgets(budgets);
    setConfirming(true);
  }
```

Add a test that pins (b): seed a stale `sync.aggregates`, have the refresh resolve a DIFFERENT aggregate, and assert the confirm dialog shows the fresh diff. Without that seeded divergence the test passes whichever value is read — the same trap as Task 5's.

`src/app/timelog-panel-toolbar.tsx`: place the button **immediately after the existing `timelogRefresh` button** and **before** the trailing `Print · reset-columns · reset-pane-size` group. It is not a member of that group and must not land between two of its members — that drift has been caught and fixed more than once.

New EN/DE pair: `timelogRefreshReapply`, plus a hint string in the shape of the existing `timelogRefreshHint`. The copy says the action re-pulls bookings **and re-applies**; it must not imply it widens the project scope, because it does not (see Task 10's sub-cause table).

- [ ] **Step 5: Assert the toolbar order**

Use the shared helper, never a hand-rolled `compareDocumentPosition` walk:

```ts
import { expectButtonOrder } from "../test/toolbar-order";
// buttonIndex THROWS on a zero- or multi-match; a hand-rolled findIndex
// silently takes the first, so an ordering assertion can pass against the
// wrong control.
expectButtonOrder(container, ["timelogRefreshReapply", "print", "tableResetColWidths", "tableResetSizeHint"], { contiguous: false });
expectButtonOrder(container, ["print", "tableResetColWidths", "tableResetSizeHint"], { contiguous: true });
```

Read `src/test/toolbar-order.ts` for the real signature and key convention before writing this.

- [ ] **Step 6: Run tests + typecheck**

```
npx vitest run src/app/timelog-guards.test.ts src/app/timelog-panel.test.tsx --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/timelog-guards.ts src/app/timelog-panel.tsx src/app/timelog-panel-toolbar.tsx src/app/timelog-guards.test.ts src/app/timelog-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(timelog): add Refresh & re-apply

Re-pulls the booking window and opens the existing apply confirm dialog with
the fresh diff. Every safeguard is reused rather than reimplemented: the
frozen overlay snapshot, the frozen budget baseline, and the stale-baseline
refusal. Money figures gain no second write path.

The guard is its own export sharing one predicate with the button's disabled
state. This file already records four instances of a handler guard drifting
from its button, so the guard is not left to a hand-mirrored condition.

The button sits before the trailing Print / reset-columns / reset-size group,
asserted with the shared toolbar-order helper — buttonIndex throws on an
ambiguous match where a hand-rolled findIndex would silently take the first.
EOF
```

---

### Task 12: the Budget "unapplied hours" notice

**Files:**
- Create: `src/app/budget-unapplied-notice.tsx`, `src/app/budget-unapplied-notice.test.tsx`
- Create: `src/app/resource-matching.ts` (+ test) — the extracted `matchableResources`
- Modify: `src/app/budget-panel.tsx`, `src/app/timelog-panel.tsx` (point it at the extracted helper), `src/app/workspace-section.tsx` (mount props), `src/app/i18n.ts`, `src/app/i18n.de.ts`

★ `resource-matching.ts` is a pure `.ts` file and therefore **coverage-gated**. It is real logic, not UI glue, so test it rather than adding it to `vitest.config.ts` `coverage.exclude`.

- [ ] **Step 1: Write the failing test**

★★★ **Task 10 changed this task too.** Two signals, not one, and the cache key in the original draft was wrong.

**The cache key is a SINGLE localStorage key holding a map**, `TIMELOG_ACTUALS_KEY = "aipm-cockpit:timelog-actuals"` → `Record<projectId, ActualsCacheEntry>`. There is no per-project suffix and no `cacheKey(id)` helper. Seed it by writing that one key with a map, or better, by calling `saveActualsCache` directly.

**Two states are worth surfacing and they are different:**
- **Ready to apply** — the cached overlay yields plan rows against the live buckets. (What the original draft targeted.)
- **Stale attribution** — `unattributed.hours > 0`. Hours the fetch could not place at all. This is the state the user's report was actually in, and no existing string mentions it. Attribution is frozen at fetch time, so a link fixed afterwards changes nothing until a re-fetch.

```tsx
describe("BudgetUnappliedNotice", () => {
  it("names the bucket count when the cached overlay yields a non-empty plan", () => {
    saveActualsCache("p1", entry({ byBucket: { 1: { "2026-08": { hours: 8, byResource: { 5: { hours: 8 } } } } } }));
    render(<BudgetUnappliedNotice lang="en-US" projectId="p1" buckets={[bucketWithRoleLine(1, 5)]} resources={[res(5)]} roles={[role()]} onGoToTimelog={() => {}} />);
    expect(screen.getByText(/1/)).toBeTruthy();
  });

  // ★ The state the user's report was in: hours exist but were never attributed,
  //   and the People/Projects tables meanwhile render the links as healthy.
  it("warns about unattributed hours even when the plan is empty", () => {
    saveActualsCache("p1", entry({ byBucket: {}, unattributed: { hours: 12 } }));
    render(<BudgetUnappliedNotice {...baseProps} />);
    expect(screen.getByText(new RegExp(t("en-US", "budgetUnattributedActuals").split("{0}")[0].trim()))).toBeTruthy();
  });

  it("renders nothing when the plan is empty and nothing is unattributed", () => {
    saveActualsCache("p1", entry({ byBucket: {}, unattributed: { hours: 0 } }));
    const { container } = render(<BudgetUnappliedNotice {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  // ★ Untrusted localStorage, possibly written by an older release.
  //   loadActualsCache does NOT throw (readDeviceJson try/catches and per-entry
  //   isEntry validation drops malformed entries silently) — this pins that.
  it("renders nothing and does not throw on a malformed cache", () => {
    window.localStorage.setItem("aipm-cockpit:timelog-actuals", "{{{not json");
    const { container } = render(<BudgetUnappliedNotice {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no cache at all", () => {
    window.localStorage.clear();
    const { container } = render(<BudgetUnappliedNotice {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  // ★★★ An external resource must never reach buildApplyPlan: it would resolve a
  //     roleId and cost their hours at an internal rate. Seed one and prove the
  //     component filters it — a fixture with no externals cannot express this.
  it("excludes external resources from the plan", () => {
    saveActualsCache("p1", entry({ byBucket: { 1: { "2026-08": { hours: 8, byResource: { 9: { hours: 8 } } } } } }));
    const { container } = render(
      <BudgetUnappliedNotice {...baseProps} buckets={[bucketWithRoleLine(1, 9)]} resources={[{ ...res(9), isExternal: true }]} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

Read `timelog-actuals-store.ts` for `saveActualsCache`'s real signature and the `ActualsCacheEntry` shape before writing `entry(...)`; do not invent a shape.

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/budget-unapplied-notice.test.tsx --reporter=dot
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
"use client";
// src/app/budget-unapplied-notice.tsx — read-only notice over the cached TimeLog
// actuals: hours the live bucket allocations could now absorb, and hours the
// fetch could not attribute at all.
//
// ★ Reads the actuals cache DIRECTLY rather than lifting useTimelogSync out of
//   the Timelog panel. The cache is plain localStorage and buildApplyPlan is
//   pure, so this costs one memo and no network.
// ★★ READ-ONLY BY DESIGN. Applying stays behind the confirm dialog, which
//   freezes the overlay and the budget baseline and refuses on a drifted
//   baseline. These are hand-editable money figures; nothing writes them here.
// ★★★ ATTRIBUTION IS FROZEN AT FETCH TIME. aggregateActuals resolves
//   user→resource and project→bucket once, at fetch, and folds every miss into a
//   dimensionless scalar `unattributed`. So a link the user fixes afterwards
//   changes nothing until a re-fetch — while the People/Projects tables render
//   that link as healthy, because they recompute live. That contradiction is the
//   reported bug; the second branch below is the only place the app admits it.
import { useMemo } from "react";
import { buildApplyPlan } from "./timelog-apply";
import { loadActualsCache } from "./timelog-actuals-store";
import { matchableResources } from "./resource-matching";   // extracted — see below
import { type Lang, t } from "./i18n";
import { TextButton } from "./button";
import type { BudgetBucket, Resource, Role } from "./types";

interface BudgetUnappliedNoticeProps {
  lang: Lang;
  projectId: string;
  buckets: readonly BudgetBucket[];
  resources: readonly Resource[];
  roles: readonly Role[];
  onGoToTimelog: () => void;
}

export function BudgetUnappliedNotice({
  lang, projectId, buckets, resources, roles, onGoToTimelog,
}: BudgetUnappliedNoticeProps) {
  const { affected, unattributedHours } = useMemo(() => {
    const cached = loadActualsCache(projectId)?.aggregates;
    if (!cached) return { affected: 0, unattributedHours: 0 };
    const rows = cached.byBucket
      ? buildApplyPlan(buckets, cached.byBucket, matchableResources(resources), roles).rows
      : [];
    return {
      affected: new Set(rows.map((r) => r.bucketId)).size,
      unattributedHours: cached.unattributed?.hours ?? 0,
    };
  }, [projectId, buckets, resources, roles]);

  if (affected === 0 && unattributedHours === 0) return null;
  return (
    <p className="mb-2 text-xs text-muted-foreground print:hidden">
      {affected > 0 && `${t(lang, "budgetUnappliedActuals", String(affected))} `}
      {unattributedHours > 0 && `${t(lang, "budgetUnattributedActuals", String(unattributedHours))} `}
      <TextButton onClick={onGoToTimelog} className="text-xs">
        {t(lang, "budgetUnappliedActualsGo")}
      </TextButton>
    </p>
  );
}
```

★★★ **`matchableResources` MUST be extracted, not approximated.** Today it is an inline `useMemo` in `timelog-panel.tsx` (`resources.filter((r) => !r.isExternal)`), not exported — and `workspace-section.tsx` passes `BudgetPanel` the FULL unfiltered list. Handing that list to `buildApplyPlan` would resolve an external's `roleId` and cost their hours at an internal rate, which is the exact defect the filter exists to prevent. Extract a pure exported helper, point `timelog-panel.tsx` at it in the same commit so there is one definition rather than two, and leave the other four hand-rolled `!r.isExternal` filters alone (`resource-directory.tsx`, `resource-workload.tsx`, `resources-panel.tsx`, `tasks-section.tsx`) — folding those in is a separate refactor and not this slice's job.

`loadActualsCache` **does not throw** on malformed JSON (`readDeviceJson` try/catches; per-entry `isEntry` validation drops bad entries silently). No `try/catch` is needed here. Keep the malformed-cache test anyway as a regression pin on that behaviour.

New EN/DE pairs, all cause-agnostic — after aggregation the app cannot tell an unlinked person from an unlinked project from an external resource, so naming a cause would be guessing:
- `budgetUnappliedActuals` (takes `{0}` = bucket count) — hours ready to apply
- `budgetUnattributedActuals` (takes `{0}` = hours) — hours that could not be placed, **and that fixing links will not recover until bookings are re-fetched**
- `budgetUnappliedActualsGo` — the link to Time bookings

- [ ] **Step 4: Mount it**

Render near the top of `budget-panel.tsx`, above the bucket cards. `onGoToTimelog` navigates to the Time bookings view — follow whatever nav helper the panel already has access to.

- [ ] **Step 5: Run tests + typecheck**

```
npx vitest run src/app/budget-unapplied-notice.test.tsx src/app/budget-panel.test.tsx --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-unapplied-notice.tsx src/app/budget-unapplied-notice.test.tsx src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(budget): surface cached TimeLog hours the buckets could now absorb

This is where the reported problem was invisible: the user was editing bucket
allocations on the Budget page with no signal that fetched bookings were
sitting unapplied.

Reads the per-project actuals cache directly and runs the pure buildApplyPlan
against live buckets, so it needs no network and does not lift useTimelogSync
out of the Timelog panel. Read-only — applying stays behind the confirm
dialog that freezes the overlay and the budget baseline.

A missing, empty or malformed cache renders nothing rather than throwing;
the cache is plain localStorage and may have been written by an older release.
EOF
```

---

# Item 6 — Gate the Time bookings page

### Task 13

**Files:**
- Modify: `src/app/timelog-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/timelog-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("TimelogPanel — not configured", () => {
  it("shows a Configure Timelog button instead of the page", () => {
    render(<TimelogPanel {...props({ cfg: { enabled: false } })} />);
    expect(screen.getByRole("button", { name: t("en-US", "timelogConfigure") })).toBeTruthy();
    // "timelogSync" is the FETCH button's label key — verified at plan time.
    // There is no `timelogFetch` key; `timelogClearAll` does not exist either
    // (the clear button uses the shared `clearAll`), and `timelogClearAllConfirm`
    // is the dialog copy, not a button name.
    expect(screen.queryByRole("button", { name: new RegExp(t("en-US", "timelogSync")) })).toBeNull();
  });

  // ★★★ canClearAllFetched deliberately omits isMisconfigured: broken
  //   credentials are exactly when someone needs to clear stale bookings, and
  //   gating it strands them with data they can neither refresh nor remove.
  //   Hiding the page must not re-create that trap.
  it("keeps Clear-all reachable when a cached fetch exists", () => {
    render(<TimelogPanel {...props({ cfg: { enabled: false }, fetchedAt: "2026-08-01T00:00:00.000Z" })} />);
    expect(screen.getByRole("button", { name: t("en-US", "clearAll") })).toBeTruthy();
  });

  it("offers no Clear-all when there is nothing cached", () => {
    render(<TimelogPanel {...props({ cfg: { enabled: false }, fetchedAt: undefined })} />);
    expect(screen.queryByRole("button", { name: t("en-US", "clearAll") })).toBeNull();
  });

  it("renders the full page when configured", () => {
    render(<TimelogPanel {...props({ cfg: { enabled: true, host: "h", apiToken: "t" } })} />);
    expect(screen.queryByRole("button", { name: t("en-US", "timelogConfigure") })).toBeNull();
  });
});
```

Key names verified at plan time against `timelog-panel-toolbar.tsx`: the fetch
button renders `timelogSync`, the clear button renders the shared `clearAll`,
and the refresh button renders `timelogRefresh`. Re-check with
`grep -n "t(lang," src/app/timelog-panel-toolbar.tsx` before writing the test —
this is the kind of name that moves.

- [ ] **Step 2: Run and confirm failure**

```
npx vitest run src/app/timelog-panel.test.tsx --reporter=dot
```
Expected: FAIL — the full page renders.

- [ ] **Step 3: Add the gate**

In `src/app/timelog-panel.tsx`, before the main return:

```tsx
  // ★★★ ESCAPE HATCH, NOT DECORATION. `canClearAllFetched` deliberately omits
  //     `isMisconfigured` — its docblock explains why: the cache is local data
  //     the user already has, and broken credentials are exactly the state in
  //     which someone wants to clear stale bookings. Hiding the page without
  //     carrying Clear-all forward would strand them with data they can neither
  //     refresh nor remove, which is the trap that guard exists to prevent.
  if (isMisconfigured) {
    return (
      <div ref={paneRef} className={/* same pane classes as the main return */}>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t(lang, "timelogNotConfigured")}</p>
          <Button onClick={onConfigureTimelog}>{t(lang, "timelogConfigure")}</Button>
          {sync.fetchedAt && (
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">{t(lang, "timelogCachedWhileOff")}</p>
              <Button variant="secondary" onClick={clearAllFetched}>{t(lang, "clearAll")}</Button>
            </div>
          )}
        </div>
      </div>
    );
  }
```

Thread `onConfigureTimelog?: () => void` from `task-manager.tsx` as a Settings → Timelog deep-link, mirroring how `onConfigureAi` is threaded to the chat panel.

**Do not touch `TimelogClearState`.** Its omission of `isMisconfigured` is load-bearing, and because the type does not carry the field, adding it later is a typecheck error rather than a silent behaviour change. Preserve that property.

New EN/DE pairs: `timelogNotConfigured`, `timelogConfigure`, `timelogCachedWhileOff`.

- [ ] **Step 4: Patch the German strings safely**

The Edit tool corrupts umlauts in `i18n.de.ts` and the file is CRLF. Write them with node:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  timelogEnable:";
if (!s.includes(anchor)) { console.error("anchor missing"); process.exit(1); }
s = s.replace(anchor, "  timelogNotConfigured: \"Die Timelog-Integration ist nicht aktiv.\",\r\n  timelogConfigure: \"Timelog einrichten\",\r\n  timelogCachedWhileOff: \"Zwischengespeicherte Buchungen sind noch vorhanden.\",\r\n" + anchor);
fs.writeFileSync(p, s, "utf8");
'
grep -c "timelogNotConfigured" src/app/i18n.de.ts
```

Match `\r\n`, not `\n` — a node replace using `\n` silently no-ops on this file. Then confirm the umlauts survived:

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8"); console.log(/fuer|druecken|ue\b/.test(s) ? "ASCII SUBSTITUTE PRESENT" : "ok");'
```

- [ ] **Step 5: Run tests + typecheck**

```
npx vitest run src/app/timelog-panel.test.tsx src/app/i18n-encoding.test.ts --reporter=dot
npx tsc --noEmit
```
Expected: PASS / exit 0. tsc enforces EN/DE key parity.

- [ ] **Step 6: Commit**

```bash
git add src/app/timelog-panel.tsx src/app/task-manager.tsx src/app/timelog-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(timelog): gate the Time bookings page behind Configure Timelog

Mirrors the AI Assistant's empty state when the integration is off.

The gate carries an escape hatch: if a cached fetch exists, the empty state
says so and keeps Clear-all. canClearAllFetched deliberately omits
isMisconfigured because broken credentials are exactly when someone needs to
clear stale bookings, and hiding the page outright would have stranded them
with data they could neither refresh nor remove. TimelogClearState is
untouched, so that omission stays a typecheck error to reverse rather than a
silent behaviour change.
EOF
```

---

# Release

### Task 14: version bump and docs

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Check who won the race**

```bash
git fetch origin main
git log --oneline -1 origin/main
grep -n "APP_VERSION" src/app/version.ts
```

`ai-recall-b2b-actor-waldrop` is also unmerged and also claims the next version. Take whatever is actually next given `origin/main` — do not assume 0.244.0.

- [ ] **Step 2: Bump all eight sites**

None of these is gated by CI. Miss one and the drift restarts.

1. `src/app/version.ts` — `APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE`
2. `CHANGELOG.md` — a new entry
3. `package.json` — `version`
4. `package-lock.json` — **two** occurrences: the root `version` and `packages[""]`
5. `README.md` — the shields badge: version **and** codename
6. `docs/CODEMAPS/*.md` — the generated header on **all five**

Add a `versionHighlight*` key to `i18n.ts`, `i18n.de.ts` **and** `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 3: Verify no site was missed**

```bash
V=$(grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' src/app/version.ts | head -1 | tr -d '"')
echo "version=$V"
grep -c "$V" package.json package-lock.json README.md CHANGELOG.md docs/CODEMAPS/*.md
```

Every file must report at least 1; `package-lock.json` at least 2.

- [ ] **Step 4: No session URLs**

```bash
grep -n "[session link removed]" CHANGELOG.md; echo "EXIT=$?"
```
Expected: EXIT=1, no output. A session URL must never appear in `CHANGELOG.md` or an MR description. Commit trailers are exempt.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
chore(release): bump version across all eight sites

Six items: inline change status, a change note log, a visible Send-inquiry
button on task rows, a resizable AI chat sidebar, Timelog refresh-and-reapply
with a Budget-side notice, and a Configure-Timelog gate.
EOF
```

---

### Task 15: full gate battery

- [ ] **Step 1: Run every gate, unpiped, reading exit codes directly**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
```

Run these **one at a time**. Never two vitest processes at once — machine saturation is the load-sensitive-flake condition.

If a run reports far fewer test files than `git ls-files '*.test.*' | wc -l`, and failures are `Test timed out` with `vitest-pool` in the log, that is a **fork-pool collapse, not N real failures**. Re-run with `--maxWorkers=4`; the shuffle seed is fixed, so the gate survives the throttle.

- [ ] **Step 2: Coverage floors**

`test:run` does not enforce them. New coverage-gated `.ts` files land in this slice (`change-status-select.tsx` and `budget-unapplied-notice.tsx` are `.tsx`, so excluded; `change-log.ts` additions are gated). Check `/tmp/cov.log` against global lines 92 / funcs 91 / branch 80 / stmts 89 plus the per-engine globs.

- [ ] **Step 3: axe, serially, against a warm server**

```bash
PORT=3100 npm run dev &
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3100/    # repeat until well under 1s
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Changes|Open Points|Time bookings"
PORT=3100 npm run stop
```

`--workers=1` is **mandatory** when matching more than one view. CI runs axe serially, local runs it at CPU count; over-subscription produces `Test timeout of 60000ms exceeded` failures that name no rule and are not violations. Read the failure body, not the summary line.

- [ ] **Step 4: prod CSP smoke**

```bash
npm run build
npm run e2e:smoke:prod
```

The only local check that sees the production CSP. Dev grants `'unsafe-inline'` on `style-src-elem` while prod is nonce-only. Nothing else — not the unit suite, not `e2e`, not `e2e:smoke` — meets that policy.

- [ ] **Step 5: Confirm the tree is clean**

```bash
git status --porcelain -uall
```

An untracked file hides from `git diff HEAD` and **is** charged by the coverage gate. Sweep for leftover mutants or scratch files before reporting green.

- [ ] **Step 6: Report**

Report each gate's actual exit code. A "green" claim is worth exactly what the exit code behind it is. Do not push, open an MR, or merge — that needs an explicit instruction.

---

## `docs/open-followups.md` entries owed (write these in Task 14)

Get the next number with — the `§` form finds only cross-references, and `sort -n` cannot parse a leading `## `:
```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

1. **Bulk edit bypasses `applyChangeStatus` on the Changes register.** Confirmed by review of `f3d4a25b`, pre-existing and untouched by it. `change-panel.tsx` `applyBulk` does `patched = { ...patched, status: patch.status as ChangeStatus }` and hands it to `onSave` → `handleSaveChange`, which only stamps `id`/`localModifiedAt`. So a bulk sweep to a decided status leaves `decisionDate` **unset**, and a sweep back to a pending status leaves it **stale** — both directions break the invariant. Sharpened by this slice: the inline path now guarantees the invariant while the bulk path does not, so two status entry points on the SAME table disagree. One-line fix: route that branch through `applyChangeStatus(patched, patch.status as ChangeStatus, today)`.
2. **TimeLog period keys are derived at fetch time from `granularity`.** Changing granularity between fetch and apply lands applied hours under period keys the budget report never reads. It does not suppress plan rows, so it is not the symptom behind Item 5 — but it is a live corruption path in the same cache. Found during Task 10's trace.
3. **Template import drops every register's note log.** Found during Task 4's sweep, deliberately NOT fixed there. `templateFromWorkspace` assigns `seed.changes = ws.changes` verbatim, so a template captured from a live project DOES carry note logs — and `templates.ts` `sanitizeArr(raw.changes, sanitizeChangeItem)` drops them on import. Tasks and RAID already behave the same way, so fixing changes alone would make the registers inconsistent. It cannot be fixed by re-attaching either: that path runs **no rich pass**, so `withStoredNoteLog` there would store un-sanitised HTML, and `templates.ts` is in the sample-generator import graph (§36(a)) so it cannot call `sanitizeNoteLog` to compensate. Any real fix needs a sanitised carry that stays DOM-free — same shape as §36(a) itself.
4. **The `ChangePanelMemo` docblock is already untrue** — it claims the parent wraps handler props in `useCallback`; `task-manager.tsx` passes `guardEdit(handler)` built unmemoized during render. Pre-existing, same class as the `ResourcesPanel` memo already documented in AGENTS.md. Correct the comment or delete the memo; do not cite it as a live optimisation.

---

## Manual verification owed

No test in this repo can cover these. jsdom has no layout, and the axe gate cannot see any of them either.

- **Task 10** — the Timelog repro. ✅ Closed statically (see Task 10's findings); what remains is one read of `localStorage["aipm-cockpit:timelog-actuals"]` on a project reproducing the report, to say WHICH sub-cause the user hit. Does not block Tasks 11–12, which are cause-agnostic.
- **Task 9 Step 5** — sidebar drag persists, bounds hold, and the thread list still scrolls independently. Turso project required; the sidebar does not mount in file mode.
- **Task 8 — Open Points action-column crowding.** The Send-inquiry button was added to every open row inside a `whitespace-nowrap` flex wrapper, so the cell WIDENS rather than wraps, pushing `⋮` right and squeezing neighbouring columns under `table-layout: auto`. German ("Anfrage senden") is longer than English. RAID does not pay this cost — its button stacks vertically inside a `flex-col`, consuming vertical space in an existing cell. If it looks crowded, the fallbacks are the RAID-style vertical stack or an icon-only button keeping the same `aria-label`. Deliberately NOT changed on a guess.
- **Task 7 — the sample master now carries change note logs** (changes 1 and 2, with 2 and 1 notes), so the `🗒 N` badge renders on both sample change rows. Relevant to any visual-regression baseline over the Changes register, and `e2e/seed.ts` reads that master at module top level.
