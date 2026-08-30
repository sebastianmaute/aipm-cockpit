"use client";
/** The Budget bucket table's CELL layer: the editable period cells, the fixed
 *  Total column's cells, the pinned leading cells every row shares, the
 *  per-bucket total row, and the pure column/grand-total arithmetic behind it.
 *
 *  Split out of `budget-panel.tsx` to keep that orchestrator under the 800-line
 *  size ratchet (the gantt orchestrator + presentational-leaf convention). The
 *  file is named for the totals because that is what it was extracted FOR;
 *  `HoursCell`/`HoursTd` moved here afterwards, unchanged, so the orchestrator
 *  would fit — and they belong beside `TotalsTd`, whose layout mirrors theirs. */
import type { ReactNode } from "react";
import { t, type Lang } from "./i18n";
import { RagBadge } from "./rag-badge";
import { ratioHealth, cellHealth } from "./budget-health";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { useCommitDraft } from "./use-commit-draft";

/** The leading RAG-dot column, and the fixed Total column that follows the role
 *  label. Neither is in BUDGET_COL_WIDTHS: they are not resizable, so they mint
 *  no persisted column key and draw no grip (a handle that does nothing is the
 *  false affordance ColumnResizeHandle exists to avoid).
 *
 *  DOT_COL_PX is the width the dot header already declared before this column
 *  was named; the h-4 w-4 badge plus px-1 (16 + 8) fits inside it.
 *  TOTAL_COL_PX is the w-14 label (56) + gap-1 (4) + w-16 number (64) = 124 of
 *  content, plus the cell's own px-3 (24) since Tailwind's preflight makes every
 *  box border-box.
 *
 *  ★ DOT_COL_PX is a width the column ACTUALLY renders at, and TWO independent
 *  mechanisms had to be closed for that to be true: `table-layout: auto` lets
 *  CONTENT push a column past its declared width, and a `w-full` table pads
 *  every column with LEFTOVER space when they sum to less than the container.
 *  So this column's header label is `sr-only` (the visible word rendered it
 *  41.3px against a declared 28) and the table is sized `w-max`.
 *
 *  This matters because the role column pins at DOT_COL_PX and the Total column
 *  at DOT_COL_PX + the role width: an offset is only correct if every column to
 *  its LEFT renders exactly as wide as it declares. TOTAL_COL_PX is still only a
 *  hint — nothing is positioned against it, so nothing depends on it. */
export const DOT_COL_PX = 28;
export const TOTAL_COL_PX = 148;

/** Width of ONE figure line inside an hours cell, in Tailwind SPACING UNITS:
 *  the `w-14` label (14) + the `gap-1` between them (1) + the `w-16` value box
 *  (16). Measured from the cell's content-box left edge, so the value box's
 *  RIGHT edge lands here.
 *
 *  ★★ Exported because the person sub-rows (`budget-panel-people-rows.tsx`) are
 *  a SINGLE line under a TWO-line role cell and can only line up horizontally —
 *  they right-align a block of exactly this width so their figures share the
 *  role's value-box column instead of drifting to the far edge of a much wider
 *  period column, which is what they used to do.
 *
 *  ★★★ UNITS, NOT PIXELS, and that is the whole point. `w-14`/`w-16`/`gap-1`
 *  are rem-based, so a px block only tracks them at a 16px root font size — a
 *  user's larger default font or text-only zoom would scale the role line and
 *  leave the person block behind, reproducing the exact misalignment this
 *  exists to remove. Counting in the SAME unit as the classes holds at any root
 *  size. (`DOT_COL_PX`/`TOTAL_COL_PX` above are genuinely px and predate this;
 *  the sticky-column arithmetic they drive already assumes a 16px root.)
 *
 *  ★★ The value box carries its own `px-1`, so its DIGITS stop one unit short
 *  of its right edge. The figure block cancels that with a matching `pr-1`,
 *  putting both digit columns at 30 units. Aligning the boxes alone still left
 *  a visible 4px stagger — the boxes are not what a reader compares.
 *
 *  Two files, one number: change `w-14`/`w-16`/`gap-1` above and this must move
 *  with them (a test in `budget-panel-people-rows.test.tsx` pins the three
 *  classes against it — see the caveat in that test about which cell it covers). */
