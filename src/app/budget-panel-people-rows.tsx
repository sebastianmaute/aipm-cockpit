"use client";
import { DOT_COL_PX, TOTAL_COL_PX, displayHours } from "./budget-panel-totals";
import { buildBucketPeopleRows, type PersonRow } from "./budget-bucket-people";
import { absencesForResource, periodCapacityHours, type Period } from "./resource-capacity";
import { ToggleButton } from "./toggle-button";
import { t, type Lang } from "./i18n";
import type { BucketPeriodCell } from "./timelog-actuals";
import type { Absence, BucketAllocation, Resource } from "./types";

const DASH = "—";

/** ★★ Every figure in these rows is DERIVED — planned is `(util/100) × capacity`
 *  summed period by period, so three months at 85% of 176h render as
 *  448.79999999999995 — and booked is a sum of Timelog hours, which carries the
 *  same class of noise. `budget-panel-totals.tsx` already rounds exactly this
 *  for exactly this reason ("Mirrored plan hours are derived … and carry float
 *  noise such as 10.559999999999999"), so its `displayHours` is REUSED rather
 *  than re-derived: a second rounding rule that disagreed with `TotalsTd`'s
 *  would put two different numbers for the same hours in one table, which is
 *  worse than the noise. `null` stays the unknown dash — it is not a value to
 *  round. These rows are read-only, so `readOnly` is always true here (rounding
 *  a field the user is typing into fights the input; that is why the flag
 *  exists at all).
 *  ★★ NON-FINITE ROUTES TO THE DASH TOO. `displayHours` returns `""` for
 *  NaN/±Infinity, which is right for the INPUT it was written for (an empty
 *  field) and wrong for read-only TEXT: it rendered a blank half of "— / —" with
 *  no dash, so a broken figure read as "no data" — and, worse, as `" / 12"`,
 *  where the missing operand is invisible rather than marked. There is one
 *  unknown state in these rows and it is spelled `—`; anything that is not a
 *  displayable number belongs in it. Defensive only: `bookedTotal` sums Timelog
 *  hours and `plannedTotal` sums capacity, so no live path is known to produce a
 *  non-finite value — this closes the third state, it does not fix a seen bug. */
const hoursText = (v: number | null): number | string =>
  v == null || !Number.isFinite(v) ? DASH : displayHours(v, true);

/** The disclosure contract is an id shared by two elements that live ~40 lines
 *  apart, so it is minted here instead of spelled out at both call sites — a
 *  trigger whose `aria-controls` resolves to nothing fails silently. */
export function peopleBodyId(bucketId: number, roleId: number): string {
  return `bucket-people-${bucketId}-${roleId}`;
}

/** The disclosure TRIGGER for one role line, rendered AS that row's label.
 *
 *  It lives beside its target so the two halves of the `aria-controls` contract
 *  cannot drift apart, and so the a11y rules below are stated once:
 *  ★ The accessible name is ROW-UNIQUE. N identical "Show people" names is a
 *    WCAG 2.4.6 failure, and the axe gate PASSES it whenever the seeded data
 *    renders a single row — the gate cannot protect this.
 *  ★ The label names what the pressed state ENABLES and never flips to the
 *    opposite action (WCAG 4.1.2) — `ToggleButton`'s structural contract. */
