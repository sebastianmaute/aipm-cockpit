import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IconButton } from "./icon-button";

describe("IconButton", () => {
  it("renders a <button> with the required accessible name from label", () => {
    render(<IconButton label="Close"><span aria-hidden>✕</span></IconButton>);
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("defaults type to button (not submit)", () => {
    render(<IconButton label="Remove">x</IconButton>);
    expect(screen.getByRole("button", { name: "Remove" })).toHaveAttribute("type", "button");
  });

  it("composes the canonical INTERACTIVE focus ring", () => {
    render(<IconButton label="X">x</IconButton>);
    expect(screen.getByRole("button", { name: "X" }).className).toContain("focus:ring-ui-green");
  });

  it("applies the ghost affordance by default and danger on request", () => {
    const { rerender } = render(<IconButton label="A">x</IconButton>);
    expect(screen.getByRole("button", { name: "A" }).className).toContain("hover:bg-surface-muted");
    rerender(<IconButton label="A" variant="danger">x</IconButton>);
    expect(screen.getByRole("button", { name: "A" }).className).toContain("hover:text-ui-pink-strong");
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<IconButton label="Go" onClick={onClick}>x</IconButton>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("appends caller className after the base", () => {
    render(<IconButton label="X" className="shrink-0">x</IconButton>);
    expect(screen.getByRole("button", { name: "X" }).className).toContain("shrink-0");
  });

  it("dangerBordered carries the destructive border and text at rest", () => {
    render(<IconButton label="Clear all" variant="dangerBordered">x</IconButton>);
    const btn = screen.getByRole("button", { name: "Clear all" });
    expect(btn.className).toContain("border-ui-pink/50");
    expect(btn.className).toContain("text-ui-pink-strong");
  });
});
