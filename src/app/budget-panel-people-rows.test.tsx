import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  BucketPeopleRows, BucketRolePeople, PeopleDisclosureLabel, buildPlannedByResourcePeriod, peopleBodyId,
} from "./budget-panel-people-rows";
import { DOT_COL_PX, HOURS_LINE_REM, HOURS_LINE_UNITS, HoursTd, TOTAL_COL_PX, TotalsTd } from "./budget-panel-totals";
import type { PersonRow } from "./budget-bucket-people";
import type { Resource } from "./types";

const PERIODS = [{ key: "2026-01", start: "2026-01-01", end: "2026-01-31" }];
const ROLE_WIDTH = 180;

const row = (over: Partial<PersonRow> = {}): PersonRow => ({
  resourceId: 1, name: "Adam", hasPlanLine: true,
  booked: { "2026-01": 6 }, planned: { "2026-01": 8 },
  bookedTotal: 6, plannedTotal: 8, ...over,
});

const renderRows = (rows: readonly PersonRow[], collapsed = false) =>
  render(
    <table>
      <BucketPeopleRows
        id="people-1-10" rows={rows} periods={PERIODS} collapsed={collapsed} roleWidth={ROLE_WIDTH}
      />
    </table>,
  );

// ★ The figure and its separator are separate spans, and Testing Library's text
//   matcher reads a node's DIRECT text children only — so no `getByText` can
//   ever see a whole "booked / planned" pair. Read the cells instead.
const cellTexts = (container: HTMLElement) =>
  [...container.querySelectorAll("#people-1-10 td")].map((td) => td.textContent);

