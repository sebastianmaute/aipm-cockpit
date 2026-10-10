import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";
import { BUILTIN_SCHEMES } from "./builtin-schemes";
import { resolveSchemeColors } from "./scheme-tokens";
import { contrastRatio } from "./scheme-contrast";

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

// §691 — the green call-to-action variant.
describe("Button accent variant", () => {
  it("fills green with dark-blue text and a same-colour border", () => {
    render(<Button variant="accent">Save</Button>);
    const cls = screen.getByRole("button", { name: "Save" }).className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["bg-ui-green", "text-ui-dark-blue", "border", "border-ui-green"]));
  });

  // text-foreground on --ui-green measured 1.55–2.51:1 in the dark schemes and
  // beacon-light, which is why the variant draws dark-blue text.
  it("keeps its text at AA (4.5:1) on its fill in every built-in scheme", () => {
    const ratios: string[] = [];
    for (const s of BUILTIN_SCHEMES) {
      for (const [mode, m] of [["light", s.light], ["dark", s.dark]] as const) {
        if (!m) continue;
        const c = resolveSchemeColors(m);
        const r = contrastRatio(c["--ui-dark-blue"]!, c["--ui-green"]!);
        if (r < 4.5) ratios.push(`${s.id}-${mode} ${r.toFixed(2)}`);
      }
    }
    expect(BUILTIN_SCHEMES.length).toBeGreaterThan(0);
    expect(ratios).toEqual([]);
  });
});

// Review fix (§691): the green ring would sit flush against the green border,
// so the accent variant offsets it by 2px over the surface colour.
describe("Button accent focus ring", () => {
  it("offsets the focus ring from the fill", () => {
    render(<Button variant="accent">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" }).className.split(/\s+/)).toEqual(
      expect.arrayContaining(["focus:ring-offset-2", "focus:ring-offset-surface"]),
    );
  });
});
