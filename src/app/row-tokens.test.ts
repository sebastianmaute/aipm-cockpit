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

  it("collides two names that differ only by an internal whitespace RUN", () => {
    // ★★ Accessible-name computation collapses internal whitespace runs, so
    // "Risk  A" and "Risk A" are ONE name to a screen reader. Keying collisions
    // on the raw string leaves BOTH bare — a 2.4.6 failure invisible on screen,
    // because the two rows differ by a space nobody can see.
    const tokens = buildRowTokens([
      { id: 1, name: "Risk  A" },
      { id: 2, name: "Risk A" },
    ]);
    // ★ The emitted token keeps the row's OWN spelling — only the COMPARISON is
    // collapsed. Asserting the raw name back is what stops a "fix" that
    // normalises the token itself and silently rewrites what the user typed.
    expect(tokens.get(1)).toBe("Risk  A (1)");
    expect(tokens.get(2)).toBe("Risk A (2)");
  });

  it("escalates when a generated token collides with a name only AFTER collapsing", () => {
    // ★ Row 3 is literally named "Alpha  (1)" (two spaces). Its bare token
    // collapses to the very token generated for row 1, so the escalation loop
    // must compare collapsed forms — comparing raw strings steps straight over it.
    const tokens = buildRowTokens([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Alpha" },
      { id: 3, name: "Alpha  (1)" },
    ]);
    const heard = [tokens.get(1)!, tokens.get(2)!, tokens.get(3)!].map((n) => n.replace(/\s+/g, " "));
    expect(new Set(heard).size).toBe(3);
  });
});

describe("rowLabel", () => {
  it("puts the verb FIRST — the repo's one format, and the documented best practice", () => {
    // ★ NOT a conformance requirement: WCAG 2.5.3 is CONTAINMENT, so
    // "Alpha (2) – Delete" would conform equally well. Front position is a NOTE
    // in Understanding SC 2.5.3. This pins the FORMAT every surface shares,
    // nothing more — the containment property is the test below.
    expect(rowLabel("Delete", "Alpha (2)")).toBe("Delete – Alpha (2)");
  });

  it("returns a name CONTAINING the verb, which is what WCAG 2.5.3 asks for", () => {
    // ★★ The containment property itself, at the only layer a pure function can
    // reach. axe compares case-insensitively after stripping punctuation, so
    // plain containment is sufficient here.
    // ★ SCOPE, stated because the docstring used to overclaim it: this renders
    // no control and reads no visible text, so it does NOT prove that any call
    // site's VISIBLE label equals `verb`. That is per-call-site and is pinned
    // nowhere in this file.
    for (const verb of ["Delete", "Restore this state", "Compared with current"]) {
      expect(rowLabel(verb, "Risk  A (1)").toLowerCase()).toContain(verb.toLowerCase());
    }
  });
});
