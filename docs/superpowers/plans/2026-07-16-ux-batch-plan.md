# UX Batch (post-0.189.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 34-item UX/feature batch (10 slices) in one release.

**Architecture:** Additive over `src/app` flat feature codebase. Two new persisted fields (RAID `inquiriesSent`, Task `noteLog`) get the full 6-write-path + CSV/MD column + golden-regen treatment. Modern task editor converts from full-page `TaskEditView` to the floating `TaskFormModal`. Everything else is UI/settings-level.

**Tech Stack:** Forked Next.js 16.2 / React 19.2 / TS. Gates: `npm run lint` (`--max-warnings=0`), `npx tsc --noEmit` (EN/DE i18n parity), `npm run test:run` (vitest), `npm run size:check`, `npm run dup:check`, i18n-encoding (literal UTF-8), `npm run e2e` (axe). Spec: `docs/superpowers/specs/2026-07-16-ux-batch-design.md`.

**Global rules (every task):**
- After editing any test → `npx tsc --noEmit` (test type errors pass vitest+build but fail CI).
- DE i18n edits via node utf8 write (Edit corrupts umlauts); literal UTF-8 (no `\u00XX` umlaut escapes); EN/DE key sets identical.
- New per-device flag → `settings-types.ts` (`Settings` + `defaultSettings` + sanitize on load), persisted via `writeSettings` spread (no allowlist edit). OUT of exports/Turso.
- New entity column → `*_CSV_COLUMNS` (csv-codecs-core) + `*_MD_COLUMNS` (+ MD decode arm) + `sanitizeX` + regen `__fixtures__/golden-*` + sample `.md`/`.csv` + `entity-persistence-registry.test.ts` row.
- After each task: run the task's tests + `npx tsc --noEmit`, then commit.
- Palette: AIPM tokens only; RAG via `--rag-*`; no raw shadow/gradient.
- Byte-check after multi-Edit sessions: `python -c "print(open(F,'rb').read().count(b'\x00'))"` == 0.

**Execution order:** Slice 4a + 10-noteLog (heavy fields, one golden regen) → 3a (task editor modal) → 10-gantt + 3 modal chrome → 1,2,5,6,7,8,9 + remaining singles → release.

---

## SLICE 1 — Toasts & reload

**Files:** `src/app/use-toast.ts`, `src/app/toast-context.tsx`, the toast render site (grep the component rendering `toast.text` — likely `app-modals.tsx`), `src/app/interaction-styles.ts` (reuse), `i18n.ts`/`i18n.de.ts`, reload-project caller.

### Task 1.1: Toast duration constant + `success` kind

**Files:** Modify `src/app/use-toast.ts`, `src/app/toast-context.tsx`; Test `src/app/use-toast.test.ts` (create if absent).

- [ ] **Step 1: Failing test** — `use-toast.test.ts`:
```ts
import { renderHook, act } from "@testing-library/react";
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import { useToast, TOAST_DURATION_MS } from "./use-toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("success kind is preserved (not collapsed to info)", () => {
  const { result } = renderHook(() => useToast());
  act(() => result.current.showToast("success", "done"));
  expect(result.current.toast?.kind).toBe("success");
});

test("auto-dismisses after TOAST_DURATION_MS", () => {
  const { result } = renderHook(() => useToast());
  act(() => result.current.showToast("info", "hi"));
  expect(result.current.toast).not.toBeNull();
  act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
  expect(result.current.toast).toBeNull();
});

test("duration is 7000ms", () => { expect(TOAST_DURATION_MS).toBe(7000); });
```
- [ ] **Step 2:** Run `npm run test:run -- use-toast` → FAIL (`TOAST_DURATION_MS` undefined, `"success"` not assignable).
- [ ] **Step 3:** Edit `use-toast.ts`: widen kind union to `"info" | "error" | "success"` everywhere (`Toast`, `useToast` sig, `showToast`, `showToastAction`), export `export const TOAST_DURATION_MS = 7000;`, replace `4000` with `TOAST_DURATION_MS`. Add `pause()`/`resume()` (Task 1.2 extends; for now add fields but keep behavior). Update `toast-context.tsx` `ShowToast`/`ShowToastAction` kind unions to include `"success"`.
- [ ] **Step 4:** Run tests → PASS. `npx tsc --noEmit` (union widening may surface call sites — none should break since callers pass string literals that are still valid).
- [ ] **Step 5:** Commit `feat(toast): 7s duration + success kind`.

