# Dot atom primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a token-parameterised size+shape `Dot` atom, refactor `RagDot` onto it, and migrate 4 hand-rolled dot call sites to it — without moving any semantic colour map into the atom.

**Architecture:** New pure presentational `dot.tsx` owns only the diameter (`DotSize`) and the `inline-block shrink-0 rounded-full` shape, taking colour as a raw bg-token className. Local semantic maps (`TIER_RAG`, `DIRECTION_DOT`) stay put and feed the atom's `color` prop. `RagDot` becomes a thin wrapper passing `healthDot[level]` as the colour.

**Tech Stack:** TypeScript, React (Next.js ^16), Tailwind v4 (arbitrary-value `bg-[var(--rag-*)]` tokens), vitest + @testing-library/react.

**Reference:** Spec at `docs/superpowers/specs/2026-07-24-dot-atom-primitive-design.md`.

---

## File Structure

- **Create:** `src/app/dot.tsx` — the `Dot` atom + exported `DotSize`/`DOT_SIZE`.
- **Create:** `src/app/dot.test.tsx` — unit tests for the atom.
- **Modify:** `src/app/rag-dot.tsx` — build on `Dot`, import `DotSize`/`DOT_SIZE`.
- **Modify:** `src/app/action-chips.tsx` — 1 dot → `<Dot>`.
- **Modify:** `src/app/actions-panel.tsx` — 2 dots → `<Dot>`.
- **Modify:** `src/app/insights/insight-outcome-badge.tsx` — 1 dot → `<Dot>` + comment update.
- **Modify:** `src/app/resource-picker.tsx` — 1 dot → `<Dot>`.

`rag-dot.test.tsx` and the panel tests are NOT edited — they are regression guards.

**Conventions (from AGENTS.md):**
- Lint is `--max-warnings=0`: an unused import is FATAL. After removing the last use of `TIER_RAG`/`healthDot`/etc. in a file, verify the import is still used before finishing.
- Run `npx tsc --noEmit` after each edit (test-only type errors pass build+vitest but fail CI).
- Palette: never introduce a colour in the atom; callers pass sanctioned token classes only.
- Do not touch tour step dots (`tour-overlay.tsx`) or `RagBadge` (`rag-badge.tsx`) — out of scope.

---

### Task 1: Create the `Dot` atom (TDD)

**Files:**
- Create: `src/app/dot.tsx`
- Test: `src/app/dot.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/dot.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dot } from "./dot";

describe("Dot", () => {
  it("renders a decorative dot with the passed color, default sm size, round shape", () => {
    const { container } = render(<Dot color="bg-ui-green" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveAttribute("aria-hidden");
    expect(dot).not.toHaveAttribute("role");
    expect(dot.className).toContain("bg-ui-green");
    expect(dot.className).toContain("h-2 w-2");
    expect(dot.className).toContain("rounded-full");
    expect(dot.className).toContain("shrink-0");
  });

  it("applies the requested size token", () => {
    expect(render(<Dot color="bg-ui-green" size="xs" />).container.querySelector("span")!.className).toContain("h-1.5 w-1.5");
    expect(render(<Dot color="bg-ui-green" size="md" />).container.querySelector("span")!.className).toContain("h-2.5 w-2.5");
    expect(render(<Dot color="bg-ui-green" size="lg" />).container.querySelector("span")!.className).toContain("h-3 w-3");
  });

  it("appends extra className verbatim", () => {
    const { container } = render(<Dot color="bg-ui-green" className="mt-1" />);
    expect(container.querySelector("span")!.className).toContain("mt-1");
  });

  it("renders a labeled graphic when label is set", () => {
    const { container } = render(<Dot color="bg-[var(--rag-red)]" label="Worsened" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveAttribute("role", "img");
    expect(dot).toHaveAttribute("aria-label", "Worsened");
    expect(dot).toHaveAttribute("title", "Worsened");
    expect(dot).not.toHaveAttribute("aria-hidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/dot.test.tsx`
Expected: FAIL — cannot resolve `./dot` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/app/dot.tsx`:

```tsx
"use client";

// Presentational size+shape dot atom. Owns ONLY the diameter + the
// `rounded-full` shape; the COLOUR is passed as a raw bg-token className so
// each caller keeps its own local semantic map (TIER_RAG, DIRECTION_DOT, …).
// Kept deliberately colour-agnostic so the palette-sweep is unaffected and so
// the atom never re-centralises a semantic map (see AGENTS.md — a shared
// coloured status enum belongs in the caller, not here). `RagDot` builds on it.
export type DotSize = "xs" | "sm" | "md" | "lg";

export const DOT_SIZE: Record<DotSize, string> = {
  xs: "h-1.5 w-1.5", // 6px
  sm: "h-2 w-2", //     8px
  md: "h-2.5 w-2.5", // 10px
  lg: "h-3 w-3", //    12px
};

