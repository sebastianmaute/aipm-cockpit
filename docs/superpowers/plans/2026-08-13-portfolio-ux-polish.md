# Portfolio UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent, already root-caused UI bugs: a wrongly-shown
"Save & switch portfolio" button in the empty-state config modal, an
Export-menu popover that never closes on outside click, and a README
feature-list row that never names WCAG.

**Architecture:** No new concepts. Each fix wires an existing mechanism to a
call site that never used it: `BackendConfigModal`'s existing
`hidePortfolioSwitch` prop, and `usePopoverDismiss` (already used by the
sibling `ProjectSwitcher` component for the identical trigger+menu shape).
The README fix is a one-clause prose edit.

**Tech Stack:** React + TypeScript, Vitest + React Testing Library.

---

Spec: `docs/superpowers/specs/2026-08-13-portfolio-ux-polish-design.md`.

## Task 1: Relabel the portfolio-switch confirm button when no project exists

**CORRECTED from the original plan** — the original approach
(`hidePortfolioSwitch`) would have broken two pinned tests in
`project-empty-state.test.tsx` that require the switch to stay visible at
the empty state (it is the only path there to reach an existing Turso
project). See the spec's "Corrected root cause" for the full explanation.
The real fix relabels the confirm button instead of hiding the switch.

**Files:**
- Modify: `src/app/i18n.ts` (~line 3722, beside `portfolioModeSwitchConfirm`)
- Modify: `src/app/i18n.de.ts` (~line 3688, beside `portfolioModeSwitchConfirm`)
- Modify: `src/app/settings-sections/integrations-section.tsx` (props ~line 153, button label ~line 662)
- Modify: `src/app/backend-config-modal.tsx` (props ~line 32, component ~line 44/73)
- Modify: `src/app/backend-setup-wizard.tsx` (props ~line 106, component ~line 116/182)
- Modify: `src/app/project-empty-state.tsx` (~line 280-287 and ~line 302-308)
- Modify: `src/app/create-project-form.tsx` (~line 148-154)
- Test: `src/app/settings-sections/integrations-section.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/settings-sections/integrations-section.test.tsx`, as a new
`describe` block after the existing `"IntegrationsSection portfolio-mode load hint"`
block (it already has the `tursoSettings(authToken)` helper this reuses):

```tsx
describe("IntegrationsSection portfolio switch label", () => {
  it("shows the default 'Save & switch portfolio' label when a project is loaded", () => {
    render(
      <IntegrationsSection lang="en-US" settings={tursoSettings("test-token")} onChange={() => {}} />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
      { target: { value: "turso" } },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") }),
    ).toBeInTheDocument();
  });

  it("shows a 'Switch portfolio' label instead when noCurrentProject is set", () => {
    render(
      <IntegrationsSection
        lang="en-US"
        settings={tursoSettings("test-token")}
        onChange={() => {}}
        noCurrentProject
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: t("en-US", "portfolioModeLabel") }),
      { target: { value: "turso" } },
    );
    expect(
      screen.getByRole("button", { name: t("en-US", "portfolioModeSwitchConfirmNoProject") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("en-US", "portfolioModeSwitchConfirm") }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/settings-sections/integrations-section.test.tsx -t "portfolio switch label" --reporter=dot --pool=threads`

