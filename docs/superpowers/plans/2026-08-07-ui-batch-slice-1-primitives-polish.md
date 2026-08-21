# UI Batch Slice 1 — Primitives & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weekday labels to the Gantt day axis, convert the milestone "achieved" checkboxes to the shared toggle primitive, move the Insights and Budget-bucket action buttons onto the shared `Button` primitive, and land a repo-wide audit of hand-rolled UI elements and glyph→heroicon candidates.

**Architecture:** All changes are presentational. One new pure function (`fmtWeekdayShort`) in the existing i18n-free `gantt-engine.ts`; everything else swaps hand-rolled markup for existing shared primitives (`ToggleButton`, `Button`). No data model, no new state, no new persisted field. Two Gantt layout constants change together because one is derived from the other.

**Tech Stack:** Next.js 16 / React, TypeScript, Tailwind v4, vitest + @testing-library/react, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-08-07-ui-batch-undo-budget-people-dependencies-design.md` §Slice 1

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/gantt-engine.ts` | Pure Gantt date math + layout constants | Add `fmtWeekdayShort`; split the day header row's height into its own constant |
| `src/app/gantt-engine.test.ts` | Engine tests | Add `fmtWeekdayShort` cases |
| `src/app/gantt-chrome.tsx` | Presentational Gantt toolbar + axis header | Day cell becomes two lines |
| `src/app/milestones-panel.tsx` | Milestones table pane | Achieved checkbox → `ToggleButton` |
| `src/app/milestones-panel.test.tsx` | Panel tests | Assert toggle role + row-unique name |
| `src/app/milestone-edit-modal.tsx` | Milestone editor modal | Achieved checkbox → `ToggleButton` |
| `src/app/milestone-edit-modal.test.tsx` | Modal tests | Assert toggle role + state |
| `src/app/insights-panel.tsx` | Insights pane | 4 buttons `ghost` → `secondary` |
| `src/app/insight-recommendation-controls.tsx` | Insight row's recommendation controls | 3 buttons `ghost` → `secondary` |
| `src/app/insights-panel.test.tsx` | Insights tests | Assert the bordered variant |
| `src/app/budget-panel.tsx` | Budget pane orchestrator | 4 hand-rolled `<button>` → `Button`; fix the now-unused import |
| `src/app/budget-panel.test.tsx` | Budget tests | Assert the bordered variant |
| `docs/handrolled-ui-inventory.md` | New — repo-wide hand-rolled element + glyph audit | Create |
| `docs/open-followups.md` | Known-open register | Add one numbered entry |
| `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | Release metadata | Bump |

**No new i18n strings.** `milestoneAchieved` (`i18n.ts:2305` / `i18n.de.ts:2296`) already exists in both dictionaries; the weekday label comes from `Intl`, not the dictionary.

---

## Task 1: `fmtWeekdayShort` pure helper

**Files:**
- Modify: `src/app/gantt-engine.ts` (after `fmtDay`, currently line 337)
- Test: `src/app/gantt-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/gantt-engine.test.ts` (inside the top-level `describe`, or as a new one):

```ts
describe("fmtWeekdayShort", () => {
  // 2026-08-07 is a Friday in UTC.
  const friday = new Date(Date.UTC(2026, 7, 7));

  it("formats the short weekday in English", () => {
    expect(fmtWeekdayShort(friday, "en-US")).toBe("Fri");
  });

  it("treats en-GB as English, mirroring fmtMonth", () => {
    expect(fmtWeekdayShort(friday, "en-GB")).toBe("Fri");
  });

  it("formats the short weekday in German", () => {
    expect(fmtWeekdayShort(friday, "de")).toBe("Fr");
  });

  // ★ The guard that matters. Every date in this module is UTC-built and read
  //   with getUTCDay(); formatting in the host zone shifts the label by a day
  //   for any negative-offset zone. This assertion is only load-bearing when
  //   the run's TZ is not UTC — see the TZ verification step below.
  it("reads the date in UTC, not the host zone", () => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(2026, 7, 3 + i)); // Mon 3rd .. Sun 9th
      const expected = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1];
      expect(fmtWeekdayShort(d, "en-US")).toBe(expected);
    }
  });
});
```

Add `fmtWeekdayShort` to the existing `from "./gantt-engine"` import at the top of that test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/gantt-engine.test.ts -t "fmtWeekdayShort"`
Expected: FAIL — `fmtWeekdayShort is not a function` (or a tsc/import error naming it).

- [ ] **Step 3: Write minimal implementation**

In `src/app/gantt-engine.ts`, directly after `fmtDay`:

