import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders a <button> with its children", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("defaults type to button (not submit)", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "button");
  });

  it("respects an explicit type", () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("type", "submit");
  });

  it("composes the canonical INTERACTIVE focus ring", () => {
    render(<Button>Focus</Button>);
    const btn = screen.getByRole("button", { name: "Focus" });
    expect(btn.className).toContain("focus:ring-2");
    expect(btn.className).toContain("focus:ring-ui-green");
  });

  it("applies primary variant classes by default (filled dark blue)", () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole("button", { name: "Primary" });
    expect(btn.className).toContain("bg-ui-dark-blue");
    expect(btn.className).toContain("text-white");
  });

  it("applies secondary variant classes (outline)", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn.className).toContain("border-line");
    expect(btn.className).toContain("bg-surface");
    expect(btn.className).toContain("text-foreground");
  });

  it("applies ghost variant classes (transparent hover-fill)", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole("button", { name: "Ghost" });
    expect(btn.className).toContain("hover:bg-surface-muted");
    expect(btn.className).not.toContain("bg-ui-dark-blue");
  });

  it("applies destructive variant classes (pink)", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toContain("text-ui-pink-strong");
    expect(btn.className).toContain("border-ui-pink/40");
  });

  it("maps md and sm sizes to their paddings", () => {
    const { rerender } = render(<Button size="md">M</Button>);
    expect(screen.getByRole("button", { name: "M" }).className).toContain("px-4");
    rerender(<Button size="sm">S</Button>);
    expect(screen.getByRole("button", { name: "S" }).className).toContain("px-3");
  });

  it("appends caller className after the variant classes", () => {
    render(<Button className="w-full extra-class">Wide</Button>);
    const cls = screen.getByRole("button", { name: "Wide" }).className;
    expect(cls).toContain("w-full");
    expect(cls).toContain("extra-class");
    // variant class still present and comes before the appended className
    expect(cls.indexOf("bg-ui-dark-blue")).toBeLessThan(cls.indexOf("extra-class"));
  });

  it("passes through disabled, onClick, aria-label and title", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick} aria-label="Save project" title="tooltip">
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Save project" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "tooltip");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled(); // disabled swallows clicks
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Click" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
