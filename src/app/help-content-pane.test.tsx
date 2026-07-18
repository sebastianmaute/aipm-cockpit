import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test, vi } from "vitest";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
import { HELP_ENTRIES } from "./help-content";
import { loadI18n } from "./i18n";

// jsdom has no IntersectionObserver; the scroll-spy effect only needs the
// constructor to exist (the observer path itself is not exercised without
// layout). Provide a no-op stub.
beforeAll(async () => {
  if (typeof globalThis.IntersectionObserver === "undefined") {
    class StubIO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = StubIO as unknown as typeof IntersectionObserver;
  }
  // jsdom does not implement scrollIntoView (used by scrollToSection on click).
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function () {};
  }
  await loadI18n("de");
});

test("renders grouped content headings for an empty query", () => {
  render(<HelpContentPane lang="en-US" query="" />);
  // All four group dividers render as headings, plus an entry heading per entry.
  const headings = screen.getAllByRole("heading");
  expect(headings.length).toBeGreaterThan(HELP_ENTRIES.length);
});

test("query filters both the TOC and the content (fewer headings)", () => {
  const { rerender } = render(<HelpContentPane lang="en-US" query="" />);
  const before = screen.getAllByRole("heading").length;
  rerender(<HelpContentPane lang="en-US" query="milestone" />);
  const after = screen.getAllByRole("heading").length;
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

test("shows the no-results message when nothing matches", () => {
  render(<HelpContentPane lang="en-US" query="zzzznotfound" />);
  expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
  expect(screen.queryAllByRole("heading")).toHaveLength(0);
});

test("a Related view link fires onNavigateView", async () => {
  const onNavigateView = vi.fn();
  // Related view links carry the helpRelationsGoToView "Go to {label}" aria-label.
  render(<HelpContentPane lang="en-US" query="" onNavigateView={onNavigateView} />);
  const links = screen.getAllByRole("button", { name: /go to/i });
  expect(links.length).toBeGreaterThan(0);
  await userEvent.click(links[0]);
  expect(onNavigateView).toHaveBeenCalled();
});

// jsdom has no layout → the IntersectionObserver path is not exercised; we
// assert structure + click-active only.
test("renders a section element per help entry with the shared id", () => {
  const { container } = render(<HelpContentPane lang="en-US" query="" />);
  const first = HELP_ENTRIES[0];
  const sel =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? `#${CSS.escape(helpSectionId(first.id))}`
      : '[id^="help-sec-"]';
  expect(container.querySelector(sel)).toBeTruthy();
});

test("activates a TOC item on click", () => {
  render(<HelpContentPane lang="en-US" query="" />);
  const tocButtons = screen.getAllByRole("button");
  fireEvent.click(tocButtons[0]);
  // the clicked TOC button gets the active styling marker class
  expect(tocButtons[0].className).toContain("border-ui-dark-blue");
});