```ts
/** Short weekday label for a day column ("Mon" / "Mo").
 *
 *  ★ `timeZone: "UTC"` is load-bearing: every date in this module is UTC-built
 *  and read with `getUTCDay()`/`getUTCDate()`. Without the option the host zone
 *  is used, so UTC midnight formats as the PREVIOUS day for any negative-offset
 *  zone and the axis label disagrees with the bar placement.
 *
 *  Locale selection mirrors `fmtMonth`: en-GB collapses to en-US. */
export function fmtWeekdayShort(d: Date, lang: Lang): string {
  return d.toLocaleString(lang === "de" ? "de-DE" : "en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/gantt-engine.test.ts -t "fmtWeekdayShort"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the UTC guard is not vacuous**

Run: `TZ=America/New_York npx vitest run src/app/gantt-engine.test.ts -t "fmtWeekdayShort"`
Expected: PASS.

Now temporarily delete the `timeZone: "UTC"` line and re-run the same command.
Expected: FAIL on "reads the date in UTC, not the host zone".
Restore the line and re-run — PASS.

★ Do not skip this. In a UTC CI container the guard test passes with the option
removed, so the mutation is the only thing that proves it guards anything.

- [ ] **Step 6: Commit**

```bash
git add src/app/gantt-engine.ts src/app/gantt-engine.test.ts
git commit -m "feat: add fmtWeekdayShort for the Gantt day axis"
```

---

## Task 2: Two-line Gantt day cell

**Files:**
- Modify: `src/app/gantt-engine.ts:263-265` (layout constants)
- Modify: `src/app/gantt-chrome.tsx:16-32` (import), `:289` (day row height), `:293-311` (day cell)
- Test: `src/app/gantt-engine.test.ts`

Current constants:

```ts
export const ROW_HEIGHT_PX = 32;
export const HEADER_ROW_HEIGHT_PX = 22; // each of the two header rows
export const HEADER_HEIGHT_PX = HEADER_ROW_HEIGHT_PX * 2;
```

★ `HEADER_HEIGHT_PX` is **derived** from `HEADER_ROW_HEIGHT_PX * 2`. Growing only the
day row silently breaks that derivation — the two header rows are no longer the same
height, so the multiplication is wrong and every chart offset below the header shifts.

- [ ] **Step 1: Write the failing test**

Append to `src/app/gantt-engine.test.ts`:

```ts
describe("gantt header layout constants", () => {
  it("gives the day row more height than the month row, for the two-line label", () => {
    expect(DAY_ROW_HEIGHT_PX).toBeGreaterThan(HEADER_ROW_HEIGHT_PX);
  });

  // ★ HEADER_HEIGHT_PX used to be HEADER_ROW_HEIGHT_PX * 2. Once the rows differ
  //   that product is wrong; this pins the sum so a future height edit to either
  //   row cannot leave the total stale.
  it("totals the two header rows exactly", () => {
    expect(HEADER_HEIGHT_PX).toBe(HEADER_ROW_HEIGHT_PX + DAY_ROW_HEIGHT_PX);
  });
});
```

Add `DAY_ROW_HEIGHT_PX`, `HEADER_ROW_HEIGHT_PX` and `HEADER_HEIGHT_PX` to that file's
`from "./gantt-engine"` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/gantt-engine.test.ts -t "gantt header layout constants"`
Expected: FAIL — `DAY_ROW_HEIGHT_PX` is not exported.

- [ ] **Step 3: Change the constants**

Replace lines 264-265 of `src/app/gantt-engine.ts`:

```ts
export const HEADER_ROW_HEIGHT_PX = 22; // the month band
/** The day band. Taller than the month band because it stacks the day-of-month
 *  number over the short weekday. */
export const DAY_ROW_HEIGHT_PX = 30;
export const HEADER_HEIGHT_PX = HEADER_ROW_HEIGHT_PX + DAY_ROW_HEIGHT_PX;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/gantt-engine.test.ts -t "gantt header layout constants"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Render the weekday in the day cell**

In `src/app/gantt-chrome.tsx`, add `DAY_ROW_HEIGHT_PX` and `fmtWeekdayShort` to the
`from "./gantt-engine"` import block (lines 16-32, alphabetical order is already
loosely followed there).

Change the day row wrapper at line 288-290 from:

```tsx
        <div
          className="flex"
          style={{ height: HEADER_ROW_HEIGHT_PX }}
        >
```

to:

```tsx
        <div
          className="flex"
          style={{ height: DAY_ROW_HEIGHT_PX }}
        >
