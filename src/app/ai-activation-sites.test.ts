import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { AI_ACTIVATION_SITES, AI_BACKGROUND_SITES, AI_RAW_KEY_READERS, LIVE_AI_KEY_CALLERS, type AiActivationPredicate } from "../test/ai-activation-sites";

// ★ A new call of an AI activation predicate must fail this test until it is added to the table in
// `src/test/ai-activation-sites.ts`. Calls are found with the TypeScript parser, so a mention in a
// comment or string is not a site and a real call can not hide behind formatting, an import alias
// (`import { isAiEnabled as on }`) or a namespace import (`settings.isAiEnabled(…)`).

const SRC = join(process.cwd(), "src");
const PREDICATES: readonly AiActivationPredicate[] = ["aiKeyIfEnabled", "isAiBackgroundEnabled", "isAiEnabled"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function parse(file: string, text = readFileSync(file, "utf8")): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** The name a call resolves to: `f(…)` → f (through an import alias to the imported name), `ns.f(…)` → f. */
function calledNames(sf: ts.SourceFile): string[] {
  const aliases = new Map<string, string>();
  for (const st of sf.statements) {
    const bindings = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (el.propertyName) aliases.set(el.name.text, el.propertyName.text);
    }
  }
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if (ts.isIdentifier(e)) out.push(aliases.get(e.text) ?? e.text);
      else if (ts.isPropertyAccessExpression(e)) out.push(e.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function predicatesCalledIn(file: string, text?: string): AiActivationPredicate[] {
  const names = calledNames(parse(file, text));
  return PREDICATES.filter((p) => names.includes(p));
}

/** Whether the file reads the stored key directly: `ai.apiKey` or `<x>.ai.apiKey` (optional chaining included). */
function readsRawKey(file: string, text?: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "apiKey") {
      const owner = node.expression;
      if ((ts.isIdentifier(owner) && owner.text === "ai") || (ts.isPropertyAccessExpression(owner) && owner.name.text === "ai")) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return found;
}

function scan(): Record<string, AiActivationPredicate[]> {
  const out: Record<string, AiActivationPredicate[]> = {};
  for (const file of sourceFiles(SRC)) {
    const found = predicatesCalledIn(file);
    if (found.length > 0) out[relative(SRC, file).replaceAll("\\", "/")] = found;
  }
  return out;
}

describe("AI activation sites", () => {
  it("finds a predicate called through an import alias or a namespace import", () => {
    const aliased = `import { isAiEnabled as on } from "./settings-types";
export const x = on(a);`;
    const namespaced = `import * as st from "./settings-types";
export const y = st.aiKeyIfEnabled(a);`;
    expect(predicatesCalledIn("a.ts", aliased)).toEqual(["isAiEnabled"]);
    expect(predicatesCalledIn("b.ts", namespaced)).toEqual(["aiKeyIfEnabled"]);
    expect(predicatesCalledIn("c.ts", `// isAiEnabled(a)
const s = "isAiEnabled(a)";`)).toEqual([]);
  });

  it("finds a direct key read, with or without optional chaining", () => {
    expect(readsRawKey("a.ts", "const k = settings.ai.apiKey;")).toBe(true);
    expect(readsRawKey("b.ts", "const k = s.ai?.apiKey;")).toBe(true);
    expect(readsRawKey("c.ts", "const k = ai.apiKey;")).toBe(true);
    expect(readsRawKey("d.ts", "const k = jira.apiKey; // ai.apiKey")).toBe(false);
  });

  it("lists every file that reads the stored AI key directly, so a new reader is reviewed", () => {
    const readers = sourceFiles(SRC).filter((f) => readsRawKey(f)).map((f) => relative(SRC, f).replaceAll("\\", "/")).sort();
    expect(readers).toEqual([...AI_RAW_KEY_READERS].sort());
  });

  it("calls the ungated `liveAiKey` only where the predicates are defined", () => {
    const callers = sourceFiles(SRC).filter((f) => calledNames(parse(f)).includes("liveAiKey")).map((f) => relative(SRC, f).replaceAll("\\", "/"));
    expect(callers.sort()).toEqual([...LIVE_AI_KEY_CALLERS].sort());
  });

  it("lists every file that calls an AI activation predicate, and which one", () => {
    const expected = Object.fromEntries(Object.entries(AI_ACTIVATION_SITES).map(([f, p]) => [f, [...p].sort()]));
    expect(scan()).toEqual(expected);
  });

  it("keeps the three background runners on the background predicate", () => {
    expect(AI_BACKGROUND_SITES).toHaveLength(3);
    for (const file of AI_BACKGROUND_SITES) {
      expect(AI_ACTIVATION_SITES[file], file).toContain("isAiBackgroundEnabled");
    }
  });

  it("the runners' own call sites do not ask the interactive predicate for their enabled flag", () => {
    // The orchestration and recommendation files still use aiKeyIfEnabled for the key, but the
    // `enabled:` of the background runner must not fall back to the interactive predicate.
    for (const file of ["app/use-ai-orchestration.ts", "app/use-insight-recommendations.ts"]) {
      const text = readFileSync(join(SRC, file), "utf8");
      const enabledLines = text.split(/\r?\n/).filter((l) => /^\s*enabled:.*(scheduledJobs|insightRecommendations)/.test(l));
      expect(enabledLines.length, file).toBeGreaterThan(0);
      for (const l of enabledLines) expect(l, file).toContain("isAiBackgroundEnabled(");
    }
  });
});