export const HOURS_LINE_UNITS = 31;
/** The same width as a rem literal, for the inline style. Tailwind's default
 *  `--spacing` is 0.25rem and `globals.css` does not override it. */
export const HOURS_LINE_REM = `${HOURS_LINE_UNITS * 0.25}rem`;

/** Mirrored plan hours are derived (utilization x capacity) and carry float
 *  noise such as 10.559999999999999, which the narrow input then truncates
 *  mid-number. Rounded for DISPLAY only — the stored and aggregated values are
 *  untouched. Editable cells are left alone: rounding a field while the user
 *  types fights the input. */
export function displayHours(v: number | undefined, readOnly: boolean | undefined): number | "" {
  if (v === undefined || !Number.isFinite(v)) return "";
  return readOnly ? Math.round(v * 100) / 100 : v;
}

function HoursCell({
  ariaPrefix, budget, actual, onBudget, onActual, lang, readOnly,
  periodEnd, today,
}: {
  ariaPrefix: string;
  budget: number | undefined;
  actual: number | undefined;
  onBudget: (v: number) => void;
  onActual: (v: number) => void;
  lang: Lang;
  // The cell badge is period-aware: a closed period with nothing booked is a
  // signal, not health. `today` is passed in (never read from the clock here)
  // so this stays a pure render.
  periodEnd: string;
  today: string;
  // When true, the budget input mirrors the live planned hours and is not
  // editable (the 'budget hours follow plan' toggle). The actual input is
  // always editable regardless.
  readOnly?: boolean;
}) {
  // Draft-then-commit: these cells write into workspace state, where each write
  // is captured for undo and logged. Committing per keystroke would make typing
  // "40" two undo entries and two activity rows. Both hooks are called
  // unconditionally — only the handler wiring below is conditional.
  const budgetDraft = useCommitDraft(String(displayHours(budget, readOnly)), (raw) => onBudget(Number(raw) || 0));
  const actualDraft = useCommitDraft(actual === undefined ? "" : String(actual), (raw) => onActual(Number(raw) || 0));
  // Both label spans share ONE width so the inputs beside them stay aligned —
  // change them together or the Budget and Actual rows drift apart. `w-14` is
  // inherited from when each label also carried an InfoTooltip that had to fit
  // beside the word; the tooltips moved to a panel-wide legend (open-followups
  // §246) and the width was deliberately left as-is.
  //
  // ★★ It is NOT free to narrow now that the icons are gone. `w-14` is the
  // first term of both TOTAL_COL_PX and HOURS_LINE_UNITS above, and
  // `budget-panel-people-rows.tsx` right-aligns its person figures against
  // HOURS_LINE_UNITS — so narrowing it moves every input in the table AND
  // strands every person figure, and jsdom has no layout to check either
  // against.
  //
  // ★ `gap-0.5` came out with the icons and its removal is provably inert:
  // column-gap needs two flex ITEMS and the span now holds a single text node
  // (measured in Chromium on the seeded Budget view — `childElementCount: 0`,
  // so no gap was ever drawn). `flex items-center` is NOT inert and stays: it
  // forms the line box the input is centred against. That leaves this span one
  // class richer than its read-only twin in `TotalsTd` below, which is plain
  // `w-14` — they render identically today (both fixed-width, single-line), and
  // the pair is worth keeping in step because HOURS_LINE_UNITS assumes it.
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="flex w-14 items-center text-[10px] text-muted-foreground">
          {t(lang, "budgetCellBudget")}
        </span>
        <input
          aria-label={`budget-${ariaPrefix}`}
          type="number"
          value={readOnly ? displayHours(budget, readOnly) : budgetDraft.value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : (e) => budgetDraft.onChange(e.target.value)}
          onFocus={readOnly ? undefined : budgetDraft.onFocus}
          onBlur={readOnly ? undefined : budgetDraft.onBlur}
          onKeyDown={readOnly ? undefined : budgetDraft.onKeyDown}
          className={`w-16 rounded border border-line ${readOnly ? "bg-surface-muted text-muted-foreground" : "bg-surface"} px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="flex w-14 items-center text-[10px] text-muted-foreground">
          {t(lang, "budgetCellActual")}
        </span>
        <input
          aria-label={`actual-${ariaPrefix}`}
          type="number"
          value={actualDraft.value}
          onChange={(e) => actualDraft.onChange(e.target.value)}
          onFocus={actualDraft.onFocus}
          onBlur={actualDraft.onBlur}
          onKeyDown={actualDraft.onKeyDown}
          className={`w-16 rounded border border-line bg-surface-muted px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
        />
        <RagBadge value={cellHealth(actual ?? 0, budget ?? 0, periodEnd, today)} lang={lang} />
      </div>
    </div>
  );
}

