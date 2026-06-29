import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpMenu } from "./help-menu";

function openPanel() {
  // The toggle button's accessible name is the translated "help" key ("Help").
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
}

describe("HelpMenu floating panel", () => {
  it("renders the toggle button when closed", () => {
    render(<HelpMenu lang="en-US" />);
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("opens a content-pane panel with a search box and grouped help content", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    // Grouped Help content renders (no tabs — content-pane only).
    expect(screen.getAllByText("Concepts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("filters content to the empty message on a no-match search", () => {
    render(<HelpMenu lang="en-US" />);
    openPanel();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzznomatchxyz" } });
    expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
  });
});
