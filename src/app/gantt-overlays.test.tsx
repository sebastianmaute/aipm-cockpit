// Covers the two decorative Gantt overlay layers. Both are positioned from the
// SAME geometry the day-axis header uses (`nameColWidth + i * DAY_WIDTH_PX`),
// which is the whole point of the feature — a grid line has to sit under its
// day label. jsdom has NO layout engine (every rect is 0), so nothing here can
// prove visual alignment; these tests pin the STRUCTURE (counts, data
// attributes, the computed `left` values) and alignment stays eye-only.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GanttGridLayer, GanttNonWorkingLayer } from "./gantt-overlays";
import { DAY_WIDTH_PX } from "./gantt-engine";

const range = { min: new Date("2026-08-01T00:00:00Z"), days: 3 };

describe("GanttNonWorkingLayer", () => {
  it("renders one column per holiday inside the window", () => {
    const { container } = render(
      <GanttNonWorkingLayer
        range={range}
        holidaySet={new Set(["2026-08-02", "2027-01-01"])}
        nameColWidth={100}
        heightPx={64}
      />,
    );
    const cells = container.querySelectorAll("[data-holiday]");
    expect(cells).toHaveLength(1);
    expect(cells[0].getAttribute("data-holiday")).toBe("2026-08-02");
  });

  it("renders nothing for an empty holiday set", () => {
    const { container } = render(
      <GanttNonWorkingLayer range={range} holidaySet={new Set()} nameColWidth={100} heightPx={64} />,
    );
    expect(container.querySelectorAll("[data-holiday]")).toHaveLength(0);
  });

  it("positions a holiday column at the same x the header puts that day", () => {
    // Day index 1 (2026-08-02) ⇒ nameColWidth + 1 * DAY_WIDTH_PX.
    const { container } = render(
      <GanttNonWorkingLayer
        range={range}
        holidaySet={new Set(["2026-08-02"])}
        nameColWidth={100}
        heightPx={64}
      />,
    );
    const cell = container.querySelector("[data-holiday]") as HTMLElement;
    expect(cell.style.left).toBe(`${100 + DAY_WIDTH_PX}px`);
    expect(cell.style.width).toBe(`${DAY_WIDTH_PX}px`);
    expect(cell.style.height).toBe("64px");
  });

  it("is inert decoration — hidden from AT and not pointer-interactive", () => {
    const { container } = render(
      <GanttNonWorkingLayer
        range={range}
        holidaySet={new Set(["2026-08-02"])}
        nameColWidth={100}
        heightPx={64}
      />,
    );
    const cell = container.querySelector("[data-holiday]") as HTMLElement;
    expect(cell.getAttribute("aria-hidden")).toBe("true");
    expect(cell.className).toContain("pointer-events-none");
  });
});

describe("GanttGridLayer", () => {
  it("renders one line per day in the window", () => {
    const { container } = render(<GanttGridLayer range={range} nameColWidth={100} heightPx={64} />);
    expect(container.querySelectorAll("[data-grid-line]")).toHaveLength(3);
  });

  it("steps each line by one day column from the name-column edge", () => {
    const { container } = render(<GanttGridLayer range={range} nameColWidth={100} heightPx={64} />);
    const lines = Array.from(container.querySelectorAll("[data-grid-line]")) as HTMLElement[];
    expect(lines.map((l) => l.style.left)).toEqual([
      "100px",
      `${100 + DAY_WIDTH_PX}px`,
      `${100 + 2 * DAY_WIDTH_PX}px`,
    ]);
  });

  it("is inert decoration — hidden from AT and not pointer-interactive", () => {
    const { container } = render(<GanttGridLayer range={range} nameColWidth={100} heightPx={64} />);
    const line = container.querySelector("[data-grid-line]") as HTMLElement;
    expect(line.getAttribute("aria-hidden")).toBe("true");
    expect(line.className).toContain("pointer-events-none");
  });
});