### Task 1.2: Hover/focus pauses auto-dismiss + interaction states

**Files:** Modify `use-toast.ts` (pause/resume), the toast render component, Test `use-toast.test.ts`.

- [ ] **Step 1: Failing test** — add:
```ts
test("pause() stops the timer; resume() restarts it", () => {
  const { result } = renderHook(() => useToast());
  act(() => result.current.showToast("info", "hi"));
  act(() => { result.current.pause(); vi.advanceTimersByTime(TOAST_DURATION_MS + 1000); });
  expect(result.current.toast).not.toBeNull();          // paused → survives
  act(() => { result.current.resume(); vi.advanceTimersByTime(TOAST_DURATION_MS); });
  expect(result.current.toast).toBeNull();               // resumed → dismisses
});
```
- [ ] **Step 2:** Run → FAIL (`pause`/`resume` undefined).
- [ ] **Step 3:** Rework `use-toast.ts` timer to a ref-based timer with pause/resume:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
export const TOAST_DURATION_MS = 7000;
export type ToastAction = { labelKey: TranslationKey; run: () => void };
type ToastKind = "info" | "error" | "success";
type Toast = { kind: ToastKind; text: string; id: number; action?: ToastAction };

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const clear = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  const arm = useCallback(() => { clear(); if (!pausedRef.current) timerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS); }, []);
  useEffect(() => { if (toast) arm(); return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on toast.id
  }, [toast?.id]);
  const pause = useCallback(() => { pausedRef.current = true; clear(); }, []);
  const resume = useCallback(() => { pausedRef.current = false; arm(); }, [arm]);
  const showToast = useCallback((kind: ToastKind, text: string) => { pausedRef.current = false; setToast({ kind, text, id: Date.now() }); }, []);
  const showToastAction = useCallback((kind: ToastKind, text: string, action: ToastAction) => { pausedRef.current = false; setToast({ kind, text, id: Date.now(), action }); }, []);
  return { toast, showToast, showToastAction, pause, resume };
}
```
- [ ] **Step 4:** In the render component, on the toast container add `onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}` (thread `pause`/`resume` from the `useToast` instance — likely in task-manager where `useToast()` is created and passed into `ToastProvider`; add them to the provider `value` OR pass into the render component directly). Add `success` kind styling (green `--rag-green` bg/border; mirror error's pink). Append `INTERACTIVE` to the toast action button + close (if any).
- [ ] **Step 5:** Run tests → PASS; `npx tsc --noEmit`; commit `feat(toast): hover/focus pause + interaction states`.

### Task 1.3: Reload-project success/error toast + tooltip

**Files:** grep the reload-project button + handler (storage/project ops surface — e.g. `use-storage-backend.ts` or the header control). `i18n`.

- [ ] **Step 1: Failing test** — a test on the reload handler asserting `showToast("success", …)` on success and `showToast("error", …)` on a thrown reload. (Mock the backend; spy on a passed `showToast`.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Wrap the reload op in try/catch; on success `showToast("success", t(lang,"reloadProjectSuccess"))`, on error `showToast("error", t(lang,"reloadProjectError"))`. Add `title={t(lang,"reloadProjectTooltip")}` + `aria-label` to the button. Add 3 i18n keys EN+DE.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(project): reload success/error toast + tooltip`.

---

## SLICE 2 — M365 toasts + pull contacts

**Files:** `use-entity-calendar-push.ts`, `use-entity-calendar-pull.ts`, `use-outlook-calendar-push.ts`, `use-milestone-calendar-pull.ts`, `use-committee-outlook-push.ts` (audit), `resources-panel.tsx`, `use-outlook-contacts.ts` + `outlook-contacts.ts` (reuse), `i18n`.

### Task 2.1: Manual push/pull error-toast audit

- [ ] **Step 1:** Read each hook's manual (interactive) catch path. For any manual path that logs but does NOT `showToast("error", …)`, add an error toast. Background (`interactive:false`/`background:true`) paths stay silent (assert unchanged). Write/adjust a test per hook where a manual push rejects → error toast fired.
- [ ] **Step 2–5:** TDD each gap; PASS; commit `fix(calendar): error toast on every manual push/pull`.

### Task 2.2: Pull-contacts button in directory

**Files:** Modify `resources-panel.tsx`; Test `resources-panel.test.tsx` (or a hook test).

