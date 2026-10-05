/**
 * generate-sample-workspace.ts
 *
 * Source of truth: `sample-workspace-small.json` — the hand-curated, fully
 * enriched master workspace (every entity, project meta/status, steering
 * committee, the demo change-log, RAID<->stakeholder links, rich-text note
 * logs, day-rate cards). It is a normal JSON file edited directly; it is NOT
 * generated and this script never overwrites it.
 *
 * This script's ONLY job is to load that master and emit the two SCALED demo
 * datasets via the pure `scaleWorkspace(ws, factor)` helper (replicates
 * content entities with a per-replica id offset + full FK remap; reference
 * data/singletons are kept once):
 *   sample-workspace-big.json  — 3x  the small content entities
 *   sample-workspace-huge.json — 10x the small content entities
 *
 * There is no `.md`/`.csv`/`.sqlite3` involved anywhere in this flow anymore —
 * JSON is the only sample-workspace format.
 *
 * Run with:
 *   npx vite-node scripts/generate-sample-workspace.ts
 *
 * ---------------------------------------------------------------------------
 * jsdom landmine (read before touching the import order below): decoding via
 * `jsonToWorkspace` (workspace.ts, reached through
 * ../src/app/sample-workspace-variants, which imports it) re-sanitizes every task/RAID noteLog + description through
 * sanitizeNoteFields -> sanitizeRichHtml -> DOMPurify (sanitize-html.ts).
 * DOMPurify binds its `window` ONCE, at the moment the "dompurify" package
 * is first imported (module-eval time, not per-call) — under bare Node
 * (no DOM) that bind fails and sanitize() throws. Until §97, jsonToWorkspace's
 * own catch-all silently swallowed that throw into an EMPTY workspace, so a
 * scaled "empty" workspace would still "succeed" and write near-empty big/huge
 * JSON with no error. Since §97 it throws `DomUnavailableError` instead, so a
 * missing DOM now fails this script loudly; the install below is still what
 * makes it work.
 *
 * We avoid this by installing a minimal jsdom window/document as globals
 * BEFORE "../src/app/sample-workspace-variants" (and, through workspace.ts,
 * its DOMPurify dependency) is first
 * loaded. Because ordinary `import` statements are hoisted above any other
 * top-level code, that load is done via a `await import(...)` performed
 * AFTER the jsdom globals are installed, not a static import.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// Install a minimal DOM before the dynamic imports below pull in DOMPurify.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

const { SCALED_VARIANTS, decodeSampleMaster, scaleSample } = await import("../src/app/sample-workspace-variants");

// ---------------------------------------------------------------------------
// Step 1: Load the hand-curated master via the real decoder (strict: a
// corrupt/malformed master must fail loudly, never silently degrade to an
// empty workspace that then "successfully" scales to near-empty output).
// ---------------------------------------------------------------------------
const jsonPath = join(ROOT, "sample-workspace-small.json");
const ws = decodeSampleMaster(readFileSync(jsonPath, "utf8"));

console.log("\n=== generate-sample-workspace summary ===\n");
console.log("Source: sample-workspace-small.json (hand-curated master — not overwritten)");
console.log("\nSmall workspace entity counts:");
console.log(`  tasks:        ${ws.tasks.length}`);
console.log(`  raid:         ${ws.raid.length}`);
console.log(`  milestones:   ${(ws.milestones ?? []).length}`);
console.log(`  stakeholders: ${(ws.stakeholders ?? []).length}`);
console.log(`  changes:      ${(ws.changes ?? []).length}`);
console.log(`  budgets:      ${(ws.budgets ?? []).length}`);
console.log(`  resources:    ${ws.resources.length}`);
console.log(`  absences:     ${ws.absences.length}`);
console.log(`  shifts:       ${ws.shifts.length}`);
console.log(`  roles:        ${ws.roles.length}`);
console.log(`  disciplines:  ${ws.disciplines.length}`);
console.log(`  grades:       ${ws.grades.length}`);

// ---------------------------------------------------------------------------
// Step 2: Emit SCALED variants (big = 3x, huge = 10x) from the master via
// the pure scaleWorkspace(ws, factor) helper. json only — no md/csv/sqlite3.
// ---------------------------------------------------------------------------
// (SCALED_VARIANTS and the scale+encode step live in src/app/sample-workspace-variants.ts,
// shared with the test that checks the committed files against them.)
console.log("\nScaled variants:");
for (const { name, factor } of SCALED_VARIANTS) {
  const { scaled, json } = scaleSample(ws, factor);
  const scaledJsonPath = join(ROOT, `sample-workspace-${name}.json`);
  writeFileSync(scaledJsonPath, json, "utf8");

  console.log(
    `  ${name.padEnd(4)} (${factor}x): tasks=${scaled.tasks.length}, raid=${scaled.raid.length}, ` +
      `milestones=${(scaled.milestones ?? []).length}, changes=${(scaled.changes ?? []).length}, ` +
      `stakeholders=${(scaled.stakeholders ?? []).length}, budgets=${(scaled.budgets ?? []).length}`,
  );
  console.log(`       -> ${scaledJsonPath}`);
}

console.log("\n(sample-workspace-small.json is hand-curated — not overwritten)");
