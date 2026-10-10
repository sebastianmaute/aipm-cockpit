// §685/§686 — every text field, select and textarea in src/app is a form
// primitive (`Input`/`Select`/`Textarea`) unless its file is one of the
// recorded exceptions below. Reads each non-test `.tsx` with the TypeScript
// parser, so an element is read whole.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const APP = join(process.cwd(), "src", "app");

// file → how many raw fields it keeps, and why. The count is exact, so a NEW raw
// field in an exempt file fails too. Changing a count or adding a file is a
// decision: say why.
const EXCEPTIONS: Record<string, { count: number; why: string }> = {
  "form-controls.tsx": { count: 3, why: "the primitives themselves" },
  // These share the primitives' exact shell through an `inputClass = fieldClass(...)` local.
  "budget-bucket-modal.tsx": { count: 13, why: "fieldClass local" },
  "bulk-edit-modal.tsx": { count: 9, why: "fieldClass local" },
  "jira-settings.tsx": { count: 6, why: "fieldClass local" },
  "project-form-fields.tsx": { count: 26, why: "fieldClass local" },
  // Input/Select/Textarea do not forward a ref (docs/AGENTS/theming.md).
  "chat-panel.tsx": { count: 1, why: "holds a ref" },
  "combo-input.tsx": { count: 1, why: "holds a ref" },
  "global-search-box.tsx": { count: 1, why: "holds a ref" },
  "inline-ai-edit-popover.tsx": { count: 1, why: "holds a ref" },
  "labels-input.tsx": { count: 1, why: "holds a ref" },
  "resource-picker.tsx": { count: 1, why: "holds a ref" },
  "help-menu.tsx": { count: 1, why: "deliberately bespoke window (docs/AGENTS/theming.md)" },
  "change-status-select.tsx": { count: 1, why: "coloured by the status it shows" },
  "task-status-select.tsx": { count: 1, why: "coloured by the status it shows" },
  "report-table.tsx": { count: 1, why: "TableFilter, a table primitive" },
};
// Input types that are not text fields.
const NOT_TEXT = new Set(["checkbox", "radio", "file", "hidden", "range", "color"]);

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) out.push(p);
  }
  return out;
}

function scan(): { files: number; primitiveUses: number; raw: string[]; exempt: Record<string, number> } {
  const raw: string[] = [];
  const exempt: Record<string, number> = {};
  let primitiveUses = 0;
  const files = tsxFiles(APP);
  for (const f of files) {
    const rel = relative(APP, f).split("\\").join("/");
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        const tag = n.tagName.getText();
        if (tag === "Input" || tag === "Select" || tag === "Textarea") primitiveUses++;
        if (tag === "input" || tag === "select" || tag === "textarea") {
          const typeAttr = n.attributes.properties.find(
            (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === "type",
          );
          const type = typeAttr?.initializer && ts.isStringLiteral(typeAttr.initializer) ? typeAttr.initializer.text : "";
          // A spread from a picker hook (`{...boxPicker.inputProps}`) is FilePickerButton's hidden input.
          const spreadOnly = n.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a) && /inputProps/.test(a.getText()));
          const base = rel.split("/").pop() ?? rel;
          if (!NOT_TEXT.has(type) && !spreadOnly) {
            if (base in EXCEPTIONS) exempt[base] = (exempt[base] ?? 0) + 1;
            else raw.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} <${tag}>`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { files: files.length, primitiveUses, raw, exempt };
}

describe("form fields sweep (§685/§686)", () => {
  const { files, primitiveUses, raw } = scan();

  it("reads the whole app (positive control)", () => {
    expect(files).toBeGreaterThan(300);
    expect(primitiveUses).toBeGreaterThan(200);
  });

  it("renders no raw text field, select or textarea outside the recorded exceptions", () => {
    expect(raw).toEqual([]);
  });
});

describe("form fields sweep — exceptions (§685)", () => {
  it("keeps exactly the recorded number of raw fields in each exempt file", () => {
    const { exempt } = scan();
    const expected = Object.fromEntries(Object.entries(EXCEPTIONS).map(([f, e]) => [f, e.count]));
    expect(exempt).toEqual(expected);
  });
});