Expected: FAIL — both tests fail. The first fails because
`portfolioModeSwitchConfirm` resolves via `t()` to a string, but that key's
lookup itself is fine; the actual failure is on the second test, where
`portfolioModeSwitchConfirmNoProject` does not exist as an i18n key yet
(`t()` throws or returns a fallback) and `noCurrentProject` is not a valid
prop yet (TypeScript would catch this before runtime — expect a type error
if you run `tsc`, or a runtime mismatch if vitest's transform is lenient).

- [ ] **Step 3: Add the i18n keys**

In `src/app/i18n.ts`, immediately after the existing line (~3722):

```ts
  portfolioModeSwitchConfirm: "Save & switch portfolio",
```

add:

```ts
  portfolioModeSwitchConfirmNoProject: "Switch portfolio",
```

In `src/app/i18n.de.ts`, immediately after the existing line (~3688):

```ts
  portfolioModeSwitchConfirm: "Speichern & Portfolio wechseln",
```

add:

```ts
  portfolioModeSwitchConfirmNoProject: "Portfolio wechseln",
```

Use the Edit tool for both files, never a shell replace — `i18n.de.ts` is
CRLF and carries real umlauts elsewhere in the file; a raw text edit tool
that preserves exact bytes is required (the Edit tool here does; a `sed`/
PowerShell text replace on this file has corrupted encoding before).

- [ ] **Step 4: Add the `noCurrentProject` prop to `IntegrationsSection`**

In `src/app/settings-sections/integrations-section.tsx`, find the props
interface (around where `hidePortfolioSwitch?: boolean;` is declared) and
add a sibling field:

```ts
  hidePortfolioSwitch?: boolean;
  /** Use the "Switch portfolio" label instead of "Save & switch portfolio"
   *  on the confirm button — set when this section is reached from a
   *  pre-project surface (empty state, create-project flow), where "Save"
   *  would otherwise read as saving a project that does not exist. Purely
   *  cosmetic: it changes no behavior, only which i18n key the confirm
   *  button renders. */
  noCurrentProject?: boolean;
```

Update the function signature (currently
`export function IntegrationsSection({ lang, settings, onChange, onMigrateToTurso, hidePortfolioSwitch, hideJira }: IntegrationsSectionProps) {`)
to:

```tsx
export function IntegrationsSection({ lang, settings, onChange, onMigrateToTurso, hidePortfolioSwitch, hideJira, noCurrentProject }: IntegrationsSectionProps) {
```

Then change the confirm button's label (currently
`{t(lang, "portfolioModeSwitchConfirm")}`, inside the
`{portfolioModeDirty && ( ... )}` block):

```tsx
{t(lang, noCurrentProject ? "portfolioModeSwitchConfirmNoProject" : "portfolioModeSwitchConfirm")}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/settings-sections/integrations-section.test.tsx --reporter=dot --pool=threads`

Expected: PASS — all tests in the file, including the two new ones.

- [ ] **Step 6: Thread the prop through `BackendConfigModal`**

In `src/app/backend-config-modal.tsx`, add to `BackendConfigModalProps`
(sibling to the existing `hidePortfolioSwitch?: boolean;`):

```ts
  /** Forwarded to IntegrationsSection: use the "Switch portfolio" label. Set
   *  on pre-project surfaces (empty state, create-project flow). */
  noCurrentProject?: boolean;
```

Add it to the function's destructured params and to the `IntegrationsSection`
call:

```tsx
export function BackendConfigModal({
  lang,
  title,
  settings,
  onChangeSettings,
  onClose,
  hidePortfolioSwitch,
  noCurrentProject,
  children,
}: BackendConfigModalProps) {
```

```tsx
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              hidePortfolioSwitch={hidePortfolioSwitch}
              noCurrentProject={noCurrentProject}
            />
```

- [ ] **Step 7: Thread the prop through `BackendSetupWizard`**

In `src/app/backend-setup-wizard.tsx`, add to the props interface (sibling
to `hidePortfolioSwitch?: boolean;`):

```ts
  /** Forwarded to IntegrationsSection: use the "Switch portfolio" label. Set
   *  on pre-project surfaces (empty state, create-project flow). */
  noCurrentProject?: boolean;
```

Add it to the destructured function params:

```tsx
export function BackendSetupWizard({
  lang,
  open,
  settings,
  onChangeSettings,
  onClose,
  onMigrateToTurso,
  hidePortfolioSwitch,
  noCurrentProject,
}: BackendSetupWizardProps) {
```

And to the `IntegrationsSection` call inside the `storage` step:

```tsx
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              onMigrateToTurso={onMigrateToTurso}
              hidePortfolioSwitch={hidePortfolioSwitch}
              noCurrentProject={noCurrentProject}
              hideJira
            />
```

- [ ] **Step 8: Wire the three no-project call sites**

In `src/app/project-empty-state.tsx`, the `configOpen` block (currently):

```tsx
{configOpen && (
  <BackendConfigModal
    lang={lang}
    title={t(lang, "emptyStateConfigDbM365")}
    settings={settings}
    onChangeSettings={onChangeSettings}
    onClose={() => setConfigOpen(false)}
  />
)}
```

becomes:

```tsx
{configOpen && (
  <BackendConfigModal
    lang={lang}
    title={t(lang, "emptyStateConfigDbM365")}
    settings={settings}
    onChangeSettings={onChangeSettings}
    onClose={() => setConfigOpen(false)}
    noCurrentProject
  />
)}
```

