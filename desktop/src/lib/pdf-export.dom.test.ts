// §468 packaged-app check -- the page-side scripts main runs through
// `executeJavaScript`, executed against a jsdom document. jsdom has no layout,
// so each table's `getBoundingClientRect` is stubbed; what this pins is the
// scripts' own logic (which table is changed, which cells keep their line,
// that the body's width is put back), which a string comparison cannot see.
import { afterEach, describe, expect, it } from "vitest";
import {
  PDF_COLLECT_STYLES_SCRIPT,
  PDF_NOWRAP_ATTR,
  PDF_WRAP_ATTR,
  pdfApplyTableFitsScript,
  pdfTableWidthsScript,
  pdfWidestScript,
} from "./pdf-export";

// Indirect eval: runs the script in global scope, the way executeJavaScript
// runs it in the page.
const run = (script: string): unknown => (0, eval)(script);

function table(width: number, cells: string[]): HTMLTableElement {
  const t = document.createElement("table");
  const row = t.insertRow();
  for (const text of cells) row.insertCell().textContent = text;
  t.getBoundingClientRect = () => ({ width }) as DOMRect;
  document.body.appendChild(t);
  return t;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.style.width = "";
});

describe("pdf-export page scripts (§468)", () => {
  it("reads every table's width in document order and puts the body width back", () => {
    document.body.style.width = "5px";
    table(800, ["a"]);
    table(1500, ["b"]);
    expect(run(pdfTableWidthsScript(1062))).toEqual([800, 1500]);
    expect(document.body.style.width).toBe("5px");
  });

  it("zooms and wraps only the tables its fits name, and keeps atomic cells on one line", () => {
    const fits = table(800, ["2026-06-01", "fits"]);
    const wide = table(3000, ["2026-06-01", "Waiting on data schema review", "LOP-101", "42"]);
    const changed = run(pdfApplyTableFitsScript([{ zoom: 1, wrap: false }, { zoom: 0.6, wrap: true }]));
    expect(changed).toBe(1);

    expect(fits.style.zoom).toBe("");
    expect(fits.hasAttribute(PDF_WRAP_ATTR)).toBe(false);
    expect(fits.querySelectorAll(`[${PDF_NOWRAP_ATTR}]`)).toHaveLength(0);

    expect(wide.style.zoom).toBe("0.6");
    expect(wide.hasAttribute(PDF_WRAP_ATTR)).toBe(true);
    const nowrap = Array.from(wide.querySelectorAll(`td[${PDF_NOWRAP_ATTR}]`), (c) => c.textContent);
    expect(nowrap).toEqual(["2026-06-01", "LOP-101", "42"]);
  });

  it("zooms without wrapping when the fit says so", () => {
    const t = table(1500, ["2026-06-01"]);
    run(pdfApplyTableFitsScript([{ zoom: 0.7, wrap: false }]));
    expect(t.style.zoom).toBe("0.7");
    expect(t.hasAttribute(PDF_WRAP_ATTR)).toBe(false);
    expect(t.querySelectorAll(`[${PDF_NOWRAP_ATTR}]`)).toHaveLength(0);
  });

  it("reports the widest rendered table and puts the body width back", () => {
    document.body.style.width = "5px";
    table(900, ["a"]);
    table(1040, ["b"]);
    expect(run(pdfWidestScript(1062))).toBe(1040);
    expect(document.body.style.width).toBe("5px");
  });

  it("collects the head stylesheet only, never a <style> in the body", () => {
    document.head.innerHTML = "<style>a { color: red; }</style>";
    document.body.innerHTML = "<p>x</p><style>b { color: blue; }</style>";
    expect(run(PDF_COLLECT_STYLES_SCRIPT)).toBe("a { color: red; }");
  });
});
