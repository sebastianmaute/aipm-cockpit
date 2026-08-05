import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModernShell } from "./modern-shell";

function setup(over: Partial<React.ComponentProps<typeof ModernShell>> = {}) {
  const onNavigate = vi.fn();
  render(
    <ModernShell
      lang="en-US"
      activeView="open-points"
      onNavigate={onNavigate}
      version="v0.29.0"
      mode="advanced"
      bannerCount={0}
      onShowAlerts={() => {}}
      topBarMenus={<div data-testid="menus" />}
      sidebarFooter={null}
      tasksSection={<div data-testid="tasks" />}
      workspace={<div data-testid="workspace" />}
      {...over}
    />,
  );
  return { onNavigate };
}

describe("ModernShell", () => {
  it("shows the tasks section for the open-points view", () => {
    setup({ activeView: "open-points" });
    expect(screen.getByTestId("tasks")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("shows the workspace for other views", () => {
    setup({ activeView: "gantt" });
    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.queryByTestId("tasks")).toBeNull();
  });

  it("renders projectSwitcherTrailing (Ask-Claude) in the top bar's left cluster", () => {
    setup({ projectSwitcherTrailing: <div data-testid="ask-claude-slot" /> });
    expect(screen.getByTestId("ask-claude-slot")).toBeTruthy();
  });

  it("navigates when a sidebar item is clicked", () => {
    const { onNavigate } = setup({ activeView: "open-points" });
    fireEvent.click(screen.getByRole("button", { name: "RAID" }));
    expect(onNavigate).toHaveBeenCalledWith("raid");
  });

  it("uses the active view's label as the top-bar title", () => {
    setup({ activeView: "gantt" });
    expect(screen.getByRole("heading", { name: "Gantt" })).toBeTruthy();
  });

  it("announces the active view via a polite live region (#26)", () => {
    // A visually-hidden role=status region carries the view label so screen
    // readers hear the view change (only aria-current moves otherwise).
    setup({ activeView: "gantt" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Gantt");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.className).toContain("sr-only");
  });

  it("forwards collapsed to the sidebar (brand subtitle hidden, expand button shown)", () => {
    setup({ collapsed: true });
    expect(screen.queryByText("PROJECT MANAGEMENT TRACKER")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("renders a skip-to-content link targeting the main region", () => {
    setup();
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe("#main-content");
    expect(document.getElementById("main-content")).not.toBeNull();
  });

  it("calls onToggleCollapsed when the sidebar collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    setup({ collapsed: false, onToggleCollapsed });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });
});

describe("ModernShell cross-view focus (#48)", () => {
  function baseProps(
    over: Partial<React.ComponentProps<typeof ModernShell>> = {},
  ): React.ComponentProps<typeof ModernShell> {
    return {
      lang: "en-US",
      activeView: "open-points",
      onNavigate: vi.fn(),
      version: "v0.29.0",
      mode: "advanced",
      bannerCount: 0,
      onShowAlerts: () => {},
      topBarMenus: <div data-testid="menus" />,
      sidebarFooter: null,
      tasksSection: <div data-testid="tasks" />,
      workspace: <div data-testid="workspace" />,
      ...over,
    };
  }

  it("marks the main region programmatically focusable and does not steal focus on first mount", () => {
    setup({ activeView: "open-points" });
    const main = document.getElementById("main-content");
    // tabIndex=-1 makes it script-focusable but not tab-reachable.
    expect(main).toHaveAttribute("tabindex", "-1");
    // Initial mount must NOT yank focus into main (would fight the skip link).
    expect(document.activeElement).not.toBe(main);
  });

  it("moves keyboard focus to the main region when the active view changes (WCAG 2.4.3)", () => {
    const { rerender } = render(<ModernShell {...baseProps({ activeView: "open-points" })} />);
    const main = document.getElementById("main-content");
    expect(document.activeElement).not.toBe(main);
    rerender(<ModernShell {...baseProps({ activeView: "raid" })} />);
    // On navigation, focus follows the swapped content so keyboard/SR users
    // don't stay parked on the sidebar nav item.
    expect(document.activeElement).toBe(main);
  });

  it("does not re-focus main when the same view re-renders", () => {
    const { rerender } = render(<ModernShell {...baseProps({ activeView: "raid" })} />);
    const main = document.getElementById("main-content");
    // Move focus elsewhere, then re-render the SAME view (e.g. a data update).
    (document.body as HTMLElement).focus();
    rerender(<ModernShell {...baseProps({ activeView: "raid", bannerCount: 3 })} />);
    expect(document.activeElement).not.toBe(main);
  });
});

describe("ModernShell mobile drawer (#25)", () => {
  // ★★★ MUST be restorable. This used to be a bare `window.matchMedia = vi.fn()`
  //     assignment, which no mock-lifecycle call can undo: `clearAllMocks` and
  //     `restoreAllMocks` do nothing to a plain property write, and jsdom ships
  //     no `matchMedia` for anything to restore it to. So after the first test
  //     here ran, EVERY later test in the file saw a narrow viewport, ModernShell
  //     rendered the mobile drawer instead of the in-flow sidebar, and the
  //     sidebar's buttons ("RAID", "Collapse sidebar", "Expand sidebar") were
  //     simply absent. It stayed invisible in DECLARATION order only by
  //     coincidence, not because this describe is last (it isn't — "settings
  //     slot" and "banners slot" both follow it): the last `it` in this
  //     describe stubs `matches: false`, the wide/desktop value the two
  //     trailing describes happen to need anyway. Adding a test here, or
  //     reordering the ones already here, would have broken them with no
  //     shuffle flag involved. It reproduces reliably under
  //     `--sequence.shuffle --sequence.seed=1`, which runs this describe
  //     first. See open-followups §75.
  function stubViewport(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  // Restores `matchMedia` to its pre-stub state (absent, under jsdom), so the
  // viewport cannot leak into another test. Do NOT replace this with a manual
  // re-assignment — `window.matchMedia = undefined` is a type error and leaves
  // the property defined-but-undefined rather than absent.
  // ★★ TWO caveats for whoever edits this file next:
  //   1. `vi.unstubAllGlobals()` is FILE-WIDE, not describe-scoped. It is safe
  //      today only because this describe is the file's sole stubber; a future
  //      file-level `beforeAll(() => vi.stubGlobal(...))` would be torn down by
  //      the first test here and stay gone for the rest of the run.
  //   2. Restoring matchMedia to ABSENT is safe for the current consumers
  //      because `use-media-query.ts` guards `!window.matchMedia` — but
  //      `use-theme.tsx` calls `window.matchMedia(...)` behind only a
  //      `typeof window` check, so a test added to this file that renders the
  //      theme provider would THROW. ★ Precisely: the teardown does not CAUSE
  //      that — jsdom ships no `matchMedia` at all, so such a test throws in this
  //      file regardless of position; the teardown merely restores that
  //      pre-existing absence instead of leaving a stub lying around. Stub it in
  //      that test rather than deleting this afterEach.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an off-canvas dialog drawer from the hamburger on a narrow viewport", () => {
    stubViewport(true); // matches SIDEBAR_NARROW_QUERY → mobile
    setup({ activeView: "gantt" });
    // Closed initially: no drawer dialog.
    expect(screen.queryByRole("dialog", { name: "Primary" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const drawer = screen.getByRole("dialog", { name: "Primary" });
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute("aria-modal", "true");
  });

  it("closes the drawer when the backdrop is clicked", () => {
    stubViewport(true);
    const { container } = render(
      <ModernShell
        lang="en-US"
        activeView="gantt"
        onNavigate={vi.fn()}
        version="v0.29.0"
        mode="advanced"
        bannerCount={0}
        onShowAlerts={() => {}}
        topBarMenus={<div />}
        sidebarFooter={null}
        tasksSection={<div />}
        workspace={<div data-testid="workspace" />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog", { name: "Primary" })).toBeInTheDocument();
    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0') as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog", { name: "Primary" })).toBeNull();
  });

  it("closes the drawer when a nav item inside it is chosen", () => {
    stubViewport(true);
    const onNavigate = vi.fn();
    setup({ activeView: "gantt", onNavigate });
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    // The drawer renders the EXPANDED sidebar → a labelled nav button (RAID).
    fireEvent.click(screen.getByRole("button", { name: "RAID" }));
    expect(onNavigate).toHaveBeenCalledWith("raid");
    expect(screen.queryByRole("dialog", { name: "Primary" })).toBeNull();
  });

  it("labels the drawer's toggle as a close action, not 'Collapse sidebar' (#25)", () => {
    stubViewport(true);
    setup({ activeView: "gantt" });
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    // The drawer's toggle acts as the dialog's close — its accessible name says so.
    expect(screen.getByRole("button", { name: "Close navigation menu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
  });

  it("keeps the in-flow sidebar (no dialog) on a wide viewport", () => {
    stubViewport(false); // desktop
    setup({ activeView: "gantt" });
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    // On desktop the hamburger toggles the collapse rail, not a drawer.
    expect(screen.queryByRole("dialog", { name: "Primary" })).toBeNull();
  });
});

describe("ModernShell settings slot", () => {
  it("renders settingsView in main when activeView === 'settings'", () => {
    setup({
      activeView: "settings",
      settingsView: <div>settings-page</div>,
    });
    expect(screen.getByText("settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });
});

describe("ModernShell banners slot", () => {
  it("renders banners at the top of the main content region", () => {
    setup({ banners: <div data-testid="banners" /> });
    const main = document.getElementById("main-content");
    const banners = screen.getByTestId("banners");
    expect(banners).toBeInTheDocument();
    expect(main?.contains(banners)).toBe(true);
    // Banners come before the view content in DOM order.
    const tasks = screen.getByTestId("tasks");
    expect(banners.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders banners on the settings view too (all views)", () => {
    setup({
      activeView: "settings",
      settingsView: <div data-testid="settings-page" />,
      banners: <div data-testid="banners" />,
    });
    expect(screen.getByTestId("banners")).toBeInTheDocument();
  });
});
