# Modal Field Controls → Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every edit modal's field-visibility control out of its own bordered row and into the modal header, as a trigger labelled with the active tier that opens a popover holding the tier switch plus the per-field checklist.

**Architecture:** `modal-field-controls.tsx` stops rendering a bordered strip and becomes a header-mounted `Button` + `PopoverPanel`. The hand-rolled `aria-pressed` tier segments are replaced by the existing `SegmentedControl` primitive (a `role="radiogroup"` with APG arrow navigation). Three call sites move the element into `ModalHeader`'s already-existing, currently-unused `headerExtra` slot.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Tailwind v4, vitest + @testing-library/react, heroicons.

**Spec:** `docs/superpowers/specs/2026-08-06-modal-field-controls-header-design.md`

**Working tree:** `C:\Projects\aipm-wt-a`, branch `feat/thing-a` (clean at plan time). All paths below are relative to that root.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `src/app/modal-field-controls.tsx` | **Rewritten.** Header trigger (active tier + cog) and its popover (tier radiogroup, field checklist, reset). Owns no strip and no persistence. ~85 lines. |
| `src/app/task-form-modal.tsx` | **Modified.** Passes the control as `headerExtra`; drops the standalone element. |
| `src/app/edit-modal-chrome.tsx` | **Modified.** Same, in `EditModalShell` (serves change / raid / stakeholder / absence / milestone / resource / calendar-event). Two stale doc comments updated. |
| `src/app/budget-bucket-modal.tsx` | **Modified.** Same. |
| `src/app/modal-field-controls.test.tsx` | **Rewritten.** Trigger label, label-in-name, popover-gated radiogroup, tier selection, custom mode, opt-out, no-strip regression pin. |
| `src/app/edit-modal-chrome.test.tsx` | **Modified.** One placement test (control inside `<header>`). |
| `src/app/task-form-modal.test.tsx` | **Modified.** Same placement test. |
| `src/app/budget-bucket-modal.test.tsx` | **Modified.** Same placement test. |

Unchanged and reused as-is: `segmented-control.tsx`, `button.tsx`, `popover-panel.tsx`, `form-controls.tsx` (`Checkbox`), `modal-header.tsx`, `use-modal-visibility.ts`, `modal-fields.ts`. No i18n changes — every string already exists (`fieldViewSimple`, `fieldViewAdvanced`, `fieldViewFull`, `fieldViewCustom`, `fieldViewLabel`, `configureFields`, `resetToDefault`), so `i18n.de.ts` is never opened.

---

## Background the implementer needs

**`useModalVisibility(modalId)`** returns `{ mode, isVisible, setMode, toggleField, reset }` where `mode: FieldTier | "custom"` and `FieldTier = "simple" | "advanced" | "full"`. `"custom"` is derived — it means the visible-field set matches no preset. `setMode` accepts a `FieldTier` only.

**`SegmentedControl<T extends string>`** (`src/app/segmented-control.tsx`) renders `role="radiogroup"` with `role="radio"` + `aria-checked` children, roving tabindex and arrow/Home/End navigation. It explicitly handles a `value` matching no option: nothing is checked and the first radio keeps the Tab-stop. That is exactly the custom-mode rendering this design wants, so custom needs no option of its own.

**`PopoverPanel`** portals to `document.body`, and owns positioning, outside-click, Escape (via the dismissal stack) and close-on-scroll. `onClose` MUST be a stable `useCallback`. Its `autoFocus` default (true) focuses the first control in the panel — which after this change is the first *radio*, not the checked one. That is accepted: this is a selection-follows-focus control, the checked tier is announced via `aria-checked`, and the trigger's own name repeats it. Do not "fix" it by disabling `autoFocus` — the panel is portaled, so with nothing focused a keyboard user's next Tab leaves the popover entirely.

**`ModalHeader`** already accepts `headerExtra: ReactNode`, rendered first in the right-hand cluster inside `onPointerDown={stopDrag}`. No change to that file is needed.

