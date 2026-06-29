import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { HelpMenu } from "./help-menu";

async function openHelp() {
  const user = userEvent.setup();
  render(<HelpMenu lang="en-US" />);
  await user.click(screen.getByRole("button", { name: /help/i }));
  return user;
}

test("typing in the search box narrows the rendered topics", async () => {
  const user = await openHelp();
  const search = await screen.findByPlaceholderText("Search help");
  const before = screen.getAllByRole("heading").length;
  await user.type(search, "milestone");
  const after = screen.getAllByRole("heading").length;
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

test("no-results state when nothing matches", async () => {
  const user = await openHelp();
  await user.type(await screen.findByPlaceholderText("Search help"), "zzzznotfound");
  expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
});

test("does not render the AI usage policy link", async () => {
  await openHelp();
  // The shared HelpContentPane renders AI-feature body text that mentions the
  // "AI usage policy" phrase, so we assert specifically that no usage-policy
  // LINK is rendered in the footer (the link was removed in a prior change).
  expect(screen.queryByRole("link", { name: /usage policy/i })).toBeNull();
});
