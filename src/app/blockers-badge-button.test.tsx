import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BlockersBadgeButton } from "./blockers-badge-button";
import { TIER_RAG } from "./next-actions/action-cta";
import { t } from "./i18n";

const EN = "en-US" as const;

/** The badge's only decorative child is the `Dot` atom (aria-hidden). */
function dotOf(button: HTMLElement): Element {
  const dots = button.querySelectorAll("[aria-hidden]");
  expect(dots).toHaveLength(1);
  return dots[0];
}

describe("BlockersBadgeButton", () => {
  it("badge shows the open count and a red dot", () => {
    const onClick = vi.fn();
    render(<BlockersBadgeButton openCount={2} entityName="Draft charter" lang={EN} onClick={onClick} />);
    const button = screen.getByRole("button", { name: t(EN, "blockerBadgeLabel", "Draft charter", 2) });
    expect(button.textContent).toBe("2");
    // The tier colour rides the DOT, never the text (AGENTS.md contrast rule).
    expect(dotOf(button).className).toContain(TIER_RAG.now.dot);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("badge with none open is muted and shows no number", () => {
    render(<BlockersBadgeButton openCount={0} entityName="Clean task" lang={EN} onClick={vi.fn()} />);
    const button = screen.getByRole("button", { name: t(EN, "blockerBadgeLabel", "Clean task", 0) });
    expect(button.textContent).toBe("");
    expect(dotOf(button).className).not.toContain(TIER_RAG.now.dot);
  });

  // Row uniqueness is the CALLER's job (the row token is the entityName) and is
  // pinned in task-row.test.tsx's collision test; this file pins label-in-name.
  it("badge name contains the visible count (WCAG 2.5.3)", () => {
    render(<BlockersBadgeButton openCount={3} entityName="Alpha" lang={EN} onClick={vi.fn()} />);
    const button = screen.getByRole("button");
    const visible = (button.textContent ?? "").trim();
    expect(visible).toBe("3");
    expect((button.getAttribute("aria-label") ?? "").toLowerCase()).toContain(visible.toLowerCase());
  });
});