interface DotProps {
  /** A bg colour-token className, e.g. "bg-[var(--rag-red)]" or "bg-ui-green". */
  color: string;
  /** Diameter token; defaults to "sm" (8px). */
  size?: DotSize;
  /** Extra positioning classes (e.g. "mt-1") appended verbatim. */
  className?: string;
  /** When set, the dot is a LABELED graphic (role="img" + name) instead of
   *  decorative — use only when no adjacent visible text conveys the meaning. */
  label?: string;
}

export function Dot({ color, size = "sm", className, label }: DotProps) {
  const cls = `inline-block shrink-0 rounded-full ${DOT_SIZE[size]} ${color}${
    className ? ` ${className}` : ""
  }`;
  if (label) {
    return <span role="img" title={label} aria-label={label} className={cls} />;
  }
  return <span aria-hidden className={cls} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/dot.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/dot.tsx src/app/dot.test.tsx
git commit -m "feat(ui): add token-parameterised Dot atom"
```

---

### Task 2: Refactor `RagDot` onto `Dot`

**Files:**
- Modify: `src/app/rag-dot.tsx`
- Regression test (do NOT edit): `src/app/rag-dot.test.tsx`

- [ ] **Step 1: Replace the file body**

Replace the whole content of `src/app/rag-dot.tsx` with:

```tsx
"use client";
import { healthDot, type Health } from "./health";
import { Dot, type DotSize } from "./dot";

// Shared RAG status dot — the small coloured circle that precedes a health
// label across the app (task rows, RAID/change severity, reports groups, KPI
// tiles, digests). Colour rides `healthDot` (the single --rag-* role-token map
// in health.ts); the size+shape come from the shared `Dot` atom. This wrapper
// pins the Health-only contract the codebase leans on — non-Health callers use
// `Dot` directly with their own colour map, NOT this component.
export type RagDotSize = DotSize;

interface RagDotProps {
  level: Health;
  /** Diameter token; defaults to `sm` (8px). */
  size?: RagDotSize;
  /** Extra positioning classes (e.g. `mt-1`) appended verbatim. */
  className?: string;
  /** When set, the dot is a LABELED status graphic (`role="img"` + name)
   *  rather than decorative — use only when no adjacent visible text already
   *  conveys the RAG meaning (else keep it `aria-hidden`, the default). */
  label?: string;
}

export function RagDot({ level, size = "sm", className, label }: RagDotProps) {
  return <Dot color={healthDot[level]} size={size} className={className} label={label} />;
}
```

- [ ] **Step 2: Run the existing RagDot regression test**

Run: `npm run test:run -- src/app/rag-dot.test.tsx`
Expected: PASS (all existing tests still green — contract preserved).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/rag-dot.tsx
git commit -m "refactor(ui): build RagDot on the Dot atom"
```

---

### Task 3: Migrate `action-chips.tsx`

**Files:**
- Modify: `src/app/action-chips.tsx` (~L43)

- [ ] **Step 1: Add the import**

At the top of `src/app/action-chips.tsx`, alongside the existing imports (there is already
`import { TIER_RAG } from "./next-actions/action-cta";`), add:

```tsx
import { Dot } from "./dot";
```

- [ ] **Step 2: Replace the inline dot span**

Find (~L43):

```tsx
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIER_RAG[action.tier as "now" | "soon"].dot}`} />
```

Replace with:

```tsx
          <Dot color={TIER_RAG[action.tier as "now" | "soon"].dot} size="xs" />
```

- [ ] **Step 3: Verify TIER_RAG import is still used**

`TIER_RAG` is still referenced in the replacement line — the import stays. Confirm no other now-unused import was left.

- [ ] **Step 4: Run the file's tests + typecheck**

Run: `npm run test:run -- src/app/action-chips` and `npx tsc --noEmit`
Expected: PASS; tsc exit 0. (If no dedicated action-chips test file exists, run `npm run test:run -- action` to cover the panel tests that render chips.)

- [ ] **Step 5: Commit**

```bash
git add src/app/action-chips.tsx
git commit -m "refactor(ui): use Dot atom in action-chips"
```

---

### Task 4: Migrate `actions-panel.tsx` (2 dots)

**Files:**
- Modify: `src/app/actions-panel.tsx` (~L197 and ~L213)

- [ ] **Step 1: Add the import**

At the top of `src/app/actions-panel.tsx` (there is already
`import { TIER_RAG } from "./next-actions/action-cta";`), add:

```tsx
import { Dot } from "./dot";
```

- [ ] **Step 2: Replace the monitor-header dot (~L197)**

Find:

```tsx
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TIER_RAG.monitor.dot}`} />
```

Replace with:

```tsx
                    <Dot color={TIER_RAG.monitor.dot} size="xs" />
```

