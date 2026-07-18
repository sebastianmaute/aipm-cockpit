import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleButton } from "./toggle-button";

describe("ToggleButton", () => {
  it("exposes aria-pressed tracking the pressed prop and the visible label as its name", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}}>Inline milestones</ToggleButton>,
    );
    const btn = screen.getByRole("button", { name: "Inline milestones" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("type", "button");
    rerender(<ToggleButton pressed onToggle={() => {}}>Inline milestones</ToggleButton>);
    expect(screen.getByRole("button", { name: "Inline milestones" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onToggle on click", () => {
    const onToggle = vi.fn();
    render(<ToggleButton pressed={false} onToggle={onToggle}>X</ToggleButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("applies the accent tint only when pressed", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}} accent="pink">Critical path</ToggleButton>,
    );
    let btn = screen.getByRole("button");
    expect(btn.className).toContain("border-line");
    expect(btn.className).not.toContain("bg-AIPM-pink/10");
    rerender(<ToggleButton pressed onToggle={() => {}} accent="pink">Critical path</ToggleButton>);
    btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-AIPM-pink/10");
    expect(btn.className).toContain("border-AIPM-pink");
  });

  it("defaults to the dark-blue accent", () => {
    render(<ToggleButton pressed onToggle={() => {}}>On</ToggleButton>);
    expect(screen.getByRole("button").className).toContain("bg-AIPM-dark-blue/10");
  });

  it("renders a leading icon and an override aria-label", () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}} ariaLabel="Detailed planning" icon={<svg data-testid="ic" aria-hidden />}>
        Detailed
      </ToggleButton>,
    );
    expect(screen.getByTestId("ic")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detailed planning" })).toBeInTheDocument();
  });
});
