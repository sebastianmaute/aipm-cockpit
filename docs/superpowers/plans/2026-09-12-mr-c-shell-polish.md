# MR C — shell polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the top-bar search field clipping the "Ask Claude" button, animate the `ToggleButton` pressed marker so it collapses when off, and land the app on the Dashboard at startup instead of on whatever view the last session left in the URL.

**Architecture:** Three independent slices, all in the shell. The clipping fix is class-only and touches the two top-bar mounts plus the Ask Claude trigger. The marker animation adds one opt-out prop to the shared `ToggleButton` primitive and opts two consumers out. The startup rule adds a cold-load argument to `useHashView` and one `executeJavaScript` call in the Electron main process.

**Tech Stack:** Next.js 16.2.11 (exact-pinned), React, TypeScript, Tailwind v4, vitest + @testing-library/react, Playwright (measurement only), Electron (desktop shell).

**Spec:** `docs/superpowers/specs/2026-09-12-project-key-facts-and-shell-polish-design.md` — sections 6.1, 6.2, 6.3. Read it alongside this plan; the plan argues from it.

## Global Constraints

- **Gates are CI-only. The push is the first check.** Do NOT run `npm run lint`, `npx tsc --noEmit`, `npm run test:run`, `npm run test:coverage`, or any `docs:*` / `followups:*` gate as part of this work. The targeted single-file `npx vitest run <file>` calls in these tasks are the TDD loop, not a gate, and are not a substitute for the pipeline.
- **Never run two vitest processes at once.** Finish one targeted run before starting another.
- **Never read a gate's or test's exit code through a pipe** — you get the pipe's status. Redirect to a file, echo `$?` unpiped, then read the file.
- `src/app/*.ts(x)` is CRLF in the working tree with LF blobs. Use the **Edit tool** for every source change. Never `sed -i` — under Git Bash it re-lines the whole file to LF and `core.autocrlf=true` hides it from the diff.
- **No new i18n strings in this MR.** Every label reused here already exists (`aiAskClaude`). `i18n.de.ts` is not touched — if a task seems to need a new key, stop and re-read the task.
- **No pushing, no MR, no merge without explicit instruction from the user.** Commit locally only.
- Do not disturb the dev server on port **3000** or the `.next/` directory. The measurement task uses an isolated server on port 3100 and stops it again.
- Palette: only sanctioned brand tokens. No gradients, no shadows, no off-palette colours. This MR adds no colours at all.
- `desktop/src/main.ts` is excluded from root `tsc` and is compiled only by the manual `desktop-package` job. Put logic in `desktop/src/lib/*` (typechecked and unit-testable) and keep `main.ts` to the call site.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `scratchpad/measure-topbar.mjs` (throwaway, never committed) | Measures top-bar geometry in Chromium at the failing width | 1 |
| `src/app/top-bar.tsx` | Modern shell's top bar; the two flex clusters whose space fight causes the clipping | 2 |
| `src/app/shell-chrome.tsx` | Classic `AppHeader` mount of the search box | 2 |
| `src/app/task-manager.tsx` | Modern `ModernShell` `search` slot mount of the search box | 2 |
| `src/app/ask-claude-menu.tsx` | The Ask Claude trigger that gets squeezed | 2 |
| `src/app/top-bar.test.tsx` | Pins the right cluster's `min-w-0` | 2 |
| `src/app/ask-claude-menu.test.tsx` | Pins `shrink-0`, `whitespace-nowrap`, and the icon-only branch's accessible name | 2 |
| `src/app/toggle-button.tsx` | The primitive: new `reserveMarkerSpace` opt-out + animated marker | 3 |
| `src/app/toggle-button.test.tsx` | Pins both branches and that the marker element survives in both states | 3 |
| `src/app/gantt-view-menu.tsx` | Opts its 8 view toggles out of the animation | 4 |
| `src/app/budget-panel-people-rows.tsx` | Opts its disclosure toggle out (width-clamped `<td>`) | 4 |
| `src/app/gantt-view-menu.test.tsx`, `src/app/budget-panel-people-rows.test.tsx` | Pin both opt-outs | 4 |
| `src/app/use-hash-view.ts` | Cold-load vs later-event hash handling | 5 |
| `src/app/use-hash-view.test.tsx` | Pins cold/deep-link/back-forward/MSAL/disabled-module cases | 5 |
| `desktop/src/lib/menu-model.ts` | `DASHBOARD_VIEW_HASH` beside `HELP_VIEW_HASH` | 6 |
| `desktop/src/lib/menu-model.test.ts` | Pins the dashboard script | 6 |
| `desktop/src/main.ts` | `second-instance` sets the fragment (call site only) | 6 |

**Before Task 1**, create the branch off the default branch:

```bash
git fetch origin
git switch -c fix/shell-polish-mr-c origin/main
```

---

### Task 1: Measure the clipping before changing anything

The spec states the cause as a **candidate**, not a conclusion: jsdom has no layout, so the only way to know which element overflows is to measure it in a real browser. If the measurement contradicts the candidate, **stop and report** — Task 2's code would be wrong.

