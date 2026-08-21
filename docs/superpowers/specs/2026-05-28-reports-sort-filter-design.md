# Reports — Sortable + Filterable Tables — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.19.0-reports-sort-filter`
**Context:** Sub-project **S2** — second of the 5-item batch from the same conversation (S1 banner cleanup shipped at 0.18.1; S3 print and S4 PDF follow). Makes the three sortable Reports sub-tables (By Assignee, By Group, By Label) sortable + filterable, matching the steering-committee-grade interaction added to the RAID Report (0.18.0).

## Goal

Give the Reports popout user the ability to:
- **Sort** rows in the By Assignee, By Group, and By Label tables by any column, asc/desc/off cycle.
- **Filter** rows by typing in a small search input above each table — case-insensitive substring match on the name column.

Inquiries top-5 table stays as-is (already a fixed pre-ranked top-N list — no sort/filter needed).

## Non-goals

- No condition-based filters (e.g. "only overdue", "open > 0") — out of scope for v1; consider later if needed.
- No multi-column sort — single sort key per table.
- No persistence — sort/filter state is local to the Reports popout and resets on re-open. The steering-committee workflow tends to "look once, scan, close"; persistence would add clutter for marginal value.
- No change to the underlying `computeStats` data layer — it stays pure and produces unsorted/unfiltered rows; sort+filter happen in presentation.
- No change to the Inquiries top-5 table.

## Architecture

Single-file change in `src/app/reports.tsx`. Add three small in-file helpers; introduce per-table local state in `<ReportsPanel>`.

### Pattern

Mirrors the `raid-report-panel.tsx` FullDetail sortable table pattern (just shipped at 0.18.0):

- **Sort:** per-table local `useState<{ key, dir }>`. Clicking a column header cycles `asc → desc → off` (when key differs, snap to the new key and `asc`). Active column displays a ` ↑` or ` ↓` after the label. `useMemo` sorts a slice of the rows.
- **Filter:** per-table local `useState<string>` for the filter text. A small `<input type="search">` above the table with an "×" clear button when non-empty. `useMemo` chains: `rows → filtered → sorted`. Case-insensitive substring match against the name column only.
- **Empty after filter:** when `filtered.length === 0 && filter !== ""`, render the `<table>` headers as usual but replace the `<tbody>` with a single-row "No matches" message (using `reportsNoMatches` i18n key).

### New helpers in `reports.tsx`

```tsx
// Mirrors raid-report-panel's SortTh.
function SortTh<TKey extends string>({
  label,
  k,
  sortKey,
  dir,
  onClick,
  align,
}: {
  label: string;
  k: TKey;
  sortKey: TKey;
  dir: "asc" | "desc" | "off";
  onClick: (k: TKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k && dir !== "off";
  const indicator = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className={`relative px-3 py-2 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
      >
        {label}{indicator}
      </button>
    </th>
  );
}

// Tiny text-search input with × clear button.
function TableFilter({
  lang,
  value,
  onChange,
  placeholderKey,
}: {
  lang: Lang;
  value: string;
  onChange: (v: string) => void;
  placeholderKey: "reportsFilterAssignee" | "reportsFilterGroup" | "reportsFilterLabel";
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(lang, placeholderKey)}
        aria-label={t(lang, placeholderKey)}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t(lang, "clear")}
          title={t(lang, "clear")}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

The `clear` i18n key already exists in many places — verify with Grep; if missing, add to Task 6.

### Per-table sort keys

```tsx
type AssigneeSortKey = "assignee" | "total" | "open" | "overdue" | "onTime" | "late" | "inquiries";
type GroupOrLabelSortKey = "name" | "total" | "open" | "completed" | "overdue" | "inquiries";
```

These match the existing column-resize defaults (`REPORTS_ASSIGNEE_COL_WIDTHS`, `REPORTS_BY_X_COL_WIDTHS`) so the same key set powers sort + width.

### By Assignee — extract into `<AssigneeTable>` helper

