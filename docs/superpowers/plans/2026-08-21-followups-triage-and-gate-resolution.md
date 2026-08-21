# Follow-up triage, resolver widening, and two ownership decisions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four classes of false positive from `followups:check` without touching the blocking `doc-claims-check` gate, triage the thirteen `SYMBOL_MISSING` entries, measure the `@types/node` bump before committing to it, and record the heroicons → `lucide-react` migration as scheduled with the default for new code flipped.

**Architecture:** One new exported walk in `doc-claims-lib.mjs` (`collectResolutionSources`) that answers "does this path exist" — deliberately wider than `collectSources()`, which answers "is this a citable code file". One new verdict kind (`SYMBOL_SELF_EXCLUDED`) in `followup-claims-lib.mjs`, fed by a set difference computed in `check-followup-claims.mjs`. Everything else is prose in three tracked registers.

**Tech Stack:** Node 24 ESM (`.mjs`), Vitest, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-21-followups-triage-and-gate-resolution-design.md`

---

## Read this before Task 1

Facts verified in this worktree at `98ee220a`. Do not re-derive them; do not assume the opposite.

- **`SKIP_DIRS` has two consumers.** `scripts/doc-claims-lib.mjs` line 112 defines it; `check-doc-claims.mjs` (CI job `doc-claims-check`, `.gitlab-ci.yml:265`) needs it, `check-followup-claims.mjs` must bypass it. **Never delete or empty the constant.**
- **`followups:check` gates nothing.** It exits 0 with findings, by design, and runs in no CI job. Do not promote it to blocking in this slice.
- **`scripts/followup-claims-lib.mjs` is `SWEEP_SELF_FILES`-excluded** — symbols defined there do **not** enter `knownSymbols`. Put new *walking* code in `doc-claims-lib.mjs` instead, which is not excluded and already owns the walks.
- **`followup-claims-lib.mjs` is documented pure** — "no `process.exit`, no `console`, no IO beyond what the caller injects". Keep it that way: new IO belongs in the script or in `doc-claims-lib.mjs`.
- **`resolveCandidates(citedPath, sources)`** is shared by path checks *and* citation checks via `env.resolve`. Widening the index widens both. It is safe here only because `CITE_RE` is built from `SOURCE_EXT`, which contains no `md` — so no citation can newly resolve against the files Task 2 adds.
- **`npx tsc --noEmit` after any test edit.** `next build` does not typecheck tests and vitest never typechecks.
- **Lint runs `--max-warnings=0`.** An unused import is a fatal error.
- Register line numbers move as soon as you edit the file. **Re-grep before every prose edit** — never trust a line number quoted in an earlier task.

### Do this BEFORE Task 1 — it cannot be reconstructed later

Task 11 Step 2 diffs the blocking gate's output against its pre-slice state. Capture it now:

```bash
npm run docs:claims:check > /tmp/claims-before.txt 2>&1; echo "EXIT=$?"
node scripts/check-followup-claims.mjs > /tmp/followups-before.txt 2>&1
```

Expected: `EXIT=0`. ★★ Without `/tmp/claims-before.txt` the single highest-risk regression in this
slice has no check — `docs:claims:check` exits 0 whether or not the widening leaked into it.

### The baseline this plan is measured against

```bash
node scripts/check-followup-claims.mjs | tail -4
```

At `98ee220a`:

```
CLEAN=113  NO_MACHINE_CLAIM=1  SYMBOL_MISSING=13  PATH_THIRD_PARTY=1  PATH_MISSING=3
```

131 open entries, exit 0.

### The falsifiable prediction

After Tasks 1–5, and **before** any triage prose in Tasks 6–8, the tally must read exactly:

```
CLEAN=116  NO_MACHINE_CLAIM=1  SYMBOL_MISSING=12  PATH_THIRD_PARTY=1  SYMBOL_SELF_EXCLUDED=1
```

Still 131 entries. Derivation, so a mismatch is diagnosable rather than mysterious:

| Entry | Was | Becomes | Because |
|---|---|---|---|
| §131 | `PATH_MISSING` | `CLEAN` | Task 4 fences `foo.tsx` |
| §145 | `PATH_MISSING` | `CLEAN` | Task 1+2 index `docs/superpowers/**` |
| §200 | `PATH_MISSING` | `CLEAN` | Task 2 indexes `golden-workspace.md`; Task 4 rewrites `.generated.ts` |
| §138 | `SYMBOL_MISSING` | `SYMBOL_SELF_EXCLUDED` | Task 3 |

★★ If the tally differs from this table, **stop and diff the entry list** before changing any code. A number that moved for an unpredicted reason is the finding.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/doc-claims-lib.mjs` | modify | add `collectDocs(skipDirs)` parameter and `collectResolutionSources()`. Owns every filesystem walk both gates share. |
| `scripts/doc-claims-lib.test.mjs` | modify | pin the default-argument behaviour so Change A cannot leak into the blocking gate |
| `scripts/check-followup-claims.mjs` | modify | build the resolution index and the self-excluded symbol set; inject both via `env` |
| `scripts/followup-claims-lib.mjs` | modify | classify `SYMBOL_SELF_EXCLUDED`; keep it out of the actionable tier |
| `scripts/followup-claims-lib.test.mjs` | modify | pin the new verdict and its two mutants |
| `docs/open-followups.md` | modify | §131 fence, §200 rewrite, §138 + §44 corrections, eleven triage verdicts, §145 closure |
| `docs/tech-debt-register.md` | modify | TD-8 ownership; `@types/node` outcome |
| `docs/CODEMAPS/dependencies.md` | modify | flip the documented icon default |
| `docs/work-inventory.md` | modify | correct the §4 resolver misdiagnosis; add the migration backlog row |
| `docs/baselines/followup-claims.json` | regenerate | snapshot, gates nothing |

---

## Task 1: Parameterise `collectDocs` without changing its default

**Files:**
- Modify: `scripts/doc-claims-lib.mjs`
- Test: `scripts/doc-claims-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/doc-claims-lib.test.mjs`:

```javascript
describe("collectDocs skip list", () => {
  // ★★ THE DEFAULT IS THE BLOCKING GATE'S CONTRACT. `check-doc-claims.mjs` runs
  // as CI job `doc-claims-check`, and its skip exists because planning documents
  // cite the tree as it stood when they were written. A no-argument call that
  // started returning them would fail the pipeline on ~460 historical files.
  it("excludes docs/superpowers when called with no argument", () => {
    expect(collectDocs().some((d) => d.startsWith("docs/superpowers/"))).toBe(false);
  });

  // The widening the follow-up resolver needs — and the ONLY caller allowed to ask.
  it("includes docs/superpowers when passed an empty skip list", () => {
    expect(collectDocs([]).some((d) => d.startsWith("docs/superpowers/"))).toBe(true);
  });

  // ★ Anti-vacuity: proves the second assertion is about the SKIP, not about the
  // walk returning everything. An unrelated skip must still be honoured.
  it("honours an arbitrary skip list", () => {
    expect(collectDocs(["docs/baselines"]).some((d) => d.startsWith("docs/baselines/"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run scripts/doc-claims-lib.test.mjs -t "collectDocs skip list"
```

Expected: the second test FAILS (`expected false to be true`). The first and third pass already — that is correct, and it is why the second is the one that proves the change.

- [ ] **Step 3: Implement**

In `scripts/doc-claims-lib.mjs`, replace the `collectDocs` definition:

```javascript
// Walk with node's fs, NOT `git ls-files` — the slim CI image has no git.
// ★★★ THE PARAMETER EXISTS SO ONE CONSTANT CAN SERVE TWO INCOMPATIBLE QUESTIONS.
// `check-doc-claims.mjs` asks "which docs do I SCAN for claims" and must keep
// skipping `docs/superpowers` — see SKIP_DIRS. `check-followup-claims.mjs` asks
// "does this path EXIST", and for that question the skip is simply wrong: the
// corpus has been tracked since 0.253.0, so reporting a present spec as
// PATH_MISSING is a false finding. Same tree, two questions.
// ★★ The DEFAULT is the blocking gate's contract. Changing it is a pipeline
// change; a test pins it.
export function collectDocs(skipDirs = SKIP_DIRS) {
  const fromDocs = readdirSync("docs", { recursive: true, encoding: "utf8" })
    .map((f) => `docs/${f}`.replace(/\\/g, "/"))
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !skipDirs.some((d) => f.startsWith(`${d}/`)));
  return [...ROOT_DOCS, ...fromDocs].sort();
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run scripts/doc-claims-lib.test.mjs
```

Expected: PASS, all three new tests included.

- [ ] **Step 5: Prove the blocking gate did not move**

```bash
npm run docs:claims:check > /tmp/claims-after-task1.txt 2>&1; echo "EXIT=$?"
diff /tmp/claims-before.txt /tmp/claims-after-task1.txt && echo "IDENTICAL"
```

Expected: `IDENTICAL`, and `EXIT=0`. `/tmp/claims-before.txt` comes from the pre-Task-1 capture at the top of this plan.

★★ **Do not reach for `git stash` to reconstruct the baseline.** The stash stack is shared with the main checkout at `C:\Projects\aipm-cockpit` and with any other session; a bare `stash`/`stash pop` can swallow a stranger's work. If the capture was missed, re-read the pre-slice file from git instead:

```bash
git show 98ee220a:scripts/doc-claims-lib.mjs > /tmp/x.mjs   # inspect, do not overwrite the worktree
```

- [ ] **Step 6: Commit**

```bash
git add scripts/doc-claims-lib.mjs scripts/doc-claims-lib.test.mjs
git commit -m "refactor: let collectDocs take a skip list, defaulting to the blocking gate's"
```

---

## Task 2: A resolution index that answers existence, not citability

**Files:**
- Modify: `scripts/doc-claims-lib.mjs`
- Modify: `scripts/check-followup-claims.mjs`
- Test: `scripts/doc-claims-lib.test.mjs`

**Why `md` and nothing else — under the CODE tree.** `pathsIn` (`followup-claims-lib.mjs`) matches `` `name.(tsx|ts|mjs|json|css|md|yml)` ``. `SOURCE_EXT` is `tsx|ts|mjs|json|js|yaml|yml|css`. The one extension the register can name that `collectSources()` never indexes is **`md`**, and exactly one such file is tracked under the code tree (`src/app/__fixtures__/golden-workspace.md`). An extension-blind code walk would be wider than the defect and would add collision risk to `resolveCandidates`'s dotfile suffix rule for no gain.

★★★ **Scope that sentence to the code tree — under `docs/` the rule is the opposite, and reading it too broadly turns this fix into a regression.** `docs/` is indexed extension-BLIND today, by the `docAssets` loop this task replaces, and the register cites four non-`.md` assets that resolve only through it: `docs/baselines/file-sizes.json` (×3), `followup-claims.json`, `doc-line-cites.json`, `jscpd-2026-07.json`. `collectResolutionSources` must carry that loop across. Re-derive before trusting the list:

```bash
grep -oE '`[A-Za-z0-9_./-]+\.(json|yml|css)`' docs/open-followups.md | sort | uniq -c | sort -rn
```

- [ ] **Step 1: Write the failing test**

Append to `scripts/doc-claims-lib.test.mjs`:

```javascript
describe("collectResolutionSources", () => {
  const idx = collectResolutionSources();

  // Class A — the planning corpus is tracked and must resolve.
  it("resolves a tracked docs/superpowers path", () => {
    expect(resolveCandidates("2026-08-21-followups-triage-and-gate-resolution-design.md", idx))
      .not.toEqual([]);
  });

  // Class B — a markdown fixture living under the CODE tree, which no other index holds.
  it("resolves a markdown fixture under src/", () => {
    expect(resolveCandidates("golden-workspace.md", idx)).toEqual([
      "src/app/__fixtures__/golden-workspace.md",
    ]);
  });

  // ★★★ WIDER, NOT UNCONDITIONAL. These two are the anti-vacuity half: they name
  // the PERMISSIVE implementation of the fix above, which is the failure mode a
  // widening invites. Without them, `resolve: () => ["x"]` passes the suite.
  it("still reports a deleted docs/superpowers path as unresolvable", () => {
    expect(resolveCandidates("2019-01-01-no-such-spec-design.md", idx)).toEqual([]);
  });

  it("still reports a deleted markdown fixture as unresolvable", () => {
    expect(resolveCandidates("no-such-fixture.md", idx)).toEqual([]);
  });

  // ★★★ Class C — the NON-markdown half of `docs/`, which neither `collectDocs`
  // nor the code walk holds. The register cites this file three times. A fix that
  // dropped it would trade three false PATH_MISSING findings for six new ones.
  it("resolves a non-markdown docs asset", () => {
    expect(resolveCandidates("docs/baselines/file-sizes.json", idx)).toEqual([
      "docs/baselines/file-sizes.json",
    ]);
  });

  it("still reports a deleted docs asset as unresolvable", () => {
    expect(resolveCandidates("docs/baselines/no-such-baseline.json", idx)).toEqual([]);
  });

  // ★ The code index is unchanged and still present — this is a UNION, not a swap.
  it("keeps every collectSources entry", () => {
    for (const s of collectSources()) expect(idx).toContain(s);
  });
});
```

Add `collectResolutionSources` to the existing import list at the top of the test file.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run scripts/doc-claims-lib.test.mjs -t "collectResolutionSources"
```

Expected: FAIL with `collectResolutionSources is not a function`.

- [ ] **Step 3: Implement**

In `scripts/doc-claims-lib.mjs`, add after `collectSources()`:

```javascript
/** The index for "does this path exist", as distinct from `collectSources()`'s
 *  "is this a citable code file".
 *
 *  ★★★ TWO QUESTIONS, TWO INDEXES, AND CONFLATING THEM IS THE BUG THIS CLOSES.
 *  A citation always points at code, so `collectSources()` is exactly right for
 *  it. A register entry names DOCS as freely as code — the specs it defers to,
 *  the baselines the sibling gates read, a markdown fixture under `src/`. Handed
 *  a code-only index, every one of those reported PATH_MISSING.
 *
 *  ★★ WIDER, NOT UNCONDITIONAL. Every member is a file that EXISTS, so a path
 *  the register names and the tree no longer holds still reports PATH_MISSING —
 *  that is the whole finding, and four tests pin it.
 *
 *  ★★ `md` IS THE ENTIRE WIDENING over the code tree, and that is a derivation
 *  rather than a guess: `pathsIn` accepts `tsx|ts|mjs|json|css|md|yml`, and every
 *  one of those except `md` is already in `SOURCE_EXT`. Widening further would
 *  add suffix-collision risk to `resolveCandidates` for no reachable case. If
 *  `pathsIn`'s alternation ever grows, revisit this comment, not just the code. */
