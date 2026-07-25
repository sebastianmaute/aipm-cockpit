import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RichTextView } from "./rich-text-view";

describe("RichTextView", () => {
  it("renders sanitized markup, not escaped source", () => {
    const { container } = render(<RichTextView html="<p>Ship <strong>R3</strong></p>" />);
    expect(container.querySelector("strong")?.textContent).toBe("R3");
  });

  it("strips a script tag at the sink", () => {
    const { container } = render(<RichTextView html="<p>ok</p><script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("ok");
  });

  it("appends a caller className to the prose classes", () => {
    const { container } = render(<RichTextView html="<p>x</p>" className="mt-2" />);
    expect((container.firstChild as HTMLElement).className).toContain("mt-2");
  });
});
