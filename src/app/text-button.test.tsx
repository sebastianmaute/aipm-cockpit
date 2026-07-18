import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextButton } from "./text-button";

describe("TextButton", () => {
  it("renders a <button> with its children", () => {
    render(<TextButton>Remove</TextButton>);
    expect(screen.getByRole("button", { name: "Remove" }).tagName).toBe("BUTTON");
  });

  it("defaults type to button (not submit)", () => {
    render(<TextButton>Reset</TextButton>);
    expect(screen.getByRole("button", { name: "Reset" })).toHaveAttribute("type", "button");
  });

  it("applies the default (dark-blue) tone and danger (pink) on request", () => {
    const { rerender } = render(<TextButton>A</TextButton>);
    expect(screen.getByRole("button", { name: "A" }).className).toContain("text-ui-dark-blue");
    rerender(<TextButton tone="danger">A</TextButton>);
    expect(screen.getByRole("button", { name: "A" }).className).toContain("text-ui-pink-strong");
  });

  it("underlines on hover", () => {
    render(<TextButton>Link</TextButton>);
    expect(screen.getByRole("button", { name: "Link" }).className).toContain("hover:underline");
  });

  it("sets no text size (caller keeps their own)", () => {
    render(<TextButton className="text-xs">Small</TextButton>);
    const btn = screen.getByRole("button", { name: "Small" });
    expect(btn.className).toContain("text-xs");
    expect(btn.className).not.toContain("text-sm");
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<TextButton onClick={onClick}>Go</TextButton>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
