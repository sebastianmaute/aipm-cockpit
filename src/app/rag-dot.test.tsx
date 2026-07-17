import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RagDot } from "./rag-dot";
import { healthDot } from "./health";

describe("RagDot", () => {
  it("renders a decorative dot with the level's --rag token and default sm size", () => {
    const { container } = render(<RagDot level="R" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveAttribute("aria-hidden");
    expect(dot).not.toHaveAttribute("role");
    expect(dot.className).toContain(healthDot.R);
    expect(dot.className).toContain("h-2 w-2");
    expect(dot.className).toContain("rounded-full");
  });

  it("maps each RAG level to its health token", () => {
    for (const lvl of ["R", "A", "G"] as const) {
      const { container } = render(<RagDot level={lvl} />);
      expect(container.querySelector("span")!.className).toContain(healthDot[lvl]);
    }
  });

  it("applies the requested size token", () => {
    expect(render(<RagDot level="A" size="xs" />).container.querySelector("span")!.className).toContain("h-1.5 w-1.5");
    expect(render(<RagDot level="A" size="md" />).container.querySelector("span")!.className).toContain("h-2.5 w-2.5");
    expect(render(<RagDot level="A" size="lg" />).container.querySelector("span")!.className).toContain("h-3 w-3");
  });

  it("appends extra className verbatim", () => {
    const { container } = render(<RagDot level="G" className="mt-1" />);
    expect(container.querySelector("span")!.className).toContain("mt-1");
  });

  it("renders a labeled status graphic when label is set", () => {
    const { container } = render(<RagDot level="R" label="Red" />);
    const dot = container.querySelector("span")!;
    expect(dot).toHaveAttribute("role", "img");
    expect(dot).toHaveAttribute("aria-label", "Red");
    expect(dot).toHaveAttribute("title", "Red");
    expect(dot).not.toHaveAttribute("aria-hidden");
  });
});
