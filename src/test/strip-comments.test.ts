import { describe, it, expect } from "vitest";
import { stripComments } from "./strip-comments";

// Every case below is one a hand-rolled cut of this helper got WRONG. None is a
// tour of the implementation, and none is invented — each is reduced from a real
// file in `src` that the cut of the day mangled. Read the module header for the
// order they were found in.
describe("stripComments", () => {
  it("blanks a comment that TRAILS code on the same line", () => {
    // ★★★ THE CASE THE REGEX FORM MISSED. `^\s*//` only matched a comment that
    //   STARTS a line, so `code(); // …★…` survived every strip — and the
    //   assertion added to prove no prose had been read (`not.toContain("★")`)
    //   could itself be satisfied by prose.
    // ★★ It is also the case the PARSER form missed on its first cut, from the
    //   other end: TypeScript calls this a TRAILING comment of the token before
    //   it, and `getLeadingCommentRanges` does not return it. Two different
    //   implementations, the same blind spot, one test.
    const out = stripComments("const ssr = true; // we want ssr: false here\n");
    expect(out).not.toContain("ssr: false");
    expect(out).toContain("const ssr = true;");
  });

  it("blanks a JSX {/* … */} comment", () => {
    // Same trailing-comment blind spot, in the shape that dominates this repo's
    // `.tsx` files. The comment naming a labelable tag is the exact input
    // `label-binding.guard.test.ts` strips to avoid a silent miss.
    const out = stripComments("<div>\n  {/* mirrors the <Input> pattern */}\n  <b>hi</b>\n</div>\n");
    expect(out).not.toContain("Input");
    expect(out).toContain("<b>hi</b>");
  });

  it("leaves the // of a URL in a string alone", () => {
    const line = 'const href = "https://example.com/a";\n';
    expect(stripComments(line)).toBe(line);
  });

  it("leaves the // of a bare URL in JSX TEXT alone", () => {
    // ★★★ THE OVER-BLANK CASE, AND THE WORST BUG ANY CUT OF THIS HELPER HAD —
    //   INCLUDING THE PARSER CUT. JSX children are TEXT, not code, so a `//`
    //   there opens nothing; a string-tracking scanner blanked from it onward,
    //   thousands of characters of real markup across `src` starting at the bare
    //   URL in `timelog-settings.tsx`. Over-blanking DELETES CODE from the text
    //   an assertion reads, which is categorically worse than leaving a comment
    //   readable: a guard scanning the result can no longer see the markup it
    //   exists to check.
    // ★★★ THE FIXTURE MUST LEAD WITH `//`, AND THIS ONE DID NOT until a cold
    //   review measured it. A `JsxText` leaf's `fullStart` is its own start, so
    //   `getLeadingCommentRanges` scans the TEXT — but reports a comment only
    //   when that text BEGINS `//` or `/*`. With `https:` in front the query
    //   never fired, so this passed for a reason unrelated to its name while the
    //   parser cut blanked the whole URL line one prefix away. A test named after
    //   a bug it cannot observe is worse than no test.
    // ★★ BOTH SHAPES ARE ASSERTED. `//…` is what reaches the bug; `https://…` is
    //   what `src` actually contains (`timelog-settings.tsx`), and dropping it
    //   would leave the real-world shape uncovered against some future cut whose
    //   blind spot is the other way round.
    const src = "<p>\n  //login.example.com/token\n  <b>after</b>\n</p>\n";
    expect(stripComments(src)).toBe(src);
    const real = "<p>\n  https://login.timelog.com/personaltoken\n  <b>after</b>\n</p>\n";
    expect(stripComments(real)).toBe(real);
  });

  it("blanks a // comment inside a template-literal ${…} interpolation", () => {
    // ★★ An interpolation is CODE inside template TEXT. A scanner that treated a
    //   backtick run as opaque to its closing backtick left these readable —
    //   seven of them in `combobox-shared.tsx`, inside a `className`. The tag
    //   name below is the SHAPE that matters to the label guard, not a quote from
    //   that file: a comment naming a labelable tag is what makes a real widget
    //   after it read as trailing.
    const src = ["const c = `w-full ${", "  active", "    // mirrors the <Input> pattern", '    ? "a" : "b"', "}`;", ""].join("\n");
    const out = stripComments(src);
    expect(out).not.toContain("Input");
    expect(out).toContain("w-full");
  });

  it("parses a .ts file as TS, so a non-comma generic arrow does not open JSX", () => {
    // ★★★ THE SCRIPT KIND IS LOAD-BEARING, and this module parsed everything as
    //   TSX until a cold review measured it. Under TSX, `<T>(x: T)` opens a JSX
    //   element and the parse is garbage to end of file — in `workspace.ts` that
    //   left 8,250 comment characters readable, and no `.tsx` file can exhibit
    //   it. The `<T,>` spelling parses either way, which is why this uses the
    //   bare one.
    const src = "const f = <T>(x: T): T => x; // ★ secret\n";
    expect(stripComments(src, "a.ts")).not.toContain("★");
    // The default stays TSX: every other fixture here is a `.tsx`-shaped string,
    // and this asserts the default is real rather than incidental.
    expect(stripComments(src)).toContain("★");
  });

  it("does not blank a comment marker inside a template literal's TEXT", () => {
    const src = "const s = `line\nwith // inside`;\n";
    expect(stripComments(src)).toBe(src);
  });

  it("survives a regex literal containing a backtick", () => {
    // ★★ `markdown.tsx` matches a fenced code block, so its regex holds three
    //   backticks. Read naively, the odd one opens a template span that ran 50
    //   lines and swallowed four real comments behind it.
    const src = ["const fence = !/^(\\s*```)/.test(line); // ★ secret", "const after = 1;", ""].join("\n");
    const out = stripComments(src);
    expect(out).not.toContain("★");
    expect(out).toContain("```");
    expect(out).toContain("const after = 1;");
  });

  it("preserves length and line count, so indexes and line numbers still resolve", () => {
    // `label-binding.guard.test.ts` compares match INDEXES and reports LINE
    // NUMBERS off this output. Deleting comment text outright moves both.
    const src = "const a = 1;\n{/* x */}\nconst b = 2;\nc(); /* tail */\n";
    const out = stripComments(src);
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).not.toContain("x");
    // Both comment positions, not just the first — the fixture carries a
    // trailing one precisely because that is the half a leading-only walk drops.
    expect(out).not.toContain("tail");
  });

  it("does not treat an apostrophe in prose as opening a string", () => {
    const out = stripComments("<p>don't</p>;\n// ★ secret\n");
    expect(out).not.toContain("★");
    expect(out).toContain("don't");
  });

  it("does not blank a // that lives inside a string", () => {
    const src = 'const s = "a // b";\n';
    expect(stripComments(src)).toBe(src);
  });

  it("blanks a block comment that spans lines", () => {
    const out = stripComments("const before = 1;\n/* one\n   two ★ */\nconst after = 2;\n");
    expect(out).not.toContain("★");
    expect(out).toContain("const before = 1;");
    expect(out).toContain("const after = 2;");
  });

  it("blanks an unterminated block comment to end of file", () => {
    // A truncated file must not leave prose readable to an assertion.
    expect(stripComments("code();\n/* ★ never closed\n")).not.toContain("★");
  });
});
