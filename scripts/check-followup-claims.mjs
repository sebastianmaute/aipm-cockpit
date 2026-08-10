// Reports which claims in `docs/open-followups.md` a machine can still check.
//
// ★★ THIS GATE CANNOT TELL YOU AN ENTRY IS STILL VALID, and nothing can. It
// proves only that the names, paths and line numbers an entry cites still
// exist. A CLEAN entry may describe a behaviour that was fixed two releases
// ago. Verdicts route work to a probe; they never close an entry.
//
// Usage:
//   node scripts/check-followup-claims.mjs              table to stdout
//   node scripts/check-followup-claims.mjs --json out.json   snapshot
//   node scripts/check-followup-claims.mjs --run-repro       also execute
//                                                           allowlisted
//                                                           reproduce commands
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  ROOT_DOCS,
  SKIP_DIRS,
  collectDocs,
  collectSources,
  countLines,
  resolveCandidates,
} from "./doc-claims-lib.mjs";
import { collectIdentifiers } from "./agents-symbols-lib.mjs";
import {
  REGISTER,
  SWEEP_SELF_FILES,
  classify,
  isClosed,
  parseEntries,
  toArgv,
} from "./followup-claims-lib.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const runRepro = args.includes("--run-repro");

// A usage error is neither a finding nor a floor. Catch it before any work, so
// the failure names the flag instead of surfacing as an `undefined` path deep
// inside `writeFileSync`.
if (jsonAt !== -1 && (args[jsonAt + 1] === undefined || args[jsonAt + 1].startsWith("--"))) {
  console.error("--json needs a file path: node scripts/check-followup-claims.mjs --json out.json");
  process.exit(2);
}
const jsonPath = jsonAt === -1 ? null : args[jsonAt + 1];

const entries = parseEntries(readFileSync(REGISTER, "utf8")).filter((e) => !isClosed(e.title));

const knownSymbols = new Set();
for (const dir of ["src", "scripts", "e2e"]) {
  // An absent directory must reach the floor below as "the scan found nothing",
  // not as an ENOENT stack trace that reads like a broken register.
  try {
    // ★★★ THIS SWEEP'S OWN FILES ARE EXCLUDED FROM THE TREE IT JUDGES AGAINST.
    // Without it, `followup-claims-lib.test.mjs` — whose method is quoting
    // register prose verbatim — vouches for the very names this tool checks.
    // See `SWEEP_SELF_FILES` for the measurement and for why the list lives
    // beside this gate rather than inside the symbol gate's constant.
    collectIdentifiers(dir, knownSymbols, SWEEP_SELF_FILES);
  } catch {
    /* partial checkout — the floor is what decides whether that is survivable */
  }
}
// A scan that finds nothing passes everything — the same floor both sibling
// gates carry, for the same reason.
if (knownSymbols.size < 1000) {
  console.error(`only ${knownSymbols.size} identifiers found — the scan is broken, not the doc.`);
  process.exit(2);
}
if (entries.length < 50) {
  console.error(`only ${entries.length} open entries parsed — refusing to report a pass.`);
  process.exit(2);
}

