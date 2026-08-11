import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolbarButton } from "./rich-text-toolbar-button";

describe("ToolbarButton", () => {
  it("renders its children and fires onClick", async () => {
    const onClick = vi.fn();
    render(
      <ToolbarButton onClick={onClick} ariaLabel="Bold">
        <span>icon</span>
      </ToolbarButton>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to no aria state attribute", () => {
    render(
      <ToolbarButton onClick={() => {}} ariaLabel="Insert link">
        <span>icon</span>
      </ToolbarButton>,
    );
    const btn = screen.getByRole("button", { name: "Insert link" });
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
    expect(btn.hasAttribute("aria-expanded")).toBe(false);
  });

  it("reports pressed state through aria-pressed for stateKind=toggle", () => {
    const { rerender } = render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={false}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");
    rerender(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={true}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reports expanded state through aria-expanded and aria-controls for stateKind=disclosure", () => {
    render(
      <ToolbarButton
        onClick={() => {}}
        ariaLabel="Text style"
        stateKind="disclosure"
        active={true}
        ariaControls="heading-menu"
      >
        <span>icon</span>
      </ToolbarButton>,
    );
    const btn = screen.getByRole("button", { name: "Text style" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("heading-menu");
    expect(btn.hasAttribute("aria-pressed")).toBe(false);
  });

  it("shows a non-colour marker that is invisible when inactive and visible when active", () => {
    const { container, rerender } = render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={false}>
        <span>icon</span>
      </ToolbarButton>,
    );
    const marker = () => container.querySelector("[data-pressed-marker]");
    expect(marker()?.className).toContain("opacity-0");
    rerender(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" stateKind="toggle" active={true}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(marker()?.className).not.toContain("opacity-0");
  });

  it("appends the on/off state to the tooltip only for stateKind=toggle with a lang", () => {
    render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" title="Bold" lang="en-US" stateKind="toggle" active={true}>
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("title")).toContain("Currently on");
  });

  it("does not append on/off state to the tooltip for stateKind=disclosure", () => {
    render(
      <ToolbarButton
        onClick={() => {}}
        ariaLabel="Text style"
        title="Text style"
        lang="en-US"
        stateKind="disclosure"
        active={true}
      >
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Text style" }).getAttribute("title")).toBe("Text style");
  });

  it("suppresses the mousedown default only when preventFocusSteal is set", () => {
    const { rerender } = render(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold">
        <span>icon</span>
      </ToolbarButton>,
    );
    let ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: "Bold" }).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);

    rerender(
      <ToolbarButton onClick={() => {}} ariaLabel="Bold" preventFocusSteal>
        <span>icon</span>
      </ToolbarButton>,
    );
    ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("button", { name: "Bold" }).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('uses the pink accent classes when active with accent="pink"', () => {
    render(
      <ToolbarButton onClick={() => {}} ariaLabel="Highlight" stateKind="toggle" active={true} accent="pink">
        <span>icon</span>
      </ToolbarButton>,
    );
    expect(screen.getByRole("button", { name: "Highlight" }).className).toContain("bg-ui-pink/10");
  });
});