```

Then replace the day cell body (lines 293-311). The container gains `flex-col`, and
the single `{fmtDay(d)}` becomes two stacked spans:

```tsx
          {Array.from({ length: range.days }).map((_, i) => {
            const d = addDays(range.min, i);
            const isToday = d.getTime() === today.getTime();
            const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
            return (
              <div
                key={i}
                className={`flex flex-col items-center justify-center border-r text-[10px] leading-none ${
                  isToday
                    ? "border-ui-dark-blue bg-ui-dark-blue/10 font-semibold text-ui-dark-blue dark:text-foreground"
                    : isWeekend
                      ? "border-line bg-surface-muted/60 text-muted-foreground"
                      : "border-line text-muted-foreground"
                }`}
                style={{ width: DAY_WIDTH_PX }}
              >
                <span>{fmtDay(d)}</span>
                {/* ★ The today cell owns a deliberate accent colour; letting the
                    weekday line force `text-muted-foreground` there would undo it.
                    Inherit in that one case, mute otherwise. */}
                <span className={isToday ? "text-[9px]" : "text-[9px] text-muted-foreground"}>
                  {fmtWeekdayShort(d, lang)}
                </span>
              </div>
            );
          })}
```

★ The `<span>`s carry no vertical margin and the container is `leading-none`; the
30px row is what creates the spacing. Do not add `gap` — at 28px column width the
two lines already sit tight.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. ★ Never pipe these — a pipe reports the pipe's status,
not the command's.

- [ ] **Step 7: Verify the layout in a real browser**

jsdom has no layout, so no unit test can prove two lines fit a 28px column.

```bash
PORT=3100 npm run dev
```

Open `http://localhost:3100`, go to Gantt, and confirm: both lines legible, no
horizontal overflow inside a day column, weekday aligned with its date, today's
column still highlighted, and the first bar row still starts flush under the header.

```bash
PORT=3100 npm run stop
```

- [ ] **Step 8: Run the axe gate for Gantt**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt" > /tmp/axe-gantt.log 2>&1; echo "EXIT=$?"
grep -E "passed|failed" /tmp/axe-gantt.log
```

Expected: `EXIT=0`. This covers the new 9px text's contrast on the header surface.

- [ ] **Step 9: Re-baseline the visual-regression specs**

```bash
npm run e2e:visual:update > /tmp/visual.log 2>&1; echo "EXIT=$?"
git status --porcelain -- e2e
```

Expected: `EXIT=0` and changed snapshot files. Inspect the diffs before staging —
only the Gantt header band should have moved.

- [ ] **Step 10: Commit**

```bash
git add src/app/gantt-engine.ts src/app/gantt-engine.test.ts src/app/gantt-chrome.tsx e2e
git commit -m "feat: show short weekday under each Gantt day column"
```

---

## Task 3: Milestone achieved toggle — table row

**Files:**
- Modify: `src/app/milestones-panel.tsx:501-512`
- Test: `src/app/milestones-panel.test.tsx`

Current markup:

```tsx
                  {!hiddenSet.has("achieved") && (
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={!!m.achievedDate}
                          onChange={() => toggleAchieved(m)}
                        />
                        {t(lang, "milestonesMarkAchieved")}
                      </label>
                    </td>
                  )}
```

- [ ] **Step 1: Write the failing test**

This file already provides `renderMilestones({ milestones })` (line 62) and the fixture
builder `m(name, date, extra)` (line 43). Use both — do not add a second helper.

Append a new `describe` to `src/app/milestones-panel.test.tsx`:

```tsx
describe("achieved toggle", () => {
  it("renders a toggle button with a row-unique name", () => {
    renderMilestones({
      milestones: [
        m("Kickoff", "2026-01-15"),
        m("Go live", "2026-06-30", { achievedDate: "2026-06-28" }),
      ],
    });

    const kickoff = screen.getByRole("button", { name: `${t("en-US", "milestoneAchieved")} – Kickoff` });
    const golive = screen.getByRole("button", { name: `${t("en-US", "milestoneAchieved")} – Go live` });

    expect(kickoff).toHaveAttribute("aria-pressed", "false");
    expect(golive).toHaveAttribute("aria-pressed", "true");
    // ★ The old markup was a checkbox; assert that role is gone so a revert fails.
    expect(screen.queryByRole("checkbox", { name: /achieved/i })).toBeNull();
  });

  it("flips to pressed when clicked", () => {
    renderMilestones({ milestones: [m("Kickoff", "2026-01-15")] });
    const name = `${t("en-US", "milestoneAchieved")} – Kickoff`;
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  });
});
```

Ensure `fireEvent` and `t` are in that file's imports (`@testing-library/react` and
`./i18n`); add whichever is missing.

★★ Two milestones in the first test, not one. A single-row fixture cannot tell a
row-unique name from a generic one — that is precisely the WCAG 2.4.6 case the axe gate
also passes when the e2e seed renders one row.

★ The second test asserts the **rendered** state flips, not that a setter was called.
`renderMilestones` seeds through the workspace provider, so a spy on the setter would pin
the wiring rather than the behaviour.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/milestones-panel.test.tsx -t "achieved"`
Expected: FAIL — no button with that name; a checkbox is found instead.

- [ ] **Step 3: Replace the checkbox**

Add to the imports in `src/app/milestones-panel.tsx`:

```ts
import { ToggleButton } from "./toggle-button";
```

