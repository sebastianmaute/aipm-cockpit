// §752 — no non-test source under src/ calls the browser's own dialogs. `window.prompt` THROWS in the desktop
// app (Electron does not implement it), and `window.confirm` / `window.alert` freeze the page and ignore the
// app's look, focus handling and language. The app's dialogs are `usePrompt` / `useConfirm` / `useNotice`
// (confirm-dialog.tsx), or `dialogsRef` for task-manager's hooks above the provider.
// Read with the TypeScript parser, so a comment or a string that NAMES a call (confirm-dialog.tsx's own
// header shows one) is not a hit, and a call split across lines still is.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const SRC = join(process.cwd(), "src");
const NATIVE = new Set(["prompt", "confirm", "alert"]);
const GLOBALS = new Set(["window", "globalThis", "self"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.property\./.test(e.name) && !p.includes(`${join("src", "test")}`)) out.push(p);
  }
  return out;
}

/** `window.prompt(…)`, `globalThis.confirm(…)`, `self.alert(…)`, and a bare `alert(…)` — a bare `prompt` or
 *  `confirm` is the local name the dialog hooks hand out, so only `alert`, which none of them uses, is read
 *  bare. Returns "file:line call" per hit. */
function nativeDialogCalls(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name =
        ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && GLOBALS.has(callee.expression.text) && NATIVE.has(callee.name.text)
          ? `${callee.expression.text}.${callee.name.text}`
          : ts.isIdentifier(callee) && callee.text === "alert"
            ? "alert"
            : null;
      if (name) hits.push(`${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${name}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe("§752 — the browser's own dialogs are never called", () => {
  it("the scanner finds every form it is meant to, and none of the look-alikes", () => {
    const fixture = [
      `window.prompt("a");`,
      `globalThis.confirm(\n  "b",\n);`,
      `if (self.alert) self.alert("c");`,
      `alert("d");`,
      `// window.confirm("in a comment")`,
      `const s = "window.alert('in a string')";`,
      `const ok = await confirm({ message: "the app's own" });`,
      `const typed = await prompt({ message: "the app's own" });`,
      `dialogs.confirm({ message: "x" });`,
    ].join("\n");
    expect(nativeDialogCalls("fixture.ts", fixture).map((h) => h.split(" ")[1])).toEqual([
      "window.prompt", "globalThis.confirm", "self.alert", "alert",
    ]);
  });

  it("no source file under src/ calls one", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(500); // the walk really reached the app
    const hits = files.flatMap((f) => nativeDialogCalls(relative(SRC, f).split("\\").join("/"), readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