**Test gotchas that apply throughout:**
- In testing-library a **string** `name` option is an exact match. The trigger's accessible name is `"Advanced – Configure fields"`, so queries for it must use a **regex**.
- With the popover open, its checkbox labels collide with modal-body field labels. Any test that touches a tier must close the popover before querying the body.
- `npx tsc --noEmit` is the only thing that typechecks tests; `next build` and vitest do not. Run it after every test edit.
- Never read a gate's exit code through a pipe — it reports the pipe's status.

---

## Task 1: Rewrite the control as a header trigger + popover

**Files:**
- Modify: `src/app/modal-field-controls.tsx` (full rewrite, currently 128 lines)
- Test: `src/app/modal-field-controls.test.tsx` (full rewrite, currently 59 lines)

- [ ] **Step 1: Replace the test file with the failing tests**

Overwrite `src/app/modal-field-controls.test.tsx` with:

```tsx
// src/app/modal-field-controls.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FiltersProvider } from "./filters-context";
import { ModalFieldControls } from "./modal-field-controls";
import { t } from "./i18n";
import { SETTINGS_KEY } from "./use-settings";
import { WorkspaceProvider } from "./workspace-context";

const EN = "en-US" as const;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderControls() {
  return render(<ModalFieldControls modalId="milestone" lang={EN} />, { wrapper });
}

// The trigger's accessible name is "<tier> – Configure fields", so this needs a
// SUBSTRING regex: a string `name` is an exact match in testing-library.
function trigger(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(t(EN, "configureFields")) });
}

function openPopover() {
  fireEvent.click(trigger());
}

describe("ModalFieldControls trigger", () => {
  it("shows the active tier as its visible label", () => {
    renderControls();
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewAdvanced"));
  });

  it("leads its accessible name with the visible label (WCAG 2.5.3)", () => {
    renderControls();
    expect(trigger()).toHaveAccessibleName(
      `${t(EN, "fieldViewAdvanced")} – ${t(EN, "configureFields")}`,
    );
  });

  it("renders no bordered strip — the control lives in the modal header now", () => {
    // Regression pin for the whole point of this change: the component used to
    // own a `border-b` band that cost every modal a row of vertical chrome.
    const { container } = renderControls();
    expect(container.querySelector(".border-b")).toBeNull();
  });
});

describe("ModalFieldControls popover", () => {
  it("keeps the tier switch out of the DOM until the trigger is clicked", () => {
    renderControls();
    expect(screen.queryByRole("radio", { name: t(EN, "fieldViewSimple") })).toBeNull();
    openPopover();
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") })).toBeInTheDocument();
  });

  it("checks the radio for the active tier", () => {
    renderControls();
    openPopover();
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewAdvanced") })).toBeChecked();
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") })).not.toBeChecked();
  });

  it("selecting a tier updates both the radio and the trigger label", () => {
    renderControls();
    openPopover();
    fireEvent.click(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") }));
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") })).toBeChecked();
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewSimple"));
  });

  it("disables required-field checkboxes", () => {
    renderControls();
    openPopover();
    const nameBox = screen.getByRole("checkbox", { name: t(EN, "name") });
    expect(nameBox).toBeDisabled();
    expect(nameBox).toBeChecked();
  });

  it("labels the trigger Custom and checks no radio after a hand-toggle", () => {
    renderControls();
    openPopover();
    // `description` is an optional Advanced-tier milestone field: hiding it
    // leaves the visible set matching no preset, which is what "custom" means.
    fireEvent.click(screen.getByRole("checkbox", { name: t(EN, "description") }));
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewCustom"));
    for (const key of ["fieldViewSimple", "fieldViewAdvanced", "fieldViewFull"] as const) {
      expect(screen.getByRole("radio", { name: t(EN, key) })).not.toBeChecked();
    }
  });
});

describe("showFieldConfig opt-out", () => {
  afterEach(() => window.localStorage.removeItem(SETTINGS_KEY));

  it("renders nothing when settings.showFieldConfig is false", async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showFieldConfig: false }));
    const { container } = renderControls();
    // useSettings hydrates from localStorage asynchronously; the trigger
    // disappears once the false flag lands.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run src/app/modal-field-controls.test.tsx
```

