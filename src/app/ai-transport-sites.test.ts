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
/** The Anthropic host as a whole host name in text: not part of a longer name on either side
 *  (`xapi.anthropic.com`, `api.anthropic.com.evil`), but allowed before a path, a port or a sentence's full stop. */
const HOST_IN_TEXT = /(^|[^A-Za-z0-9.-])api\.anthropic\.com(?![A-Za-z0-9-]|\.[A-Za-z0-9])/;
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

/** `fetch(…)`, or `fetch` reached through a global object (`globalThis.fetch`, `window.fetch`, `self.fetch`). */
function isFetchCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === "fetch";
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch";
}

/** What one source file does: names the host in a string, and/or fetches with an Anthropic URL. */
function sitesIn(sf: ts.SourceFile): { host: boolean; anthropicFetch: boolean } {
  const out = { host: false, anthropicFetch: false };
  const visit = (node: ts.Node): void => {
    if (isStringish(node) && HOST_IN_TEXT.test(node.text)) out.host = true;
    if (
      ts.isCallExpression(node) && isFetchCallee(node.expression)
      && node.arguments.length > 0 && /anthropic/i.test(node.arguments[0].getText(sf))
    ) out.anthropicFetch = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function scan(): { hostIn: string[]; anthropicFetchIn: string[] } {
  const hostIn = new Set<string>();
  const anthropicFetchIn = new Set<string>();
  for (const file of sourceFiles(APP)) {
    const rel = relative(APP, file).replaceAll("\\", "/");
    const found = sitesIn(parse(file));
    if (found.host) hostIn.add(rel);
    if (found.anthropicFetch) anthropicFetchIn.add(rel);
  }
  return { hostIn: [...hostIn].sort(), anthropicFetchIn: [...anthropicFetchIn].sort() };
}

function sitesInText(text: string) {
  return sitesIn(ts.createSourceFile("probe.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
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

  it.each(["fetch", "globalThis.fetch", "window.fetch", "self.fetch"])("the fetch rule sees %s(ANTHROPIC_URL)", (callee) => {
    expect(sitesInText(`${callee}(ANTHROPIC_URL, {});`).anthropicFetch).toBe(true);
    expect(sitesInText(`${callee}("/api/stt", {});`).anthropicFetch).toBe(false);
  });

  it.each([
    ['"https://api.anthropic.com/v1/messages"', true],
    ['"goes directly to api.anthropic.com."', true],
    ['"api.anthropic.com:443"', true],
    ['"https://xapi.anthropic.com/v1"', false],
    ['"https://api.anthropic.com.evil.example/v1"', false],
  ] as const)("the host rule matches the whole host name only: %s → %s", (literal, named) => {
    expect(sitesInText(`const u = ${literal};`).host).toBe(named);
  });

  it("a comment naming the host is not a site", () => {
    expect(sitesInText("// see https://api.anthropic.com/v1/messages\nconst x = 1;").host).toBe(false);
  });

  it("the scan sees a real site (not vacuous)", () => {
    // The transport itself must be found by both rules; a scan that found nothing would pass the rules above
    // only if the transport also vanished, which these two lines catch.
    expect(found.hostIn).toContain(TRANSPORT);
    expect(found.anthropicFetchIn).toContain(TRANSPORT);
  });
});