describe("BucketPeopleRows", () => {
  it("renders booked / planned in the total column and per period", () => {
    const { container } = renderRows([row()]);
    expect(screen.getByText("Adam")).toBeInTheDocument();
    expect(cellTexts(container)).toEqual(["", "Adam", "6 / 8", "6 / 8"]);
    // The counterpart to the collapsed case below: `hidden` must TRACK the prop,
    // not simply be present.
    expect(container.querySelector("#people-1-10")).not.toHaveAttribute("hidden");
  });

  it("shows a dash for planned when the person has no plan line", () => {
    const { container } = renderRows([
      row({ hasPlanLine: false, planned: { "2026-01": null }, plannedTotal: null }),
    ]);
    expect(cellTexts(container)).toEqual(["", "Adam", "6 / —", "6 / —"]);
  });

  it("shows a dash — NOT a zero — when booked is unknown for a period", () => {
    const { container } = renderRows([row({ booked: { "2026-01": null }, bookedTotal: null })]);
    expect(screen.queryByText("0")).toBeNull();
    expect(cellTexts(container)).toEqual(["", "Adam", "— / 8", "— / 8"]);
  });

  // ★ `displayHours` returns "" for a non-finite value — correct for the INPUT
  //   it was written for, wrong for read-only text, where it renders the blank
  //   half of a "x / y" pair with no dash and reads as "no data". There is one
  //   unknown state in these rows and it is spelled "—". Defensive: no live path
  //   is known to produce NaN here.
  it("shows the dash — not a blank — for a non-finite figure", () => {
    const { container } = renderRows([
      row({ booked: { "2026-01": Number.NaN }, bookedTotal: Number.POSITIVE_INFINITY }),
    ]);
    expect(cellTexts(container)).toEqual(["", "Adam", "— / 8", "— / 8"]);
  });

  // ★★★ THE ALIGNMENT CONTRACT. A role's period cell is a two-line stack whose
  // figures sit in a `w-16` box that starts after a `w-14` label and a `gap-1`,
  // i.e. the box's right edge is HOURS_LINE_UNITS from the cell's content-box left.
  // A person's cell is a single line, so it can only line up horizontally — and
  // it did not: it right-aligned to the WHOLE period column, which is far wider,
  // leaving the figures stranded to the right of every box above them.
  // ★★ jsdom has no layout, so nothing here can measure the two edges and
  // compare. What CAN be pinned is that both derive from one number, which is
  // why HOURS_LINE_UNITS is exported rather than spelled `31` in two files — and
  // why the `not.toContain("text-right")` on the cell is not a style nit: with
  // the class still on the `<td>`, the inner block aligns correctly AND the cell
  // keeps right-anchoring it, so a fixture whose figure happens to fill the
  // block would pass either way.
  // ★★★ `pr-1` IS PART OF THE CONTRACT, not padding taste. The role value box
  // is `w-16 px-1`, so its digits stop one unit short of its right edge; a block
  // that is merely the same WIDTH puts its digits one unit further right and the
  // column staggers by 4px at a 16px root. Width alone passing is exactly how
  // the first cut of this shipped mis-aligned — assert both.
  it("anchors a person's period figure to the role row's value-box column", () => {
    const { container } = renderRows([row()]);
    const cells = [...container.querySelectorAll("#people-1-10 td")];
    const period = cells[3] as HTMLElement;
    expect(period.className).not.toContain("text-right");
    const figure = period.firstElementChild as HTMLElement;
    expect(figure.style.width).toBe(HOURS_LINE_REM);
    expect(figure).toHaveClass("text-right");
    expect(figure).toHaveClass("pr-1");
    // Over-wide pairs must eat leftwards into the label gutter rather than wrap
    // onto a second line, which would desynchronise the row heights.
    expect(figure).toHaveClass("whitespace-nowrap");
  });

  // The Total column already lined up, and NOT by luck: TOTAL_COL_PX was itself
  // derived as this width plus the cell's own px-3 (124 + 24 = 148) — its
  // docstring in `budget-panel-totals.tsx` says so. Both cells now measure from
  // the one constant, so the two derivations cannot drift apart.
  it("anchors a person's TOTAL figure to the same column", () => {
    const { container } = renderRows([row()]);
    const total = [...container.querySelectorAll("#people-1-10 td")][2] as HTMLElement;
    const figure = total.firstElementChild as HTMLElement;
    expect(figure.style.width).toBe(HOURS_LINE_REM);
    expect(figure).toHaveClass("pr-1");
  });

  it("stays in the DOM while collapsed so aria-controls resolves", () => {
    const { container } = renderRows([row()], true);
    const body = container.querySelector("#people-1-10");
    expect(body).not.toBeNull();
    expect(body?.tagName).toBe("TBODY");
    expect(body).toHaveAttribute("hidden");
    // The rows themselves must still be there — a hidden tbody with no children
    // would satisfy the id lookup while pointing at nothing.
    expect(body?.querySelectorAll("tr")).toHaveLength(1);
  });

  it("does not tint either figure", () => {
    renderRows([row()]);
    for (const el of screen.getAllByText("6")) {
      expect(el.className).not.toMatch(/(^|\s)text-(ui|rag)-/);
    }
  });

  // ★★ The three leading columns of this table are pinned BY ARITHMETIC: the
  //    role column sits at DOT_COL_PX and the Total column at DOT_COL_PX + the
  //    LIVE role width. These rows must mirror BucketRowLeadCells exactly or
  //    they slide out from under their own headers on horizontal scroll.
  //    jsdom has no layout — this pins the plumbing, not the geometry.
  it("pins its three leading cells at the same offsets as the role row", () => {
    const { container } = renderRows([row()]);
    const cells = [...container.querySelectorAll("#people-1-10 td")];
    expect(cells).toHaveLength(4); // dot, name, total, one period
    const [dot, name, total] = cells as HTMLElement[];
    expect(dot.style.left).toBe("0px");
    expect(name.style.left).toBe(`${DOT_COL_PX}px`);
    expect(name.style.maxWidth).toBe(`${ROLE_WIDTH}px`);
    expect(total.style.left).toBe(`${DOT_COL_PX + ROLE_WIDTH}px`);
    expect(total.style.minWidth).toBe(`${TOTAL_COL_PX}px`);
    for (const cell of [dot, name, total]) {
      // `sticky` rides the CLASS, never the inline style — an inline
      // `position: sticky` would leave the `print:static` beside it inert.
      expect(cell.style.position).toBe("");
      expect(cell.className).toMatch(/(^|\s)sticky(\s|$)/);
      expect(cell.className).toMatch(/(^|\s)bg-surface(\s|$)/);
      expect(cell.className).toMatch(/print:static/);
    }
  });
});