Expected: FAIL. The trigger queries fail first (today's cog button's accessible name is exactly `"Configure fields"` with no tier text, and it has no visible label), and every `role="radio"` query fails because today's segments are `role="button"` with `aria-pressed`.

- [ ] **Step 3: Rewrite the component**

Overwrite `src/app/modal-field-controls.tsx` with:

```tsx
"use client";

// The edit modals' field-visibility control: a trigger showing the ACTIVE tier
// (Simple / Advanced / Full / Custom) which opens a popover holding the tier
// switch plus a per-field checklist. It owns no persistence — every action
// delegates to `useModalVisibility`, which reads and writes the workspace
// field-visibility config.
//
// Mounted through `ModalHeader`'s `headerExtra` slot, so it sits in the header's
// right-hand cluster and costs NO vertical space. It previously owned a bordered
// strip below the header; that strip is gone, and with it the reason the strip
// was owned here (so the per-device opt-out left no empty band behind). The
// opt-out now simply removes the trigger.
//
// The tier switch is the shared `SegmentedControl` (a radiogroup with APG arrow
// navigation) — do not hand-roll `aria-pressed` buttons back in. Custom mode
// deliberately has NO option of its own: `SegmentedControl` handles a value
// matching no option by leaving the group unchecked, and the trigger's own label
// says "Custom".

import { useCallback, useRef, useState } from "react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import type { Lang, TranslationKey } from "./i18n";
import { t } from "./i18n";
import { MODAL_FIELDS, type FieldTier, type ModalId } from "./modal-fields";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { PopoverPanel } from "./popover-panel";
import { SegmentedControl } from "./segmented-control";
import { useModalVisibility } from "./use-modal-visibility";
import { useSettings } from "./use-settings";

interface ModalFieldControlsProps {
  modalId: ModalId;
  lang: Lang;
}

const TIERS: readonly FieldTier[] = ["simple", "advanced", "full"];
const TIER_LABEL: Record<FieldTier | "custom", TranslationKey> = {
  simple: "fieldViewSimple",
  advanced: "fieldViewAdvanced",
  full: "fieldViewFull",
  custom: "fieldViewCustom",
};

export function ModalFieldControls({ modalId, lang }: ModalFieldControlsProps) {
  const { mode, isVisible, setMode, toggleField, reset } = useModalVisibility(modalId);
  const { settings } = useSettings();
  const [cogOpen, setCogOpen] = useState(false);
  const cogTriggerRef = useRef<HTMLButtonElement>(null);
  const closeCog = useCallback(() => setCogOpen(false), []);

  // Per-device opt-out: hide the control entirely.
  if (settings.showFieldConfig === false) return null;

  const tierLabel = t(lang, TIER_LABEL[mode]);

  return (
    <div className="relative inline-block">
      <Button
        ref={cogTriggerRef}
        variant="secondary"
        size="xs"
        // The visible label is the tier, so it LEADS the accessible name (WCAG
        // 2.5.3 label-in-name); the control's purpose follows it.
        aria-label={`${tierLabel} – ${t(lang, "configureFields")}`}
        title={t(lang, "configureFields")}
        aria-haspopup="dialog"
        aria-expanded={cogOpen}
        onClick={() => setCogOpen((o) => !o)}
        className="inline-flex items-center gap-1.5"
      >
        {tierLabel}
        <Cog6ToothIcon aria-hidden="true" className="h-4 w-4" />
      </Button>
      <PopoverPanel
        open={cogOpen}
        anchorRef={cogTriggerRef}
        onClose={closeCog}
        role="dialog"
        ariaLabel={t(lang, "configureFields")}
        // w-72 (not w-56): three German tier labels at the primitive's text-sm
        // px-3 are wider than 224px. The primitive wraps rather than clipping.
        className="w-72 p-3 shadow-[var(--shadow-control)]"
      >
        <SegmentedControl<FieldTier | "custom">
          value={mode}
          ariaLabel={t(lang, "fieldViewLabel")}
          options={TIERS.map((tier) => ({ value: tier, label: t(lang, TIER_LABEL[tier]) }))}
          // "custom" is never an option, so this only narrows the primitive's
          // generic back to what `setMode` accepts — cast-free.
          onChange={(next) => {
            if (next !== "custom") setMode(next);
          }}
          className="w-full"
        />
        <ul className="mt-3 max-h-64 space-y-1 overflow-auto border-t border-line pt-3 text-sm">
          {MODAL_FIELDS[modalId].map((f) => (
            <li key={f.id}>
              <label className="flex items-center gap-2 text-foreground">
                <Checkbox
                  checked={isVisible(f.id)}
                  disabled={f.required}
                  onChange={() => toggleField(f.id)}
                />
                <span>{t(lang, f.labelKey)}</span>
              </label>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="xs" onClick={reset} className="mt-3 w-full">
          {t(lang, "resetToDefault")}
        </Button>
      </PopoverPanel>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run src/app/modal-field-controls.test.tsx
```