**Files:**
- Create (throwaway, do NOT commit): `scratchpad/measure-topbar.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded measurement (numbers pasted into Task 2's commit message). No code.

- [ ] **Step 1: Start an isolated dev server**

Run in the background so it survives the rest of the task:

```bash
PORT=3100 npm run dev
```

Wait until `curl -o /dev/null -s -w "%{http_code}\n" http://localhost:3100/` prints `200`.

- [ ] **Step 2: Write the measurement script**

Create `scratchpad/measure-topbar.mjs` (use your scratchpad directory, not the repo):

```js
import { chromium } from "playwright";

const URL = "http://localhost:3100/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1420, height: 800 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("header", { timeout: 30000 });

const result = await page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const header = document.querySelector("header");
  const clusters = header ? Array.from(header.children) : [];
  const ask = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") ?? "").toLowerCase().includes("ask claude"),
  );
  const search = document.querySelector('header input');
  return {
    headerWidth: header ? Math.round(header.getBoundingClientRect().width) : null,
    clusters: clusters.map((c) => ({
      className: c.className,
      clientWidth: c.clientWidth,
      scrollWidth: c.scrollWidth,
      overflowing: c.scrollWidth > c.clientWidth,
      rect: rect(c),
    })),
    ask: ask
      ? { rect: rect(ask), clientWidth: ask.clientWidth, scrollWidth: ask.scrollWidth, height: ask.getBoundingClientRect().height, text: ask.textContent }
      : null,
    search: rect(search),
  };
});

console.log(JSON.stringify(result, null, 2));

if (result.ask && result.search) {
  const overlapPx = Math.round(result.ask.rect.right - result.search.x);
  console.log(`\nASK_RIGHT - SEARCH_LEFT = ${overlapPx}px  (> 0 means the search box covers the button)`);
  console.log(`ASK overflows its own box: ${result.ask.scrollWidth > result.ask.clientWidth}`);
}

await browser.close();
```

- [ ] **Step 3: Run it and record the numbers**

```bash
node <scratchpad>/measure-topbar.mjs > <scratchpad>/topbar-before.json 2>&1; echo "EXIT=$?"
cat <scratchpad>/topbar-before.json
```

Expected if the candidate is right: `ASK_RIGHT - SEARCH_LEFT` is **positive**, and/or the Ask Claude button reports `scrollWidth > clientWidth`, and/or its height is roughly double a one-line chip (the label wrapped).

**Three outcomes, three different next moves:**
1. `ask` is `null` — the Ask Claude trigger is not rendered because AI is disabled in this profile (`AskClaudeMenu` mounts only when `isAiEnabled(settings.ai)`). **Stop and report.** Ask the user to either enable AI in this profile or confirm the measurement from their own window; do not guess.
2. Numbers confirm overlap/overflow — record them and continue to Task 2.
3. No overlap and no overflow at 1420px — **stop and report.** Re-measure across 900–1600px in 50px steps by editing the viewport width in the script; if nothing reproduces, the candidate cause is wrong and Task 2 must be redesigned before any class is touched.

- [ ] **Step 4: Stop the isolated server**

```bash
PORT=3100 npm run stop
```

- [ ] **Step 5: No commit**

This task produces a measurement, not code. `scratchpad/measure-topbar.mjs` stays out of the repo. Carry the numbers into Task 2's commit message.

---

### Task 2: Fix the clipping in both top bars

**Files:**
- Modify: `src/app/top-bar.tsx` (the right-hand action cluster)
- Modify: `src/app/shell-chrome.tsx` (classic search wrapper)
- Modify: `src/app/task-manager.tsx` (modern search wrapper)
- Modify: `src/app/ask-claude-menu.tsx` (trigger wrapper + label span)
- Test: `src/app/top-bar.test.tsx`, `src/app/ask-claude-menu.test.tsx`

**Interfaces:**
- Consumes: the measurement from Task 1.
- Produces: no new exports. `AskClaudeMenu`'s rendered label becomes responsive (`hidden lg:inline`); its accessible name is unchanged and still comes from the `aria-label` on the `Button`.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/ask-claude-menu.test.tsx`:

```tsx
it("pins the trigger so it can never be squeezed below its label", () => {
  render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
  const trigger = screen.getByRole("button", { name: t("en-US", "aiAskClaude") });
  // The positioned wrapper must refuse to shrink: the top bar's left cluster
  // carries min-w-0, so without this the trigger is compressed below its
  // min-content width and its label overflows into the search field.
  expect(trigger.parentElement?.className).toContain("shrink-0");
  // And the label must never wrap to a second line.
  const label = trigger.querySelector("span");
  expect(label?.className).toContain("whitespace-nowrap");
});

it("drops to icon-only below lg while keeping its accessible name", () => {
  render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
  const trigger = screen.getByRole("button", { name: t("en-US", "aiAskClaude") });
  const label = trigger.querySelector("span");
  expect(label?.className).toContain("hidden");
  expect(label?.className).toContain("lg:inline");
  // The name comes from aria-label, so hiding the text costs AT nothing —
  // getByRole above already proves the name survives.
  expect(trigger).toHaveAttribute("aria-label", t("en-US", "aiAskClaude"));
});
```

Note the prop is **`onAsk`**, not `onAskClaude`, and `currentView` is required — copied from the existing tests in that file, which also already import `t` and `screen`.

