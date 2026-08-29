"use client";

import type React from "react";
import { useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import {
  ColumnResizeHandle,
  PrintButton,
  ResetColWidthsButton,
  ResetSizeButton,
} from "./task-manager-ui";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { ClearableSearchInput } from "./clearable-search-input";
import { InfoTooltip } from "./info-tooltip";
import { Card } from "./card";
import { ProgressTrack } from "./progress-track";

export type SortDir = "asc" | "desc" | "off";

/** Compare two values for sort: numeric diff for numbers, localeCompare for strings. */
export function compareStrOrNum(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Cycle a sort direction on repeated header clicks: asc -> desc -> off -> asc. */
export function nextSortDir(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : dir === "desc" ? "off" : "asc";
}

/**
 * Shared filter + sort + sort-cycle logic for the report tables. The only thing
 * that differs between tables is how a row + sort key map to a comparable value,
 * which the caller supplies via a (memoized) `getValue`.
 */
export function useSortableFilter<Row extends { name: string }, Key extends string>(
  rows: readonly Row[],
  sort: { key: Key; dir: SortDir },
  setSort: (s: { key: Key; dir: SortDir }) => void,
  filter: string,
  getValue: (row: Row, key: Key) => string | number,
  /** Optional: rows whose value for this column is UNKNOWN rather than low.
   *  They are held out of the comparison and appended last in BOTH directions.
   *  A sentinel value cannot do this — the sort runs ascending and reverses for
   *  descending, so whatever sinks a row one way floats it the other, and an
   *  unknown row ends up leading whichever view it was not tuned for. Omit the
   *  callback and behaviour is exactly as before. */
  isUnknown?: (row: Row, key: Key) => boolean,
) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sort.dir === "off") return filtered;
    const known = isUnknown ? filtered.filter((r) => !isUnknown(r, sort.key)) : filtered;
    const unknown = isUnknown ? filtered.filter((r) => isUnknown(r, sort.key)) : [];
    const arr = known.slice().sort((a, b) => {
      const c = compareStrOrNum(getValue(a, sort.key), getValue(b, sort.key));
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    if (sort.dir === "desc") arr.reverse();
    if (unknown.length === 0) return arr;
    return [...arr, ...unknown.slice().sort((a, b) => a.name.localeCompare(b.name))];
  }, [filtered, sort, getValue, isUnknown]);

  const click = useCallback(
    (k: Key) => {
      if (k !== sort.key) {
        setSort({ key: k, dir: "asc" });
        return;
      }
      setSort({ key: sort.key, dir: nextSortDir(sort.dir) });
    },
    [sort.key, sort.dir, setSort],
  );

  return { sorted, click };
}

/**
 * Bundles the four `SortResizeTh` props that are identical for every column of
 * one table — the repetition that made these header blocks the top tsx clone
 * cluster (TD-6).
 *
 * ★ Returns a props OBJECT, never a bound component. A component built inside a
 *   hook gets a new identity every render, which remounts every header on every
 *   render; an object does not.
 *
 * ★★ That said, the memo is NOT a performance guarantee. It only HITS while
 *   `onSort`/`onResize` are themselves stable: true for `useSortableFilter`'s
 *   `useCallback`'d `click` (deps `[sort.key, sort.dir, setSort]`, so the bag
 *   changes only when the sort itself does), false for a bare arrow handler
 *   built fresh in the caller's body — the four `PanelSort` panels bust it
 *   every render. And even where it hits, nothing today reads the returned
 *   object's identity: `SortResizeTh` is a plain unmemoized component, so a
 *   stable bag prevents no re-render. It becomes load-bearing the moment a
 *   header is wrapped in `memo()` (this repo already does that for
 *   `ResourcesPanel`) — until then, don't cite it as a reason anything is fast.
 *
 * Usage: `const th = useSortHeaderProps<MyKey>(sort?.key ?? null, sort?.dir ?? "off", toggleSort, startResize)`
 * then `<SortResizeTh {...th} label={...} sortCol="id" width={w.id} />`.
 * ★ The explicit `<MyKey>` generic is required only when the key SOURCE is a
 *   bare `string` — same reason as `SortResizeTh`'s own `sortKey` caveat:
 *   `PanelSort.key` is a bare `string`, so passing it unnarrowed infers
 *   `K = string` and silently defeats the `sortCol` literal-union check this
 *   hook exists to carry through. The four `PanelSort` panels therefore pass
 *   it; the report panels do NOT and must not be "fixed" to — they hold sort
 *   as a local `SortState<K extends string>` over a real literal union (e.g.
 *   `SortState<SeveritySortKey>`), so `K` already infers correctly there.
 */
