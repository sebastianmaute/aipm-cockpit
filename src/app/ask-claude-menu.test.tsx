import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AskClaudeMenu } from "./ask-claude-menu";
import { ASK_CLAUDE_PROMPTS, promptsForView } from "./ask-claude-prompts";
import type { AppView } from "./nav-config";
import { loadI18n, t } from "./i18n";
import { menuItemClass } from "./control-classes";
import { expectRowUniqueNames } from "../test/row-unique-names";

afterEach(cleanup);

describe("AskClaudeMenu", () => {
  it("trigger is labelled and advertises a popup", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    const trigger = screen.getByRole("button", { name: t("en-US", "aiAskClaude") });
    expect(trigger).toHaveAttribute("aria-haspopup");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens to show on-page (RAID) and general sections", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    expect(screen.getByText(t("en-US", "aiAskClaudeOnPage"))).toBeTruthy();
    expect(screen.getByText(t("en-US", "aiAskClaudeGeneral"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("en-US", "aiPromptRaidTopLabel") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("en-US", "aiPromptWhatsNextLabel") })).toBeTruthy();
  });

  it("picking a prompt calls onAsk with the translated body and closes", () => {
    const onAsk = vi.fn();
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiPromptRaidTopLabel") }));
    expect(onAsk).toHaveBeenCalledWith(t("en-US", "aiPromptRaidTopBody"));
    expect(screen.queryByText(t("en-US", "aiAskClaudeGeneral"))).toBeNull();
  });

  it("omits the on-page section when the view has no curated prompts", () => {
    render(<AskClaudeMenu lang="en-US" currentView="settings" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    expect(screen.queryByText(t("en-US", "aiAskClaudeOnPage"))).toBeNull();
    expect(screen.getByText(t("en-US", "aiAskClaudeGeneral"))).toBeTruthy();
  });

  it("Escape closes the menu", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(t("en-US", "aiAskClaudeGeneral"))).toBeNull();
  });

  it("pins the trigger so it can never be squeezed below its label", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    const trigger = screen.getByRole("button", { name: t("en-US", "aiAskClaude") });
    // The positioned wrapper must refuse to shrink: the top bar's left cluster
    // carries min-w-0, so without this the trigger is compressed below its
    // min-content width and its box overflows the cluster into the search field.
    expect(trigger.parentElement?.className).toContain("shrink-0");
    // And the label must never wrap to a second line.
    const label = trigger.querySelector("span");
    expect(label?.className).toContain("whitespace-nowrap");
  });

  it("drops to icon-only below xl (1280) while keeping its accessible name", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    const trigger = screen.getByRole("button", { name: t("en-US", "aiAskClaude") });
    const label = trigger.querySelector("span");
    expect(label?.className).toContain("hidden");
    // xl, not lg: at 1024-1200 the label's ~70px kept the left cluster wider
    // than its allotment, pushing this pill under the opaque search input.
    expect(label?.className).toContain("xl:inline");
    // The name comes from aria-label, so hiding the text costs AT nothing --
    // getByRole above already proves the name survives.
    expect(trigger).toHaveAttribute("aria-label", t("en-US", "aiAskClaude"));
  });
});

describe("AskClaudeMenu — every prompt button has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each prompt button is named by its translated label, and a view's on-page prompts render beside
  // the general set, so an on-page label worded like a general one would make two buttons sound
  // identical. Checked for every view that carries on-page prompts, in every shipped language.
  const VIEWS = Object.keys(ASK_CLAUDE_PROMPTS) as AppView[];

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "aiAskClaudeGeneral")).not.toBe(t("en-US", "aiAskClaudeGeneral"));
  });

  it.each(["en-US", "de"] as const)("names every prompt distinctly in every view in %s", (lang) => {
    expect(VIEWS.length).toBeGreaterThan(5);
    for (const view of VIEWS) {
      const { unmount } = render(<AskClaudeMenu lang={lang} currentView={view} onAsk={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: t(lang, "aiAskClaude") }));
      const { onPage, general } = promptsForView(view);
      expectRowUniqueNames({ minControls: onPage.length + general.length, scope: screen.getByRole("dialog") });
      unmount();
    }
  });
});

// §102 re-scan: the prompt rows hand-rolled a menu row at their own padding
// and colour; they take the shared menu-item class (§692).
describe("AskClaudeMenu — prompt rows are shared menu items (§102)", () => {
  it("draws every prompt row with menuItemClass()", () => {
    render(<AskClaudeMenu lang="en-US" currentView="raid" onAsk={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiAskClaude") }));
    const rows = [
      screen.getByRole("button", { name: t("en-US", "aiPromptRaidTopLabel") }),
      screen.getByRole("button", { name: t("en-US", "aiPromptWhatsNextLabel") }),
    ];
    for (const row of rows) expect(row.className).toBe(menuItemClass());
  });
});
