// @vitest-environment node
// §99 — the e2e seed derives its stores and kv keys from idb-layout.ts, so these
// tests pin the two things that derivation cannot: that the backend declares no
// key outside the layout, and that every slice in the layout reaches the seed
// with data (an empty slice is scanned on its empty state and proves nothing).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SEED_UNSEEDED_BY_DESIGN, SEED_WORKSPACE } from "../../e2e/seed-workspace";
import { IDB_CORE_KV_KEYS, IDB_ENTITY_STORES, IDB_OPTIONAL_KV_KEYS } from "./idb-layout";

const source = (file: string): string => readFileSync(join(process.cwd(), "src/app", file), "utf8");

// ★ Both scans walk the TypeScript parser's tree rather than matching text, as
// scripts/tooltip-scan-lib.mjs does: a regex missed indented declarations, nested
// generics (`idbGet<Record<string, X>>(…)`) and arguments containing a call.
function walk(text: string, visit: (node: ts.Node, sf: ts.SourceFile) => void): void {
  const sf = ts.createSourceFile("file.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const go = (node: ts.Node): void => {
    visit(node, sf);
    ts.forEachChild(node, go);
  };
  go(sf);
}

/** Every `KV_*_KEY` / `IDB_*_STORE` variable declaration, at any depth, whatever its keyword or type
 *  annotation, with its initializer's text. */
function declaredKeysIn(text: string): { name: string; rhs: string }[] {
  const out: { name: string; rhs: string }[] = [];
  walk(text, (node, sf) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    if (/^(?:KV|IDB)_\w+_(?:KEY|STORE)$/.test(node.name.text)) out.push({ name: node.name.text, rhs: node.initializer.getText(sf) });
  });
  return out;
}
const declaredKeys = (file: string): { name: string; rhs: string }[] => declaredKeysIn(source(file));

const KV_FUNCTIONS = new Set(["idbGet", "idbSet", "idbDelete"]);
/** The store handles the two files read and write keys through: `kv` (browser-backend.ts's transaction) and
 *  `store` (idb.ts's own get/set/delete). */
const KV_HANDLES = new Set(["kv", "store"]);

/** Every call that passes a kv KEY, with that key argument: `idbGet(key)` / `idbSet(key, v)` /
 *  `idbDelete(key)`, and `<handle>.get(key)` / `.delete(key)` / `.put(value, key)` on a kv handle. A record
 *  store's `store.put(item)` passes no key and is skipped. A key written inline as a string literal bypasses
 *  the KV_ constants, so the declaration scan cannot see it. ★ Still not seen: a call through a handle with
 *  another name, or a literal first bound to a variable of another name and then passed in. */
function kvKeyArgsIn(text: string): { call: string; key: ts.Expression }[] {
  const out: { call: string; key: ts.Expression }[] = [];
  walk(text, (node, sf) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    let key: ts.Expression | undefined;
    if (ts.isIdentifier(callee) && KV_FUNCTIONS.has(callee.text)) key = node.arguments[0];
    else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && KV_HANDLES.has(callee.expression.text)) {
      const method = callee.name.text;
      if (method === "get" || method === "delete") key = node.arguments[0];
      else if (method === "put") key = node.arguments[1];
    }
    if (key) out.push({ call: node.getText(sf), key });
  });
  return out;
}
const isLiteralKey = (key: ts.Expression): boolean => ts.isStringLiteralLike(key) || ts.isTemplateExpression(key);

const isPresent = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null);

