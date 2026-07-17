import { describe, it, expect } from "vitest";
import { TABLE_HEAD_CLASS } from "./table-styles";

describe("TABLE_HEAD_CLASS", () => {
  it("is a token-fg-text, sticky header carrying the rounded-header marker", () => {
    // The Dark-Blue fill now lives on the <th> cells (set via the `aipm-cockpit-thead`
    // rule in globals.css) so the rounded corners can clip it — the class no
    // longer carries `bg-AIPM-dark-blue` itself.
    expect(TABLE_HEAD_CLASS).toContain("aipm-cockpit-thead");
    expect(TABLE_HEAD_CLASS).toContain("text-[var(--table-head-fg)]");
    expect(TABLE_HEAD_CLASS).toContain("sticky");
    expect(TABLE_HEAD_CLASS).toContain("top-0");
    expect(TABLE_HEAD_CLASS).toContain("z-10");
  });

  it("renders headers in normal case (no global uppercase transform)", () => {
    expect(TABLE_HEAD_CLASS).not.toContain("uppercase");
    expect(TABLE_HEAD_CLASS).not.toContain("tracking-wide");
  });

  it("drops the old muted-grey header tokens", () => {
    expect(TABLE_HEAD_CLASS).not.toContain("bg-surface-muted");
    expect(TABLE_HEAD_CLASS).not.toContain("text-muted-foreground");
  });

  it("matches the exact expected class string", () => {
    expect(TABLE_HEAD_CLASS).toBe(
      "aipm-cockpit-thead sticky top-0 z-10 text-xs text-[var(--table-head-fg)]",
    );
  });
});
