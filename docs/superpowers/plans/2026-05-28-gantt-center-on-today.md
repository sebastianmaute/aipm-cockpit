# Gantt Center-on-Today (0.17.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gantt scroll so today's date sits in the viewport center on initial mount.

**Architecture:** Single-file change in `src/app/gantt.tsx`. Add a `didInitialScroll` ref + `useLayoutEffect` that fires once when both `wrapperRef.current` exists and `todayOffsetPx > 0`; computes `target = todayOffsetPx − clientWidth / 2`, clamps to `[0, scrollWidth − clientWidth]`, sets `scrollLeft`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-gantt-center-on-today-design.md`
**Branch:** `feat/0.17.1-gantt-center-on-today` (already created off `main`).

> **Heads-up for the implementer subagent:**
> 1. **Fact-forcing gate.** Before FIRST shell command print 2 facts. Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `Gantt` in same turn), (b) symbols affected (none — internal ref + effect), (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. **win32** — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.

---

## Task 1: Add the scroll-on-mount effect to `gantt.tsx`

**Files:** Modify `src/app/gantt.tsx`.

- [ ] **Step 1: Add `useLayoutEffect` to the React import**

Edit `src/app/gantt.tsx` line 28:
- Find: `import { useEffect, useMemo, useRef, useState } from "react";`
- Replace: `import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";`

- [ ] **Step 2: Add the `didInitialScroll` latch ref**

Read `src/app/gantt.tsx` around L529–535 to confirm where `wrapperRef` is declared. The existing line is:
```tsx
const wrapperRef = useRef<HTMLDivElement | null>(null);
```

Edit immediately after that line — insert a new line:
- Find: `const wrapperRef = useRef<HTMLDivElement | null>(null);`
- Replace:
```tsx
const wrapperRef = useRef<HTMLDivElement | null>(null);
const didInitialScroll = useRef(false);
```

- [ ] **Step 3: Add the `useLayoutEffect`**

Read `src/app/gantt.tsx` around L980–990 to confirm the surrounding code. The existing block computes `todayOffsetPx` and `timelineWidthPx`:
```tsx
const todayOffsetPx =
  LEFT_GUTTER_PX + diffDays(range.min, today) * DAY_WIDTH_PX;
const timelineWidthPx = range.days * DAY_WIDTH_PX;
```

Edit immediately after the `timelineWidthPx` line — insert the effect:
- Find:
```
const todayOffsetPx =
    LEFT_GUTTER_PX + diffDays(range.min, today) * DAY_WIDTH_PX;
  const timelineWidthPx = range.days * DAY_WIDTH_PX;
```
- Replace with:
```
const todayOffsetPx =
    LEFT_GUTTER_PX + diffDays(range.min, today) * DAY_WIDTH_PX;
  const timelineWidthPx = range.days * DAY_WIDTH_PX;

  // On mount (and on the first render where layout is meaningful), scroll
  // the chart so today sits in the viewport's horizontal center. Latched so
  // the user's manual scroll position is preserved on later renders.
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const el = wrapperRef.current;
    if (!el || todayOffsetPx <= 0) return;
    const target = todayOffsetPx - el.clientWidth / 2;
    el.scrollLeft = Math.max(
      0,
      Math.min(el.scrollWidth - el.clientWidth, target),
    );
    didInitialScroll.current = true;
  }, [todayOffsetPx]);
```

(Match the surrounding indentation byte-for-byte. The exact whitespace depends on the file — read first if unsure.)

- [ ] **Step 4: Type-check + lint**

Run:
```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. (6 pre-existing warnings in unrelated test files are OK.)

If `src/app/sample-workspace.md` is dirty, `git restore` it.

- [ ] **Step 5: Run existing gantt tests**

```bash
npx vitest run gantt
```
Expected: existing tests PASS (no regression). The new behaviour is asserted in Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/app/gantt.tsx
git commit -m "feat(gantt): center today in viewport on initial mount"
```

---

## Task 2: Add unit tests for the centering behaviour

**Files:** Modify `src/app/gantt.test.tsx`.

- [ ] **Step 1: Read the existing test file**

Read `src/app/gantt.test.tsx` end-to-end. Identify:
- The existing render-helper pattern and Testing Library imports
- The exact prop shape the Gantt component expects (mirror what the existing tests pass)
- The selector that finds the scroll wrapper (the outermost `overflow-auto` div per the spec — the wrapper that has the `wrapperRef`)
- Any shared Task fixture / factory helper

