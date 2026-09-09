import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL, helpGroupOrder, MODAL_HELP } from "./help-content";
import { allNavViews } from "./nav-config";

describe("help-content backbone", () => {
  it("has unique entry ids", () => {
    const ids = HELP_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every relatedConcepts id resolves to a real entry", () => {
    const ids = new Set(HELP_ENTRIES.map((e) => e.id));
    for (const e of HELP_ENTRIES) {
      for (const r of e.relatedConcepts ?? []) expect(ids.has(r)).toBe(true);
    }
  });

  it("every relatedViews entry is a valid AppView", () => {
    const views = new Set<string>(allNavViews());
    for (const e of HELP_ENTRIES) {
      for (const v of e.relatedViews ?? []) expect(views.has(v)).toBe(true);
    }
  });

  it("every group in HELP_GROUP_ORDER has a label", () => {
    for (const g of HELP_GROUP_ORDER) expect(HELP_GROUP_LABEL[g]).toBeTruthy();
  });

  it("has the concept, workflow and automated entries", () => {
    expect(HELP_ENTRIES.filter((e) => e.group === "concepts").length).toBeGreaterThanOrEqual(10);
    expect(HELP_ENTRIES.filter((e) => e.group === "workflows").length).toBeGreaterThanOrEqual(6);
    expect(HELP_ENTRIES.filter((e) => e.group === "automated").length).toBeGreaterThanOrEqual(3);
    // ★ `features` is the bulk of the file (44 today) and was the one group
    // with no floor at all, so a mass deletion there would have passed every
    // assertion in this describe block.
    expect(HELP_ENTRIES.filter((e) => e.group === "features").length).toBeGreaterThanOrEqual(40);
  });
});

describe("concept primers", () => {
  it("every concept entry has one", () => {
    const missing = HELP_ENTRIES.filter((e) => e.group === "concepts" && !e.primerKey).map((e) => e.id);
    expect(missing).toEqual([]);
  });

  // Primers are the Guided level's whole payload. Putting one on a feature or
  // workflow entry would render it at Guided with nothing having decided what
  // it should say there.
  it("no other group has one", () => {
    const stray = HELP_ENTRIES.filter((e) => e.group !== "concepts" && e.primerKey).map((e) => e.id);
    expect(stray).toEqual([]);
  });
});

describe("helpGroupOrder", () => {
  it("gives Guided and Standard today's order", () => {
    expect(helpGroupOrder("guided")).toEqual(["concepts", "workflows", "features", "automated"]);
    expect(helpGroupOrder("standard")).toEqual(["concepts", "workflows", "features", "automated"]);
  });

  it("gives Expert reference-first order", () => {
    expect(helpGroupOrder("expert")).toEqual(["features", "automated", "workflows", "concepts"]);
  });

  // Guards the reorder against a typo that drops or duplicates a group — an
  // Expert user would silently lose a whole section of Help.
  it("covers every group exactly once at every level", () => {
    for (const level of ["guided", "standard", "expert"] as const) {
      const order = helpGroupOrder(level);
      expect([...order].sort()).toEqual([...HELP_GROUP_ORDER].sort());
      expect(new Set(order).size).toBe(order.length);
    }
  });
});

describe("MODAL_HELP", () => {
  it("maps every declared modal to an id that exists in HELP_ENTRIES", () => {
    const known = new Set(HELP_ENTRIES.map((e) => e.id));
    const entries = Object.entries(MODAL_HELP);

    // ★ ANTI-VACUITY: an empty or truncated map would satisfy the loop below
    // trivially. This floor is the positive observable -- it fails if the map
    // is emptied, and it is the reason a "0 unresolvable" result means
    // anything at all.
    expect(entries.length).toBe(18);

    const unresolvable = entries.filter(([, id]) => !known.has(id));
    expect(unresolvable).toEqual([]);
  });

  it("resolves each declared id to exactly one entry", () => {
    for (const id of Object.values(MODAL_HELP)) {
      expect(HELP_ENTRIES.filter((e) => e.id === id)).toHaveLength(1);
    }
  });

  it("wires every MODAL_HELP key to exactly one call site", () => {
    // ★★ The two tests above pin the MAP -- that each key names a real entry.
    // NOTHING pinned the WIRING. A modal that silently loses its
    // `helpConceptId`, or a MODAL_HELP key no call site references, is
    // invisible to tsc (the map still typechecks), to eslint (nothing is
    // unused -- the object is exported) and to axe (a missing help icon is
    // not a violation, just an absence). Until this test the only detector
    // was a grep nobody runs.
    //
    // ★ Recursive, mirroring `label-binding.guard.test.ts`: `src/app` is flat
    // by convention but not in fact, and a scan that skipped a subdir would be
    // a silent hole rather than a failure.
    const files = readdirSync(__dirname, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
    );

    const used = new Map<string, string[]>();
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), "utf8");
      for (const m of src.matchAll(/helpConceptId=\{MODAL_HELP\.([A-Za-z0-9_]+)\}/g)) {
        used.set(m[1], [...(used.get(m[1]) ?? []), f]);
      }
    }

    // ★★★ ANTI-VACUITY, and it is load-bearing rather than decorative: a wrong
    // directory or a filter that matches nothing yields an EMPTY scan, and an
    // empty scan satisfies... nothing here, because `used` would then be empty
    // and the key-set comparison below fails loudly. But it fails NAMING every
    // MODAL_HELP key as missing, which reads like 19 unwired modals rather
    // than a broken scan -- a diagnosis that sends the next reader to the
    // wrong 20 files. This floor makes the scan itself the thing that fails.
    // 366 non-test .tsx files today (find src/app -name "*.tsx" ! -name
    // "*.test.tsx" | wc -l); 200 is far below that and far above zero.
    expect(files.length).toBeGreaterThan(200);

    expect([...used.keys()].sort()).toEqual(Object.keys(MODAL_HELP).sort());

    // ★ One site per key. Two modals sharing a key is not necessarily wrong,
    // but it is never accidental -- make it a deliberate edit here.
    for (const [key, hits] of used) {
      expect(hits, `MODAL_HELP.${key}`).toHaveLength(1);
    }
  });
});
