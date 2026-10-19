// §749 — every page reload loses a secret typed under its passphrase lock and not yet sealed (`writeSettings` blanks
// it), so each reload path runs the shared durability gate first (`secretLostToReload` / `commitPortfolioModeSwitch`
// / `migrateCurrentProjectToTurso`), or is one the user starts on purpose. This lists every `location.reload()`,
// `location.assign(…)` and `location.replace(…)` CALL under src/ — each reboots the app — read with the TypeScript
// parser, so comments and strings that name one are not counted, against that reviewed set. A new one fails here:
// gate it, then add it with the reason.
// ★ Not seen (none exists today; say so if you add one): an alias (`const r = location.reload; r()`), a local
//   (`const loc = window.location; loc.reload()`), an element access (`window["location"].reload()`), and a
//   reboot by assignment (`location.href = "/"`). The `location.href =` writes under src/ are mailto links, which
//   do not navigate the page.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const SRC = join(process.cwd(), "src");
const REBOOTS = new Set(["reload", "assign", "replace"]);

/** file → [reboot calls, why each is safe]. */
const REVIEWED: Record<string, [number, string]> = {
  "app/portfolio-mode-switch.ts": [1, "commitPortfolioModeSwitch: refuses on the token and the Claude key first"],
  "app/portfolio-mode.ts": [1, "commitTursoPortfolioSwitch: both callers run secretLostToReload first"],
  "app/use-storage-file-ops.ts": [2, "cross-mode file load and the demo: refuseReloadLosingSecret before any write"],
  "app/use-storage-turso-ops.ts": [1, "migrateCurrentProjectToTurso: refuses on the token and the Claude key first"],
  "app/app-reset.ts": [1, "the factory reset, which the user starts on purpose and which clears every secret"],
  "app/error.tsx": [1, "the error page's Reload button, the user's own click"],
  "app/error-boundary.tsx": [1, "the crash screen's reset, the user's own click (location.assign)"],
  "app/recovery-banner.tsx": [1, "the recovery banner's way back into the app, the user's own click (location.assign)"],
  "app/recovery-panel.tsx": [1, "the recovery page's way back into the app, the user's own click (location.assign)"],
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.property\./.test(e.name) && !p.includes(join("src", "test"))) out.push(p);
  }
  return out;
}

/** Calls of `reload` / `assign` / `replace` on `location` (bare, or `window.` / `globalThis.` / `document.` /
 *  `(window as …).`) in `text`. */
function reloadCalls(fileName: string, text: string): number {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && REBOOTS.has(node.expression.name.text)) {
      const target = node.expression.expression;
      if ((ts.isIdentifier(target) && target.text === "location") || (ts.isPropertyAccessExpression(target) && target.name.text === "location")) n += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe("§749 — every page reload or reboot is a reviewed one", () => {
  it("the scanner counts calls, not mentions", () => {
    const fixture = [
      "window.location.reload();",
      "location.reload();",
      "globalThis.location.reload();",
      "(window as unknown as Window).location.reload();",
      'window.location.assign("/");',
      'location.replace("/recovery");',
      "// window.location.reload() in a comment",
      `const s = "location.reload()";`,
      "deps.reload();",
      'url.replace("a", "b");',
      'router.replace("/x");',
    ].join("\n");
    expect(reloadCalls("fixture.ts", fixture)).toBe(6);
  });

  it("matches the reviewed set exactly", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(500); // the walk really reached the app
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = reloadCalls(f, readFileSync(f, "utf8"));
      if (n > 0) found[relative(SRC, f).split("\\").join("/")] = n;
    }
    const expected = Object.fromEntries(Object.entries(REVIEWED).map(([f, [n]]) => [f, n]));
    expect(found).toEqual(expected);
  });
});
