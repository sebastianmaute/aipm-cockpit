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

  describe("collapsed flyout (#35)", () => {
    it("makes a collapsed parent-with-children a popover trigger", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      const dashboard = screen.getByRole("button", { name: "Dashboard" });
      expect(dashboard.getAttribute("aria-haspopup")).toBe("menu");
      expect(dashboard.getAttribute("aria-expanded")).toBe("false");
      // Children are NOT in the DOM until the flyout opens.
      expect(screen.queryByRole("menuitem", { name: /Next actions/i })).toBeNull();
    });

    it("opens a menu listing the parent + children, all reachable from the rail", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
      const menu = screen.getByRole("menu", { name: "Dashboard" });
      expect(menu).toBeTruthy();
      // Parent view is the first menuitem; a child (Next actions) is reachable.
      expect(screen.getByRole("menuitem", { name: "Dashboard" })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Next actions/i })).toBeTruthy();
    });

    it("navigates to a child and closes when a flyout item is chosen", () => {
      const onNavigate = vi.fn();
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={onNavigate} collapsed />);
      fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Next actions/i }));
      expect(onNavigate).toHaveBeenCalledWith("actions");
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("Escape closes the flyout and returns focus to the trigger", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      const trigger = screen.getByRole("button", { name: "Dashboard" });
      fireEvent.click(trigger);
      const menu = screen.getByRole("menu", { name: "Dashboard" });
      fireEvent.keyDown(menu, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("collapsed parent without children stays a plain nav button (no popup)", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      const gantt = screen.getByRole("button", { name: "Gantt" });
      expect(gantt.getAttribute("aria-haspopup")).toBeNull();
    });
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