JSDOM does not compute layout — `clientWidth`, `scrollWidth`, `scrollLeft` are all 0 by default. The tests mock dimensions via `Object.defineProperty` on the wrapper after render, then trigger a re-render to let the effect re-run with non-zero dimensions.

- [ ] **Step 2: Add the first test (centers today)**

Append this `it(...)` to the existing top-level `describe("Gantt", …)` block (or the closest matching describe). Match prop names and types to what the existing tests pass.

```tsx
it("centers today in the viewport on initial mount", async () => {
  const today = new Date();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const dayPlus = (n: number) => {
    const x = new Date(today);
    x.setUTCDate(x.getUTCDate() + n);
    return isoDay(x);
  };
  const tasks = [
    {
      id: 1,
      taskName: "A",
      assignee: "x",
      priority: "Medium" as const,
      startDate: dayPlus(-30),
      dueDate: dayPlus(30),
    },
  ];

  // Replace the props below with whatever the existing tests in this file use
  // for required Gantt props — only `tasks` + `today` matter for this test.
  const { container, rerender } = render(
    <Gantt {...(makeBaseProps?.() ?? {})} tasks={tasks as unknown as Task[]} today={isoDay(today)} />,
  );

  const wrapper = container.querySelector(".overflow-auto") as HTMLDivElement | null;
  expect(wrapper).not.toBeNull();
  if (!wrapper) return;

  Object.defineProperty(wrapper, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(wrapper, "scrollWidth", { configurable: true, value: 4000 });

  // Trigger a re-render so the useLayoutEffect re-runs with the mocked dimensions.
  rerender(
    <Gantt {...(makeBaseProps?.() ?? {})} tasks={tasks as unknown as Task[]} today={isoDay(today)} />,
  );

  // We don't reach into LEFT_GUTTER_PX / DAY_WIDTH_PX directly — assert that
  // scrollLeft was set to a positive value inside the valid range, which
  // proves the effect fired.
  expect(wrapper.scrollLeft).toBeGreaterThan(0);
  expect(wrapper.scrollLeft).toBeLessThanOrEqual(4000 - 800);
});
```

If the existing tests use a different render helper (e.g. they pass an explicit prop bag or import `makeBaseProps` / similar), mirror that pattern; the code above is the canonical shape. The `makeBaseProps?.()` is a placeholder for "use whatever this file uses to satisfy required props" — if no such helper exists, inline the necessary prop set.

- [ ] **Step 3: Add the second test (does not re-scroll)**

```tsx
it("does not re-scroll after the initial mount", async () => {
  const today = new Date();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const dayPlus = (n: number) => {
    const x = new Date(today);
    x.setUTCDate(x.getUTCDate() + n);
    return isoDay(x);
  };
  const tasks = [
    {
      id: 1,
      taskName: "A",
      assignee: "x",
      priority: "Medium" as const,
      startDate: dayPlus(-30),
      dueDate: dayPlus(30),
    },
  ];

  const { container, rerender } = render(
    <Gantt {...(makeBaseProps?.() ?? {})} tasks={tasks as unknown as Task[]} today={isoDay(today)} />,
  );

  const wrapper = container.querySelector(".overflow-auto") as HTMLDivElement | null;
  expect(wrapper).not.toBeNull();
  if (!wrapper) return;

  Object.defineProperty(wrapper, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(wrapper, "scrollWidth", { configurable: true, value: 4000 });

  // First re-render: effect fires, scrollLeft set to centered value.
  rerender(
    <Gantt {...(makeBaseProps?.() ?? {})} tasks={tasks as unknown as Task[]} today={isoDay(today)} />,
  );
  const initialScroll = wrapper.scrollLeft;
  expect(initialScroll).toBeGreaterThan(0);

  // Simulate user manually scrolling.
  wrapper.scrollLeft = 100;

  // Add another task and re-render. The effect's latch must prevent it
  // from firing again.
  const tasks2 = [
    ...tasks,
    {
      id: 2,
      taskName: "B",
      assignee: "y",
      priority: "Medium" as const,
      startDate: dayPlus(0),
      dueDate: dayPlus(15),
    },
  ];
  rerender(
    <Gantt {...(makeBaseProps?.() ?? {})} tasks={tasks2 as unknown as Task[]} today={isoDay(today)} />,
  );

  expect(wrapper.scrollLeft).toBe(100); // preserved, not re-centered
});
```

