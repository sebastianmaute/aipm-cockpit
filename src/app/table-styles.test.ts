import { describe, it, expect } from "vitest";
import { TABLE_HEAD_CLASS } from "./table-styles";

describe("TABLE_HEAD_CLASS", () => {
  it("is a Dark-Blue, white-text, sticky header on the AIPM palette", () => {
    expect(TABLE_HEAD_CLASS).toContain("bg-AIPM-dark-blue");
    expect(TABLE_HEAD_CLASS).toContain("text-white");
    expect(TABLE_HEAD_CLASS).toContain("sticky");
    expect(TABLE_HEAD_CLASS).toContain("top-0");
    expect(TABLE_HEAD_CLASS).toContain("uppercase");
  });

  it("drops the old muted-grey header tokens", () => {
    expect(TABLE_HEAD_CLASS).not.toContain("bg-surface-muted");
    expect(TABLE_HEAD_CLASS).not.toContain("text-muted-foreground");
  });
});