The `wizardOpen` block in the same file (currently):

```tsx
{wizardOpen && (
  <BackendSetupWizard
    lang={lang}
    open
    settings={settings}
    onChangeSettings={onChangeSettings}
    onClose={() => setWizardOpen(false)}
  />
)}
```

becomes:

```tsx
{wizardOpen && (
  <BackendSetupWizard
    lang={lang}
    open
    settings={settings}
    onChangeSettings={onChangeSettings}
    onClose={() => setWizardOpen(false)}
    noCurrentProject
  />
)}
```

In `src/app/create-project-form.tsx`, the `configOpen` block (currently):

```tsx
{configOpen && (
  <BackendConfigModal
    lang={lang}
    title={t(lang, "storageOptionConfigure")}
    settings={settings}
    onChangeSettings={onChangeSettings}
    onClose={() => setConfigOpen(false)}
  />
)}
```

becomes:

```tsx
{configOpen && (
  <BackendConfigModal
    lang={lang}
    title={t(lang, "storageOptionConfigure")}
    settings={settings}
    onChangeSettings={onChangeSettings}
    onClose={() => setConfigOpen(false)}
    noCurrentProject
  />
)}
```

Do NOT touch `src/app/settings-view.tsx`'s two call sites — its inline
`<IntegrationsSection>` (loaded-project Settings tab) and its
`BackendSetupWizard` call (already passes `hidePortfolioSwitch`, a
different, correct treatment for that context) are both out of scope here.

- [ ] **Step 9: Run the full affected-file set and the two pinned empty-state tests**

Run: `npx vitest run src/app/project-empty-state.test.tsx src/app/create-project-form.test.tsx src/app/settings-sections/integrations-section.test.tsx src/app/backend-config-modal.test.tsx src/app/backend-setup-wizard.test.tsx --reporter=dot --pool=threads`

Expected: PASS, all files — in particular the two pre-existing
`"shows the portfolio-mode switch inside..."` tests in
`project-empty-state.test.tsx` must still pass unchanged (they assert
presence of the switch, not its label, so this change does not touch them).