- [ ] **Step 4: Run the new tests**

```bash
npx vitest run gantt
```
Expected: all existing tests pass + 2 new tests pass.

If the `.overflow-auto` selector matches multiple divs (the Gantt may have inner scrollable regions for the task-name gutter), refine to a more specific selector by matching one of the wrapper's distinctive classes — e.g. `div.overflow-auto.min-h-\\[240px\\]` or use `[data-testid]` after adding one to the wrapper in Task 1 if necessary.

If `useLayoutEffect` doesn't fire under JSDOM until something triggers a re-render, the `rerender(...)` call after the dimension mocks is the trigger — confirmed pattern.

- [ ] **Step 5: Gates**

```bash
npx tsc --noEmit
npm run lint
```
Expected: 0 errors. Restore `sample-workspace.md` if dirty.

- [ ] **Step 6: Commit**

```bash
git add src/app/gantt.test.tsx
git commit -m "test(gantt): assert today centers on mount and persists on rerender"
```

---

## Task 3: Release 0.17.1

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — READ first. Set `APP_VERSION = "0.17.1"` (currently `"0.17.0"`). Keep `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`. Do NOT add a highlight key. Add a new top-of-file comment block ABOVE the existing `// 0.17.0 "Jemisin" …` block:

```ts
// 0.17.1 fixes the Gantt's initial scroll position — when the chart opens,
// today's date is centered in the viewport so past/future tasks are equally
// accessible. Single useLayoutEffect on mount; user's manual scrolling is
// preserved on subsequent renders.
```

- [ ] **Step 2: CHANGELOG** — READ to match style; add a new `[0.17.1] — 2026-05-28` entry ABOVE the `[0.17.0]` entry:

```markdown
## [0.17.1] — 2026-05-28

### Fixed
- Gantt now opens with today centered in the viewport — scroll left for past tasks, right for future. Previously the chart opened at the leftmost data column regardless of where today fell, often hiding the most relevant bars off-screen.
```
Match `[0.17.0]`'s exact formatting.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:coverage
```
Expected: tsc 0; lint 0; all suites pass; coverage ≥ 70%.

Restore `sample-workspace.md` if dirty.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "docs(release): 0.17.1 — Gantt opens centered on today"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Confirm:

1. **Scope:** only `src/app/gantt.tsx`, `src/app/gantt.test.tsx`, `src/app/version.ts`, `CHANGELOG.md` touched.
2. **Effect implementation:** `useLayoutEffect` imported; `didInitialScroll` ref declared next to `wrapperRef`; effect body matches the spec exactly (latch + null check + `todayOffsetPx > 0` guard + clamp + set `scrollLeft`).
3. **Tests:** both new tests present; first asserts `scrollLeft > 0` and `≤ scrollWidth − clientWidth`; second asserts manual scrollLeft is preserved across a re-render.
4. **Release metadata:** `APP_VERSION === "0.17.1"`; `APP_BUILD_DATE` and `APP_HIGHLIGHT_KEYS` UNCHANGED from 0.17.0; CHANGELOG `[0.17.1]` entry non-empty.
5. **Gates:** `npx tsc --noEmit` 0; `npm run lint` 0; `npx vitest run` 896 existing + 2 new = 898 pass; `npm run test:coverage` ≥ 70%.

After approval, use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Latch ref + `useLayoutEffect` with `> 0` guard and clamp → Task 1 ✓
- Two focused unit tests (centers; doesn't re-scroll) → Task 2 ✓
- 0.17.1 patch release (no highlight key) → Task 3 ✓
- Non-goals (no re-center on refresh/zoom/resize; no "scroll to today" button; no layout change) → not implemented in any task ✓

**Placeholder scan:** No TBD/TODO. Test bodies include working code; the `makeBaseProps?.()` in Task 2 is an explicit "use what this file uses" instruction, not a stub. Task 2 Step 4's "if selector matches multiple divs" note is real fallback guidance.

**Type consistency:** Hook name `useLayoutEffect`, ref name `didInitialScroll`, wrapper ref `wrapperRef`, variable `todayOffsetPx` — all match the existing file's existing identifiers and are used identically across Tasks 1 and 2.

**Ordering note:** Task 2 depends on Task 1's code change to assert behavior; running Task 2 first would fail. Subagent-driven execution runs sequentially, so this is fine.