export function collectResolutionSources() {
  const codeTreeDocs = [];
  for (const dir of ["src", "scripts", "e2e"]) {
    let entries;
    try {
      entries = readdirSync(dir, { recursive: true, encoding: "utf8" });
    } catch {
      continue; // absent in a partial checkout — same posture as collectSources
    }
    for (const f of entries) {
      const p = `${dir}/${f}`.replace(/\\/g, "/");
      if (p.endsWith(".md")) codeTreeDocs.push(p);
    }
  }
  // ★★★ THE NON-MARKDOWN HALF OF `docs/` IS LOAD-BEARING AND IS NOT `collectDocs`'s.
  // The register cites `docs/baselines/file-sizes.json` three times, plus
  // `followup-claims.json`, `doc-line-cites.json` and `jscpd-2026-07.json`. None
  // is under the code tree and none ends in `.md`, so dropping this loop would
  // turn six resolving citations into fresh PATH_MISSING findings — the exact
  // false-positive class this function exists to remove, reintroduced by the fix.
  // ★★ UNGUARDED, on purpose, and the reasoning came with the code: a truncated
  // index is indistinguishable from a deleted file, so every missing asset would
  // report PATH_MISSING — a screen of false findings under a tool that exits 0.
  // An unreadable `docs/` must throw. (`readFileSync(REGISTER)` in the caller
  // reads inside `docs/` and throws first anyway.)
  const docAssets = [];
  for (const f of readdirSync("docs", { recursive: true, encoding: "utf8" })) {
    const p = `docs/${f}`.replace(/\\/g, "/");
    if (p.endsWith(".md")) continue; // `collectDocs([])`'s half, just above
    if (existsSync(p) && statSync(p).isFile()) docAssets.push(p);
  }
  return [
    ...new Set([
      ...collectSources(),
      // ★ `[]` — the follow-up resolver is the one caller entitled to see the
      // planning corpus. See `collectDocs`.
      ...collectDocs([]).filter((d) => (ROOT_DOCS.includes(d) ? existsSync(d) : true)),
      ...codeTreeDocs,
      ...docAssets,
    ]),
  ];
}
```

Add `existsSync` and `statSync` to the `node:fs` import at the top of `doc-claims-lib.mjs` — it currently imports `readdirSync` alone.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run scripts/doc-claims-lib.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Point the script at it**

In `scripts/check-followup-claims.mjs`, delete the whole hand-rolled block that begins at the comment `★★★ THE RESOLVER IS WIDER THAN` and ends with the closing `];` of the `const sources = [...]` literal — including the `docEntries` / `docAssets` loop — and replace it with:

```javascript
// ★★★ THE RESOLVER IS WIDER THAN `check-doc-claims.mjs`'s, AND IT HAS TO BE.
// The reasoning, the "wider, not unconditional" guarantee and the derivation of
// which extensions belong now live with the walk itself, in
// `collectResolutionSources`. Four tests there pin both directions.
const sources = collectResolutionSources();
```

Then fix the import block: `collectResolutionSources` in, and `ROOT_DOCS`, `SKIP_DIRS`, `collectDocs`, `collectSources` out if nothing else in the file uses them. `readdirSync` and `statSync` likely become unused too.

★★ Lint runs `--max-warnings=0` — a leftover import is a **fatal error**, not a warning. Check with:

```bash
grep -n "ROOT_DOCS\|SKIP_DIRS\|collectDocs\|collectSources\|readdirSync\|statSync\|existsSync" scripts/check-followup-claims.mjs
```

- [ ] **Step 6: Run the gate and check the two predicted entries**

```bash
node scripts/check-followup-claims.mjs | tail -4
```

Expected: `PATH_MISSING` has dropped from 3 to **2**, and `CLEAN` has risen from 113 to **114**.

★★★ **§200 CARRIES TWO FLAGGED PATHS AND ONLY ONE OF THEM IS THIS TASK'S.** The header's derivation table already splits them — "Task 2 indexes `golden-workspace.md`; Task 4 rewrites `.generated.ts`" — so §200 stays `PATH_MISSING` here with its second path, and clears in Task 4. Only §145 leaves at this step. An earlier revision of this line predicted 3→1 by counting §200 as clearing twice; measured 2026-08-21, the real post-Task-2 tally is `CLEAN=114 … PATH_MISSING=2`.

★★ The survivor is **not** an index defect and must not be fixed by widening anything. `pathsIn` matches the bare backticked fragment `` `.generated.ts` `` as if it were a standalone path, and `resolveCandidates`'s dotfile-suffix rule then correctly refuses to bind it to `src/app/operating-guide-builtin.generated.ts` — the character before the suffix is `n`, not `.`, which is the same guard that stops `helpers.ts` matching `other-helpers.ts`. The prose is what is wrong, which is why Task 4 Step 2 rewrites it.

```bash
node scripts/check-followup-claims.mjs | grep -E "^  §145" ; echo "MATCHES=$?"
```

Expected: `MATCHES=1` — §145 is gone.

```bash
node scripts/check-followup-claims.mjs | grep -A 2 "^  §200"
```

Expected: still listed, now with **`.generated.ts` alone** — `golden-workspace.md` has resolved. That reduction is this task's actual effect on §200.

- [ ] **Step 7: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add scripts/doc-claims-lib.mjs scripts/doc-claims-lib.test.mjs scripts/check-followup-claims.mjs
git commit -m "fix: resolve follow-up paths against docs/superpowers and code-tree markdown"
```

