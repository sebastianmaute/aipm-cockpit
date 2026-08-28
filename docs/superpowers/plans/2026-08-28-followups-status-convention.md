# Open-follow-ups Status Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every open entry in `docs/open-followups.md` carries a `**Status:**` line stating what it is, when it was last verified and by what executed command, enforced by a new blocking CI gate.

**Architecture:** Three small disclosure/hygiene changes to the existing `followups:check` tooling land first, then the 118 missing Status lines are written (43 cheap, 99 after a probe), then the blocking gate lands last — a blocking gate cannot be committed while 118 entries violate it. Gate logic goes in a testable `*-lib.mjs` with a thin `check-*.mjs` entry point, matching the four gates already built that way.

**Tech Stack:** Node 24 ESM (`.mjs`), vitest 4.1.8 (already covers `scripts/**/*.{test,spec}.mjs`), GitLab CI, `git blame`/`git log -S` for vintage recovery.

**Branch:** `docs/followups-status-convention`, currently at `28e2385d` (the spec commit), branched off `main` at `30b0a841` (0.263.0 "Okorafor").

**No version bump.** Nothing in `src/` changes behaviour. `src/app/version.ts`, `CHANGELOG.md` and the five satellites are NOT touched.

---

## Non-goals — do not do these

- **No compression of the register.** Rule 6 (transitive keep: a passage may not be deleted if a surviving passage points at it) plus the 2026-08-05 `docs/prune-open-followups` measurement — 4490 to 4433 lines for eight commits, because almost every lesson transitively pins the measurement it names. Adding Status lines makes this file LONGER. That is correct.
- **No fixing the defects the entries describe.** Triage judges whether a claim still holds. It does not pay the debt.
- **No closing on reasoning.** An entry may be marked `— CLOSED` only when a command was executed and its output contradicts the entry's claim. A reading of current code that "obviously" refutes an entry is NOT sufficient. A wrongly-closed entry reads as protection and stops the audit.
- **No re-baselining any gate to make it pass.**

## Standing constraints for every task

- **NEVER read a gate's exit code through a pipe.** `npm run x | tail -5` reports `tail`'s status. Always: redirect to a file in the scratchpad, `echo "EXIT=$?"` unpiped, then read the file.
- **Never run two vitest processes at once.**
- `docs/open-followups.md` and `AGENTS.md` are **LF-only**. Do not use `sed -i` on any `src/**` file (it re-lines CRLF invisibly); these two are safe.
- **Status lines must cite SYMBOLS, never `path:LINE`.** `docs/open-followups.md` is inside `doc-claims-check`'s scan set and that gate is a RATCHET — one new line citation fails the pipeline.
- Log files go in the session scratchpad, never `/tmp` (shared across sessions; a peer's log has previously overwritten one and been read as this checkout's result).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/followup-claims-lib.mjs` | modify | gains `reproCoverageIn`; loses the dead `node -e ` alternative from `RUNNABLE_RE` |
| `scripts/followup-claims-lib.test.mjs` | modify | new cases for both of the above |
| `scripts/check-followup-claims.mjs` | modify | prints the coverage disclosure |
| `scripts/probes/followup-grammar.mjs` | create | the probe the spec cites; proves which command shapes the runner accepts |
| `scripts/probes/README.md` | create | the probe convention, one page |
| `scripts/followup-status-lib.mjs` | create | `statusBlock` + `statusViolations` — the contract, pure and testable |
| `scripts/followup-status-lib.test.mjs` | create | fixtures **and** a run against the real register |
| `scripts/check-followup-status.mjs` | create | thin entry: read register, report, exit 0/1/2 |
| `docs/open-followups.md` | modify | 118 Status lines, absence markers, whatever closes |
| `package.json` | modify | `followups:status:check` script + `scriptsDescriptions` entry |
| `.gitlab-ci.yml` | modify | blocking `followups-status-check` job in the quality stage |
| `AGENTS.md` | modify | the CI pipeline bullet ("New CI gate → also update this line") |

`followup-status-lib.mjs` imports `parseEntries` and `isClosed` from `followup-claims-lib.mjs`. It never re-implements heading parsing — a second, differently-spelled parser is a second thing to drift, and this register already keeps two deliberately-different closure witnesses for exactly that reason.

---

### Task 1: Vintage recovery for the undated entries

62 open entries carry no ISO date anywhere. Their claims cannot be judged without knowing when they were written. This task recovers that, and **fails loudly** where it cannot — a guessed date is worse than no date, because a date reads as verification.

**Files:**
- Create: `scripts/probes/followup-vintage.mjs`

- [ ] **Step 1: Write the probe**

```js
#!/usr/bin/env node
// NOTE: no shebang is executed — this file is always run as `node scripts/probes/...`.
// A `#!` on an IMPORTED .mjs makes vitest throw a SyntaxError naming the wrong
// file, so probes that are ever imported must not carry one. This one is not
// imported; the line above is a comment, not a shebang.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEntries, isClosed } from "../followup-claims-lib.mjs";

const src = readFileSync("docs/open-followups.md", "utf8");
const entries = parseEntries(src).filter((e) => !isClosed(e.title));
if (entries.length === 0) {
  console.error("VACUITY: parsed zero open entries — the register moved or the parser broke.");
  process.exit(2);
}

const undated = entries.filter(
  (e) => !/20\d\d-\d\d-\d\d/.test(e.body.join("\n")),
);

let recovered = 0;
let unrecoverable = 0;
for (const e of undated) {
  // Find the commit that introduced this heading. -S on the heading text is
  // exact where blame is not: blame on a 21k-line file points at whichever
  // commit last rewrote the region, which is routinely a reformat.
  const needle = `## ${e.n}. `;
  const r = spawnSync(
    "git",
    ["log", "--diff-filter=A", "--format=%ad", "--date=short", "-S", needle, "--", "docs/open-followups.md"],
    { encoding: "utf8", shell: false },
  );
  const dates = r.status === 0 ? r.stdout.trim().split("\n").filter(Boolean) : [];
  if (dates.length === 0) {
    console.log(`§${String(e.n).padStart(3)}  UNRECOVERABLE  ${e.title.slice(0, 60)}`);
    unrecoverable++;
  } else {
    // Oldest is the introduction; git log lists newest first.
    console.log(`§${String(e.n).padStart(3)}  ${dates[dates.length - 1]}     ${e.title.slice(0, 60)}`);
    recovered++;
  }
}

console.log(`\nundated open entries: ${undated.length}`);
console.log(`recovered: ${recovered}   UNRECOVERABLE: ${unrecoverable}`);
console.log(
  "\nAn UNRECOVERABLE entry gets the literal phrase `never machine-verified` in its\n" +
    "Status line. It does NOT get a guessed date.",
);
process.exit(0);
```

- [ ] **Step 2: Run it and capture the inventory**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/probes/followup-vintage.mjs > "$SP/vintage.txt" 2>&1
echo "EXIT=$?"
tail -5 "$SP/vintage.txt"
```

Expected: `EXIT=0`, and a trailing summary naming a count of recovered and unrecoverable entries. If it prints `EXIT=2`, the parser or the register moved — stop and investigate, do not proceed.

> Substitute the real scratchpad path for `$CLAUDE_SCRATCHPAD`; it is in the session system prompt. Do not write to `/tmp`.

- [ ] **Step 3: Sanity-check one recovered date by hand**

Pick any entry the probe dated and confirm independently:

```bash
git log --diff-filter=A --format="%h %ad %s" --date=short -S "## 30. " -- docs/open-followups.md
```

Expected: at least one commit, whose date matches what the probe printed for §30. If the probe and this disagree, the probe is wrong — fix the probe, not the expectation.

- [ ] **Step 4: Commit**

```bash
git add scripts/probes/followup-vintage.mjs
git commit --only scripts/probes/followup-vintage.mjs -m "chore(probes): recover the vintage of undated register entries

62 open entries carry no ISO date, so their claims cannot be judged. This
recovers the introducing commit per entry via git log -S on the heading,
which is exact where blame is not: blame on a 21k-line file points at
whichever commit last rewrote the region, routinely a reformat.

Fails loudly. An entry whose vintage cannot be recovered is reported
UNRECOVERABLE and will get the literal phrase 'never machine-verified'
rather than a guessed date -- a date reads as verification."
```

