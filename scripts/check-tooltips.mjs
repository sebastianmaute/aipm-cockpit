// Tooltip ratchet (§109): fails when a file under src/app gains an icon-only
// button-family control with no `title`, i.e. one that shows no hover tooltip.
// The baseline records today's count per file; a file absent from it is
// allowed none. The scan itself is scripts/tooltip-scan-lib.mjs.
//
//   node scripts/check-tooltips.mjs           check (exit 0 pass, 1 grew, 2 could not scan)
//   node scripts/check-tooltips.mjs --list    also print every untitled icon-only site
//   node scripts/check-tooltips.mjs --update  rewrite the baseline to today's counts;
//                                             REFUSED (exit 1) while any file grew, so
//                                             it can only tighten the ratchet
//
// ★ Raising an allowance (or seeding a new file) is a HAND EDIT of the baseline,
// on purpose: it then shows up in review. Today the one entry is B1, the
// classic header's settings cog (docs/open-followups.md §109), held for a
// product decision.
//
// ★ A `title` is the fix the ratchet asks for, never an `aria-label` alone: the
// accessible name is a different property and is gated elsewhere (axe, and the
// row-unique-name unit tests). See docs/tooltip-inventory.md for why a copied
// bare noun is a poor title.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareToBaseline, scanTsx, untitledIconOnly } from "./tooltip-scan-lib.mjs";

export const BASELINE = "docs/baselines/untitled-icon-buttons.json";
/** Fewer button-family elements than this means the walk read the wrong tree. */
export const MIN_SCANNED = 200;

export function listSources(root = "src/app") {
  // node's fs walk, not `git ls-files`: CI's slim image may have no git.
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((f) => `${root}/${f}`.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
    .sort();
}

export function measure(files, read = (f) => readFileSync(f, "utf8")) {
  let scanned = 0;
  const counts = {};
  const sites = [];
  for (const f of files) {
    const rows = scanTsx(read(f), f);
    scanned += rows.length;
    const untitled = untitledIconOnly(rows);
    if (untitled.length > 0) counts[f] = untitled.length;
    for (const r of untitled) sites.push(`${f}:${r.line}\t${r.tag}\tnamed=${r.named}`);
  }
  return { scanned, counts, sites };
}

/**
 * The CLI, with its inputs injectable so every exit path is unit-tested
 * (check-tooltips.test.mjs). Defaults are the real tree and baseline.
 */
export function run(argv, {
  files = listSources(),
  read = (f) => readFileSync(f, "utf8"),
  baselinePath = BASELINE,
  minScanned = MIN_SCANNED,
  log = (line) => console.log(line),
  error = (line) => console.error(line),
} = {}) {
  const list = argv.includes("--list");
  const update = argv.includes("--update");
  const { scanned, counts, sites } = measure(files, read);
  if (scanned < minScanned) {
    error(`tooltips:check: scanned only ${scanned} button-family elements (floor ${minScanned}); could not scan`);
    return 2;
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    if (baseline === null || typeof baseline !== "object" || Array.isArray(baseline)) throw new Error("not an object");
  } catch (e) {
    error(`tooltips:check: cannot read ${baselinePath}: ${String(e)}`);
    return 2;
  }
  const { grew, shrank } = compareToBaseline(counts, baseline);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log(`tooltips:check: ${scanned} button-family elements scanned, ${total} icon-only without a title, in ${Object.keys(counts).length} files`);
  if (list) for (const site of sites) log(`  ${site}`);
  for (const g of grew) {
    error(`  GREW ${g.file}: ${g.count} icon-only control(s) without a title, baseline allows ${g.allowed}. Add a title.`);
  }
  if (grew.length > 0) {
    if (update) error("tooltips:check: --update refused: it can only tighten the baseline");
    return 1;
  }
  if (update) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
    log(`tooltips:check: baseline rewritten (${Object.keys(sorted).length} files)`);
    return 0;
  }
  if (shrank.length > 0) {
    log(`tooltips:check: ${shrank.length} file(s) below the baseline; tighten it with --update`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(run(process.argv.slice(2)));
