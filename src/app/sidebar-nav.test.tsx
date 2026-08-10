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

    // ★★★ The flyout MUST NOT live inside the sidebar's scroll box. `sidebar.tsx`
    // wraps the nav in `overflow-y-auto`, and per CSS spec a non-visible Y axis
    // makes the X axis `auto` too — so that div is a 64px-wide HORIZONTAL scroll
    // box when collapsed. An `absolute left-full` panel lays out at x 68..244,
    // entirely outside it; z-index cannot escape overflow, and the on-open
    // `.focus()` then scrolls the box sideways to chase the focused menuitem,
    // dragging the icon rail out of view and shearing the labels ("esources",
    // "irectory"). Portaling is the only fix — `position: fixed` on a body child
    // is not clipped by an ancestor's overflow.
    it("portals the flyout out of the sidebar, so no ancestor overflow can clip it", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
      const menu = screen.getByRole("menu", { name: "Dashboard" });
      // Not a descendant of the nav → not inside sidebar.tsx's overflow box.
      expect(menu.closest("nav")).toBeNull();
      // The positioned layer is a direct child of body and is `fixed`, not
      // `absolute` — an absolute portal child would be clipped all the same.
      const layer = menu.parentElement;
      expect(layer?.parentElement).toBe(document.body);
      expect(layer).toHaveClass("fixed");
      // ★★★ Assert on the LAYER, not on `menu`. A review caught the obvious
      // spelling — `expect(menu.className).not.toContain("absolute")` — as
      // vacuous: the inner `<div role="menu">` carries NO className at all, so
      // it passed trivially and would have gone on passing if the panel
      // regressed to `absolute`, because the class would land on the parent.
      expect(layer?.className).not.toContain("absolute");
    });

    // ★★★ Tab must LAND somewhere, and the portal is why. Pre-portal, closing
    // without moving focus was survivable: the menu was an `absolute` child of
    // the trigger's `<li>`, so the browser resumed sequential navigation at the
    // next rail button. The panel now sits at the END of `document.body`, so
    // resuming from there walks out of the app entirely (WCAG 2.4.3).
    // ★★ jsdom implements no sequential focus navigation, so no unit test can
    // observe where Tab would actually go — this pins the INTENT (focus is put
    // back on the trigger) which is the part the component controls.
    it("Tab closes the flyout and returns focus to the trigger", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      const trigger = screen.getByRole("button", { name: "Dashboard" });
      fireEvent.click(trigger);
      fireEvent.keyDown(screen.getByRole("menu", { name: "Dashboard" }), { key: "Tab" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    // The flyout's focus-on-open rests entirely on `PopoverPanel`'s all-roving
    // `??` fallback, since every menuitem here is `tabIndex={-1}`. That fallback
    // had no shipped consumer until this component became one, so pin it here:
    // if it were dropped, nothing would be focused and the user's next Tab would
    // leave the portal.
    it("moves focus into the flyout on open", () => {
      render(<SidebarNav lang="en-US" activeView="open-points" onNavigate={() => {}} collapsed />);
      fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
      const items = screen.getAllByRole("menuitem");
      expect(document.activeElement).toBe(items[0]);
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
