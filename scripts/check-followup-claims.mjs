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
import { REGISTER, classify, isClosed, parseEntries } from "./followup-claims-lib.mjs";

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
    collectIdentifiers(dir, knownSymbols);
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
let docEntries = [];
try {
  docEntries = readdirSync("docs", { recursive: true, encoding: "utf8" });
} catch {
  /* no docs/ in a partial checkout — those paths then legitimately report missing */
}
// ★ Only the readdir is guarded. Wrapping the loop too would let one unreadable
// entry silently truncate the index, and a short index is indistinguishable from
// a deleted file — it reports PATH_MISSING either way.
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

// ★★★ SPLITTING ON WHITESPACE FABRICATES DRIFT, and it fabricates it on the
// commands most worth running. `shell: false` means nothing strips quotes, so
// `grep -n "Showing the first" a.ts b.ts` split on `/\s+/` searches for
// `"Showing` in files named `the` and `first"` — grep exits 2 on the missing
// files and the runner reports a reproduce command that "no longer exits 0".
// A gate reporting a green branch as red is the expensive direction, and this
// one did: the register's `grep -n "Showing the first" …` reported drift under
// the naive split and exits 0 once tokenized. ★★ It did NOT explain every
// non-zero exit that run — some of the register's reproduce commands really
// have gone stale — which is the point: with the bug present you cannot tell
// the two apart, so no number here is worth quoting. Reproduce the fabricated
// half, whose `2` is grep failing to open files named `the` and `first"`:
//   node -e "const{spawnSync:s}=require('node:child_process');const c='grep -n \"Showing the first\" src/app/doc-render-pptx.ts'.split(/\s+/);console.log(s(c[0],c.slice(1),{encoding:'utf8'}).status)"
//
// Quote handling deliberately mirrors `stripTrailingComment`'s model — a
// backslash escapes the next character except inside single quotes — so the
// two functions cannot disagree about where a quoted span ends. Returns null on
// unbalanced quoting; the caller then reports the command UNRUNNABLE rather
// than spawn a guess, for the same reason that function returns null.
// ★ A `*` reaches the child literally: there is no shell to expand it. Whether
// it still matches is the child's business (MSYS builds glob for themselves,
// GNU grep on Linux does not), which is one more reason a non-zero exit from
// this runner is a lead and not a verdict.
function toArgv(cmd) {
  const argv = [];
  let cur = "";
  let started = false; // `""` is a real empty argument, so emptiness cannot end one
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "\\" && quote !== "'") {
      if (i + 1 >= cmd.length) return null; // trailing backslash escapes nothing
      cur += cmd[++i];
      started = true;
      continue;
    }
    if (quote === null && /\s/.test(ch)) {
      if (started) argv.push(cur);
      cur = "";
      started = false;
      continue;
    }
    if (quote === null && (ch === "'" || ch === '"')) {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === quote) {
      quote = null;
      continue;
    }
    cur += ch;
    started = true;
  }
  if (quote !== null) return null;
  if (started) argv.push(cur);
  return argv.length ? argv : null;
}

if (runRepro) {
  for (const r of results) {
    r.reproResults = r.repro.map((cmd) => {
      // ★★★ `shell: false`. The command came out of a markdown file; a shell
      // would make every metacharacter in it executable. `reproCommandsIn`
      // already rejects metacharacters — this is the second layer.
      const argv = toArgv(cmd);
      if (argv === null) {
        return { cmd, status: null, launchError: "UNPARSEABLE", stdout: "" };
      }
      const [bin, ...rest] = argv;
      const out = spawnSync(bin, rest, { encoding: "utf8", timeout: 60_000, shell: false });
      return {
        cmd,
        status: out.status,
        // ★★★ A COMMAND THAT NEVER LAUNCHED IS NOT DRIFT. On Windows `npm` and
        // `npx` are `.cmd` shims: `shell: false` cannot start them (ENOENT), and
        // raising `shell: true` to "fix" that is the security boundary this
        // runner exists to hold — so those commands are UNRUNNABLE here, by
        // design, forever. `node` and `grep` do run. Folding a launch failure in
        // with a real non-zero exit would invent drift on every npm-scripted
        // entry, on this platform only. Reproduce the split:
        //   node -e "const{spawnSync:s}=require('node:child_process');for(const b of ['node','npm'])console.log(b,s(b,['--version'],{shell:false}).error?.code??'ran')"
        launchError: out.error ? (out.error.code ?? "ERROR") : null,
        stdout: (out.stdout ?? "").trim().slice(0, 400),
      };
    });
    for (const x of r.reproResults) {
      if (x.launchError) {
        r.problems.push({
          kind: "REPRO_UNRUNNABLE",
          detail: `${x.cmd} (${x.launchError} — not executed, verdict unchanged)`,
        });
      }
    }
    if (r.reproResults.some((x) => !x.launchError && x.status !== 0)) {
      r.verdict = r.verdict === "CLEAN" ? "COUNT_DRIFT" : r.verdict;
      r.problems.push({ kind: "COUNT_DRIFT", detail: "a reproduce command no longer exits 0" });
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
  writeFileSync(jsonPath, `${JSON.stringify({ tally, results }, null, 2)}\n`);
}
// Reporting tool, not a gate: it exits 0 with findings. Promoting it to
// blocking is a separate decision, once its false-positive rate is known.
process.exit(0);