The By Assignee `<table>` is currently inline in `<ReportsPanel>` (~L495–551). Extract into a small helper that mirrors the shape of `<GroupOrLabelTable>` (the existing helper used by By Group / By Label):

```tsx
function AssigneeTable({
  rows,
  lang,
  colWidths,
  onStartResize,
  sort,
  setSort,
  filter,
  setFilter,
}: {
  rows: Stats["byAssignee"];
  lang: Lang;
  colWidths: Record<ReportsAssigneeCol, number>;
  onStartResize: (col: string, e: React.MouseEvent) => void;
  sort: { key: AssigneeSortKey; dir: "asc" | "desc" | "off" };
  setSort: (s: { key: AssigneeSortKey; dir: "asc" | "desc" | "off" }) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  // 1) filtered = rows.filter(r => r.name.toLowerCase().includes(filter.trim().toLowerCase()))
  // 2) sorted = useMemo(...) — same compare pattern as raid-report-panel.tsx FullDetail
  // 3) clickHeader(k): if k !== sort.key → { key: k, dir: "asc" }; else cycle asc → desc → off → asc
  // 4) renders TableFilter + a div(overflow-x-auto)/table/thead with SortTh × 7 / tbody — or "no matches" row when filtered.length === 0
}
```

### By Group / By Label — extend `<GroupOrLabelTable>`

The existing `<GroupOrLabelTable>` (~L588) already takes `rows`, `lang`, `headerKey`, `emptyKey`, `colWidths`, `onStartResize`. Add four props:

```tsx
sort: { key: GroupOrLabelSortKey; dir: "asc" | "desc" | "off" };
setSort: (s: { key: GroupOrLabelSortKey; dir: "asc" | "desc" | "off" }) => void;
filter: string;
setFilter: (v: string) => void;
```

Same internal pipeline as `<AssigneeTable>`: filter then sort, render `<TableFilter>` above the table, swap to "no matches" row when appropriate.

### Wiring in `<ReportsPanel>`

```tsx
const [assigneeSort, setAssigneeSort] = useState<{ key: AssigneeSortKey; dir: "asc" | "desc" | "off" }>({ key: "total", dir: "desc" });
const [assigneeFilter, setAssigneeFilter] = useState("");
const [groupSort, setGroupSort] = useState<{ key: GroupOrLabelSortKey; dir: "asc" | "desc" | "off" }>({ key: "total", dir: "desc" });
const [groupFilter, setGroupFilter] = useState("");
const [labelSort, setLabelSort] = useState<{ key: GroupOrLabelSortKey; dir: "asc" | "desc" | "off" }>({ key: "total", dir: "desc" });
const [labelFilter, setLabelFilter] = useState("");
```

Default sort: by `total` desc — surfaces the largest-volume row first.

Pass each pair into its respective table helper.

### Sort comparator

```tsx
function compareStrOrNum(a: unknown, b: unknown): number {
  // numbers sort numerically; strings sort by localeCompare; mixed types fall back to string compare.
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}
```

Used by both `<AssigneeTable>` and `<GroupOrLabelTable>` sort effects. Tie-break by name asc.

### Edge cases

- **Empty `rows` (no data):** the existing `emptyKey` placeholder (`reportsNoAssignees`, `reportsNoGroups`, `reportsNoLabels`) still renders when the underlying `byAssignee` / `byGroup` / `byLabel` is empty. The filter input renders ONLY when `rows.length > 0` — no point in offering filter on an empty table.
- **Filter narrows everything out:** render the `<table>` (with its sortable header) + a single-row "No matches" tbody.
- **Sort key on a column with all-equal values:** the tie-break by name asc keeps order stable.
- **Sort + column resize don't conflict:** the resize handle's `cursor: col-resize` 4-px hit zone sits on the right edge; the sort button covers the rest of the cell. Both have been live together in raid-report Full Detail since 0.18.0.
- **Filter text contains regex specials:** match uses `.toLowerCase().includes(...)`, no regex — special characters are literal.
- **Dark mode:** uses existing surface tokens; no special-casing.

## i18n keys (EN + DE)