Append to `src/app/top-bar.test.tsx`, reusing the `base` object the file defines at the top of the describe:

```tsx
it("lets the action cluster yield width so the search box cannot overlap its neighbour", () => {
  render(<TopBar {...base} search={<div data-testid="search" />} />);
  const cluster = screen.getByTestId("search").parentElement;
  // Without min-w-0 this cluster refuses to shrink (flex items default to
  // min-width:auto), so every pixel of pressure lands on the left cluster —
  // which is where the Ask Claude trigger lives.
  expect(cluster?.className).toContain("min-w-0");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/ask-claude-menu.test.tsx src/app/top-bar.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |✕" /tmp/t2.log
```

Expected: FAIL — `min-w-0`, `shrink-0`, `whitespace-nowrap`, `hidden` and `lg:inline` are all absent today.

- [ ] **Step 3: Let the action cluster shrink**

In `src/app/top-bar.tsx`, the right-hand cluster:

```tsx
      <div className="flex min-w-0 items-center gap-1">
        {search}
```

(was `<div className="flex items-center gap-1">`)

- [ ] **Step 4: Let the search wrapper yield**

In **both** mounts — `src/app/shell-chrome.tsx` (inside `trailing`) and `src/app/task-manager.tsx` (the `search` prop of `ModernShell`) — the wrapper currently reads:

```tsx
<div className="w-44 max-w-[55vw] sm:w-72 lg:w-96">
```

Change **both** to:

```tsx
<div className="min-w-0 w-44 max-w-[55vw] sm:w-72 lg:w-96">
```

`min-w-0` is the whole fix on this side: a flex item defaults to `min-width: auto`, which for a wrapper around an `<input>` resolves to the input's intrinsic width and makes it immovable. Both mounts carry the identical class string, and fixing one leaves the other layout broken — the dual-top-bar trap AGENTS.md records.

- [ ] **Step 5: Pin the Ask Claude trigger**

In `src/app/ask-claude-menu.tsx`:

```tsx
    <div ref={ref} className="relative shrink-0">
```

(was `className="relative"`)

and the label span inside the `Button`:

```tsx
        <span className="hidden whitespace-nowrap lg:inline">{t(lang, "aiAskClaude")}</span>
```

(was `<span>{t(lang, "aiAskClaude")}</span>`)

The `Button` already carries `aria-label={t(lang, "aiAskClaude")}` and a matching `title`, so the accessible name is unchanged when the text is hidden. WCAG 2.5.3 (label-in-name) does not apply once there is no visible label, and the icon-only state keeps its name and tooltip.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/app/ask-claude-menu.test.tsx src/app/top-bar.test.tsx > /tmp/t2b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t2b.log
```

Expected: PASS.

- [ ] **Step 7: Re-measure to prove the geometry actually changed**

jsdom cannot see layout, so the tests above prove only that the classes are present. Repeat Task 1's Steps 1–4 with the same script, writing to `topbar-after.json`, and compare:

```bash
node <scratchpad>/measure-topbar.mjs > <scratchpad>/topbar-after.json 2>&1; echo "EXIT=$?"
```

Expected: `ASK_RIGHT - SEARCH_LEFT` is now **negative or zero**, the Ask Claude button no longer overflows its own box, and its height is a single line. Also spot-check 900px, 1100px and 1600px by editing the viewport in the script — the fix moves where the pressure lands rather than removing it, so a narrower width is the case most likely to surface a new problem. If any width still overlaps, report the numbers rather than adding more classes speculatively.

- [ ] **Step 8: Commit**

```bash
git add src/app/top-bar.tsx src/app/shell-chrome.tsx src/app/task-manager.tsx src/app/ask-claude-menu.tsx src/app/top-bar.test.tsx src/app/ask-claude-menu.test.tsx
git commit -F- <<'MSG'
fix(shell): stop the search box clipping the Ask Claude button

TopBar is a two-cluster flex row. The left cluster carried min-w-0 and could
shrink below its content; the right cluster did not, and it holds the search
wrapper at a fixed lg:w-96 that never yields. So every pixel of pressure landed
on the left cluster, where AskClaudeMenu's trigger had neither shrink-0 nor a
non-wrapping label -- its label wrapped to two lines and "Claude" still
overflowed the squeezed box, painted over by the opaque search field.

Measured in Chromium before and after at 1420x800; the numbers are in the task
record. jsdom has no layout, so the unit tests can only pin the classes, which
is why the geometry was measured on both sides of the change.

Both top-bar mounts changed together. shell-chrome.tsx and task-manager.tsx
wrap the search in the identical class string, so fixing one would have left
the other layout broken.