Replace the cell body:

```tsx
                  {!hiddenSet.has("achieved") && (
                    <td className="px-3 py-2">
                      {/* ★ Row-UNIQUE accessible name. N identical "Achieved"
                          labels is a WCAG 2.4.6 failure the axe gate passes
                          whenever the e2e seed renders a single milestone. */}
                      <ToggleButton
                        lang={lang}
                        pressed={!!m.achievedDate}
                        onToggle={() => toggleAchieved(m)}
                        ariaLabel={`${t(lang, "milestoneAchieved")} – ${m.name}`}
                      >
                        {t(lang, "milestoneAchieved")}
                      </ToggleButton>
                    </td>
                  )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/milestones-panel.test.tsx -t "achieved"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Check for a now-unused string**

```bash
grep -rn "milestonesMarkAchieved" src scripts e2e
```

If the only remaining hits are the two dictionary definitions, leave them — removing a
key means editing `i18n.de.ts`, which is CRLF and umlaut-hostile, for no gain. If any
other call site still uses it, leave it untouched. Record which case applied in the
commit body.

- [ ] **Step 6: Commit**

```bash
git add src/app/milestones-panel.tsx src/app/milestones-panel.test.tsx
git commit -m "feat: milestone achieved control becomes a toggle button"
```

---

## Task 4: Milestone achieved toggle — edit modal

**Files:**
- Modify: `src/app/milestone-edit-modal.tsx:230-249`
- Test: `src/app/milestone-edit-modal.test.tsx`

Current markup:

```tsx
          {isVisible("achievedDate") && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!draft.achievedDate}
              onChange={(e) =>
                update(
                  "achievedDate",
                  e.target.checked
                    ? new Date().toISOString().slice(0, 10)
                    : undefined,
                )
              }
              className={`${FOCUS_RING} ${TRANSITION}`}
            />
            <span className="font-medium text-foreground">
              {t(lang, "milestoneAchieved")}
            </span>
          </label>
          )}
```

- [ ] **Step 1: Write the failing test**

This file already provides `renderWith(milestone)` (line 177), taking
`{ id, name, date, description? }`. Widen that helper's parameter type to accept
`achievedDate?: string` — it is a local test helper, so this is a one-word change — then
append:

```tsx
describe("achieved toggle", () => {
  const NAME = t("en-US", "milestoneAchieved");

  it("renders achieved as a toggle button reflecting the draft", () => {
    renderWith({ id: 1, name: "Go live", date: "2026-06-30" });
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "false");
    // ★ Scoped by the achieved label on purpose — the linked-tasks list below is
    //   also checkboxes, and an unscoped checkbox query would grab one of those
    //   and pass no matter what this field renders.
    expect(screen.queryByRole("checkbox", { name: NAME })).toBeNull();
  });

  it("clears the date when an achieved milestone is unpressed", () => {
    renderWith({ id: 1, name: "Go live", date: "2026-06-30", achievedDate: "2026-06-28" });
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: NAME }));
    expect(screen.getByRole("button", { name: NAME })).toHaveAttribute("aria-pressed", "false");
  });
});
```

Ensure `fireEvent` and `t` are imported in that file; add whichever is missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/milestone-edit-modal.test.tsx -t "achieved"`
Expected: FAIL — no button with that name.

- [ ] **Step 3: Replace the checkbox**

Add the import:

```ts
import { ToggleButton } from "./toggle-button";
```

Replace the field:

```tsx
          {isVisible("achievedDate") && (
          <ToggleButton
            lang={lang}
            pressed={!!draft.achievedDate}
            onToggle={() =>
              update(
                "achievedDate",
                draft.achievedDate ? undefined : new Date().toISOString().slice(0, 10),
              )
            }
            className="w-fit"
          >
            {t(lang, "milestoneAchieved")}
          </ToggleButton>
          )}
```

★ The date is stamped inside the handler, not in the render body — `new Date()` in a
component render body is a fatal `react-hooks` purity error under this repo's lint.

★ `linkedTasks` below keeps its checkboxes. A multi-select list of tasks is not a
binary toggle and `aria-pressed` would be wrong there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/milestone-edit-modal.test.tsx -t "achieved"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Fix any now-unused imports**

```bash
npx eslint --max-warnings=0 src/app/milestone-edit-modal.tsx; echo "EXIT=$?"
```

