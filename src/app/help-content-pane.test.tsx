import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test, vi } from "vitest";
import { HelpContentPane, helpSectionId } from "./help-content-pane";
import { HELP_ENTRIES } from "./help-content";
import { loadI18n, t } from "./i18n";
import { stripHelpMarkers } from "./help-body-markup";

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

// ★ Searching the RAW body lets a query match `[[` markup the user never sees.
// Searching the STRIPPED body must still find the label's own words.
test("strips markers before matching so markup is unsearchable", () => {
  const body = "Click [[Take the tour]] below.";
  expect(stripHelpMarkers(body)).toBe("Click Take the tour below.");
  expect(stripHelpMarkers(body)).not.toContain("[[");
});

// ★★ A property over the WHOLE rendered pane, not one entry: no help body may
// ever show bracket markup to a user. It passes trivially until the first
// marker lands, and becomes load-bearing the moment one does — Task 9 Step 5
// of the plan breaks a marker to prove this can actually fail.
test("renders a marked label as styled text, never as raw brackets", () => {
  render(<HelpContentPane lang="en-US" query="" />);
  expect(screen.queryByText(/\[\[/)).toBeNull();
  expect(screen.queryByText(/\]\]/)).toBeNull();
});

// ★ Asserts the rendered SEQUENCE, not mere presence. A presence assertion
// ("all four groups appear") passes against the unchanged order and proves
// nothing about the reorder — vacuous by construction.
function groupHeadingOrder(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent ?? "");
}

test("Standard renders the teaching-first group order", () => {
  render(<HelpContentPane lang="en-US" query="" readingLevel="standard" />);
  expect(groupHeadingOrder()).toEqual([
    t("en-US", "helpGroupConcepts"),
    t("en-US", "helpGroupWorkflows"),
    t("en-US", "helpGroupFeatures"),
    t("en-US", "helpGroupAutomated"),
  ]);
});

test("Expert renders the reference-first group order", () => {
  render(<HelpContentPane lang="en-US" query="" readingLevel="expert" />);
  expect(groupHeadingOrder()).toEqual([
    t("en-US", "helpGroupFeatures"),
    t("en-US", "helpGroupAutomated"),
    t("en-US", "helpGroupWorkflows"),
    t("en-US", "helpGroupConcepts"),
  ]);
});

test("omitting readingLevel keeps today's order", () => {
  render(<HelpContentPane lang="en-US" query="" />);
  expect(groupHeadingOrder()[0]).toBe(t("en-US", "helpGroupConcepts"));
});

// A phrase that exists ONLY in a concept primer, never in a body — so a match
// proves the primer was searched, not that the query happened to hit the body.
const PRIMER_ONLY_PHRASE = "circle on a calendar";

test("a primer renders at Guided", () => {
  render(<HelpContentPane lang="en-US" query="" readingLevel="guided" />);
  expect(screen.getByText(new RegExp(PRIMER_ONLY_PHRASE, "i"))).toBeInTheDocument();
});

test("a primer is absent at Standard and at Expert", () => {
  const { unmount } = render(<HelpContentPane lang="en-US" query="" readingLevel="standard" />);
  expect(screen.queryByText(new RegExp(PRIMER_ONLY_PHRASE, "i"))).toBeNull();
  unmount();
  render(<HelpContentPane lang="en-US" query="" readingLevel="expert" />);
  expect(screen.queryByText(new RegExp(PRIMER_ONLY_PHRASE, "i"))).toBeNull();
});

// ★★ Search follows what is RENDERED. Matching text the user cannot see is the
// same defect that made the search body marker-stripped, so a primer is
// searchable exactly at the level that shows it. The consequence is deliberate:
// the same query finds a different number of entries at different levels.
test("primer text is searchable at Guided and not at Standard", () => {
  const { unmount } = render(
    <HelpContentPane lang="en-US" query={PRIMER_ONLY_PHRASE} readingLevel="guided" />,
  );
  expect(screen.queryByText(/no matching help/i)).toBeNull();
  expect(screen.getAllByRole("heading", { level: 2 }).length).toBe(1);
  unmount();
  render(<HelpContentPane lang="en-US" query={PRIMER_ONLY_PHRASE} readingLevel="standard" />);
  expect(screen.queryAllByRole("heading", { level: 2 }).length).toBe(0);
});
