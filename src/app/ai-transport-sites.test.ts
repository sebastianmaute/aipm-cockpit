import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// ★ Every browser call to Anthropic goes through `ai-transport.ts`, which checks the deployment's AI
// setting before each send and picks the direct or relayed route. This test fails when another file
// under `src/app` names the Anthropic host in code, or calls `fetch` with an Anthropic URL. Strings are
// found with the TypeScript parser, so a mention in a comment is not a site and a real one can not hide
// behind formatting.
//
// Allowed besides the transport: the user-facing text files, whose disclosure copy names the host.
// Outside the scan on purpose: `scripts/ai-eval.ts`, a developer script run from a terminal with its
// own key, never part of the app. `src/proxy.ts` (CSP) sits outside `src/app` and names the host as a
// policy entry, not a call.

const APP = join(process.cwd(), "src", "app");
const HOST = "api.anthropic.com";
const TRANSPORT = "ai-transport.ts";
const TEXT_FILES = ["i18n.ts", "i18n.de.ts"];
const EXCLUDED_DEV_SCRIPTS = ["scripts/ai-eval.ts"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  const text = readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function isStringish(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
}

function scan(): { hostIn: string[]; anthropicFetchIn: string[] } {
  const hostIn = new Set<string>();
  const anthropicFetchIn = new Set<string>();
  for (const file of sourceFiles(APP)) {
    const rel = relative(APP, file).replaceAll("\\", "/");
    const visit = (node: ts.Node): void => {
      if (isStringish(node) && node.text.includes(HOST)) hostIn.add(rel);
      if (
        ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch"
        && node.arguments.length > 0 && /anthropic/i.test(node.arguments[0].getText())
      ) anthropicFetchIn.add(rel);
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return { hostIn: [...hostIn].sort(), anthropicFetchIn: [...anthropicFetchIn].sort() };
}

describe("AI transport sites", () => {
  const found = scan();

  it("names the Anthropic host in code only in the transport and the text files", () => {
    expect(found.hostIn).toEqual([TRANSPORT, ...TEXT_FILES].sort());
  });

  it("calls fetch with an Anthropic URL only in the transport", () => {
    expect(found.anthropicFetchIn).toEqual([TRANSPORT]);
  });

  it("the named developer-script exclusions still exist (drop a gone one from the list)", () => {
    for (const f of EXCLUDED_DEV_SCRIPTS) expect(existsSync(join(process.cwd(), f)), f).toBe(true);
  });

  it("the scan sees a real site (not vacuous)", () => {
    // The transport itself must be found by both rules; a scan that found nothing would pass the rules above
    // only if the transport also vanished, which these two lines catch.
    expect(found.hostIn).toContain(TRANSPORT);
    expect(found.anthropicFetchIn).toContain(TRANSPORT);
  });
});
