import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  BucketPeopleRows, BucketRolePeople, PeopleDisclosureLabel, buildPlannedByResourcePeriod, peopleBodyId,
} from "./budget-panel-people-rows";
import { DOT_COL_PX, TOTAL_COL_PX } from "./budget-panel-totals";
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
