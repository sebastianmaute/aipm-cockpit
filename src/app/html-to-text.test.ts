import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { htmlToPlainText } from "./html-to-text";
import { expectLinearScaling } from "../test/scaling";

describe("htmlToPlainText", () => {
  it("converts block tags + br to newlines and strips tags", () => {
    expect(htmlToPlainText("<p>Hi</p><p>There</p>")).toBe("Hi\nThere");
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
    expect(htmlToPlainText("<b>bold</b> <i>x</i>")).toBe("bold x");
  });
  it("decodes common entities", () => {
    expect(htmlToPlainText("A &amp; B &lt;x&gt; &nbsp;y")).toBe("A & B <x>  y");
  });
  it("collapses 3+ blank lines and trims", () => {
    expect(htmlToPlainText("<p>a</p><br><br><br><p>b</p>")).toBe("a\n\nb");
  });
  it("renders list items as dash bullets", () => {
    expect(htmlToPlainText("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
  });
});

// The pre-§578 implementation, kept verbatim as the oracle the linear one must match.
const ENT_ORACLE: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
function oldHtmlToPlainText(html: string): string {
  let s = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (e) => ENT_ORACLE[e]);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

describe("htmlToPlainText — linear tag passes (§578)", () => {
  it("matches the regex implementation on unterminated, nested and odd-case tags", () => {
    const cases = [
      "<li", "<li x", "a<li x</p>b", "<LI class=x>one", "< li>two", "<lI>", "<li<li>>x", "<>", "<<>", "a<b",
      "<p>a</p><li>b<", "x <ul>< li >y</ul> z", "<br/><li>a</li><br >", "< li>q", "<link rel=x>t", "<list>",
    ];
    for (const html of cases) expect(htmlToPlainText(html), JSON.stringify(html)).toBe(oldHtmlToPlainText(html));
  });

  it("matches the regex implementation on random tag soup", () => {
    const token = fc.constantFrom(
      "<", ">", "</", "/", "li", "LI", "Li", "br", "p", "div", "h2", "tr", " ", "\t", "\n", " ", "x", "&amp;", "&nbsp;",
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 40 }), (parts) => {
        const html = parts.join("");
        expect(htmlToPlainText(html)).toBe(oldHtmlToPlainText(html));
      }),
      { seed: 578, numRuns: 3000 },
    );
  });

  // Hang backstop, not the guard: vitest cannot interrupt a synchronous test (see src/test/scaling.ts).
  it("stays linear on opens with no '>' after them", { timeout: 120_000 }, () => {
    // `<\s*li[^>]*>` and `<[^>]+>` both ran `[^>]*` to the end of input from
    // EVERY open, so "<li " repeated with no ">" was quadratic in each pass
    // (§578: 496 / 1970 / 8357 ms at 20k / 40k / 80k for the <li> pass alone).
    // A ratio guard (src/test/scaling.ts), not a ceiling: linear ≈ 4 at factor 4,
    // quadratic ≈ 16, limit 8 — a fixed ms ceiling fails a correct build on a
    // loaded CI runner (§592, §612). n is 5,000 so either quadratic mutant still
    // finishes in seconds. One fixture serves both passes: each mutant is red alone.
    expectLinearScaling({
      label: "htmlToPlainText on unclosed <li opens",
      build: (n) => "<li ".repeat(n),
      run: htmlToPlainText,
      check: (out, n) => expect(out).toBe("<li ".repeat(n).trim()),
      n: 5_000,
    });
  });
});