Expected: PASS, 8 tests.

If the "no bordered strip" test fails, the `<ul>`'s `border-t` is not the cause (the assertion looks for `border-b`) — check that no wrapper reintroduced the strip.

- [ ] **Step 5: Typecheck and lint, unpiped**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. Lint is fatal on unused imports — confirm no leftover import from the old implementation (`INTERACTIVE`, the old `SEGMENT_*` consts) survived the rewrite.

- [ ] **Step 6: Commit**

```bash
git add src/app/modal-field-controls.tsx src/app/modal-field-controls.test.tsx
git commit -F - <<'EOF'
refactor(modals): make field-visibility control a header trigger + popover

Replace the bordered strip with a Button trigger labelled by the active
tier, and fold the tier switch into its popover using the shared
SegmentedControl primitive (radiogroup + APG arrow nav) instead of
hand-rolled aria-pressed buttons. No i18n changes.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 2: Mount it in the modal header at all three call sites

**Files:**
- Modify: `src/app/task-form-modal.tsx:124-134`
- Modify: `src/app/edit-modal-chrome.tsx:60-66` (doc comment) and `:102-113`
- Modify: `src/app/budget-bucket-modal.tsx:252-263`
- Test: `src/app/edit-modal-chrome.test.tsx`, `src/app/task-form-modal.test.tsx`, `src/app/budget-bucket-modal.test.tsx`

- [ ] **Step 1: Write the failing placement tests**

In `src/app/edit-modal-chrome.test.tsx`, add `t` to the existing i18n-free import block — the file currently imports `EditModalShell`, `FiltersProvider`, `WorkspaceProvider` but not `t`:

```tsx
import { t } from "./i18n";
```

Then append this describe block at the end of the file:

```tsx
describe("EditModalShell field-visibility control", () => {
  test("mounts the field-visibility trigger inside the modal header", () => {
    renderShell();
    const trigger = screen.getByRole("button", {
      name: new RegExp(t("en-US", "configureFields")),
    });
    // PLACEMENT, not presence: the control used to sit in its own bordered
    // strip BELOW the header, and a presence-only assertion passes against
    // that layout too.
    expect(trigger.closest("header")).not.toBeNull();
  });
});
```

In `src/app/task-form-modal.test.tsx` (`t` is already imported), append inside the existing `describe("TaskFormModal", …)` block, after the "close button fires onCancel exactly once" test:

```tsx
  test("mounts the field-visibility trigger inside the modal header", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    const trigger = screen.getByRole("button", {
      name: new RegExp(t(EN, "configureFields")),
    });
    // PLACEMENT, not presence — see edit-modal-chrome.test.tsx.
    expect(trigger.closest("header")).not.toBeNull();
  });
