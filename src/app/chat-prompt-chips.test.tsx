import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatPromptChips } from "./chat-prompt-chips";

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
});