export function useSortHeaderProps<K extends string>(
  sortKey: K | null,
  sortDir: SortDir,
  onSort: (col: K) => void,
  onResize?: (col: string, e: React.MouseEvent) => void,
) {
  return useMemo(
    () => ({ sortKey, sortDir, onSort, onResize }),
    [sortKey, sortDir, onSort, onResize],
  );
}

export function TableFilter({
  lang,
  value,
  onChange,
  placeholderKey,
}: {
  lang: Lang;
  value: string;
  onChange: (v: string) => void;
  placeholderKey: "reportsFilterAssignee" | "reportsFilterGroup" | "reportsFilterLabel" | "raidReportFilterOwner" | "raidReportFilterDetail" | "budgetReportFilterBucket" | "planningFilterResource" | "budgetRoleFilter";
}) {
  return (
    <div className="mb-2 flex items-center gap-2 print:hidden">
      {/* The overlaid ✕ (and every reason it is overlaid rather than a sibling)
        * now lives in the shared ClearableSearchInput. The rendered DOM is
        * unchanged: the primitive emits the same `relative` wrapper and the same
        * button classes this file used to inline.
        *
        * ★ The label is QUALIFIED with the field's own placeholder because a
        * single view renders SEVERAL of these — Reports alone has more than one,
        * and it is axe-scanned. N controls all announcing "Clear" is a WCAG
        * 2.4.6 failure that the axe gate passes, since a name does exist. */}
      <ClearableSearchInput
        value={value}
        onClear={() => onChange("")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, placeholderKey)}`}
        className="min-w-0 flex-1"
      >
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(lang, placeholderKey)}
          aria-label={t(lang, placeholderKey)}
          // pr-8 ONLY while the ✕ is rendered — it reserves room for the
          // overlaid button, so applying it unconditionally would shave ~2rem
          // off the visible placeholder in the (common) empty state.
          className={`w-full rounded-md border border-line bg-surface py-1.5 pl-2.5 ${value ? "pr-8" : "pr-2.5"} text-xs text-foreground placeholder:text-muted-foreground focus:border-ui-dark-blue focus:outline-none [&::-webkit-search-cancel-button]:appearance-none`}
        />
      </ClearableSearchInput>
    </div>
  );
}

// Internal to SortResizeTh — the sort button + ↑↓ indicator (+ optional hint
// tooltip). Not exported: every panel now composes SortResizeTh, and SortableTh
// (task-manager-ui, the tasks table) deliberately keeps its own styled button.
function SortHeaderButton({
  label,
  nameContext,
  active,
  dir,
  onClick,
  hint,
  title,
}: {
  label: string;
  /** Disambiguating CONTEXT appended to the visible `label` to form the
   *  accessible name. See the prop of the same name on `SortResizeTh`. */
  nameContext?: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  /** Optional one-line explanation shown as an InfoTooltip beside the label. */
  hint?: string;
  /** Optional native tooltip on the button itself (e.g. "Sort by Due"). */
  title?: string;
}) {
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  const button = (
    <button
      type="button"
      onClick={onClick}
      // ★★ BUILT FROM `label`, never taken whole from the caller. That is what
      // makes WCAG 2.5.3 (label-in-name) containment STRUCTURAL here: the
      // visible text is always a substring of the accessible name, so no call
      // site can defeat it by passing a name that drops the label. A plain
      // "accessible name override" prop could only ask for that in prose.
      // ★ `undefined`, never `""` — an empty `aria-label` BLANKS the accessible
      // name rather than falling back to the button's content. Omitted unless a
      // caller passes a context, so every existing header renders
      // byte-identically and keeps taking its name from its visible text.
      aria-label={nameContext ? `${label} – ${nameContext}` : undefined}
      title={title}
      className={`inline-flex items-center gap-1 ${active ? "text-[var(--table-head-accent)]" : ""} hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}
    >
      {label}
      {/* aria-hidden because the <th>'s aria-sort now carries this state
          properly; leaving the glyph in the name would announce the same thing
          twice, in two vocabularies. It stays in the DOM (and so in
          textContent) — it is the only VISIBLE sort cue.
          ★ Rendered CONDITIONALLY: the button is `inline-flex … gap-1`, so an
          empty <span> is still a flex item and would add the gap to every
          INACTIVE header — ~4px of drift across seven tables that the opt-in
          visual baselines do not cover. */}
      {indicator && <span aria-hidden="true">{indicator}</span>}
    </button>
  );
  if (!hint) return button;
  // InfoTooltip is a SIBLING of the sort button (not nested), so opening the
  // tooltip never triggers the column sort.
  return (
    <span className="inline-flex items-center gap-1">
      {button}
      <InfoTooltip text={hint} />
    </span>
  );
}