```

In `src/app/budget-bucket-modal.test.tsx` (`t` and `screen` are already imported, lines 2 and 9), append a new describe block at the end of the file:

```tsx
describe("BudgetBucketModal field-visibility control", () => {
  test("mounts the field-visibility trigger inside the modal header", () => {
    setup();
    const trigger = screen.getByRole("button", {
      name: new RegExp(t("en-US", "configureFields")),
    });
    // PLACEMENT, not presence — see edit-modal-chrome.test.tsx.
    expect(trigger.closest("header")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the three test files and watch the new tests fail**

```bash
npx vitest run src/app/edit-modal-chrome.test.tsx src/app/task-form-modal.test.tsx src/app/budget-bucket-modal.test.tsx
```

Expected: 3 FAILs, each `expected null not to be null` — the trigger renders below `<header>`, so `closest("header")` is null. Every pre-existing test in those files still passes.

- [ ] **Step 3: Move the element into the header in `task-form-modal.tsx`**

Replace lines 124-134 (the `<ModalHeader …/>` element and the `<ModalFieldControls …/>` line beneath it) with:

```tsx
        <ModalHeader
          lang={lang}
          title={isEditing ? t(lang, "taskEditTitle") : t(lang, "tabNewTask")}
          onClose={onCancel}
          dragHandleProps={handleProps}
          headerExtra={<ModalFieldControls modalId="task" lang={lang} />}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />
```

- [ ] **Step 4: Move the element into the header in `edit-modal-chrome.tsx`**

Replace lines 102-113 (the `<ModalHeader …/>`, the blank line, and the `<ModalFieldControls …/>` line) with:

```tsx
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onClose}
          dragHandleProps={dragHandleProps}
          headerExtra={<ModalFieldControls modalId={modalId} lang={lang} />}
          onResetLayout={() => {
            onDragReset();
            sizeReset();
          }}
        />
```

Then fix the now-stale doc comment above `EditModalShell` (lines 60-66). Replace:

```
 * The draggable modal shell shared by the change + stakeholder edit modals:
 * the centered `Modal`, the fixed-width draggable panel, the `ModalHeader`, the
 * field-visibility controls bar, and the two-column form grid. The caller's
```

with:

```
 * The draggable modal shell shared by the change + stakeholder edit modals:
 * the centered `Modal`, the fixed-width draggable panel, the `ModalHeader`
 * (carrying the field-visibility control in its right-hand cluster), and the
 * two-column form grid. The caller's
```

- [ ] **Step 5: Move the element into the header in `budget-bucket-modal.tsx`**

Replace lines 252-263 (the `<ModalHeader …/>`, the blank line, and the `<ModalFieldControls …/>` line) with:

```tsx
        <ModalHeader
          lang={lang}
          title={t(lang, "budgetEditBucket")}
          onClose={onClose}
          dragHandleProps={handleProps}
          headerExtra={<ModalFieldControls modalId="budget" lang={lang} />}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />
```

- [ ] **Step 6: Run the three test files and watch them pass**

```bash
npx vitest run src/app/edit-modal-chrome.test.tsx src/app/task-form-modal.test.tsx src/app/budget-bucket-modal.test.tsx
```

Expected: PASS, all tests in all three files.

- [ ] **Step 7: Run the rest of the modal suites that touch field visibility**

These seed visibility through state rather than the UI, so they should be unaffected — this run proves it rather than assuming it:

```bash
npx vitest run src/app/absence-edit-modal.test.tsx src/app/change-edit-modal.test.tsx src/app/milestone-edit-modal.test.tsx src/app/raid-edit-modal.test.tsx src/app/raid-panel.test.tsx src/app/resource-edit-modal.test.tsx src/app/stakeholder-edit-modal.test.tsx src/app/calendar-event-modal.test.tsx src/app/task-form-fields.test.tsx src/app/use-modal-visibility.test.tsx src/app/change-panel.test.tsx
```

Expected: PASS. A failure here is most likely an ambiguous query — the trigger's visible tier text (e.g. "Advanced") is now in the DOM where it previously was not, so a `getByText(/Advanced/)` in a body assertion can newly match two nodes. Fix by scoping the body query, not by removing the trigger label.

- [ ] **Step 8: Typecheck and lint, unpiped**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-form-modal.tsx src/app/edit-modal-chrome.tsx src/app/budget-bucket-modal.tsx src/app/edit-modal-chrome.test.tsx src/app/task-form-modal.test.tsx src/app/budget-bucket-modal.test.tsx
git commit -F - <<'EOF'
feat(modals): move the field-visibility control into the modal header

Mount ModalFieldControls through ModalHeader's headerExtra slot at all
three call sites, giving every edit modal back the row its bordered
strip used to cost. Tests assert placement inside <header>, not mere
presence.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: Full verification

**Files:** none modified (unless a failure is found).

- [ ] **Step 1: One full unit run, redirected, exit code read unpiped**

```bash
npm run test:run > "$TMPDIR/suite.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$TMPDIR/suite.log"
```

If `$TMPDIR` is unset, use the session scratchpad directory instead of `/tmp`. Expected: `EXIT=0`.

Note the trap: reading this through a pipe (`npm run test:run | tail`) reports `tail`'s status — a failing suite looks green.

- [ ] **Step 2: Browser eye-verify — the check no gate can perform**

jsdom has no layout, so nothing above can see whether the header actually fits. Start an isolated dev server, do not reuse a long-running one:

```bash
PORT=3100 npm run dev
```

Check, in this order (each is a case the unit tests structurally cannot cover):

1. **Task modal, EN** — open Open Points → New task. Header reads `New task … Advanced ⚙ 🎤 ⤡ ✕` on one row; no bordered strip below it; the first field sits directly under the header.
2. **Narrowest header, worst-case label** — switch the app to German, open a register modal (Absence or Milestone, 560px), and hand-toggle a field so the trigger reads `Benutzerdefiniert`. Confirm the title truncates gracefully and nothing overflows or wraps the header.
3. **Popover contents** — open it: the tier radiogroup sits above a divider, then the checklist, then a full-width reset. German labels may wrap to two rows inside `w-72`; confirm they wrap rather than clip.
4. **Keyboard** — Tab to the trigger, Enter to open, arrow keys move between tiers, Escape closes and returns focus sensibly.
5. **Drag guard** — click the trigger and confirm the modal does not start dragging.

Stop the server when done:

```bash
PORT=3100 npm run stop
```

- [ ] **Step 3: Report**

State the actual exit codes and what the eye-verify showed, including anything that looked off. If step 2 reveals a layout problem, fix it and re-run Task 1/2's targeted tests — do not report done with an eye-verify unperformed.

**Deliberately skipped, with reasons:**
- `npm run test:shuffle` — no cross-file state is added; the new tests are self-contained within their files.
- The axe e2e gate — it scans views, and these modals open only on interaction, so no scanned surface changes. The a11y properties that do change (radiogroup semantics, label-in-name) are covered by Task 1's unit tests.
- Version bump / CHANGELOG — user-visible, so it happens at release time, not in this slice.

---

## Self-review notes

- **Spec coverage:** trigger with tier label (T1 S3), label-in-name (T1 S1/S3), popover with `SegmentedControl` (T1 S3), custom mode with no checked radio (T1 S1/S3), `w-72` widening (T1 S3), reset via `Button` (T1 S3), heroicon replacing the `⚙` glyph (T1 S3), rewritten leading comment (T1 S3), three call sites (T2 S3-S5), stale `edit-modal-chrome` comment (T2 S4), opt-out unchanged (T1 S1/S3), test updates (T1 S1, T2 S1), narrow verification (T3). No spec requirement is unassigned.
- **Naming consistency:** `ModalFieldControls`, `modalId`, `headerExtra`, `TIER_LABEL`, `TIERS`, `cogTriggerRef`, `closeCog` are used identically in every task.
- **Known accepted behaviour, stated rather than hidden:** `PopoverPanel`'s `autoFocus` lands on the first radio, not the checked one (rationale in "Background").