- [ ] **Step 10: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/settings-sections/integrations-section.tsx src/app/settings-sections/integrations-section.test.tsx src/app/backend-config-modal.tsx src/app/backend-setup-wizard.tsx src/app/project-empty-state.tsx src/app/create-project-form.tsx
git commit -m "fix: relabel portfolio-switch confirm button when no project is loaded"
```

## Task 2: Close the Export menu on outside click and Escape

**Files:**
- Modify: `src/app/projects-panel.tsx:1-46` (imports + component body ~line 132-139), `~line 276-308` (JSX)
- Test: `src/app/projects-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/projects-panel.test.tsx`, near the existing
`"calls onExportCurrent with the chosen format from the export menu"` test
(around line 199):

```tsx
it("closes the export menu on outside click", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Export project" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("closes the export menu on Escape", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Export project" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/projects-panel.test.tsx -t "closes the export menu" --reporter=dot --pool=threads`

Expected: FAIL — both new tests fail; the menu is still present after the
outside click / Escape (no dismiss wiring exists yet).

- [ ] **Step 3: Write minimal implementation**

In `src/app/projects-panel.tsx`, add the import (alongside the other
`./use-*` imports, e.g. next to the `useResizable` import around line 42):

```tsx
import { usePopoverDismiss } from "./use-popover-dismiss";
```

Add a ref and the dismiss hook call in the component body, right after the
existing `exportMenuId` state declaration (currently line 139):

```tsx
  const [exportMenuId, setExportMenuId] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(exportMenuId !== null, exportMenuRef, () => setExportMenuId(null));
```

This requires `useRef` to be imported from `"react"` — the file's existing
import is `import { useState } from "react";` (line 29); change it to:

```tsx
import { useState, useRef } from "react";
```

Then attach the ref to the trigger+menu wrapper (currently
`<div className="relative">` at line 276):

```tsx
<div className="relative" ref={exportMenuRef}>
```

No other change to that block — the `<Button>` and the `<ul role="menu">`
inside it stay exactly as they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/projects-panel.test.tsx --reporter=dot --pool=threads`

Expected: PASS — all tests in the file, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/app/projects-panel.tsx src/app/projects-panel.test.tsx
git commit -m "fix: close projects export menu on outside click and Escape"
```

## Task 3: Name WCAG in the README feature list

**Files:**
- Modify: `README.md` (the "Accessibility & keyboard" row, currently line 95)

- [ ] **Step 1: Confirm the current row text**

Run: `grep -n "Accessibility & keyboard" README.md`

Expected output (line number may differ if the file changed since this plan
was written — use whatever line the grep reports):

```
95:| Accessibility & keyboard | Keyboard-navigable throughout, with screen-reader-friendly navigation and documented shortcuts.<br><details><summary>Details</summary>Arrow-key navigation on the Calendar grid, a fly-out sub-menu when the sidebar is collapsed, a mobile off-canvas drawer with a focus trap, and focus that follows the view when you navigate. Confirmation dialogs are branded rather than native browser prompts. Global shortcuts: ⌘K / Ctrl-K to search, `/` to search when no field is focused, and F4 for push-to-talk dictation.</details> |
```

- [ ] **Step 2: Confirm the anchor slug**

Run: `grep -n "^### Built to be trusted" README.md`

Confirm this heading exists exactly once (a duplicate heading shifts
GitHub's anchor slug and would make the link below wrong). If the grep
returns more than one match, stop and re-check before proceeding — do not
guess the anchor.

- [ ] **Step 3: Edit the row**

Using the Edit tool (not a shell `sed`, so `<` / `&` in the surrounding
markdown are not mangled), replace:

```
| Accessibility & keyboard | Keyboard-navigable throughout, with screen-reader-friendly navigation and documented shortcuts.<br>
```

with:

```
| Accessibility & keyboard | Keyboard-navigable throughout, targets WCAG 2.1 AA (see [Built to be trusted](#built-to-be-trusted)), with screen-reader-friendly navigation and documented shortcuts.<br>
```

(This is a prefix of the existing row; the `<details>...</details>` suffix
that follows on the same line is unchanged.)

- [ ] **Step 4: Verify no other claim changed**

Run: `grep -n "WCAG 2.1 AA" README.md`

Expected: exactly one match — the row just edited. This confirms the edit
landed once and did not duplicate.

- [ ] **Step 5: Run the doc-claims gate**

Run: `npm run docs:claims:check > /dev/null; echo "EXIT=$?"`

Expected: `EXIT=0`. This change adds no new `path:LINE` citation (only a
heading anchor link and prose), so the ratchet must not trip. If it does not
print `EXIT=0`, stop and read the ungated output before proceeding — do not
re-run through a pipe that could hide the real exit code.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: name WCAG 2.1 AA in the accessibility feature-list row"
```

## Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"`

Expected: `EXIT=0`, no output.

- [ ] **Step 2: Lint at the real CI gate**

Run: `npx eslint --max-warnings=0 src/app; echo "EXIT=$?"`

Expected: `EXIT=0`, no output. (Plain `npm run lint` does NOT reproduce the
CI gate — it has no `--max-warnings` flag.)

- [ ] **Step 3: Run the three affected test files together**

Run: `npx vitest run src/app/project-empty-state.test.tsx src/app/projects-panel.test.tsx --reporter=dot --pool=threads; echo "EXIT=$?"`

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 4: Full unit suite**

Run: `npm run test:run; echo "EXIT=$?"` in the foreground — this plan's
changes touch 2 test files plus a docs file, not the kind of change that
needs the full-suite-in-background treatment. Never pipe this through
`tail`/`grep` to inspect it — that reports the pipe's exit code, not the
suite's; if you need to filter the output, redirect to a file in the
session scratchpad directory first, check `$?` unpiped, then read the file.

Expected: `EXIT=0`.

## Self-review notes (writing-plans skill checklist)

- **Spec coverage:** Fix 1 → Task 1. Fix 2 → Task 2. Fix 3 → Task 3. Spec's
  "Out of scope" section (Load-from-Turso, chat memory) has no task here —
  correct, those are separate specs/plans.
- **Placeholder scan:** no TBD/TODO; every step has exact code or exact
  command + expected output.
- **Type consistency:** `exportMenuRef` typed `HTMLDivElement` matches the
  `<div ref={exportMenuRef}>` it attaches to; `usePopoverDismiss`'s real
  signature (`open: boolean, wrapperRef: RefObject<HTMLElement | null>,
  onClose: () => void`) matches the call in Task 2 Step 3.
