// §749 — every page reload loses a secret typed under its passphrase lock and not yet sealed (`writeSettings` blanks
// it), so each reload path runs the shared durability gate first (`secretLostToReload` / `commitPortfolioModeSwitch`
// / `migrateCurrentProjectToTurso`), or is one the user starts on purpose. This lists every `location.reload()` CALL
// under src/ (read with the TypeScript parser, so comments that name one are not counted) against that reviewed
// set. A new reload fails here: gate it, then add it with the reason.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const SRC = join(process.cwd(), "src");

/** file → [reload calls, why each is safe]. */
const REVIEWED: Record<string, [number, string]> = {
  "app/portfolio-mode-switch.ts": [1, "commitPortfolioModeSwitch: refuses on the token and the Claude key first"],
  "app/portfolio-mode.ts": [1, "commitTursoPortfolioSwitch: both callers run secretLostToReload first"],
  "app/use-storage-file-ops.ts": [2, "cross-mode file load and the demo: refuseReloadLosingSecret before any write"],
  "app/use-storage-turso-ops.ts": [1, "migrateCurrentProjectToTurso: refuses on the token and the Claude key first"],
  "app/app-reset.ts": [1, "the factory reset, which the user starts on purpose and which clears every secret"],
  "app/error.tsx": [1, "the error page's Reload button, the user's own click"],
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.|\.property\./.test(e.name) && !p.includes(join("src", "test"))) out.push(p);
  }
  return out;
}

/** Calls of `location.reload` / `window.location.reload` / `globalThis.location.reload` in `text`. */
function reloadCalls(fileName: string, text: string): number {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "reload") {
      const target = node.expression.expression;
      if ((ts.isIdentifier(target) && target.text === "location") || (ts.isPropertyAccessExpression(target) && target.name.text === "location")) n += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe("§749 — every page reload is a reviewed one", () => {
  it("the scanner counts calls, not mentions", () => {
    const fixture = [
      "window.location.reload();",
      "location.reload();",
      "// window.location.reload() in a comment",
      `const s = "location.reload()";`,
      "deps.reload();",
    ].join("\n");
    expect(reloadCalls("fixture.ts", fixture)).toBe(2);
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
