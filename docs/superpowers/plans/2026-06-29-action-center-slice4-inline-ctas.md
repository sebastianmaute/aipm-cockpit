# Action Center Slice 4 — Inline CTAs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add four in-place resolutions to Action Center rows — Assign owner, Mark done, Clear blocker, Reschedule — mutating the workspace via the established bundle pattern.

**Architecture:** New `reschedule-popover.tsx`; gating + render in `action-row.tsx`; handlers built in `task-manager.tsx` (popout→undefined, functional `setTasks`), threaded task-manager → `workspace-section-types` → `workspace-section` → `actions-panel` → `action-row`. No sanitizer (single-field changes are safe by construction). Branch `feat-action-center-slice4` off `feat-action-center-slice3`.

**Tech Stack:** Next.js 16 / React 19 / TS / Vitest. `npx tsc --noEmit`, `npm run lint`, `npm run test:run`. `actions` view not axe-gated → eye-verify.

**Spec:** `docs/superpowers/specs/2026-06-29-action-center-slice4-inline-ctas-design.md`

---

## File Structure
- **Modify** `src/app/i18n.ts` + `i18n.de.ts` — 8 keys.
- **Create** `src/app/reschedule-popover.tsx` (+ `RescheduleBundle`) + `.test.tsx`.
- **Modify** `src/app/action-row.tsx` (+ test) — props, gating, render.
- **Modify** `src/app/actions-panel.tsx` (+ test) — thread 3 props.
- **Modify** `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx`, `src/app/task-manager.tsx` (+ handler test) — build + thread.

---

## Task 1: i18n — 8 keys (EN + DE)

**Files:** `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: EN keys** — in `src/app/i18n.ts`, after `actionMoreActions: "More actions",` add:
```ts
  actionMarkDone: "Mark done",
  actionClearBlocker: "Clear blocker",
  actionReschedule: "Reschedule",
  actionRescheduleTitle: "New due date",
  actionRescheduleConfirm: "Update",
  actionTaskCompleted: "Task marked done",
  actionBlockerCleared: "Blocker cleared",
  actionRescheduled: "Due date updated",
```

- [ ] **Step 2: DE keys via node utf8 write (NOT Edit)** — anchor on the DE `actionMoreActions` line. First grep it: `grep -n 'actionMoreActions:' src/app/i18n.de.ts` → it reads `  actionMoreActions: "Weitere Aktionen",`. Run:
```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  actionMoreActions: \"Weitere Aktionen\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const add =
  "  actionMarkDone: \"Als erledigt markieren\",\r\n" +
  "  actionClearBlocker: \"Blocker entfernen\",\r\n" +
  "  actionReschedule: \"Neu planen\",\r\n" +
  "  actionRescheduleTitle: \"Neues Fälligkeitsdatum\",\r\n" +
  "  actionRescheduleConfirm: \"Aktualisieren\",\r\n" +
  "  actionTaskCompleted: \"Aufgabe als erledigt markiert\",\r\n" +
  "  actionBlockerCleared: \"Blocker entfernt\",\r\n" +
  "  actionRescheduled: \"Fälligkeitsdatum aktualisiert\",\r\n";
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s, "utf8");
console.log("DE keys added");
'
```
Expected `DE keys added`. If `ANCHOR NOT FOUND`, STOP and report.

- [ ] **Step 3: Verify + commit** — `npm run test:run -- src/app/i18n-encoding` PASS (real `ä` in Fälligkeitsdatum); `npx tsc --noEmit` clean.
```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add inline-CTA + toast keys (EN/DE)"
```
No push, no attribution trailers.

---

## Task 2: ReschedulePopover

**Files:** Create `src/app/reschedule-popover.tsx` + `src/app/reschedule-popover.test.tsx`.

- [ ] **Step 1: Failing test** — `src/app/reschedule-popover.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReschedulePopover } from "./reschedule-popover";

const action = {
  id: "task-due:1:overdue", source: "task-due",
  title: { key: "actionTaskTitle", params: ["T"] },
  why: { key: "actionTaskWhyOverdue", params: [2] }, score: 70, tier: "now",
  cta: { kind: "open", view: "open-points", id: 1 },
} as never;