---

### Task 2: T1 — make the repro runner disclose its own coverage

`--run-repro` reports "no drift" while executing a minority of the commands in the file, and says nothing about the rest. This adds the disclosure. No verdict or exit-code change.

**Files:**
- Modify: `scripts/followup-claims-lib.mjs` (add `reproCoverageIn` beside `reproEntriesIn`)
- Modify: `scripts/followup-claims-lib.test.mjs`
- Modify: `scripts/check-followup-claims.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/followup-claims-lib.test.mjs`:

```js
describe("reproCoverageIn", () => {
  it("splits fenced command lines into extracted and the two rejection causes", () => {
    const text = [
      "```bash",
      "grep -n foo src/app/x.ts",
      "npm run docs:claims:check",
      "cat docs/open-followups.md",
      // ★ Exercises shellMeta via a PIPE, deliberately not via `node -e`:
      // Task 3 removes the node -e alternative from RUNNABLE_RE, which would
      // move that line from the shellMeta bucket to notRunnable and break this
      // fixture two tasks later. A grep with a pipe is stable across both.
      "grep -n foo src | head -3",
      "# a pure comment line",
      "",
      "```",
    ].join("\n");

    expect(reproCoverageIn(text)).toEqual({
      seen: 4,
      extracted: 2,
      notRunnable: 1,
      shellMeta: 1,
    });
  });

  // ★★★ THE CASE THAT ALREADY BIT THIS PLAN. splitTrailingComment returns
  // `{cmd: "", comment: "# …"}` for a comment-only line, NOT null, so the naive
  // filter counts a comment as a rejected command and overstates the gap.
  it("does not count a comment-only line as a command", () => {
    const text = ["```bash", "# just a comment", "grep -n foo src", "```"].join("\n");
    expect(reproCoverageIn(text)).toEqual({
      seen: 1,
      extracted: 1,
      notRunnable: 0,
      shellMeta: 0,
    });
  });

  it("counts nothing outside a fence", () => {
    expect(reproCoverageIn("grep -n foo src")).toEqual({
      seen: 0,
      extracted: 0,
      notRunnable: 0,
      shellMeta: 0,
    });
  });

  // ★ The invariant that must hold on ANY input, including the real register:
  // every seen line lands in exactly one of the three buckets.
  it("partitions: extracted + notRunnable + shellMeta === seen", () => {
    const real = readFileSync("docs/open-followups.md", "utf8");
    const c = reproCoverageIn(real);
    expect(c.seen).toBeGreaterThan(0);
    expect(c.extracted + c.notRunnable + c.shellMeta).toBe(c.seen);
  });
});
```

Add `reproCoverageIn` to the file's existing import from `./followup-claims-lib.mjs`, and `readFileSync` to its `node:fs` import if not already present.

- [ ] **Step 2: Run it and watch it fail**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run scripts/followup-claims-lib.test.mjs --reporter=dot > "$SP/t2.log" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |reproCoverageIn" "$SP/t2.log"
```

Expected: FAIL — `reproCoverageIn is not a function`.

- [ ] **Step 3: Implement it**

In `scripts/followup-claims-lib.mjs`, immediately after `reproEntriesIn`:

```js
/** Coverage of `reproEntriesIn` over one entry body, for disclosure.
 *
 *  ★★★ THIS EXISTS BECAUSE A GREEN `--run-repro` READ AS COVERAGE IT DID NOT
 *  HAVE. Measured 2026-08-28 across the open entries: 85 of 297 fenced command
 *  lines were extracted and 49 of 175 entries had even one runnable command —
 *  29% by two independent measures — while the report said "no drift" and named
 *  neither number. Same shape as reading an exit code through a pipe: the
 *  answer is real, the question was not the one anyone thought was asked.
 *
 *  ★ The three buckets PARTITION `seen`, and a test pins that on the real
 *  register. A bucket that can double-count is a disclosure that overstates
 *  itself, which is the one failure mode worse than no disclosure. */
export function reproCoverageIn(text) {
  const lines = fencedLines(text)
    .map((l) => splitTrailingComment(l.replace(/^\s*(?:>\s?)*/, "").trim()))
    // ★★ `e.cmd !== ""` is load-bearing and was measured, not reasoned.
    // `splitTrailingComment` returns `{cmd: "", comment: "# …"}` for a
    // COMMENT-ONLY line — it does NOT return null — so without this filter a
    // comment inside a fence is counted as a command that failed RUNNABLE_RE.
    // That would overstate the rejected buckets, which is the one direction a
    // coverage disclosure must never err in. (`fencedLines` already drops
    // blank lines, so those need no guard.)
    .filter((e) => e !== null && e.cmd !== "");
  let extracted = 0;
  let notRunnable = 0;
  let shellMeta = 0;
  for (const e of lines) {
    if (!RUNNABLE_RE.test(e.cmd)) notRunnable++;
    else if (SHELL_META.test(e.cmd)) shellMeta++;
    else extracted++;
  }
  return { seen: lines.length, extracted, notRunnable, shellMeta };
}
```

