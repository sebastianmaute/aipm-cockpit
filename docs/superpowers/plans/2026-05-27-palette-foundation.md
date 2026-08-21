# Palette Foundation (E0) — Design Tokens (0.15.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the AIPM design-token foundation — semantic surface tokens (light + dark) in `globals.css`, a committed `docs/DESIGN-TOKENS.md` mapping doc, and the shared UI primitives migrated to the tokens as the proven reference.

**Architecture:** Add role-based CSS custom properties (`--surface`, `--surface-muted`, `--line`, `--muted-foreground`) with light values in `:root` and dark values in `.dark`, exposed as Tailwind utilities via `@theme inline`. Migrate the shared primitives (`segmented-control.tsx`, `modal-header.tsx`, `app-header.tsx`) from `zinc`/shadows to those tokens + the AIPM palette. `modal.tsx` is already compliant. Brand `--AIPM-*` tokens are unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4 (CSS `@theme`/`@custom-variant`, no JS config), Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-palette-foundation-design.md`
**Branch:** `feat/0.15.1-palette-foundation` (already created off `main`).

**Conventions:** colors/borders/shadow-removal only — no logic changes; components reference only semantic tokens + `--AIPM-*` utilities (no raw `zinc`/hex). Run `npx tsc --noEmit`, `npm run lint`, relevant `npx vitest run` after each task. Each task leaves the build green.

> **Heads-up for every implementer subagent:**
> 1. Fact-forcing gate hook. Before your FIRST shell command, print 2 facts (the task + what the command does). Before EVERY Write/Edit, in the SAME message print 4 facts — (a) importers of the file (run a Grep in the same turn), (b) public symbols/props affected, (c) data fields/values involved, (d) the user instruction verbatim: "adjust the design to follow the following table:" (the AIPM palette — Green dominant accent, Dark Blue headers; never gradients/shadows/off-palette colors). Then retry the same Write/Edit.
> 2. **eslint.config.mjs is edit-protected — do NOT touch it.** You should not need to.
> 3. Platform is win32 — use the Bash tool for `npx`/`git`/`npm`. No `&&`-chained `cd`.
> 4. After test runs, if `git status` shows `src/app/sample-workspace.md` modified, `git restore src/app/sample-workspace.md` BEFORE committing.

---

## Task 1: Semantic surface tokens in `globals.css`

**Files:**
- Modify: `src/app/globals.css`

No unit test (pure CSS variable declarations — nothing to assert in isolation; the utilities are exercised by Task 2's component + the gates). The current file (after the 0.15.0 theme work) is:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #ffffff;
  --foreground: #636362;

  /* Acme brand palette — only these colors are permitted */
  --AIPM-dark-grey: #636362;
  --AIPM-dark-blue: #004159;
  --AIPM-green: #84bd00;
  --AIPM-white: #ffffff;
  --AIPM-light-grey: #e3e6e6;
  --AIPM-medium-grey: #939598;
  --AIPM-blue: #60c0dd;
  --AIPM-pink: #e5497c;
  --AIPM-purple: #aa4899;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-titillium), "Segoe UI", Arial, sans-serif;

  --color-AIPM-dark-grey: var(--AIPM-dark-grey);
  --color-AIPM-dark-blue: var(--AIPM-dark-blue);
  --color-AIPM-green: var(--AIPM-green);
  --color-AIPM-white: var(--AIPM-white);
  --color-AIPM-light-grey: var(--AIPM-light-grey);
  --color-AIPM-medium-grey: var(--AIPM-medium-grey);
  --color-AIPM-blue: var(--AIPM-blue);
  --color-AIPM-pink: var(--AIPM-pink);
  --color-AIPM-purple: var(--AIPM-purple);
}

.dark {
  --background: #0a0a0a;
  --foreground: #e3e6e6;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-titillium), "Segoe UI", Arial, sans-serif;
}
```

- [ ] **Step 1: Add the light semantic tokens** — in the `:root` block, directly under `--foreground: #636362;`, add:
```css
  --surface: #ffffff;
  --surface-muted: #e3e6e6;
  --line: #e3e6e6;
  --muted-foreground: #939598;
```

- [ ] **Step 2: Expose them as utilities** — in the `@theme inline` block, directly under `--color-foreground: var(--foreground);`, add:
```css
  --color-surface: var(--surface);
  --color-surface-muted: var(--surface-muted);
  --color-line: var(--line);
  --color-muted-foreground: var(--muted-foreground);
```