`FOCUS_RING` / `TRANSITION` are still used by the linked-task checkboxes further down,
so the import should stay. If eslint reports either as unused, remove only the unused
name from the `from "./interaction-styles"` import. Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/milestone-edit-modal.tsx src/app/milestone-edit-modal.test.tsx
git commit -m "feat: milestone modal achieved field becomes a toggle button"
```

---

## Task 5: Insights buttons → bordered variant

**Files:**
- Modify: `src/app/insights-panel.tsx:226,238,248,258`
- Modify: `src/app/insight-recommendation-controls.tsx:42,77,85`
- Test: `src/app/insights-panel.test.tsx`

Both files already import `Button`. Every occurrence is `variant="ghost" size="xs"`;
the change is `ghost` → `secondary` on all seven, nothing else.

★ Not `ToggleButton`, even though the target look is the Open Points "Hide finished"
chip. These are one-shot actions with no on/off state, and `ToggleButton` announces
`aria-pressed` — wrong for an action (WCAG 4.1.2). `Button variant="secondary"` is the
bordered-chip look with correct semantics: `border border-line bg-surface text-foreground
hover:bg-surface-muted` plus the shared `INTERACTIVE` focus/motion atom.

★ `insight-recommendation-controls.tsx` renders into the same row as the four
`insights-panel.tsx` buttons. Converting only one file leaves a row with two button
looks side by side.

- [ ] **Step 1: Write the failing test**

This file already provides the fixture builder `makeInsight(over)` (line 10) and renders
directly: `render(<InsightsPanel insights={FIXTURE} lang="en-US" today={TODAY} />)`.

★ The Dismiss button only renders when the panel is given write actions (`canWrite`).
Read lines 40-90 of the test file to see how the existing tests supply `actions` before
writing this one — pass the same shape.

Append:

```tsx
it("renders row actions as bordered secondary buttons, not ghost", () => {
  render(
    <InsightsPanel
      insights={[makeInsight({ status: "open" })]}
      lang="en-US"
      today={TODAY}
      actions={{ onAcknowledge: vi.fn(), onAct: vi.fn(), onDismiss: vi.fn() }}
    />,
  );
  const dismiss = screen.getByRole("button", { name: /dismiss/i });
  expect(dismiss.className).toContain("border-line");
  expect(dismiss.className).toContain("bg-surface");
  // Ghost's defining trait — assert its absence so a revert fails.
  expect(dismiss.className).not.toContain("bg-transparent");
});
```

★ If `InsightsPanel`'s `actions` prop needs more members than the three above, tsc will
say so — add exactly what it names and nothing more.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/insights-panel.test.tsx -t "bordered secondary"`
Expected: FAIL — className contains `bg-transparent`, not `border-line`.

- [ ] **Step 3: Convert all seven buttons**

```bash
node -e "const fs=require('fs');for(const f of ['src/app/insights-panel.tsx','src/app/insight-recommendation-controls.tsx']){const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f,s.split('variant=\"ghost\"').join('variant=\"secondary\"'),'utf8');}"
git diff --stat src/app/insights-panel.tsx src/app/insight-recommendation-controls.tsx
```

Expected: 7 changed lines across the two files. Read the diff and confirm every hit was
a `Button` variant prop and nothing else matched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/insights-panel.test.tsx -t "bordered secondary"`
Expected: PASS.

- [ ] **Step 5: Run the whole Insights suite**

```bash
npx vitest run src/app/insights-panel.test.tsx src/app/insight-recommendation-controls.test.tsx > /tmp/insights.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/insights.log
```

Expected: `EXIT=0`. Existing tests that asserted ghost classes will fail here — update
them to the new variant rather than reverting the change.

- [ ] **Step 6: Commit**

```bash
git add src/app/insights-panel.tsx src/app/insight-recommendation-controls.tsx src/app/insights-panel.test.tsx
git commit -m "refactor: insights row actions use the shared bordered button variant"
```

---

## Task 6: Budget bucket buttons → shared `Button`

**Files:**
- Modify: `src/app/budget-panel.tsx:31` (import), `:376-384` (FX refresh), `:663-686` (three bucket actions)
- Test: `src/app/budget-panel.test.tsx`

★ `INTERACTIVE` is used at exactly four places in this file — lines 380, 666, 675, 683 —
and all four are the buttons being converted. After the conversion the name is **unused**,
and this repo's CI runs `eslint --max-warnings=0` with no `argsIgnorePattern`, so an
unused import is a **fatal** build failure. It must be dropped from line 31 in the same
commit. `FOCUS_RING` and `TRANSITION` stay — line 111 still uses both.

- [ ] **Step 1: Write the failing test**

This file already provides a spread-able `props` object (line 17) with a default
`buckets` fixture, and renders with `render(<BudgetPanel {...props} />)`.

Append:

```tsx
test("bucket actions render as bordered secondary buttons", () => {
  render(<BudgetPanel {...props} />);
  for (const key of ["budgetEditBucket", "budgetClose", "budgetRemoveBucket"] as const) {
    const btn = screen.getByRole("button", { name: t("en-US", key) });
    expect(btn.className).toContain("border-line");
    expect(btn.className).toContain("bg-surface");
    // The hand-rolled look was a transparent border that only appeared on hover.
    expect(btn.className).not.toContain("border-transparent");
  }
});
```

★ The default `props.buckets` has `status: "open"`, so the middle button reads
`budgetClose`, not `budgetReopen`. If the default fixture ever flips, this test fails
loudly rather than silently matching the wrong control.

★ Ensure `t` is imported from `./i18n` in that file; add it if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-panel.test.tsx -t "bordered secondary"`
Expected: FAIL — className contains `border-transparent`.