- [ ] **Step 1: Failing test** — with `m365Configured` true, a "Pull contacts" button renders; clicking calls the pull handler; a contact whose email matches an existing resource is skipped, a new email is added. (Mock `useOutlookContacts` to return 2 contacts, one dup.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add a `pullContacts` handler: `const contacts = await fetchContacts();` (from `use-outlook-contacts`), dedupe by case-folded email vs `resources`, add missing via functional `setResources(prev => [...prev, ...newOnes.map(mapContactToResource)])` with `nextEntityId`. Button in `resources-panel` header actions, gated `m365Configured && !isPopout`, `aria-label` + loading state. Toast `contactsPulledN` (added count) / `contactsPullNone` / `error`. Add i18n keys EN+DE.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe:** `npx playwright test e2e/a11y.spec.ts -g "Resources"`; commit `feat(directory): pull contacts from Outlook`.

---

## SLICE 3 — Modal chrome

### Task 3a.1: Modern task editor → floating modal

**Files:** `task-manager.tsx` (editView wiring + `useEditView`), `modern-shell.tsx`/`shell-chrome.tsx` (editView slot), `task-form-modal.tsx`, retire `task-edit-view.tsx`, `task-editor-actions.tsx`, `task-manager.characterization.test.tsx`, any `TaskEditView` test.

- [ ] **Step 1: Failing test** — in `task-manager.characterization.test.tsx` (or a new test) assert: in modern layout, opening a task editor renders the `TaskFormModal` (role=dialog) and NOT a full-page `TaskEditView` region. (Query `getByRole("dialog")`.)
- [ ] **Step 2:** Run → FAIL (currently full-page).
- [ ] **Step 3:** Set `useEditView = false` effectively — always render `TaskFormModal` for edit (modern included). Remove the `editView` slot wiring from `ModernShell`; pass the delete affordance via the modal's existing `deleteAction` prop (move `footerLeading` content there). Delete `task-edit-view.tsx`; drop its imports. Ensure the Jira read-only banner still threads to `TaskFormModal` (via `app-modals.tsx`). `TaskFormModal` already has `useDraggable("aipm-cockpit:modal-pos:task-form")` + `useResizable` + reset — no change needed there.
- [ ] **Step 4:** Run → PASS. Update characterization/prop-contract tests. `npx tsc --noEmit` (remove now-unused `TaskEditView` types). `npm run size:check` (retiring the file frees budget). **axe:** Open Points + any edit surface.
- [ ] **Step 5:** Commit `refactor(task-editor): modern uses floating modal (retire full-page view)`.

### Task 3b.1: `useAutogrow` hook

**Files:** Create `src/app/use-autogrow.ts`; Test `src/app/use-autogrow.test.ts`.

- [ ] **Step 1: Failing test**:
```ts
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useAutogrow } from "./use-autogrow";
test("sets inline height from scrollHeight on value change", () => {
  const el = document.createElement("textarea");
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 120 });
  const { rerender } = renderHook(({ v }) => { const ref = useRef(el); useAutogrow(ref, v); }, { initialProps: { v: "a" } });
  rerender({ v: "abc\ndef" });
  expect(el.style.height).toBe("120px");
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Create `use-autogrow.ts`:
```ts
"use client";
import { useEffect, type RefObject } from "react";
/** Grows a textarea to fit its content (reset → read scrollHeight → set inline height). */
export function useAutogrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
```
- [ ] **Step 4:** Run → PASS; commit `feat(ui): useAutogrow hook`.

### Task 3b.2: Apply autogrow to edit-modal textareas

**Files:** `raid-edit-modal.tsx`, `change-edit-modal.tsx`, `stakeholder-edit-modal.tsx`, task form notes, absence/resource edit modals. Also refactor `dashboard-narrative.tsx` to use the hook (DRY, optional).

- [ ] For each multiline `<textarea>`: add a `useRef`, call `useAutogrow(ref, value)`, attach `ref`, add `className="… resize-none"`, and (if it already has an `onInput`/dictation append) also trigger a resize by keeping value-driven effect. Remove static `rows={N}` or keep as a min via `rows={2}`.
- [ ] Test: one modal test stubbing `scrollHeight`, asserting height grows on input. `npx tsc --noEmit`; commit `feat(modals): autogrow description textareas`.

### Task 3b.3: Drag/resize/reset on SharePoint-picker, RAID-edit, Resource-edit, Absence-edit

**Files:** `sharepoint-picker-modal.tsx`, `raid-edit-modal.tsx`, resource/absence edit modals, reuse `edit-modal-chrome.tsx`/`useDraggable`/`useResizable`/`ResetSizeIcon`.

- [ ] For each: add `useDraggable("aipm-cockpit:modal-pos:<name>")` + `useResizable("aipm-cockpit:modal-size:<name>")`, wire the drag handle + resize + a reset button rendering `ResetSizeIcon` (mirror `task-form-modal.tsx` / `EditModalShell`). Distinct keys.
- [ ] Test per modal: pos/size persist to the keyed localStorage; reset clears both. `npx tsc --noEmit`; **axe** RAID (scanned). Commit `feat(modals): drag/resize/reset on sharepoint/raid/resource/absence`.

### Task 3d.1: Hide field-config controls (mode toggle + cog)

**Files:** `settings-types.ts`, Appearance settings section, `modal-field-controls.tsx`, `i18n`.

- [ ] **Step 1: Failing test** — `ModalFieldControls` renders `null` when `showFieldConfig` is false. (It reads the flag via `useSettings()` or a prop — prefer reading `useSettings().showFieldConfig !== false` inside the component.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `settings.showFieldConfig?: boolean` (default true) + `defaultSettings`. `ModalFieldControls`: `const { showFieldConfig } = useSettings(); if (showFieldConfig === false) return null;`. Add a `SegmentedControl`/toggle in Settings → Appearance (`ariaLabel`), persist via `writeSettings` spread. i18n EN+DE.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe** Settings→Appearance; commit `feat(settings): hide field-config controls toggle`.

### Task 3e.1: Reset-icon audit

- [ ] Grep modals for any reset control not using `ResetSizeIcon`; replace with `ResetSizeIcon`. (Investigation says it's already standard — likely a no-op verification; if none found, skip with a note in the commit.)

---

## SLICE 4 — RAID

### Task 4a.1: 🔴 `RaidItem.inquiriesSent` field (persistence)

**Files:** `types.ts`, `sanitize-records.ts`, `csv-codecs-core.ts` (`RAID_CSV_COLUMNS`), `markdown-codecs-core.ts`/`markdown-codecs-decode.ts` (`RAID_MD_COLUMNS` + decode arm), `__fixtures__/golden-*`, `sample-workspace-small.md` + `.csv`, `entity-persistence-registry.test.ts`.

- [ ] **Step 1: Failing test** — registry round-trip: a RaidItem with `inquiriesSent: 3` survives CSV and MD round-trip (add to `entity-persistence-registry.test.ts`); `sanitizeRaidItem` clamps a negative/NaN to 0/undefined.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:**
  - `types.ts`: add `inquiriesSent?: number;` to `RaidItem`.
  - `sanitizeRaidItem`: sanitize `inquiriesSent` via `toNumber` clamped ≥0 (sparse-emit; absent stays undefined to keep legacy byte-stable).
  - `RAID_CSV_COLUMNS`: append `"inquiriesSent"` with the generic number `fieldToString`/`build*FromObj` arm (mirror how tasks handle it).
  - `RAID_MD_COLUMNS` + MD decode arm.
- [ ] **Step 4:** Regenerate golden: `npx vite-node scripts/generate-sample-workspace.ts` (if the sample gains the column — else edit sample `.md` exact-line + `.csv` via codec) then regen `__fixtures__/golden-*`. Run `npm run test:run -- golden-workspace entity-persistence` → PASS (RAID-only byte diff).
- [ ] **Step 5:** `npx tsc --noEmit`; commit `feat(raid): persist inquiriesSent across all backends`.

### Task 4a.2: RAID send-inquiry UI + handler

**Files:** `raid-panel-rows.tsx`, `raid-edit-modal.tsx`, a raid inquiry handler in `raid-panel.tsx`/task-manager (mirror task `sendInquiry`), `i18n`.

- [ ] **Step 1: Failing test** — clicking "Send inquiry" on a RAID row opens a mailto (spy on `window.location`/`open` mock) and bumps `inquiriesSent` via a functional setter (mock `onSaveRaid`, assert prev-based).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Handler: resolve owner email (`ownerEmail` or from `ownerResourceId` live), build `mailto:?subject=…&body=…`, `setRaid(prev => prev.map(r => r.id===id ? {...r, inquiriesSent:(r.inquiriesSent??0)+1} : r))`. Button in row (active items, row-unique aria-label `${sendInquiry} – ${item.title}`) + modal footer.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe** RAID; commit `feat(raid): send inquiry with tracked count`.

### Task 4b.1: RAID assignee/owner filter

**Files:** `raid-panel.tsx` (`RAID_FILTER_DEFAULTS`), `raid-panel-toolbar.tsx`, `raid-panel-rows.tsx` derive.

- [ ] **Step 1: Failing test** — selecting an owner narrows rows to that owner.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `owner: ""` to `RAID_FILTER_DEFAULTS`; owner `<select>` in toolbar (options = distinct owners by live name/`ownerResourceId`, row-unique not needed — single control). Hoist `pf.filters.owner` to a scalar local before the derive memo; filter in the rows derivation.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(raid): filter by owner`.

### Task 4c.1: Push button restyle (match milestone)

**Files:** `calendar-sync-controls.tsx`.

- [ ] Change the PUSH button className from `border border-AIPM-dark-blue bg-surface … text-AIPM-dark-blue` to the milestone neutral style `border border-line bg-surface … text-foreground` and add a leading icon (match `milestones-panel` push button). (Pull button already neutral.)
- [ ] Test: snapshot/class assertion; **axe** RAID; commit `style(calendar): unify push button with milestone style`.

---

## SLICE 5 — Open points

### Task 5.1: RAG status filter

**Files:** `filters-context.tsx`, tasks toolbar, task derivation, `i18n`.

- [ ] **Step 1: Failing test** — `healthFilter: "red"` yields only red-RAG tasks.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `healthFilter: "all"|"red"|"amber"|"green"` to `FiltersValue` + default `"all"` + setter. Toolbar control (segmented/select, single labeled). Derive each task's RAG via the existing health engine feeding the "status"/Health dot; filter rows.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe** Open Points; commit `feat(tasks): RAG status filter`.

### Task 5.2: Bulk delete selected

**Files:** `use-bulk-operations.ts`, `tasks-section.tsx` (BulkEditBar), `i18n`.

- [ ] **Step 1: Failing test** — `handleBulkDelete(new Set([1,3]))` removes only tasks 1 and 3 (functional setter); the button opens a TypeToConfirm dialog.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** `handleBulkDelete(ids: Set<number>)` → `setTasks(prev => prev.filter(t => !ids.has(t.id)))` (arm destructive save like clear-all). Button in `BulkEditBar` (shown when `selectedIds.size>0`), gated by `TypeToConfirmDialog` (type `"delete N tasks"`). Distinct from global Clear-all.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(tasks): bulk delete selected`.

### Task 5.3: Rightmost actions → ⋮ overflow

**Files:** `task-row.tsx` (`TaskActions`), reuse `ActionOverflowMenu`/`PopoverPanel`, `i18n`.

- [ ] **Step 1: Failing test** — `TaskActions` renders Edit inline; Send-inquiry / Push-Jira / Delete live behind a ⋮ menu (open the menu, assert the 3 items). Row-unique overflow aria-label.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Keep Edit as an inline button; wrap the other 3 in `ActionOverflowMenu` (PopoverPanel-based) with `aria-label={`${overflow} – ${task.title}`}`; preserve `stopPropagation`; keep Jira-synced disabled states. If any of these are shared with Kanban cards, pass props (board is outside `RowContextProvider`).
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe** Open Points; commit `feat(tasks): overflow menu for row actions`.

### Task 5.4: Shrink first-column gutter

**Files:** `tasks-section.tsx` (the `<col className="w-8"/>` + `<th className="w-8" aria-hidden/>`).

- [ ] Change `w-8` → `w-6` (or fold the Ask-Claude anchor into the title cell). Verify the inline Ask-Claude popover still anchors. Test: existing tasks-section tests pass. Commit `style(tasks): reclaim first-column gutter width`.

---

## SLICE 6 — Undo/redo labeling

**Files:** `undo/` (entry type + `undo-control.tsx`), capture sites, `i18n`.

### Task 6.1: Human label on undo entries + toast

- [ ] **Step 1: Failing test** — capturing an undo entry for a task edit carries `label` (e.g. contains the task title); performing undo fires `showToast("info", undoneLabel)`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `label: string` to the undo entry type; build it at each capture site from op + entity name. On undo/redo, `showToast("info", t(lang,"undone",label))` / `t(lang,"redone",label)` (positional `{0}`). Truncate label.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(undo): label + toast on undo/redo`.

### Task 6.2: Nav undo caret dropdown (next-step preview)

**Files:** `undo-control.tsx`, reuse PopoverPanel/`usePopoverDismiss`.

- [ ] **Step 1: Failing test** — a caret button beside Undo opens a popover showing the next undo entry's label.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add a caret button (own aria-label `undoShowNext`) opening a PopoverPanel with the single next entry's label (non-interactive text or a button doing the same single undo). Main button unchanged. Optionally mirror redo.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(undo): Excel-style next-step caret preview`.

---

## SLICE 7 — Tips & saved-views toggles

**Files:** `view-callouts.ts`, `stakeholder-map-panel.tsx`, `dashboard-tip-card.tsx`, `settings-types.ts`, Appearance section, saved-views controls, `i18n`, guard test.

### Task 7.1: Tips banner on influence/interest + global tips toggle

- [ ] **Step 1: Failing test** — with hints on, `stakeholder-map-panel` renders a `ViewCallout`; with the global tips toggle off, both the callout and the dashboard tip card hide.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add a `VIEW_CALLOUTS` entry for the stakeholder-map view (text + existing `conceptId` — keep the guard test green). Mount `ViewCallout` atop `stakeholder-map-panel` (props-only, gated `showViewHints && !isPopout`). Wire `dashboard-tip-card` to the same global tips flag (`showViewHints` umbrella, or a new `settings.showTips?` — DEFAULT: reuse `showViewHints` as the single "Show tips" control, relabel in Settings). Ensure Settings → Appearance has one "Show tips" toggle.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe** Settings→Appearance; commit `feat(tips): stakeholder-map banner + global toggle`.

### Task 7.2: Global saved-views toggle

- [ ] **Step 1: Failing test** — with `showSavedViews` false, `SavedViewsMenu`-based controls render `null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `settings.showSavedViews?` (default true). Each of the 3 controls returns `null` when off (read `useSettings().showSavedViews !== false`). Settings → Appearance toggle (`ariaLabel`), `writeSettings` spread.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(settings): global saved-views toggle`.

---

## SLICE 8 — AI assistant

**Files:** `chat-panel.tsx`, `chat-api.ts`, `ai-errors.ts`, `chat-attachments.ts`, `step0-import-panel.tsx`, `i18n`.

### Task 8.1: Closable error banner

- [ ] **Step 1: Failing test** — the error banner shows an X; clicking clears the error.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add an X button (aria-label `dismiss`) to the `role="alert"` banner → `setError(null)`.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(ai): closable error banner`.

### Task 8.2: Show 400 response text (safe)

**Files:** `ai-errors.ts`, `chat-api.ts`, `chat-panel.tsx`, `i18n`.

- [ ] **Step 1: Failing test** — `safeAiErrorMessage({error:{message:"prompt is too long: ..."}})` returns the (control-stripped, truncated) text; a non-object/malformed body returns undefined and never throws. `callClaude` on a 400 attaches it to `AiHttpError.safeMessage`; the banner surfaces it.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In `ai-errors.ts` add `safeAiErrorMessage(body: unknown): string | undefined` reading ONLY `body.error.message` (typeof guards, `.replace(/[\x00-\x1f]/g,"")`, slice(0,500)); add `safeMessage?` to `AiHttpError`. In `chat-api.ts` `callClaude`, on `!res.ok` parse body once, pass both `safeAiErrorType` and `safeAiErrorMessage` into `AiHttpError`. In `chat-panel.tsx`, when the classified error is a `limit`/`generic` 400 with a `safeMessage`, show `${chatError} — ${safeMessage}`. **Security:** never read/log the request body or key; only the RESPONSE body's `error.message` is surfaced (carries no secret).
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(ai): surface 400 response message`.

### Task 8.3: HTML + VTT ingestion

**Files:** `chat-attachments.ts`, `chat-panel.tsx` + `step0-import-panel.tsx` accept lists, test.

- [ ] **Step 1: Failing test** — `classifyAttachment` maps `text/html` and `text/vtt` (and `.html`/`.htm`/`.vtt` by extension) to the `"text"` kind.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `text/html`, `text/vtt` to the text MIME set + `.html`,`.htm`,`.vtt` extension fallback. Append to both `accept` strings.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(ai): read html + vtt attachments`.

---

## SLICE 9 — Steering committee

**Files:** `steering-committee-panel.tsx`, `use-committee-outlook-push.ts`, `committee-report-panel.tsx`, `i18n`.

### Task 9.1: Per-row Outlook push

- [ ] **Step 1: Failing test** — a per-row push button on a meeting/schedule pushes ONLY that entry (mock the reconcile; assert single-target).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Extend `use-committee-outlook-push` to accept an optional target (meeting id / schedule id) → single-entry reconcile (respect id-tracked `planCommitteeReconcile`, no cross-delete). Add a push button to each meeting row + each info-schedule row (row-unique aria-label, gated `m365Configured && !isPopout`). Keep a panel-level "push all".
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(steering): per-row Outlook push`.

### Task 9.2: Status-report chrome (resize/reset/print/cancel)

- [ ] **Step 1: Failing test** — the report surface renders resize + reset-size + print + cancel controls.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Wrap the report surface in the standard resizable content-pane shell: `useResizable("aipm-cockpit:committee-report-size")` + `ResetSizeButton` + `PrintButton` (+ `print-root`) + a cancel/close button.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(steering): status-report resize/reset/print/cancel`.

---

## SLICE 10 — Singles

### Task 10.1: App rename → "AI PM Cockpit"

**Files:** `i18n.ts`/`.de.ts` (`appTitle`), `layout.tsx` metadata title; grep other literals.

- [ ] Change `appTitle` "AIPM Cockpit" → "AI PM Cockpit" (EN+DE) + `layout.tsx` `metadata.title`. Grep `AIPM Cockpit` for stragglers. Test: a title assertion if one exists. Commit `chore(brand): rename to "AI PM Cockpit"`.

### Task 10.2: Directory empty text

**Files:** `i18n.ts`/`.de.ts` (`resourcesEmpty`).

- [ ] `resourcesEmpty` → "No contacts available." (EN) + DE. Commit `fix(directory): correct empty-state text`.

### Task 10.3: Search 2× wider

**Files:** `shell-chrome.tsx`/`top-bar.tsx` search slot.

- [ ] Widen the search slot container (input is `w-full`): give it a wider basis / `min-w` (~2×) in both header mounts. Eye-check ~375px doesn't overflow. **axe** top bar (scanned every view). Commit `style(search): widen top-bar search`.

### Task 10.4: Reschedule shows current due date

**Files:** `reschedule-popover.tsx`, its caller (thread current due).

- [ ] **Step 1: Failing test** — the popover shows the task's current due date and prefills the input with it.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Thread the current due date into `ReschedulePopover` (resolve from the action's task). Show it as a label (`t(lang,"currentDueDate", due)`), and `setDate(currentDue)` when opening instead of `setDate("")`.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(actions): reschedule shows current due date`.

### Task 10.5: 🔴 Task `noteLog` field + "I am" setting

**Files:** `types.ts`, task CSV/MD columns + JSON-cell codec, `settings-types.ts` (`selfResourceId`), task editor notes UI, golden regen, sample, registry test, `i18n`.

- [ ] **Step 1: Failing test** — a Task with `noteLog:[{authorName:"Ann",timestamp:"2026-07-16T…",text:"hi"}]` round-trips CSV+MD (JSON-encoded cell); load-time validation caps length, strips control chars, drops bad timestamps. `selfResourceId` sanitizes to a number|undefined.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:**
  - `types.ts`: `export interface NoteLogEntry { authorResourceId?: number; authorName?: string; timestamp: string; text: string; }` + `noteLog?: NoteLogEntry[]` on `Task`.
  - CSV/MD: append a `noteLog` column to the task columns; encode array → JSON string in one cell (escape per codec), decode + validate on read (cap entries, trim text, ISO-guard `timestamp`, `/[\x00-\x1f]/g` strip). Keep existing free-text `notes` untouched.
  - `settings.selfResourceId?: number` (default undefined) + sanitize.
- [ ] **Step 4:** Regen golden (`__fixtures__/golden-*`) + sample `.md`/`.csv` noteLog column; `npm run test:run -- golden-workspace entity-persistence` → PASS (task-only diff).
- [ ] **Step 5:** `npx tsc --noEmit`; commit `feat(tasks): persist structured noteLog + self-resource setting`.

### Task 10.6: Note-log UI

**Files:** task editor notes section, a directory-author dropdown, Settings "I am" picker, `i18n`.

- [ ] **Step 1: Failing test** — adding a note appends `{authorResourceId?, timestamp, text}` (author defaults from `selfResourceId`, overridable); render shows one line per entry `<author> <timestamp>: <text>`, visually distinct.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add an "add note" input + author dropdown (directory) in the task editor; append via functional setter; timestamp via `new Date().toISOString()` in the handler (not render). Render entries as distinct lines. Settings → a "I am this resource" directory `<select>` writing `selfResourceId`.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(tasks): note-log entry UI`.