describe("ReschedulePopover", () => {
  it("fires onReschedule with the chosen date and closes", () => {
    const onReschedule = vi.fn();
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    const input = screen.getByLabelText(/new due date/i);
    fireEvent.change(input, { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    expect(onReschedule).toHaveBeenCalledWith(action, "2026-08-01");
  });
  it("disables confirm when the date is empty/invalid", () => {
    render(<ReschedulePopover lang="en-US" action={action} bundle={{ onReschedule: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));
    expect(screen.getByRole("button", { name: /update/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npm run test:run -- src/app/reschedule-popover.test.tsx`.

- [ ] **Step 3: Implement** — `src/app/reschedule-popover.tsx` (mirrors `escalate-popover.tsx`):
```tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { isValidIsoDate } from "./action-rebaseline";

export interface RescheduleBundle {
  onReschedule: (action: SuggestedAction, isoDate: string) => void;
}

interface ReschedulePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: RescheduleBundle;
}

export function ReschedulePopover({ lang, action, bundle }: ReschedulePopoverProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const popRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const canConfirm = isValidIsoDate(date);
  const toggleOpen = () => { if (!open) setDate(""); setOpen((o) => !o); };
  const confirm = () => { bundle.onReschedule(action, date); setDate(""); setOpen(false); };

  return (
    <span className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey"
      >
        {t(lang, "actionReschedule")}
      </button>
      {open && (
        <span
          ref={popRef}
          role="dialog"
          aria-label={t(lang, "actionRescheduleTitle")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2"
        >
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, "actionRescheduleTitle")}
          </label>
          <input
            type="date"
            aria-label={t(lang, "actionRescheduleTitle")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={(e) => { e.stopPropagation(); confirm(); }}
              className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey"
            >
              {t(lang, "actionRescheduleConfirm")}
            </button>
          </div>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: tsc + lint clean. Step 6: commit:**
```bash
git add src/app/reschedule-popover.tsx src/app/reschedule-popover.test.tsx
git commit -m "feat(action-center): ReschedulePopover (date picker for due-date push)"
```

---

## Task 3: action-row gating + render

**Files:** `src/app/action-row.tsx` (+ `action-row.test.tsx`)

- [ ] **Step 1: Tests first** — add to `action-row.test.tsx` (mirror the existing menu/popover tests; `vi`/`render`/`screen`/`fireEvent` already imported):
```tsx
it("shows Reschedule popover on a task-due row and Mark done in the menu", () => {
  const onMarkDone = vi.fn();
  const action = { id: "task-due:1:overdue", source: "task-due",
    title: { key: "actionTaskTitle", params: ["T"] }, why: { key: "actionTaskWhyOverdue", params: [2] },
    score: 70, tier: "now", cta: { kind: "open", view: "open-points", id: 1 } } as never;
  render(<ActionRow lang="en-US" action={action} onOpen={() => {}} onMarkDone={onMarkDone}
    reschedule={{ onReschedule: vi.fn() }} />);
  expect(screen.getByRole("button", { name: /reschedule/i })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
  fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
  expect(onMarkDone).toHaveBeenCalled();
});

it("shows Assign on an unassigned task-attention row, Clear blocker on a blocked one", () => {
  const onClearBlocker = vi.fn();
  const unassigned = { id: "task-attention:1:unassigned", source: "task-attention",
    title: { key: "actionTaskTitle", params: ["T"] }, why: { key: "actionTaskWhyUnassigned" },
    score: 30, tier: "soon", cta: { kind: "open", view: "open-points", id: 1 } } as never;
  const blocked = { ...unassigned, id: "task-attention:1:blocked", why: { key: "actionTaskWhyBlocked", params: ["x"] } } as never;
  const assignBundle = { resources: [], onCreateResource: () => 1, onAssign: vi.fn() };
  const { rerender } = render(<ActionRow lang="en-US" action={unassigned} onOpen={() => {}} assignOwner={assignBundle} />);
  expect(screen.getByRole("button", { name: /assign owner/i })).toBeTruthy();
  rerender(<ActionRow lang="en-US" action={blocked} onOpen={() => {}} onClearBlocker={onClearBlocker} />);
  fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
  fireEvent.click(screen.getByRole("button", { name: /clear blocker/i }));
  expect(onClearBlocker).toHaveBeenCalled();
});
```
(Match the EN labels: `actionReschedule`="Reschedule", `actionMarkDone`="Mark done", `actionClearBlocker`="Clear blocker", `actionAssignOwner` — confirm its EN string and adjust `/assign owner/i` if different.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Edit `action-row.tsx`**

(a) Imports — add:
```ts
import { ReschedulePopover, type RescheduleBundle } from "./reschedule-popover";
```

(b) `ActionRowProps` — add:
```ts
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
```
and add `reschedule, onMarkDone, onClearBlocker` to the destructure.

(c) Extend `canAssign` to also cover unassigned task-attention:
```ts
  const canAssign =
    assignOwner != null &&
    action.cta.kind === "open" &&
    ((action.source === "raid" && action.why.key === "actionRaidWhyNoOwner") ||
     (action.source === "task-attention" && action.why.key === "actionTaskWhyUnassigned"));
```

(d) Add derived gates (near `createTaskApplicable`/`hasMenu`):
```ts
  const canReschedule = reschedule != null && action.source === "task-due" && action.cta.kind === "open";
  const canMarkDone = onMarkDone != null && action.cta.kind === "open" && action.cta.view === "open-points";
  const canClearBlocker = onClearBlocker != null && action.source === "task-attention" && action.why.key === "actionTaskWhyBlocked";
```
and extend `hasMenu` to include the new menu items:
```ts
  const hasMenu = canDraft || createTaskApplicable || onSnooze != null || canMarkDone || canClearBlocker;
```

(e) In the inline contextual-popover area (after the Escalate/Rebaseline blocks, before the Assign block — or alongside; they're mutually exclusive by primary), add the Reschedule popover:
```tsx
        {canReschedule && reschedule && (
          <ReschedulePopover lang={lang} action={action} bundle={reschedule} />
        )}
```

(f) In the `[⋮]` menu body, add Mark done + Clear blocker items (e.g. before the Draft item or after Create-task — order: Mark done, Create task, Draft, Clear blocker, Snooze; pick a sensible order):
```tsx
                {canMarkDone && onMarkDone && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMarkDone(action); }}
                    className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                    {t(lang, "actionMarkDone")}
                  </button>
                )}
                {canClearBlocker && onClearBlocker && (
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onClearBlocker(action); }}
                    className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                    {t(lang, "actionClearBlocker")}
                  </button>
                )}
```

- [ ] **Step 4: Run → PASS. Step 5: tsc + lint clean. Step 6: commit:**
```bash
git add src/app/action-row.tsx src/app/action-row.test.tsx
git commit -m "feat(action-row): inline Reschedule/Assign popovers + Mark done/Clear blocker menu items"
```

---

## Task 4: actions-panel threading

**Files:** `src/app/actions-panel.tsx` (+ `actions-panel.test.tsx` only if a new assertion is wanted; otherwise just the prop pass)

- [ ] **Step 1:** In `ActionsPanelProps` add (after `rebaseline?`):
```ts
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
```
Import `RescheduleBundle`:
```ts
import type { RescheduleBundle } from "./reschedule-popover";
```
Add the three to the `ActionsPanel({...})` destructure.

- [ ] **Step 2:** In `renderRow`, pass them to `<ActionRow>`:
```tsx
                reschedule={reschedule}
                onMarkDone={onMarkDone}
                onClearBlocker={onClearBlocker}
```

- [ ] **Step 3:** `npx tsc --noEmit && npm run lint && npm run test:run -- src/app/actions-panel.test.tsx` → clean/pass. Commit:
```bash
git add src/app/actions-panel.tsx
git commit -m "feat(actions-panel): thread reschedule/markDone/clearBlocker to rows"
```

---

## Task 5: task-manager handlers + workspace threading

**Files:** `src/app/task-manager.tsx`, `src/app/workspace-section-types.ts`, `src/app/workspace-section.tsx` (+ a handler test in the existing action-handler test file, or a new `task-manager`-level test if that's the pattern)

- [ ] **Step 1: workspace-section-types.ts** — in `WorkspaceSectionProps`, alongside the existing `assignOwner?`/`escalate?`/`rebaseline?`/`onSnooze?`/`onCreateTask?`/`onDraftMessage?`, add:
```ts
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
```
Import `RescheduleBundle` from `./reschedule-popover` and `SuggestedAction` (already imported there for the others — reuse).

- [ ] **Step 2: workspace-section.tsx** — in the `<ActionsPanel … />` call (the line currently ending `… aiAnalysis={aiAnalysis} />`), add `reschedule={reschedule} onMarkDone={onMarkDone} onClearBlocker={onClearBlocker}`, and add those three to the component's destructured props.

- [ ] **Step 3: task-manager.tsx — build the handlers** (mirror `assignOwnerBundle` at ~line 1187; place near it). Use the render-scope `today` const (`effectiveToday(effectiveTz)`), `setTasks`, `recordLearning`, `showToast`, `lang`, `isPopout`. Import `applyStatusChange` from `./task-status` and `isValidIsoDate` from `./action-rebaseline` (already imported — confirm).

Add the entity id helper inline (`Number(action.cta.id)` when `cta.kind==="open"`). Then:

(a) **Extend `assignOwnerBundle.onAssign`** to route by `cta.view`:
```ts
            onAssign: (action, v) => {
              if (action.cta.kind !== "open") return;
              const id = Number(action.cta.id);
              if (action.cta.view === "open-points") {
                setTasks((prev) => prev.map((tk) =>
                  tk.id === id ? { ...tk, assignee: v.name, assigneeEmail: v.email, resourceId: v.resourceId ?? undefined } : tk));
                void recordLearning(action, "acted");
                showToast("info", t(lang, "actionOwnerAssigned", id));
                return;
              }
              const next = applyOwnerAssignment(raid, id, v);
              if (next === raid) return;
              setRaid(next as RaidItem[]);
              void recordLearning(action, "acted");
              showToast("info", t(lang, "actionOwnerAssigned", id));
            },
```
(Add `setTasks` to the `assignOwnerBundle` useMemo deps.)

(b) **`onMarkDoneFromAction`** (useCallback or inline const, popout-guarded by passing `undefined` at the wiring site):
```ts
  const handleMarkDoneFromAction = useCallback((action: SuggestedAction) => {
    if (action.cta.kind !== "open") return;
    const id = Number(action.cta.id);
    setTasks((prev) => prev.map((tk) => tk.id === id ? applyStatusChange(tk, "Done", today) : tk));
    void recordLearning(action, "acted");
    showToast("info", t(lang, "actionTaskCompleted"));
  }, [setTasks, today, recordLearning, showToast, lang]);
```

(c) **`handleClearBlockerFromAction`:**
```ts
  const handleClearBlockerFromAction = useCallback((action: SuggestedAction) => {
    if (action.cta.kind !== "open") return;
    const id = Number(action.cta.id);
    setTasks((prev) => prev.map((tk) => tk.id === id ? { ...tk, blockers: "" } : tk));
    void recordLearning(action, "acted");
    showToast("info", t(lang, "actionBlockerCleared"));
  }, [setTasks, recordLearning, showToast, lang]);
```

(d) **`rescheduleBundle`:**
```ts
  const rescheduleBundle = useMemo<RescheduleBundle | undefined>(
    () => isPopout ? undefined : {
      onReschedule: (action, isoDate) => {
        if (action.cta.kind !== "open" || !isValidIsoDate(isoDate)) return;
        const id = Number(action.cta.id);
        setTasks((prev) => prev.map((tk) => tk.id === id ? { ...tk, dueDate: isoDate } : tk));
        void recordLearning(action, "acted");
        showToast("info", t(lang, "actionRescheduled"));
      },
    },
    [isPopout, setTasks, recordLearning, showToast, lang],
  );
```
Import `RescheduleBundle` from `./reschedule-popover` and `applyStatusChange` from `./task-status` at the top.

- [ ] **Step 4: task-manager — thread to workspace-section** — at the prop object passed to the workspace-section render (where `assignOwner: assignOwnerBundle, escalate: …` are set, ~line 1810), add:
```ts
    reschedule: rescheduleBundle,
    onMarkDone: isPopout ? undefined : handleMarkDoneFromAction,
    onClearBlocker: isPopout ? undefined : handleClearBlockerFromAction,
```
(`assignOwnerBundle` is already popout-guarded internally.)

- [ ] **Step 5: Handler test** — add to the existing action-handler/task-manager test (find where `assignOwnerBundle`/`handleCreateTaskFromAction` are tested, or `tasks-section`/`use-task-row-handlers` style). Assert, with a functional-updater-safe approach:
  - mark-done: applying to a task id sets `status:"Done"` + `completedDate` (via `applyStatusChange`).
  - clear-blocker: empties `blockers`.
  - reschedule: sets `dueDate`; rejects an invalid iso (no change).
  - assign routes to the task (sets assignee) when `cta.view==="open-points"`.
  If task-manager handlers aren't unit-tested in isolation today, add focused tests for the PURE shape of each updater (extract the updater body is NOT required — test via a small harness, or assert through an existing integration test). If isolation is impractical, report and we add a thin test.

- [ ] **Step 6: tsc + lint + commit:**
```bash
git add src/app/task-manager.tsx src/app/workspace-section.tsx src/app/workspace-section-types.ts src/app/<handler test file>
git commit -m "feat(action-center): wire inline-CTA handlers (assign-task/markDone/clearBlocker/reschedule)"
```

---

## Task 6: Full-suite verification
- [ ] `npm run test:run` → all green. Fix any downstream `ActionsPanel`/`ActionRow`/`WorkspaceSection` test that breaks on the new optional props (they're optional, so breakage is unlikely; if a test asserts exact prop sets, update it).
- [ ] `npx tsc --noEmit && npm run lint` → clean.
- [ ] `git diff --stat feat-action-center-slice3..HEAD` → only: i18n.ts, i18n.de.ts, reschedule-popover.tsx(+test), action-row.tsx(+test), actions-panel.tsx, workspace-section-types.ts, workspace-section.tsx, task-manager.tsx (+ handler test). No console.log.

---

## Out of scope / notes
- Primary-gating limitation (CTAs key off the primary signal; Mark done is task-level). Documented; group-aware CTA pass is a future enhancement.
- No confirm on Mark done / Clear blocker (reversible + popout-disabled).
- Deferred slice-3 items (emission cap, on-hold exemption) remain out of scope.
- No release/push/MR — only on the explicit "release" trigger.