// ★★★ THE RESOLVER IS WIDER THAN `check-doc-claims.mjs`'s, AND IT HAS TO BE.
// That gate resolves citations, which only ever point into CODE, so
// `collectSources()` — `SOURCE_EXT` under src/scripts/e2e plus root-level
// config — is exactly its domain. This one resolves `pathsIn`, and the register
// names DOCS as freely as it names code: the doc set it is part of, the
// baselines the sibling gates read, the audit snapshots it defers to. Handing
// those to a code-only index reports every one of them as deleted.
//
// Two structural gaps, both measurable: `SOURCE_EXT` carries no `md` at all, and
// the walk never leaves the code tree, so `docs/baselines/*.json` fails on its
// DIRECTORY rather than its extension. Reproduce the pre-fix behaviour by
// passing `collectSources()` alone as `sources` below and diffing the tally.
//
// ★★ WIDER, NOT UNCONDITIONAL. A path the register names and the tree no longer
// holds must still report PATH_MISSING — that is the whole finding. So every
// member of this index is a file that exists: the walks return real entries, and
// `ROOT_DOCS` (a hardcoded list, not a walk) is filtered against disk.
// ★★ UNGUARDED, on purpose. This used to sit in a `try` commented "no docs/ in
// a partial checkout" — unreachable, because `readFileSync(REGISTER)` above
// reads a file inside `docs/` and throws first. What the catch could actually
// have swallowed is an unreadable `docs/`, and swallowing that is the bad
// direction: a truncated index is indistinguishable from a deleted file — every
// missing asset reports PATH_MISSING, a whole screen of false findings under a
// tool that exits 0. Fail loudly instead.
const docEntries = readdirSync("docs", { recursive: true, encoding: "utf8" });
const docAssets = [];
for (const f of docEntries) {
  const p = `docs/${f}`.replace(/\\/g, "/");
  // `.md` is `collectDocs()`'s half; directories are not citable.
  if (p.endsWith(".md")) continue;
  if (SKIP_DIRS.some((d) => p.startsWith(`${d}/`))) continue;
  if (existsSync(p) && statSync(p).isFile()) docAssets.push(p);
}
const sources = [
  ...new Set([
    // Code tree + root config, unchanged.
    ...collectSources(),
    // ROOT_DOCS + every `docs/**/*.md` outside SKIP_DIRS. `ROOT_DOCS` is a
    // literal list, so a deleted entry would otherwise resolve forever.
    ...collectDocs().filter((d) => (ROOT_DOCS.includes(d) ? existsSync(d) : true)),
    // Everything else `docs/` holds — the baselines JSON the register cites.
    ...docAssets,
  ]),
];

const lineCounts = new Map();
const env = {
  knownSymbols,
  resolve: (p) => resolveCandidates(p, sources),
  lineCounts: {
    get(p) {
      if (!lineCounts.has(p)) lineCounts.set(p, countLines(readFileSync(p, "utf8")));
      return lineCounts.get(p);
    },
  },
};

const results = entries.map((e) => classify(e, env));

const REPRO_TIMEOUT_MS = 60_000;

/** ★★★ A NON-ZERO EXIT IS NOT AUTOMATICALLY DRIFT, AND `grep` IS THE PROOF.
 *  Its contract is 0 = matched, 1 = no match, ≥2 = error — so for a register
 *  line whose whole point is that nothing matches (`# no hits`), exit 1 IS the
 *  documented outcome. Reported as drift, §95's two greps were the only DRIFT
 *  finding this runner produced on the day it shipped — every other finding that
 *  run came from the static pass — and both were false. Measured:
 *    grep -rn ":memory:" src/app/*.test.ts ; echo "EXIT=$?"     # EXIT=1
 *  ★★ Scoped to `grep` alone, deliberately. Every binary has its own exit
 *  vocabulary and guessing at one is how a real regression gets waved through;
 *  a second entry here needs its own measurement. */
function ranWithoutError(bin, status) {
  if (status === 0) return true;
  return bin === "grep" && status === 1;
}