- [ ] **Step 3: Add the dark overrides** — replace the existing `.dark` block with:
```css
.dark {
  --background: #0b0f12;
  --foreground: #e3e6e6;
  --surface: #121619;
  --surface-muted: #1b2024;
  --line: #2b3137;
}
```
(`--muted-foreground` stays `#939598` in both modes, so it needs no dark override. The dark neutrals `#0b0f12 / #121619 / #1b2024 / #2b3137` are the documented "palette-only" exception — they live ONLY here.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npx vitest run` (full suite green — no consumer yet, so nothing should change behaviorally).

- [ ] **Step 5: Commit**
```bash
git add src/app/globals.css
git commit -m "feat(design): semantic surface tokens (surface/muted/line/muted-foreground, light+dark)"
```

---

## Task 2: Migrate `segmented-control.tsx` to tokens + green focus ring

**Files:**
- Modify: `src/app/segmented-control.tsx`
- Test: `src/app/segmented-control.test.tsx` (create if absent; else append)

The component currently renders the wrapper with `border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900`, each button with `focus:ring-AIPM-dark-blue`, the selected pill `bg-AIPM-dark-blue text-white`, unselected `text-zinc-700 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed dark:text-zinc-200 dark:enabled:hover:bg-zinc-800`, and inter-segment divider `border-l border-zinc-300 dark:border-zinc-700`.

- [ ] **Step 1: Write the failing test** — create/append `src/app/segmented-control.test.tsx`:
```tsx
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentedControl } from "./segmented-control";

