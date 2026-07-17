import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders a <span> with its children", () => {
    render(<Badge>Draft</Badge>);
    const el = screen.getByText("Draft");
    expect(el.tagName).toBe("SPAN");
  });

  it("defaults to md size (px-2 text-xs) and the non-pill radius", () => {
    render(<Badge>Md</Badge>);
    const cls = screen.getByText("Md").className;
    expect(cls).toContain("px-2");
    expect(cls).toContain("text-xs");
    expect(cls).toContain("rounded");
    expect(cls).not.toContain("rounded-full");
  });

  it("maps sm size to px-1.5 text-[10px]", () => {
    render(<Badge size="sm">Sm</Badge>);
    const cls = screen.getByText("Sm").className;
    expect(cls).toContain("px-1.5");
    expect(cls).toContain("text-[10px]");
  });

  it("uses rounded-full when pill is set", () => {
    render(<Badge pill>Pill</Badge>);
    expect(screen.getByText("Pill").className).toContain("rounded-full");
  });

  it("appends caller className AFTER the base classes", () => {
    render(<Badge className="bg-AIPM-green/15 text-AIPM-dark-blue extra-class">Tint</Badge>);
    const cls = screen.getByText("Tint").className;
    expect(cls).toContain("bg-AIPM-green/15");
    expect(cls).toContain("extra-class");
    // size class present and comes before the appended className
    expect(cls.indexOf("text-xs")).toBeLessThan(cls.indexOf("extra-class"));
  });

  it("emits no colour of its own (palette-neutral base)", () => {
    render(<Badge>Neutral</Badge>);
    const cls = screen.getByText("Neutral").className;
    expect(cls).not.toContain("bg-");
    expect(cls).not.toContain("text-AIPM");
  });

  it("passes through title, role and aria-label", () => {
    render(
      <Badge role="status" aria-label="two open" title="tip">
        2
      </Badge>,
    );
    const el = screen.getByRole("status", { name: "two open" });
    expect(el).toHaveAttribute("title", "tip");
  });
});
