import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleButton } from "./toggle-button";
import { t } from "./i18n";

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
    expect(btn.className).not.toContain("bg-ui-pink/10");
    rerender(<ToggleButton pressed onToggle={() => {}} accent="pink">Critical path</ToggleButton>);
    btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-ui-pink/10");
    expect(btn.className).toContain("border-ui-pink");
  });

  it("defaults to the dark-blue accent", () => {
    render(<ToggleButton pressed onToggle={() => {}}>On</ToggleButton>);
    expect(screen.getByRole("button").className).toContain("bg-ui-dark-blue/10");
  });

  // ★★ The pressed state must not ride colour ALONE (WCAG 1.4.1). Asserted on
  //    the data attribute rather than a class, so a restyle of the marker does
  //    not fail this while dropping the cue itself would.
  it("marks the pressed state with a non-colour glyph, hidden but space-reserving when off", () => {
    const { container, rerender } = render(
      <ToggleButton pressed onToggle={() => {}}>Compact view</ToggleButton>,
    );
    const marker = () => container.querySelector("[data-pressed-marker]") as SVGElement;
    expect(marker()).toHaveAttribute("data-pressed-marker", "on");
    expect(marker().getAttribute("class") ?? "").not.toContain("invisible");

    rerender(<ToggleButton pressed={false} onToggle={() => {}}>Compact view</ToggleButton>);
    // Still in the DOM — removing it would change the button's width on every
    // click and shift the neighbouring toolbar controls under the pointer.
    expect(marker()).toHaveAttribute("data-pressed-marker", "off");
    expect(marker().getAttribute("class") ?? "").toContain("invisible");
  });

  // ★ There was a second test here asserting the marker stays out of the
  //   accessible name. It was DELETED as vacuous, and the reason is worth
  //   keeping: `CheckIcon` renders a bare `<path>`, so it can contribute
  //   nothing to name-from-content in any state, and heroicons defaults
  //   `aria-hidden` on every icon regardless of what this file passes. No
  //   single-change mutation could fail it. Don't re-add that shape.
  // ★ `disabled` was declared long before anything passed it. It must stay a real
  //   disabled <button> — clicking must not reach onToggle.
  it("does not fire onToggle while disabled", () => {
    const onToggle = vi.fn();
    render(<ToggleButton pressed={false} onToggle={onToggle} disabled>Auto</ToggleButton>);
    const btn = screen.getByRole("button", { name: "Auto" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
    // ★★ And it must LOOK inoperable. The whole point of the disabled styling is
    //    that this component accepted `disabled` for its entire life while
    //    rendering pixel-identically to a live toggle; without this assertion,
    //    deleting those two classes restores that exact defect with a green suite.
    expect(btn.className).toContain("disabled:opacity-60");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
  });

  // ★★ The suffix ends "click to turn on". On a disabled control that is an
  //    instruction it cannot honour, and it reaches AT as the accessible
  //    description, so browse mode announced "unavailable … click to turn on".
  it("drops the on/off tooltip suffix while disabled, keeping the base title", () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}} lang="en-US" title="Base" disabled>
        Auto
      </ToggleButton>,
    );
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("title", "Base");

    rerender(
      <ToggleButton pressed={false} onToggle={() => {}} lang="en-US" title="Base">Auto</ToggleButton>,
    );
    const enabled = screen.getByRole("button", { name: "Auto" }).getAttribute("title") ?? "";
    expect(enabled).toContain("Base");
    expect(enabled).toContain(t("en-US", "toggleStateOff"));
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
