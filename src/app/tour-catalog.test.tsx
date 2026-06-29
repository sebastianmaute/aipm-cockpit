import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TourCatalog } from "./tour-catalog";

const TOURS = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc" },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc" },
] as const;

describe("TourCatalog", () => {
  it("renders one card per tour", () => {
    render(<TourCatalog lang="en-US" tours={[...TOURS]} completedTours={[]} onStartTour={() => {}} />);
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("Managing risks")).toBeInTheDocument();
  });
  it("shows the Done badge for a completed tour", () => {
    render(<TourCatalog lang="en-US" tours={[...TOURS]} completedTours={["raid"]} onStartTour={() => {}} />);
    expect(screen.getAllByText("Done").length).toBe(1);
  });
  it("fires onStartTour with the tour id when a card is clicked", () => {
    const onStart = vi.fn();
    render(<TourCatalog lang="en-US" tours={[...TOURS]} completedTours={[]} onStartTour={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /managing risks/i }));
    expect(onStart).toHaveBeenCalledWith("raid");
  });
});
