import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { ChatPromptChips, PROMPT_CHIPS } from "./chat-prompt-chips";
import { loadI18n } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";

beforeAll(async () => {
  await loadI18n("de");
});

describe("ChatPromptChips", () => {
  it("renders a labelled suggested-prompts list with at least one chip", () => {
    render(<ChatPromptChips lang="en-US" onPick={vi.fn()} />);
    const list = screen.getByRole("list", { name: /suggested prompts/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("calls onPick with the chip body and autoSend flag when a chip is clicked", () => {
    const onPick = vi.fn();
    render(<ChatPromptChips lang="en-US" onPick={onPick} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(typeof onPick.mock.calls[0][0]).toBe("string");
    expect(typeof onPick.mock.calls[0][1]).toBe("boolean");
  });

  it("translates the list's accessible name under German", () => {
    render(<ChatPromptChips lang="de" onPick={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Vorgeschlagene Prompts" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Suggested prompts" })).not.toBeInTheDocument();
  });

  // §672: each chip is named by its translated label, so two prompts worded alike would make two
  // chips sound identical. The German case above already pins that the de dictionary loaded.
  it.each(["en-US", "de"] as const)("names every chip distinctly in %s (§672)", (lang) => {
    render(<ChatPromptChips lang={lang} onPick={vi.fn()} />);
    expectRowUniqueNames({ minControls: PROMPT_CHIPS.length });
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("ChatPromptChips on the shared Button", () => {
  it("draws every prompt chip as secondary xs", () => {
    render(<ChatPromptChips lang="en-US" onPick={vi.fn()} />);
    const chips = screen.getAllByRole("button");
    expect(chips.length).toBe(PROMPT_CHIPS.length);
    for (const chip of chips) expect(chip.className).toBe(buttonClassFor({ variant: "secondary", size: "xs" }));
  });
});
