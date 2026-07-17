import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("is decorative (aria-hidden) so a lone glyph is not announced", () => {
    const { container } = render(<Spinner />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.getAttribute("aria-hidden")).toBe("true");
  });

  it("defaults to the md size (legacy h-7 w-7 border-2) with the brand ring", () => {
    const { container } = render(<Spinner />);
    const cls = container.querySelector("span")?.className ?? "";
    expect(cls).toContain("h-7");
    expect(cls).toContain("w-7");
    expect(cls).toContain("border-2");
    expect(cls).toContain("animate-spin");
    expect(cls).toContain("border-AIPM-dark-blue");
    expect(cls).toContain("border-t-transparent");
  });

  it("applies the requested size variant", () => {
    const { container } = render(<Spinner size="sm" />);
    const cls = container.querySelector("span")?.className ?? "";
    expect(cls).toContain("h-4");
    expect(cls).toContain("w-4");
  });

  it("appends caller className", () => {
    const { container } = render(<Spinner className="my-2" />);
    expect(container.querySelector("span")?.className).toContain("my-2");
  });
});