export function PeopleDisclosureLabel({
  lang, label, bucketId, roleId, open, onToggle,
}: {
  lang: Lang;
  label: string;
  bucketId: number;
  roleId: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <ToggleButton
      variant="disclosure"
      pressed={open}
      onToggle={onToggle}
      ariaControls={peopleBodyId(bucketId, roleId)}
      ariaLabel={`${t(lang, "budgetShowPeople")} – ${label}`}
      // ★★ THE ELLIPSIS HAS TO LAND ON A TEXT NODE (open-followups §117). The
      //   `<td>` around this is `truncate` and clamped to the LIVE role-column
      //   width, but `text-overflow` does not apply to an atomic inline — and
      //   this cell's only child is an inline-flex button — so the button was
      //   simply cut at the cell edge, mid-glyph, with nothing indicating it
      //   (185.6px of "Business Analyst Consultant" inside a 160px column;
      //   every one of the sample's seven role lines cut once the column is
      //   dragged to 90px). Two halves, both required:
      //   • `max-w-full` lets the button stop at the cell's content box instead
      //     of overflowing it,
      //   • `[&>span]:truncate` puts the ellipsis on the primitive's LABEL span,
      //     which is a blockified flex item and therefore a place where
      //     `text-overflow` does apply. `min-w-0` beside it is belt-and-braces:
      //     `overflow:hidden` already zeroes a flex item's automatic minimum
      //     size, so `truncate` alone measured identically — keep it anyway,
      //     because it states the intent that a later `overflow` change must
      //     not silently revoke.
      //   ★ Deliberately at the CALL SITE, not in `ToggleButton`: every other
      //   consumer is a short fixed label in an unclamped toolbar. The `&>span`
      //   reaches into the primitive's markup, which is the price of not
      //   changing it for everyone; `toggle-button.tsx` renders exactly one
      //   span (the label) plus an `<svg>` marker, and `budget-panel-people-rows.test.tsx`
      //   pins both this class list and that structure.
      className="max-w-full [&>span]:min-w-0 [&>span]:truncate"
      // ★ The rows read "6 / 176" with no header saying which figure is which —
      //   position and the `/` are the only cue. This says it in words, in the
      //   accessible DESCRIPTION (the NAME must stay stable), and the disclosure
      //   variant suppresses the primitive's on/off suffix so nothing else is
      //   appended. It is hover-only for sighted users, so a VISIBLE legend is
      //   still open — this is the cheap half, not the whole answer.
      title={t(lang, "budgetPeopleFigureHint")}
      lang={lang}
    >
      {label}
    </ToggleButton>
  );
}

/** Planned capacity per resource per period — the `plannedByResourcePeriod`
 *  input `buildBucketPeopleRows` deliberately asks its CALLER to resolve (the
 *  engine stays clock- and capacity-free).
 *
 *  ★ Feed it the PLAN's full period list, not one bucket's: `bucketActivePeriods`
 *  filters that same list, so one map keyed by `Period.key` covers every bucket
 *  and the panel derives it once per render rather than once per bucket. */
export function buildPlannedByResourcePeriod(
  resources: readonly Resource[],
  absences: readonly Absence[],
  periods: readonly Period[],
  workdayHours: number,
  holidaySet: Set<string>,
): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  for (const r of resources) {
    const abs = absencesForResource(absences, r);
    const byPeriod: Record<string, number> = {};
    for (const p of periods) byPeriod[p.key] = periodCapacityHours(r, p, abs, workdayHours, holidaySet);
    out[r.id] = byPeriod;
  }
  return out;
}

/** One role line's people body: runs the membership engine and renders the
 *  disclosure target. Kept beside the rows (and out of `budget-panel.tsx`, which
 *  sits under the 800-line ratchet) so the id, the engine call and the markup
 *  stay in one place. */
export function BucketRolePeople({
  bucketId, allocation, resources, actualsByPeriod, plannedByResourcePeriod, periods,
  collapsed, roleWidth,
}: {
  bucketId: number;
  allocation: Pick<BucketAllocation, "roleId" | "resourceIds">;
  resources: readonly Resource[];
  actualsByPeriod: Readonly<Record<string, BucketPeriodCell>>;
  plannedByResourcePeriod: Readonly<Record<number, Record<string, number>>>;
  periods: readonly Period[];
  collapsed: boolean;
  roleWidth: number;
}) {
  const rows = buildBucketPeopleRows({
    allocation, resources, actualsByPeriod, plannedByResourcePeriod, periods,
  });
  return (
    <BucketPeopleRows
      id={peopleBodyId(bucketId, allocation.roleId)}
      rows={rows}
      periods={periods}
      collapsed={collapsed}
      roleWidth={roleWidth}
    />
  );
}

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
            <span className="text-foreground">{hoursText(r.bookedTotal)}</span>
            <span className="text-muted-foreground"> / {hoursText(r.plannedTotal)}</span>
          </td>
          {periods.map((p) => (
            <td key={p.key} className="px-3 py-1 text-right tabular-nums">
              <span className="text-foreground">{hoursText(r.booked[p.key] ?? null)}</span>
              <span className="text-muted-foreground"> / {hoursText(r.planned[p.key] ?? null)}</span>
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
