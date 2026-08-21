# How cancelled work reads in the UI — design

Date: 2026-08-03
Status: approved (design), not yet planned

Three presentation defects deferred out of 0.213.0 "McKillip". That release made
Cancelled a genuinely closed state in the engines — a third reports bucket, out of
the completion denominator, out of overdue and workload. It deliberately did not
change how the results are *presented*, and left three places where the new
semantics read wrong.

All three were surfaced by reviewers, not by the implementation, and each was
recorded rather than fixed so the decision could be made deliberately.

## Scope

| # | Defect | Decision |
|---|---|---|
| 1 | Reports headline tiles no longer sum: `Total ≠ Open + Completed` | Keep `Total`, qualify it in place |
| 2 | An all-cancelled project reads "0% complete" | Distinguish it from an empty project |
| 3 | A cancelled task renders the same green ✓ as a delivered one | Differentiate by glyph shape |

Not a refactor. Three narrow presentation changes plus one additive prop on a
shared primitive.

## Facts established against the code before designing

- **`Tile` has no sub-label slot.** Its props are `label`, `value`, `rag`,
  `trend`, `bar`, `onActivate`, `activateLabel`, `hint`, `danger`, `size`,
  `flat` (`report-table.tsx:275-296`). Item 1 needs one.
- **The ✓ has exactly one site**, `task-row.tsx:409`. `task-kanban-card.tsx:83`
  renders a `RagDot` unconditionally — including for finished tasks — so the
  board never shows the check and is untouched here.
- **`computeDashboardProgress` already returns `inScope`** (`dashboard.ts:93`),
  added in 0.213.0 so a caller rendering a percentage beside a count cannot
  contradict itself. Item 2 consumes it; it does not introduce it.

---

## 1. Reports tiles — keep `Total`, qualify it

`Tile` gains one optional slot:

```ts
/** Small muted line under the value. Use for a qualifier the headline number
 *  needs to stay honest — not for a second metric. */
sub?: React.ReactNode;
```

Additive and defaulted, so every existing call site is unchanged.

`reports.tsx`'s Total tile passes it only when there is something to qualify:

```tsx
sub={stats.cancelled > 0 ? t(lang, "reportsCancelledCount", String(stats.cancelled)) : undefined}
```

One new i18n key, `reportsCancelledCount` = `"{0} cancelled"` / `"{0} abgebrochen"`.

`Total` keeps meaning **every task**. The tiles still do not literally sum — the
reader does the subtraction — but the missing quantity is named where the
discrepancy appears.

**Why not the alternatives.** A fifth Cancelled tile closes the arithmetic but
the row is `grid-cols-2 sm:grid-cols-4`, so five tiles reflow to 4+1, and a lone
tile on a second row reads as a layout bug. Relabelling `Total` → "In scope" (=8)
closes it exactly and costs no layout, but deletes the inventory count — "how big
is this project" is a question a PM actually asks, and no other tile answers it.

★ The conditional is load-bearing: a project with nothing cancelled renders
byte-identically to today. This change is invisible until it is relevant.

## 2. Completion tile — separate "abandoned" from "not started"

`inScope === 0` has two causes: a project with no tasks, and a project whose every
task was cancelled. Both render "0% complete" today, so the tile a portfolio
reader looks at first cannot tell them apart.

`dashboard-panel.tsx`'s completion tile switches state when
`total > 0 && inScope === 0`:

| condition | label | value |
|---|---|---|
| all cancelled | `dashboardNoActiveScope` — "No active scope" | `dashboardAllCancelled` — "{0} tasks, all cancelled" |
| otherwise | unchanged | unchanged |

Two new i18n keys. `total === 0` is deliberately excluded — an empty project keeps
today's 0%, because the dashboard already greets that screen with the coaching
card, and changing the most common first-run view to fix a case that is not broken
is the wrong trade.