- [ ] **Step 3: Add the `Button` import and drop `INTERACTIVE`**

Line 31 becomes:

```ts
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
```

Add beside the other component imports:

```ts
import { Button } from "./button";
```

- [ ] **Step 4: Convert the FX refresh button**

Replace lines 376-384:

```tsx
          <Button
            variant="secondary"
            size="xs"
            onClick={props.onRefreshFx}
            disabled={props.fxLoading}
            className="inline-flex items-center gap-1.5"
          >
            <ArrowPathIcon aria-hidden="true" className={`h-4 w-4 ${props.fxLoading ? "animate-spin" : ""}`} />
            {t(lang, "budgetFxRefresh")}
          </Button>
```

★ `Button` already supplies `disabled:cursor-not-allowed disabled:opacity-50` in its
base class — do not re-declare them. `inline-flex items-center gap-1.5` is layout only
and is appended after the variant classes, which is what `className` is for here.

- [ ] **Step 5: Convert the three bucket actions**

Replace lines 662-686 (the `<div className="mt-2 flex items-center gap-4">` block's
three children):

```tsx
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setEditingBucketId(bucket.id)}
                >
                  {t(lang, "budgetEditBucket")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => updateBucket(bucket.id, bucket.status === "open"
                    ? { status: "closed", closedDate: props.today }
                    : { status: "open", closedDate: undefined })}
                >
                  {t(lang, bucket.status === "open" ? "budgetClose" : "budgetReopen")}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => removeBucket(bucket.id)}
                  title={t(lang, "budgetRemoveBucket")}
                >
                  {t(lang, "budgetRemoveBucket")}
                </Button>
```

★ The bucket **drag handle** at line ~450 stays a hand-rolled `<button>`. It carries
`draggable`, `onDragStart`/`onDragEnd` and arrow-key reordering — a drag affordance, not
a `Button`.

- [ ] **Step 6: Run test and lint**

```bash
npx vitest run src/app/budget-panel.test.tsx > /tmp/budget.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/budget.log
npx eslint --max-warnings=0 src/app/budget-panel.tsx; echo "EXIT=$?"
```

Expected: both `EXIT=0`. A non-zero eslint here almost certainly means `INTERACTIVE` is
still imported.

- [ ] **Step 7: Check the file-size ratchet**

`budget-panel.tsx` was 718 lines and the ratchet trips at 800, counting `wc -l` **+1**.

```bash
wc -l src/app/budget-panel.tsx
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 8: Run the axe gate for Budget**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget" > /tmp/axe-budget.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 9: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -m "refactor: budget bucket actions use the shared button primitive"
```

---

## Task 7: Repo-wide hand-rolled element and glyph inventory

**Files:**
- Create: `docs/handrolled-ui-inventory.md`
- Modify: `docs/open-followups.md`

Scope is the whole of `src/app`, in two parts:

1. **Hand-rolled elements** — markup that reimplements a shared primitive. Not just
   `<button>`: also `<input>` / `<select>` / `<textarea>` outside `form-controls`,
   hand-rolled modals, popovers, badges, cards, empty states, tooltips and tables.
2. **Glyph → heroicon candidates** — literal Unicode glyphs used as icons where a
   heroicon exists.

★ This is an **audit deliverable only**. Nothing outside the panes already converted in
Tasks 5 and 6 gets changed in this slice. Producing the list and acting on it are separate
jobs, and conflating them is how a bounded UI batch becomes an unreviewable sweep.

### The primitive set to measure against

`button.tsx` · `icon-button.tsx` · `toggle-button.tsx` · `form-controls.tsx`
(`Input`, `Select`, `Textarea`, `Checkbox`, `FieldGroup`) · `modal.tsx` ·
`modal-header.tsx` · `edit-modal-chrome.tsx` · `popover-panel.tsx` ·
`combobox-shared.tsx` · `badge.tsx` · `banner.tsx` · `card.tsx` · `dot.tsx` ·
`drag-handle.tsx` · `empty-state.tsx` · `add-first-item-button.tsx` ·
`info-tooltip.tsx` · `data-table.tsx` · `report-table.tsx` · `pane-toolbar.tsx` ·
`clearable-search-input.tsx` · `filter-multiselect.tsx`

- [ ] **Step 1: Generate the element site lists**

