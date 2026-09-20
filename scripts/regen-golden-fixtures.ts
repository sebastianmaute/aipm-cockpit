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

// The guard the docstring above exists for: a DOM-less decode yields every
// slice empty, and every downstream signal of that is a SUCCESS signal.
const counts = { tasks: ws.tasks.length, raid: ws.raid.length, milestones: ws.milestones.length };
if (counts.tasks === 0 || counts.raid === 0 || counts.milestones === 0) {
  throw new Error(`refusing to write: decode came back empty — ${JSON.stringify(counts)}`);
}
// Cross-check against the master's own counts, so a PARTIAL decode is caught too.
const rawCounts = JSON.parse(sample) as { tasks?: unknown[]; raid?: unknown[]; milestones?: unknown[] };
const expected = { tasks: rawCounts.tasks?.length ?? 0, raid: rawCounts.raid?.length ?? 0, milestones: rawCounts.milestones?.length ?? 0 };
if (counts.tasks !== expected.tasks || counts.raid !== expected.raid || counts.milestones !== expected.milestones) {
  throw new Error(`refusing to write: decode lost rows — got ${JSON.stringify(counts)}, master has ${JSON.stringify(expected)}`);
}

writeFileSync(join(fixturesDir, "golden-workspace.csv"), workspaceToCsv(ws), "utf8");
writeFileSync(join(fixturesDir, "golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
console.log(`regenerated golden fixtures from ${counts.tasks} tasks, ${counts.raid} RAID, ${counts.milestones} milestones`);
