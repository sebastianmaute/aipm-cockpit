import { describe, it, expect } from "vitest";
import { buildRowTokens, rowLabel } from "./row-tokens";

describe("buildRowTokens", () => {
  it("leaves a name that is unique in the list BARE", () => {
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
    ]);
    expect(tokens.get(1)).toBe("Alpha");
    expect(tokens.get(2)).toBe("Beta");
  });

  it("numbers EVERY colliding row, the first included", () => {
    // ★ The first row is numbered too. A bare "Alpha" beside "Alpha (2)" leaves
    // a user unable to tell "the only one" from "the first of several".
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Alpha" },
    ]);
    expect(tokens.get(1)).toBe("Alpha (1)");
    expect(tokens.get(2)).toBe("Alpha (2)");
  });

  it("indexes occurrences only within the colliding group", () => {
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Alpha" },
    ]);
    expect(tokens.get(1)).toBe("Alpha (1)");
    expect(tokens.get(2)).toBe("Beta");
    expect(tokens.get(3)).toBe("Alpha (2)");
  });

  it("escalates when a row is literally NAMED like a generated token", () => {
    // ★ Rename accepts any string. Without the escalation loop the generated
    // token for the pair's first row would collide with row 3's bare name.
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Alpha" },
      { id: 3, name: "Alpha (1)" },
    ]);
    const all = [tokens.get(1), tokens.get(2), tokens.get(3)];
    expect(new Set(all).size).toBe(3);
  });

  it("works with string ids", () => {
    const tokens = buildRowTokens([
      { id: "a", name: "Same" },
      { id: "b", name: "Same" },
    ]);
    expect(tokens.get("a")).toBe("Same (1)");
    expect(tokens.get("b")).toBe("Same (2)");
  });

  it("returns an empty map for an empty list", () => {
    expect(buildRowTokens([]).size).toBe(0);
  });
});

describe("rowLabel", () => {
  it("keeps the verb at the FRONT so the name CONTAINS the visible text", () => {
    // WCAG 2.5.3 is containment, case-insensitive, NOT prefix — but front
    // position is the documented best practice and what every caller assumes.
    expect(rowLabel("Delete", "Alpha (2)")).toBe("Delete – Alpha (2)");
  });
});
