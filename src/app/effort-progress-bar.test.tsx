import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffortProgressBar } from "./effort-progress-bar";

describe("EffortProgressBar", () => {
  test("no estimate → disabled state with hint, aria-valuenow 0", () => {
    render(<EffortProgressBar lang="en-US" estimateMin={undefined} spentMin={120} />);
    expect(screen.getByText(/no estimate set/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
  test("partial → percent label and aria-valuenow", () => {
    render(<EffortProgressBar lang="en-US" estimateMin={480} spentMin={120} />); // 25%
    expect(screen.getByText(/· 25%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });
  test("overrun → shows >100% label, aria-valuenow capped at 100", () => {
    render(<EffortProgressBar lang="en-US" estimateMin={480} spentMin={600} />); // 125%
    expect(screen.getByText(/· 125%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
