// Ratchet: fails when a NEW file exceeds LIMIT, or an already-oversized file GROWS.
// Regenerate baseline: node scripts/check-file-sizes.mjs --update
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const LIMIT = 1600;
const BASELINE = "docs/baselines/file-sizes.json";
// ★★★ THE BASELINE VALUES ARE DELIBERATELY DOUBLED AND `--update` DISCARDS
// THAT. Raised from 800 on 2026-09-03 by explicit decision — the ratchet was
// biting on routine work — and every entry in the baseline JSON was doubled in
// the same change, so a file's recorded allowance is twice its size at the time
// rather than its current length. `--update` rewrites the baseline to CURRENT
// sizes, which silently reverts that decision to a no-headroom ratchet; the
// violation message below still recommends it, so read this first. Re-double by
// hand instead, or the next legitimate growth fails the gate again.
// ★★★ AND IT DELETES, NOT HALVES: `--update` writes only files ABOVE the LIMIT
// (the filter below), so at 1600 it emits `{task-manager: 2975}` alone and the
// other three entries VANISH. "Re-double by hand" is then impossible for the
// dropped rows without git archaeology — recover them from history, not from
// the file.
// ★ Three of the four entries are now INERT: only a file over LIMIT is checked
// against its entry at all, so chat-panel/tasks-section/workspace-section are
// governed by LIMIT alone until they pass 1600. They are kept as recorded
// intent, not as live constraints.
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
