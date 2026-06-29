import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TourCatalog } from "./tour-catalog";
import type { TourCatalogEntry } from "./app-tour";

const tours: TourCatalogEntry[] = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc", stepCount: 12, iconView: "dashboard" },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", stepCount: 3, iconView: "raid" },
];

describe("TourCatalog", () => {
  it("shows the step count and a Start CTA for an unfinished tour", () => {
    render(<TourCatalog lang="en-US" tours={tours} completedTours={[]} onStartTour={() => {}} />);
    expect(screen.getByText("12 steps")).toBeTruthy();
    expect(screen.getAllByText(/start tour/i).length).toBeGreaterThan(0);
  });

  it("shows a Replay CTA + done badge for a completed tour", () => {
    render(<TourCatalog lang="en-US" tours={tours} completedTours={["raid"]} onStartTour={() => {}} />);
    expect(screen.getByText(/replay tour/i)).toBeTruthy();
  });

  it("fires onStartTour with the tour id", () => {
    const onStart = vi.fn();
    render(<TourCatalog lang="en-US" tours={tours} completedTours={[]} onStartTour={onStart} />);
    screen.getAllByRole("button")[0].click();
    expect(onStart).toHaveBeenCalledWith("getting-started");
  });
});
