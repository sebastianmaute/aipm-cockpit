# UI batch — five independent fixes (2026-08-04)

Five unrelated UI changes, no shared code except i18n additions. Each slice can ship
alone; there is no ordering dependency between them.

| # | Area | Change |
|---|---|---|
| 1 | Resource edit modal | height follows content instead of a fixed 620px |
| 2 | Resources → Calendar | "Include externals" checkbox → "Hide externals" `ToggleButton`, moved beside the Outlook block |
| 3 | Time bookings | customer filter box 3× wider; customer select cap raised |
| 4 | Budget | fixed (non-scrolling) Total column + a per-bucket total row |
| 5 | Start window | logo configurable in Settings → Appearance, defaulting to the harbor banner |

---

## 1. Resource edit modal — content-fit height

**Today:** `resource-edit-modal.tsx` passes
`heightClassName="h-[620px] min-h-[400px] max-h-[95vh]"` to `EditModalShell`. The panel is
a fixed 620px whatever the field-visibility settings leave visible, so short field sets
open with dead space under the form.

**Change:** `heightClassName="h-auto min-h-[280px] max-h-[95vh]"`.

The shell's panel is `flex flex-col overflow-hidden` and its `<form>` is
`flex min-h-0 flex-1 … overflow-y-auto`, so with `h-auto` the panel grows to its content
and only starts scrolling once `max-h-[95vh]` caps it. The `min-h-` floor stays: it is
part of the `useResizable` contract (a drag below it would collapse the panel) and the
guard test requires one.

**`sizeKey` must be bumped** — `aipm-cockpit:modal-size:resource-edit` →
`aipm-cockpit:modal-size:resource-edit-v2`. `useResizable` writes a persisted inline
`height`, which beats any class. Without the bump, every user who has ever dragged this
modal keeps their stored 620px and sees no change at all. (Same remedy as the
`useResizable` storage-key bump rule in AGENTS.md.)

