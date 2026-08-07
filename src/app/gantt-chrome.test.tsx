// Covers `GanttHeader` (src/app/gantt-chrome.tsx) — the Gantt's month/day time
// axis. Nothing rendered this component before, so the day band's height, its
// two-line day label and the today cell's colour branch were all unpinned:
// reverting the day band from DAY_ROW_HEIGHT_PX to HEADER_ROW_HEIGHT_PX
// reinstated the 22px band that clipped the stacked labels with the whole
// suite green.
//
// ★ jsdom has NO layout engine, so nothing here may assert geometry (rendered
//   widths, overflow, wrapping) — such an assertion would be green regardless.
//   Inline style VALUES and class plumbing are what jsdom reports faithfully,
//   and they are all this file claims.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttHeader } from "./gantt-chrome";
import { DAY_ROW_HEIGHT_PX, DAY_WIDTH_PX, HEADER_ROW_HEIGHT_PX } from "./gantt-engine";
import type { Lang } from "./i18n";

// Wed 2026-08-05 .. Sun 2026-08-09; 2026-08-07 is a UTC Friday and is "today".
const RANGE = { min: new Date(Date.UTC(2026, 7, 5)), days: 5 };
const TODAY = new Date(Date.UTC(2026, 7, 7));
const MONTH_LABEL = "Aug 2026";

function renderHeader(lang: Lang = "en-US") {
  return render(
    <GanttHeader
      lang={lang}
      monthGroups={[{ label: MONTH_LABEL, widthPx: RANGE.days * DAY_WIDTH_PX }]}
      range={RANGE}
      today={TODAY}
      timelineWidthPx={RANGE.days * DAY_WIDTH_PX}
      nameColWidth={200}
    />,
  );
}

/** The cell for a given day-of-month — the `<div>` wrapping its two labels. */
function dayCell(dayOfMonth: string): HTMLElement {
  return screen.getByText(dayOfMonth).parentElement as HTMLElement;
}

describe("GanttHeader bands", () => {
  it("gives the day band its own height, not the month band's", () => {
    renderHeader();
    // Precondition: with the two constants equal this test could not fail, so
    // state the difference rather than assume it (gantt-engine.test.ts pins it).
    expect(DAY_ROW_HEIGHT_PX).not.toBe(HEADER_ROW_HEIGHT_PX);

    const monthBand = screen.getByTitle(MONTH_LABEL).parentElement as HTMLElement;
    const dayBand = dayCell("7").parentElement as HTMLElement;

    expect(monthBand.style.height).toBe(`${HEADER_ROW_HEIGHT_PX}px`);
    expect(dayBand.style.height).toBe(`${DAY_ROW_HEIGHT_PX}px`);
  });

  it("spans exactly its two bands", () => {
    // The real form of the constants' `HEADER_HEIGHT_PX === HEADER_ROW + DAY_ROW`
    // assertion: that one restates the implementation symbolically and cannot
    // fail, this one sums what was actually RENDERED, so a total that stops
    // tracking the two bands is caught here.
    const { container } = renderHeader();
    const outer = container.firstElementChild as HTMLElement;
    const monthBand = screen.getByTitle(MONTH_LABEL).parentElement as HTMLElement;
    const dayBand = dayCell("7").parentElement as HTMLElement;

    expect(parseFloat(outer.style.height)).toBe(
      parseFloat(monthBand.style.height) + parseFloat(dayBand.style.height),
    );
  });
});

describe("GanttHeader day labels", () => {
  it("stacks the day-of-month number over the short weekday", () => {
    renderHeader();
    const cell = dayCell("7");
    const labels = Array.from(cell.querySelectorAll("span")).map((s) => s.textContent);
    // Order matters: the number reads above the weekday.
    expect(labels).toEqual(["7", "Fri"]);
    // ★ Class plumbing only — jsdom cannot see that the two labels actually
    //   stack, but it can see the column direction being dropped.
    expect(cell.className).toContain("flex-col");
  });

  it("keeps the today cell's weekday label on the accent colour", () => {
    renderHeader();
    const today = dayCell("7");
    const plain = dayCell("6"); // Thursday — neither today nor a weekend
    expect(today.className).toContain("text-ui-dark-blue");

    const todayWeekday = today.querySelectorAll("span")[1];
    const plainWeekday = plain.querySelectorAll("span")[1];
    // The control: an ordinary cell's weekday IS muted, which proves the
    // selector is finding a real weekday span rather than nothing.
    expect(plainWeekday.className).toContain("text-muted-foreground");
    // Today's must not be — muting it would override the cell's accent.
    expect(todayWeekday.className).not.toContain("text-muted-foreground");
  });

  // ★★ Pins that `lang` REACHES the formatter. Every other test in this file
  //    renders en-US, so hardcoding `fmtWeekdayShort(d, "en-US")` inside
  //    GanttHeader — dropping the prop on the floor — survives all of them.
  //    German is the discriminating locale: the day NUMBER is identical, so a
  //    differing weekday label is the only observable, and "Fr" vs "Fri" cannot
  //    be produced by the en-US path.
  it("formats the weekday in the caller's language", () => {
    renderHeader("de");
    const labels = Array.from(dayCell("7").querySelectorAll("span")).map((s) => s.textContent);
    expect(labels).toEqual(["7", "Fr"]);
  });
});
