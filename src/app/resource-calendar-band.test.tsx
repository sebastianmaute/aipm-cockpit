import { it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CalendarBand } from "./resource-calendar-band";

it("the truncation banner cell is a gridcell, not a rowheader", () => {
  // rowheader asserts "this cell is the label for its row"; the full-width
  // banner labels nothing. The per-lane sticky first cell keeps rowheader —
  // that one genuinely does label its lane.
  const { container } = render(
    <table>
      <CalendarBand
        lang="en-US"
        lanes={[]}
        days={[{ iso: "2026-06-01", dayOfMonth: 1, weekdayLabel: "Mon", isoWeek: 23, monthLabel: "Jun", isWeekend: false, isHoliday: false, isToday: false }]}
        eventsById={new Map()}
        onEditEvent={() => {}}
        truncated
      />
    </table>,
  );
  const banner = container.querySelector("[data-calendar-band] td");
  expect(banner).not.toBeNull();
  expect(banner!.getAttribute("role")).toBe("gridcell");
});