- [ ] **Step 4: Run the test again**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run scripts/followup-claims-lib.test.mjs --reporter=dot > "$SP/t2.log" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/t2.log"
```

Expected: `EXIT=0`, all tests pass.

- [ ] **Step 5: Wire the disclosure into the report**

In `scripts/check-followup-claims.mjs`, add `reproCoverageIn` to the import from `./followup-claims-lib.mjs`. Then, immediately BEFORE the existing line `console.log(\`\nEvery entry above still needs a probe. ...\`)`, insert:

```js
// ★★★ COVERAGE DISCLOSURE. Without this the summary above reads as a verdict
// on the whole register; it is a verdict on the commands this runner can
// actually spawn, which is a minority of them.
const cov = { seen: 0, extracted: 0, notRunnable: 0, shellMeta: 0 };
let entriesWithRunnable = 0;
let entriesWithBlockButNothingRunnable = 0;
for (const e of entries) {
  const c = reproCoverageIn(e.body.join("\n"));
  cov.seen += c.seen;
  cov.extracted += c.extracted;
  cov.notRunnable += c.notRunnable;
  cov.shellMeta += c.shellMeta;
  if (c.extracted > 0) entriesWithRunnable++;
  else if (c.seen > 0) entriesWithBlockButNothingRunnable++;
}
const pct = cov.seen === 0 ? 0 : Math.round((cov.extracted / cov.seen) * 100);
console.log(
  `\nREPRO COVERAGE — what a green run above is actually worth\n` +
    `  fenced command lines seen : ${cov.seen}\n` +
    `  extracted (runnable)      : ${cov.extracted} (${pct}%)\n` +
    `  rejected, not runnable    : ${cov.notRunnable}   (no grep/npm/npx/node-scripts prefix)\n` +
    `  rejected, shell metachar  : ${cov.shellMeta}   (a shell would interpret it; spawn is shell:false)\n` +
    `  open entries with >=1 runnable command : ${entriesWithRunnable} / ${entries.length}\n` +
    `  open entries whose repro block was skipped ENTIRELY : ${entriesWithBlockButNothingRunnable}`,
);
```

The variable holding the parsed open entries in that file is `entries` (verified — it is the `parseEntries(...).filter((e) => !isClosed(e.title))` assignment near the top). Use `entries`, not `results`: `results` is derived from it by `classify` and its members carry `.n` and `.verdict`, not `.body`.

- [ ] **Step 6: Run the real report and read the numbers**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/check-followup-claims.mjs > "$SP/t2-report.log" 2>&1
echo "EXIT=$?"
sed -n '/REPRO COVERAGE/,$p' "$SP/t2-report.log"
```

Expected: `EXIT=0` and a coverage block. **Record the printed numbers in the commit message. Do not assert they equal 297/85/49** — those came from an ad-hoc counter with slightly different line handling, and the lib's own count is the authority. A large disagreement (say, `seen` under 200 or over 400) means the two are measuring different things — investigate before committing.

- [ ] **Step 7: Commit**

```bash
git add scripts/followup-claims-lib.mjs scripts/followup-claims-lib.test.mjs scripts/check-followup-claims.mjs
git commit --only scripts/followup-claims-lib.mjs scripts/followup-claims-lib.test.mjs scripts/check-followup-claims.mjs -m "feat(followups): disclose what a green --run-repro is actually worth

The report said 'no drift' over the commands it can spawn and named no
number. It can spawn a minority of them: reproEntriesIn rejects any line
without a grep/npm/npx/node-scripts prefix, and any line carrying a shell
metacharacter. Both rejections are correct; neither was visible.

Adds reproCoverageIn and prints seen / extracted / both rejection causes,
plus how many open entries had a reproduce block that was skipped
entirely. Verdicts and exit code unchanged -- this is disclosure, not
enforcement.

A test pins that the three buckets PARTITION the lines seen, against the
real register: a disclosure that can double-count overstates itself."
```

---

### Task 3: T2 — remove the unreachable `node -e ` alternative

`RUNNABLE_RE` admits a `node -e ` prefix, but `SHELL_META` rejects every metacharacter a real JavaScript one-liner needs. The branch cannot fire. Removing it makes the grammar honest; the differential test proves the removal changes nothing.

**Files:**
- Modify: `scripts/followup-claims-lib.mjs`
- Modify: `scripts/followup-claims-lib.test.mjs`

- [ ] **Step 1: Capture the BEFORE output — this is the differential baseline**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/check-followup-claims.mjs > "$SP/t3-before.log" 2>&1
echo "EXIT=$?"
wc -l < "$SP/t3-before.log"
```

- [ ] **Step 2: Write the test that pins the claim**

Append to `scripts/followup-claims-lib.test.mjs`:

```js
describe("the node -e grammar branch", () => {
  // ★★★ THE CLAIM: `node -e` cannot carry real JavaScript past SHELL_META, so
  // listing it in RUNNABLE_RE was dead grammar. Both quoting styles, measured.
  it.each([
    ['node -e "console.log(1)"'],
    ["node -e 'console.log(1)'"],
    ['node -e "const a = {b: 1}"'],
  ])("rejects %s", (cmd) => {
    expect(reproEntriesIn("```bash\n" + cmd + "\n```")).toEqual([]);
  });

  // ★★ The counter-assertion. Without it this file would pass with
  // reproEntriesIn hard-coded to return [], which would delete the gate.
  it("still accepts the shapes the register actually uses", () => {
    for (const cmd of [
      "grep -n foo src/app/x.ts",
      "npm run docs:claims:check",
      "npx tsc --noEmit",
      "node scripts/probes/followup-grammar.mjs",
    ]) {
      expect(reproEntriesIn("```bash\n" + cmd + "\n```")).toHaveLength(1);
    }
  });

  // ★★★ THE REMOVAL IS ONLY SAFE IF NO LINE IN THE REGISTER RELIES ON IT. A
  // metacharacter-free `node -e` would be extracted today and stop being. This
  // asserts the register contains none, which is what makes the change a
  // no-op rather than a silent loss of coverage.
  it("no line in the real register is extracted via the node -e branch", () => {
    const real = readFileSync("docs/open-followups.md", "utf8");
    const viaNodeE = reproEntriesIn(real).filter((e) => e.cmd.startsWith("node -e "));
    expect(viaNodeE).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it — it must pass BEFORE the removal**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run scripts/followup-claims-lib.test.mjs --reporter=dot > "$SP/t3.log" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/t3.log"
```

Expected: `EXIT=0`. This is deliberately not a red-first test — it is a characterization test proving the branch is already dead. If any case FAILS here, the premise is wrong: stop, and do not remove the branch.

- [ ] **Step 4: Remove the alternative**

In `scripts/followup-claims-lib.mjs`, change:

```js
const RUNNABLE_RE = /^(?:grep\b|node -e |node scripts\/[\w.-]+|npm run [a-z0-9:_-]+$|npx [\w@/.-]+)/;
```

to:

```js
/** ★★★ `node -e ` WAS LISTED HERE AND COULD NEVER FIRE. SHELL_META rejects
 *  ( ) { } $ backtick | ; & < > and no useful JavaScript avoids all of them, so
 *  the alternative was dead grammar that read as capability. Measured 2026-08-28
 *  in both quoting styles, and a test pins that no line in the register was ever
 *  extracted through it — which is what made the removal a no-op.
 *
 *  ★★ DO NOT REINTRODUCE IT by loosening SHELL_META. `spawnSync` runs with
 *  `shell: false`, so the metacharacters are inert as argv — but `node -e` would
 *  then execute arbitrary JavaScript lifted verbatim out of a markdown file, on
 *  every --run-repro. Computation belongs in a committed probe under
 *  `scripts/probes/`, which lint, review and git log can all see. See
 *  scripts/probes/README.md. */
const RUNNABLE_RE = /^(?:grep\b|node scripts\/[\w.-]+|npm run [a-z0-9:_-]+$|npx [\w@/.-]+)/;
```

- [ ] **Step 5: Prove the removal changed no output**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/check-followup-claims.mjs > "$SP/t3-after.log" 2>&1
echo "EXIT=$?"
diff "$SP/t3-before.log" "$SP/t3-after.log"
echo "DIFF_EXIT=$?"
npx vitest run scripts/followup-claims-lib.test.mjs --reporter=dot > "$SP/t3b.log" 2>&1
echo "VITEST_EXIT=$?"
grep -E "Test Files|Tests " "$SP/t3b.log"
```

Expected: `DIFF_EXIT=0` (byte-identical reports) and `VITEST_EXIT=0`. A non-empty diff means the branch was NOT dead — revert the removal and re-open the question.

- [ ] **Step 6: Commit**

```bash
git add scripts/followup-claims-lib.mjs scripts/followup-claims-lib.test.mjs
git commit --only scripts/followup-claims-lib.mjs scripts/followup-claims-lib.test.mjs -m "fix(followups): drop the node -e branch that could never fire

RUNNABLE_RE admitted a 'node -e ' prefix while SHELL_META rejects every
metacharacter real JavaScript needs, so the alternative was dead grammar
that read as capability. That mattered more than its size: node -e is
this repo's house idiom for measurement, so the commonest form in the
register looked runnable and never was.

Removal proved a no-op by diffing the full report before and after
(byte-identical), and pinned by a test asserting no line in the register
was ever extracted through that branch.

Deliberately NOT fixed by loosening SHELL_META: node -e would then run
arbitrary JavaScript lifted verbatim from markdown. Computation goes in a
committed probe instead."
```

---

### Task 4: T3 — the probe convention

**Files:**
- Create: `scripts/probes/README.md`
- Create: `scripts/probes/followup-grammar.mjs`

- [ ] **Step 1: Write the grammar probe** (the spec cites this path; it must exist)

`scripts/probes/followup-grammar.mjs`:

```js
import { reproEntriesIn } from "../followup-claims-lib.mjs";

// Each row: [command, expected-runnable]. Keep the FALSE rows — a probe that
// only shows what works cannot show what a caller must avoid.
const CASES = [
  ["grep -n foo src/app/x.ts", true],
  ["npm run docs:claims:check", true],
  ["npx tsc --noEmit", true],
  ["node scripts/probes/followup-grammar.mjs", true],
  ['node -e "console.log(1)"', false],
  ["node -e 'console.log(1)'", false],
  ["npm run test:run --silent", false],
  ["grep -n foo src | head -3", false],
];

let bad = 0;
for (const [cmd, want] of CASES) {
  const got = reproEntriesIn("```bash\n" + cmd + "\n```").length > 0;
  if (got !== want) bad++;
  console.log(`${got ? "RUNNABLE" : "rejected"}  ${got === want ? "  " : "!!"}  ${cmd}`);
}
console.log(`\n${CASES.length} cases, ${bad} disagreeing with the documented grammar.`);
console.log("A `node -e` command is NEVER runnable — put computation in a probe like this one.");
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/probes/followup-grammar.mjs > "$SP/t4.log" 2>&1
echo "EXIT=$?"
cat "$SP/t4.log"
```

Expected: `EXIT=0`, `0 disagreeing`, and `npm run test:run --silent` rejected (the `npm run` alternative is anchored with `$`, so a trailing flag breaks it).

- [ ] **Step 3: Write the convention page**

`scripts/probes/README.md`:

```markdown
# Register probes

A probe is the executable half of a `docs/open-followups.md` entry. It exists so
an entry can be settled by running something rather than by re-reading code.

## Why probes and not `node -e` in the markdown

`scripts/followup-claims-lib.mjs` will not run a command containing a shell
metacharacter, so no real JavaScript one-liner is runnable from the register.
That guard is deliberate and stays: `node -e` would mean executing arbitrary
JavaScript lifted verbatim out of a markdown file on every `--run-repro`.

A probe is an ordinary repo file. Lint sees it, review sees it, `git log` sees
it, and `node scripts/probes/followup-NNN.mjs` IS in the runner's grammar.

## Contract

- Name it `followup-<entry number>.mjs`, or a descriptive name for a probe that
  serves no single entry.
- Print the finding on stdout. A reader must be able to judge the entry from the
  output alone, without opening the probe.
- **Exit 0** when the scan SUCCEEDED — including when it found the defect. Exit
  code reports whether the probe could do its job, not whether the news is good.
- **Exit 2** when the probe could not scan at all: a missing file, a parser that
  returned nothing. A scan that reads nothing passes everything, so this vacuity
  guard is mandatory.
- Exit 1 only if the probe is also used as a gate.
- No shebang line. A `#!` on a `.mjs` that is ever imported makes vitest throw a
  SyntaxError naming the wrong file.

## Citing one

In the entry's `**Status:**` line, in a fenced block:

    node scripts/probes/followup-213.mjs

Never a `path:LINE` citation — `docs/open-followups.md` is inside
`doc-claims-check`'s scan set, and that gate is a ratchet.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/probes/README.md scripts/probes/followup-grammar.mjs
git commit --only scripts/probes/README.md scripts/probes/followup-grammar.mjs -m "chore(probes): establish the probe convention

An entry needing computation to falsify gets a committed probe rather
than a markdown one-liner, because a one-liner is unrunnable by design
and unreviewable in practice.

Contract: print the finding, exit 0 on a successful scan even when it
finds the defect, exit 2 when it could not scan at all. The exit code
reports whether the probe did its job, never whether the news is good.

followup-grammar.mjs is the executable statement of which command shapes
the runner accepts, keeping its FALSE rows -- a probe that shows only
what works cannot show what to avoid."
```

---

### Task 5: Clear the false checker flags with absence markers

Six of the checker's flagged names are names a FIX would create, not names a claim depends on. They are reported as missing symbols, which makes the flag list not worth reading. `scripts/followup-claims-lib.mjs` exports `ABSENCE_STATE_WORDS` and `REGISTER_ABSENCE_PATTERNS` — the recognised ways of saying "deliberately absent".

**Files:**
- Modify: `docs/open-followups.md` (§7, §58, §204, §213, §215)

- [ ] **Step 1: Read what the checker accepts as an absence marker**

```bash
grep -n "ABSENCE_STATE_WORDS" -A 12 scripts/followup-claims-lib.mjs
grep -n "REGISTER_ABSENCE_PATTERNS" -A 12 scripts/followup-claims-lib.mjs
```

Use one of the recognised forms. **Do not widen either list to make the flags clear** — a defeated gate reports success, and this repo records that mistake explicitly.

- [ ] **Step 2: Confirm each name really is absent**

```bash
grep -rn "deleteAllChatThreadsForProject" src scripts e2e
grep -rn "deleteAllCommitteeReportVersionsForProject" src scripts e2e
grep -rn "wroteBytesRef" src scripts e2e
grep -rn "resource_group" src scripts e2e
grep -rn "MutationObserver" src scripts e2e
```

Expected: no hits for any of them (`grep` exits 1 on no match — that is the documented outcome here, not an error). If ANY returns a hit, that name is not a proposal and this task's premise is wrong for it — leave that one alone and say so in the commit message.

- [ ] **Step 3: Mark each mention**

At each mention, in the entry's own prose, say the name does not exist yet and is what a fix would add. For §204, for example, phrase the fix sentence so the marker sits next to the name — the checker matches near the mention, not per-entry.

§7's `form-field.tsx` is already a proposal and is documented as such inside `scripts/followup-claims-lib.mjs`. Mark it the same way; do not touch the lib.

- [ ] **Step 4: Verify the flags cleared**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/check-followup-claims.mjs > "$SP/t5.log" 2>&1
echo "EXIT=$?"
grep -E "SYMBOL_MISSING|PATH_MISSING|^CLEAN=" "$SP/t5.log"
```

Expected: `SYMBOL_MISSING` and `PATH_MISSING` counts drop to 0 in the tally line, and `CLEAN` rises correspondingly. Any flag that remains is a real one — leave it and record it.

- [ ] **Step 5: Check the doc-claims ratchet did not move**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run docs:claims:check > "$SP/t5-claims.log" 2>&1
echo "EXIT=$?"
tail -6 "$SP/t5-claims.log"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "docs(register): mark proposed names as deliberately absent

Six flagged names return zero hits because they are names a FIX would
create, not names a claim depends on: deleteAllChatThreadsForProject and
deleteAllCommitteeReportVersionsForProject (204), wroteBytesRef (213),
resource_group (215), MutationObserver (58), form-field.tsx (7).

Reported as missing symbols they made the flag list not worth reading,
which is how a real one would have been missed. Marked with the absence
forms the checker already recognises -- neither allowlist was widened,
because a gate widened to pass reports success."
```

---

### Task 6: The 43 fresh entries — Status line only

These were written within the last eight days and already state their state in prose. The line formalises what the body says. **No probe, no closure, no rewording of the body.**

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: List today's set — do not use the numbers below as input**

```bash
node scripts/probes/followup-status-gaps.mjs
```

Create that probe first:

```js
import { readFileSync } from "node:fs";
import { parseEntries, isClosed } from "../followup-claims-lib.mjs";

const entries = parseEntries(readFileSync("docs/open-followups.md", "utf8")).filter(
  (e) => !isClosed(e.title),
);
if (entries.length === 0) {
  console.error("VACUITY: parsed zero open entries.");
  process.exit(2);
}
const FRESH = "2026-08-20";
const lastDate = (e) => {
  const d = [...e.body.join("\n").matchAll(/20\d\d-\d\d-\d\d/g)].map((m) => m[0]).sort();
  return d.length ? d[d.length - 1] : null;
};
const hasStatus = (e) => e.body.some((l) => /^\*\*Status:\*\*/.test(l));

const cheap = entries.filter((e) => !hasStatus(e) && lastDate(e) && lastDate(e) >= FRESH);
const probeNeeded = entries.filter((e) => {
  const d = lastDate(e);
  return !d || d < FRESH;
});
const done = entries.filter((e) => hasStatus(e) && lastDate(e) && lastDate(e) >= FRESH);

console.log(`open: ${entries.length}`);
console.log(`CHEAP  (no Status, fresh)      : ${cheap.length}  ${cheap.map((e) => e.n).join(",")}`);
console.log(`PROBE  (stale or undated)      : ${probeNeeded.length}  ${probeNeeded.map((e) => e.n).join(",")}`);
console.log(`DONE   (has Status, fresh)     : ${done.length}`);
process.exit(0);
```

Expected on a clean checkout of this branch: `CHEAP` around 43 and `PROBE` around 99. Use whatever it prints; the numbers move as this plan's own tasks edit the file.

- [ ] **Step 2: Add one Status line per CHEAP entry**

Insert immediately after the `##` heading and its blank line, before the existing first paragraph. Form:

```markdown
**Status:** open — <one clause naming what kind of thing it is>. Filed <the ISO
date already in the body>; not machine-verified since.
```

Rules, all four of which the gate in Task 11 will check:
- starts with the literal `**Status:**`
- must NOT contain the word CLOSED — the heading owns closure
- carries an ISO date, taken from the body, never invented
- names the last executed verification, or says none has been run

Since these entries are fresh but unprobed, the honest fourth clause is `not machine-verified since`. Do not claim a verification that did not happen.

- [ ] **Step 3: Verify the count moved and nothing else did**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/probes/followup-status-gaps.mjs > "$SP/t6.log" 2>&1
echo "EXIT=$?"
cat "$SP/t6.log"
git diff --stat docs/open-followups.md
```

Expected: `CHEAP` is now 0; `PROBE` unchanged; `git diff --stat` shows insertions only, and roughly two lines per entry touched. **A deletion here is a bug** — this task adds.

- [ ] **Step 4: Run the counting witnesses — they must all still agree**

```bash
grep -cE "^## [0-9]+." docs/open-followups.md
grep -E "^## [0-9]+." docs/open-followups.md | grep -c "— CLOSED"
grep -E "^## [0-9]+." docs/open-followups.md | grep -cv "— CLOSED"
```

Expected: unchanged from the start of this task. A Status line must never move a count.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md scripts/probes/followup-status-gaps.mjs
git commit --only docs/open-followups.md scripts/probes/followup-status-gaps.mjs -m "docs(register): give the recently-written entries a Status line

These were written within the last eight days and already state their
state in prose; the line formalises it so a count can see it. No probe,
no closure, no rewording -- and the honest fourth clause on every one of
them is 'not machine-verified since', because none has been.

followup-status-gaps.mjs classifies the remaining work rather than
leaving a hardcoded list to rot."
```

---

### Task 7: Triage protocol — dispatch the first batch

The remaining entries are stale or undated and need a probe before anything can be said about them. They are worked in batches by **read-only** subagents.

**Why read-only:** all of them touch one 21,138-line file. Parallel writers on it are a guaranteed conflict, and overlapping writers are recorded in this project's history as fabricating findings in both directions. The controller is the sole writer.

**Files:**
- Modify: `docs/open-followups.md` (by the controller only)
- Create: `scripts/probes/followup-<n>.mjs` (only where computation is needed)

- [ ] **Step 1: Split the PROBE list into batches of about 12**

Take the `PROBE` list printed by `scripts/probes/followup-status-gaps.mjs`. Batches are by entry number, so they are disjoint by construction.

- [ ] **Step 2: Dispatch one subagent per batch with this brief**

```
You are auditing entries in docs/open-followups.md. READ-ONLY: you must not
edit, create or delete any file. Do not run git commands that write.

Entries assigned: §<numbers>

For EACH entry:
1. Read it. State its central falsifiable claim in one sentence.
2. Find or construct a command that would DISPROVE that claim if it were
   already fixed. Prefer grep. If it needs computation, describe the probe you
   would write -- do not write it.
3. RUN the command. Paste the exact command and its EXACT output, including
   the exit code. Do not summarise the output.
4. Give a verdict:
   LIVE       - the claim reproduces today
   DEAD       - the output CONTRADICTS the claim (quote the contradicting part)
   UNPROVABLE - no command you can run settles it; say what would be needed

Rules:
- A verdict with no pasted command output is not a verdict. Do not give one.
- DEAD requires output that contradicts the claim. "I read the code and it
  looks fixed" is UNPROVABLE, not DEAD.
- grep exits 1 on no match. That is a result, not an error.
- Never read an exit code through a pipe.
- If the brief itself is wrong about an entry, say so. You are expected to
  refute me.

Report by calling SendMessage. Plain text will not reach me.
```

- [ ] **Step 3: Re-verify every DEAD verdict yourself before writing anything**

For each `DEAD`, re-run the agent's own command and confirm the output matches what was reported. A subagent claim is a lead, not a fact — this project has measured reviewers returning confident findings that did not reproduce, in both directions.

- [ ] **Step 4: Write the register — controller only**

- `LIVE` → add a Status line citing the command that reproduced it.
- `DEAD` → add ` — CLOSED 2026-08-28` to the `##` heading AND a Status line quoting the command and the output that closed it. Do not delete the body.
- `UNPROVABLE` → add a Status line saying so, naming what would settle it.

If a probe file is genuinely needed, write it under `scripts/probes/`, run it, and cite it.

- [ ] **Step 5: Verify counts and gates after the batch**

```bash
SP="$CLAUDE_SCRATCHPAD"
grep -cE "^## [0-9]+." docs/open-followups.md
grep -E "^## [0-9]+." docs/open-followups.md | grep -c "— CLOSED"
grep -E "^## [0-9]+." docs/open-followups.md | grep -cv "— CLOSED"
node scripts/check-followup-claims.mjs > "$SP/t7-claims.log" 2>&1; echo "CLAIMS_EXIT=$?"
npm run docs:claims:check > "$SP/t7-doc.log" 2>&1; echo "DOCCLAIMS_EXIT=$?"
tail -4 "$SP/t7-doc.log"
```

Expected: the numbered total is unchanged, closed has risen by exactly the number of `DEAD` verdicts, and both gates exit 0.

- [ ] **Step 6: Check no partial got the word CLOSED**

```bash
grep -E "^## [0-9]+." docs/open-followups.md | grep -vE "— CLOSED" | grep -E "FIXED|CLOSED"
```

Expected: the 11 known partials and nothing else. An entry appearing here that is not one of them means a partial was wrongly marked — the one mistake that breaks every count.

- [ ] **Step 7: Commit the batch**

```bash
git add docs/open-followups.md scripts/probes
git commit --only docs/open-followups.md scripts/probes -m "docs(register): triage batch 1 -- Status lines and executed verdicts

Each entry carries the command that was run and its output. Entries
marked CLOSED were closed by output that contradicts the claim, never by
a reading of the code; anything that could not be settled by a command
says so in the words 'UNPROVABLE' rather than being left silent."
```

---

### Tasks 8, 9, 10: Triage the remaining batches

One task per batch, until the PROBE list is empty. Each batch is a full cycle of the steps below — they are restated here rather than cross-referenced, because a batch worked out of order is exactly when a skipped verification step becomes a wrongly-closed entry.

**Files:**
- Modify: `docs/open-followups.md` (controller only)
- Create: `scripts/probes/followup-<n>.mjs` where computation is needed

- [ ] **Step 1: Take the next batch of about 12 from the PROBE list**

```bash
node scripts/probes/followup-status-gaps.mjs
```

- [ ] **Step 2: Dispatch ONE read-only subagent with this brief**

```
You are auditing entries in docs/open-followups.md. READ-ONLY: you must not
edit, create or delete any file. Do not run git commands that write.

Entries assigned: §<numbers>

For EACH entry:
1. Read it. State its central falsifiable claim in one sentence.
2. Find or construct a command that would DISPROVE that claim if it were
   already fixed. Prefer grep. If it needs computation, describe the probe you
   would write -- do not write it.
3. RUN the command. Paste the exact command and its EXACT output, including
   the exit code. Do not summarise the output.
4. Give a verdict:
   LIVE       - the claim reproduces today
   DEAD       - the output CONTRADICTS the claim (quote the contradicting part)
   UNPROVABLE - no command you can run settles it; say what would be needed

Rules:
- A verdict with no pasted command output is not a verdict. Do not give one.
- DEAD requires output that contradicts the claim. "I read the code and it
  looks fixed" is UNPROVABLE, not DEAD.
- grep exits 1 on no match. That is a result, not an error.
- Never read an exit code through a pipe.
- If the brief itself is wrong about an entry, say so. You are expected to
  refute me.

Report by calling SendMessage. Plain text will not reach me.
```

- [ ] **Step 3: Re-run every DEAD command yourself before writing anything**

Confirm the output matches what was reported. A subagent claim is a lead, not a fact — this project has measured reviewers returning confident findings that did not reproduce, in both directions. Do not skip this step because the previous batch's verdicts were all sound.

- [ ] **Step 4: Write the register — controller only**

- `LIVE` → Status line citing the command that reproduced it.
- `DEAD` → ` — CLOSED 2026-08-28` appended to the `##` heading, AND a Status line quoting the command and the contradicting output. Never delete the body.
- `UNPROVABLE` → Status line saying so, naming what would settle it.

- [ ] **Step 5: Verify counts and gates**

```bash
SP="$CLAUDE_SCRATCHPAD"
grep -cE "^## [0-9]+." docs/open-followups.md
grep -E "^## [0-9]+." docs/open-followups.md | grep -c "— CLOSED"
grep -E "^## [0-9]+." docs/open-followups.md | grep -cv "— CLOSED"
node scripts/check-followup-claims.mjs > "$SP/batch-claims.log" 2>&1; echo "CLAIMS_EXIT=$?"
npm run docs:claims:check > "$SP/batch-doc.log" 2>&1; echo "DOCCLAIMS_EXIT=$?"
tail -4 "$SP/batch-doc.log"
```

Expected: numbered total unchanged; closed risen by exactly the number of `DEAD` verdicts; both gates exit 0.

- [ ] **Step 6: Check no partial got the word CLOSED**

```bash
grep -E "^## [0-9]+." docs/open-followups.md | grep -vE "— CLOSED" | grep -E "FIXED|CLOSED"
```

Expected: the 11 known partials and nothing else.

- [ ] **Step 7: Commit the batch**

```bash
git add docs/open-followups.md scripts/probes
git commit --only docs/open-followups.md scripts/probes -m "docs(register): triage batch N -- Status lines and executed verdicts

Each entry carries the command that was run and its output. Entries
marked CLOSED were closed by output contradicting the claim, never by a
reading of the code; anything a command could not settle says UNPROVABLE
rather than being left silent."
```

- [ ] **Step 8: Stop when the list is empty**

```bash
node scripts/probes/followup-status-gaps.mjs
```

Repeat this task until it prints `PROBE  (stale or undated)      : 0`. If a batch turns out to need a probe per entry, split it further rather than lowering the evidence bar.

---

### Task 11: T4 — the gate library

**Files:**
- Create: `scripts/followup-status-lib.mjs`
- Create: `scripts/followup-status-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

`scripts/followup-status-lib.test.mjs`:

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statusBlock, statusViolations } from "./followup-status-lib.mjs";
import { parseEntries, isClosed } from "./followup-claims-lib.mjs";

const entry = (...body) => ({ n: 1, title: "t", startLine: 1, body });

describe("statusBlock", () => {
  it("returns null when there is no Status line", () => {
    expect(statusBlock(entry("", "some prose", ""))).toBeNull();
  });

  // ★★ Status lines WRAP. A single-line regex reads only the first physical
  // line and would miss a date or a command on the second, failing a
  // conformant entry -- the expensive direction for a blocking gate.
  it("runs to the next blank line, not the next newline", () => {
    const b = statusBlock(entry("", "**Status:** open — filed", "2026-08-28.", "", "prose"));
    expect(b).toBe("**Status:** open — filed\n2026-08-28.");
  });
});

describe("statusViolations", () => {
  it("reports MISSING when there is no Status line", () => {
    expect(statusViolations(entry("", "prose"))).toEqual(["MISSING"]);
  });

  it("accepts a line with a date and a backticked command", () => {
    expect(
      statusViolations(entry("", "**Status:** open — 2026-08-28, `grep -n foo src`.")),
    ).toEqual([]);
  });

  it("accepts the explicit never-verified escape", () => {
    expect(
      statusViolations(entry("", "**Status:** open — 2026-08-28, never machine-verified.")),
    ).toEqual([]);
  });

  it("rejects a Status line claiming closure — the heading owns that", () => {
    expect(
      statusViolations(entry("", "**Status:** CLOSED 2026-08-28, `grep -n foo src`.")),
    ).toContain("SAYS_CLOSED");
  });

  it("rejects a line with no date", () => {
    expect(statusViolations(entry("", "**Status:** open — `grep -n foo src`."))).toContain(
      "NO_DATE",
    );
  });

  it("rejects a line naming no verification at all", () => {
    expect(statusViolations(entry("", "**Status:** open — 2026-08-28."))).toContain(
      "NO_VERIFICATION",
    );
  });

  // ★★★ AGAINST THE REAL REGISTER. Every defect this family of gates has
  // shipped was a regex defect, and both were found by running against the real
  // docs rather than by reading the code.
  it("passes every open entry in the real register", () => {
    const entries = parseEntries(readFileSync("docs/open-followups.md", "utf8")).filter(
      (e) => !isClosed(e.title),
    );
    expect(entries.length).toBeGreaterThan(0); // vacuity guard
    const bad = entries
      .map((e) => ({ n: e.n, v: statusViolations(e) }))
      .filter((x) => x.v.length > 0);
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run scripts/followup-status-lib.test.mjs --reporter=dot > "$SP/t11.log" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find" "$SP/t11.log"
```

Expected: FAIL — cannot resolve `./followup-status-lib.mjs`.

- [ ] **Step 3: Implement the library**

`scripts/followup-status-lib.mjs`:

```js
/** The `**Status:**` contract for OPEN entries in docs/open-followups.md.
 *
 *  ★★★ WHY THIS IS A GATE AND NOT A REPORT. 118 of 175 open entries had no
 *  Status line on 2026-08-28, and nothing had ever checked. An unenforced
 *  convention in this repo decays; the register itself records that as a class.
 *
 *  ★★ Parsing is NOT re-implemented here. parseEntries/isClosed come from
 *  followup-claims-lib.mjs, because a second, differently-spelled heading parser
 *  is a second thing to drift out of agreement with the first. */

/** The Status BLOCK: from the `**Status:**` line to the next blank line.
 *  ★★ Status lines WRAP in this register, so a single-line match would read
 *  only the first physical line and fail a conformant entry whose date or
 *  command sits on the second. For a blocking gate that is the expensive
 *  direction of error. */
export function statusBlock(entry) {
  const i = entry.body.findIndex((l) => /^\*\*Status:\*\*/.test(l));
  if (i === -1) return null;
  const out = [entry.body[i]];
  for (let j = i + 1; j < entry.body.length; j++) {
    if (entry.body[j].trim() === "") break;
    out.push(entry.body[j]);
  }
  return out.join("\n");
}

/** Clause 4 of the contract: the block names the last EXECUTED verification, or
 *  says outright that none has been run.
 *  ★★ The escape hatch is deliberate and is the honest answer for most entries.
 *  `**Status:** open — never machine-verified.` is greppable; silence is not,
 *  and silence is what 118 entries had. Without the escape the gate would push
 *  authors toward inventing a verification, which is strictly worse. */
const VERIFICATION_RE = /`[^`]+`/;
const NEVER_VERIFIED_RE = /never machine-verified/i;

export function statusViolations(entry) {
  const block = statusBlock(entry);
  if (block === null) return ["MISSING"];
  const out = [];
  // The heading owns closure. A body line claiming it breaks every count.
  if (/\bCLOSED\b/.test(block)) out.push("SAYS_CLOSED");
  if (!/\b20\d\d-\d\d-\d\d\b/.test(block)) out.push("NO_DATE");
  if (!VERIFICATION_RE.test(block) && !NEVER_VERIFIED_RE.test(block)) {
    out.push("NO_VERIFICATION");
  }
  return out;
}

export const VIOLATION_HELP = {
  MISSING: "no `**Status:**` line — every OPEN entry needs one",
  SAYS_CLOSED: "the Status line says CLOSED; closure lives in the `##` heading",
  NO_DATE: "no ISO YYYY-MM-DD date in the Status block",
  NO_VERIFICATION:
    "names no executed verification — cite a command in backticks, or say `never machine-verified`",
};
```

- [ ] **Step 4: Run the test again**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run scripts/followup-status-lib.test.mjs --reporter=dot > "$SP/t11.log" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " "$SP/t11.log"
```

Expected: `EXIT=0`. If the real-register case fails, it is naming entries that still violate the contract — go fix those entries, not the regex.

- [ ] **Step 5: Mutation-check the wrap handling**

Temporarily change `statusBlock`'s loop to stop after the first line (`return entry.body[i];`), re-run, and confirm the wrap test goes RED. Then restore it and confirm green. A guard nothing can kill is a guard nothing is testing.

```bash
SP="$CLAUDE_SCRATCHPAD"
npx vitest run scripts/followup-status-lib.test.mjs --reporter=dot > "$SP/t11-mut.log" 2>&1
echo "MUTANT_EXIT=$?"
grep -E "Tests |next blank line" "$SP/t11-mut.log"
```

Expected while mutated: non-zero, with the "runs to the next blank line" case failing. **Restore the file before doing anything else** and prove it:

```bash
git diff --stat scripts/followup-status-lib.mjs
```

Expected after restoring: empty output.

- [ ] **Step 6: Commit**

```bash
git add scripts/followup-status-lib.mjs scripts/followup-status-lib.test.mjs
git commit --only scripts/followup-status-lib.mjs scripts/followup-status-lib.test.mjs -m "feat(followups): the Status-line contract, as a testable library

Four clauses: the line exists, it does not claim closure (the heading
owns that), it carries an ISO date, and it names an executed verification
or says outright that none was run.

The last clause keeps its escape hatch on purpose. 'never
machine-verified' is honest and greppable; without it the gate would push
authors toward inventing a verification, which is worse than silence.

The block runs to the next BLANK line, not the next newline -- these
lines wrap, and a single-line match would fail conformant entries, the
expensive direction for a blocking gate. Mutation-checked.

Parsing is reused from followup-claims-lib rather than re-implemented."
```

---

### Task 12: T4 — the gate entry point and npm script

**Files:**
- Create: `scripts/check-followup-status.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the entry point**

`scripts/check-followup-status.mjs`:

```js
import { readFileSync } from "node:fs";
import { parseEntries, isClosed } from "./followup-claims-lib.mjs";
import { statusViolations, VIOLATION_HELP } from "./followup-status-lib.mjs";

const REGISTER = "docs/open-followups.md";

/** ★★★ TWO FAILURE MODES, TWO EXIT CODES, and they demand opposite responses.
 *  Exit 1 is DRIFT: an entry violates the contract, and the fix is to write the
 *  Status line. Exit 2 is the gate UNABLE TO DO ITS JOB: the register is
 *  unreadable, or the parser returned nothing. A scanner that reads nothing
 *  passes everything, so the vacuity guard is not optional. version-sync-check
 *  is the precedent; before it split these, a red pipeline could not be read
 *  without opening the log. */
let src;
try {
  src = readFileSync(REGISTER, "utf8");
} catch (err) {
  console.error(`CANNOT SCAN: ${REGISTER} is unreadable (${err.code ?? err.message}).`);
  process.exit(2);
}

const open = parseEntries(src).filter((e) => !isClosed(e.title));
if (open.length === 0) {
  console.error(
    `CANNOT SCAN: parsed zero open entries from ${REGISTER}.\n` +
      "Either the file lost its `## N.` headings or the shared parser changed.\n" +
      "This is a vacuity guard: a scan that reads nothing would otherwise pass everything.",
  );
  process.exit(2);
}

const bad = open.map((e) => ({ e, v: statusViolations(e) })).filter((x) => x.v.length > 0);

console.log(`Status-line contract — ${open.length} open entries scanned\n`);
for (const { e, v } of bad) {
  console.log(`  §${e.n}  ${e.title.slice(0, 70)}`);
  for (const k of v) console.log(`      ${k}: ${VIOLATION_HELP[k]}`);
}

if (bad.length === 0) {
  console.log("All open entries carry a conforming Status line.");
  process.exit(0);
}

console.log(
  `\n${bad.length} of ${open.length} open entries violate the contract.\n` +
    "Every OPEN entry needs a `**Status:**` line that carries an ISO date and\n" +
    "either cites a command in backticks or says `never machine-verified`.\n" +
    "Do NOT satisfy this by inventing a verification that was not run.",
);
process.exit(1);
```

- [ ] **Step 2: Run it — expect exit 0 by now**

```bash
SP="$CLAUDE_SCRATCHPAD"
node scripts/check-followup-status.mjs > "$SP/t12.log" 2>&1
echo "EXIT=$?"
cat "$SP/t12.log"
```

Expected: `EXIT=0` and `All open entries carry a conforming Status line.` If it exits 1, Tasks 6–10 are not finished — go back and finish them. **Do not weaken the contract to make this pass.**

- [ ] **Step 3: Prove the exit-2 vacuity guard fires**

```bash
SP="$CLAUDE_SCRATCHPAD"
cp docs/open-followups.md "$SP/register-backup.md"
printf 'no headings here\n' > docs/open-followups.md
node scripts/check-followup-status.mjs > "$SP/t12-vacuity.log" 2>&1
echo "EXIT=$?"
cat "$SP/t12-vacuity.log"
cp "$SP/register-backup.md" docs/open-followups.md
git diff --stat docs/open-followups.md
```

Expected: `EXIT=2` with the CANNOT SCAN message, then an EMPTY `git diff --stat` after restoring. The restore proof is mandatory — a live mutant left in the tree is a recorded failure mode here.

- [ ] **Step 4: Add the npm script AND its description**

In `package.json`, add to `scripts`:

```json
"followups:status:check": "node scripts/check-followup-status.mjs"
```

and to `scriptsDescriptions`:

```json
"followups:status:check": "Fail if an OPEN docs/open-followups.md entry has no conforming `**Status:**` line (BLOCKING; exit 1 = drift, exit 2 = the gate could not scan at all)"
```

- [ ] **Step 5: Sync the generated script tables**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run docs:scripts > "$SP/t12-sync.log" 2>&1; echo "SYNC_EXIT=$?"
npm run docs:scripts:check > "$SP/t12-check.log" 2>&1; echo "CHECK_EXIT=$?"
tail -4 "$SP/t12-check.log"
git status --porcelain
```

Expected: both `EXIT=0`, and `git status` showing whichever docs the sync regenerated. Omitting this fails the build — `docs:scripts:check` runs in CI.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-followup-status.mjs package.json
git add -u
git commit -m "feat(followups): gate the Status-line contract

Exit 0 clean, exit 1 DRIFT (an entry violates the contract), exit 2 the
gate could not do its job -- an unreadable register, or zero entries
parsed. The two failures demand opposite responses, which is why they get
different codes; version-sync-check is the precedent.

The exit-2 vacuity guard is the load-bearing one: a scanner that reads
nothing passes everything."
```

---

### Task 13: Wire the blocking CI job and update AGENTS.md

**Files:**
- Modify: `.gitlab-ci.yml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the job to the quality stage**

In `.gitlab-ci.yml`, beside the other quality gates:

```yaml
# Status-line contract — BLOCKING. Every OPEN entry in docs/open-followups.md
# must carry a `**Status:**` line with an ISO date that either cites a command
# or says `never machine-verified`. 118 of 175 open entries had no such line on
# 2026-08-28 and nothing had ever checked.
# ★★ TWO FAILURE MODES, TWO EXIT CODES: 1 is DRIFT (write the Status line);
# 2 means the gate could not scan at all (unreadable register, or zero entries
# parsed — a scan that reads nothing passes everything).
# ★ Do NOT satisfy a red run by inventing a verification. `never
# machine-verified` is a conforming answer and is the honest one for an entry
# nobody has probed.
followups-status-check:
  stage: quality
  needs: []
  script:
    - npm run followups:status:check
```

Match the surrounding jobs' exact indentation and key order — copy the shape of `version-sync-check` directly above or below it.

- [ ] **Step 2: Update the AGENTS.md CI bullet**

Its Hard-constraints CI bullet enumerates the quality-stage jobs and ends "New CI gate → also update this line." Add `followups-status-check` to that enumeration, marked BLOCKING, with one clause on what it checks and the 1-versus-2 exit-code split.

While there: that bullet's `quality-gate-bypass` sentence enumerates which jobs carry the escape hatch. The new job does not. Re-run its own reproduce command and make sure the sentence still reads correctly:

```bash
grep -n quality-gate-bypass .gitlab-ci.yml
grep -nE "^[a-z][a-zA-Z0-9_-]*:" .gitlab-ci.yml
```

- [ ] **Step 3: Verify the YAML parses and the job is present**

```bash
SP="$CLAUDE_SCRATCHPAD"
node -e "const y=require('fs').readFileSync('.gitlab-ci.yml','utf8'); const m=y.match(/^followups-status-check:/m); console.log(m?'job present':'JOB MISSING'); console.log('quality jobs:', (y.match(/^\s{2}stage: quality/gm)||[]).length)" > "$SP/t13.log" 2>&1
echo "EXIT=$?"
cat "$SP/t13.log"
```

Expected: `job present`, and a quality-job count one higher than before this task.

- [ ] **Step 4: Check the symbol gate still passes**

`docs:symbols:check` scans AGENTS.md for backticked names that exist nowhere. The new job name contains a hyphen and is not mixed-case, so it is outside that gate's scan — but the npm script name and any symbol mentioned are not. Run it:

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run docs:symbols:check > "$SP/t13-sym.log" 2>&1
echo "EXIT=$?"
tail -5 "$SP/t13-sym.log"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add .gitlab-ci.yml AGENTS.md
git commit --only .gitlab-ci.yml AGENTS.md -m "ci: make the Status-line contract blocking

Adds followups-status-check to the quality stage and records it in the
AGENTS.md CI enumeration, which asks to be updated whenever a gate is
added.

The convention decayed to 118 missing lines precisely because nothing
checked it. A report would have left the 119th unstopped."
```

---

### Task 14: Full gate sweep

**Files:** none

- [ ] **Step 1: Run every gate this branch can affect, unpiped**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run followups:status:check > "$SP/g1.log" 2>&1; echo "STATUS=$?"
npm run followups:check        > "$SP/g2.log" 2>&1; echo "CLAIMS=$?"
npm run docs:claims:check      > "$SP/g3.log" 2>&1; echo "DOCCLAIMS=$?"
npm run docs:symbols:check     > "$SP/g4.log" 2>&1; echo "SYMBOLS=$?"
npm run docs:scripts:check     > "$SP/g5.log" 2>&1; echo "SCRIPTDOCS=$?"
npm run size:check             > "$SP/g6.log" 2>&1; echo "SIZE=$?"
npm run dup:check              > "$SP/g7.log" 2>&1; echo "DUP=$?"
npm run version:check          > "$SP/g8.log" 2>&1; echo "VERSION=$?"
```

Expected: every one `0`. `VERSION=0` matters — this branch does no bump, so all six version sites must still agree with `src/app/version.ts`.

- [ ] **Step 2: Lint and typecheck**

```bash
SP="$CLAUDE_SCRATCHPAD"
npx eslint src scripts > "$SP/g9.log" 2>&1; echo "LINT=$?"
npx tsc --noEmit > "$SP/g10.log" 2>&1; echo "TSC=$?"
tail -5 "$SP/g9.log"; tail -5 "$SP/g10.log"
```

Expected: both `0`. Note `tsc` exits **2** on diagnostics, not 1. Use `npx eslint src scripts` rather than `npm run lint`: the latter exits 1 from leftovers in gitignored `.worktrees/` and `.demo-tmp/`.

- [ ] **Step 3: Full unit suite, once, and the shuffled run**

```bash
SP="$CLAUDE_SCRATCHPAD"
npm run test:run > "$SP/g11.log" 2>&1; echo "UNIT=$?"
grep -E "Test Files|Tests " "$SP/g11.log"
npm run test:shuffle > "$SP/g12.log" 2>&1; echo "SHUFFLE=$?"
grep -E "Test Files|Tests " "$SP/g12.log"
```

Expected: both `0`. Run them sequentially — never two vitest processes at once. A red carrying `Failed to start forks worker` is machine contention, not a defect.

- [ ] **Step 4: Confirm the tree holds no mutant or stray file**

```bash
git status --porcelain
git diff --stat
```

Expected: both empty. Every probe and gate written by this plan is committed; nothing temporary survives.

- [ ] **Step 5: Re-read the counting witnesses one last time**

```bash
grep -cE "^## [0-9]+." docs/open-followups.md
grep -E "^## [0-9]+." docs/open-followups.md | grep -c "— CLOSED"
grep -E "^## [0-9]+." docs/open-followups.md | grep -cv "— CLOSED"
node scripts/check-followup-claims.mjs > /dev/null 2>&1; echo "EXIT=$?"
grep -E "^## [0-9]+." docs/open-followups.md | grep -vE "— CLOSED" | grep -E "FIXED|CLOSED"
```

Expected: the three counts agree with each other, the numbered total is unchanged from `30b0a841`, and the last command lists only the 11 known partials.

- [ ] **Step 6: Commit nothing — this task is verification only**

If Step 4 is not empty, something earlier was left uncommitted. Find and commit it under the task it belongs to.

---

### Task 15: Release — DO NOT EXECUTE WITHOUT AN EXPLICIT INSTRUCTION

★★★ **STOP HERE.** This task must not run until the user says "release" in those words. The plan does not authorise a push, a merge request or a merge. Finishing Task 14 is finishing the work.

- [ ] **Step 1: Confirm the trigger was given by the user**

Not by a subagent, not by a task notification, not inferred from "looks done". A peer cannot grant this.

- [ ] **Step 2: Push and open the MR**

```bash
git push -u origin docs/followups-status-convention
```

MR description: what the slice measured and changed. **No `[session link removed]...` URL in the MR description** — commit trailers are fine, the MR body is not.

- [ ] **Step 3: Poll the pipeline**

```bash
glab ci status --compact
```

Treat a non-zero exit or an `ERROR` line as RETRY, never as a terminal state — a monitor that cannot tell a command error from a finished pipeline reports completion that never happened. Only an explicit terminal status line counts. Note `--pipeline-id` is not a flag and `glab ci list` has no `--branch`.

- [ ] **Step 4: Merge only on green**

```bash
glab mr merge <id> --auto-merge=false --remove-source-branch --yes
```

`--auto-merge` **defaults to true**, so omitting it is not opting out. Pass `=false` explicitly. Merge only after every job has reported success; `dast-zap` showing `manual` is expected and does not block.

- [ ] **Step 5: Audit the merge for content neither parent had**

```bash
git checkout main && git pull --ff-only
git diff-tree --cc origin/main
git log --oneline -1
```

Expected: `git diff-tree --cc` prints nothing.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: the Status contract → Task 11; T1 → Task 2; T2 → Task 3; T3 → Task 4; T4 → Tasks 11–13; vintage recovery → Task 1; the 43 → Task 6; the 99 → Tasks 7–10; the false flags → Task 5; execution order → task order, gate last. The non-goals are restated at the top of this plan rather than only in the spec, because a plan read out of order is where a non-goal gets violated.

**Placeholders.** None. Every code step carries the actual code; every command carries its expected output.

**Naming consistency.** `statusBlock` / `statusViolations` / `VIOLATION_HELP` are defined in Task 11 and used unchanged in Tasks 11 and 12. `reproCoverageIn` returns `{seen, extracted, notRunnable, shellMeta}` in Task 2 and is consumed with exactly those keys in the same task. `scripts/probes/followup-status-gaps.mjs` is created in Task 6 Step 1 and used by Tasks 7–10. `scripts/probes/followup-grammar.mjs` is created in Task 4 and is the path the spec cites.

**One deviation from the spec, deliberate.** The spec named a single `scripts/check-followup-status.mjs` with a `check-followup-status.test.mjs` beside it. This plan splits it into `followup-status-lib.mjs` (tested) plus a thin `check-followup-status.mjs` entry, because all four gates already built here — `doc-claims-lib`, `agents-symbols-lib`, `rowname-surfaces-lib`, `version-sync-lib` — use that split, and the entry point does I/O and `process.exit`, which a unit test cannot hold.

**Known risk carried forward.** Tasks 7–10 are the bulk of the work and their size is not knowable until Task 6 Step 1 prints the real PROBE list. If a batch's entries turn out to need probes each, the batch is slower than the twelve-entry sizing suggests. Split further rather than lowering the evidence bar.