// A period `<td>` wrapping a HoursCell — shared by the role rows and the
// discipline (blended) rows, which differ only in ariaPrefix + the setter.
export function HoursTd({
  ariaPrefix, budget, actual, onBudget, onActual, lang, readOnly, periodEnd, today,
}: {
  ariaPrefix: string;
  budget: number | undefined;
  actual: number | undefined;
  onBudget: (v: number) => void;
  onActual: (v: number) => void;
  lang: Lang;
  readOnly?: boolean;
  periodEnd: string;
  today: string;
}) {
  return (
    <td className="px-3 py-2">
      <HoursCell
        ariaPrefix={ariaPrefix}
        budget={budget}
        actual={actual}
        onBudget={onBudget}
        onActual={onActual}
        lang={lang}
        readOnly={readOnly}
        periodEnd={periodEnd}
        today={today}
      />
    </td>
  );
}

/** A read-only totals `<td>`: the Total column's cells and every cell of a
 *  bucket's total row. Mirrors HoursCell's two-row layout (budget over actual)
 *  without the inputs, the tooltips or the RagBadge — the row/bucket dot already
 *  carries health, and a second badge over the same numbers is a place for the
 *  two to disagree. Values are rounded for DISPLAY the same way mirrored plan
 *  hours are, so float noise (10.559999999999999) cannot leak into a total. */
