import { describe, expect, it } from "vitest";
import { escapeMarkdownTableCell } from "./md-table-cell";

describe("escapeMarkdownTableCell", () => {
  it("escapes a pipe", () => {
    expect(escapeMarkdownTableCell("a|b")).toBe("a\\|b");
  });

  it("escapes the cell's own backslash before its pipe, so the pipe stays escaped", () => {
    expect(escapeMarkdownTableCell("a\\|b")).toBe("a\\\\\\|b");
  });

  it("doubles a backslash with no pipe beside it", () => {
    expect(escapeMarkdownTableCell("C:\\x")).toBe("C:\\\\x");
  });

  it("leaves plain text alone", () => {
    expect(escapeMarkdownTableCell("Late & over")).toBe("Late & over");
  });
});
