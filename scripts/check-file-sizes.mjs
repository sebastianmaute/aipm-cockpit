// Ratchet: fails when a NEW file exceeds LIMIT, or an already-oversized file GROWS.
// Regenerate baseline: node scripts/check-file-sizes.mjs --update
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const LIMIT = 1600;
const BASELINE = "docs/baselines/file-sizes.json";
// ★★★ THE BASELINE ENTRIES WERE DOUBLED ON PURPOSE, AND `--update` DISCARDS
// ANY HEADROOM. LIMIT was raised from 800 on 2026-09-03 by explicit decision —
// the ratchet was biting on routine work — and every entry in the baseline JSON
// was doubled in the same change. Entries have been edited by hand since (the
// task-manager one was tightened to its measured length on 2026-10-14, §706, so
// it has NO headroom), so read the JSON rather than assuming any entry is twice
// its file. `--update` rewrites the baseline to CURRENT sizes, which removes all
// headroom; the violation message below still recommends it, so read this
// first. Raise an entry by hand instead when growth is legitimate.
// ★★★ AND IT DELETES, NOT HALVES: `--update` writes only files ABOVE the LIMIT
// (the filter below), so every entry for a file now under LIMIT VANISHES (see
// the split below). Recover a dropped entry from git history, not from the
// file.
// ★ Only a file over LIMIT is checked against its entry at all. Two of the four
// entries are INERT today: tasks-section and workspace-section are under 1600,
// so LIMIT alone governs them; they are kept as recorded intent. chat-panel and
// task-manager are over LIMIT, so their entries are LIVE ceilings. Re-measure
// before relying on this split:
//   node -e "for(const f of ['chat-panel','tasks-section','workspace-section','task-manager'])console.log(f,require('fs').readFileSync('src/app/'+f+'.tsx','utf8').split('\n').length)"
// i18n dictionaries are inherently large (one entry per string × 2 languages)
// and are exempt from the component/module budget entirely.
const EXEMPT = [/src\/app\/i18n(\.de)?\.ts$/];

// Walk src with node's fs (NOT `git ls-files`) — the slim CI image has no git,
// and this keeps the ratchet runnable anywhere. Paths use forward slashes so the
// baseline JSON and EXEMPT regexes match on every OS.
const files = readdirSync("src", { recursive: true, encoding: "utf8" })
  .map((f) => `src/${f}`.replace(/\\/g, "/"))
  .filter((f) => /\.tsx?$/.test(f))
  .filter((f) => !/\.test\.|\.property\./.test(f))
  .filter((f) => !EXEMPT.some((re) => re.test(f)));

const sizes = Object.fromEntries(
  files.map((f) => [f, readFileSync(f, "utf8").split("\n").length]),
);

if (process.argv.includes("--update")) {
  const oversized = Object.fromEntries(
    Object.entries(sizes)
      .filter(([, n]) => n > LIMIT)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(BASELINE, JSON.stringify(oversized, null, 2) + "\n");
  console.log(`baseline written: ${Object.keys(oversized).length} oversized files > ${LIMIT} lines`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const violations = [];
for (const [f, n] of Object.entries(sizes)) {
  if (n <= LIMIT) continue;
  const prev = baseline[f];
  if (prev === undefined) violations.push(`${f}: ${n} lines (NEW file over ${LIMIT})`);
  else if (n > prev) violations.push(`${f}: ${n} lines (grew from baselined ${prev})`);
}

if (violations.length) {
  console.error("file-size ratchet violations:\n" + violations.join("\n"));
  console.error(
    "\nEither split the file, or (if a legitimately larger baseline) run: node scripts/check-file-sizes.mjs --update",
  );
  process.exit(1);
}
console.log("file-size ratchet ok");
