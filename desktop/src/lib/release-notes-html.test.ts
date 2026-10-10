import { describe, expect, it } from "vitest";
import { escapeHtml, notesSource, notesToSafeHtml } from "./release-notes-html";

const MAX = 100_000;
const render = (notes: unknown, max = MAX) => notesToSafeHtml(notes, max) as string;

// Every tag the renderer may write. Anything else in the output would mean source markup leaked.
const WRITTEN_TAGS = /<\/?(h3|h4|p|ul|ol|li|pre|blockquote|strong|em|code|hr|div class="plain")>/g;
const leftoverTags = (html: string) => html.replace(WRITTEN_TAGS, "").match(/<[^>]*>/g) ?? [];

// The shape GitHub renders a release body into (from the 1.16.0 CHANGELOG section, run through the
// GitHub markdown API on 2026-10-09; the atom feed's headings also carry an anchor link with an SVG).
const GITHUB_BODY = `<p dir="auto">A feature release. Long task lists stay<br>
responsive on large projects.</p>
<div class="markdown-heading" dir="auto"><h3 tabindex="-1" class="heading-element" dir="auto">Added</h3><a id="user-content-added" class="anchor" aria-label="Permalink: Added" href="#added"><svg class="octicon octicon-link" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M7.775 3.275"></path></svg></a></div>
<ul dir="auto">
<li>
<p dir="auto"><strong>Long task lists stay responsive (§5).</strong> Files are named <code class="notranslate">aipm-cockpit-project-&lt;code&gt;</code> and<br>
severity (<a title="GHSA-cjq9-62q9-8jv4" href="https://github.com/advisories/GHSA-cjq9-62q9-8jv4">GHSA-cjq9-62q9-8jv4</a>, SSRF).</p>
</li>
</ul>`;

