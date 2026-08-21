# Rich-Text Toolbar Compact Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `rich-text-toolbar.tsx`'s controls (12 mark/block toggles, the heading-level trigger, Link, Unlink) with a new borderless, compact `ToolbarButton`, matching the tiptap simple-editor reference's chrome — no border, 24px square, 14px icons — while keeping WCAG 1.4.1 compliant via a small non-color marker instead of a pure background-color pressed state (which is mathematically impossible to make compliant in the dark schemes — see the design spec).

**Architecture:** One new toolbar-local presentational component (`rich-text-toolbar-button.tsx`) replaces both the shared `ToggleButton` and the shared `Button` inside this one file. `toggle-button.tsx` and its ~25 other consumers are untouched.

**Tech Stack:** React 19 (ref-as-prop), Tailwind v4, Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-08-11-rich-text-toolbar-compact-buttons-design.md`

---

### Task 1: `ToolbarButton` component

**Files:**
- Create: `src/app/rich-text-toolbar-button.tsx`
- Test: `src/app/rich-text-toolbar-button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/rich-text-toolbar-button.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolbarButton } from "./rich-text-toolbar-button";

describe("ToolbarButton", () => {
  it("renders its children and fires onClick", async () => {
    const onClick = vi.fn();
    render(
      <ToolbarButton onClick={onClick} ariaLabel="Bold">
        <span>icon</span>
      </ToolbarButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to no aria state attribute", () => {
    render(
      <ToolbarButton onClick={() => {}} ariaLabel="Insert link">
        <span>icon</span>
      </ToolbarButton>,
    );
    const btn = screen.getByRole("button", { name: "Insert link" });
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
    expect(btn.hasAttribute("aria-expanded")).toBe(false);
  });

  it("reports pressed state through aria-pressed for stateKind=toggle", () => {
    const { rerender } = render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={false}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");
    rerender(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={true}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reports expanded state through aria-expanded and aria-controls for stateKind=disclosure", () => {
    render(
      <ToolbarButton
        onClick={() => {}}
        ariaLabel="Text style"
        stateKind="disclosure"
        active={true}
        ariaControls="heading-menu"
      >
        <span>icon</span>
      </ToolbarButton>,
    );
    const btn = screen.getByRole("button", { name: "Text style" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("heading-menu");
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
  });

  it("shows a non-colour marker that is invisible when inactive and visible when active", () => {
    const { container, rerender } = render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={false}>
        <span>icon</span>
      </ToolbarButton>,
    );
    const marker = () => container.querySelector("[data-pressed-marker]");
    expect(marker()?.className).toContain("opacity-0");
    rerender(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={true}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(marker()?.className).not.toContain("opacity-0");
  });

  it("appends the on/off state to the tooltip only for stateKind=toggle with a lang", () => {
    render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" title="Bold" lang="en-US" stateKind="toggle" active={true}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("title")).toContain("Currently on");
  });

  it("does not append on/off state to the tooltip for stateKind=disclosure", () => {
    render(
      <ToolbarButton
        onClick={() => {}}
        ariaLabel="Text style"
        title="Text style"
        lang="en-US"
        stateKind="disclosure"
        active={true}
      >
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Text style" }).getAttribute("title")).toBe("Text style");
  });

  it("suppresses the mousedown default only when preventFocusSteal is set", () => {
    const { rerender } = render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold">
        <span>icon</span>
      </ToolbarButton>,
    );
    let ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: "Bold" }).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);

    rerender(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" preventFocusSteal>
        <span>icon</span>
      </ToolbarButton>,
    );
    ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: "Bold" }).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('uses the pink accent classes when active with accent="pink"', () => {
    render(
      <ToolbarButton onClick={() => {}} ariaLabel="Highlight" stateKind="toggle" active={true} accent="pink">
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Highlight" }).className).toContain("bg-ui-pink/10");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/rich-text-toolbar-button.test.tsx`
Expected: FAIL — `Failed to resolve import "./rich-text-toolbar-button"` (module does not exist yet).

- [ ] **Step 3: Write the component**

Create `src/app/rich-text-toolbar-button.tsx`:

```tsx
"use client";

// Compact borderless icon button for the rich-text toolbar (tiptap
// simple-editor look). Local to rich-text-toolbar.tsx only — the shared
// ToggleButton (toggle-button.tsx) keeps its bordered-chip look for its
// ~25 other consumers (Gantt View menu, Settings rows, dashboard chips).
//
// ★★ The pressed/expanded state is NOT color-only: `--ui-dark-blue` sits at
// ~1.1-1.3:1 against the dark surface even at full opacity (measured), so a
// background tint alone cannot clear WCAG 1.4.1's 3:1 lightness-delta bar in
// the dark schemes. The trailing marker below carries that burden instead —
// see the design spec (docs/superpowers/specs/2026-08-11-rich-text-toolbar-
// compact-buttons-design.md) for the numbers.

import type { ReactNode, Ref } from "react";
import { type Lang, t } from "./i18n";

export type ToolbarButtonAccent = "dark-blue" | "pink";
export type ToolbarButtonStateKind = "toggle" | "disclosure" | "action";

const BASE =
  "relative inline-flex h-6 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded-lg px-1 focus:outline-none focus:ring-2";

const INACTIVE = "text-foreground hover:bg-surface-muted focus:ring-ui-green";

const ACTIVE: Record<ToolbarButtonAccent, string> = {
  "dark-blue":
    "bg-ui-dark-blue/10 text-ui-dark-blue hover:bg-ui-dark-blue/20 focus:ring-ui-dark-blue dark:bg-ui-dark-blue/20 dark:text-ui-light-grey",
  pink: "bg-ui-pink/10 text-ui-dark-blue hover:bg-ui-pink/20 focus:ring-ui-pink dark:bg-ui-pink/15 dark:text-ui-light-grey",
};

type StateAttrs =
  | { "aria-pressed": boolean }
  | { "aria-expanded": boolean; "aria-controls": string | undefined }
  | Record<string, never>;

export interface ToolbarButtonProps {
  /** Drives the shared pressed/expanded visual AND the non-colour marker,
   *  regardless of `stateKind`. */
  active?: boolean;
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  /** Enables the on/off tooltip suffix — "toggle" kind only. */
  lang?: Lang;
  /** Which aria state attribute to emit. Defaults to "action" (Link, Unlink —
   *  no state to announce). */
  stateKind?: ToolbarButtonStateKind;
  accent?: ToolbarButtonAccent;
  /** Suppresses the mousedown default so the click cannot steal focus from the
   *  editor selection the command reads. Opt-in; the heading trigger
   *  deliberately omits it (opening the popover doesn't blur the
   *  contenteditable the way a mark command's focus does). */
  preventFocusSteal?: boolean;
  /** id of the region this trigger reveals — "disclosure" kind only. */
  ariaControls?: string;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

export function ToolbarButton({
  active = false,
  onClick,
  ariaLabel,
  title,
  lang,
  stateKind = "action",
  accent = "dark-blue",
  preventFocusSteal,
  ariaControls,
  ref,
  children,
}: ToolbarButtonProps) {
  const stateText = lang && stateKind === "toggle" ? t(lang, active ? "toggleStateOn" : "toggleStateOff") : "";
  const fullTitle = [title, stateText].filter(Boolean).join(" · ") || undefined;
  const stateAttrs: StateAttrs =
    stateKind === "toggle"
      ? { "aria-pressed": active }
      : stateKind === "disclosure"
        ? { "aria-expanded": active, "aria-controls": ariaControls }
        : {};
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseDown={preventFocusSteal ? (e) => e.preventDefault() : undefined}
      {...stateAttrs}
      aria-label={ariaLabel}
      title={fullTitle}
      className={`${BASE} ${active ? ACTIVE[accent] : INACTIVE}`}
    >
      {children}
      {/* Non-colour pressed/expanded cue (WCAG 1.4.1) — an overlay, not a flex
          sibling, so it reserves no width when inactive. bg-current tracks the
          same active-state text colour above, which already has strong
          contrast against every scheme's surface. */}
      <span
        aria-hidden="true"
        data-pressed-marker={active ? "on" : "off"}
        className={`pointer-events-none absolute bottom-0.5 left-1/2 h-0.5 w-2.5 -translate-x-1/2 rounded-full bg-current${active ? "" : " opacity-0"}`}
      />
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/rich-text-toolbar-button.test.tsx`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/rich-text-toolbar-button.tsx src/app/rich-text-toolbar-button.test.tsx
git commit -m "$(cat <<'EOF'
feat(rich-text): add compact borderless ToolbarButton

New toolbar-local component matching the tiptap simple-editor button
chrome (no border, 24px square). Pressed/expanded state carries a
small non-colour marker rather than a pure background-colour shift,
since --ui-dark-blue has no lightness headroom against the dark
schemes' surface (measured ~1.1-1.3:1 even at full opacity).
EOF
)"
```

---

### Task 2: Wire `rich-text-toolbar.tsx` to `ToolbarButton`

**Files:**
- Modify: `src/app/rich-text-toolbar.tsx:28-58,63,76,173-175,257-290,321-359`
- Test: `src/app/rich-text-toolbar.test.tsx:283`

- [ ] **Step 1: Swap imports**

In `src/app/rich-text-toolbar.tsx`, replace:

```tsx
import { Button } from "./button";
import { PopoverPanel } from "./popover-panel";
import { t, type Lang, type TranslationKey } from "./i18n";
import { ToggleButton } from "./toggle-button";
import type { ToggleAccent } from "./toggle-button";
```

with:

```tsx
import { PopoverPanel } from "./popover-panel";
import { t, type Lang, type TranslationKey } from "./i18n";
import { ToolbarButton } from "./rich-text-toolbar-button";
import type { ToolbarButtonAccent } from "./rich-text-toolbar-button";
```

- [ ] **Step 2: Shrink the shared icon size**

Replace:

```tsx
const ICON_CLASS = "h-4 w-4 shrink-0";
```

with:

```tsx
const ICON_CLASS = "h-3.5 w-3.5 shrink-0";
```

- [ ] **Step 3: Update `ControlSpec`'s accent type**

Replace:

```tsx
  accent?: ToggleAccent;
```

with:

```tsx
  accent?: ToolbarButtonAccent;
```

- [ ] **Step 4: Drop the divider's own margin (spacing now comes from the row's `gap`)**

Replace:

```tsx
function ToolbarDivider() {
  return <div aria-hidden="true" className="mx-0.5 w-px self-stretch bg-line" />;
}
```

with:

```tsx
function ToolbarDivider() {
  return <div aria-hidden="true" className="w-px self-stretch bg-line" />;
}
```

- [ ] **Step 5: Tighten the row gap**

Replace:

```tsx
    <div
      className="flex flex-wrap items-center gap-1"
      role={named ? "group" : undefined}
      aria-label={named ? label : undefined}
    >
```

with:

```tsx
    <div
      className="flex flex-wrap items-center gap-0.5"
      role={named ? "group" : undefined}
      aria-label={named ? label : undefined}
    >
```

- [ ] **Step 6: Replace the heading trigger's `Button` with `ToolbarButton`**

Replace:

```tsx
      <Button
        ref={headingTriggerRef}
        variant="secondary"
        size="xs"
        onClick={() => setHeadingMenuOpen((open) => !open)}
        aria-label={t(lang, "commTplHeadingLevel")}
        aria-expanded={headingMenuOpen}
        title={t(lang, "commTplHeadingLevel")}
        className="inline-flex items-center gap-1"
      >
        <TriggerIcon aria-hidden="true" className={ICON_CLASS} />
        <ChevronDownIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
      </Button>
```

with:

```tsx
      <ToolbarButton
        ref={headingTriggerRef}
        stateKind="disclosure"
        active={headingMenuOpen}
        onClick={() => setHeadingMenuOpen((open) => !open)}
        ariaLabel={t(lang, "commTplHeadingLevel")}
        title={t(lang, "commTplHeadingLevel")}
      >
        <TriggerIcon aria-hidden="true" className={ICON_CLASS} />
        <ChevronDownIcon aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
      </ToolbarButton>
```

- [ ] **Step 7: Replace the mark/block toggles**

Replace:

```tsx
      {CONTROLS.map((spec, index) => (
        <Fragment key={spec.name}>
          {GROUP_DIVIDER_BEFORE.has(index) && <ToolbarDivider />}
          <ToggleButton
            pressed={pressed[index]}
            onToggle={() => spec.run(editor)}
            lang={lang}
            preventFocusSteal
            accent={spec.accent}
            ariaLabel={t(lang, spec.key)}
            title={t(lang, spec.key)}
          >
            <spec.icon aria-hidden="true" className={ICON_CLASS} />
          </ToggleButton>
        </Fragment>
      ))}
```

with:

```tsx
      {CONTROLS.map((spec, index) => (
        <Fragment key={spec.name}>
          {GROUP_DIVIDER_BEFORE.has(index) && <ToolbarDivider />}
          <ToolbarButton
            stateKind="toggle"
            active={pressed[index]}
            onClick={() => spec.run(editor)}
            lang={lang}
            preventFocusSteal
            accent={spec.accent}
            ariaLabel={t(lang, spec.key)}
            title={t(lang, spec.key)}
          >
            <spec.icon aria-hidden="true" className={ICON_CLASS} />
          </ToolbarButton>
        </Fragment>
      ))}
```

- [ ] **Step 8: Replace Link and Unlink**

Replace:

```tsx
      <ToolbarDivider />
      <Button
        variant="secondary"
        size="xs"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAddLink}
        aria-label={t(lang, "commTplLink")}
        title={t(lang, "commTplLink")}
      >
        <LinkIcon aria-hidden="true" className={ICON_CLASS} />
      </Button>
      <Button
        variant="secondary"
        size="xs"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().unsetLink().run()}
        aria-label={t(lang, "commTplUnlink")}
        title={t(lang, "commTplUnlink")}
      >
        <UnlinkIcon aria-hidden="true" className={ICON_CLASS} />
      </Button>
    </div>
  );
}
```

with:

```tsx
      <ToolbarDivider />
      <ToolbarButton
        preventFocusSteal
        onClick={onAddLink}
        ariaLabel={t(lang, "commTplLink")}
        title={t(lang, "commTplLink")}
      >
        <LinkIcon aria-hidden="true" className={ICON_CLASS} />
      </ToolbarButton>
      <ToolbarButton
        preventFocusSteal
        onClick={() => editor.chain().focus().unsetLink().run()}
        ariaLabel={t(lang, "commTplUnlink")}
        title={t(lang, "commTplUnlink")}
      >
        <UnlinkIcon aria-hidden="true" className={ICON_CLASS} />
      </ToolbarButton>
    </div>
  );
}
```

- [ ] **Step 9: Run the existing toolbar suite — expect exactly one known failure**

Run: `npm run test:run -- src/app/rich-text-toolbar.test.tsx`
Expected: FAIL — one test, `"re-reads pressed state when the caret MOVES — a selection-only transaction"`,
on the assertion `expect(bold().querySelector("[data-pressed-marker]")?.className).not.toContain("invisible")`.
This is expected: the marker's inactive class changed from `invisible` to `opacity-0`. Every other test should
PASS unchanged (accessible names, `aria-pressed`/`aria-expanded`, group naming, divider count, focus-steal,
heading menu behavior are all untouched by this component swap).

- [ ] **Step 10: Fix the one marker-mechanism assertion**

In `src/app/rich-text-toolbar.test.tsx`, replace:

```tsx
    expect(bold().querySelector("[data-pressed-marker]")?.className).not.toContain("invisible");
