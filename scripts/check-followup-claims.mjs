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
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { collectResolutionSources, countLines, resolveCandidates } from "./doc-claims-lib.mjs";
import { collectIdentifiers, collectIdentifiersFromFiles } from "./agents-symbols-lib.mjs";
import {
  REGISTER,
  SWEEP_SELF_FILES,
  buildSelfExcludedSymbols,
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
    /* ★★ WIDER THAN "partial checkout", WHICH IS ALL THIS USED TO SAY. The catch
       is wrapped around the WALK, so it swallows an unreadable FILE as readily
       as an absent DIRECTORY — and the shared primitive it calls is deliberately
       fail-loud for exactly that case, because the BLOCKING symbol gate needs it
       to be (see its no-try/catch note, now pinned by two tests). Tolerable HERE
       and only here: this tool exits 0 by design and reports, so a truncated
       scan degrades to false SYMBOL_MISSING findings rather than to a silent
       pass — and the identifier floor below is what decides whether that
       degradation is survivable. Do not copy this posture into a gate. */
  }
}
// ★★★ ROOT-LEVEL CONFIG IS CODE THIS REGISTER CITES, AND THE DIRECTORY WALK
// CANNOT SEE IT. `collectSources()` scans the root for exactly this reason and
// says so in its own comment; the SYMBOL sweep did not, so a helper imported and
// used in `eslint.config.mjs` and cited by §53 and §189 read as missing forever.
// ★★★ THAT HELPER IS DELIBERATELY NOT NAMED HERE, AND THE OMISSION IS THE POINT.
// This file is a `SWEEP_SELF_FILES` member, so any identifier written into it —
// including into a comment — lands in `withSelf` and therefore in
// `selfExcludedSymbols`. Naming the symbol here would mean that if it ever left
// `eslint.config.mjs`, or if this root scan were reverted, the register's stale
// claim would report SYMBOL_SELF_EXCLUDED — which `NON_ACTIONABLE` swallows —
// instead of the SYMBOL_MISSING that would send someone to fix it. A fix whose
// own prose silences its own regression is the self-referential trap this gate
// exists to avoid, one layer down. Read the name off the config instead — the
// command is written so that it does not contain the name either:
//   grep -nE "gnores\(" eslint.config.mjs
// ★★ THE COMMAND'S SHAPE IS LOAD-BEARING FOR THE SAME REASON THE OMISSION IS.
// A first cut of this comment spelled the identifier inside the grep pattern,
// which put it straight back into `withSelf` and undid the paragraph above it.
// Anything added here — prose, example, pattern — is scanned. Match on a
// fragment, never on the whole name.
// ★★★ JSON IS DELIBERATELY EXCLUDED HERE, unlike `collectSources()`, and the
// asymmetry is the point: `package-lock.json` sits at the root, and feeding it
// to a SYMBOL index would inject every dependency name into `knownSymbols` —
// after which a genuinely stale claim could resolve against a package name and
// never be reported. A PATH index may hold that file; a SYMBOL index must not.
const ROOT_CODE_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/;
// ★ Non-recursive by construction: `readdirSync(".", { withFileTypes: true })`
// takes no `recursive` option here, so it lists the root and stops —
// `node_modules` is never entered. (`withFileTypes` is what makes `isFile()`
// below possible; it has nothing to do with recursion, and an earlier wording
// here conflated the two.)
// ★★ `isFile()` is load-bearing, not defensive noise: a DIRECTORY named with a
// code extension would otherwise be handed to `readFileSync`, which throws
// EISDIR. `collectIdentifiers`'s own walk never had this problem because it
// tests `isDirectory()` first; a flat root listing has to do the same. Filtering
// here keeps the shared primitive able to fail loudly for the BLOCKING symbol
// gate — see its no-try/catch note.
const rootFiles = readdirSync(".", { withFileTypes: true })
  .filter((e) => e.isFile() && ROOT_CODE_RE.test(e.name))
  .map((e) => e.name);