---

## Task 3: Report the sweep's own exclusions as their own verdict

**Files:**
- Modify: `scripts/followup-claims-lib.mjs`
- Modify: `scripts/check-followup-claims.mjs`
- Test: `scripts/followup-claims-lib.test.mjs`

**The finding this encodes.** §138's three flagged symbols — `markedNear`, `toArgv`, `collectIdentifiers` — **all exist**, in 5, 3 and 5 files respectively. Every one lives inside a `SWEEP_SELF_FILES` member, which `check-followup-claims.mjs` excludes on purpose so the harness cannot vouch for the names it checks. The symbol is present; only the label is wrong. **Do not weaken the exclusion** — that would make the gate circular.

- [ ] **Step 1: Write the failing test**

Append to `scripts/followup-claims-lib.test.mjs`:

```javascript
describe("SYMBOL_SELF_EXCLUDED", () => {
  const entry = (body) => ({ n: 1, title: "t", startLine: 1, body });
  const env = {
    knownSymbols: new Set(["realSymbol"]),
    selfExcludedSymbols: new Set(["markedNear"]),
    resolve: () => ["src/x.ts"],
    lineCounts: { get: () => 1000 },
  };

  it("labels a symbol that exists only in a swept-self file", () => {
    const r = classify(entry(["A note about `markedNear` here."]), env);
    expect(r.problems.map((p) => p.kind)).toEqual(["SYMBOL_SELF_EXCLUDED"]);
    expect(r.verdict).toBe("SYMBOL_SELF_EXCLUDED");
  });

  // ★★★ ANTI-VACUITY. Without this, `if (!present) continue` passes the test
  // above — the mutant that silences every missing symbol in the register.
  it("still reports a symbol that exists nowhere as SYMBOL_MISSING", () => {
    const r = classify(entry(["A note about `noSuchSymbolAnywhere` here."]), env);
    expect(r.problems.map((p) => p.kind)).toEqual(["SYMBOL_MISSING"]);
  });

  // ★★ A self-excluded symbol must not outrank real debt sitting after it.
  it("does not hide a real SYMBOL_MISSING behind itself", () => {
    const r = classify(entry(["`markedNear` and also `noSuchSymbolAnywhere`."]), env);
    expect(r.verdict).toBe("SYMBOL_MISSING");
  });

  // ★ A symbol that is genuinely in the tree stays CLEAN — the third direction.
  it("leaves a present symbol alone", () => {
    const r = classify(entry(["A note about `realSymbol` here."]), env);
    expect(r.problems).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run scripts/followup-claims-lib.test.mjs -t "SYMBOL_SELF_EXCLUDED"
```

