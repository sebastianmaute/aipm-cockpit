import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { t } from "./i18n";
import { TopBar } from "./top-bar";

describe("TopBar", () => {
  const base = {
    lang: "en-US" as const,
    title: "Gantt",
    bannerCount: 0,
    onShowAlerts: () => {},
  };

  it("renders the view title", () => {
    render(<TopBar {...base} />);
    expect(screen.getByRole("heading", { name: "Gantt" })).toBeTruthy();
  });

  it("renders no New task button when no primaryAction is given", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByText(/new task/i)).toBeNull();
  });

  it("renders primaryAction when provided", () => {
    render(<TopBar {...base} primaryAction={<button type="button">Save</button>} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("shows the alert badge count when > 0", () => {
    render(<TopBar {...base} bannerCount={3} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("hides the alert badge when bannerCount is 0", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders a menu button that calls onToggleSidebar when provided", () => {
    const onToggleSidebar = vi.fn();
    render(<TopBar {...base} onToggleSidebar={onToggleSidebar} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(onToggleSidebar).toHaveBeenCalled();
  });

  it("omits the menu button when onToggleSidebar is not provided", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByRole("button", { name: "Open navigation menu" })).toBeNull();
  });

  it("renders primaryAction in place of the absent New-task button", () => {
    render(
      <TopBar
        lang="en-US"
        title="Editing task #5"
        bannerCount={0}
        onShowAlerts={() => {}}
        primaryAction={<button type="button">Save changes</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  });

  it("renders the AI Assistant button when onOpenAiAssistant is provided", () => {
    const onOpenAiAssistant = vi.fn();
    render(<TopBar {...base} onOpenAiAssistant={onOpenAiAssistant} />);
    expect(screen.getByRole("button", { name: "AI Assistant" })).toBeTruthy();
  });

  it("calls onOpenAiAssistant when the AI Assistant button is clicked", () => {
    const onOpenAiAssistant = vi.fn();
    render(<TopBar {...base} onOpenAiAssistant={onOpenAiAssistant} />);
    fireEvent.click(screen.getByRole("button", { name: "AI Assistant" }));
    expect(onOpenAiAssistant).toHaveBeenCalledOnce();
  });

  it("omits the AI Assistant button when onOpenAiAssistant is not provided", () => {
    render(<TopBar {...base} />);
    expect(screen.queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  // The three icon-only header actions go through the shared IconButton
  // primitive. `cursor-pointer` + `active:translate-y-px` come from
  // IconButton's BASE_CLASS + INTERACTIVE and appear on NO hand-rolled
  // `p-2` button in this file, so they discriminate primitive from bespoke.
  // (The focus ring does NOT discriminate — the hand-rolled ring was already
  // byte-identical to FOCUS_RING.)
  it.each(["sidebarMenuButton", "openAiAssistant", "showDueAlerts"] as const)(
    "renders the %s header action through the IconButton primitive",
    (key) => {
      render(<TopBar {...base} onToggleSidebar={vi.fn()} onOpenAiAssistant={vi.fn()} />);
      const btn = screen.getByRole("button", { name: t("en-US", key) });
      expect(btn.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
      expect(btn.className).toMatch(/(^|\s)active:translate-y-px(\s|$)/);
      // The accessible name and the hover title both survive the conversion.
      expect(btn).toHaveAttribute("title", t("en-US", key));
    },
  );

  // The badge is absolutely positioned against the alerts button, so that
  // button must keep its own positioning context through the conversion.
  it("keeps the alerts button as the count badge's positioning context", () => {
    render(<TopBar {...base} bannerCount={3} />);
    const alerts = screen.getByRole("button", { name: t("en-US", "showDueAlerts") });
    expect(alerts.className).toMatch(/(^|\s)relative(\s|$)/);
    expect(alerts).toContainElement(screen.getByText("3"));
  });

  it("renders AI Assistant button before the alerts button in DOM order", () => {
    const onOpenAiAssistant = vi.fn();
    render(<TopBar {...base} onOpenAiAssistant={onOpenAiAssistant} />);
    const buttons = screen.getAllByRole("button");
    const aiIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "AI Assistant");
    const alertIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "Show due-date notifications");
    expect(aiIdx).toBeGreaterThanOrEqual(0);
    expect(alertIdx).toBeGreaterThanOrEqual(0);
    expect(aiIdx).toBeLessThan(alertIdx);
  });

  it("lets the action cluster yield width so the search box cannot overlap its neighbour", () => {
    render(<TopBar {...base} search={<div data-testid="search" />} />);
    const cluster = screen.getByTestId("search").parentElement;
    // Without min-w-0 this cluster refuses to shrink (flex items default to
    // min-width:auto), so every pixel of pressure lands on the left cluster --
    // which is where the Ask Claude trigger lives.
    expect(cluster?.className).toContain("min-w-0");
  });
});

/**
 * Source scans over the TWO files that fill this bar's slots.
 *
 * ★★ NEITHER assertion below can be made by mounting TopBar: both live in the
 * CALLERS. `shell-chrome.tsx` (classic `AppHeader`) and `task-manager.tsx`
 * (modern `ModernShell`) each build their own search wrapper and hand it to
 * TopBar, and the Ask-Claude wrapper reaches `top-bar.tsx`'s left cluster as
 * the opaque `projectSwitcherTrailing` node. Mounting `TaskManager` to see
 * either one is both heavy and conditional (the Ask pill is gated on
 * `isAiEnabled`), so these read the source.
 *
 * ★★★ EVERY MATCH IS ASSERTED NON-EMPTY BEFORE ANYTHING IS COMPARED. A regex
 * that stops matching (a reformat, a renamed component) would otherwise make
 * the equality assertion compare two undefineds and PASS -- a guard that
 * reports success over the code it no longer reads. The exact-count assertions
 * do the same job in the other direction: a THIRD search mount added anywhere
 * in either file fails here rather than going silently unguarded.
 */
describe("top bar left/right cluster classes (source scan)", () => {
  const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

  // <div className="..."> IMMEDIATELY wrapping the search box. ★★ The separator
  // must be `\s*` (whitespace, newlines included) and never a lazy `[\s\S]*?`:
  // a lazy any-run lets the match START at any earlier <div className> in the
  // file and skip forward to the search box, which measurably captured
  // `flex flex-col gap-4` from a sidebar wrapper hundreds of lines up. That
  // mutant was caught only because the equality below is asserted against a
  // non-empty capture from each file.
  const SEARCH_WRAPPER = /<div className="([^"]*)">\s*<GlobalSearchConnected/g;

  function searchWrapperClasses(file: string): string[] {
    return [...read(file).matchAll(SEARCH_WRAPPER)].map((m) => m[1]);
  }

  it("keeps the classic and modern search wrappers byte-identical", () => {
    // The clipping fix had to touch BOTH mounts -- fixing one would have left
    // the other layout broken -- and nothing compared them. This is that
    // divergence guard, in both directions: whichever mount drifts, this fails.
    const classic = searchWrapperClasses("shell-chrome.tsx");
    const modern = searchWrapperClasses("task-manager.tsx");

    // Anti-vacuity: exactly one wrapper per file, and neither class list empty.
    expect(classic).toHaveLength(1);
    expect(modern).toHaveLength(1);
    expect(classic[0].length).toBeGreaterThan(0);
    expect(modern[0].length).toBeGreaterThan(0);

    expect(modern[0]).toBe(classic[0]);
    // And the shrink the fix turned on must actually be in the shared string,
    // so the two agreeing on a REVERTED value cannot read as green.
    expect(classic[0]).toContain("min-w-0");
  });

  // The modern shell's Ask-Claude flex child. `ask-claude-menu.test.tsx` pins
  // shrink-0 on the menu's own inner div.relative, which is the load-bearing
  // element in CLASSIC only -- `app-header.tsx` mounts the menu with no
  // wrapper. In MODERN the flex child of the left cluster is this span, and it
  // had no test at all.
  const ASK_SPAN = /<span data-tour-id=\{TOUR_ANCHORS\.askClaude\} className="([^"]*)">/g;

  it("keeps the modern Ask-Claude wrapper from being squeezed", () => {
    const matches = [...read("task-manager.tsx").matchAll(ASK_SPAN)];
    // Anti-vacuity: the span must be found, exactly once, with real classes.
    expect(matches).toHaveLength(1);
    const classes = matches[0][1];
    expect(classes.length).toBeGreaterThan(0);

    expect(classes).toContain("shrink-0");
  });
});