The label drops to icon-only below lg. The accessible name still comes from the
Button's aria-label, so hiding the text costs assistive tech nothing and WCAG
2.5.3 stops applying once there is no visible label.
MSG
```

---

### Task 3: Animate the `ToggleButton` pressed marker

This **reverses a decision the primitive documents on purpose.** `toggle-button.tsx` renders the `CheckIcon` in both states and merely marks it `invisible` when off, so the button keeps one width; the comment's reason is that "a repeatedly-clicked control that resizes moves its neighbours under the pointer". The animation answers that in part — the icon is leftmost so the pointer never leaves it, and growth displaces only rightward neighbours — but it is a reversal, and the new prop is how a consumer keeps the old behaviour.

**Files:**
- Modify: `src/app/toggle-button.tsx`
- Test: `src/app/toggle-button.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `ToggleButtonProps.reserveMarkerSpace?: boolean` — when `true`, the marker reserves its width in both states (today's behaviour). Unset/false animates the collapse. Task 4 passes `true` at two call sites.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/toggle-button.test.tsx`:

```tsx
it("collapses the pressed marker to zero width when off, by default", () => {
  render(<ToggleButton pressed={false} onToggle={() => {}}>Grid</ToggleButton>);
  const marker = document.querySelector("[data-pressed-marker='off']");
  expect(marker).not.toBeNull();
  // Zero width plus a negative margin that cancels the button's own gap-1.5,
  // so an off marker occupies no horizontal space at all.
  expect(marker?.getAttribute("class")).toContain("w-0");
  expect(marker?.getAttribute("class")).toContain("-ml-1.5");
  // `invisible` would hide the glyph outright and there would be nothing to
  // animate; the zero width clips it instead (an <svg> root hides overflow).
  expect(marker?.getAttribute("class")).not.toContain("invisible");
});

it("expands the pressed marker when on", () => {
  render(<ToggleButton pressed onToggle={() => {}}>Grid</ToggleButton>);
  const marker = document.querySelector("[data-pressed-marker='on']");
  expect(marker?.getAttribute("class")).toContain("w-3.5");
  expect(marker?.getAttribute("class")).not.toContain("-ml-1.5");
});

it("reserveMarkerSpace restores the constant-width behaviour in both states", () => {
  const { rerender } = render(
    <ToggleButton pressed={false} reserveMarkerSpace onToggle={() => {}}>Grid</ToggleButton>,
  );
  const off = document.querySelector("[data-pressed-marker='off']");
  expect(off?.getAttribute("class")).toContain("w-3.5");
  expect(off?.getAttribute("class")).toContain("invisible");
  expect(off?.getAttribute("class")).not.toContain("w-0");

  rerender(<ToggleButton pressed reserveMarkerSpace onToggle={() => {}}>Grid</ToggleButton>);
  const on = document.querySelector("[data-pressed-marker='on']");
  expect(on?.getAttribute("class")).toContain("w-3.5");
  expect(on?.getAttribute("class")).not.toContain("invisible");
});

it("suppresses the transition under prefers-reduced-motion", () => {
  render(<ToggleButton pressed={false} onToggle={() => {}}>Grid</ToggleButton>);
  const marker = document.querySelector("[data-pressed-marker='off']");
  // Presence, not motion, is the WCAG 1.4.1 cue -- so snapping is correct and
  // loses nothing when the user has asked for less motion.
  expect(marker?.getAttribute("class")).toContain("motion-reduce:transition-none");
});
```

Match the file's existing render conventions (it may already have a local helper) rather than these literal calls.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/toggle-button.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |✕" /tmp/t3.log
```

Expected: FAIL — the marker is `w-3.5 invisible` in both states today and there is no `reserveMarkerSpace` prop.

- [ ] **Step 3: Add the prop**

In `src/app/toggle-button.tsx`, in the props interface beside `variant` and `preventFocusSteal`:

```tsx
  /** Reserve the pressed marker's width in BOTH states instead of collapsing it
   *  when off — i.e. OPT OUT of the collapse animation.
   *
   *  ★★ The collapse is the DEFAULT, and it reverses what this primitive used to
   *  guarantee: the marker was always rendered and merely `invisible`, so the
   *  button kept one width and a repeatedly-clicked control never moved its
   *  neighbours under the pointer. Pass `true` wherever that still matters —
   *  a toggle inside a width-clamped table cell, or a dense menu whose items
   *  must not reflow. `gantt-view-menu.tsx` and `budget-panel-people-rows.tsx`
   *  do; see their call sites for the specific reason in each. */
  reserveMarkerSpace?: boolean;
```

and destructure it with the other props (`reserveMarkerSpace = false`).

- [ ] **Step 4: Animate the marker**

Replace the `CheckIcon` at the end of the render with:

```tsx
      <CheckIcon
        aria-hidden="true"
        data-pressed-marker={pressed ? "on" : "off"}
        className={`h-3.5 shrink-0 transition-[width,margin] duration-150 motion-reduce:transition-none ${
          reserveMarkerSpace
            ? `w-3.5${pressed ? "" : " invisible"}`
            : pressed
              ? "w-3.5"
              : "w-0 -ml-1.5"
        }`}
      />
```

Three things to keep, each for its own reason. The element is **still rendered in both states** — it carries `data-pressed-marker`, which existing tests query, and it is the WCAG 1.4.1 non-colour cue. The `-ml-1.5` cancels `BASE`'s own `gap-1.5` so a collapsed marker leaves no orphan gap. And `invisible` appears **only** on the opt-out path: on the animated path a zero width already clips the glyph (an `<svg>` root hides its overflow by default), and `invisible` would leave nothing to animate.

Leave the long explanatory comment block above the icon in place and add one line to it noting that the width is now conditional.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/app/toggle-button.test.tsx > /tmp/t3b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t3b.log
```

Expected: PASS, and no previously-passing test in this file turns red — the marker element and its `data-pressed-marker` attribute are unchanged.

- [ ] **Step 6: Mutation-check that the default is actually pinned**

Temporarily change the destructure default to `reserveMarkerSpace = true` and re-run:

```bash
npx vitest run src/app/toggle-button.test.tsx > /tmp/t3m.log 2>&1; echo "EXIT=$?"
grep -cE "✕" /tmp/t3m.log
```

Expected: the two default-behaviour tests fail (a non-zero count). **Revert the mutation** and re-run to green before committing. If the tally does not move, the tests are not pinning the default — fix them, do not proceed.

- [ ] **Step 7: Commit**

```bash
git add src/app/toggle-button.tsx src/app/toggle-button.test.tsx
git commit -F- <<'MSG'
feat(ui): collapse the ToggleButton pressed marker when off

The marker was rendered in both states and merely `invisible`, so every toggle
reserved its width permanently. It now animates between zero and the glyph's
width, with a negative margin cancelling the button's own gap so an off marker
occupies no horizontal space.

This reverses a decision the primitive documented on purpose -- the constant
width kept a repeatedly-clicked control from moving its neighbours under the
pointer. The animation answers that in part, since the icon is leftmost and
growth displaces only rightward neighbours, but it is a reversal rather than a
gap, and `reserveMarkerSpace` is how a consumer keeps the old behaviour.

Three properties are deliberate. The element stays rendered in both states: it
carries data-pressed-marker, which existing tests query, and it is the WCAG
1.4.1 non-colour cue. `invisible` now appears only on the opt-out path, because
on the animated path a zero width already clips the glyph and `invisible` would
leave nothing to animate. And motion-reduce snaps instead of animating --
presence, not motion, is the cue, so nothing is lost.

jsdom has no layout, so these tests pin classes only; the motion itself is an
eye-verify item. The default is mutation-proved: defaulting the prop to true
turns the two default-behaviour tests red.
MSG
```

---

### Task 4: Opt the two at-risk consumers out

**Files:**
- Modify: `src/app/gantt-view-menu.tsx` (8 `<ToggleButton` call sites)
- Modify: `src/app/budget-panel-people-rows.tsx` (1 disclosure `<ToggleButton`)
- Test: `src/app/gantt-view-menu.test.tsx`, `src/app/budget-panel-people-rows.test.tsx`

**Interfaces:**
- Consumes: `reserveMarkerSpace` from Task 3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/gantt-view-menu.test.tsx`. The file already defines a `props` object and opens the popover by clicking the `ganttViewMenu` button:

```tsx
it("reserves the marker width on every view toggle so the menu never reflows", () => {
  render(<GanttViewMenu {...props} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "ganttViewMenu") }));
  const markers = Array.from(document.querySelectorAll("[data-pressed-marker]"));
  // Anti-vacuity: a loop over an empty list passes trivially, which is how an
  // "all of them" assertion silently covers nothing. `props` sets hasBaseline
  // and hasMilestones true, so all eight display toggles render.
  expect(markers.length).toBe(8);
  for (const m of markers) {
    expect(m.getAttribute("class")).toContain("w-3.5");
    expect(m.getAttribute("class")).not.toContain("w-0");
  }
});
```

Confirm the 8 before writing it — `grep -c "<ToggleButton" src/app/gantt-view-menu.tsx` — and if the menu has since gained or lost a toggle, use the measured number and say so in the commit. A hardcoded count is deliberate here: it is the only thing that catches a *new* toggle arriving without the prop.

Append to `src/app/budget-panel-people-rows.test.tsx`, inside its existing `describe("PeopleDisclosureLabel")`. The disclosure is a `<td>` child, so it needs a table ancestor — the same shape the sibling tests in that describe already use:

```tsx
it("reserves the marker width on the people disclosure", () => {
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <PeopleDisclosureLabel
              lang="en-US" label="Backend · Senior" bucketId={1} roleId={10} open={false} onToggle={() => {}}
            />
          </td>
        </tr>
      </tbody>
    </table>,
  );
  const marker = document.querySelector("[data-pressed-marker]");
  expect(marker).not.toBeNull();
  // The surrounding <td> is truncating and clamped to the LIVE role-column
  // width, with sticky-column arithmetic derived from that declared width.
  // An animating child is the one thing that arithmetic cannot absorb.
  expect(marker?.getAttribute("class")).toContain("w-3.5");
  expect(marker?.getAttribute("class")).not.toContain("w-0");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/gantt-view-menu.test.tsx src/app/budget-panel-people-rows.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |✕" /tmp/t4.log
```

Expected: FAIL — after Task 3 these markers collapse to `w-0` when off.

- [ ] **Step 3: Pass the prop at all nine call sites**

In `src/app/gantt-view-menu.tsx`, add `reserveMarkerSpace` to **each** of the 8 `<ToggleButton` elements (dependencies · holidays · absences · grid · critical path · baseline · show-milestones · inline milestone placement). Confirm the count first:

```bash
grep -c "<ToggleButton" src/app/gantt-view-menu.tsx    # expect 8
grep -c "reserveMarkerSpace" src/app/gantt-view-menu.tsx  # expect 8 after the edit
```

Add a single comment above the first one:

```tsx
      {/* ★ Every toggle in this popover reserves its marker width. The items
          are a dense vertical list and an animating width reflows the menu
          under the pointer mid-click. */}
```

In `src/app/budget-panel-people-rows.tsx`, add `reserveMarkerSpace` to the `variant="disclosure"` `ToggleButton`, with a comment naming the real reason:

```tsx
      // ★★ The <td> around this is `truncate` and clamped to the LIVE
      //    role-column width, and the sticky leading columns are placed by
      //    arithmetic over that declared width. An animating child changes the
      //    cell's content width mid-interaction, which that arithmetic cannot
      //    absorb -- and open-followups §123 already records an ellipsis defect
      //    in this exact cell.
      reserveMarkerSpace
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/gantt-view-menu.test.tsx src/app/budget-panel-people-rows.test.tsx > /tmp/t4b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t4b.log
```

Expected: PASS.

- [ ] **Step 5: Mutation-check each opt-out separately**

Remove `reserveMarkerSpace` from the budget call site, re-run **only** that file, confirm red, restore. Then remove it from **one** Gantt call site, re-run only that file, confirm red, restore. Two separate mutations, because a loop assertion that happens to be satisfied by the other seven would hide a single missing prop.

- [ ] **Step 6: Commit**

```bash
git add src/app/gantt-view-menu.tsx src/app/budget-panel-people-rows.tsx src/app/gantt-view-menu.test.tsx src/app/budget-panel-people-rows.test.tsx
git commit -F- <<'MSG'
fix(ui): reserve the marker width in the Gantt View menu and budget rows

Two consumers keep the constant-width marker. The Gantt View popover is a dense
vertical list of eight toggles, where an animating width reflows the menu under
the pointer mid-click. The budget people-rows disclosure sits in a truncating
<td> clamped to the live role-column width, and the sticky leading columns are
placed by arithmetic over that declared width -- an animating child changes the
cell's content width in a way that arithmetic cannot absorb, in a cell that
already carries a recorded ellipsis defect (open-followups 123).

Each opt-out is mutation-proved on its own. Removing the prop from one Gantt
call site reddens its file, and so does removing it from the budget row -- a
loop assertion satisfied by the other seven would otherwise hide a single
missing prop.
MSG
```

---

### Task 5: Land on the Dashboard at startup (renderer)

**Files:**
- Modify: `src/app/use-hash-view.ts`
- Test: `src/app/use-hash-view.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change. `useHashView(enabled?, features?)` keeps its shape; only its internal cold-load behaviour changes.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/use-hash-view.test.tsx`. That file drives the hook with `renderHook` and reads state off `useWorkspaceTab()` — there is no `setActiveTab` spy, so assert on `result.current`. It already defines `wrapper` and clears the hash in `afterEach`. Add `ALL_MODULE_IDS` to the imports from `./feature-modules`.

```tsx
it("treats a view-only hash as stale on a cold load and lands on the Dashboard", () => {
  window.location.hash = "#raid";
  const { result } = renderHook(
    () => { useHashView(); return useWorkspaceTab(); },
    { wrapper },
  );
  expect(result.current.activeTab).toBe("dashboard");
  expect(result.current.pendingOpen).toBeNull();
});

it("honours an item-bearing deep link on a cold load", () => {
  window.location.hash = "#raid/123";
  const { result } = renderHook(
    () => { useHashView(); return useWorkspaceTab(); },
    { wrapper },
  );
  expect(result.current.activeTab).toBe("raid");
  expect(result.current.pendingOpen).toEqual({ view: "raid", id: 123 });
});

it("keeps the hash authoritative after mount, so back/forward still work", () => {
  window.location.hash = "";
  const { result } = renderHook(
    () => { useHashView(); return useWorkspaceTab(); },
    { wrapper },
  );
  expect(result.current.activeTab).toBe("dashboard");
  // A LATER navigation is not a cold load: the hash wins, view-only or not.
  act(() => {
    window.location.hash = "#raid";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(result.current.activeTab).toBe("raid");
});

it("still lands on open-points when the dashboard module is disabled", () => {
  window.location.hash = "#raid";
  const features = ALL_MODULE_IDS.filter((m) => m !== "dashboard");
  const { result } = renderHook(
    () => { useHashView(true, features); return useWorkspaceTab(); },
    { wrapper },
  );
  expect(result.current.activeTab).toBe("open-points");
});

it("leaves an MSAL auth-response fragment untouched on a cold load", () => {
  window.location.hash = "#code=abc&state=xyz";
  const { result } = renderHook(
    () => { useHashView(); return useWorkspaceTab(); },
    { wrapper },
  );
  expect(result.current.activeTab).toBe("dashboard");
  expect(window.location.hash).toBe("#code=abc&state=xyz");
});
```

The last two duplicate guards the file already has in a different shape; keep them anyway — the first proves the cold branch respects the module gate, and the second proves the new `cold` term did not reorder the MSAL guard. Deriving the features list with `ALL_MODULE_IDS.filter(...)` avoids hardcoding module ids that could be renamed.

Dispatching `hashchange` by hand rather than relying on the assignment to emit it keeps the test deterministic — jsdom fires that event asynchronously.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/use-hash-view.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |✕" /tmp/t5.log
```

Expected: the first test fails (today a cold `#raid` navigates to RAID). The other four should already pass — they are the regression guards for behaviour that must **not** change.

- [ ] **Step 3: Add the cold-load argument**

In `src/app/use-hash-view.ts`, inside the mount `useLayoutEffect`:

```tsx
    const apply = (cold: boolean) => {
      const raw = currentHash();
      // Leave an MSAL auth-response fragment intact for handleRedirectPromise —
      // routing it away would strand the sign-in popup open (see isAuthResponseHash).
      if (isAuthResponseHash(raw)) return;
      const blank = raw === "" || raw === "#";
      const blankView: AppView = features && !isViewEnabled("dashboard", features) ? "open-points" : "dashboard";
      const parsed = blank ? { view: blankView, itemId: null } : parseHash(raw);
      // ★★ A COLD load treats a VIEW-ONLY hash as stale session residue: the
      //    view→hash effect below writes `#<view>` on every navigation, so the
      //    URL a browser restores (or a reload keeps) merely records where the
      //    last session ended. An ITEM-bearing hash is a real deep link and is
      //    honoured in full. Every LATER hashchange/popstate keeps the hash
      //    authoritative, so genuine back/forward navigation is untouched.
      //    KNOWN COST: a shared view-only link such as `#budget` now lands on
      //    the Dashboard. Item-bearing links — what people actually share to
      //    point at a thing — still work.
      const { view, itemId } =
        cold && !blank && parsed.itemId == null ? { view: blankView, itemId: null } : parsed;
      if (features && !isViewEnabled(view, features)) return; // disabled target: ignore the hash
      setActiveTab(view);
      if (itemId != null) requestOpen(view, itemId);
    };
    apply(true);
    const onEvent = () => apply(false);
    window.addEventListener("hashchange", onEvent);
    window.addEventListener("popstate", onEvent);
    return () => {
      window.removeEventListener("hashchange", onEvent);
      window.removeEventListener("popstate", onEvent);
    };
```

The listener must be the named `onEvent`, registered and removed as the same reference — passing `apply` directly would hand the event object in as `cold` and make every later navigation truthy-cold.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/use-hash-view.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t5b.log
```

Expected: PASS, all five.

- [ ] **Step 5: Mutation-check the cold gate**

Change `cold && !blank && parsed.itemId == null` to `!blank && parsed.itemId == null` (dropping the cold term) and re-run. Expected: the back/forward test turns red, proving it pins the distinction rather than passing incidentally. **Revert** and re-run to green.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-hash-view.ts src/app/use-hash-view.test.tsx
git commit -F- <<'MSG'
feat(shell): land on the Dashboard at startup, not on the last view

useHashView writes `#<view>` on every navigation, so the URL a browser restores
after a reload merely records where the last session ended. A cold load now
treats a view-only hash as that residue and lands on the Dashboard, while an
item-bearing hash is honoured in full as the deep link it is. Later
hashchange/popstate keep the hash authoritative, so back/forward are untouched,
and the MSAL auth-fragment guard still runs first.

No new write path was needed: the existing view-to-hash effect rewrites `#raid`
to `#dashboard` on its own.

Known cost, accepted deliberately: a shared view-only link such as `#budget`
now lands on the Dashboard. Discriminating on PerformanceNavigationTiming would
preserve those but make behaviour depend invisibly on how the page was reached,
which is worse to reason about and worse to support.

The cold gate is mutation-proved -- dropping the `cold` term reddens the
back/forward test.
MSG
```

---

### Task 6: Land on the Dashboard when the desktop app is relaunched

`second-instance` today only restores and focuses the existing window; the renderer never reloads, so the user is left on whatever view they had open. The fix sets the fragment on the already-loaded page — no reload (that would discard unsaved work), no preload and no IPC channel.

**Files:**
- Modify: `desktop/src/lib/menu-model.ts` (add the constant)
- Modify: `desktop/src/main.ts` (the `second-instance` handler — call site only)
- Test: `desktop/src/lib/menu-model.test.ts`

**Interfaces:**
- Consumes: the existing `helpHashScript(hash?: string)` — it is **already** parameterised, so no new function is needed.
- Produces: `DASHBOARD_VIEW_HASH` exported from `desktop/src/lib/menu-model.ts`.

- [ ] **Step 1: Write the failing test**

Append to `desktop/src/lib/menu-model.test.ts`:

```ts
it("builds a dashboard-navigation script from the shared hash helper", () => {
  const script = helpHashScript(DASHBOARD_VIEW_HASH);
  // Clearing first guarantees a hashchange even when the fragment already
  // matches; the app routes a blank fragment to its default view, so the clear
  // alone already lands on the Dashboard and the set is idempotent.
  expect(script).toContain('window.location.hash = "";');
  expect(script).toContain(JSON.stringify(DASHBOARD_VIEW_HASH));
});

it("points DASHBOARD_VIEW_HASH at the dashboard view", () => {
  expect(DASHBOARD_VIEW_HASH).toBe("#dashboard");
});
```

Add `DASHBOARD_VIEW_HASH` to the file's existing import from `./menu-model`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run desktop/src/lib/menu-model.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |✕" /tmp/t6.log
```

Expected: FAIL — `DASHBOARD_VIEW_HASH` does not exist.

- [ ] **Step 3: Add the constant**

In `desktop/src/lib/menu-model.ts`, directly beside `HELP_VIEW_HASH`:

```ts
// The view a relaunch should land on. `helpHashScript` already takes an
// arbitrary hash, so this needs no second script builder.
export const DASHBOARD_VIEW_HASH = "#dashboard";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run desktop/src/lib/menu-model.test.ts > /tmp/t6b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t6b.log
```

Expected: PASS.

- [ ] **Step 5: Wire the call site**

In `desktop/src/main.ts`, extend the `second-instance` handler:

```ts
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      // A relaunch should land on the Dashboard. Set the fragment on the page
      // that is already loaded rather than navigating: a reload would discard
      // unsaved work (same reasoning as the Help menu item).
      try {
        void win.webContents
          .executeJavaScript(helpHashScript(DASHBOARD_VIEW_HASH))
          .catch((e: unknown) => {
            log(`second-instance: ${String(e)}`);
          });
      } catch (e: unknown) {
        log(`second-instance: ${String(e)}`);
      }
    }
  });
```

Add `DASHBOARD_VIEW_HASH` to the existing `./lib/menu-model` import list at the top of the file.

Both a `try/catch` **and** a `.catch` are needed, mirroring the Help path: `executeJavaScript` can throw synchronously on a destroyed `webContents` and can also reject.

- [ ] **Step 6: Confirm nothing else typechecks this file**

`desktop/src/main.ts` is excluded from root `tsc` and is compiled only by the manual `desktop-package` job, so no local or CI typecheck will read this edit. Verify the exclusion still holds rather than assuming it:

```bash
grep -n "main.ts" tsconfig.json desktop/tsconfig*.json 2>/dev/null
```

Record what you find in the commit message. Do **not** try to make it typecheck as part of this task; that is a separate decision.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/lib/menu-model.ts desktop/src/lib/menu-model.test.ts desktop/src/main.ts
git commit -F- <<'MSG'
feat(desktop): relaunch lands on the Dashboard

second-instance only restored and focused the existing window, and the renderer
never reloads, so relaunching from a shortcut left the user on whatever view
they had open. It now sets the fragment on the already-loaded page.

No new helper: helpHashScript already takes an arbitrary hash, so this adds a
DASHBOARD_VIEW_HASH constant beside HELP_VIEW_HASH and nothing else. The helper
clears the fragment before setting it, which guarantees a hashchange even when
the fragment already matches -- and since the app routes a blank fragment to its
default view, the clear alone already lands on the Dashboard and the set is
idempotent.

Deliberately not a navigation: a reload would discard unsaved work, which is the
same reasoning the Help menu item carries. No preload and no IPC channel, so the
renderer stays remote content with no Node surface.

The constant and the script live in desktop/src/lib, which is typechecked and
unit-tested. main.ts holds only the call site, and it is excluded from root tsc
and compiled only by the manual desktop-package job -- so this call site is
verified by eye on a packaged build, not by any pipeline.
MSG
```

---

## After all six tasks

- [ ] **Report the eye-verify items as owed, not done.** Nothing in CI can reach them:
  1. The clipping gone at ~1420px with the sidebar expanded, in **both** the modern and classic top bar, swept from ~900px up.
  2. The marker animation — motion, timing, and that no toolbar jumps unpleasantly.
  3. The budget people-rows `<td>` still ellipsises correctly with the opt-out in place.
  4. The Gantt View menu visually unchanged.
  5. Desktop relaunch while running lands on the Dashboard without losing unsaved work (needs a packaged build).
- [ ] **Do not push, open an MR, or merge.** Report the branch and the commits and wait for explicit instruction.

## Self-review notes

- Spec §6.1, §6.2 and §6.3 each map to tasks: 6.3 → Tasks 1–2, 6.1 → Tasks 3–4, 6.2 → Tasks 5–6.
- Spec §7's eye-verify items 1–4 and 6 are carried above; item 5 (Projects indicator contrast) and item 7 (unknown state) belong to MR B and are deliberately absent.
- `reserveMarkerSpace` is spelled identically in Tasks 3, 4 and the file table.
- Task 1 can end in "stop and report" by design — a measurement that refutes the candidate must not be papered over by proceeding to Task 2.
- Every test snippet was rewritten against the **actual** harness in its target file rather than an assumed one, which caught two errors worth recording: `AskClaudeMenu`'s callback prop is `onAsk`, not `onAskClaude`, and `use-hash-view.test.tsx` has **no** `setActiveTab` spy — it drives the hook with `renderHook` and asserts on `result.current.activeTab` / `result.current.pendingOpen`. A plan written from the first guess would have handed the implementer code that cannot compile.
- No task adds an i18n key, so `i18n.de.ts` is never opened and the EN/DE parity check cannot be disturbed.
- Counts in this plan are measured: 8 `<ToggleButton>` call sites in `gantt-view-menu.tsx`, 1 in `budget-panel-people-rows.tsx`, 36 across `src/app` in total, leaving 27 that animate.
