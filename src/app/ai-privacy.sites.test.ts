import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import * as aiPrivacy from "./ai-privacy";

// AI people protection, Task 4 (spec R3): every AI call site names the privacy of the project(s)
// whose data it sends. Calls are found with the TypeScript parser, so a mention in a comment or a
// string is not a site, and a real call cannot hide behind formatting.
//
// The send functions: `callClaude` takes `privacy` as its 6th positional argument (right after
// `toolFlags`); the `runForcedToolCall*` family takes it as a property of its args object. The
// module that DEFINES the forced-call family re-passes `args` through itself and is not a site.

const SRC = join(process.cwd(), "src");
const FORCED = new Set(["runForcedToolCall", "runForcedToolCallWithStop", "runForcedToolCallWithRetry"]);
const CALL_CLAUDE_PRIVACY_INDEX = 5;
const DEFINING_FILES = new Set(["src/app/ai-forced-call.ts", "src/app/chat-api.ts"]);

/** The one site allowed to send unprotected, and why. */
const UNPROTECTED_ALLOWED: Readonly<Record<string, string>> = {
  "src/app/use-project-proposal.ts":
    "the create-project wizard has no workspace yet, so no people: it passes aiPrivacyFor([]), which is { protected: false }",
};

interface Site {
  file: string;
  line: number;
  callee: string;
  privacy: ts.Expression | undefined;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  const text = readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function privacyProperty(arg: ts.Expression | undefined): ts.Expression | undefined {
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return undefined;
  for (const p of arg.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === "privacy") return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === "privacy") return p.name;
  }
  return undefined;
}

function scanSites(): Site[] {
  const out: Site[] = [];
  for (const full of sourceFiles(SRC)) {
    const file = relative(process.cwd(), full).replace(/\\/g, "/");
    if (DEFINING_FILES.has(file)) continue;
    const sf = parse(full);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (callee === "callClaude") out.push({ file, line, callee, privacy: node.arguments[CALL_CLAUDE_PRIVACY_INDEX] });
        else if (FORCED.has(callee)) out.push({ file, line, callee, privacy: privacyProperty(node.arguments[0]) });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const unwrap = (e: ts.Expression): ts.Expression => {
  let cur = e;
  while (ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
};

/** `{ protected: false }` written out as a literal. */
function isUnprotectedLiteral(e: ts.Expression): boolean {
  const u = unwrap(e);
  if (!ts.isObjectLiteralExpression(u)) return false;
  return u.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === "protected" && p.initializer.kind === ts.SyntaxKind.FalseKeyword);
}

/** `aiPrivacyFor([])` — a request for no project, i.e. unprotected. */
function isEmptyProjectList(e: ts.Expression): boolean {
  const u = unwrap(e);
  return ts.isCallExpression(u) && ts.isIdentifier(u.expression) && u.expression.text === "aiPrivacyFor"
    && u.arguments.length === 1 && ts.isArrayLiteralExpression(u.arguments[0]) && u.arguments[0].elements.length === 0;
}

describe("every AI call site supplies the privacy of the project it sends (spec R3)", () => {
  const sites = scanSites();

  it("finds the call sites (anti-vacuity floor)", () => {
    // 13 sites when this was written: chat, inline edit, and the eleven forced-tool features.
    expect(sites.length).toBeGreaterThanOrEqual(13);
    expect(sites.some((s) => s.callee === "callClaude")).toBe(true);
    expect(sites.some((s) => FORCED.has(s.callee))).toBe(true);
  });

  it("every site passes a privacy argument", () => {
    const missing = sites.filter((s) => s.privacy === undefined).map((s) => `${s.file}:${s.line} ${s.callee}`);
    expect(missing).toEqual([]);
  });

  it("no site passes the temporary placeholder", () => {
    const bad = sites
      .filter((s) => s.privacy !== undefined && unwrap(s.privacy).getText() === "PRIVACY_NOT_YET_THREADED")
      .map((s) => `${s.file}:${s.line}`);
    expect(bad).toEqual([]);
  });

  it("no site passes a literal { protected: false }", () => {
    const bad = sites.filter((s) => s.privacy !== undefined && isUnprotectedLiteral(s.privacy)).map((s) => `${s.file}:${s.line}`);
    expect(bad).toEqual([]);
  });

  // A site passing `ai.privacy` would pass the check above with an unprotected value built one hop
  // up. Only `ai-privacy.ts` (the type and `aiPrivacyFor` itself) may write the literal.
  it("no source file outside ai-privacy.ts writes a { protected: false } literal", () => {
    const bad: string[] = [];
    for (const full of sourceFiles(SRC)) {
      const file = relative(process.cwd(), full).replace(/\\/g, "/");
      if (file === "src/app/ai-privacy.ts") continue;
      const sf = parse(full);
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node) && isUnprotectedLiteral(node)) {
          bad.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(bad).toEqual([]);
  });

  it("only the listed site sends for no project at all, and it does", () => {
    const empty = sites.filter((s) => s.privacy !== undefined && isEmptyProjectList(s.privacy)).map((s) => s.file);
    expect(empty.sort()).toEqual(Object.keys(UNPROTECTED_ALLOWED).sort());
  });

  it("the temporary placeholder is no longer exported", () => {
    expect("PRIVACY_NOT_YET_THREADED" in aiPrivacy).toBe(false);
  });

  it("no source file names the temporary placeholder", () => {
    const named = sourceFiles(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("PRIVACY_NOT_YET_THREADED"))
      .map((f) => relative(process.cwd(), f).replace(/\\/g, "/"));
    expect(named).toEqual([]);
  });
});
