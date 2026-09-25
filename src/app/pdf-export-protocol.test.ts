import { describe, expect, it } from "vitest";
import { PDF_EXPORT_FRAME_NAME, PDF_READY_TITLE_PREFIX, pdfReadyScript, pdfWindowName } from "./pdf-export-protocol";

describe("pdf export protocol, renderer side (§468)", () => {
  it("uses _blank in a browser and the named frame in the desktop shell", () => {
    expect(pdfWindowName("Mozilla/5.0 Chrome/140")).toBe("_blank");
    expect(pdfWindowName("Mozilla/5.0 Electron/44.0.0")).toBe(PDF_EXPORT_FRAME_NAME);
  });
  it("the ready script sets the title with a JSON-escaped filename and never calls print", () => {
    const s = pdfReadyScript('a"b</script>.pdf');
    expect(s).toContain(PDF_READY_TITLE_PREFIX);
    expect(s).not.toContain("window.print");
    expect(s).not.toContain("</script>.pdf");
  });
});