/**
 * A sortable + resizable data-table header cell: the
 * `<th>` + `SortHeaderButton` + `ColumnResizeHandle` trio that every report
 * panel repeated per column (the top cross-file jscpd clones, TD-6).
 *
 * `sortCol` drives the sort button (active/click); `resizeCol` (defaults to
 * `sortCol`) drives the resize handle + is the width key — they diverge on the
 * name/label column where the sort key differs from the stored width key.
 *
 * The single sortable/resizable data-table header cell. Used by every report
 * panel AND the Open Points table (`tasks-section`). `Th` (task-manager-ui) is
 * the bare, non-sortable resizable sibling.
 *
 * `width` is optional: report tables pass an inline width; colgroup-sized tables
 * (Open Points) omit it. `title` renders a native "Sort by …" tooltip on the
 * button; `hint` renders an InfoTooltip beside the label — panels use one or the
 * other.
 *
 * `onResize` is optional: omit it for a table that sorts but does not persist
 * column widths (the calendar series list), and NO resize handle renders at all.
 * A no-op handler would be worse than no handler — it draws a grip that looks
 * draggable and does nothing, the false-affordance failure this component
 * otherwise exists to avoid.
 */
export function SortResizeTh<K extends string>({
  label,
  nameContext,
  sortCol,
  resizeCol,
  width,
  sortKey,
  sortDir,
  onSort,
  onResize,
  align = "left",
  hint,
  title,
  stickyLeft,
}: {
  label: string;
  /** Disambiguating CONTEXT for this header — a bucket's row token, a sibling
   *  table's heading. NOT a finished accessible name: the button builds its
   *  `aria-label` as `` `${label} – ${nameContext}` ``, so the visible label is
   *  CONTAINED in it by construction and WCAG 2.5.3 (label-in-name) cannot be
   *  defeated from a call site. Omitting it leaves the name as the visible text.
   *
   *  ★★ ONLY for a panel that renders the SAME table shape more than once —
   *  `budget-panel.tsx` renders one table per budget bucket, so its N "Role"
   *  headers would otherwise be N controls sharing one accessible name (WCAG
   *  2.4.6), and the axe gate cannot see it: of axe-core 4.12.1's rules, not one
   *  carrying a tag `e2e/a11y.spec.ts` requests flags two controls sharing a
   *  name, so a unit test is the only detector that can exist. A single-table
   *  panel must NOT pass this — its header is already unique and a context would
   *  only make the name longer.
   *
   *  ★ Pass the CONTEXT alone (`bucketToken`), never a pre-joined
   *  `rowLabel(label, token)` — that would repeat the label ("Role – Role – PAM").
   *  The separator is the same EN DASH `rowLabel` uses, so both surfaces read
   *  identically. */
  nameContext?: string;
  sortCol: K;
  /** Resize/width key; defaults to `sortCol`. */
  resizeCol?: string;
  /** Inline column width; omit for colgroup-sized tables. */
  width?: number;
  /** The table's active sort key, or `null` when the table is unsorted — also
   *  fixes `K` so `sortCol` must be valid.
   *
   *  ★ `null` is a real value here, not an oversight: several panels hold sort
   *  as `{ key, dir } | null` (`PanelSort`). It is only ever compared against
   *  `sortCol`, so a null key makes every column inactive and every
   *  `aria-sort` "none", which is exactly right for an unsorted table.
   *
   *  ★★ The `sortCol` guarantee holds only while `K` is inferred from a
   *  literal union. A caller passing a bare-`string` key (e.g. `PanelSort.key`)
   *  infers `K = string`, and every `sortCol` then typechecks — narrow ONCE at
   *  the binding site with an explicit generic rather than leaving each call
   *  site unchecked. */
  sortKey: K | null;
  sortDir: SortDir;
  onSort: (col: K) => void;
  /** Omit for a sortable but non-resizable column — no handle is rendered. */
  onResize?: (col: string, e: React.MouseEvent) => void;
  align?: "left" | "right";
  hint?: string;
  title?: string;
  /** Pins this column at the given px offset inside a horizontally scrolling
   *  table (`position: sticky`). Omit for an ordinary scrolling column. `0` is a
   *  REAL offset — the leading fixed column — so this is checked for `undefined`,
   *  never for truthiness.
   *
   *  ★ Passing this ALSO clamps the header to `width` (see below). The clamp is
   *  scoped to pinned columns because that is where a wider-than-declared render
   *  breaks something: anything pinned to the RIGHT of this column is placed by
   *  arithmetic over its DECLARED width, so a wider render puts that neighbour on
   *  top of this column's own content. An ordinary scrolling column has no such
   *  neighbour and stays free to grow to fit its label. */
  stickyLeft?: number;
}) {
  // "off" is a real SortDir (the asc→desc→off cycle), so naming this column in
  // `sortKey` is not enough to call it sorted — both halves gate `active`, and
  // aria-sort is derived from the SAME value the arrow is, so the announced
  // state and the drawn state cannot drift.
  const active = sortKey === sortCol && sortDir !== "off";
  return (
    <th
      // The sort state reaches assistive tech HERE. Before this it existed only
      // as a "↑"/"↓" inside the button's accessible name — a glyph read aloud,
      // not a state a screen reader can present as one. axe has no rule for a
      // missing aria-sort, so the gate never flagged it.
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`${
        align === "right"
          ? "relative px-3 py-2 text-right font-medium"
          : "relative px-3 py-2 font-medium"
      }${stickyLeft === undefined ? "" : " sticky overflow-hidden whitespace-nowrap print:static"}`}
      // `position: sticky` is a CLASS, not an inline declaration. Inline styles
      // beat author class rules whatever the media query, so an inline `sticky`
      // would make the `print:static` beside it inert — verified in Chromium
      // under emulated print media: inline sticky + class static computes
      // `sticky`, class sticky + class static computes `static`. The offsets
      // stay inline because they are per-instance values.
      style={{
        ...(width === undefined ? undefined : { width, minWidth: width }),
        // maxWidth turns the declared width into the RENDERED one: under
        // `table-layout: auto` a declared width is only a minimum, so a wider
        // label grows the column and every offset computed from that width is
        // then short by the difference. Clamping is only correct because the
        // column is pinned — an ordinary column may grow to fit its content.
        // (CSS 2.1 leaves max-width on a table cell undefined; Chromium honours
        // it, measured at declared widths of 40, 60 and 160.)
        ...(stickyLeft === undefined
          ? undefined
          : { left: stickyLeft, ...(width === undefined ? undefined : { maxWidth: width }) }),
      }}
    >
      <SortHeaderButton
        label={label}
        nameContext={nameContext}
        active={active}
        dir={sortDir}
        onClick={() => onSort(sortCol)}
        hint={hint}
        title={title}
      />
      {onResize && <ColumnResizeHandle col={resizeCol ?? sortCol} onMouseDown={onResize} />}
    </th>
  );
}

