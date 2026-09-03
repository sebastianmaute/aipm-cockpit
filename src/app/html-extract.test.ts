import { describe, it, expect } from "vitest";
import { extractHtmlMarkdown, decodeEntities } from "./html-extract";

describe("extractHtmlMarkdown", () => {
  // ★★★ THE DEFECT THIS EXISTS FOR. .html classified as `text`, so the raw
  //  source — script bodies included — was handed to the model verbatim.
  it("drops script and style bodies entirely", () => {
    const out = extractHtmlMarkdown(
      `<html><body><style>.a{color:red}</style>` +
      `<script>var secret = 41 + 1;</script><p>Kept</p></body></html>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("color:red");
  });

  // Style now lives outside <head> above, so this pins the "head" guard on
  // its own — deleting only "head" from DROP_SUBTREE cannot pass the test
  // above by riding along on the "style" guard.
  it("drops the entire <head> subtree, not just recognized children", () => {
    const out = extractHtmlMarkdown(
      `<html><head><title>Ignored Title</title><meta name="x" content="y"></head>` +
      `<body><p>Kept</p></body></html>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("Ignored Title");
  });

  it("drops nav and footer chrome", () => {
    const out = extractHtmlMarkdown(
      `<body><nav>Home About</nav><p>Body text</p><footer>(c) 2026</footer></body>`,
    );
    expect(out).toContain("Body text");
    expect(out).not.toContain("Home About");
    expect(out).not.toContain("(c) 2026");
  });

  it("drops aside chrome", () => {
    const out = extractHtmlMarkdown(`<body><aside>Related links</aside><p>Kept</p></body>`);
    expect(out).toContain("Kept");
    expect(out).not.toContain("Related links");
  });

  it("drops noscript fallback content", () => {
    const out = extractHtmlMarkdown(`<body><noscript>Enable JS please</noscript><p>Kept</p></body>`);
    expect(out).toContain("Kept");
    expect(out).not.toContain("Enable JS please");
  });

  it("drops inline svg markup", () => {
    const out = extractHtmlMarkdown(
      `<body><svg><circle cx="1" cy="1" r="1"></circle></svg><p>Kept</p></body>`,
    );
    expect(out).toContain("Kept");
    expect(out).not.toContain("circle");
  });

  it("drops to end of input for an unterminated drop-subtree tag", () => {
    const out = extractHtmlMarkdown(`<p>before</p><script>var x = 1;`);
    expect(out).toBe("before");
  });

  it("renders headings and list items as Markdown", () => {
    const out = extractHtmlMarkdown(`<h2>Title</h2><ul><li>one</li><li>two</li></ul>`);
    expect(out).toContain("## Title");
    expect(out).toContain("- one");
    expect(out).toContain("- two");
  });

  it("renders a table as a Markdown table", () => {
    const out = extractHtmlMarkdown(
      `<table><tr><th>Role</th><th>Hours</th></tr><tr><td>PM</td><td>40</td></tr></table>`,
    );
    expect(out).toContain("| Role | Hours |");
    expect(out).toContain("| PM | 40 |");
  });

  it("renders a multi-row table with a header separator and every data row", () => {
    const out = extractHtmlMarkdown(
      `<table><tr><th>Role</th><th>Hours</th></tr>` +
      `<tr><td>PM</td><td>40</td></tr><tr><td>Dev</td><td>80</td></tr></table>`,
    );
    const lines = out.split("\n").filter(Boolean);
    expect(lines[0]).toBe("| Role | Hours |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| PM | 40 |");
    expect(lines[3]).toBe("| Dev | 80 |");
  });

  it("decodes entities", () => {
    expect(extractHtmlMarkdown(`<p>A &amp; B &lt; C &#39;quoted&#39; &nbsp;end</p>`))
      .toContain("A & B < C 'quoted'");
  });

  it("decodes hexadecimal numeric entities", () => {
    expect(extractHtmlMarkdown(`<p>&#x41;</p>`)).toContain("A");
  });

  it("leaves an out-of-range numeric entity un-decoded rather than throwing", () => {
    expect(() => extractHtmlMarkdown(`<p>&#0;&#1114112;</p>`)).not.toThrow();
    const out = extractHtmlMarkdown(`<p>&#0;&#1114112;</p>`);
    expect(out).toContain("&#0;");
    expect(out).toContain("&#1114112;");
  });

  it("decodes nbsp to a plain ASCII space, not a non-breaking space (spec: U+0020)", () => {
    expect(decodeEntities("&nbsp;").codePointAt(0)).toBe(32);
  });

  it("does not let a double-encoded entity smuggle a raw pipe past table escaping", () => {
    const out = extractHtmlMarkdown(`<table><tr><td>a&amp;#124;b</td><td>c</td></tr></table>`);
    // A real forged pipe here would split "a|b" into its own column.
    expect(out).toContain("| a&#124;b | c |");
    expect(out).not.toMatch(/\|\s*a\s*\|\s*b\s*\|\s*c\s*\|/);
  });

  it("round-trips two adjacent raw '&' characters in a table cell (a spaced sentinel would corrupt this)", () => {
    const out = extractHtmlMarkdown(`<table><tr><td>a && b</td><td>c</td></tr></table>`);
    expect(out).toContain("| a && b | c |");
    expect(out).not.toContain("AMP");
  });

  it("does not let a literal sentinel byte in hostile input survive as a decoded '&'", () => {
    const sentinelChar = String.fromCodePoint(0xe000);
    const out = extractHtmlMarkdown(`<p>before${sentinelChar}after</p>`);
    expect(out).not.toContain("&");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("does not treat a run longer than the tag-scan bound as a tag", () => {
    const longRun = "<" + "a".repeat(5000) + ">";
    const out = extractHtmlMarkdown(`<p>before</p>${longRun}<p>after</p>`);
    expect(out).toContain(longRun);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("converts <br> to a newline", () => {
    expect(extractHtmlMarkdown(`<p>line one<br>line two</p>`)).toMatch(/line one\nline two/);
  });

  it("keeps block boundaries apart rather than running words together", () => {
    expect(extractHtmlMarkdown(`<p>one</p><p>two</p>`)).toMatch(/one\s*\n\s*\n?\s*two/);
  });

  it("strips HTML comments, including ones hiding a boundary-breaking '>' inside them", () => {
    const out = extractHtmlMarkdown(`<!-- hidden > INJECTED --><p>ok</p>`);
    expect(out).toBe("ok");
    expect(out).not.toContain("INJECTED");
  });

  it("does not throw on an unterminated HTML comment, and drops the rest of the input", () => {
    expect(() => extractHtmlMarkdown(`<p>before</p><!-- never closed <p>after</p>`)).not.toThrow();
    expect(extractHtmlMarkdown(`<p>before</p><!-- never closed <p>after</p>`)).toBe("before");
  });

  it("returns the empty-document marker for markup with no text", () => {
    expect(extractHtmlMarkdown(`<html><head><title>x</title></head><body></body></html>`))
      .toBe("_(document contained no extractable text)_");
  });

  it("does not throw on unterminated markup and keeps the text before it", () => {
    expect(() => extractHtmlMarkdown(`<p>text <div><span`)).not.toThrow();
    expect(extractHtmlMarkdown(`<p>text <div><span`)).toContain("text");
  });

  it("drops a trailing unterminated tag instead of leaving it as literal text", () => {
    expect(extractHtmlMarkdown(`<p>Kept text</p><div><span`)).toBe("Kept text");
  });

  it("clamps pathologically large input before processing it", () => {
    const big = "a".repeat(600_000);
    const out = extractHtmlMarkdown(big);
    expect(out.length).toBeLessThanOrEqual(500_000);
    expect(out.length).toBeLessThan(big.length);
  });

  it("clamps a pathologically wide table to a bounded column count", () => {
    const manyCols = Array.from({ length: 200 }, (_, i) => `<td>c${i}</td>`).join("");
    const out = extractHtmlMarkdown(`<table><tr>${manyCols}</tr></table>`);
    const headerLine = out.split("\n").filter(Boolean)[0];
    const colCount = headerLine.split(" | ").length;
    expect(colCount).toBeLessThanOrEqual(64);
  });

  // ★★★ THE TWO TESTS BELOW ARE DoS GUARDS, NOT PERFORMANCE BENCHMARKS.
  //  Nothing else in this repo bounds processing time, which is why every
  //  input below passed a fully green suite while taking 12s to 31s, four of
  //  the five to produce 42 characters. extractHtmlMarkdown runs on the MAIN
  //  THREAD over attacker-supplied bytes (any .html attachment, any text/html
  //  MIME part, up to MAX_INGEST_NODES of them per mail), so the property
  //  under test is "finishes", not "finishes fast". Do NOT tighten the budget
  //  to chase a slowdown — that converts a security guard into a flaky timing
  //  assertion, and the suite runs shuffled on loaded CI machines.
  //  MARGIN: see the comment on DOS_BUDGET_MS.
  /** MARGIN, measured per fixture on the development machine 2026-09-03, with
   *  the linear walks in place and then with each one reverted to the regex it
   *  replaced (ms, green -> red):
   *
   *    heading, no '>' at all        865 -> 30,796
   *    list item, no '>' at all      859 -> 27,569
   *    table rows, never closed        8 -> 12,218
   *    table cells, never closed      12 -> 27,435
   *    trailing open tag             503 -> 25,638
   *
   *  So the budget sits 9.2x above the slowest GREEN input and, at worst,
   *  1.5x below the fastest RED one — the rows fixture, whose regex had only
   *  the lazy-rescan mechanism to be slow by, where the other four had two.
   *  ★★ THE SPREAD IS ~36x, NOT THE ~4 ORDERS OF MAGNITUDE THE LINEAR
   *  CONTROL SUGGESTS. The floor is not the 2ms an all-`<script>` input
   *  costs: three of these five spend most of their green time in
   *  TAG_STRIP_RE, which is linear but carries a MAX_TAG_SCAN_CHARS-sized
   *  constant. Budget both sides against the numbers above, not against the
   *  control.
   *  ★ Reverting a fix prints the real number in the assertion message, which
   *  is how the red column was taken; a per-fixture probe is needed to get all
   *  five, since the first test stops at its first failing case. */
  const DOS_BUDGET_MS = 8_000;
  const CLAMP_CHARS = 500_000;
  const repeatTo = (unit: string, chars: number) =>
    unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);

  /** Time one extraction, asserting its OUTPUT too — a future early bail that
   *  made these inputs trivial would otherwise leave a vacuous timing test. */
  function timeExtract(input: string, assertOutput: (out: string) => void): number {
    const started = performance.now();
    const out = extractHtmlMarkdown(input);
    const elapsed = performance.now() - started;
    assertOutput(out);
    return elapsed;
  }

  it("bounds processing time on unterminated tags that the pair-regex steps walked quadratically", () => {
    const emptyDoc = (out: string) =>
      expect(out).toBe("_(document contained no extractable text)_");
    const cases: Array<[string, string]> = [
      // No ">" ANYWHERE, so `[^>]*` backtracks to end of input from each of
      // the ~166,000 start positions.
      ["heading, no '>' at all", repeatTo("<h1", CLAMP_CHARS)],
      ["list item, no '>' at all", repeatTo("<li", CLAMP_CHARS)],
      // Terminated open tags but unterminated PAIRS, so the lazy `[\s\S]*?`
      // rescans to end of input from every open instead. These two are the
      // adversarial case for the walks NESTED inside one rendered table.
      ["table rows, never closed", `<table>${repeatTo("<tr", CLAMP_CHARS - 15)}</table>`],
      ["table cells, never closed", `<table><tr>${repeatTo("<td", CLAMP_CHARS - 24)}</tr></table>`],
    ];
    for (const [label, input] of cases) {
      const ms = timeExtract(input, emptyDoc);
      expect(ms, `${label} took ${Math.round(ms)}ms`).toBeLessThan(DOS_BUDGET_MS);
    }
  });

  it("bounds processing time on a trailing unterminated tag far from any '>'", () => {
    // `<[^>]*$` READ as bounded — anchored to end of input, so it can match at
    // most once — and was the worst quadratic in the module. A ">" further
    // than MAX_TAG_SCAN_CHARS from any "<" survives TAG_STRIP_RE, and every
    // "<" left of it then backtracks its whole `[^>]*` run before failing.
    const opens = "<".repeat(100_000);
    const input = `${opens}${"x".repeat(CLAMP_CHARS - opens.length - 1)}>`;
    const ms = timeExtract(input, (out) => {
      // Nothing is strippable here, so the run survives as text; the point is
      // only that the function got far enough to return it.
      expect(out.length).toBeGreaterThan(CLAMP_CHARS / 2);
    });
    expect(ms, `trailing open tag took ${Math.round(ms)}ms`).toBeLessThan(DOS_BUDGET_MS);
  });

  it("clamps a pathologically tall table to a bounded row count", () => {
    const manyRows = Array.from({ length: 2000 }, (_, i) => `<tr><td>r${i}</td></tr>`).join("");
    const out = extractHtmlMarkdown(`<table>${manyRows}</table>`);
    const lineCount = out.split("\n").filter(Boolean).length;
    // header + separator + up to 999 data rows (first collected row becomes the header)
    expect(lineCount).toBeLessThanOrEqual(1001);
  });
});
