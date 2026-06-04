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

test("typing in the search box filters the section list", async () => {
  const user = await openHelp();
  const search = await screen.findByPlaceholderText("Search help");
  await user.type(search, "keyboard");
  const tabs = screen.getAllByRole("tab");
  expect(tabs.length).toBeGreaterThan(0);
  expect(tabs.length).toBeLessThan(15); // fewer than all sections
});

test("no-results state when nothing matches", async () => {
  const user = await openHelp();
  await user.type(await screen.findByPlaceholderText("Search help"), "zzzznotfound");
  expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
});
