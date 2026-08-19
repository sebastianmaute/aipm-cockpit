import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RichTextEditorFallback } from "./rich-text-editor-lazy";

// The `dynamic()` boundary is exercised through its CONSUMERS' suites, where a
// synchronous query lands on this fallback and an awaited one lands on the real
// editor (see the ★★★ note in rich-text-editor-lazy.tsx — an earlier version of
// this comment wrongly said the fallback is never observed). What is tested HERE,
// and what the design actually decided, is the fallback component itself: it
// must shimmer like every other lazy surface in the app, and it must stay out of
// the accessibility tree (the surrounding form labels the field; a decorative
// placeholder announcing itself would be noise).
describe("RichTextEditorFallback", () => {
  it("shimmers, so a loading editor reads like a loading panel", () => {
    const { container } = render(<RichTextEditorFallback />);
    const el = container.firstElementChild;
    expect(el?.className).toContain("animate-pulse");
  });

  it("is decorative — hidden from assistive technology", () => {
    const { container } = render(<RichTextEditorFallback />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reserves the editor's height so the swap does not jump the layout", () => {
    const { container } = render(<RichTextEditorFallback />);
    expect(container.firstElementChild?.className).toContain("min-h-40");
  });
});
