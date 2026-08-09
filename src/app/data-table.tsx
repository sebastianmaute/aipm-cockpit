"use client";

// Shared <DataTable> shell (design-system Phase 3h). Every register/directory/
// report table hand-rolled the same `<table><thead className={TABLE_HEAD_CLASS}>
// …</thead><tbody>…</tbody></table>` trio. This owns that structure so the
// sanctioned sticky Dark-Blue head is applied by construction (a table can no
// longer drift to a bespoke header) — that is the invariant `table-head-sweep`
// enforces, now guaranteed by the component.
//
// Only the shell is shared: the table's own width/text classes vary per table
// (`min-w-full text-left text-sm`, `w-full text-xs`, …) so they stay a prop, and
// the cells stay the caller's (their padding is already uniform — `px-3 py-2`,
// dense tables `py-1`). Scroller ownership also stays with the caller
// (`INNER_TABLE_CLASS` / `PanelTableScaffold`), since it differs across panels.
//
// Caveat: this is a plain function component (not `forwardRef`), and `<tbody>`
// takes only `tbodyClassName` — a table needing a `<table ref>`, a tbody `ref`,
// or a tbody `aria-live` must stay a raw `<table>` (or grow those props here
// first). No current caller needs them.

import type { HTMLAttributes, ReactNode } from "react";
import { TABLE_HEAD_CLASS } from "./table-styles";

export interface DataTableProps extends HTMLAttributes<HTMLTableElement> {
  /** The `<thead>` contents (header row[s]). Wrapped in the sanctioned
   *  `TABLE_HEAD_CLASS` thead. */
  head: ReactNode;
  /** The `<tbody>` rows. */
  children: ReactNode;
  /** `<tbody>` classes, when a table needs them (rare). */
  tbodyClassName?: string;
  /** Renders `children` as the table's DIRECT body content: the caller supplies
   *  its own `<tbody>` groups instead of the single wrapper added here, and
   *  `tbodyClassName` no longer applies.
   *
   *  ★★ A table with per-row DISCLOSURE bodies needs this. The trigger's
   *  `aria-controls` target must be ONE element, which for a group of rows can
   *  only be a `<tbody>` — and a `<tbody>` nested inside a `<tbody>` is NOT
   *  reparented when React builds it through the DOM (only the HTML parser
   *  rewrites that shape, and these panels are `ssr: false`). Measured in
   *  Chromium via a DOM-built about:blank probe: the inner tbody becomes its own
   *  anonymous table, putting its second cell at x=29 where the row above has it
   *  at x=220. The column grid is simply gone — and jsdom, having no layout,
   *  reports nothing. */
  ownBodies?: boolean;
  /** `<table>` element classes. Default matches the most common register table
   *  (`min-w-full text-left text-sm`); dense/report tables pass their own. */
  className?: string;
}

export function DataTable({
  head,
  children,
  tbodyClassName,
  ownBodies = false,
  className = "min-w-full text-left text-sm",
  ...props
}: DataTableProps) {
  return (
    <table className={className} {...props}>
      <thead className={TABLE_HEAD_CLASS}>{head}</thead>
      {ownBodies ? children : <tbody className={tbodyClassName}>{children}</tbody>}
    </table>
  );
}
