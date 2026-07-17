import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./card";

describe("Card primitive", () => {
  it("renders its children", () => {
    render(<Card>hello</Card>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("applies the canonical card classes (rounded-lg + border-line + bg-surface)", () => {
    const { container } = render(<Card>x</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("rounded-lg");
    expect(el.className).toContain("border");
    expect(el.className).toContain("border-line");
    expect(el.className).toContain("bg-surface");
  });

  it("has NO shadow by default", () => {
    const { container } = render(<Card>x</Card>);
    expect((container.firstChild as HTMLElement).className).not.toContain("shadow-");
  });

  it("boxed adds the --shadow-card token", () => {
    const { container } = render(<Card boxed>x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain("shadow-[var(--shadow-card)]");
  });

  it("padded adds p-4", () => {
    const { container } = render(<Card padded>x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain("p-4");
  });

  it("has no padding by default", () => {
    const { container } = render(<Card>x</Card>);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/\bp-4\b/);
  });

  it("appends a caller className after the canonical classes", () => {
    const { container } = render(<Card className="flex gap-2">x</Card>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain("flex gap-2");
    expect(cls.indexOf("rounded-lg")).toBeLessThan(cls.indexOf("flex gap-2"));
  });

  it("passes through arbitrary div props (id, data-*, role)", () => {
    const { container } = render(
      <Card id="c1" role="group" data-testid="card-x">
        x
      </Card>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.id).toBe("c1");
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("data-testid")).toBe("card-x");
  });
});