export function TotalsTd({
  budget, actual, lang, left, cellClass = "",
}: {
  budget: number;
  actual: number;
  lang: Lang;
  /** Sticky offset in px — passed for the fixed Total column, omitted for the
   *  total row's scrolling period cells. `0` would be a real offset, so this is
   *  checked against undefined. */
  left?: number;
  /** Extra classes for the cell itself. Used for the total row's top rule —
   *  see BucketTotalRow for why that border cannot live on the `<tr>`. */
  cellClass?: string;
}) {
  return (
    <td
      // `sticky` is a CLASS: an inline `position: sticky` outranks any author
      // rule, which would leave the `print:static` beside it with nothing to do.
      className={`px-3 py-2${left === undefined ? "" : " sticky bg-surface print:static"}${cellClass ? ` ${cellClass}` : ""}`}
      style={left === undefined ? undefined : { left, width: TOTAL_COL_PX, minWidth: TOTAL_COL_PX }}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className="w-14 text-[10px] text-muted-foreground">{t(lang, "budgetCellBudget")}</span>
          <span className="w-16 px-1 py-0.5 text-right tabular-nums">{displayHours(budget, true)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 text-[10px] text-muted-foreground">{t(lang, "budgetCellActual")}</span>
          <span className="w-16 px-1 py-0.5 text-right tabular-nums">{displayHours(actual, true)}</span>
        </div>
      </div>
    </td>
  );
}

/** The RAG dot every bucket-table row carries — the allocation rows and the
 *  bucket total row alike. ONE definition, so a row and the total beneath it
 *  cannot band the same budget/actual ratio differently. */
function RowDot({ budget, actual, lang }: { budget: number; actual: number; lang: Lang }) {
  // ★ `ratioHealth` takes (actual, budget) — the REVERSE of this component's prop
  // order. "Tidying" the call to match the props inverts every RAG badge in every
  // bucket table: an over-budget row would read Green.
  return <RagBadge value={ratioHealth(actual, budget)} lang={lang} title={t(lang, "budgetRoleStatus")} />;
}

/** The three PINNED leading cells of a bucket-table row: RAG dot, label, and the
 *  fixed Total. Shared by the detailed (role) and blended (discipline) branches,
 *  which differ only in the label they pass, and by the total row, which passes
 *  the "Total" label and the grand figures.
 *
 *  The pinned cells carry `bg-surface` because the rows have none of their own —
 *  without it the scrolled period cells show straight through — and
 *  `print:static` because the print stylesheet strips the scroll container these
 *  are positioned against. */
export function BucketRowLeadCells({
  label, budget, actual, lang, roleWidth, cellClass = "",
}: {
  label: ReactNode;
  budget: number;
  actual: number;
  lang: Lang;
  /** LIVE width of the role column — see BucketTotalRow. */
  roleWidth: number;
  /** Extra classes for each of the three cells — see BucketTotalRow. */
  cellClass?: string;
}) {
  const extra = cellClass ? ` ${cellClass}` : "";
  return (
    <>
      {/* `sticky` rides a CLASS on all three, never the inline style — an inline
          declaration outranks author rules in every media, so an inline
          `position: sticky` would make the `print:static` beside it inert. */}
      <td className={`sticky bg-surface px-1 py-1 print:static${extra}`} style={{ left: 0 }}>
        <RowDot budget={budget} actual={actual} lang={lang} />
      </td>
      {/* Clamped to the declared role width so the column cannot render wider
          than the arithmetic that places the Total column assumes — a long
          discipline name otherwise grows this cell past `DOT_COL_PX +
          roleWidth`, and the pinned Total then sits on top of the label. */}
      <td
        className={`sticky truncate bg-surface px-3 py-2 print:static${extra}`}
        style={{ left: DOT_COL_PX, width: roleWidth, maxWidth: roleWidth }}
      >
        {label}
      </td>
      <TotalsTd budget={budget} actual={actual} lang={lang} left={DOT_COL_PX + roleWidth} cellClass={cellClass} />
    </>
  );
}

/** Row shape both the role and discipline allocations satisfy. */
export interface TotalsRow {
  resourceIds: readonly number[];
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
}

/** Column + grand totals for one bucket. `budgetOf` is the caller's own
 *  `cellBudget`, so the column sums and the row sums come from the SAME
 *  accessor — which is what makes it impossible for them to disagree
 *  (`cellBudget` honours the budget-follows-plan mirroring). */
export function bucketColumnTotals<P extends { key: string }>(
  rows: readonly TotalsRow[],
  periods: readonly P[],
  budgetOf: (row: TotalsRow, period: P) => number,
) {
  const columns = periods.map((p) => ({
    key: p.key,
    budget: rows.reduce((s, r) => s + budgetOf(r, p), 0),
    actual: rows.reduce((s, r) => s + (r.actualHours[p.key] ?? 0), 0),
  }));
  return {
    columns,
    grandBudget: columns.reduce((s, c) => s + c.budget, 0),
    grandActual: columns.reduce((s, c) => s + c.actual, 0),
  };
}

export function BucketTotalRow({
  columns, grandBudget, grandActual, lang, roleWidth,
}: {
  columns: readonly { key: string; budget: number; actual: number }[];
  grandBudget: number;
  grandActual: number;
  lang: Lang;
  /** LIVE width of the role column — the Total column's sticky offset tracks it
   *  because that column is user-resizable, so a hardcoded offset drifts the
   *  moment it is dragged. */
  roleWidth: number;
}) {
  // The rule that separates the total from the allocation rows lives on the
  // CELLS, not the `<tr>`. globals.css puts every `.aipm-cockpit-thead` table in
  // `border-collapse: separate`, and in the separated-borders model a border set
  // on a row is IGNORED — verified in Chrome: a `border-top` on a `<tr>` paints
  // nothing and adds nothing to the row box, while the same border on a `<td>`
  // paints and grows the box by its width. A `border-t-2` on this `<tr>` would
  // be dead markup and the total would read as just another row.
  const RULE = "border-t-2 border-line";
  return (
    <tr className="font-medium">
      <BucketRowLeadCells
        label={t(lang, "budgetTotal")}
        budget={grandBudget}
        actual={grandActual}
        lang={lang}
        roleWidth={roleWidth}
        cellClass={RULE}
      />
      {columns.map((c) => (
        <TotalsTd key={c.key} budget={c.budget} actual={c.actual} lang={lang} cellClass={RULE} />
      ))}
    </tr>
  );
}