// ★★ Both 21-workday months, chosen so `(85/100) × 21 × 8` lands on
//    142.79999999999998 — a value whose NOISE is visible in a single cell, not
//    only in a sum. Every earlier fixture in this file uses whole numbers, which
//    is exactly why the missing rounding survived: an exact fixture cannot see
//    it. Re-check with `node -e` if these months ever move.
const NOISY_PERIODS = [
  { key: "2026-05", start: "2026-05-01", end: "2026-05-31" },
  { key: "2026-08", start: "2026-08-01", end: "2026-08-31" },
];

const NOISY_PERSON: Resource = {
  id: 1, firstName: "Adam", lastName: "", roleId: 10,
  utilizationMode: "percent",
  utilization: { "2026-05": 85, "2026-08": 85 },
};

const bookedCell = (hours: number) => ({ hours, billableHours: hours, byResource: { 1: { hours, billableHours: hours } } });

describe("BucketRolePeople float noise", () => {
  it("rounds every derived figure for display, the same way TotalsTd does", () => {
    const planned = buildPlannedByResourcePeriod([NOISY_PERSON], [], NOISY_PERIODS, 8, new Set<string>());
    // ★ THE ANTI-VACUITY CONTROL. Without this the test would still pass if the
    //   capacity arithmetic ever became exact, and would then be pinning nothing.
    //   These are the raw engine values the cells below must NOT render verbatim.
    expect(String(planned[1]["2026-05"])).toBe("142.79999999999998");
    expect(String(planned[1]["2026-05"] + planned[1]["2026-08"])).toBe("285.59999999999997");
    // 0.1 + 0.2 — the booked axis is a sum too, and carries the same class of noise.
    expect(String(0.1 + 0.2)).toBe("0.30000000000000004");

    const { container } = render(
      <table>
        <BucketRolePeople
          bucketId={1}
          allocation={{ roleId: 10, resourceIds: [1] }}
          resources={[NOISY_PERSON]}
          actualsByPeriod={{ "2026-05": bookedCell(0.1), "2026-08": bookedCell(0.2) }}
          plannedByResourcePeriod={planned}
          periods={NOISY_PERIODS}
          collapsed={false}
          roleWidth={ROLE_WIDTH}
        />
      </table>,
    );
    const cells = [...container.querySelectorAll(`#${peopleBodyId(1, 10)} td`)].map((td) => td.textContent);
    expect(cells).toEqual(["", "Adam", "0.3 / 285.6", "0.1 / 142.8", "0.2 / 142.8"]);
  });
});

const LONG_ROLE = "Business Analyst Consultant";

const renderLabel = (label = LONG_ROLE) =>
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <PeopleDisclosureLabel
              lang="en-US" label={label} bucketId={1} roleId={10} open={false} onToggle={() => {}}
            />
          </td>
        </tr>
      </tbody>
    </table>,
  );

describe("PeopleDisclosureLabel", () => {
  // ★★★ NONE OF THIS PROVES THE LABEL ELLIPSIZES. jsdom has no layout, so the
  //     only thing testable here is the PLUMBING the browser fix rides on. The
  //     geometry was measured in Chromium (open-followups §123): at the 160px
  //     default the button went 185.6px → 136px and the label span went
  //     scrollWidth 144 / clientWidth 94 with `text-overflow: ellipsis`, and
  //     the rendered glyph reads "Business Analys…". Re-measure there, not here.
  it("makes the button shrinkable and hands the ellipsis to the label span", () => {
    renderLabel();
    const btn = screen.getByRole("button");
    // `max-w-full` is the half that measured LOAD-BEARING: without it the
    // inline-flex button overflows the clamped role `<td>` and is cut mid-glyph.
    expect(btn.className).toMatch(/(^|\s)max-w-full(\s|$)/);
    // `[&>span]:truncate` is what puts `text-overflow` on a node where it
    // applies — the primitive's label span, a blockified flex item.
    expect(btn.className).toMatch(/\[&>span\]:truncate/);
    // ★ HONEST LIMIT: `[&>span]:min-w-0` measured INERT — `overflow:hidden`
    //   from `truncate` already zeroes a flex item's automatic minimum size, so
    //   Chromium rendered byte-identical geometry without it. This assertion
    //   pins that the class is PRESENT (a mutation removing it fails here); it
    //   cannot and does not prove the class does anything. It stays because it
    //   states the intent a later `overflow` change must not silently revoke.
    expect(btn.className).toMatch(/\[&>span\]:min-w-0/);
  });

  // ★★ THE STRUCTURAL ASSUMPTION BEHIND `[&>span]`. The fix reaches into
  //    `ToggleButton`'s markup from this call site (deliberately — every other
  //    consumer is a short label in an unclamped toolbar). If the primitive ever
  //    wraps its label in something other than ONE direct-child span, the
  //    selector matches nothing and the clipping silently returns with no gate
  //    anywhere reporting it: axe has no rule for a cut label and jsdom sees no
  //    layout. This is that gate.
  it("keeps the label in exactly one direct-child span of the button", () => {
    renderLabel();
    const btn = screen.getByRole("button");
    const spans = [...btn.children].filter((c) => c.tagName === "SPAN");
    expect(spans).toHaveLength(1);
    expect(spans[0].textContent).toBe(LONG_ROLE);
  });

  // The a11y contract the fix must not disturb — the accessible NAME is
  // row-unique (N identical "Show people" names is WCAG 2.4.6, and the axe gate
  // passes it whenever the seed renders one row), the disclosure pair still
  // resolves, and the figure hint stays the DESCRIPTION rather than the name.
  it("keeps the row-unique name, the disclosure pair and the figure hint", () => {
    renderLabel();
    const btn = screen.getByRole("button", { name: `Show people – ${LONG_ROLE}` });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls", peopleBodyId(1, 10));
    expect(btn).toHaveAttribute("title", "Booked / planned hours");
    // The non-colour pressed marker the disclosure variant supplies.
    expect(btn.querySelector("[data-pressed-marker]")).not.toBeNull();
  });
});