describe("idb-layout — the backend declares no store or kv key of its own", () => {
  it("the declaration scan reads const, let and var at any depth, exported and type-annotated, and nothing else", () => {
    const text = [
      `const KV_A_KEY = "a";`,
      `export const IDB_B_STORE: string = "b";`,
      `const KV_C_KEY: "c" = IDB_OPTIONAL_KV_KEYS.c;`,
      `const KV_D_KEY_LIST = ["d"];`, // the name does not end in _KEY
      `export let KV_E_KEY = "e";`,
      `var IDB_F_STORE = "f";`,
      `function f() { const KV_G_KEY = "g"; return KV_G_KEY; }`,
      `class C { m() { let IDB_H_STORE = "h"; } }`,
      `// const KV_COMMENT_KEY = "c";`,
    ].join("\n");
    expect(declaredKeysIn(text)).toEqual([
      { name: "KV_A_KEY", rhs: `"a"` },
      { name: "IDB_B_STORE", rhs: `"b"` },
      { name: "KV_C_KEY", rhs: "IDB_OPTIONAL_KV_KEYS.c" },
      { name: "KV_E_KEY", rhs: `"e"` },
      { name: "IDB_F_STORE", rhs: `"f"` },
      { name: "KV_G_KEY", rhs: `"g"` },
      { name: "IDB_H_STORE", rhs: `"h"` },
    ]);
  });

  it("the kv call scan finds a literal KEY in every call shape, and nothing else", () => {
    const text = [
      `await idbGet<Plan>("plan-x");`,
      `await idbGet<Record<string, Array<() => void>>>("nested");`,
      `await idbSet('fx', wrap(value, "not-a-key"));`,
      `kv.put(wrap(value), \`k\`);`,
      `kv.put(item);`, // a record store's put: no key
      `kv.delete(KV_X_KEY);`,
      `store.get(\`t\${n}\`);`,
      `await idbSet(KV_PLAN_KEY, "a value, not a key");`,
      `await idbGet(KV_PLAN_KEY);`,
      `other.get("not a kv handle");`,
    ].join("\n");
    const found = kvKeyArgsIn(text);
    expect(found.filter((c) => isLiteralKey(c.key)).map((c) => c.call)).toEqual([
      `idbGet<Plan>("plan-x")`,
      `idbGet<Record<string, Array<() => void>>>("nested")`,
      `idbSet('fx', wrap(value, "not-a-key"))`,
      "kv.put(wrap(value), `k`)",
      "store.get(`t${n}`)",
    ]);
    expect(found).toHaveLength(8);
  });

  // ★ The floors make each case non-vacuous: idb.ts's key access is `store.get/put/delete` inside its own
  // idbGet/idbSet/idbDelete, browser-backend.ts's is `idbGet`/`idbSet` and `kv.*`. The floors sit below
  // today's counts on purpose; read the counts off `kvKeyArgsIn(source(file)).length`, not off this comment.
  it.each([
    ["idb.ts", 3],
    ["browser-backend.ts", 10],
  ] as const)("%s passes no kv key as an inline literal", (file, floor) => {
    const calls = kvKeyArgsIn(source(file));
    expect(calls.length).toBeGreaterThanOrEqual(floor); // the scan read the real calls
    expect(calls.filter((c) => isLiteralKey(c.key)).map((c) => c.call), "use a KV_ constant from idb-layout.ts, so e2e/seed.ts seeds it").toEqual([]);
  });

  it.each(["idb.ts", "browser-backend.ts"])("%s takes every store and kv key from idb-layout.ts", (file) => {
    const decls = declaredKeys(file);
    expect(decls.length).toBeGreaterThan(0); // the scan read something
    // KV_REVISION_KEY is the save revision, not a workspace slice: the seed never writes it.
    const literal = decls.filter((d) => d.name !== "KV_REVISION_KEY" && !/^IDB_(ENTITY_STORES|CORE_KV_KEYS|OPTIONAL_KV_KEYS)\.\w+$/.test(d.rhs));
    expect(literal, "declare the key in idb-layout.ts and reference it, so e2e/seed.ts seeds it").toEqual([]);
  });

  it("finds every layout entry referenced by one of the two files", () => {
    const rhs = [...declaredKeys("idb.ts"), ...declaredKeys("browser-backend.ts")].map((d) => d.rhs);
    const layout = [
      ...Object.keys(IDB_ENTITY_STORES).map((k) => `IDB_ENTITY_STORES.${k}`),
      ...Object.keys(IDB_CORE_KV_KEYS).map((k) => `IDB_CORE_KV_KEYS.${k}`),
      ...Object.keys(IDB_OPTIONAL_KV_KEYS).map((k) => `IDB_OPTIONAL_KV_KEYS.${k}`),
    ];
    expect(layout.filter((ref) => !rhs.includes(ref))).toEqual([]);
  });
});

describe("idb-layout — every slice reaches the e2e seed with data", () => {
  it("seeds every entity store", () => {
    expect(Object.keys(IDB_ENTITY_STORES).filter((k) => !isPresent(SEED_WORKSPACE[k]))).toEqual([]);
  });

  it("seeds every core kv slice", () => {
    expect(Object.keys(IDB_CORE_KV_KEYS).filter((k) => !isPresent(SEED_WORKSPACE[k]))).toEqual([]);
  });

  it("seeds every optional kv slice not listed as unseeded by design", () => {
    const missing = Object.keys(IDB_OPTIONAL_KV_KEYS).filter((k) => !(k in SEED_UNSEEDED_BY_DESIGN) && !isPresent(SEED_WORKSPACE[k]));
    expect(missing, "author it in e2e/seed-workspace.ts, or list it in SEED_UNSEEDED_BY_DESIGN with a reason").toEqual([]);
  });

  it("lists only real optional slices as unseeded, and none that the seed carries", () => {
    for (const k of Object.keys(SEED_UNSEEDED_BY_DESIGN)) {
      expect(Object.keys(IDB_OPTIONAL_KV_KEYS)).toContain(k);
      expect(SEED_WORKSPACE[k], k).toBeUndefined();
    }
  });
});
