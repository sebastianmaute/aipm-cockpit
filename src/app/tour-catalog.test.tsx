import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TourCatalog } from "./tour-catalog";
import { TOURS, type TourCatalogEntry } from "./app-tour";
import { loadI18n } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

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

describe("TourCatalog — every tour button has its own name (§245)", () => {
  beforeAll(() => loadI18n("de"));

  // The button is named "<Start|Replay> – <tour title>", so two tours with one title would sound
  // identical. `use-tour.ts` shows a FILTERED subset of TOURS, so the whole catalog is the strictest
  // fixture: unique across all of it is unique across any subset.
  const all: TourCatalogEntry[] = TOURS.map((tour) => ({
    id: tour.id,
    titleKey: tour.titleKey,
    descKey: tour.descKey,
    stepCount: tour.steps.length,
    iconView: tour.iconView,
  }));

  it.each(["en-US", "de"] as const)("names every tour in the full catalog distinctly in %s", (lang) => {
    render(<TourCatalog lang={lang} tours={all} completedTours={[]} onStartTour={() => {}} />);
    expectRowUniqueNames({ minControls: TOURS.length });
  });
});
