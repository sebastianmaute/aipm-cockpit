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
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { collectResolutionSources, countLines, resolveCandidates } from "./doc-claims-lib.mjs";
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

// ★★★ A SET DIFFERENCE, NOT A SECOND LIST. The self-excluded set is exactly the
// names that appear when `SWEEP_SELF_FILES` is included and vanish when it is
// not — so it follows that constant automatically and can never drift from it.
// The alternative, hand-listing the internals, is a second source of truth for
// the one fact this file already owns.
const withSelf = new Set();
for (const dir of ["src", "scripts", "e2e"]) {
  try {
    collectIdentifiers(dir, withSelf, new Set());
  } catch {
    /* same posture as the sweep above — the floor decides what is survivable */
  }
}
const selfExcludedSymbols = new Set([...withSelf].filter((s) => !knownSymbols.has(s)));

// ★★★ THE RESOLVER IS WIDER THAN `check-doc-claims.mjs`'s, AND IT HAS TO BE.
// The reasoning, the "wider, not unconditional" guarantee and the derivation of
// which extensions belong now live with the walk itself, in
// `collectResolutionSources`. Four tests there pin both directions.
const sources = collectResolutionSources();

const lineCounts = new Map();
const env = {
  knownSymbols,
  selfExcludedSymbols,
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