Expected: the first and third tests FAIL (`["SYMBOL_MISSING"]` received). Tests two and four pass already.

- [ ] **Step 3: Implement the classification**

In `scripts/followup-claims-lib.mjs`, inside `classify`, replace the single line `if (!present) problems.push({ kind: "SYMBOL_MISSING", detail: s });` with:

```javascript
    if (!present) {
      // ★★★ THE SYMBOL EXISTS; THE SWEEP CANNOT SEE IT, AND THAT IS DELIBERATE.
      // `SWEEP_SELF_FILES` is excluded from `knownSymbols` so this harness cannot
      // vouch for the names it checks — see that constant's three-star note. The
      // consequence was a permanent SYMBOL_MISSING on §138, which documents this
      // sweep and therefore names its internals: `markedNear`, `toArgv` and
      // `collectIdentifiers` are all in the tree, in 5, 3 and 5 files.
      // ★★ Reported, never dropped. "I was not allowed to look" is a different
      // statement from "it is gone", and collapsing them into CLEAN is exactly
      // the circularity the exclusion exists to prevent.
      const kind = env.selfExcludedSymbols?.has(s) ? "SYMBOL_SELF_EXCLUDED" : "SYMBOL_MISSING";
      problems.push({ kind, detail: s });
    }
```

Then extend the non-actionable tier so a self-exclusion cannot become the verdict when real debt sits beside it. Replace the `THIRD_PARTY_KINDS` line and the `actionable` line with:

