import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { AI_ACTIVATION_SITES, AI_BACKGROUND_SITES, type AiActivationPredicate } from "../test/ai-activation-sites";

// ★ A new call of an AI activation predicate must fail this test until it is added to the table in
// `src/test/ai-activation-sites.ts`. Calls are found with the TypeScript parser, so a mention in a
// comment or string is not a site and a real call can not hide behind formatting.

const SRC = join(process.cwd(), "src");
const PREDICATES: readonly AiActivationPredicate[] = ["aiKeyIfEnabled", "isAiBackgroundEnabled", "isAiEnabled"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function predicatesCalledIn(file: string): AiActivationPredicate[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Set<AiActivationPredicate>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text as AiActivationPredicate;
      if (PREDICATES.includes(name)) found.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
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