/**
 * Canonical metric tile — the SINGLE Tile shared across the dashboard, reports,
 * resources report, portfolio + timelog panels (design-system Phase 1c dedup of
 * three near-identical local copies). Divergence between the old copies is
 * preserved via props, not by forcing one look:
 *  - `size`   → value font size (`"xl"` default; the reports summary tiles use
 *    `"2xl"`).
 *  - `danger` → red value text for a "bad" metric (the reports overdue tile).
 *  - `flat`   → suppress the elevation shadow (the plain report/resource tiles
 *    are intentionally un-elevated; the dashboard tiles are raised).
 */
export function Tile({
  label, value, rag, trend, bar, sub, onActivate, activateLabel, hint,
  danger = false, size = "xl", flat = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  rag?: React.ReactNode;
  trend?: React.ReactNode;
  bar?: React.ReactNode;
  /** Small muted line under the value. For a qualifier the headline number needs
   *  to stay honest (e.g. "2 cancelled" under a Total that no longer equals
   *  open + completed) — NOT for a second metric, which wants its own tile. */
  sub?: React.ReactNode;
  onActivate?: () => void;
  activateLabel?: string;
  /** Optional explanation shown as an InfoTooltip in the tile's corner. Rendered
   *  as a SIBLING of the (possibly clickable) tile, never nested inside the
   *  button — a tooltip trigger inside a button is a nested-interactive axe fail. */
  hint?: string;
  /** Red value text for a "bad" metric (e.g. an overdue count). */
  danger?: boolean;
  /** Value font size. Default `"xl"`; reports summary tiles use `"2xl"`. */
  size?: "xl" | "2xl";
  /** Suppress the elevation shadow (plain report/resource tiles have none). */
  flat?: boolean;
}) {
  const valueColor = danger
    ? "text-[var(--rag-red-text)]"
    : "text-ui-dark-blue dark:text-ui-light-grey";
  const sizeClass = size === "2xl" ? "text-2xl" : "text-xl";
  const inner = (
    <>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={`mt-1 flex items-center justify-between gap-1.5 ${sizeClass} font-semibold ${valueColor} tabular-nums`}>
        <span>{value}</span>
        {rag}
      </div>
      {bar ? <div className="mt-1.5">{bar}</div> : null}
      {sub ? (
        <p data-tile-sub className="mt-1 text-xs text-muted-foreground">{sub}</p>
      ) : null}
      {trend ? <div className="mt-1">{trend}</div> : null}
    </>
  );
  const tile = onActivate ? (
    <button
      type="button"
      aria-label={activateLabel}
      onClick={onActivate}
      className={`w-full rounded-lg border border-line bg-surface p-3 text-left${flat ? "" : " shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]"} hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
    >
      {inner}
    </button>
  ) : (
    <Card boxed={!flat} className="p-3">{inner}</Card>
  );
  if (!hint) return tile;
  return (
    <div className="relative h-full w-full">
      {tile}
      <span className="absolute right-2 top-2 z-10 print:hidden">
        <InfoTooltip text={hint} />
      </span>
    </div>
  );
}

/** Slim "more=better" completion gauge. Fill width tracks `percent` (0–100);
 *  the fill background is the `--gradient-kpi` role token (solid brand green under
 *  AIPM, red→amber→green gradient under mockup). The gradient token can only be
 *  applied via inline style — raw gradient utilities are palette-guard-banned. */
export function KpiGradientBar({ percent, label }: { percent: number; label: string }) {
  // Guard NaN before clamping: Math.round(NaN) === NaN survives Math.min/max and
  // would emit width:"NaN%" (invalid → fill collapses to 0). The `number` contract
  // admits NaN/±Infinity; ±Infinity clamp fine, NaN must fall back to 0.
  const safe = Number.isFinite(percent) ? percent : 0;
  const pct = Math.max(0, Math.min(100, Math.round(safe)));
  return (
    <ProgressTrack height="h-1.5" role="img" aria-label={`${label}: ${pct}%`}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--gradient-kpi)" }} />
    </ProgressTrack>
  );
}

export function Section({
  title, children, boxed = false,
}: {
  title: string;
  children: React.ReactNode;
  boxed?: boolean;
}) {
  const body = (
    <>
      <h3 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{title}</h3>
      {children}
    </>
  );
  return boxed ? (
    <Card boxed padded>{body}</Card>
  ) : (
    <div>{body}</div>
  );
}

export function ReportCard({
  lang,
  sizeRef,
  onResetSize,
  onResetCols,
  toolbarExtra,
  leading,
  title,
  hideToolbar = false,
  contentRef,
  children,
}: {
  lang: Lang;
  sizeRef: React.RefObject<HTMLDivElement | null>;
  onResetSize: () => void;
  onResetCols?: () => void;
  toolbarExtra?: React.ReactNode;
  /** Controls pinned to the LEFT of the toolbar (e.g. add/remove report). */
  leading?: React.ReactNode;
  title?: string;
  /** Suppress the whole top toolbar row — the caller renders its own
   *  Print/Reset controls inside the body (e.g. the Dashboard). */
  hideToolbar?: boolean;
  /** The card's SCROLLING element — the one with real `scrollTop`, not the
   *  `sizeRef` shell, which is `overflow-hidden`. Exposed because a caller that
   *  drags things inside this card has to scroll THIS div during the drag
   *  (`useDragAutoscroll`); the window cannot scroll under the app shell. */
  contentRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const hasLeft = !!title || !!leading;
  return (
    <div ref={sizeRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {!hideToolbar && (
        <div className={`mb-2 flex shrink-0 items-center gap-2 ${hasLeft ? "justify-between" : "justify-end"}`}>
          {hasLeft && (
            <div className="flex items-center gap-2">
              {title && <h2 className="text-lg font-medium text-foreground">{title}</h2>}
              {leading && <div className="flex items-center gap-2 print:hidden">{leading}</div>}
            </div>
          )}
          <div className="flex items-center gap-2 print:hidden">
            {toolbarExtra}
            <PrintButton lang={lang} />
            {onResetCols && <ResetColWidthsButton onClick={onResetCols} lang={lang} />}
            <ResetSizeButton onClick={onResetSize} lang={lang} />
          </div>
        </div>
      )}
      <div ref={contentRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-2">{children}</div>
    </div>
  );
}
