import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dot } from "./dot";

describe("Dot", () => {
  it("renders a decorative dot with the passed color, default sm size, round shape", () => {
    const { container } = render(<Dot color="bg-ui-green" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveAttribute("aria-hidden");
    expect(dot).not.toHaveAttribute("role");
    expect(dot).not.toHaveAttribute("aria-label");
    expect(dot).not.toHaveAttribute("title");
    expect(dot.className).toContain("bg-ui-green");
    expect(dot.className).toContain("h-2 w-2");
    expect(dot.className).toContain("rounded-full");
    expect(dot.className).toContain("shrink-0");
  });

  it("applies the requested size token", () => {
    expect(render(<Dot color="bg-ui-green" size="xs" />).container.querySelector("span")!.className).toContain("h-1.5 w-1.5");
    expect(render(<Dot color="bg-ui-green" size="md" />).container.querySelector("span")!.className).toContain("h-2.5 w-2.5");
    expect(render(<Dot color="bg-ui-green" size="lg" />).container.querySelector("span")!.className).toContain("h-3 w-3");
  });

  it("appends extra className verbatim", () => {
    const { container } = render(<Dot color="bg-ui-green" className="mt-1" />);
    expect(container.querySelector("span")!.className).toContain("mt-1");
  });

  it("renders a labeled graphic when label is set", () => {
    const { container } = render(<Dot color="bg-[var(--rag-red)]" label="Worsened" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveAttribute("role", "img");
    expect(dot).toHaveAttribute("aria-label", "Worsened");
    expect(dot).toHaveAttribute("title", "Worsened");
    expect(dot).not.toHaveAttribute("aria-hidden");
  });
});
