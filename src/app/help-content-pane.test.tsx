import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test, vi } from "vitest";
import { HelpContentPane } from "./help-content-pane";
import { HELP_ENTRIES } from "./help-content";
import { loadI18n } from "./i18n";

beforeAll(async () => {
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