```bash
mkdir -p /tmp/inv
grep -rn "<button"   src/app --include=*.tsx --exclude="*.test.tsx" > /tmp/inv/button.txt
grep -rn "<input"    src/app --include=*.tsx --exclude="*.test.tsx" > /tmp/inv/input.txt
grep -rn "<select"   src/app --include=*.tsx --exclude="*.test.tsx" > /tmp/inv/select.txt
grep -rn "<textarea" src/app --include=*.tsx --exclude="*.test.tsx" > /tmp/inv/textarea.txt
grep -rn "<table"    src/app --include=*.tsx --exclude="*.test.tsx" > /tmp/inv/table.txt
grep -rn 'role="dialog"\|role="tooltip"\|role="listbox"' src/app --include=*.tsx --exclude="*.test.tsx" > /tmp/inv/roles.txt
wc -l /tmp/inv/*.txt
```

Baseline measured 2026-08-07: **345** `<button>` across **152** files. **Record what your
run prints, not this number** — if it differs, the tree has moved.

★ `form-controls.tsx` itself is the legitimate home of the raw `<input>`/`<select>`/
`<textarea>`, and `data-table.tsx` / `report-table.tsx` of the raw `<table>`. Exclude
those files from the "hand-rolled" tally rather than listing them as offenders.

- [ ] **Step 2: Generate the glyph site list**

```bash
for g in "✓" "✔" "⚠" "✕" "×" "⋮" "▸" "▾" "▼" "▲" "↑" "↓" "•" "🗒" "★"; do
  printf '%s\t' "$g"
  grep -rhn -- "$g" src/app --include=*.tsx --exclude="*.test.tsx" 2>/dev/null \
    | grep -vE ":\s*(//|\*|/\*)" | wc -l
done
grep -rn -- "✓\|⚠\|✕\|×\|⋮\|▸\|▾\|▼\|▲\|↑\|↓\|•\|🗒" src/app --include=*.tsx --exclude="*.test.tsx" \
  | grep -vE ":\s*(//|\*|/\*)" > /tmp/inv/glyphs.txt
wc -l /tmp/inv/glyphs.txt
```

Baseline measured 2026-08-07, comment lines excluded: `✕` 47 · `×` 75 · `•` 21 · `✓` 17 ·
`▲` 17 · `▼` 17 · `↑` 12 · `⚠` 9 · `⋮` 9 · `↓` 9 · `▸` 4 · `▾` 3 · `🗒` 2.

★ The comment filter is a heuristic, not a parser — it drops lines whose **first**
non-space token is `//`, `*` or `/*`, so a trailing comment on a code line still counts.
Triage each hit by reading it; do not treat the count as the answer.

★★ Many `×` hits are **multiplication in prose or code** ("3× the sample", `w × h`), not a
close glyph. Splitting those out is the main manual work in this step.

- [ ] **Step 3: Write the inventory document**

Create `docs/handrolled-ui-inventory.md`:

```markdown
# Hand-rolled UI inventory

Snapshot taken <DATE>, on <SHORT-SHA>. Audit only — nothing here is scheduled.

**Counts (reproduce, do not trust):**

```bash
grep -rho "<button" src/app --include=*.tsx --exclude="*.test.tsx" | wc -l
grep -rl "<button" src/app --include=*.tsx | grep -v "\.test\.tsx" | wc -l
```

## Part 1 — hand-rolled elements

| Tag | Meaning |
|---|---|
| **convertible** | Reimplements a primitive; should adopt it (name the primitive and variant) |
| **IconButton candidate** | Icon-only action; should become `IconButton` |
| **correctly hand-rolled** | Not modelled by any primitive — drag handle, sortable header, chip, popover trigger, primitive's own internals |
| **converted** | Already migrated; names the release |

| File | Line | Element | Current look | Tag | Primitive | Reason |
|---|---|---|---|---|---|---|

## Part 2 — glyph → heroicon candidates

| Tag | Meaning |
|---|---|
| **replace** | Decorative icon with a heroicon equivalent; swap and add `aria-hidden` |
| **keep — semantic text** | Part of the accessible name or of `textContent` an existing test reads |
| **keep — not an icon** | Multiplication sign, bullet in prose, ★ doc marker |

| File | Line | Glyph | Context | Tag | Proposed heroicon | Reason |
|---|---|---|---|---|---|---|
```

★★ Before tagging any glyph **replace**, grep the matching `*.test.tsx` for it. This
repo's sortable headers deliberately keep `↑`/`↓` inside `textContent` and existing
assertions read it — swapping those for an SVG breaks tests **and** removes a cue that
was doing real work. `report-table.test.tsx` and `calendar-series-list.test.tsx` are the
known cases; check for others rather than assuming those are the only two.

★ A glyph inside an accessible name is not decorative. If it is the only thing
distinguishing two controls' names, replacing it with an `aria-hidden` SVG creates a
WCAG 2.4.6 duplicate.