```javascript
  const THIRD_PARTY_KINDS = new Set(["CITE_THIRD_PARTY", "PATH_THIRD_PARTY"]);
  // ★★ Not repo debt either, for the same reason and with the same consequence:
  // a finding no probe can resolve must not stand in front of one that can.
  const NON_ACTIONABLE = new Set([...THIRD_PARTY_KINDS, "SYMBOL_SELF_EXCLUDED"]);
  const done = problems.find((p) => p.kind === "ASSERTED_ABSENT_NOW_PRESENT");
  const actionable = problems.find((p) => !NON_ACTIONABLE.has(p.kind));
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run scripts/followup-claims-lib.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Feed the set in from the script**

In `scripts/check-followup-claims.mjs`, immediately after the `if (knownSymbols.size < 1000)` floor check, add:

```javascript
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
```

Then add it to the `env` object literal:

```javascript
const env = {
  knownSymbols,
  selfExcludedSymbols,
  resolve: (p) => resolveCandidates(p, sources),
```

- [ ] **Step 6: Run the gate and check the prediction**

```bash
node scripts/check-followup-claims.mjs | grep -A 4 "§138"
```

Expected: verdict `SYMBOL_SELF_EXCLUDED`, with all three symbols listed under it.

```bash
node scripts/check-followup-claims.mjs | tail -4
```

Expected:

```
CLEAN=114  NO_MACHINE_CLAIM=1  SYMBOL_MISSING=12  PATH_THIRD_PARTY=1  PATH_MISSING=2  SYMBOL_SELF_EXCLUDED=1
```

★ This task moves **one** entry and moves it sideways: §138 leaves `SYMBOL_MISSING` for `SYMBOL_SELF_EXCLUDED`, so `CLEAN` does not change. `PATH_MISSING=2` (§131 and §200's `.generated.ts`) is still outstanding here; Task 4 removes both and is where the header's `CLEAN=116` becomes due. Everything else must match.

- [ ] **Step 7: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add scripts/followup-claims-lib.mjs scripts/followup-claims-lib.test.mjs scripts/check-followup-claims.mjs
git commit -m "fix: distinguish a swept-self symbol from a missing one"
```

---

## Task 4: The two prose fragments

**Files:**
- Modify: `docs/open-followups.md`

★★ Re-grep for both before editing — Tasks 1–3 did not touch this file, but later tasks will, and a line number quoted in a plan is stale by definition.

```bash
grep -n "foo\.tsx" docs/open-followups.md
grep -n 'Editing the `\.generated\.ts`' docs/open-followups.md
```

- [ ] **Step 1: Fence §131's regex example**

§131 discusses the doc-claims path regex, and `foo.tsx` is the **literal subject** of the sentence — it demonstrates that the lookahead stops `` `foo.tsxx` `` from anchoring to `foo.tsx`. Rewriting it destroys the point. `classify()` already runs `stripFencedBlocks()` over an entry body before extracting prose, so a fence removes the flag with **zero characters of the example changed**.

Find the line reading:

```
`` `foo.tsxx` `` anchors to `foo.tsx`, `tsconfig.jsonc` to `tsconfig.json`.
```

Replace it with (note the outer four backticks below are this plan's quoting — write a normal three-backtick fence into the register):

````
dropping the LOOKAHEAD invents phantom paths — fenced below, because these are
regex INPUTS rather than files this repo holds, and the sweep is right to read a
backticked `name.tsx` in prose as a claim:

```text
`foo.tsxx` anchors to `foo.tsx`, `tsconfig.jsonc` to `tsconfig.json`.
```
````

★★ The fenced line is **byte-identical** to the original example, backticks included — a fence renders them literally, and `stripFencedBlocks` removes the line from prose before `pathsIn` ever sees it. Changing a character of the example would defeat the point of fencing rather than rewriting.

★ Splice this into the existing sentence rather than duplicating its opening clause — read the two lines above the target first (`dropping the ORDER changes NO outputs, dropping the LOOKAHEAD invents phantom paths —`) and join them cleanly.

★★ The second `foo.tsx` mention, in the paragraph about the corpus building `ts` + `x`, is **not** backticked as a path and was never flagged. Leave it alone. Verify: `grep -n "foo\.tsx" docs/open-followups.md` after the edit must show it still present.

- [ ] **Step 2: Rewrite §200's shorthand**

Find:

```
   `BUILTIN_GUIDE_CONTENT` in `operating-guide-builtin.generated.ts`. ★★ Editing the `.generated.ts`
```

Replace `` the `.generated.ts` `` with `` the generated file ``. The full name `operating-guide-builtin.generated.ts` appears in the preceding clause, resolves against `src/app/operating-guide-builtin.generated.ts`, and was never flagged — so the sentence loses nothing.

- [ ] **Step 3: Verify both flags are gone and nothing else moved**

```bash
node scripts/check-followup-claims.mjs | tail -4
```

Expected — the header's prediction, in full:

```
CLEAN=116  NO_MACHINE_CLAIM=1  SYMBOL_MISSING=12  PATH_THIRD_PARTY=1  SYMBOL_SELF_EXCLUDED=1
```

```bash
node scripts/check-followup-claims.mjs | grep -cE "^  §"
```

Expected: 14 (12 `SYMBOL_MISSING` + 1 `PATH_THIRD_PARTY` + 1 `SYMBOL_SELF_EXCLUDED`).

★★ **If the tally differs, stop.** Diff the entry list against the baseline rather than adjusting the prediction — a number that moved for an unpredicted reason is the finding, not the noise.

- [ ] **Step 4: Confirm the register still parses at full strength**

```bash
node scripts/check-followup-claims.mjs | head -1
```

Expected: `131 open entries`. A fence that swallowed a heading would show up here as a smaller number.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: stop two prose examples in the register parsing as citations"
```

---

## Task 5: Regenerate the snapshot

**Files:**
- Modify: `docs/baselines/followup-claims.json`

`docs/baselines/followup-claims.json` is tracked and now stale in every verdict Tasks 1–4 moved. It **gates nothing** — no CI job reads it, and the file says so itself — so regenerating admits no debt.

- [ ] **Step 1: Regenerate**

```bash
node scripts/check-followup-claims.mjs --json docs/baselines/followup-claims.json
```

- [ ] **Step 2: Check the diff is only what you expect**

```bash
git diff --stat docs/baselines/followup-claims.json
git diff docs/baselines/followup-claims.json | grep -E '^[-+].*"verdict"' | sort | uniq -c
```

Expected: verdict changes confined to §131, §138, §145 and §200, plus the `generated` date and `commit` fields.

- [ ] **Step 3: Commit**

```bash
git add docs/baselines/followup-claims.json
git commit -m "chore: regenerate the follow-up claims snapshot"
```

---

## Task 6: §138 and §44 — the two entries answered before reading

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Correct §138's un-ignore claim**

§138 states that the spec and plan defining its P2–P4 phases are *"under `docs/superpowers/`, which is gitignored — so they exist on one machine and this entry is the only durable record."* The tree was un-ignored in `0.253.0 "Schroeder"` (2026-08-21) and the whole corpus committed.

Locate it:

```bash
grep -n "which is gitignored" docs/open-followups.md
```

Rewrite that clause to state that the corpus is now tracked, that the originating spec and plan are readable in the repo, and that the entry's self-description as "the only durable record" no longer holds. **Keep the P2–P4 scope open** — only the durability claim was false.

★★ §145 records that entries written while the tree was ignored still describe it that way, and asks the reader to grep for the rest rather than assume this was the only one. Do that now:

```bash
grep -n "gitignore" docs/open-followups.md
```

Fix any other entry making the same dead claim, in the same commit.

- [ ] **Step 2: Annotate §44**

§44's five flagged names — `eventToGraphEvent`, `exceptionPlan`, `afterPush`, `replayExceptions` and `calendar-event-attendees.ts` — are **S6's planned surface**, specified in `docs/superpowers/specs/2026-07-29-s6-calendar-event-push-design.md` and unbuilt. The entry is correctly open and the flags are correct: those names genuinely do not exist.

Add one line to §44 stating that the names are S6's designed-but-unbuilt surface, naming the spec, so the next reader spends no time re-probing them. **Do not close the entry.**

★ Do not use an `ABSENCE_MARKERS` phrasing that would trip `assertedAbsent` and flip the entry to `ASSERTED_ABSENT_NOW_PRESENT` when S6 ships — actually, that inversion is *desirable* here: it would announce that the follow-up is done. Read `assertedAbsentNames` in `followup-claims-lib.mjs` and make the choice deliberately, then record which you chose and why in the entry itself.

- [ ] **Step 2b: Re-run and record the effect**

```bash
node scripts/check-followup-claims.mjs | grep -A 6 "§44"
```

If Step 2's wording moved §44's verdict, that was a decision — confirm it is the one you intended.

- [ ] **Step 3: Commit**

```bash
git add docs/open-followups.md
git commit -m "docs: retire a dead gitignore claim and label section 44's names as S6 surface"
```

---

## Task 7: Probe the eleven

**Files:**
- Modify: `docs/open-followups.md`

Eleven entries, every flagged symbol confirmed absent from `src`/`scripts`/`e2e`:

| Entry | Flagged symbols |
|---|---|
| §36 | `importTemplate`, `exportTemplate` |
| §51 | `asyncWrapper`, `asyncUtilTimeout` |
| §53 | `getScope`, `contextOrFilename` |
| §82 | `migrateWorkspaceV11` |
| §88 | `AiViewScopeDisclosure` + path `settings-sections/ai-view-scope-disclosure.tsx` |
| §90 | `RaidPanelToolbar` |
| §156 | `listDepth` |
| §157 | `listDepth`, `listMarker` |
| §187 | `document_ops` + path `use-document-tools.test.ts` |
| §189 | `globalIgnores` |
| §201 | `buildJiraCacheKey` |

Re-derive the list rather than trusting this table:

```bash
node scripts/check-followup-claims.mjs | grep -B 1 "SYMBOL_MISSING:" | grep "^  §"
```

- [ ] **Step 1: For each of the eleven, in order, do exactly this**

1. Read the entry in full.
2. Decide which of three it is:
   - **never built** — the entry proposes work using a name for something that does not exist yet. Stays **open**. Add one line saying the name is proposed, not lost.
   - **built under another name** — the behaviour shipped; the entry's vocabulary rotted. **Correct** the names, keep the entry open or close it on its merits.
   - **behaviour is gone** — positively observed, not inferred from the missing name. **Close** it.
3. Write the verdict line into the entry **with the command that shows it**.
4. Commit that entry alone.

```bash
git add docs/open-followups.md
git commit -m "docs: triage open-followups section NN — <verdict>"
```

★★★ **An absent symbol is not evidence of closure.** It cannot distinguish "never built" from "built under another name", and the gate's own footer says it rules claims out, never in. A verdict of *closed* requires a **positive observation that the behaviour is gone** — a passing test, a grep for the replacement, a shipped release entry. Never `git grep` a name, find nothing, and strike the heading.

★★ **Record the verdict in whichever convention the entry already uses** — struck-through heading, or a bolded `**Status:**` line. Do not convert an entry between the two while triaging. `work-inventory.md` §4 measures the twelve-entry disagreement that inconsistency already causes; making it worse inside a triage round is how the two measures stop being reconcilable at all.

★ One commit per entry. Eleven small commits beat one large one: a wrong verdict is then a one-commit revert, and the reviewer can read each judgement against its own diff.

- [ ] **Step 2: Confirm the tally moved only where you decided**

```bash
node scripts/check-followup-claims.mjs | tail -4
```

Expected: `SYMBOL_MISSING` fell by exactly the number of entries whose names you **corrected**. Entries you closed leave the open set entirely (`isClosed` filters them), so the entry count drops too. Entries you left open with an added note do not move at all.

★★ Write down the expected tally **before** running this, then compare. A prediction made after the fact is not a check.

---

## Task 8: `@types/node` — measure, then decide

**Files:**
- Modify (conditionally): `package.json`, `package-lock.json`
- Modify: `docs/tech-debt-register.md`

Grounding, re-derive first:

```bash
node -e "const p=require('./package.json');console.log(p.devDependencies['@types/node'], JSON.stringify(p.engines))"
node -e "console.log(require('./node_modules/@types/node/package.json').version)"
grep -n "image: node:" .gitlab-ci.yml
```

At `98ee220a`: declared `^20`, resolved `20.19.43`, `engines.node` `>=24`, CI on `node:24-bookworm-slim`. The tech-debt register's stated precondition — the runtime off node 20 — is met.

- [ ] **Step 1: Capture a clean baseline first**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. **If it is not, stop** — you cannot attribute errors to the bump without a green starting point.

- [ ] **Step 2: Install and measure**

```bash
npm i -D @types/node@^24
npx tsc --noEmit > /tmp/tsc-node24.txt 2>&1; echo "EXIT=$?" > /tmp/tsc-node24-exit.txt
cat /tmp/tsc-node24-exit.txt
grep -c "error TS" /tmp/tsc-node24.txt
grep -oE "error TS[0-9]+" /tmp/tsc-node24.txt | sort | uniq -c | sort -rn
```

★★ Write the exit code to a file **before** any pipe. A backgrounded or piped run reports the trailing command's status, and that has already been mistaken for a passing build in this repo.

- [ ] **Step 3: Report the numbers, then decide**

State the error count and the code-frequency table **before** choosing. Then:

| Outcome | Action |
|---|---|
| `EXIT=0` | land it — go to Step 4 |
| small and mechanical (one or two error codes, an obvious shape) | land it, listing every fix — go to Step 4 |
| anything else | **revert** — go to Step 5 |

- [ ] **Step 4 (land): commit the bump**

```bash
npm run lint && npx tsc --noEmit && npx vitest run scripts/
git add package.json package-lock.json
git commit -m "chore: move @types/node to ^24, matching engines and the CI image"
```

Then update the `@types/node` row in `docs/tech-debt-register.md` to resolved, recording the measured error count (including zero) and the date.

- [ ] **Step 5 (revert): restore and record the cost**

```bash
git checkout -- package.json package-lock.json
npm ci
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`, back to the Step 1 baseline.

Then update the `@types/node` row in `docs/tech-debt-register.md` with: the precondition is met (`engines >=24`, CI on `node:24-bookworm-slim`); the bump costs **N** errors across codes **X, Y**; and the commands above reproduce it. That measurement is the deliverable.

```bash
git add docs/tech-debt-register.md
git commit -m "docs: record the measured cost of the @types/node 24 bump"
```

★ Either way the register stops saying "deferred, precondition unknown". A recorded cost is worth more than an unbounded fix session inside a batch scoped as cheap.

---

## Task 9: TD-8 — schedule the migration and flip the default

**Files:**
- Modify: `docs/tech-debt-register.md`
- Modify: `docs/CODEMAPS/dependencies.md`
- Modify: `docs/open-followups.md`
- Modify: `docs/work-inventory.md`

Re-derive the surface first — every number below rots:

```bash
grep -rln "@heroicons/react" src/app | wc -l                                    # 78
grep -rln "lucide-react" src/app --include="*.tsx" --include="*.ts" | wc -l     # 1
grep -rhzoE 'import \{[^}]*\} from "@heroicons/react[^"]*"' src --include=*.tsx --include=*.ts \
  | tr '\0' '\n' | grep -oE "\b[A-Za-z0-9]+Icon\b" | sort -u | wc -l            # 70
```

★★ The third command counts names inside the **import lists**. A `\b[A-Z][A-Za-z0-9]+Icon\b` sweep over `src` returns **102** and is wrong — it counts local components, lucide aliases and type names. The 32-name gap is the difference between "how big is the migration" and "how many things end in `Icon`".

- [ ] **Step 1: TD-8 becomes owned and scheduled**

Rewrite the TD-8 row in `docs/tech-debt-register.md`:

- Status: **owned, scheduled, not started** — no longer "nobody owns the migration question".
- The decision: run the app-wide `@heroicons/react` → `lucide-react` migration. It is **not** in this slice; 78 files and 70 distinct imported icon names is a slice of its own.
- The measured surface, with the three commands above, and the instruction to re-derive rather than quote.
- ★★ The **deliberate mixed state** this creates: 78 files on the retired package, new code on the target, no gate enforcing either. Record it explicitly so the next reader files it as accepted rather than as a defect.
- ★ `lucide-react` is `^1.31.0` with 1.33.0 available. Irrelevant while the blast radius is one file; it stops being irrelevant when the migration slice opens. Note it. **Do not bump it here.**

- [ ] **Step 2: Flip the documented default**

`docs/CODEMAPS/dependencies.md`, the `lucide-react` row, currently reads *"ONE consumer … Heroicons is still the app-wide icon set — 78 files … do not reach for lucide elsewhere without deciding to switch."*

The switch is now decided. Rewrite the row — and the `@heroicons/react` row beside it — to state:

- `lucide-react` is the **target** and the default for all new code.
- `@heroicons/react` is **being retired**; its 78 files are pending conversion, not correct.
- Pointers to TD-8 for the scheduled work.

★★★ This is the consequence that matters. Every heroicons import added between now and the migration is one more file to convert, so leaving the documented default pointing at the package being retired makes the debt grow **on purpose**.

- [ ] **Step 3: Close §145**

`docs/open-followups.md` §145 currently reads *"Only **(b)**: whether to run the app-wide migration at all. Nothing has been brainstormed, specced, planned or scheduled for it, and there is no roadmap slot."*

(b) is now answered. Close the entry as a **decision**, in the convention §145 already uses, pointing at TD-8 for the scheduled work and at `dependencies.md` for the flipped default.

- [ ] **Step 4: Add the backlog row**

`docs/work-inventory.md` §3 ("Designed but NOT built") gains a fifth row: the heroicons → lucide migration, decision recorded in TD-8, **no spec yet** — that is its own brainstorm.

★ §3's own preamble says "Four items have approved designs and no implementation." Update the count, and note that this fifth row is a *decision* without a design rather than a design without an implementation — the rest of the table is the latter.

- [ ] **Step 5: Verify no dead cross-references**

```bash
grep -rn "migration question is unowned\|nobody owns" docs/
grep -rn "do not reach for lucide" docs/
```

Expected: no hits. Both phrasings are now false wherever they survive.

- [ ] **Step 6: Commit**

```bash
git add docs/tech-debt-register.md docs/CODEMAPS/dependencies.md docs/open-followups.md docs/work-inventory.md
git commit -m "docs: schedule the heroicons to lucide migration and flip the default for new code"
```

---

## Task 10: Correct the inventory's resolver misdiagnosis

**Files:**
- Modify: `docs/work-inventory.md`

`docs/work-inventory.md` §4 says the resolver *"walks `src`/`scripts`/`e2e` ONLY, so every `docs/` path it meets is reported PATH_MISSING whether or not the file exists"*, and §7 item 4 repeats it as *"three of the PATH_MISSING flags are the resolver's `docs/` blind spot"*.

That was already false at `98ee220a` — `check-followup-claims.mjs` built a `docs/**` index. Acting on the inventory's version would have rewritten correct code and left all four real causes standing.

- [ ] **Step 1: Rewrite §4's resolver paragraph**

State what was actually wrong, now that it is fixed: `SKIP_DIRS` excluded the planning corpus from `collectDocs()`, `SOURCE_EXT` carried no `md` so a markdown fixture under `src/` was in no index, and the sweep's own `SWEEP_SELF_FILES` exclusion produced a `SYMBOL_MISSING` no probe could ever resolve. Name this slice as where each was fixed.

- [ ] **Step 2: Rewrite §7 item 4**

Replace the "three PATH_MISSING flags are the blind spot" claim with the current tally, re-derived:

```bash
node scripts/check-followup-claims.mjs | tail -4
```

- [ ] **Step 3: Refresh §4's headline counts**

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
grep -cE "^## [0-9]+\." docs/open-followups.md
```

★★ The `sort -n` form is required — a leading `## ` is unsortable numerically, and a `§` grep finds only cross-references. Two spellings of this measurement have already been wrong in this repo.

★★★ **Do not re-derive §4's hand-classified 118/57/9/7/1 split.** It covered 192 sections, was never redone, and a heading regex disagrees with it by twelve. Reconciling the two measures is a separate job, and doing it inside a round that edits the entries it counts would restale it immediately. Task 7 has already moved some of those entries.

- [ ] **Step 4: Commit**

```bash
git add docs/work-inventory.md
git commit -m "docs: correct the work inventory's account of the follow-up resolver"
```

---

## Task 11: Full verification

- [ ] **Step 1: The gate, diffed against the branch point**

```bash
node scripts/check-followup-claims.mjs | tail -4
git show 98ee220a:docs/baselines/followup-claims.json > /tmp/base.json
node -e "const a=require('/tmp/base.json');console.log(JSON.stringify(a.tally))"
```

Every difference must be one this plan predicted or one Task 7 decided. **Nothing else may have moved.**

- [ ] **Step 2: The blocking gate is byte-identical**

```bash
git stash list --format='%H %gs' | head            # confirm the stack before touching it
npm run docs:claims:check > /tmp/claims-now.txt 2>&1; echo "EXIT=$?"
diff /tmp/claims-before.txt /tmp/claims-now.txt && echo "IDENTICAL"
```

★★★ **This is the highest-risk regression in the slice.** A widening that leaked into the claim-scan corpus would still **exit 0** while scanning the whole planning corpus. Only the output diff shows it. Compare against the output captured before Task 1 — `EXIT=0` alone proves nothing here.

★ If `/tmp/claims-before.txt` was never captured, reconstruct it from the branch point in a scratch clone rather than skipping this step.

- [ ] **Step 3: Tests, types, lint, sizes**

```bash
npx vitest run scripts/ ; echo "EXIT=$?"
npx tsc --noEmit ; echo "EXIT=$?"
npm run lint ; echo "EXIT=$?"
npm run size:check ; echo "EXIT=$?"
```

All four `EXIT=0`.

★★ **Never run two vitest processes at once** — machine saturation is this repo's load-sensitive-flake condition.

- [ ] **Step 4: The mutation check on the new tests**

For each of the three fixes, revert the implementation line and confirm the paired test fails:

| Revert | Must fail |
|---|---|
| `collectDocs(skipDirs = SKIP_DIRS)` → `collectDocs()` | "includes docs/superpowers when passed an empty skip list" |
| `collectResolutionSources` → `return collectSources()` | "resolves a tracked docs/superpowers path" **and** "resolves a markdown fixture under src/" |
| `collectResolutionSources` → `return [...idx, "ANYTHING"]`-style always-resolve | "still reports a deleted docs/superpowers path as unresolvable" |
| `const kind = "SYMBOL_SELF_EXCLUDED"` (unconditional) | "still reports a symbol that exists nowhere as SYMBOL_MISSING" |

★★★ **Revert every mutant before reporting.** A report is a claim about the work, not about the tree. Sweep last:

```bash
git status --porcelain -uall
git diff --stat
```

Expected: clean, with no unstaged mutation surviving.

- [ ] **Step 5: Review the whole branch as one artifact**

```bash
git diff 98ee220a...HEAD --stat
git log --oneline 98ee220a..HEAD
```

Run a cold code review over the full diff — **including the fix commits themselves**, which are the highest-risk class in this repo's history. Do not review only the per-task diffs; the seam between tasks is where per-task review is blind.

- [ ] **Step 6: Stop**

No push, no MR, no merge without an explicit instruction.

---

## Out of scope

- The heroicons → lucide migration itself. Task 9 records the decision only.
- Converting register entries between the two status conventions.
- Re-deriving `work-inventory.md` §4's hand-classified status split.
- `check-doc-claims.mjs` behaviour. Its output is a verification input here, never a target.
- Promoting `followups:check` to a blocking gate.