describe("notesToSafeHtml", () => {
  it("keeps the structure of a GitHub-rendered release body", () => {
    expect(render(GITHUB_BODY)).toBe(
      "<p>A feature release. Long task lists stay responsive on large projects.</p> <h4>Added</h4> " +
        "<ul> <li> <p><strong>Long task lists stay responsive (§5).</strong> Files are named " +
        "<code>aipm-cockpit-project-&lt;code&gt;</code> and severity (GHSA-cjq9-62q9-8jv4, SSRF).</p> </li> </ul>",
    );
  });

  it("carries no attribute and no tag of the source through, only its own", () => {
    const hostile =
      '<h2 onclick="x()">T</h2><p style="color:red" class="c">a <a href="javascript:alert(1)">link</a></p>' +
      '<img src=x onerror="alert(2)"><iframe src="https://evil"></iframe><object data="x"></object>' +
      '<form action="https://evil"><input name="p"></form><base href="https://evil/"><meta http-equiv="refresh" content="0">' +
      '<ul><li><b data-x="1">bold</b> <i>it</i></li></ul><SCRIPT>alert(3)</SCRIPT><style>body{}</style>';
    const html = render(hostile);
    expect(leftoverTags(html)).toEqual([]);
    expect(html).not.toMatch(/\s[a-z-]+=/i);
    expect(html).not.toContain("alert(");
    expect(html).toBe("<h3>T</h3><p>a link</p><ul><li><strong>bold</strong> <em>it</em></li></ul>");
  });

  it("re-escapes decoded text, so an escaped tag in the body stays text", () => {
    expect(render("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp;lt; &#60;b&#x3e; &quot;q&quot; &#39;s&#39;</p>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp;lt; &lt;b&gt; &quot;q&quot; &#39;s&#39;</p>",
    );
  });

  it("leaves an out-of-range character reference as written instead of throwing", () => {
    expect(render("<p>&#x110000; &#99999999;</p>")).toBe("<p>&amp;#x110000; &amp;#99999999;</p>");
  });

  it("closes what it opened, and only that, however the source nests", () => {
    expect(render("<ul><li><strong>a</li></ul></p></div></strong><em>b")).toBe(
      // The space is the dropped </div>'s word separator.
      "<ul><li><strong>a</strong></li></ul> <em>b</em>",
    );
  });

  it("drops comments and the content of script-like elements, keeps an unclosed one's text inert", () => {
    expect(render("<p>a<!-- <script>x</script> -->b</p><template><p>t</p></template>")).toBe("<p>ab</p>");
    expect(render("<p>a</p><script>never closed")).toBe("<p>a</p>never closed");
  });

  it("keeps line breaks inside <pre> and turns <br> into a space elsewhere", () => {
    expect(render("<pre><code>a\n  b<br>c</code></pre><p>x<br>\ny</p>")).toBe(
      "<pre><code>a\n  b\nc</code></pre><p>x y</p>",
    );
  });

  it("separates the text of table cells and divs", () => {
    expect(render("<table><tr><td>a</td><td>b</td></tr></table>")).not.toContain("ab");
  });

  it("shows a plain-text body with its own line breaks, escaped", () => {
    expect(render("Line one\nLine 2 < 3 & \"four\"")).toBe('<div class="plain">Line one\nLine 2 &lt; 3 &amp; &quot;four&quot;</div>');
  });

  it("says so when there are no notes", () => {
    for (const empty of [undefined, null, "", "   ", "<p> </p>", [], [{ version: "1", note: null }], 42]) {
      expect(render(empty)).toBe("<p>No release notes.</p>");
    }
  });

  it("joins the notes of several versions", () => {
    expect(render([{ version: "1.1.0", note: "<p>B</p>" }, { version: "1.0.1", note: "<p>A</p>" }])).toBe("<p>B</p> <p>A</p>");
  });

  it("bounds the visible text and still closes every tag", () => {
    const html = render(`<ul><li><p>${"y".repeat(500)}</p></li><li>more</li></ul>`, 100);
    expect(html).toBe(`<ul><li><p>${"y".repeat(99)}…</p></li></ul>`);
    expect(render("z".repeat(500), 100)).toBe(`<div class="plain">${"z".repeat(99)}…</div>`);
  });

  it("never cuts a surrogate pair in half at the bound", () => {
    const html = render(`<p>${"😀".repeat(100)}</p>`, 52);
    expect(html).toBe(`<p>${"😀".repeat(25)}…</p>`);
  });

  it("reads a custom element as its own tag, not as the built-in its name starts with", () => {
    expect(render("<p>a <li-item>b</li-item> <g-emoji alias=\"x\">🎉</g-emoji> c</p>")).toBe("<p>a b 🎉 c</p>");
    expect(render("<p-x>t</p-x><p>u</p>")).toBe("t<p>u</p>");
  });

  it("decodes the common typographic entities", () => {
    expect(render("<p>a &mdash; b &hellip; &ldquo;q&rdquo; it&rsquo;s &copy;</p>")).toBe("<p>a — b … “q” it’s ©</p>");
  });

  it("caps nesting, keeping the text and the balance, and stays fast on a pathological body", () => {
    const deep = `${"<ul><li>".repeat(20_000)}x${"</li></ul>".repeat(20_000)}`;
    const started = Date.now();
    const html = render(deep);
    expect(Date.now() - started).toBeLessThan(1000);
    const opens = (html.match(/<(ul|li)>/g) ?? []).length;
    const closes = (html.match(/<\/(ul|li)>/g) ?? []).length;
    expect(opens).toBe(64);
    expect(closes).toBe(64);
    expect(html).toContain("x");
  });

  it("keeps line breaks inside a <pre> nested in a list and collapses them after it closes", () => {
    expect(render("<ul><li><pre>a\nb</pre>c\nd</li></ul>")).toBe("<ul><li><pre>a\nb</pre>c d</li></ul>");
  });
});

describe("notesSource", () => {
  it("reads a string or electron-updater's per-version array, and nothing else", () => {
    expect(notesSource("x")).toBe("x");
    expect(notesSource([{ note: "a" }, { note: "b" }, "junk", null])).toBe("a\nb\n\n");
    expect(notesSource({ note: "x" })).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