if (runRepro) {
  for (const r of results) {
    r.reproResults = r.repro.map(({ cmd, comment }) => {
      // ★★★ `shell: false`. The command came out of a markdown file; a shell
      // would make every metacharacter in it executable. `reproEntriesIn`
      // already rejects metacharacters — this is the second layer.
      const argv = toArgv(cmd);
      if (argv === null) {
        return {
          cmd,
          comment,
          bin: null,
          status: null,
          launchError: "UNPARSEABLE",
          timedOut: false,
          stdout: "",
        };
      }
      const [bin, ...rest] = argv;
      const out = spawnSync(bin, rest, {
        encoding: "utf8",
        timeout: REPRO_TIMEOUT_MS,
        shell: false,
      });
      // ★★★ A TIMEOUT IS NOT A LAUNCH FAILURE, AND CALLING IT ONE IS A LIE WITH
      // CONSEQUENCES. `spawnSync` reports both through `error`, so the two used
      // to collapse into one bucket printed "not executed" — measured, a timeout
      // gives `{ status: null, signal: "SIGTERM", error.code: "ETIMEDOUT" }`.
      // The command ran for the full timeout and whatever it did, it did. The
      // register carries `npm run build` and `npx next start -p 3200` (which
      // never exits), so this is a live shape the moment either entry reopens.
      const timedOut = out.error?.code === "ETIMEDOUT";
      return {
        cmd,
        comment,
        bin,
        status: out.status,
        timedOut,
        // ★★★ A COMMAND THAT NEVER LAUNCHED IS NOT DRIFT EITHER. On Windows
        // `npm` and `npx` are `.cmd` shims: `shell: false` cannot start them
        // (ENOENT), and raising `shell: true` to "fix" that is the security
        // boundary this runner exists to hold — so those commands are
        // UNRUNNABLE here, by design, forever. `node` and `grep` do run.
        // Folding a launch failure in with a real non-zero exit would invent
        // drift on every npm-scripted entry, on this platform only. Reproduce
        // the split:
        //   node -e "const{spawnSync:s}=require('node:child_process');for(const b of ['node','npm'])console.log(b,s(b,['--version'],{shell:false}).error?.code??'ran')"
        launchError: !timedOut && out.error ? (out.error.code ?? "ERROR") : null,
        stdout: (out.stdout ?? "").trim().slice(0, 400),
      };
    });
    for (const x of r.reproResults) {
      if (x.launchError) {
        r.problems.push({
          kind: "REPRO_UNRUNNABLE",
          detail: `${x.cmd} (${x.launchError} — not executed, verdict unchanged)`,
        });
        continue;
      }
      if (x.timedOut) {
        r.problems.push({
          kind: "REPRO_TIMEOUT",
          detail: `${x.cmd} (executed, killed at ${REPRO_TIMEOUT_MS / 1000}s — side effects possible, verdict unchanged)`,
        });
        continue;
      }
      if (ranWithoutError(x.bin, x.status)) continue;
      // ★★ The register's own trailing comment is printed beside the exit code
      // BECAUSE IT IS THE ONLY STATEMENT OF WHAT WAS EXPECTED. Discarding it is
      // what made the grep-exit-1 case unreadable: a bare "no longer exits 0"
      // gives a reader nothing to compare against.
      // ★★ The verdict is named for what was OBSERVED, not for what it implies.
      // It was `COUNT_DRIFT`, which asserted a conclusion this runner cannot
      // reach — a `*` is not globbed here, a working tree differs from CI, and a
      // command can be stale in ways that still exit 0. A lead, not a verdict.
      r.verdict = r.verdict === "CLEAN" ? "REPRO_NONZERO" : r.verdict;
      r.problems.push({
        kind: "REPRO_NONZERO",
        detail: `${x.cmd} → exit ${x.status}${x.comment ? `   [register says: ${x.comment}]` : ""}`,
      });
    }
  }
}

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;

console.log(`${results.length} open entries\n`);
for (const r of results.filter((x) => x.problems.length)) {
  console.log(`  §${r.n}  ${r.verdict}`);
  for (const p of r.problems) console.log(`      ${p.kind}: ${p.detail}`);
}
console.log(`\n${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`\nEvery entry above still needs a probe. This gate rules claims OUT, never IN.`);

if (jsonPath) {
  // ★★ PROVENANCE, because the file exists to be DIFFED and a diff needs two
  // known points. Without these three fields the snapshot said nothing about
  // when it was taken, against which tree, or how to take another — and no
  // tracked file references it, so there was nothing to infer it from either.
  // ★ Everything else here stays deterministic on a fixed tree: these are the
  // only fields that move on their own, and they are DATE (not timestamp) plus
  // sha, so re-running twice in a day is a no-op diff.
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: false });
  const snapshot = {
    generated: new Date().toISOString().slice(0, 10),
    commit: head.status === 0 ? head.stdout.trim() : "unknown",
    // ★★★ NOT A RATCHET, and the distinction is the whole reason this file is
    // safe to commit. Nothing reads it, nothing fails when it drifts, and a
    // verdict here is never permission to close an entry — `CLEAN` means only
    // that nothing static disproved the claim. Re-baselining it admits no debt
    // because it gates none.
    note:
      "Snapshot of `node scripts/check-followup-claims.mjs`, regenerate with " +
      "`node scripts/check-followup-claims.mjs --json docs/baselines/followup-claims.json`. " +
      "REPORTING ONLY — no gate reads this file, and a CLEAN verdict rules a claim OUT, never IN.",
    tally,
    results,
  };
  writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}
// Reporting tool, not a gate: it exits 0 with findings. Promoting it to
// blocking is a separate decision, once its false-positive rate is known.
process.exit(0);
