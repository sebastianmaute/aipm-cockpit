import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./sidebar-nav";
import { filterNavGroups } from "./nav-config";

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
    expect(screen.getByRole("button", { name: "Directory" })).toBeTruthy();
  });

  it("reveals sibling child items when a child is the active view", () => {
    render(<SidebarNav lang="en-US" activeView="directory" onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: "Directory" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Workload" })).toBeTruthy();
  });

  it("collapsed rail shows icon-only buttons that keep an accessible name", () => {
    render(
      <SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />,
    );
    // Group header text is hidden when collapsed.
    expect(screen.queryByText("OVERVIEW")).toBeNull();
    // The item keeps its accessible name via aria-label even with no visible text.
    const gantt = screen.getByRole("button", { name: "Gantt" });
    expect(gantt.getAttribute("aria-label")).toBe("Gantt");
    expect(gantt.querySelector("svg")).not.toBeNull();
  });

  it("expanded items render both an icon and the visible label", () => {
    render(
      <SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} />,
    );
    const gantt = screen.getByRole("button", { name: "Gantt" });
    expect(gantt.querySelector("svg")).not.toBeNull();
    expect(gantt.textContent).toContain("Gantt");
  });

  it("renders only the provided (filtered) groups", () => {
    render(
      <SidebarNav
        lang="en-US"
        activeView="open-points"
        onNavigate={() => {}}
        navGroups={filterNavGroups([])}
      />,
    );
    expect(screen.getByRole("button", { name: /AI Assistant/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^RAID$/i })).toBeNull();
  });

  describe("badges", () => {
    it("shows a pill with the count when badges has a positive value for a view", () => {
      render(<SidebarNav lang="en-US" activeView="dashboard" onNavigate={() => {}} badges={{ actions: 3 }} />);
      expect(screen.getByText("3")).toBeTruthy();
    });

    it("does not render a pill when the count is 0", () => {
      render(<SidebarNav lang="en-US" activeView="dashboard" onNavigate={() => {}} badges={{ actions: 0 }} />);
      expect(screen.queryByText("0")).toBeNull();
    });

    it("does not render a pill when badges prop is omitted", () => {
      render(<SidebarNav lang="en-US" activeView="dashboard" onNavigate={() => {}} />);
      expect(screen.queryByText("3")).toBeNull();
    });

    it("does not render the pill when the sidebar is collapsed", () => {
      render(<SidebarNav lang="en-US" activeView="dashboard" onNavigate={() => {}} collapsed badges={{ actions: 5 }} />);
      expect(screen.queryByText("5")).toBeNull();
    });
  });
});