### Task 10.7: Workload (resource planner) absence colors

**Files:** create `src/app/absence-style.ts` (extract from `resource-calendar.tsx`), `resource-calendar.tsx` (use shared), resource-planner/capacity view, `i18n` (legend labels exist).

- [ ] **Step 1: Failing test** — `absenceBg("sick")` returns the pink token class (shared util); resource-calendar still returns identical classes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Extract `absenceBg`/`absenceGlyph`/legend from `resource-calendar` into `absence-style.ts` (byte-identical maps: vacation AIPM-blue/30, sick AIPM-pink/30, training AIPM-purple/30, other AIPM-medium-grey/45). Use it in the resource-planner/capacity view to color upcoming absence cells/markers by type + a legend.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; commit `feat(planner): color absences by type`.

### Task 10.8: Gantt milestone placement toggle

**Files:** `use-gantt-prefs.ts`, `gantt-engine.ts`, `gantt.tsx`, `gantt-rows.tsx`, `gantt-chrome.tsx` (`GanttToolbar`), `i18n`.

- [ ] **Step 1: Failing test** — `use-gantt-prefs` exposes `milestonePlacement` (default `"below"`); with `"inline"`, the row builder inserts each non-achieved milestone as its own row at its chronological (due-date) position among task rows; `"below"` keeps the current date|id section.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `milestonePlacement: "below"|"inline"` to gantt prefs (localStorage hydrate/persist). In the engine/row assembly, when `"inline"`, merge milestone rows into the task-row list sorted by date; when `"below"`, current behavior. Toolbar toggle in `gantt-chrome` (pinned label + `aria-pressed` — e.g. "Inline milestones"); respect self-dep/critical-path derivations; `GanttMilestoneRow` stays pure.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit`; **axe** Gantt; the markup-order source test reads `gantt-chrome.tsx` — keep green. Commit `feat(gantt): inline-vs-below milestone placement toggle`.

---

## Final: Release

- [ ] **Task R.1:** Bump `src/app/version.ts` (APP_VERSION + a unique milestone codename — grep CHANGELOG to avoid a dup; APP_BUILD_DATE = release date). Append one `versionHighlight*` key per user-visible theme (Toasts, Modals, RAID, OpenPoints, Undo, AI, Steering, Gantt, Rename, Notes) to `APP_HIGHLIGHT_KEYS` + EN/DE strings (DE via node utf8, literal UTF-8).
- [ ] **Task R.2:** CHANGELOG.md entry.
- [ ] **Task R.3:** Full gate sweep: `npm run lint` · `npx tsc --noEmit` · `npm run test:run` · `npm run size:check` · `npm run dup:check` · `npm run e2e` (or the targeted axe views touched). Byte-check all edited files for NUL (`count(b'\x00')==0`).
- [ ] **Task R.4:** Await explicit "release" trigger (push → MR → poll → merge-on-green). Do NOT push/MR/merge without it.

---

## Self-review notes

- **Spec coverage:** all 34 items mapped to a task (Slices 1–10). Toast hover/duration/success (1), reload toast (1.3), M365 toasts + pull-contacts (2), task-editor modal + drag/resize/reset audit + autogrow + hide-field-config + reset-icon (3), RAID inquiry+filter+button (4), open-points RAG filter/bulk-delete/overflow/first-col (5), undo labels+caret (6), tips banner+global + saved-views toggle (7), AI closable+400-text+html/vtt (8), steering per-row+report-chrome (9), rename/empty-text/search-width/reschedule-due/noteLog/planner-colors/gantt-toggle (10).
- **Type consistency:** `NoteLogEntry` shape fixed in 10.5, consumed in 10.6; `TOAST_DURATION_MS`/`pause`/`resume` defined in 1.1/1.2; `safeAiErrorMessage`/`safeMessage` in 8.2.
- **Heavy (🔴) fields:** 4a.1 (RAID inquiriesSent), 10.5 (Task noteLog) — each own golden regen; sequence them first per execution order so the golden regens don't collide with later work.
