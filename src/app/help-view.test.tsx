import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpView } from "./help-view";

describe("HelpView (grouped)", () => {
  it("renders the group headers", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getAllByText("Concepts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Workflows").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Features").length).toBeGreaterThan(0);
    expect(screen.getAllByText("What's automated").length).toBeGreaterThan(0);
  });

  it("renders a concept section with a Related line", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getAllByText("Milestone").length).toBeGreaterThan(0);
    // "Related:" appears for concept entries that carry relations.
    expect(screen.getAllByText(/Related:/).length).toBeGreaterThan(0);
  });

  it("hides all groups and shows the empty message on a no-match search", () => {
    render(<HelpView lang="en-US" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzznomatchxyz" } });
    expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
    expect(screen.queryAllByText("Concepts").length).toBe(0);
  });

  it("consumes a deep-linked concept on mount (scroll + callback)", () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollSpy });
    const onConsumed = vi.fn();
    render(<HelpView lang="en-US" pendingHelpConcept="concept-raid" onHelpConceptConsumed={onConsumed} />);
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("shows the relations map with concept nodes on the How-it-connects tab", () => {
    render(<HelpView lang="en-US" />);
    fireEvent.click(screen.getByRole("tab", { name: "How it all connects" }));
    // a concept node button exists inside the map (e.g. "Milestone")
    expect(screen.getAllByRole("button", { name: "Milestone" }).length).toBeGreaterThan(0);
  });

  it("hides the search box on a non-Help tab", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Information flows" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("navigates to a related view when onNavigateView is provided", () => {
    const onNav = vi.fn();
    render(<HelpView lang="en-US" onNavigateView={onNav} />);
    // Several entries relate to view "raid" — each Related line renders a nav button.
    const btns = screen.getAllByRole("button", { name: /go to raid/i });
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]);
    expect(onNav).toHaveBeenCalledWith("raid");
  });

  it("omits the Guided tours tab when onStartTour is absent", () => {
    const { unmount } = render(<HelpView lang="en-US" />);
    expect(screen.queryByText("Guided tours")).toBeNull();
    unmount();
  });

  it("shows tour cards on the Guided tours tab when onStartTour is provided", () => {
    render(
      <HelpView
        lang="en-US"
        onStartTour={() => {}}
        catalogTours={[{ id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", stepCount: 3, iconView: "raid" }]}
        completedTours={[]}
      />,
    );
    // Default tab is Help; switch to the Guided tours tab to reveal the catalog.
    fireEvent.click(screen.getByRole("tab", { name: "Guided tours" }));
    expect(screen.getByRole("button", { name: /managing risks/i })).toBeInTheDocument();
  });
});

describe("HelpView search clear", () => {
  it("clears the in-pane search field from the overlaid X", () => {
    render(<HelpView lang="en-US" />);
    const field = screen.getByLabelText("Search help") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "milestone" } });
    expect(field.value).toBe("milestone");
    fireEvent.click(screen.getByRole("button", { name: "Clear – Search help" }));
    expect(field.value).toBe("");
  });
});
