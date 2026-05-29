import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./sidebar-nav";

describe("SidebarNav", () => {
  it("renders group headers and a top-level item", () => {
    render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} />);
    expect(screen.getByText("OVERVIEW")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Points" })).toBeTruthy();
  });

  it("calls onNavigate with the view id when an item is clicked", () => {
    const onNavigate = vi.fn();
    render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Gantt" }));
    expect(onNavigate).toHaveBeenCalledWith("gantt");
  });

  it("marks the active item with aria-current", () => {
    render(<SidebarNav lang="en-US" activeView="gantt" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Gantt" }).getAttribute("aria-current")).toBe("page");
  });

  it("reveals child items when a parent is active", () => {
    render(<SidebarNav lang="en-US" activeView="resources" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Address Book" })).toBeTruthy();
  });
});