**Scope boundary — REVERSED during implementation, and the reason is worth
keeping.** This section originally scoped the change to the dashboard Progress
tile alone, arguing that `dashboard-kpi-strip.tsx` "renders a bare percentage
with no denominator beside it, so it cannot contradict itself."

★★ That rationale was true and irrelevant. It reasons about the tile in
ISOLATION, and the defect is a comparison BETWEEN cards: once the Progress tile
read "No active scope" while the at-a-glance KPI card still read "Complete 0%",
one screen disagreed with itself — a state that did not exist before the fix.
The KPI card is also the more prominent slot. The state was extended to it.

★ Generalisation: when scoping a presentation fix OUT of a surface, ask whether
that surface renders the SAME metric, not whether it is internally coherent.

`snapshot.ts:211` (`pctComplete`) genuinely does stay out of scope — it is a
PERSISTED figure that Trends charts and version history diffs, so a null state
there is a data-shape decision with migration consequences.
`use-portfolio-health.ts:142` (`completionPercent`) is NOT in that category —
`portfolio-health-panel.tsx:164` renders it to a user — and it should have moved
with the KPI card. Left open as `docs/open-followups.md` §64.

## 3. Status glyph — differentiate by shape, not colour

`task-row.tsx:409` renders one glyph for closed, where closed means Done **or**
Cancelled. It splits in two:

- `isTaskDelivered(task)` → today's `✓` in `text-ui-green-strong`, unchanged.
- otherwise (closed but not delivered — cancelled) → `✕` in
  `text-muted-foreground`.

The `RagDot` fallback for open tasks and the `!task.healthOverride` guard are both
untouched.

★★ **Shape, not colour, and that is the whole point.** A muted ✓ is the smaller
change but differentiates the two states by colour alone — the exact WCAG 1.4.1
pattern `docs/open-followups.md` §55 already tracks fourteen instances of
(hand-rolled toggles showing their on-state by colour alone). Choosing it would
add a fifteenth instance of the thing already queued for removal. ★ §56 is a
NEIGHBOURING but different SC — 1.4.11 contrast, `ToggleButton`'s pressed state
at 1.03–1.22:1 in the dark schemes — and the register says so in caps. Do not
cite the two together as one problem.

★ It matters because the **`taskStatus`** column — the one that spells out the
word "Cancelled" — is hideable via column config. With it off, the glyph and the
strikethrough are the entire signal. ★ Note this is NOT the column the glyph
lives in: that is `status`, whose header reads "Health". Hide *that* and the
glyph does not render at all, so naming it here would make the argument
self-defeating.

★ The accessible name already distinguishes the two: `formatHealthTooltip` yields
"cancelled" where a delivered task yields "Completed on {date}". This adds the
**visual** channel that was missing rather than duplicating what AT already gets —
so the change must not touch `label`, `title` or `aria-label`.

---

## Testing

- **Reports:** the sub-label renders when `stats.cancelled > 0` and is **absent**
  when it is 0. The absence case is the one that pins "invisible until relevant".
- **Dashboard:** all-cancelled (`total > 0, inScope === 0`) shows the new state;
  an empty project (`total === 0`) still shows 0%. Both, or the exclusion is
  untested.
- **Task row:** a cancelled row renders `✕` and **not** `✓`; a delivered row still
  renders `✓`; both accessible names unchanged. The "not ✓" assertion is what
  fails on a revert — asserting only the presence of ✕ would pass if both glyphs
  rendered.
- **axe:** Reports, Dashboard and Open Points are all in `A11Y_VIEWS`. Re-run on a
  fresh isolated port; a cold server times out and reads as 20 phantom failures.

## Out of scope

- Any change to what `Total`, `pctComplete` or `completionPercent` mean in stored
  or aggregated data.
- The Kanban card's status indicator (a `RagDot` for every task, finished or not)
  — a separate question about a different surface.
- The completion-trend sparkline's historical points, which reconstruct totals
  from created/deleted activity events and have no cancel event kind, so earlier
  points still count tasks later cancelled. Pre-existing, documented, and a
  data-model change rather than a presentation one.