**Guard test to relax:** `edit-modal-chrome.test.tsx` scans the four narrow consumers and
asserts each declares exactly one `heightClassName="h-[Npx]…"` with `N < 720`, a
`min-h-[Npx]` floor and a `max-h-[95vh]` cap. Widen the accepted form to
**`h-auto` OR `h-[N<720px]`**, keeping both the floor and cap assertions. The guard keeps
its actual purpose (no silent revert to the shell's 720px default) while permitting auto
height. Do not delete the test.

Only the resource modal changes. Absence / milestone / calendar-event keep their pinned
heights and stay covered by the same guard.

**Verification:** unit — the shell renders `h-auto` and no `h-[620px]`; the guard test
still fails when a consumer's `heightClassName` is removed entirely. Eye-verify the modal
at both a minimal and a full field-visibility set (jsdom has no layout, so no test can see
the real height).

---

## 2. Calendar — "Hide externals" toggle beside Add-to-Outlook

**Today:** `resources-panel-toolbar.tsx` `CalendarToolbar` renders a bare
`<label><input type="checkbox">` labelled `calendarIncludeExternals` ("Include externals"),
sitting before the `ml-auto` group that holds `headerActions` (the Outlook block +
trailing Print/reset group). Its state is the **persisted per-device**
`settings.calendarIncludeExternals` (read in `resources-panel.tsx` as
`settings.calendarIncludeExternals !== false`).

Planning already does this the right way: `PlanningToolbar` takes a `hideExternalToggle`
`ReactNode` built by the orchestrator and renders
`<div className="ml-auto flex items-center gap-2">{hideExternalToggle}{headerActions}</div>`.

**Change — mirror planning exactly:**

- `resources-panel.tsx` builds a second toggle node beside the existing
  `hideExternalToggle`:

  ```tsx
  const calendarHideExternalToggle = (
    <ToggleButton lang={lang}
      pressed={!includeExternals}
      onToggle={() => setSettings((s) => ({ ...s, calendarIncludeExternals: includeExternals }))}
      icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
    >
      {t(lang, "planningHideExternal")}
    </ToggleButton>
  );
  ```

  The write is `calendarIncludeExternals: includeExternals` — the *current* value, i.e.
  the negation of the next pressed state. The stored field keeps its existing inverted
  sense, so **no settings migration and no legacy-key read arm**.

- `CalendarToolbar` drops `includeExternals` / `onToggleIncludeExternals` from its props,
  gains `hideExternalToggle: ReactNode`, deletes the checkbox `<label>`, and closes with
  the same `ml-auto` flex group `PlanningToolbar` uses.

- `ResourceCalendar`'s own `includeExternals` prop and filtering are untouched — it keeps
  reading the same setting.

**Labelling:** reuse the existing `planningHideExternal` string ("Hide externals" /
"Externe ausblenden") — no new i18n key. The label is pinned to what pressing the button
*enables* (hiding), so "Hide externals, pressed" means externals are hidden, per the
toggle name/state coherence rule. `ToggleButton` supplies the non-colour pressed marker,
which a hand-rolled `aria-pressed` button would not.

The now-unused `calendarIncludeExternals` i18n key ("Include externals" /
"Externe einbeziehen") is deleted from both dictionaries (EN and DE together — key sets
must stay identical) unless another surface still uses it; grep before removing.

**Verification:** unit, mirroring `resources-panel.test.tsx`'s planning test — the calendar
toolbar's toggle is a `role="button"` (not a checkbox), and
`toggle.closest("div.ml-auto")` contains the Outlook control. Assert containment, **not**
DOM order: the checkbox already precedes that group today, so an order-only assertion
would pass against the unfixed code. Plus a test that pressing writes
`calendarIncludeExternals: false` and pressing again writes `true`.

Resources is axe-scanned, but only its default (directory) sub-tab — the calendar sub-tab
is not, so contrast/labels here are eye-verified.

---

## 3. Time bookings — customer scope width

`timelog-customer-scope.tsx`:

- Filter wrapper `className="w-28 print:hidden"` → `"w-[21rem] print:hidden"` (3 × 7rem).
  The `<Input>` inside stays `w-full`: the sizing must live on the positioning wrapper or
  the absolutely-positioned clear ✕ lands off-target.
- Customer `<Select>` `className="max-w-[14rem] print:hidden"` → `"max-w-[20rem] print:hidden"`
  so long customer names stop truncating.

No prop, state or a11y change. The toolbar row already wraps (`flex flex-wrap`), so the
wider controls reflow rather than overflow.

**Verification:** eye-verify at a narrow viewport; the existing timelog panel tests should
stay green untouched.

---

## 4. Budget — fixed Total column + total row

**Today:** `budget-panel.tsx` renders, per bucket, a `DataTable` inside
`<div className="mt-3 overflow-x-auto">`. Columns: a 28px RAG-dot `<th>`, a resizable
role/discipline `SortResizeTh` (`colWidths.role`), then one `<th>` per period
(`colWidths.period`). Each period cell is a `HoursTd` → `HoursCell`, a two-row control
(Plan input over Actual input + `RagBadge`). Both the role rows and the blended
(discipline) rows already compute `totBudget` (summed via `cellBudget`, so it honours the
"budget follows plan" mirroring) and `totActual` (`sumPeriods`) for their row RAG dot.

**Target layout:**

```
| ● | Role   | TOTAL  | 2026-01 | 2026-02 | ...
| ● | Dev    | P 120  |  P 40   |  P 40   |
|   |        | A  95  |  A 30   |  A 35   |
| ● | QA     | P  60  |  P 20   |  P 20   |
|   |        | A  50  |  A 25   |  A 25   |
| ● | Total  | P 180  |  P 60   |  P 60   |   <- new row
|   |        | A 145  |  A 55   |  A 60   |
  <---- fixed ----> <------ scrolls ------>
```

### 4a. Total column

- New leaf constant `TOTAL_COL_PX = 104` (matches the period column's content box: a
  `w-14` label + a `w-16` number). **Not** added to `BUDGET_COL_WIDTHS` — it is not
  resizable, so it mints no new persisted column key and needs no `ColumnResizeHandle`.
  (Never draw a grip that does nothing.)
- Cell content: a new read-only `TotalsCell` presentational component mirroring
  `HoursCell`'s markup — `flex flex-col gap-0.5`, two rows, each a `w-14` label span
  (reusing `budgetCellBudget` / `budgetCellActual`) plus a right-aligned
  `tabular-nums` number. No inputs, no `InfoTooltip`, no `RagBadge` (the row dot already
  carries health, and a second badge on the same numbers is a place for the two to
  disagree). Values are rounded for display the way `displayHours(v, true)` rounds
  mirrored hours, so float noise (`10.559999999999999`) does not leak into a total.
- Header `<th>` labelled with a new i18n key `budgetTotal` (EN "Total" / DE "Gesamt");
  grep for an existing suitable key first and reuse it if one exists.

### 4b. Sticky columns

The first three columns stop scrolling; the period columns keep scrolling inside the
existing `overflow-x-auto`.

- `position: sticky` + a `left` offset on the `<th>` and `<td>` of each of the three:
  - dot column — `left: 0`, width 28
  - role column — `left: 28`
  - total column — `left: 28 + colWidths.role`

  The role column is user-resizable, so both offsets are computed inline from the live
  `colWidths.role` each render. A hardcoded offset would drift the moment the column is
  dragged.
- **Opaque background is mandatory** on the sticky body cells (`bg-surface`): the rows
  carry no background of their own today, so without it the scrolled period cells show
  straight through the fixed ones. The sticky `<th>`s already paint their own Dark-Blue
  fill via the `.aipm-cockpit-thead` rule (the fill is on `<th>`, not `<thead>`), so they
  need no extra class.
- `print:static` on the sticky cells. The print stylesheet globally resets every
  `.print-root [class*="overflow-"]` descendant to `overflow: visible`, which leaves a
  `sticky` cell positioned against a scroll container that no longer scrolls.
- A `z-index` is **not** needed: nothing else in this table is positioned, and the sticky
  cells paint above the normal-flow ones by virtue of being positioned. Revisit only if
  eye-verify shows overlap.

### 4c. Total row

Appended after the data rows, inside the same `DataTable` children, for both the role and
the blended branch:

- dot cell: `RagBadge` over `ratioHealth(sum of all rows' totActual, sum of all rows' totBudget)`
- role cell: `t(lang, "budgetTotal")`
- Total cell: the grand `TotalsCell` (both sums)
- one `TotalsCell` per period: that period's column sums across the visible rows

Read-only throughout. It reuses the same `cellBudget` / `sumPeriods` accessors the row
totals use, so the row totals, the column totals and the grand total are all derived from
one source and cannot disagree.

**Verification:** unit — a two-row, two-period bucket renders the Total column with the
row sums, the total row with the column sums, and a grand total equal to both marginals;
the sticky cells carry a computed `style.left` that tracks a changed `colWidths.role`.
jsdom has no layout, so nothing here can test that the column actually stays put —
eye-verify horizontal scrolling in a bucket wide enough to overflow, in both light and
dark, and confirm the sticky-cell `bg-surface` matches the surface the bucket card
actually sits on (a seam here is the likely defect).

---

## 5. Start-window logo configurable

**Today:** `project-empty-state.tsx` renders, on the choices screen only,
`<img src={settings.branding?.logo || "/AIPM-logo.svg"} className={brandLogo ? "max-h-10 max-w-[200px] w-auto object-contain" : "h-7 w-auto"}>`.
So the start window shares the *sidebar's* branding logo and otherwise falls back to the
AIPM mark. `public/ai-pm-cockpit-banner-harbor.svg` exists but is referenced nowhere.

**Change — a dedicated field:**

- `BrandingConfig` gains `startLogo?: string`.
- `sanitizeBranding` gains a fourth arm identical to `logo` / `favicon`: accepted only
  when it matches `BRANDING_LOGO_RE` (raster `data:image` — **SVG stays rejected**, it is
  an XSS surface) and is within `BRANDING_LOGO_MAX_LEN`. `startLogo` also joins the
  final "did anything survive?" return check, or a settings blob carrying only a start
  logo would sanitize to `undefined`.
- `project-empty-state.tsx`:
  `src={settings.branding?.startLogo || "/ai-pm-cockpit-banner-harbor.svg"}`,
  `alt` = the branding slogan when set, else the app title. Sizing widened to
  `max-h-12 max-w-[280px] w-auto object-contain` for **both** branches — the default is
  now a wide banner, and the current `max-w-[200px]` would squeeze it to near-illegible.
  The old `/AIPM-logo.svg` fallback and its `h-7 w-auto` branch are gone from this surface.
  The sidebar's `/app-logo.svg` default is untouched.
- Settings → Appearance: a third `BrandingImageInput` row beside logo and favicon, wired
  through the same `setSettings` → `writeSettings` spread (branding already rides the
  spread; no allowlist edit). New EN/DE strings for its label and its choose/remove
  actions, following the existing `brandingFavicon*` key naming.

**Scheme interaction:** `mergeAppliedBranding` spreads `current` and then overwrites only
`logo`, `favicon`, `slogan`, `footerSlogan`. `startLogo` therefore **survives a scheme
apply** and schemes do not own it — deliberate, and it keeps this field out of the
portable scheme export format.

**Verification:** unit — `sanitizeBranding` keeps a raster `startLogo`, drops an SVG one,
and returns a defined object for a branding blob holding only `startLogo`; the empty state
renders the harbor banner when unset and the configured image when set; applying a branded
scheme leaves `startLogo` intact. Settings → General/Appearance is axe-scanned, so the new
input needs a real label (`BrandingImageInput` already provides one). Eye-verify the banner
at the new size on the start window.

---

## Cross-cutting notes

- New i18n keys go into **both** `i18n.ts` and `i18n.de.ts` (tsc enforces identical key
  sets); DE needs real umlauts, and the file is CRLF — patch it via a node utf8 write, not
  the Edit tool.
- No persisted `Workspace` field is added anywhere in this batch, so there is no
  six-write-path chore, no golden-fixture regeneration and no Turso migration.
  `branding.startLogo` and `calendarIncludeExternals` are per-device settings.
- Slices 1, 3 and 5 touch axe-scanned or eye-verified-only surfaces without adding
  interactive controls beyond the one new file input (slice 5). Slice 2 replaces a
  checkbox with a labelled `ToggleButton`. Slice 4 adds no interactive controls at all.
