// §692 — popover menu items draw through `menuItemClass`. The sweep reads the
// six menus' files with the TypeScript parser: every item <button> takes its
// class from `menuItemClass(...)`, and no hand-written item class is left.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { menuItemClass } from "./control-classes";

const APP = join(process.cwd(), "src", "app");
// file → number of menu-item buttons it renders through menuItemClass
const MENUS: Record<string, number> = {
  "task-row.tsx": 3,
  "action-cta-controls.tsx": 1,
  "notifications.tsx": 2,
  "change-edit-modal.tsx": 1,
  "rich-text-toolbar.tsx": 1,
  "export-menu.tsx": 1,
};
// A hand-written item: left-aligned text with the muted hover fill.
const HAND_ROLLED = /text-left[^"`]*hover:bg-surface-muted|hover:bg-surface-muted[^"`]*text-left/;

function buttons(file: string): { cls: string }[] {
  const path = join(APP, file);
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { cls: string }[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "button") {
      const a = n.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className");
      out.push({ cls: a?.initializer?.getText() ?? "" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("menu items (§692)", () => {
  it("defaults to the neutral tone and keeps one size", () => {
    expect(menuItemClass()).toMatch(/(^|\s)px-3(\s|$)/);
    expect(menuItemClass()).toMatch(/(^|\s)py-1\.5(\s|$)/);
    expect(menuItemClass()).toMatch(/(^|\s)text-sm(\s|$)/);
    expect(menuItemClass("danger")).toMatch(/(^|\s)text-ui-pink-strong(\s|$)/);
    expect(menuItemClass("current")).toMatch(/(^|\s)font-semibold(\s|$)/);
  });

  it.each(Object.entries(MENUS))("%s draws its items through menuItemClass", (file, expected) => {
    const all = buttons(file);
    expect(all.filter((b) => b.cls.includes("menuItemClass(")).length).toBe(expected);
    expect(all.filter((b) => HAND_ROLLED.test(b.cls)).map((b) => b.cls)).toEqual([]);
  });
});
