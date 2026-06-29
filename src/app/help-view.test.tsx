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

  it("shows the Take the tour button only when onTakeTour is provided", () => {
    const { rerender } = render(<HelpView lang="en-US" />);
    expect(screen.queryByRole("button", { name: /take the tour/i })).toBeNull();
    rerender(<HelpView lang="en-US" onTakeTour={() => {}} />);
    expect(screen.getByRole("button", { name: /take the tour/i })).toBeInTheDocument();
  });

  it("consumes a deep-linked concept on mount (scroll + callback)", () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollSpy });
    const onConsumed = vi.fn();
    render(<HelpView lang="en-US" pendingHelpConcept="concept-raid" onHelpConceptConsumed={onConsumed} />);
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalled();
  });
});