describe("SegmentedControl palette", () => {
  test("uses the green focus-ring accent and no drop shadow", () => {
    render(
      <SegmentedControl
        value="a"
        ariaLabel="test"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={() => {}}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0].className).toContain("ring-AIPM-green");
    expect(radios[0].className).not.toContain("ring-AIPM-dark-blue");
    const group = screen.getByRole("radiogroup");
    expect(group.className).not.toContain("shadow");
    expect(group.className).not.toContain("zinc");
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/app/segmented-control.test.tsx`. Expected: FAIL (current ring is `ring-AIPM-dark-blue`, wrapper has `shadow-sm` + `zinc`).

- [ ] **Step 3: Implement** — in `src/app/segmented-control.tsx`:
  - Wrapper `className` (the `role="radiogroup"` div): change
    ```
    inline-flex flex-wrap rounded-md border border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900
    ```
    to
    ```
    inline-flex flex-wrap rounded-md border border-line bg-surface
    ```
  - Button base class: change `focus:ring-AIPM-dark-blue` → `focus:ring-AIPM-green` (in the line `px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-1 focus:ring-AIPM-dark-blue`).
  - Inter-segment divider: change `idx > 0 ? "border-l border-zinc-300 dark:border-zinc-700" : ""` → `idx > 0 ? "border-l border-line" : ""`.
  - Selected/unselected branch: keep selected `"bg-AIPM-dark-blue text-white"` (fill — unchanged); change unselected
    ```
    "text-zinc-700 enabled:hover:bg-zinc-100 disabled:cursor-not-allowed dark:text-zinc-200 dark:enabled:hover:bg-zinc-800"
    ```
    to
    ```
    "text-foreground enabled:hover:bg-surface-muted disabled:cursor-not-allowed"
    ```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/app/segmented-control.test.tsx`; then `npx tsc --noEmit` (0); `npm run lint` (0); `npx vitest run` (full suite green — many components render SegmentedControl, so confirm no regressions).

- [ ] **Step 5: Commit**
```bash
git add src/app/segmented-control.tsx src/app/segmented-control.test.tsx
git commit -m "feat(design): SegmentedControl to surface tokens + green focus ring (no shadow/zinc)"
```

---

## Task 3: Migrate `modal-header.tsx` and `app-header.tsx`

**Files:**
- Modify: `src/app/modal-header.tsx`
- Modify: `src/app/app-header.tsx`

No new unit test (visual migration; existing tests for these components/their consumers must stay green). `modal.tsx` is already compliant (backdrop `bg-AIPM-dark-blue/40`, panel rendered by callers, no `zinc`/`shadow`) — do NOT change it.

- [ ] **Step 1: modal-header.tsx** — two edits:
  1. The `<header>` className: change
     ```
     sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-AIPM-light-grey bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950
     ```
     to
     ```
     sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4
     ```
  2. The close `<button>` className: change
     ```
     rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey
     ```
     to
     ```
     rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey
     ```
  (Leave the title `h2` `text-AIPM-dark-blue dark:text-AIPM-light-grey` — a dark-blue heading, already correct.)

- [ ] **Step 2: app-header.tsx** — the only off-palette usage is `dark:hover:bg-zinc-800` and the dark-blue focus rings. For BOTH icon `<button>`s (the "add task" button ~line 82 and the "show due alerts" button ~line 105), change the className fragment
  ```
  hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey
  ```
  to
  ```
  hover:bg-surface-muted hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-green dark:text-AIPM-medium-grey dark:hover:text-AIPM-light-grey
  ```
  (Both buttons share this exact fragment after their leading `text-AIPM-dark-grey` / `relative ... text-AIPM-dark-grey`. Leave the `bg-AIPM-pink` notification badge — already palette-correct. The `<h1>`/`<p>`/logo are already palette.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npx vitest run` (full suite green). Then open each of the two files and confirm no `zinc-` or `shadow-` tokens remain.

- [ ] **Step 4: Commit**
```bash
git add src/app/modal-header.tsx src/app/app-header.tsx
git commit -m "feat(design): modal-header + app-header to surface tokens + green focus ring"
```

---

## Task 4: `DESIGN-TOKENS.md` + release 0.15.1

**Files:**
- Create: `docs/DESIGN-TOKENS.md`
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`

- [ ] **Step 1: Create `docs/DESIGN-TOKENS.md`** (committed — NOT under `docs/superpowers/`, so it is tracked):
```markdown
# AIPM Design Tokens & Color Rules

The single source of truth for color in lop-app. Every component uses ONLY the
semantic tokens and `--AIPM-*` brand utilities below — never raw `zinc-*` or hex.
Defined in `src/app/globals.css`.

## Brand palette (fixed in light & dark)

| Utility | Hex | Role |
|---|---|---|
| `AIPM-dark-grey` | #636362 | primary text (light) |
| `AIPM-dark-blue` | #004159 | fills (buttons), headers, section titles, table-headers |
| `AIPM-green` | #84BD00 | **dominant accent** — focus rings, active indicators, links, positive/done |
| `AIPM-light-grey` | #E3E6E6 | subtle bg / dividers / alt-rows |
| `AIPM-medium-grey` | #939598 | secondary text |
| `AIPM-blue` | #60C0DD | info / vacation / callouts / charts |
| `AIPM-pink` | #E5497C | errors / delete / alerts / overdue / critical |
| `AIPM-purple` | #AA4899 | warnings / medium-severity / holiday / differentiation |

## Semantic surface tokens (light / dark)

| Utility | Role | Light | Dark |
|---|---|---|---|
| `bg-background` | page bg | #FFFFFF | #0B0F12 |
| `text-foreground` | primary text | #636362 | #E3E6E6 |
| `bg-surface` | cards, panels, modals | #FFFFFF | #121619 |
| `bg-surface-muted` | alt rows, chips, hovers, subtle zones | #E3E6E6 | #1B2024 |
| `border-line` | borders, dividers | #E3E6E6 | #2B3137 |
| `text-muted-foreground` | secondary text | #939598 | #939598 |

The four dark neutrals are the ONLY non-palette values; they exist solely in
`globals.css` token definitions (the AIPM palette is light-oriented). Components
never reference them directly.

## Rules

- **Green accents, Dark Blue fills.** Solid fills (primary buttons, selected
  segmented-control pill) = `bg-AIPM-dark-blue text-white`. Green = focus rings,
  active/selected indicators, links, positive states.
- **No drop shadows, no gradients.** Remove every `shadow-*` and
  `bg-gradient`/`from-`/`via-`/`to-`. Use `border border-line` for separation.
- **Status mapping:** red→`AIPM-pink`, amber/warning/medium→`AIPM-purple`,
  info/vacation→`AIPM-blue`, holiday/differentiation→`AIPM-purple`,
  done/low→`AIPM-green`. Soft backgrounds use alpha tints (e.g. `bg-AIPM-pink/10`).

## Canonical recipes

- Primary button: `bg-AIPM-dark-blue text-white hover:bg-AIPM-dark-blue/90`
- Secondary button: `border border-line bg-surface text-foreground hover:bg-surface-muted`
- Destructive: text/border `AIPM-pink` (`text-AIPM-pink`, `border-AIPM-pink`, `hover:bg-AIPM-pink/10`)
- Focus ring: `focus:outline-none focus:ring-2 focus:ring-AIPM-green`
- Card / panel: `bg-surface border border-line`
- Table header: `bg-AIPM-dark-blue text-white`

## Migration status (sub-project E)

- E0 (0.15.1): tokens + `segmented-control`, `modal`, `modal-header`, `app-header`. ✅
- Remaining ~40 files: follow-on area sweeps apply this doc.
```

- [ ] **Step 2: version.ts** — set `export const APP_VERSION = "0.15.1";` (keep `APP_BUILD_DATE = "2026-05-27"; // Le Guin milestone`). Do NOT add a highlight key (patch; the `versionHighlightPalette` headline lands with the final sweep). Add a top comment above the existing `// 0.15.0 …` block:
```ts
// 0.15.1 lays the AIPM design-token foundation: semantic surface tokens
// (surface/muted/line/muted-foreground, light+dark) in globals.css, a
// DESIGN-TOKENS.md mapping doc, and the shared primitives (segmented control,
// modal header, app header) migrated to the palette (green accent, dark-blue
// fills, no shadows). Full app sweep follows.
```

- [ ] **Step 3: CHANGELOG** — READ `CHANGELOG.md` to match the existing style, then add above `[0.15.0]`:
```markdown
## [0.15.1] — 2026-05-27

### Changed
- Began the AIPM design-system rollout: introduced semantic surface tokens (light & dark) and migrated the shared controls — segmented controls, modal headers, and the app header — to the AIPM palette (green accent, dark-blue fills, no drop shadows). A new `docs/DESIGN-TOKENS.md` documents the tokens and color rules. The remaining screens follow in later updates.
```
(Match whatever format `[0.15.0]` uses if it differs.)

- [ ] **Step 4: Codemap** — in `docs/CODEMAPS/frontend.md`, note the semantic surface tokens in `globals.css` and the new `docs/DESIGN-TOKENS.md` reference. One concise line, matching the file's style.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore src/app/sample-workspace.md`.

- [ ] **Step 6: Commit**
```bash
git add docs/DESIGN-TOKENS.md src/app/version.ts CHANGELOG.md docs/CODEMAPS/frontend.md
git commit -m "docs(release): 0.15.1 — AIPM design-token foundation + DESIGN-TOKENS.md"
```

---

## Final review

Dispatch a final code reviewer over `git diff main...HEAD`. Instruct them to READ `version.ts`/`CHANGELOG.md` directly (not infer version from diff sign). Confirm: `APP_VERSION === "0.15.1"`, no new highlight key; the 4 new tokens exist in `:root`, `@theme inline`, and `.dark` (with the documented dark neutrals); `segmented-control`/`modal-header`/`app-header` have NO remaining `zinc-`/`shadow-`/gradient classes and use the tokens (green focus rings, dark-blue fills); `modal.tsx` unchanged (already clean); `docs/DESIGN-TOKENS.md` exists and matches the decided rules; scope is only the listed files (the other ~40 files are intentionally untouched); full suite green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Semantic surface tokens (light+dark) + `@theme inline` exposure → Task 1.
- Green focus ring / dark-blue fill / token adoption / no shadow on the shared primitives → Task 2 (segmented-control) + Task 3 (modal-header, app-header); modal.tsx verified already-compliant (no change).
- `docs/DESIGN-TOKENS.md` with token table + accent strategy + status mapping + no-shadow rule + recipes → Task 4.
- Release 0.15.1 (no highlight key), CHANGELOG, codemap → Task 4.
All spec requirements map to a task. (The spec's status-mapping table is documented in DESIGN-TOKENS.md for the later sweeps; E0 itself only needs the primitives, which use dark-blue fill + green accent — no red/amber present in them.)

**Placeholder scan:** No TBD/TODO; every code/CSS step shows complete content; the test is concrete. The "match existing CHANGELOG style" note is a real source-confirmation.

**Type consistency:** Utility names are consistent across tasks — `bg-surface`, `bg-surface-muted`, `border-line`, `text-muted-foreground`, `text-foreground`, `ring-AIPM-green` — all defined by the `@theme inline` additions in Task 1 (`--color-surface`, `--color-surface-muted`, `--color-line`, `--color-muted-foreground`) and consumed verbatim in Tasks 2–3. No utility is used that Task 1 doesn't define (`ring-AIPM-green`/`bg-AIPM-dark-blue`/`text-foreground` already exist).
