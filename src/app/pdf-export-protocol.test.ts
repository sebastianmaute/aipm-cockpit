import { describe, expect, it } from "vitest";
import {
  PDF_EXPORT_FRAME_NAME,
  PDF_READY_TITLE_PREFIX,
  pdfReadyTitleMarkup,
  pdfWindowName,
  replaceHtmlTitle,
} from "./pdf-export-protocol";

describe("pdf export protocol, renderer side (§468)", () => {
  it("uses _blank in a browser and the named frame in the desktop shell", () => {
    expect(pdfWindowName("Mozilla/5.0 Chrome/140")).toBe("_blank");
    expect(pdfWindowName("Mozilla/5.0 Electron/44.0.0")).toBe(PDF_EXPORT_FRAME_NAME);
  });

  // §468 review round 2 — the signal is now a static <title> element, not a
  // script, so it survives the packaged app's nonce-only production CSP.
  it("the ready title markup is a static <title> element with an HTML-escaped filename, no script at all", () => {
    const markup = pdfReadyTitleMarkup('a"b<c>.pdf');
    expect(markup).toBe(`<title>${PDF_READY_TITLE_PREFIX}a&quot;b&lt;c&gt;.pdf</title>`);
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("window.print");
  });

  it("replaceHtmlTitle swaps the FIRST title, never appends a second one", () => {
    const html = "<html><head><title>Real title</title></head><body>x</body></html>";
    const out = replaceHtmlTitle(html, "<title>replaced</title>");
    expect(out).toBe("<html><head><title>replaced</title></head><body>x</body></html>");
    // Exactly one <title> — an append (rather than a replace) would leave two,
    // and document.title resolves to the FIRST one either way.
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  // §468 re-review N2 — `$&`/`` $` ``/`$'`/`$$` are special ONLY when the
  // second argument to String.replace is a string; a document title
  // containing one of these (a real, reachable case: `htmlEscape` turns "&"
  // into "&amp;", so "Q & A" produces a title with "$&" only one layer away)
  // must not corrupt the emitted markup or spill text past it.
  it("treats titleTag literally even when it contains replacement-pattern sequences ($&, $', $$)", () => {
    const html = "<html><head><title>Real title</title></head><body>x</body></html>";
    for (const weird of ["<title>Q $& A</title>", "<title>$' tail</title>", "<title>$$.pdf</title>"]) {
      const out = replaceHtmlTitle(html, weird);
      expect(out).toBe(`<html><head>${weird}</head><body>x</body></html>`);
      expect(out.match(/<title>/g)).toHaveLength(1);
    }
  });

  // The end-to-end shape the re-review reproduced: a real document titled
  // with a literal "$&" (a plausible user-chosen title, e.g. "Q $& A"), fed
  // through the actual pipeline document-download.ts uses
  // (pdfReadyTitleMarkup → replaceHtmlTitle), must not corrupt the markup or
  // leak stray text into the body.
  it("survives a real filename containing $& end to end", () => {
    const html = "<html><head><title>Q $& A</title></head><body><p>body</p></body></html>";
    const titleTag = pdfReadyTitleMarkup("Q $& A-2026-09-26.pdf");
    const out = replaceHtmlTitle(html, titleTag);
    expect(out).toBe(`<html><head>${titleTag}</head><body><p>body</p></body></html>`);
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain("<p>body</p>");
  });
});
