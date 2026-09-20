/**
 * One-off regeneration of `src/app/__fixtures__/golden-workspace.{csv,md}` from
 * the curated master, for the ONE case AGENTS.md sanctions: the master's own
 * content legitimately changed. A `golden-workspace.test` failure with an
 * UNCHANGED master means the storage byte format moved — that is the bug the
 * fixtures exist to catch, and regenerating would erase the evidence.
 *
 *   npx vite-node scripts/regen-golden-fixtures.ts
 *
 * ★★★ IT MUST INSTALL A DOM BEFORE DECODING, AND MUST ASSERT THE DECODE IS
 * NON-EMPTY. `jsonToWorkspace` sanitises rich text through DOMPurify and, with
 * no `document` in scope, returns an EMPTY workspace rather than throwing.
 * Measured 2026-09-20: a first cut of this script ran under bare vite-node,
 * printed "regenerated golden fixtures", exited 0, and wrote fixtures for a
 * workspace of ZERO tasks — deleting 126 CSV rows and 653 Markdown lines. A
 * silent truncation that reports success is exactly the shape the golden files
 * are meant to stop, so the guard below is the point of the script, not a
 * nicety. Never remove it, and never widen it into a warning.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.Node = dom.window.Node;
g.DOMParser = dom.window.DOMParser;

const { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } = await import("../src/app/storage");

const repoRoot = join(import.meta.dirname, "..");
const fixturesDir = join(repoRoot, "src", "app", "__fixtures__");
const sample = readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8");
const ws = jsonToWorkspace(sample);

// ★★★ THE GUARD, AND IT IS DISCOVERED FROM THE MASTER RATHER THAN LISTED.
// A first cut named THREE slices — tasks, raid, milestones — while the master
// carries many more non-empty ones (18 on 2026-09-20; the success line below
// prints today's, so do not trust this number), so a decode that lost any of
// the rest wrote truncated fixtures and exited 0 with a success message: the
// exact shape the docstring above says this guard exists to prevent, surviving
// inside the guard itself. A hardcoded list also silently under-covers every
// slice added after it was written; walking the master cannot.
const rawSlices = JSON.parse(sample) as Record<string, unknown>;
const decoded = ws as unknown as Record<string, unknown>;
// Every top-level key the master authors as a NON-EMPTY array. Non-array keys are
// out of scope: they have no row count to lose, and the empty-decode case this
// catches empties the arrays too. ★ There are seven of them, not the three this
// comment used to name (`plan`, `fxRates`, `timelogLinks`) — naming a subset of an
// exclusion set reads as naming the set. Derive it instead of listing it:
//   node -e "const r=require('./sample-workspace-small.json');console.log(Object.keys(r).filter(k=>!Array.isArray(r[k])).join(', '))"
const sliceKeys = Object.keys(rawSlices).filter(
  (k) => Array.isArray(rawSlices[k]) && (rawSlices[k] as unknown[]).length > 0,
);
// ★★ ANTI-VACUITY FLOOR. A discovery sweep passes over an empty set, so a
// renamed/reshaped master would make every check below vacuous and still print
// success. The floor is `sample-workspace-coverage.test.ts`'s enumerated set
// (14 keys); this sweep is WIDER — it also reaches `shifts`, `disciplines`,
// `grades` and `documentVersions`, which that list does not — so read the real
// number off the script's own success line rather than from here. A master that
// genuinely drops below the floor should fail and be looked at, not waved through.
const MIN_SLICES = 14;
if (sliceKeys.length < MIN_SLICES) {
  throw new Error(`refusing to write: found only ${sliceKeys.length} non-empty slices in the master (expected >= ${MIN_SLICES}) — ${sliceKeys.join(", ")}`);
}
const lost = sliceKeys
  .map((k) => ({ k, got: (decoded[k] as unknown[] | undefined)?.length ?? 0, want: (rawSlices[k] as unknown[]).length }))
  .filter((r) => r.got !== r.want);
if (lost.length > 0) {
  throw new Error(
    `refusing to write: decode lost rows in ${lost.length} slice(s) — ` +
      lost.map((r) => `${r.k}: got ${r.got}, master has ${r.want}`).join("; "),
  );
}

writeFileSync(join(fixturesDir, "golden-workspace.csv"), workspaceToCsv(ws), "utf8");
writeFileSync(join(fixturesDir, "golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
console.log(`regenerated golden fixtures — ${sliceKeys.length} slices verified: ${sliceKeys.map((k) => `${k} ${(rawSlices[k] as unknown[]).length}`).join(", ")}`);
