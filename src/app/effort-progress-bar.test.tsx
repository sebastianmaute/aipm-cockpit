import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffortProgressBar } from "./effort-progress-bar";

// The track lost `role="progressbar"` when the whole widget became the Time
// tracking BUTTON, which now carries the accessible name and the figures. The
// three `aria-valuenow` assertions this file used to carry are NOT dropped:
// each is converted to the surviving observable that encoded the same number --
// the FILL's width, still `Math.min(pct, 1) * 100`. So the zero state, the
// proportional value and the >100% CAP all stay pinned, alongside the caption
// text the component now announces through.
const fillWidth = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("div[style]")?.style.width ?? null;

describe("EffortProgressBar", () => {
  test("no estimate → disabled-state hint, and NO fill is drawn", () => {
    const { container } = render(
      <EffortProgressBar lang="en-US" estimateMin={undefined} spentMin={120} />,
    );
    expect(screen.getByText(/no estimate set/i)).toBeInTheDocument();
    // Was aria-valuenow="0": with no estimate there is no proportion to show,
    // so the fill element is absent rather than rendered at zero width.
    expect(fillWidth(container)).toBeNull();
  });
  test("partial → percent label and a proportional fill", () => {
    const { container } = render(
      <EffortProgressBar lang="en-US" estimateMin={480} spentMin={120} />,
    ); // 25%
    expect(screen.getByText(/· 25%/)).toBeInTheDocument();
    expect(fillWidth(container)).toBe("25%"); // was aria-valuenow="25"
    // The track is decorative now — the wrapping button announces the state.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  test("overrun → shows >100% label, fill capped at 100%", () => {
    const { container } = render(
      <EffortProgressBar lang="en-US" estimateMin={480} spentMin={600} />,
    ); // 125%
    expect(screen.getByText(/· 125%/)).toBeInTheDocument();
    expect(fillWidth(container)).toBe("100%"); // was aria-valuenow capped at 100
  });
});
