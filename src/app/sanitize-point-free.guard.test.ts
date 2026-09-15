// Final fix round 3, R3. Every exported `sanitize*` in the sanitize modules
// must be safe to pass POINT-FREE (`arr.map(sanitizeX)`, `sanitizeArr(raw,
// sanitizeX)`). `Array.prototype.map` calls its callback with (value, INDEX,
// ARRAY), and tsc accepts `arr.map(fn)` whenever fn's extra parameters accept
// those arguments. So:
//  - an OPTIONAL, defaulted or rest parameter after the first silently receives
//    the index — C1 of this batch crashed settings hydration exactly that way,
//    and `sanitizePriority(p, fallback?)` would have returned the index;
//  - a REQUIRED second parameter whose type admits a number also compiles
//    point-free and receives the index.
// Take a second MODE as a named one-argument variant instead
// (`sanitizeLoadedMilestone`, `sanitizePriorityOr`, …).
// ★★ Final fix round 4, S5: the scanner does NOT read the parameter's type.
//  A syntactic check missed `type Cap = number`, `{}` and a generic `T` (all
//  admit a number), so ANY second parameter is flagged, and every required one
//  must be on one of the two reviewed lists below. The reject-a-number claim
//  for the second list is checked by tsc (`reviewedListRejectsPointFree`).
// ★ Parsed with the TypeScript parser, never a regex — `src/test/strip-comments.ts`
//  records three hand-rolled scanners that were each wrong.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sanitizeDependencies, sanitizeEmailList, sanitizePlan, sanitizePriorityOr } from "./sanitize";
import { sanitizeProjectDocumentsWithDiag } from "./document-model";
import { sanitizeDocumentVersionsWithDiag } from "./document-versions";

const APP = join(process.cwd(), "src", "app");

type Reason = "optional-extra-param" | "second-param" | "unresolved-export";
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

type Fn = ts.SignatureDeclarationBase;

/** Function-valued top-level declarations of one source, exported or not, by
 *  local name — what an `export { a, b as c }` list resolves against. */
function localFunctions(sf: ts.SourceFile): Map<string, Fn> {
  const out = new Map<string, Fn>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) out.set(st.name.text, st);
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) out.set(d.name.text, init);
    }
  }
  return out;
}

/** Exported `sanitize*` functions of one source, each with its findings. */
function scan(fileName: string, source: string): { names: string[]; findings: Finding[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const locals = localFunctions(sf);
  const names: string[] = [];
  const findings: Finding[] = [];
  const check = (name: string, fn: Fn | undefined) => {
    if (!name.startsWith("sanitize")) return;
    names.push(name);
    // A re-export from another module, or a name bound to a non-function
    // expression: its signature is not in this file, so it cannot be cleared.
    if (!fn) return void findings.push({ name, reason: "unresolved-export" });
    const extra = fn.parameters.slice(1);
    if (extra.some((p) => p.questionToken || p.initializer || p.dotDotDotToken)) findings.push({ name, reason: "optional-extra-param" });
    else if (extra.length > 0) findings.push({ name, reason: "second-param" });
  };
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        check(el.name.text, st.moduleSpecifier ? undefined : locals.get((el.propertyName ?? el.name).getText(sf)));
      }
      continue;
    }
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

/** Reviewed: a REQUIRED second parameter whose type rejects a number, so tsc
 *  refuses a point-free pass. That claim is not taken on trust — each name is
 *  passed point-free under `@ts-expect-error` below, so `npx tsc --noEmit`
 *  fails the day one of them starts compiling. Compared EXACTLY, like the
 *  pinned set. */
const REVIEWED_REJECTS_NUMBER = [
  "sanitizeDependencies",
  "sanitizeDocumentVersionsWithDiag",
  "sanitizeEmailList",
  "sanitizePlan",
  "sanitizePriorityOr",
  "sanitizeProjectDocumentsWithDiag",
];

/** Never called: it exists for tsc. vitest does not typecheck. */
export function reviewedListRejectsPointFree(xs: unknown[]): void {
  // @ts-expect-error the array (map's 3rd argument) is not a number | null
  xs.map(sanitizeDependencies);
  // @ts-expect-error the index has no property of DocTruncationDiag
  xs.map(sanitizeDocumentVersionsWithDiag);
  // @ts-expect-error the index is not a string
  xs.map(sanitizeEmailList);
  // @ts-expect-error the index is not a string
  xs.map(sanitizePlan);
  // @ts-expect-error the index is not a Priority
  xs.map(sanitizePriorityOr);
  // @ts-expect-error the index has no property of DocTruncationDiag
  xs.map(sanitizeProjectDocumentsWithDiag);
}

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

  it("every required second parameter is on exactly one reviewed list", () => {
    const second = scanAll().findings.filter((f) => f.reason === "second-param").map((f) => f.name).sort();
    expect(second).toEqual([...PINNED_NUMBER_ADMITTING, ...REVIEWED_REJECTS_NUMBER].sort());
  });

  it("every exported sanitize* resolves to a signature in its own module", () => {
    expect(scanAll().findings.filter((f) => f.reason === "unresolved-export")).toEqual([]);
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
      // S5: the shapes a type-syntax check missed, and export lists.
      "type Cap = number;",
      "export function sanitizeJ(x: unknown, max: Cap) { return x; }",
      "export function sanitizeK(x: unknown, o: {}) { return x; }",
      "export function sanitizeL<T>(x: unknown, t: T) { return x; }",
      "function sanitizeM(x: unknown, y?: number) { return x; }",
      "const helper = (x: unknown, n: number) => x;",
      "function sanitizeP(x: unknown) { return x; }",
      "export { sanitizeM, helper as sanitizeN, sanitizeP };",
      "export { sanitizeO } from \"./elsewhere\";",
    ].join("\n");
    const { names, findings } = scan("fixture.ts", src);
    expect(names).toEqual([
      "sanitizeA", "sanitizeB", "sanitizeC", "sanitizeD", "sanitizeE", "sanitizeF", "sanitizeG", "sanitizeH",
      "sanitizeJ", "sanitizeK", "sanitizeL", "sanitizeM", "sanitizeN", "sanitizeP", "sanitizeO",
    ]);
    expect(findings).toEqual([
      { name: "sanitizeA", reason: "optional-extra-param" },
      { name: "sanitizeB", reason: "optional-extra-param" },
      { name: "sanitizeC", reason: "optional-extra-param" },
      { name: "sanitizeD", reason: "second-param" },
      { name: "sanitizeE", reason: "second-param" },
      { name: "sanitizeF", reason: "second-param" },
      { name: "sanitizeG", reason: "second-param" },
      { name: "sanitizeJ", reason: "second-param" },
      { name: "sanitizeK", reason: "second-param" },
      { name: "sanitizeL", reason: "second-param" },
      { name: "sanitizeM", reason: "optional-extra-param" },
      { name: "sanitizeN", reason: "second-param" },
      { name: "sanitizeO", reason: "unresolved-export" },
    ]);
  });
});