- [ ] **Step 3: Replace the tier-header dot (~L213)**

Find:

```tsx
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TIER_RAG[tier].dot}`} />
```

Replace with:

```tsx
                  <Dot color={TIER_RAG[tier].dot} size="xs" />
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/app/actions-panel` and `npx tsc --noEmit`
Expected: PASS; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions-panel.tsx
git commit -m "refactor(ui): use Dot atom in actions-panel"
```

---

### Task 5: Migrate `insight-outcome-badge.tsx`

**Files:**
- Modify: `src/app/insights/insight-outcome-badge.tsx` (~L44 + the comment at L9-13)

- [ ] **Step 1: Add the import**

At the top of `src/app/insights/insight-outcome-badge.tsx`, add (note the `../` — the file is one
directory deep):

```tsx
import { Dot } from "../dot";
```

- [ ] **Step 2: Update the `DIRECTION_DOT` comment (L9-13)**

Replace the existing comment block above `const DIRECTION_DOT`:

```tsx
// Deliberately NOT the shared `RagDot`: its `level` is `Health` ("R"|"A"|"G"),
// which cannot express the neutral "unchanged" state — and mapping neutral to
// amber would read as "at risk". A local token map is the established pattern
// for every non-Health dot in the app (TIER_RAG in actions-panel/action-chips,
// the resource-picker linked marker, tour step dots). Please don't "fix" this.
```

with:

```tsx
// Deliberately NOT `RagDot`: its `level` is `Health` ("R"|"A"|"G"), which cannot
// express the neutral "unchanged" state — mapping neutral to amber would read as
// "at risk". This local token map stays here (the established pattern for every
// non-Health dot: TIER_RAG in actions-panel/action-chips, the resource-picker
// linked marker, tour step dots) and feeds the shared size+shape `Dot` atom's
// `color` prop. Please don't "fix" this into RagDot.
```

- [ ] **Step 3: Replace the inline dot span (~L42-45)**

Find:

```tsx
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${DIRECTION_DOT[outcome.direction]}`}
      />
```

Replace with:

```tsx
      <Dot color={DIRECTION_DOT[outcome.direction]} size="sm" />
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- insight-outcome` and `npx tsc --noEmit`
Expected: PASS; tsc exit 0. (If no dedicated test, run `npm run test:run -- insight` to cover renderers.)

- [ ] **Step 5: Commit**

```bash
git add src/app/insights/insight-outcome-badge.tsx
git commit -m "refactor(ui): use Dot atom in insight outcome badge"
```

---

### Task 6: Migrate `resource-picker.tsx`

**Files:**
- Modify: `src/app/resource-picker.tsx` (~L304)

- [ ] **Step 1: Add the import**

At the top of `src/app/resource-picker.tsx`, add:

```tsx
import { Dot } from "./dot";
```

- [ ] **Step 2: Replace the linked-resource marker (~L304)**

Find:

```tsx
                          {row.kind === "resource" && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ui-green" />}
```

Replace with:

```tsx
                          {row.kind === "resource" && <Dot color="bg-ui-green" size="xs" />}
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm run test:run -- resource-picker` and `npx tsc --noEmit`
Expected: PASS; tsc exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/resource-picker.tsx
git commit -m "refactor(ui): use Dot atom in resource-picker"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:run`
Expected: PASS (no regressions across actions-panel / insight / resource-picker / rag-dot).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 warnings (verify no orphaned imports left by the migrations).

- [ ] **Step 4: Duplication + size gates**

Run: `npm run dup:check` and `npm run size:check`
Expected: PASS (the atom REDUCES duplication; new file is small).

---

## Self-Review

**Spec coverage:**
- New `dot.tsx` atom (size+shape, colour-agnostic, aria mirrors RagDot) → Task 1. ✅
- `DotSize`/`DOT_SIZE` live in `dot.tsx`, imported by rag-dot → Task 1 (defines) + Task 2 (imports). ✅
- RagDot refactor, public API unchanged, `rag-dot.test.tsx` green → Task 2. ✅
- 4 call-site migrations (action-chips, actions-panel ×2, insight-outcome-badge, resource-picker) → Tasks 3–6. ✅
- Semantic maps (TIER_RAG, DIRECTION_DOT) stay local → Tasks 3–5 pass `.dot`/value into `color`, maps untouched. ✅
- DIRECTION_DOT comment updated → Task 5 Step 2. ✅
- Out of scope (tour dots, RagBadge) → not touched by any task. ✅
- Constraints (tsc per edit, lint 0-warnings, palette, dup/size gates) → per-task steps + Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type consistency:** `Dot` prop names (`color`/`size`/`className`/`label`), `DotSize`, `DOT_SIZE` used identically in Tasks 1–2. `TIER_RAG[...].dot` and `DIRECTION_DOT[direction]` match the strings read in the pre-edit grep. ✅
