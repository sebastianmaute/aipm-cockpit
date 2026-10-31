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

/** The files that may build a privacy with `aiPrivacyFor`, and why. Every other file is handed one. */
const PRIVACY_BUILDERS: Readonly<Record<string, string>> = {
  "src/app/ai-privacy-context.tsx": "the open project's getter (useOpenProjectAiPrivacy) builds it from the registered source",
  "src/app/scheduled-job-run.ts": "a scheduled job sends the TARGET project's data, so it builds that project's privacy",
  "src/app/use-project-proposal.ts": UNPROTECTED_ALLOWED["src/app/use-project-proposal.ts"]!,
};

interface PrivacyValue {
  file: string;
  line: number;
  expr: ts.Expression;
  /** Names bound in this file to `useOpenProjectAiPrivacy()`, and refs holding one (`useRef(getter)`). */
  getters: ReadonlySet<string>;
  getterRefs: ReadonlySet<string>;
}

/** Every value a source file hands on as a privacy: each `privacy:` property (or shorthand) of an object literal,
 *  and `callClaude`'s positional privacy argument. */
function privacyValues(): PrivacyValue[] {
  const out: PrivacyValue[] = [];
  for (const full of sourceFiles(SRC)) {
    const file = relative(process.cwd(), full).replace(/\\/g, "/");
    if (DEFINING_FILES.has(file) || file === "src/app/ai-privacy.ts") continue;
    const sf = parse(full);
    const getters = new Set<string>();
    const getterRefs = new Set<string>();
    const values: ts.Expression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "useOpenProjectAiPrivacy") {
          getters.add(node.name.text);
        }
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "useRef"
          && init.arguments.length === 1 && ts.isIdentifier(init.arguments[0]!) && getters.has(init.arguments[0].text)) {
          getterRefs.add(node.name.text);
        }
      }
      if (ts.isPropertyAssignment(node) && node.name.getText() === "privacy" && ts.isObjectLiteralExpression(node.parent)) values.push(node.initializer);
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === "privacy") values.push(node.name);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "callClaude") {
        const arg = node.arguments[CALL_CLAUDE_PRIVACY_INDEX];
        if (arg) values.push(arg);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const expr of values) out.push({ file, line: sf.getLineAndCharacterOfPosition(expr.getStart()).line + 1, expr, getters, getterRefs });
  }
  return out;
}

/** Threaded: a call of this file's `useOpenProjectAiPrivacy()` getter (directly or through `ref.current()` of a
 *  ref that holds it), a value named `privacy` (a parameter or a
 *  caller's `x.privacy`), or `aiPrivacyFor(…)` in a listed builder. Anything else was made up on the spot. */
function isThreadedPrivacy(v: PrivacyValue): boolean {
  const e = unwrap(v.expr);
  if (ts.isIdentifier(e)) return e.text === "privacy";
  if (ts.isPropertyAccessExpression(e)) return e.name.text === "privacy";
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    if (v.getters.has(e.expression.text)) return e.arguments.length === 0;
    if (e.expression.text === "aiPrivacyFor") return v.file in PRIVACY_BUILDERS;
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "current"
    && ts.isIdentifier(e.expression.expression)) {
    return v.getterRefs.has(e.expression.expression.text) && e.arguments.length === 0;
  }
  return false;
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

  // Task 8 fix round 1 (I3): the call-site checks above see only the argument of `callClaude` / `runForcedToolCall*`.
  // A hook that hands its `*-call` function `privacy: aiPrivacyFor([])` (or any value built on the spot) one hop up
  // passed them all, and the wire test, which drives the call functions with a real privacy, cannot see it either.
  it("only the listed files build a privacy with aiPrivacyFor", () => {
    const found = new Set<string>();
    for (const full of sourceFiles(SRC)) {
      const file = relative(process.cwd(), full).replace(/\\/g, "/");
      const sf = parse(full);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "aiPrivacyFor") found.add(file);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect([...found].sort()).toEqual(Object.keys(PRIVACY_BUILDERS).sort());
  });

  it("every privacy handed to a call is threaded: the open-project getter, a privacy parameter, or a listed builder", () => {
    const values = privacyValues();
    // Anti-vacuity: every call site, plus the hooks' and runners' `privacy:` properties (26 when this was written).
    expect(values.length).toBeGreaterThanOrEqual(25);
    const bad = values.filter((v) => !isThreadedPrivacy(v)).map((v) => `${v.file}:${v.line} ${v.expr.getText()}`);
    expect(bad).toEqual([]);
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
