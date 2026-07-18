import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Banner } from "./banner";

describe("Banner", () => {
  it("renders a <div> with its children", () => {
    render(<Banner severity="info">Hello</Banner>);
    const el = screen.getByText("Hello");
    expect(el.tagName).toBe("DIV");
  });

  it("carries the canonical base box classes (radius + border + padding + text-sm)", () => {
    render(<Banner severity="info">Base</Banner>);
    const cls = screen.getByText("Base").className;
    expect(cls).toContain("rounded-md");
    expect(cls).toContain("border");
    expect(cls).toContain("px-3");
    expect(cls).toContain("py-2");
    expect(cls).toContain("text-sm");
  });

  it("maps error severity to the sanctioned ui-pink tokens", () => {
    render(<Banner severity="error">Err</Banner>);
    const cls = screen.getByText("Err").className;
    expect(cls).toContain("border-ui-pink/40");
    expect(cls).toContain("bg-ui-pink/10");
    expect(cls).toContain("text-ui-pink-strong");
  });

  it("maps success severity to the sanctioned ui-green tokens", () => {
    render(<Banner severity="success">Ok</Banner>);
    const cls = screen.getByText("Ok").className;
    expect(cls).toContain("border-ui-green/40");
    expect(cls).toContain("bg-ui-green/10");
    expect(cls).toContain("text-ui-green-strong");
  });

  it("maps info severity to the ui-dark-blue tint with AA-safe foreground text", () => {
    render(<Banner severity="info">Info</Banner>);
    const cls = screen.getByText("Info").className;
    expect(cls).toContain("border-ui-dark-blue/40");
    expect(cls).toContain("bg-ui-dark-blue/10");
    expect(cls).toContain("text-foreground");
  });

  it("maps warn severity to the --rag-amber token tint with AA-safe foreground text", () => {
    render(<Banner severity="warn">Warn</Banner>);
    const cls = screen.getByText("Warn").className;
    expect(cls).toContain("border-[var(--rag-amber)]/40");
    expect(cls).toContain("bg-[var(--rag-amber)]/15");
    expect(cls).toContain("text-foreground");
    // ★ warn must NOT tint small TEXT with amber (--rag-amber-text fails AA on
    // dark/mockup); the amber rides the border/background only.
    expect(cls).not.toContain("text-[var(--rag-amber");
  });

  it("adds dark-mode tint bumps for parity (border /40→/50-60, bg /10→/15-20)", () => {
    render(
      <>
        <Banner severity="error">E</Banner>
        <Banner severity="success">S</Banner>
        <Banner severity="info">I</Banner>
        <Banner severity="warn">W</Banner>
      </>,
    );
    expect(screen.getByText("E").className).toContain("dark:bg-ui-pink/15");
    expect(screen.getByText("E").className).toContain("dark:border-ui-pink/60");
    expect(screen.getByText("S").className).toContain("dark:bg-ui-green/15");
    expect(screen.getByText("I").className).toContain("dark:bg-ui-dark-blue/15");
    expect(screen.getByText("W").className).toContain("dark:bg-[var(--rag-amber)]/20");
    expect(screen.getByText("W").className).toContain("dark:border-[var(--rag-amber)]/50");
    // ★ still no amber on text, even in dark mode
    expect(screen.getByText("W").className).not.toContain("text-[var(--rag-amber");
  });

  it("appends caller className AFTER the severity classes", () => {
    render(
      <Banner severity="error" className="mb-6 flex extra-class">
        Tint
      </Banner>,
    );
    const cls = screen.getByText("Tint").className;
    expect(cls).toContain("extra-class");
    expect(cls).toContain("flex");
    // base severity class present and comes before the appended className
    expect(cls.indexOf("bg-ui-pink/10")).toBeLessThan(cls.indexOf("extra-class"));
  });

  it("passes through role and aria-label (caller owns alert/status/region semantics)", () => {
    render(
      <Banner severity="error" role="alert" aria-label="problem">
        Boom
      </Banner>,
    );
    expect(screen.getByRole("alert", { name: "problem" })).toBeInTheDocument();
  });

  it("defaults the live-region role from severity (error → alert, else status)", () => {
    const { rerender } = render(<Banner severity="info">Quiet</Banner>);
    expect(screen.getByText("Quiet")).toHaveAttribute("role", "status");
    rerender(<Banner severity="error">Boom</Banner>);
    expect(screen.getByText("Boom")).toHaveAttribute("role", "alert");
  });

  it("lets an explicit role override the severity default", () => {
    render(<Banner severity="error" role="region" aria-label="x">Landmark</Banner>);
    expect(screen.getByText("Landmark")).toHaveAttribute("role", "region");
  });
});
