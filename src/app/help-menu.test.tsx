import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { HelpMenu } from "./help-menu";
import type { TourCatalogEntry } from "./app-tour";

const TOURS: TourCatalogEntry[] = [
  { id: "getting-started", titleKey: "helpGuidedToursTitle", descKey: "helpIntro", iconView: "dashboard", stepCount: 3 },
];

function openPanel() {
  // The toggle button's accessible name is the translated "help" key ("Help").
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
}

describe("HelpMenu floating panel", () => {
  it("renders without crashing when closed", () => {
    render(<HelpMenu lang="en-US" />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("shows 3 tabs and a search box on the Help tab when no tours are provided", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("shows a Guided tours tab when onStartTour is provided", () => {
    render(<HelpMenu lang="en-US" onStartTour={vi.fn()} catalogTours={TOURS} completedTours={[]} />);
    openPanel();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("hides search and shows the relations map on the How-it-connects tab", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /how/i }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    // RelationsMap renders a labelled group.
    expect(screen.getByRole("group", { name: /relation/i })).toBeInTheDocument();
  });

  it("shows the information-flows diagram on the Information flows tab", () => {
    const { container } = render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /flow/i }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(container.querySelector("svg[role='img']")).not.toBeNull();
  });

  it("returns to the Help tab with search visible", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /flow/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Help" }));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("starting a tour calls onStartTour and closes the panel", () => {
    const onStartTour = vi.fn();
    render(<HelpMenu lang="en-US" onStartTour={onStartTour} catalogTours={TOURS} completedTours={[]} />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /guided/i }));
    // TourCatalog cards expose an accessible name beginning with the Start CTA.
    fireEvent.click(screen.getByRole("button", { name: /start tour/i }));
    expect(onStartTour).toHaveBeenCalledWith("getting-started");
    // Panel closed → its tablist is gone.
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("clicking a concept in the relations map switches to the Help tab", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.click(screen.getByRole("tab", { name: /how/i }));
    // RelationsMap concept buttons carry the "open concept" title. Scope the
    // query to the relations-map group so the top-bar Help toggle button (which
    // also carries a `title`) is excluded.
    const map = screen.getByRole("group", { name: /relation/i });
    const nodes = within(map).getAllByRole("button").filter((b) => b.getAttribute("title"));
    fireEvent.click(nodes[0]);
    // Back on the Help tab → search box is present again.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });
});
