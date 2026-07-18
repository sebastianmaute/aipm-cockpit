import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountBadge } from "./count-badge";

describe("CountBadge", () => {
  test("renders the count and the pink tint by default", () => {
    render(<CountBadge>3</CountBadge>);
    const el = screen.getByText("3");
    expect(el.className).toContain("bg-AIPM-pink");
    expect(el.className).toContain("text-white");
    // Canonical pill shape.
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("min-w-[1rem]");
  });

  test("dark-blue variant uses the dark-blue tint", () => {
    render(<CountBadge variant="dark-blue">7</CountBadge>);
    expect(screen.getByText("7").className).toContain("bg-AIPM-dark-blue");
  });

  test("grey variant uses the medium-grey tint", () => {
    render(<CountBadge variant="grey">9</CountBadge>);
    expect(screen.getByText("9").className).toContain("bg-AIPM-medium-grey");
  });

  test("appends className after the base + variant (for positioning)", () => {
    render(<CountBadge className="absolute -right-0.5 ml-auto">1</CountBadge>);
    const el = screen.getByText("1");
    expect(el.className).toContain("absolute");
    expect(el.className).toContain("ml-auto");
  });

  test("forwards native span props such as aria-hidden", () => {
    render(<CountBadge aria-hidden data-testid="cb">5</CountBadge>);
    expect(screen.getByTestId("cb")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("CountBadge palette", () => {
  test("carries no gradient or off-palette shadow", () => {
    render(<CountBadge>2</CountBadge>);
    const cls = screen.getByText("2").className;
    expect(cls).not.toContain("shadow");
    expect(cls).not.toContain("gradient");
  });
});
