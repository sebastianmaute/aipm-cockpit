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
});
