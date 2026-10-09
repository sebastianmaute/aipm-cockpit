// §684 — every checkbox in the app is the shared `Checkbox`, and every radio
// button takes the shared `RADIO_CLASS`. Reads each non-test `.tsx` under
// src/app with the TypeScript parser, so an element is read whole however its
// attributes are spread across lines (a regex over the text stops at the first
// `>` of an `=>` in a handler and misses what follows).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const APP = join(process.cwd(), "src", "app");
// form-controls.tsx is where the primitives themselves render the raw element.
const OWNER = "form-controls.tsx";

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) out.push(p);
  }
  return out;
}

interface Hit { file: string; line: number; kind: string; className: string }

function scan(): { files: number; checkboxUsers: number; hits: Hit[] } {
  const hits: Hit[] = [];
  let checkboxUsers = 0;
  const files = tsxFiles(APP);
  for (const f of files) {
    const rel = relative(APP, f).split("\\").join("/");
    const src = readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let usesCheckbox = false;
    const visit = (n: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        const tag = n.tagName.getText();
        if (tag === "Checkbox") usesCheckbox = true;
        if (tag === "input" && rel !== OWNER) {
          const attr = (name: string) =>
            n.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name);
          const type = attr("type")?.initializer;
          const kind = type && ts.isStringLiteral(type) ? type.text : "";
          if (kind === "checkbox" || kind === "radio") {
            hits.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
              kind,
              className: attr("className")?.initializer?.getText() ?? "",
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (usesCheckbox) checkboxUsers++;
  }
  return { files: files.length, checkboxUsers, hits };
}

describe("form-controls sweep (§684)", () => {
  const { files, checkboxUsers, hits } = scan();

  it("reads the whole app (positive control: an empty scan would pass everything)", () => {
    expect(files).toBeGreaterThan(300);
    expect(checkboxUsers).toBeGreaterThan(30);
  });

  it("renders no raw <input type=\"checkbox\"> outside form-controls.tsx", () => {
    expect(hits.filter((h) => h.kind === "checkbox").map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });

  it("gives every radio button the shared RADIO_CLASS", () => {
    const radios = hits.filter((h) => h.kind === "radio");
    expect(radios.length).toBeGreaterThan(0);
    expect(radios.filter((h) => !h.className.includes("RADIO_CLASS")).map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });
});
