"use client";
import { DOT_COL_PX, TOTAL_COL_PX } from "./budget-panel-totals";
import type { PersonRow } from "./budget-bucket-people";
import type { Period } from "./resource-capacity";

const DASH = "—";

/**
 * The per-person booking rows behind one bucket role line.
 *
 * ★ A `<tbody hidden>`, never conditionally-rendered `<tr>`s: the disclosure's
 *   aria-controls target must stay in the DOM while collapsed, and a tbody
 *   keeps these cells in the same column grid as the role row above.
 *
 * ★★ Booked is NOT tinted. Small tinted text on these surfaces is this repo's
 *    documented AA trap; the booked/planned distinction rides position and the
 *    `/` separator, so nothing here is colour-alone (WCAG 1.4.1).
 *
 * ★★ The three leading cells MIRROR `BucketRowLeadCells` — same sticky offsets,
 *    same `bg-surface` (the rows have none of their own, so the scrolled period
 *    cells would otherwise show straight through) and the same clamp on the role
 *    column. Those columns are pinned by ARITHMETIC over the role column's LIVE
 *    width, so `roleWidth` is threaded in rather than assumed: a leading cell
 *    that does not pin slides out from under its own header on horizontal
 *    scroll. `sticky` rides the CLASS on all three — an inline `position` would
 *    outrank the `print:static` beside it in every medium.
 *
 * Read-only by design — no cell border, so these can never be mistaken for the
 * editable budget cells above.
 */
export function BucketPeopleRows({
  id,
  rows,
  periods,
  collapsed,
  roleWidth,
}: {
  id: string;
  rows: readonly PersonRow[];
  periods: readonly Period[];
  collapsed: boolean;
  /** LIVE width of the role column — see BucketRowLeadCells. */
  roleWidth: number;
}) {
  return (
    <tbody id={id} hidden={collapsed}>
      {rows.map((r) => (
        <tr key={r.resourceId} className="text-xs">
          <td className="sticky bg-surface px-1 py-1 print:static" style={{ left: 0 }} />
          <td
            className="sticky truncate bg-surface py-1 pl-6 pr-3 text-muted-foreground print:static"
            style={{ left: DOT_COL_PX, width: roleWidth, maxWidth: roleWidth }}
          >
            {r.name}
          </td>
          <td
            className="sticky bg-surface px-3 py-1 text-right tabular-nums print:static"
            style={{ left: DOT_COL_PX + roleWidth, width: TOTAL_COL_PX, minWidth: TOTAL_COL_PX }}
          >
            <span className="text-foreground">{r.bookedTotal ?? DASH}</span>
            <span className="text-muted-foreground"> / {r.plannedTotal ?? DASH}</span>
          </td>
          {periods.map((p) => (
            <td key={p.key} className="px-3 py-1 text-right tabular-nums">
              <span className="text-foreground">{r.booked[p.key] ?? DASH}</span>
              <span className="text-muted-foreground"> / {r.planned[p.key] ?? DASH}</span>
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
