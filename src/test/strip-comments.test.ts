import { describe, it, expect } from "vitest";
import { stripComments } from "./strip-comments";

// The stripper is the thing standing between a source assertion and the prose
// it is written next to, so the cases below are the ones that have actually
// gone wrong — not a tour of the implementation.
describe("stripComments", () => {
  it("blanks a comment that TRAILS code on the same line", () => {
    // ★★★ THE CASE THE REGEX FORM MISSED. `^\s*//` only matched a comment that
    //   STARTS a line, so `code(); // …★…` survived every strip — and the
    //   assertion added to prove no prose had been read (`not.toContain("★")`)
    //   could itself be satisfied by prose. This is the whole reason the scanner
    //   exists; deleting this test deletes the reason.
    const out = stripComments('const ssr = true; // we want ssr: false here\n');
    expect(out).not.toContain("ssr: false");
    expect(out).toContain("const ssr = true;");
  });

  it("leaves the // of a URL alone", () => {
    // The trade the regex form was making, and the reason it only matched at
    // line start. A scanner does not have to make it.
    const line = 'const href = "https://example.com/a";\n';
    expect(stripComments(line)).toBe(line);
  });

  it("preserves length and line count, so indexes and line numbers still resolve", () => {
    // `label-binding.guard.test.ts` compares match INDEXES and reports LINE
    // NUMBERS off this output. Deleting comment text outright moves both.
    const src = "a\n{/* x\ny */}\nb\nc(); /* tail */\n";
    const out = stripComments(src);
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).not.toContain("x");
  });

  it("does not treat an apostrophe in prose as opening a string", () => {
    // ★★ The failure this guards is SILENT and one-directional: a `'` that
    //   opened a span running to the next one would copy a real comment through
    //   verbatim instead of blanking it. Single quotes must therefore close on
    //   the SAME line to count as a string.
    const out = stripComments("<p>don't</p>\n<p>ok</p> // ★ secret\n");
    expect(out).not.toContain("★");
    expect(out).toContain("don't");
  });

  it("does not blank a // that lives inside a string", () => {
    const src = 'const s = "a // b";\n';
    expect(stripComments(src)).toBe(src);
  });

  it("does not blank a comment marker inside a template literal", () => {
    const src = "const s = `line\nwith // inside`;\n";
    expect(stripComments(src)).toBe(src);
  });

  it("blanks a block comment that spans lines", () => {
    const out = stripComments("before\n/* one\n   two ★ */\nafter\n");
    expect(out).not.toContain("★");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("blanks an unterminated block comment to end of file", () => {
    // A truncated file must not leave prose readable to an assertion.
    expect(stripComments("code();\n/* ★ never closed\n")).not.toContain("★");
  });
});