New keys (EN shown):
- `reportsFilterAssignee` — "Filter assignees…"
- `reportsFilterGroup` — "Filter groups…"
- `reportsFilterLabel` — "Filter labels…"
- `reportsNoMatches` — "No matches for current filter."
- `versionHighlightReportsSortFilter` — "Reports tables (By Assignee, By Group, By Label) are now sortable and filterable — click any header to sort, type in the search box to narrow rows."

DE counterparts in `i18n.de.ts`:
- `reportsFilterAssignee` — "Assignees filtern…"
- `reportsFilterGroup` — "Gruppen filtern…"
- `reportsFilterLabel` — "Labels filtern…"
- `reportsNoMatches` — "Keine Treffer für den aktuellen Filter."
- `versionHighlightReportsSortFilter` — "Reports-Tabellen (Nach Assignee, Nach Gruppe, Nach Label) sind sortier- und filterbar — Spaltenkopf zum Sortieren klicken, Filtertext eingeben, um Zeilen einzugrenzen."

`clear` should already exist — verify; if missing, add `"Clear"` / `"Leeren"`.

## Testing

`reports.tsx` does not currently have its own test file. Add a focused new test file `reports.test.tsx`:

1. **Sort cycle** — render with 3+ rows; click header → asc; click again → desc; click again → off (original order restored).
2. **Filter narrows rows** — type "alex" → only rows whose name contains "alex" (case-insensitive) appear.
3. **Clear filter restores all rows** — click "×" → filter empties, all rows back.
4. **Filter + sort combine** — filter to a subset, then sort that subset; assert correct order on the subset.
5. **No matches state** — type a string that matches nothing → "No matches" row appears.
6. **By Group + By Label independent state** — sorting By Group doesn't affect By Label's state.
7. **By Assignee independent of By Group** — same independence check across the inline `<AssigneeTable>`.

Mock the minimal `<ReportsPanel>` props (small fixture builder). Test only the new sort+filter behaviour — existing tile/StackedBar rendering already covered by the column-resize integration's tests.

Gates: `npx tsc --noEmit` 0; `npm run lint` 0; full suite green (existing 915 + ~7 new); coverage ≥ 70%.

## Release

Minor → **0.19.0 "Jemisin"** (codename retained — same batch). New highlight key `versionHighlightReportsSortFilter`.

- `src/app/version.ts`: `APP_VERSION = "0.19.0"`; `APP_BUILD_DATE = "2026-05-28"; // Jemisin milestone`; new top-of-file comment block; append `"versionHighlightReportsSortFilter"` as the LAST entry of `APP_HIGHLIGHT_KEYS`.
- `src/app/i18n.ts` + `i18n.de.ts`: 5 new EN keys + 5 DE counterparts (plus `clear` if missing).
- `CHANGELOG.md` `[0.19.0] — 2026-05-28 "Jemisin"` entry with `Added` (sort + filter for 3 tables).
- No DESIGN-TOKENS change.

## Plan shape (preview — `writing-plans` skill expands)

1. Add `SortTh<TKey>` + `TableFilter` helpers + the `compareStrOrNum` comparator to `reports.tsx` (no JSX integration yet).
2. Extract the inline By Assignee `<table>` into a typed `<AssigneeTable>` helper.
3. Wire sort + filter state for By Assignee in `<ReportsPanel>`; pass to `<AssigneeTable>`.
4. Extend `<GroupOrLabelTable>` props with sort + filter; render `<TableFilter>` + `<SortTh>` headers + "no matches" tbody.
5. Wire sort + filter state for By Group + By Label in `<ReportsPanel>`.
6. i18n EN + DE for all new keys (and `clear` if missing).
7. Tests in `reports.test.tsx` (7 tests covering sort cycle, filter, clear, combined, no-matches, independence × 2).
8. Release 0.19.0 (version.ts, CHANGELOG).

## What this closes

After 0.19.0 ships, S2 from the 5-item batch is done. **S3 (Print buttons)** and **S4 (PDF export)** remain, each with their own brainstorm cycle.
