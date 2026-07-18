import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FieldHint } from "./field-hint";

describe("FieldHint", () => {
  it("renders a <p> with the canonical muted-help classes by default", () => {
    const { container } = render(<FieldHint>Help copy</FieldHint>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("P");
    expect(el.className).toBe("text-xs text-muted-foreground");
    expect(el.textContent).toBe("Help copy");
  });

  it("appends caller className after the canonical classes", () => {
    const { container } = render(
      <FieldHint className="mt-1 italic">x</FieldHint>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toBe("text-xs text-muted-foreground mt-1 italic");
  });

  it("renders the requested tag via `as`", () => {
    const { container } = render(<FieldHint as="span">x</FieldHint>);
    expect((container.firstElementChild as HTMLElement).tagName).toBe("SPAN");
  });

  it("wires an id for aria-describedby linking", () => {
    const { container } = render(<FieldHint id="hint-1">x</FieldHint>);
    expect((container.firstElementChild as HTMLElement).id).toBe("hint-1");
  });
});
