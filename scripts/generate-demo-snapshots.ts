/**
 * generate-demo-snapshots.ts
 *
 * Replays the hand-curated master (`sample-workspace-small.json`) week by week
 * into the demo project's seeded Trends history, and writes it to
 * `sample-demo-snapshots.json` at the repo root. The output is GENERATED — never
 * hand-edit it; `src/app/demo-snapshots.test.ts` fails when it no longer equals a
 * fresh run. The replay itself is `buildDemoSnapshots` (`src/app/demo-snapshots.ts`),
 * as of `DEMO_AS_OF`; a later step shifts the records to the real date at load.
 *
 * Run with:
 *   npx vite-node scripts/generate-demo-snapshots.ts
 *
 * ★ The jsdom landmine of `scripts/generate-sample-workspace.ts` applies here
 * unchanged: decoding the master re-sanitizes rich text through DOMPurify, which
 * binds its `window` when first imported. The DOM globals are therefore installed
 * BEFORE the dynamic imports below, never through a (hoisted) static import.
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

const { decodeSampleMaster } = await import("../src/app/sample-workspace-variants");
const { buildDemoSnapshots } = await import("../src/app/demo-snapshots");
const { DEMO_AS_OF } = await import("../src/app/demo-workspace");

const ws = decodeSampleMaster(readFileSync(join(ROOT, "sample-workspace-small.json"), "utf8"));
const records = buildDemoSnapshots(ws, DEMO_AS_OF);
const outPath = join(ROOT, "sample-demo-snapshots.json");
writeFileSync(outPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

console.log(`\n=== generate-demo-snapshots: ${records.length} weekly records as of ${DEMO_AS_OF} ===\n`);
for (const r of records) {
  console.log(
    `  ${r.capturedAt.slice(0, 10)}  pct=${r.pctComplete ?? "-"}  spi=${r.spi?.toFixed(2) ?? "-"}  ` +
      `cpi=${r.cpi?.toFixed(2) ?? "-"}  overall=${r.overallRag || "-"}${r.isBaseline ? "  (baseline)" : ""}`,
  );
}
console.log(`\n  -> ${outPath}`);
