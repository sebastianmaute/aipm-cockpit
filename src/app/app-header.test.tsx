import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "./i18n";
import type React from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { WorkspaceProvider } from "./workspace-context";
import { AppHeader } from "./app-header";
import type { AppHeaderProps } from "./app-header";
import { defaultSettings } from "./settings-types";

function makeProps(overrides: Partial<AppHeaderProps> = {}): AppHeaderProps {
  return {
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    bannerCount: 0,
    onShowAlerts: vi.fn(),
    showToast: vi.fn(),
    handleCommand: vi.fn(),
    storageDescription: null,
    storageReady: true,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined),
    onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantStorageWrite: vi.fn().mockResolvedValue(undefined),
    onRequestStorageSwitch: vi.fn(),
    settings: defaultSettings,
    setSettings: () => {},
    lang: "en-US",
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("AppHeader", () => {
  it("renders the app title heading", () => {
    render(<AppHeader {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders the AI Assistant button when onOpenAiAssistant is provided", () => {
    render(<AppHeader {...makeProps({ onOpenAiAssistant: vi.fn() })} />, { wrapper: Wrapper });
    expect(screen.getByRole("button", { name: "AI Assistant" })).toBeInTheDocument();
  });

  it("calls onOpenAiAssistant when the AI Assistant button is clicked", () => {
    const onOpenAiAssistant = vi.fn();
    render(<AppHeader {...makeProps({ onOpenAiAssistant })} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: "AI Assistant" }));
    expect(onOpenAiAssistant).toHaveBeenCalledOnce();
  });

  it("omits the AI Assistant button when onOpenAiAssistant is not provided", () => {
    render(<AppHeader {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: "AI Assistant" })).toBeNull();
  });

  it("renders AI Assistant button before Add Task button in DOM order", () => {
    render(<AppHeader {...makeProps({ onOpenAiAssistant: vi.fn() })} />, { wrapper: Wrapper });
    const buttons = screen.getAllByRole("button");
    const aiIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "AI Assistant");
    const addIdx = buttons.findIndex((b) => b.getAttribute("aria-label") === "Add task");
    expect(aiIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(aiIdx).toBeLessThan(addIdx);
  });

  // The three icon-only header actions go through the shared IconButton
  // primitive. `cursor-pointer` + `active:translate-y-px` come from
  // IconButton's BASE_CLASS + INTERACTIVE and appear on NO hand-rolled
  // `p-2` button in this file, so they discriminate primitive from bespoke.
  // (The focus ring does NOT discriminate — the hand-rolled ring was already
  // byte-identical to FOCUS_RING.)
  it.each(["openAiAssistant", "addTaskButton", "showDueAlerts"] as const)(
    "renders the %s header action through the IconButton primitive",
    (key) => {
      render(<AppHeader {...makeProps({ onOpenAiAssistant: vi.fn() })} />, { wrapper: Wrapper });
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
    render(<AppHeader {...makeProps({ bannerCount: 2 })} />, { wrapper: Wrapper });
    const alerts = screen.getByRole("button", { name: t("en-US", "showDueAlerts") });
    expect(alerts.className).toMatch(/(^|\s)relative(\s|$)/);
    expect(alerts).toContainElement(screen.getByText("2"));
  });

  it("renders the Ask-Claude menu when currentView and onAskClaude are provided", () => {
    render(<AppHeader {...makeProps({ currentView: "raid", onAskClaude: vi.fn() })} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByRole("button", { name: t("en-US", "aiAskClaude") })).toBeTruthy();
  });

  it("omits the Ask-Claude menu when not wired", () => {
    render(<AppHeader {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.queryByRole("button", { name: t("en-US", "aiAskClaude") })).toBeNull();
  });

  it("bell badge shows count when bannerCount is positive", () => {
    render(<AppHeader {...makeProps({ bannerCount: 2 })} />, { wrapper: Wrapper });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onShowAlerts when the bell button is clicked", () => {
    const onShowAlerts = vi.fn();
    render(<AppHeader {...makeProps({ onShowAlerts })} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole("button", { name: /show due-date notifications/i }));
    expect(onShowAlerts).toHaveBeenCalledOnce();
  });
});
