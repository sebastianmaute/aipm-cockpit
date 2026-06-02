import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RagBadge } from "./rag-badge";

describe("RagBadge", () => {
  it("renders the letter and a colour fill for a value", () => {
    render(<RagBadge value="R" lang="en-US" />);
    const el = screen.getByText("R");
    expect(el.className).toContain("bg-red-500");
    expect(el.getAttribute("aria-label")).toBe("Red");
  });
  it("renders a grey dash with an em-dash label when null", () => {
    render(<RagBadge value={null} lang="en-US" />);
    const el = screen.getByLabelText("—");
    expect(el.className).toContain("bg-slate-300");
  });
  it("uses a custom title when provided", () => {
    render(<RagBadge value="G" lang="en-US" title="Consumption: Green" />);
    expect(screen.getByText("G").getAttribute("aria-label")).toBe("Consumption: Green");
  });
});