// ★★ The constant is only worth exporting if it stays TIED to the classes it
// stands for. A bare `expect(HOURS_LINE_UNITS).toBe(31)` is a tautology — it
// re-states the definition and would keep passing after someone widened the
// label to `w-20`, leaving every person row out of line with no test red.
// Pinning the classes in the same test is what makes the arithmetic falsifiable:
// change a width and this fails, which is the prompt to update the constant.
//
// ★★★ BOTH ROLE CELLS, NOT JUST ONE. The first cut of this rendered `TotalsTd`
// alone, and a review caught that `budget-panel-totals.tsx` spells the same
// three widths FOUR times: twice in `TotalsTd` (read-only spans) and twice in
// `HoursCell` (the editable inputs). `HoursCell` is the role cell the PERIOD
// columns align against — the common case — so covering only `TotalsTd` left
// the more important half of the contract unpinned: changing `HoursCell`'s
// `w-14` would break every person period figure with the suite green.
describe("HOURS_LINE_UNITS — the shared alignment constant", () => {
  // 14 + 1 + 16 spacing units. Asserted against the classes below, never alone.
  it("equals the label + gap + value-box widths in the TOTAL cell", () => {
    const { container } = render(
      <table><tbody><tr><TotalsTd budget={8} actual={6} lang="en-US" /></tr></tbody></table>,
    );
    const line = container.querySelector("td > div > div") as HTMLElement;
    expect(line).toHaveClass("gap-1");                // 1 unit
    expect(line.children[0]).toHaveClass("w-14");     // 14 units, label
    expect(line.children[1]).toHaveClass("w-16");     // 16 units, value box
    // The box's own px-1 is what the person block's `pr-1` cancels.
    expect(line.children[1]).toHaveClass("px-1");
    expect(HOURS_LINE_UNITS).toBe(14 + 1 + 16);
  });

  it("equals the same widths in the editable PERIOD cell", () => {
    const { container } = render(
      <table><tbody><tr>
        <HoursTd
          ariaPrefix="Jan" budget={8} actual={6} onBudget={() => {}} onActual={() => {}}
          lang="en-US" periodEnd="2026-01-31" today="2026-01-15"
        />
      </tr></tbody></table>,
    );
    // Both figure lines (Budget over Actual) are `flex items-center gap-1` rows
    // holding a `w-14` label span and a `w-16` input.
    const lines = [...container.querySelectorAll("td > div > div")] as HTMLElement[];
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toHaveClass("gap-1");
      expect(line.children[0]).toHaveClass("w-14");
      expect(line.children[1]).toHaveClass("w-16");
      expect(line.children[1]).toHaveClass("px-1");
    }
    expect(HOURS_LINE_UNITS).toBe(14 + 1 + 16);
  });
});