```

with:

```tsx
    expect(bold().querySelector("[data-pressed-marker]")?.className).not.toContain("opacity-0");
```

- [ ] **Step 11: Run the full toolbar suite again**

Run: `npm run test:run -- src/app/rich-text-toolbar.test.tsx`
Expected: PASS — all tests (26).

- [ ] **Step 12: Commit**

```bash
git add src/app/rich-text-toolbar.tsx src/app/rich-text-toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(rich-text): switch toolbar controls to the compact ToolbarButton

Every control (12 mark/block toggles, heading trigger, Link, Unlink)
now renders through the new borderless ToolbarButton instead of the
shared ToggleButton/Button. Row and divider spacing tightened to
match. toggle-button.tsx and its other consumers are unaffected.
EOF
)"
```

---

### Task 3: Verify quality gates

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint at the real CI gate (bare `npm run lint` does not enforce `--max-warnings=0`)**

Run: `npx eslint --max-warnings=0 src/app`
Expected: exit 0. This specifically catches the removed `Button`/`ToggleButton`/`ToggleAccent` imports if
either edit in Task 2 missed a usage.

- [ ] **Step 3: Full unit suite**

Run: `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`
Expected: `EXIT=0`, all test files passing.

- [ ] **Step 4: Shuffled suite (new test file added — reproduces the CI order-dependence gate)**

Run: `npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log`
Expected: `EXIT=0`.

- [ ] **Step 5: Eye-verify in a real browser**

Run: `npm run dev`, open a surface that mounts this toolbar (e.g. a RAID item's Description field, or the
Change modal), and confirm by eye: buttons are visibly smaller/borderless, clicking Bold/Italic/etc. shows
the small underline marker (not a checkmark), and the heading-level popover still opens/closes correctly.
Check at least one dark-mode scheme (Settings → Appearance) — the marker should still be visible there,
confirming the a11y fallback actually renders as intended, not just in jsdom.

No code changes in this task — it exists to catch anything jsdom/vitest cannot see (real layout, real
contrast rendering), per this repo's own standing note that CSS landmines are structurally invisible to
the unit suite and axe alike.
