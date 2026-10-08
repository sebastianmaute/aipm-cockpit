import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RagBadge } from "./rag-badge";

describe("RagBadge", () => {
  it("renders the letter and a colour fill for a value", () => {
    render(<RagBadge value="R" lang="en-US" />);
    const el = screen.getByText("R");
    expect(el.className).toContain("bg-[var(--rag-badge-red)]");
    expect(el.getAttribute("aria-label")).toBe("Red");
  });
  // §683: each letter rides the token pair held to 4.5:1 (ratios pinned in
  // scheme-state-contrast.test.ts), never white on the raw RAG colour.
  it.each([
    ["R", "bg-[var(--rag-badge-red)]", "text-white"],
    ["A", "bg-[var(--rag-amber)]", "text-[var(--rag-badge-amber-ink)]"],
    ["G", "bg-[var(--rag-badge-green)]", "text-white"],
  ] as const)("%s draws the AA token pair", (value, fill, ink) => {
    render(<RagBadge value={value} lang="en-US" />);
    const el = screen.getByText(value);
    // The e2e a11y scan finds chips by this attribute (§683).
    expect(el.getAttribute("data-rag-chip")).toBe(value);
    const cls = el.className.split(/\s+/);
    expect(cls).toContain(fill);
    expect(cls).toContain(ink);
    expect(cls.filter((c) => c.startsWith("text-[var(") || c === "text-white")).toEqual([ink]);
    expect(cls).not.toContain("bg-[var(--rag-red)]");
    expect(cls).not.toContain("bg-[var(--rag-green)]");
  });
  it("renders a grey dash with an em-dash label when null", () => {
    render(<RagBadge value={null} lang="en-US" />);
    const el = screen.getByLabelText("—");
    expect(el.className).toContain("bg-surface-muted");
  });
  it("uses a custom title when provided", () => {
    render(<RagBadge value="G" lang="en-US" title="Consumption: Green" />);
    expect(screen.getByText("G").getAttribute("aria-label")).toBe("Consumption: Green");
  });
  it("carries print-color-adjust so the dot colour survives printing", () => {
    const { getByText } = render(<RagBadge value="R" lang="en-US" />);
    const badge = getByText("R");
    expect(badge.className).toContain("[print-color-adjust:exact]");
    expect(badge.className).toContain("[-webkit-print-color-adjust:exact]");
  });
});
