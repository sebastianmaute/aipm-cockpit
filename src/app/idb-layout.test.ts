// @vitest-environment node
// §99 — the e2e seed derives its stores and kv keys from idb-layout.ts, so these
// tests pin the two things that derivation cannot: that the backend declares no
// key outside the layout, and that every slice in the layout reaches the seed
// with data (an empty slice is scanned on its empty state and proves nothing).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_UNSEEDED_BY_DESIGN, SEED_WORKSPACE } from "../../e2e/seed-workspace";
import { IDB_CORE_KV_KEYS, IDB_ENTITY_STORES, IDB_OPTIONAL_KV_KEYS } from "./idb-layout";

const source = (file: string): string => readFileSync(join(process.cwd(), "src/app", file), "utf8");

/** `const|let|var KV_X_KEY = <rhs>` and the same for `IDB_X_STORE`, exported or not, with or without a
 *  type annotation. */
function declaredKeysIn(text: string): { name: string; rhs: string }[] {
  const re = /^(?:export )?(?:const|let|var) ((?:KV|IDB)_\w+_(?:KEY|STORE))(?:\s*:\s*[^=\r\n]+?)?\s*=\s*([^;\r\n]+);/gm;
  return [...text.matchAll(re)].map((m) => ({ name: m[1], rhs: m[2] }));
}
const declaredKeys = (file: string): { name: string; rhs: string }[] => declaredKeysIn(source(file));

/** Every kv read/write call (`idbGet` / `idbSet` / `idbDelete`, and `kv.get` / `kv.put` / `kv.delete` inside a
 *  transaction), with its argument text. A key written inline as a string literal bypasses the KV_ constants,
 *  so the declaration scan above cannot see it. ★ Still not seen: a key built in a variable with another name
 *  and passed in, or a call through a differently named store handle; both would be unusual here, since every
 *  key argument in these two files is a KV_ constant today. */
function kvCallsIn(text: string): { call: string; args: string }[] {
  const re = /\b(?:idbGet|idbSet|idbDelete|kv\.(?:get|put|delete))(?:<[^>()]*>)?\(([^)]*)\)/g;
  return [...text.matchAll(re)].map((m) => ({ call: m[0], args: m[1] }));
}
const hasLiteral = (args: string): boolean => /["'`]/.test(args);

const isPresent = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null);

describe("idb-layout — the backend declares no store or kv key of its own", () => {
  it("the declaration scan reads const, let and var, exported and type-annotated, and nothing else", () => {
    const text = [
      `const KV_A_KEY = "a";`,
      `export const IDB_B_STORE: string = "b";`,
      `const KV_C_KEY: "c" = IDB_OPTIONAL_KV_KEYS.c;`,
      `const KV_D_KEY_LIST = ["d"];`, // the name does not end in _KEY
      `export let KV_E_KEY = "e";`,
      `var IDB_F_STORE = "f";`,
    ].join("\n");
    expect(declaredKeysIn(text)).toEqual([
      { name: "KV_A_KEY", rhs: `"a"` },
      { name: "IDB_B_STORE", rhs: `"b"` },
      { name: "KV_C_KEY", rhs: "IDB_OPTIONAL_KV_KEYS.c" },
      { name: "KV_E_KEY", rhs: `"e"` },
      { name: "IDB_F_STORE", rhs: `"f"` },
    ]);
  });

  it("the kv call scan finds literal keys in each call shape, and not constant ones", () => {
    const text = [
      `await idbGet<Plan>("plan-x");`,
      `await idbSet('fx', value);`,
      `kv.put(value, \`k\`);`,
      `kv.delete(KV_X_KEY);`,
      `await idbGet(KV_PLAN_KEY);`,
    ].join("\n");
    expect(kvCallsIn(text).filter((c) => hasLiteral(c.args)).map((c) => c.call)).toEqual([
      `idbGet<Plan>("plan-x")`,
      `idbSet('fx', value)`,
      "kv.put(value, `k`)",
    ]);
    expect(kvCallsIn(text)).toHaveLength(5);
  });

  it.each(["idb.ts", "browser-backend.ts"])("%s passes no kv key as an inline literal", (file) => {
    const calls = kvCallsIn(source(file));
    if (file === "browser-backend.ts") expect(calls.length).toBeGreaterThan(10); // the scan read the real calls
    expect(calls.filter((c) => hasLiteral(c.args)), "use a KV_ constant from idb-layout.ts, so e2e/seed.ts seeds it").toEqual([]);
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