collectIdentifiersFromFiles(rootFiles, knownSymbols, SWEEP_SELF_FILES);
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
// names that appear when this sweep's own IMPLEMENTATION files are included and
// vanish when they are not — so it follows `SWEEP_SELF_FILES` automatically.
// The alternative, hand-listing the internals, is a second source of truth for
// the one fact this file already owns.
// ★★★ THE FIXTURE IS EXCLUDED FROM BOTH SETS, AND THAT ASYMMETRY IS THE POINT.
// `SWEEP_SELF_FIXTURES` holds `followup-claims-lib.test.mjs`, whose method is
// quoting register prose verbatim — it contains a name BECAUSE the register
// mentions it, so admitting it here would let the register vouch for itself and
// would silently downgrade a real deletion from SYMBOL_MISSING to the
// non-actionable SYMBOL_SELF_EXCLUDED. The constant's own docstring carries the
// reasoning and the command that measures today's overlap.
// ★★★ `GATE_SELF_FILES` IS *NOT* ADDED BACK HERE AND MUST NOT BE, THOUGH THE
// SYMMETRY ARGUMENT SAYS OTHERWISE. `collectIdentifiers` skips those three files
// unconditionally, in this pass too, so a name living only there lands in
// NEITHER set and reports SYMBOL_MISSING — a fourth unfindable class the
// verdicts do not name. Widening `withSelf` to admit them looks like the fix and
// is a REGRESSION: the symbol gate's own files quote the deliberately-absent
// names it exists to catch, so most of that orphan set is names AGENTS.md
// documents as never having existed, for which SYMBOL_MISSING is the CORRECT
// verdict. Only a few are genuine gate internals; the rest are ordinary prose
// words the identifier regex admits. Excusing the whole set to rescue those few
// would mask the exact class this gate is for.
// ★★★ NO ORPHAN IS NAMED HERE, AND NAMING ONE IS SELF-DEFEATING, BECAUSE THIS
// FILE IS SWEPT BY THE GATE IT IMPLEMENTS. Every identifier written here — prose
// and examples included — joins `withSelf`, so a named orphan stops being an
// orphan and the sentence describing it is falsified BY BEING WRITTEN. Measured,
// not theorised: an earlier revision of this paragraph named seven, and all
// seven changed class in the very commit that named them, while the paragraph
// went on asserting the verdict they no longer got. The same trap is recorded
// one screen down for a grep pattern that quoted an identifier. So list today's
// set rather than quoting it — this reads the gate-self files directly, because
// the shared walk refuses to:
//   node --input-type=module -e "import{readFileSync}from'node:fs';import{collectIdentifiers,isGatedSymbolName,GATE_SELF_FILES}from'./scripts/agents-symbols-lib.mjs';import{SWEEP_SELF_FIXTURES}from'./scripts/followup-claims-lib.mjs';const w=new Set();for(const d of ['src','scripts','e2e'])collectIdentifiers(d,w,SWEEP_SELF_FIXTURES);const o=new Set();for(const f of GATE_SELF_FILES)for(const m of readFileSync(f,'utf8').matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g))if(isGatedSymbolName(m[0])&&!w.has(m[0]))o.add(m[0]);console.log(o.size,[...o].sort().join(' '))"
// Recorded rather than fixed, deliberately, and no register entry hits it today.
// ★★ The pass itself lives in `buildSelfExcludedSymbols` so a test can reach
// it: inline here, reverting its exclusion argument left the suite green.
const selfExcludedSymbols = buildSelfExcludedSymbols({
  knownSymbols,
  rootFiles,
  collect: collectIdentifiers,
  collectFiles: collectIdentifiersFromFiles,
});

// ★★★ THE RESOLVER IS WIDER THAN `check-doc-claims.mjs`'s, AND IT HAS TO BE.
// The reasoning, the "wider, not unconditional" guarantee and the derivation of
// which extensions belong now live with the walk itself, in
// `collectResolutionSources`. Its describe block in `doc-claims-lib.test.mjs`
// pins both directions; no count is quoted here, because the last one was wrong
// within the same branch that wrote it.
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