★ Heroicons default `aria-hidden` on every icon (its own attributes come first, `props`
spread after), so a swapped-in icon is out of the a11y tree by default — which is right
for decoration and wrong if the glyph carried meaning.

★ Every row needs a reason, including *keep* rows. An unexplained "leave it" reads as
"not looked at yet" and gets re-litigated.

★ Panes converted in Tasks 5 and 6 are tagged **converted** with this release's version,
not left as *convertible*.

- [ ] **Step 4: Sanity-check the tags against a sample**

Pick 5 rows at random — at least one from each tag — and open the file at that line.
Confirm the tag and the reason match what the code actually does.

★ This is the step that catches a tag applied from the grep line alone. A grep line shows
an element, never its role in the surrounding component.

- [ ] **Step 5: Add the open-followups entry**

```bash
grep -nE "^#### §[0-9]+" docs/open-followups.md | tail -3
```

Take the next free number and append an entry in the file's existing format pointing at
`docs/handrolled-ui-inventory.md`, stating: the in-scope panes were converted in this
release, the remainder is a ratchet, and the inventory is the work-list for both parts.

★ Numbering collides across parallel branches. Whoever merges second renumbers; git flags
the conflict.

- [ ] **Step 6: Verify the docs gate**

```bash
npm run docs:symbols:check > /tmp/symbols.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. ★ The gate only proves a backticked mixed-case name exists somewhere
in the tree — never that a claim about it is true — and it skips every `SCREAMING_CASE`
name outright. A green run validates nothing in this document.

- [ ] **Step 7: Commit**

```bash
git add docs/handrolled-ui-inventory.md docs/open-followups.md
git commit -m "docs: inventory hand-rolled UI elements and glyph-to-heroicon candidates"
```

---

## Task 8: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` (5 files)

Current: `APP_VERSION = "0.220.0"`, `APP_MILESTONE = "Kuttner"`. This slice is a feature
release → **0.221.0**, new codename.

- [ ] **Step 1: Run the full local gate chain, serially**

★ Serially. Two vitest processes on one runner is the machine-saturation condition behind
this repo's load-sensitive flakes.

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests |Errors" /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM=$?"
```

Expected: every variable `=0`. ★ Also grep the suite log for `Errors  N error` — CI's
unit job can exit 1 with every test passing (setState after jsdom teardown), and `FAIL`
does not appear in that case.

- [ ] **Step 2: Choose the codename and bump `src/app/version.ts`**

Pick an unused sci-fi/fantasy author surname (the milestone-codename-unique convention).
Update three lines:

```ts
export const APP_VERSION = "0.221.0";
export const APP_BUILD_DATE = "<TODAY>"; // 0.221.0: Gantt weekday axis, milestone toggle, shared button primitives (<Codename>)
export const APP_MILESTONE = "<Codename>";
```

Also update the comment two lines above `APP_MILESTONE` naming the 0.221.x line.

`APP_HIGHLIGHT_KEYS` needs **no** new entry — this slice adds no new capability the
Version popover does not already list. Do not add a key just to have one.

- [ ] **Step 3: Add the CHANGELOG entry**

Prepend a `## 0.221.0 "<Codename>" — <TODAY>` section to `CHANGELOG.md` covering: the
Gantt weekday axis, the two milestone toggles, the Insights and Budget button
conversions, and the hand-rolled UI / glyph inventory plus its follow-up entry.

- [ ] **Step 4: Bump the five ungated version sites**

No gate checks any of these; they drift silently.

```bash
grep -n '"version"' package.json
grep -n '"version": "0\.' package-lock.json | head -5
grep -n "shields\|badge" README.md | head -5
grep -n "Generated:" docs/CODEMAPS/*.md
```

Update: `package.json` `version`; **both** `package-lock.json` occurrences (the root
`version` and the `packages[""]` one); the README shields badge — version **and**
codename; and the `<!-- Generated: … | App <version> "<codename>" … -->` header on all
five `docs/CODEMAPS/*.md`.

- [ ] **Step 5: Verify no version site was missed**

```bash
grep -rn "0\.220\.0\|Kuttner" package.json package-lock.json README.md docs/CODEMAPS src/app/version.ts
```

Expected: no output. Any hit is a site left behind.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -m 'release: 0.221.0 "<Codename>"'
```

- [ ] **Step 7: Hand back**

Do **not** push, open an MR, or merge. Report the branch, the commit list, and every
gate's exit code. Pushing happens only on an explicit instruction; "release" in this repo
means push → MR → poll → merge **only** once the pipeline is green.

---

## Deferred to later slices

Written as separate plans against the post-merge tree, because both touch files this
slice changes:

- **Slice 2** — AI-assistant sub-rail, Views as a plain list, "This project" → "Overrides",
  app-wide tooltip audit.
- **Slice 3** — undo/redo multi-step dropdown, cancellable AI triggers, budget bucket
  people rows, dependency search + successor toggle.
