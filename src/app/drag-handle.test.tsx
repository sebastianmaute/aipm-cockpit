import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { DragHandle } from "./drag-handle";

describe("DragHandle", () => {
  it("is decorative (aria-hidden, no role) when no ariaLabel is passed", () => {
    const { container } = render(<DragHandle />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle).toHaveAttribute("aria-hidden", "true");
    expect(handle).not.toHaveAttribute("role");
  });

  it("renders role=button with the passed accessible name when ariaLabel is given", () => {
    const { container } = render(<DragHandle ariaLabel="Resize task – Design review" />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle).toHaveAttribute("role", "button");
    expect(handle).toHaveAttribute("aria-label", "Resize task – Design review");
    expect(handle).not.toHaveAttribute("aria-hidden");
  });

  it("keeps the decorative glyph aria-hidden so it can't bleed into the accessible name", () => {
    const { container } = render(<DragHandle ariaLabel="Resize" />);
    const glyph = container.querySelector("svg");
    expect(glyph).toBeTruthy();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  it("fires onDragStart when the handle is draggable", () => {
    const onDragStart = vi.fn();
    const { container } = render(<DragHandle draggable onDragStart={onDragStart} />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle).toHaveAttribute("draggable", "true");
    handle.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("fires onMouseDown", () => {
    const onMouseDown = vi.fn();
    const { container } = render(<DragHandle onMouseDown={onMouseDown} />);
    const handle = container.firstElementChild as HTMLElement;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it("applies a caller className additively, keeping the atom's own base classes", () => {
    const { container } = render(<DragHandle className="cursor-col-resize w-1.5" />);
    const handle = container.firstElementChild as HTMLElement;
    expect(handle.className).toContain("cursor-col-resize");
    expect(handle.className).toContain("w-1.5");
    // Base classes (generic to any drag handle) survive alongside it.
    expect(handle.className).toContain("select-none");
    expect(handle.className).toContain("print:hidden");
  });
});
