// Final fix round 3, R3. Every exported `sanitize*` in the sanitize modules
// must be safe to pass POINT-FREE (`arr.map(sanitizeX)`, `sanitizeArr(raw,
// sanitizeX)`). `Array.prototype.map` calls its callback with (value, INDEX,
// ARRAY), and tsc accepts `arr.map(fn)` whenever fn's extra parameters accept
// those arguments. So:
//  - an OPTIONAL, defaulted or rest parameter after the first silently receives
//    the index — C1 of this batch crashed settings hydration exactly that way,
//    and `sanitizePriority(p, fallback?)` would have returned the index;
//  - a REQUIRED second parameter whose declared type admits a number also
//    compiles point-free and receives the index.
// A required second parameter whose type REJECTS a number (`today: string`,
// `ReadonlySet<number>`) is safe by construction: tsc refuses the point-free
// call. Take a second MODE as a named one-argument variant instead
// (`sanitizeLoadedMilestone`, `sanitizePriorityOr`, …).
// ★ Parsed with the TypeScript parser, never a regex — `src/test/strip-comments.ts`
//  records three hand-rolled scanners that were each wrong.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");

type Reason = "optional-extra-param" | "number-admitting-2nd-param";
interface Finding { name: string; reason: Reason }

/** Load-funnel sanitizers outside the `sanitize*` naming, scanned by name.
 *  Final fix round 4, S4: both took an optional `diag` and threw point-free. */
const EXTRA_MODULES = ["document-model.ts", "document-versions.ts"];

/** The modules the `./sanitize` barrel re-exports, plus every non-test
 *  `sanitize-*.ts` — DISCOVERED, so a new module is scanned the day it lands —
 *  plus `EXTRA_MODULES`. */
function sanitizeModules(): string[] {
  const barrel = readFileSync(join(APP, "sanitize.ts"), "utf8");
  const mods = new Set([...barrel.matchAll(/export \* from "\.\/([^"]+)"/g)].map((m) => `${m[1]}.ts`));
  for (const extra of EXTRA_MODULES) mods.add(extra);
  for (const f of readdirSync(APP)) if (/^sanitize-.*\.ts$/.test(f) && !/\.test\.ts$/.test(f)) mods.add(f);
  return [...mods].sort();
}

function admitsNumber(type: ts.TypeNode | undefined): boolean {
  if (!type) return true;
  if (type.kind === ts.SyntaxKind.NumberKeyword || type.kind === ts.SyntaxKind.UnknownKeyword || type.kind === ts.SyntaxKind.AnyKeyword) return true;
  if (ts.isLiteralTypeNode(type)) return ts.isNumericLiteral(type.literal) || ts.isPrefixUnaryExpression(type.literal);
  if (ts.isParenthesizedTypeNode(type)) return admitsNumber(type.type);
  if (ts.isUnionTypeNode(type)) return type.types.some(admitsNumber);
  return false;
}

/** Exported `sanitize*` functions of one source, each with its findings. */
function scan(fileName: string, source: string): { names: string[]; findings: Finding[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const findings: Finding[] = [];
  const check = (name: string, fn: ts.SignatureDeclarationBase) => {
    if (!name.startsWith("sanitize")) return;
    names.push(name);
    const extra = fn.parameters.slice(1);
    if (extra.some((p) => p.questionToken || p.initializer || p.dotDotDotToken)) findings.push({ name, reason: "optional-extra-param" });
    else if (extra.length > 0 && admitsNumber(extra[0].type)) findings.push({ name, reason: "number-admitting-2nd-param" });
  };
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name) check(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) check(d.name.text, init);
      }
    }
  }
  return { names, findings };
}

function scanAll(): { modules: string[]; names: string[]; findings: Finding[] } {
  const modules = sanitizeModules();
  const all = modules.map((m) => scan(m, readFileSync(join(APP, m), "utf8")));
  return { modules, names: all.flatMap((r) => r.names), findings: all.flatMap((r) => r.findings) };
}

/** ★ PINNED, NOT ENDORSED: required second parameters that predate this guard
 *  and admit a number, so a point-free pass compiles and receives the index.
 *  `sanitizeText`/`sanitizeMultiline` take a length cap every caller passes
 *  explicitly; `sanitizeLoadedResourceEmails` takes the stored list. The set is
 *  compared EXACTLY — a new member fails, and so does a removed one (delete it
 *  here when you fix it). */
const PINNED_NUMBER_ADMITTING = ["sanitizeLoadedResourceEmails", "sanitizeMultiline", "sanitizeText"];

describe("exported sanitizers are safe to pass point-free", () => {
  it("scans the real sanitize modules (non-vacuity)", () => {
    const { modules, names } = scanAll();
    expect(modules).toEqual(expect.arrayContaining(["sanitize-core.ts", "sanitize-entities.ts", "sanitize-records.ts", "sanitize-load-date.ts", ...EXTRA_MODULES]));
    expect(names).toEqual(expect.arrayContaining(["sanitizeText", "sanitizeMilestone", "sanitizeLoadedMilestone", "sanitizePriority", "sanitizeLoadedEmail", "sanitizeProjectDocuments", "sanitizeDocumentVersions"]));
    expect(names.length).toBeGreaterThanOrEqual(40);
  });

  it("no exported sanitize* has an optional, defaulted or rest parameter after the first", () => {
    const optional = scanAll().findings.filter((f) => f.reason === "optional-extra-param").map((f) => f.name);
    expect(optional).toEqual([]);
  });

  it("the required number-admitting second parameters are exactly the pinned set", () => {
    const admitting = scanAll().findings.filter((f) => f.reason === "number-admitting-2nd-param").map((f) => f.name).sort();
    expect(admitting).toEqual(PINNED_NUMBER_ADMITTING);
  });

  it("classifies each signature shape (positive controls for the scanner)", () => {
    const src = [
      "export function sanitizeA(x: unknown, fallback?: string) { return x; }",
      "export function sanitizeB(x: unknown, max: number = 3) { return x; }",
      "export const sanitizeC = (x: unknown, ...rest: unknown[]) => x;",
      "export function sanitizeD(x: unknown, max: number) { return x; }",
      "export const sanitizeE = function (x: unknown, other: unknown) { return x; };",
      "export function sanitizeF(x: unknown, today: string) { return x; }",
      "export function sanitizeG(x: unknown, ids: ReadonlySet<number>, own: number | null) { return x; }",
      "export function sanitizeH(x: unknown) { return x; }",
      "function sanitizeI(x: unknown, y?: number) { return x; }",
      "export function notASanitizer(x: unknown, y?: number) { return x; }",
    ].join("\n");
    const { names, findings } = scan("fixture.ts", src);
    expect(names).toEqual(["sanitizeA", "sanitizeB", "sanitizeC", "sanitizeD", "sanitizeE", "sanitizeF", "sanitizeG", "sanitizeH"]);
    expect(findings).toEqual([
      { name: "sanitizeA", reason: "optional-extra-param" },
      { name: "sanitizeB", reason: "optional-extra-param" },
      { name: "sanitizeC", reason: "optional-extra-param" },
      { name: "sanitizeD", reason: "number-admitting-2nd-param" },
      { name: "sanitizeE", reason: "number-admitting-2nd-param" },
    ]);
  });
});
