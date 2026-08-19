import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RichTextEditorFallback } from "./rich-text-editor-lazy";

// The `dynamic()` boundary itself is not unit-testable in a useful way — vitest
// resolves the import in a microtask, so the fallback is never observed. What IS
// testable, and what the design actually decided, is the fallback component: it
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
