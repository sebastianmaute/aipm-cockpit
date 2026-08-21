# Open-followups Consolidation — Implementation Plan (P0–P1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested harness that mechanically checks every claim in `docs/open-followups.md` that a machine can check, and run it over all 92 open entries to produce the triage table the rest of the consolidation depends on.

**Architecture:** Two pure parsing libraries plus two thin CLIs, mirroring the existing `doc-claims-lib.mjs` / `check-doc-claims.mjs` split. The new harness reuses the hardened fence parser and citation resolver from `doc-claims-lib.mjs`, and the symbol predicate from `check-agents-symbols.mjs` — which must first be extracted into a library, because it currently exports nothing.

**Tech Stack:** Node ESM (`.mjs`), vitest 4.1.8, no new dependencies.

---

## Scope — why this plan stops at P1

The spec (`docs/superpowers/specs/2026-08-10-open-followups-consolidation-design.md`) defines five phases. This plan covers **P0 (harness) and P1 (machine sweep)** only.

P2–P4 get a second plan, written once P1's table exists. This is not a deferral for its own sake — a plan for "apply 92 verdicts" written *before* the verdicts are known could only contain placeholders ("handle each finding appropriately"), which is a plan failure. P1's output is the input that makes P2–P4 writable as concrete tasks.

P0 also contains a deliberate **go/no-go gate** (Task 9). If the harness turns out to judge too little, the correct outcome is to stop and fall back to a sequential pass — and that decision must be made on measured verdict spread, not on sunk cost.

---

## Baseline

Branch off `origin/main` @ `fba42c18` (0.229.0 "Marillier"). The previous branch `feat/dependency-successor-linking` is already merged with zero local-only commits.

Figures this plan assumes, all measured at `fba42c18`:

| | |
|---|---|
| `docs/open-followups.md` | 8428 lines, 129 numbered entries |
| marked CLOSED | 37 |
| **not closed** | **92** |
| highest entry / next free | §137 / §138 |
| numbering holes | 17, 18, 19, 20, 23, 25, 26, 27 |
| `§NN` citations in `src`/`scripts`/`e2e` | 289 → 197 CLOSED, 88 open, 4 dangling `§17` |

Re-run before starting; if they differ, `origin/main` moved again and the spec's Risk 5 has fired.

```bash
git fetch origin --prune
git show origin/main:docs/open-followups.md | grep -cE '^## [0-9]+\. '
```

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `scripts/agents-symbols-lib.mjs` | The symbol gate's pure layer: identifier predicate, absence markers, allowlist, identifier collection, the self-exclusion set. | **create** |
| `scripts/agents-symbols-lib.test.mjs` | Unit tests for the above. The symbol gate has never had one. | **create** |
| `scripts/check-agents-symbols.mjs` | Unchanged behaviour; becomes a thin CLI over the new lib. | modify |
| `scripts/followup-claims-lib.mjs` | Register parsing + claim extraction + verdict classification. Pure: no `process.exit`, no `console`. | **create** |
| `scripts/followup-claims-lib.test.mjs` | Unit tests for the above. | **create** |
| `scripts/check-followup-claims.mjs` | CLI: walk the register, classify, print the table, write the snapshot, optionally run reproduce commands. | **create** |
| `package.json` | `followups:check` script + its `scriptsDescriptions` entry. | modify |
| `docs/baselines/followup-claims.json` | Snapshot of the sweep. **Not** a ratchet — see Task 8. | **create** |

Two libraries rather than one: the symbol layer is a *refactor of an existing blocking gate* and must be behaviour-preserving; the followups layer is new code. Mixing them in one file would make a regression in the first indistinguishable from a bug in the second.

---

## Task 1: Capture the symbol gate's current output as a refactor anchor

`check-agents-symbols.mjs` is a blocking CI gate with **no test**. Before refactoring it, capture what it prints today so the refactor can be proved behaviour-preserving.

**Files:**
- Create: `<scratch>/symbols-before.txt` (scratch dir, not the repo)

- [ ] **Step 1: Create the branch**

```bash
git fetch origin --prune
git switch -c feat/open-followups-harness origin/main
git log --oneline -1
```

Expected: `fba42c18 Merge branch 'feat/html-start-derive-per-sink' into 'main'`

- [ ] **Step 2: Capture the gate's output, unpiped**

Never read a gate's status through a pipe — you get the pipe's status. Redirect, then check.

```bash
node scripts/check-agents-symbols.mjs > /tmp/symbols-before.txt 2>&1; echo "EXIT=$?"
cat /tmp/symbols-before.txt
```

Expected, measured on a clean tree at `fba42c18` on 2026-08-10:

```
10 doc(s): 1135 named symbols all resolve (against 37095 identifiers in src/scripts/e2e)
EXIT=0
```

Both numbers are the anchor for Task 3 Step 4. If they differ, `origin/main` moved — stop and re-baseline rather than proceeding against a stale anchor.

★★ The identifier count in an earlier draft of this plan was **37040**, and it was wrong: it was measured while the checkout still sat at `e9211280`, 24 commits behind `origin/main`. The symbol count (`1135`) was identical on both trees, which is exactly why the drift went unnoticed — one of the two anchor numbers is invariant across the gap and the other is not. Re-capture the anchor on the branch you are about to refactor on; never carry one across a checkout.

- [ ] **Step 3: Confirm the sentinel is absent from scanned code**

`compareX` is in the gate's `ALLOWLIST` precisely because it exists nowhere in the codebase. It is the sentinel that proves the self-exclusion still works after extraction.

```bash
grep -rn --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js' --include='*.json' 'compareX' src scripts e2e; echo "EXIT=$?"
```

Expected: exactly one hit — `scripts/check-agents-symbols.mjs:123`, the `ALLOWLIST` entry itself. `EXIT=0`.

Measured at `fba42c18`, **six** names have this property and all six live only in that one file: `compareX`, `migrateTaskStatus`, `pendingFlash`, `onTakeTour`, `onToggleComplete`, `requestFlash`. That is the size of what the self-exclusion protects — the gate's comments and allowlist are a small museum of exactly the stale claims it exists to catch, and scanning them would resurrect all six as "real code" at once.

If `compareX` appears anywhere else, pick another from that list and use it throughout Tasks 2–3 instead.

No commit — this task produces only a scratch file.

---

## Task 2: Failing tests for the extracted symbol library

**Files:**
- Create: `scripts/agents-symbols-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// Unit tests for the symbol gate's pure layer.
//
// ★★★ THE SELF-EXCLUSION TEST IS THE LOAD-BEARING ONE. The gate's own comments
// and allowlist NAME the symbols it exists to catch, so a gate file that is
// scanned makes those names "exist" and the gate silently stops finding the
// class it was built for. That hazard predates this split — `check-agents-
// symbols.mjs` already excluded itself — but the split MULTIPLIES it: the
// allowlist now lives in a second file, and excluding only the original leaves
// `compareX` resolving as real code. Per the gate's own comment, a dead
// allowlist entry is worse than no entry: it masks a future stale claim
// instead of reporting it.
import { describe, expect, it } from "vitest";
import {
  ABSENCE_MARKERS,
  ALLOWLIST,
  GATE_SELF_FILES,
  PROXIMITY,
  collectIdentifiers,
  isGatedSymbolName,
  markedNear,
} from "./agents-symbols-lib.mjs";

describe("isGatedSymbolName", () => {
  it("accepts a mixed-case identifier longer than three characters", () => {
    expect(isGatedSymbolName("sanitizeText")).toBe(true);
    expect(isGatedSymbolName("Task")).toBe(true);
  });

  it("rejects all-lowercase and too-short names", () => {
    expect(isGatedSymbolName("config")).toBe(false);
    expect(isGatedSymbolName("cfg")).toBe(false);
  });

  it("regression: SCREAMING_CASE is out of scope — the gate's known blind spot", () => {
    // Not a bug to fix here. AGENTS.md documents this gap at three stars; the
    // followups gate inherits the SAME predicate so the two agree, and widening
    // it is a separate decision with its own false-positive budget.
    expect(isGatedSymbolName("HELP_ENTRIES")).toBe(false);
    expect(isGatedSymbolName("TABLE_NAMES")).toBe(false);
  });

  it("rejects member expressions and CSS tokens", () => {
    expect(isGatedSymbolName("window.setTimeout")).toBe(false);
    expect(isGatedSymbolName("--ui-pink")).toBe(false);
  });
});

describe("markedNear", () => {
  const doc = "the old `pendingFlash` channel\n  was REMOVED in 0.190";

  it("suppresses a mention whose absence marker wraps onto the next line", () => {
    expect(markedNear(doc, doc.indexOf("pendingFlash"))).toBe(true);
  });

  it("does not suppress when the marker is beyond the proximity window", () => {
    const far = `\`pendingFlash\`${" ".repeat(PROXIMITY + 50)}REMOVED`;
    expect(markedNear(far, far.indexOf("pendingFlash"))).toBe(false);
  });

  it("regression: whitespace is collapsed before matching", () => {
    // "the dead " is a marker with a trailing space; a wrap puts a NEWLINE
    // there and the suppression silently failed, reporting a correct doc.
    const wrapped = "REPLACING the dead\n  `onTakeTour` entry point";
    expect(markedNear(wrapped, wrapped.indexOf("onTakeTour"))).toBe(true);
  });
});

describe("GATE_SELF_FILES", () => {
  it("names both gate files, not just the CLI", () => {
    expect(GATE_SELF_FILES.some((f) => f.endsWith("check-agents-symbols.mjs"))).toBe(true);
    expect(GATE_SELF_FILES.some((f) => f.endsWith("agents-symbols-lib.mjs"))).toBe(true);
  });

  it("★★★ the allowlist sentinel does NOT resolve as real code", () => {
    // `compareX` appears ONLY in ALLOWLIST. If the lib holding that allowlist
    // is scanned, this set contains it, the allowlist entry goes dead, and the
    // gate stops reporting the stale-claim class the entry was masking.
    const known = new Set();
    collectIdentifiers("scripts", known);
    expect(known.has("compareX")).toBe(false);
  });

  it("still collects ordinary identifiers from scripts/", () => {
    // A scan that excludes too much passes everything. Prove it scanned.
    const known = new Set();
    collectIdentifiers("scripts", known);
    expect(known.size).toBeGreaterThan(500);
    expect(known.has("stripFencedBlocks")).toBe(true);
  });
});

describe("ABSENCE_MARKERS / ALLOWLIST", () => {
  it("every allowlist entry carries a reason", () => {
    for (const [name, reason] of ALLOWLIST) {
      expect(typeof reason, `${name} has no reason`).toBe("string");
      expect(reason.length, `${name}'s reason is empty`).toBeGreaterThan(10);
    }
  });

  it("exposes the markers the CLI prints in its failure message", () => {
    expect(ABSENCE_MARKERS).toContain("never existed");
    expect(ABSENCE_MARKERS).toContain("NOT built");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run scripts/agents-symbols-lib.test.mjs --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: `EXIT=1`, failing to resolve `./agents-symbols-lib.mjs`.

`--reporter=basic` does not exist in vitest 4.1.8 and errors at startup in a way that reads like a broken test run. Use `--reporter=dot`.

- [ ] **Step 3: Commit the failing test**

```bash
git add scripts/agents-symbols-lib.test.mjs
git commit -m "test: pin the symbol gate's pure layer before extracting it"
```

---

## Task 3: Extract the library, behaviour-preserving

**Files:**
- Create: `scripts/agents-symbols-lib.mjs`
- Modify: `scripts/check-agents-symbols.mjs`

- [ ] **Step 1: Create the library**

Move `IDENTIFIER`, `ABSENCE_MARKERS`, `ALLOWLIST`, `CODE_EXT`, `SKIP_DIRS`, `PROXIMITY` and `collectIdentifiers` out of the CLI verbatim — **including their comments**, which carry the measurements behind each rule. Then add the two new exports.

```js
// The symbol gate's pure layer, split out so `check-followup-claims.mjs` can
// apply the SAME predicate rather than growing a second, drifting copy.
// The CLI (`check-agents-symbols.mjs`) keeps all IO and exit handling.
import fs from "node:fs";
import path from "node:path";

export const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json)$/;
export const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** …move the existing IDENTIFIER doc comment here verbatim… */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The gate's predicate, as one function so two gates cannot drift.
 *  Mixed case only — every SCREAMING_CASE constant is out of scope. */
export function isGatedSymbolName(name) {
  if (!IDENTIFIER.test(name)) return false;
  if (name.length <= 3) return false;
  return /[a-z]/.test(name) && /[A-Z_]/.test(name);
}

/** …move the existing ABSENCE_MARKERS doc comment here verbatim… */
export const ABSENCE_MARKERS = [
  "REMOVED", "RETIRED", "DELETED", "GONE", "is gone", "are gone", "no such",
  "does not exist", "never existed", "NOT built", "not built", "Do NOT",
  "do NOT", "the dead ", "takes no ", "was renamed", "were renamed", "RENAMED",
  "(was ", "deprecated", "vestigial",
];

/** …move the existing ALLOWLIST doc comment here verbatim… */
export const ALLOWLIST = new Map([
  ["compareX", "placeholder for a panel's own comparator, not a real function"],
  ["resolveJsonModule", "a tsconfig compiler option, not repo code"],
  ["UnsupportedApiVersion", "an upstream TimeLog API error string"],
]);

/** …move the existing PROXIMITY comment here verbatim… */
export const PROXIMITY = 240;

/** True when an absence marker sits within PROXIMITY chars of `index` in `doc`.
 *  Whitespace is collapsed first: these bullets wrap mid-phrase, so a marker
 *  like "the dead " meets a NEWLINE where it expects a space. */
export function markedNear(doc, index) {
  const from = Math.max(0, index - PROXIMITY);
  const window = doc.slice(from, index + PROXIMITY).replace(/\s+/g, " ");
  return ABSENCE_MARKERS.some((w) => window.includes(w));
}

/** ★★★ EVERY FILE THAT NAMES A SYMBOL IN ORDER TO GATE IT MUST BE LISTED HERE.
 *  These files quote the exact names the gate exists to catch — in comments, in
 *  ALLOWLIST and in test fixtures — so scanning them makes those names "exist"
 *  and the gate silently stops finding its own class. The CLI already excluded
 *  itself; this split adds two more files with the same property.
 *
 *  ★★★ THE TEST FILE IS NOT AN OVER-CAUTIOUS ADDITION — IT WAS MEASURED. Landing
 *  `agents-symbols-lib.test.mjs` alone, with no other change, moved the gate from
 *  `1135 named symbols … against 37095 identifiers` to `1138 … 37111` while still
 *  exiting 0. Three of the six names that live nowhere but this gate — `compareX`
 *  (its ALLOWLIST entry), `pendingFlash` and `onTakeTour` (both suppressed by
 *  absence markers in the docs) — became "real code" because the TEST quotes them,
 *  in a comment and in an assertion. So three doc claims that were correctly
 *  reported as absent silently started resolving, and nothing went red. That is
 *  the failure this list exists to prevent, reproduced by accident inside the very
 *  commit that was meant to pin it. Same class as the repo's recorded
 *  "a comment quoting a grep matches itself" landmine. */
export const GATE_SELF_FILES = [
  path.resolve("scripts/check-agents-symbols.mjs"),
  path.resolve("scripts/agents-symbols-lib.mjs"),
  path.resolve("scripts/agents-symbols-lib.test.mjs"),
];

export function collectIdentifiers(dir, into) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectIdentifiers(path.join(dir, entry.name), into);
      continue;
    }
    if (!CODE_EXT.test(entry.name)) continue;
    if (GATE_SELF_FILES.includes(path.resolve(dir, entry.name))) continue;
    const src = fs.readFileSync(path.join(dir, entry.name), "utf8");
    for (const m of src.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) into.add(m[0]);
  }
}
```

The old `SELF` used `new URL(import.meta.url).pathname` with a Windows drive-letter fixup. `path.resolve` against the repo root is equivalent here because both gates are run from the repo root (`npm run` guarantees it) and both `GATE_SELF_FILES` entries are repo-relative. Keep the CLI's existing "run from the repo root" guard.

- [ ] **Step 2: Rewire the CLI to import from the library**

In `scripts/check-agents-symbols.mjs`, delete the moved declarations and add:

```js
import {
  ABSENCE_MARKERS,
  ALLOWLIST,
  collectIdentifiers,
  isGatedSymbolName,
  markedNear,
} from "./agents-symbols-lib.mjs";
```

Replace the inline predicate in the `lines.forEach` loop:

```js
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const name = m[1];
        if (!isGatedSymbolName(name)) continue;
        if (known.has(name)) {
          verified.add(name);
          continue;
        }
        if (ALLOWLIST.has(name) || seen.has(name)) continue;
        if (markedNear(doc, lineStart[i] + m.index)) continue;
        seen.add(name);
        findings.push({ doc: docPath, name, line: i + 1, text: line.trim() });
      }
    });
```

Delete the now-unused local `markedNear` closure, the `SELF` constant and the `CODE_EXT`/`SKIP_DIRS`/`IDENTIFIER`/`PROXIMITY` declarations. Keep `DOCS`, `CODE_DIRS`, both "refusing to report a pass" floors, and the failure-message block.

- [ ] **Step 3: Widen the sentinel test to all three leaked names**

Task 2 wrote the sentinel test against `compareX` alone, on the plan's assumption that it was the only name at risk. Measurement says otherwise: the test file quotes three of the six, and a one-name assertion passes while the other two go on resolving. Replace that test and add the third `GATE_SELF_FILES` assertion:

```js
  it("names all three gate files, not just the CLI", () => {
    for (const f of ["check-agents-symbols.mjs", "agents-symbols-lib.mjs", "agents-symbols-lib.test.mjs"]) {
      expect(GATE_SELF_FILES.some((p) => p.endsWith(f)), `${f} is scanned`).toBe(true);
    }
  });

  it("★★★ no sentinel name resolves as real code", () => {
    // These three live ONLY in the gate's own files — ALLOWLIST for `compareX`,
    // absence-marked doc mentions for the other two. THIS FILE quotes all three,
    // so if it is scanned they all resolve, the ALLOWLIST entry goes dead and two
    // correct "that symbol is gone" doc claims start passing for the wrong reason.
    // Measured: without the exclusion the gate reports 1138/37111 instead of
    // 1135/37095 — and still exits 0.
    const known = new Set();
    collectIdentifiers("scripts", known);
    for (const name of ["compareX", "pendingFlash", "onTakeTour"]) {
      expect(known.has(name), `${name} leaked into the scan`).toBe(false);
    }
  });
```

Keep the existing "still collects ordinary identifiers" test unchanged — it is what stops an over-broad exclusion from passing everything.

- [ ] **Step 4: Run the unit tests**

```bash
npx vitest run scripts/agents-symbols-lib.test.mjs --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 5: Prove the refactor changed no behaviour**

```bash
node scripts/check-agents-symbols.mjs > /tmp/symbols-after.txt 2>&1; echo "EXIT=$?"
diff /tmp/symbols-before.txt /tmp/symbols-after.txt; echo "DIFF_EXIT=$?"
```

Expected: `EXIT=0` and `DIFF_EXIT=0` — byte-identical output, still
`10 doc(s): 1135 named symbols all resolve (against 37095 identifiers in src/scripts/e2e)`.

★★ This is a RESTORATION, not a preservation. Task 2's commit already moved the live gate to `1138 … 37111` (see the `GATE_SELF_FILES` comment for why). So between Task 2 and Task 3 the anchor does NOT hold, and Step 4 is the step that puts it back. Do not "fix" the discrepancy by re-capturing the anchor after Task 2 — that would bake the degradation in as the new normal, which is precisely how a defeated gate goes on reporting success.

**Both numbers must come back down.** `1138 → 1135` proves the three leaked sentinels stopped resolving; `37111 → 37095` proves the exclusion covers the whole test file. Either one alone is satisfiable by a wrong fix: excluding only the assertion line would move the first and not the second.

The identifier count is the tell in both directions. If it stays above 37095, `GATE_SELF_FILES` is missing a file that quotes sentinel names. If it falls below, the exclusion is too broad and real source is going unscanned. Fix `GATE_SELF_FILES` — never adjust the expected number.

★ Compare against the file captured in Task 1 Step 2, not against the number written here — a literal in a plan is exactly the thing that goes stale, as it already did once.

- [ ] **Step 6: Mutation-check the self-exclusion**

A guard nothing can turn red is not a guard. `GATE_SELF_FILES` now has three entries, so mutate **each one independently** — a list where only one element is load-bearing is a list with two dead elements, and dead entries are what this whole task is about.

Run this once per entry, substituting `TARGET`:

```bash
TARGET=scripts/agents-symbols-lib.mjs          # then check-agents-symbols.mjs, then agents-symbols-lib.test.mjs
node -e "const fs=require('fs');const f='scripts/agents-symbols-lib.mjs';const s=fs.readFileSync(f,'utf8');fs.writeFileSync(f+'.bak',s);const out=s.replace(new RegExp('\\\\s*path\\\\.resolve\\\\(\"'+process.env.TARGET.replace(/[./]/g,'\\\\$&')+'\"\\\\),'),'');if(out===s){console.error('MUTATION DID NOT APPLY');process.exit(9)}fs.writeFileSync(f,out)"
npx vitest run scripts/agents-symbols-lib.test.mjs --reporter=dot > /tmp/mut.log 2>&1; echo "MUTANT_EXIT=$?"
node -e "const fs=require('fs');fs.renameSync('scripts/agents-symbols-lib.mjs.bak','scripts/agents-symbols-lib.mjs')"
```

Expected: `MUTANT_EXIT=1` for **all three**, each time with the sentinel test naming the leaked symbol.

★★ The `MUTATION DID NOT APPLY` guard is not decoration. A mutation whose regex silently matched nothing leaves the file intact, the suite green, and prints `MUTANT_EXIT=0` — which reads exactly like a surviving mutant and would send you rewriting a test that was fine. Exit 9 separates "the test is weak" from "the experiment never ran".

Which name should die on which mutant:
- drop `agents-symbols-lib.mjs` → its own `ALLOWLIST` is scanned → `compareX` leaks
- drop `check-agents-symbols.mjs` → the CLI's comments are scanned → `pendingFlash` / `onTakeTour` leak (`migrateTaskStatus`, `onToggleComplete`, `requestFlash` too, though no test names those)
- drop `agents-symbols-lib.test.mjs` → this test's own fixtures are scanned → all three leak

If any mutant survives, the test is vacuous for that entry. A surviving mutant is a question with two answers that look identical from the harness — "equivalent mutant" and "missing test" — so go find an input that separates them before moving on. Restore the `.bak` after every run, and confirm `git status` is clean before Step 7.

- [ ] **Step 7: Commit**

```bash
git add scripts/agents-symbols-lib.mjs scripts/check-agents-symbols.mjs scripts/agents-symbols-lib.test.mjs
git commit -m "refactor: split the symbol gate's pure layer into its own library

Behaviour-preserving — output byte-identical before and after. The split
adds a second file naming the symbols the gate exists to catch, so the
self-exclusion becomes a set and is pinned by a sentinel test."
```

---

## Task 4: Failing tests for register parsing

**Files:**
- Create: `scripts/followup-claims-lib.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// Unit tests for the open-followups gate's parsing layer.
//
// Same discipline as `doc-claims-lib.test.mjs`: every defect the sibling gate
// shipped was a regex defect, and both were found by running it against the
// real docs rather than by reading it. Each `regression:` test names what it
// pins.
import { describe, expect, it } from "vitest";
import {
  classify,
  fencedLines,
  isClosed,
  parseEntries,
  reproCommandsIn,
  symbolsIn,
} from "./followup-claims-lib.mjs";

const REGISTER_SAMPLE = [
  "# Open follow-ups — central register",
  "",
  "intro prose that belongs to no entry",
  "",
  "## 1. A live problem — open",
  "body of one, naming `resolveEntitySave` and `src/app/types.ts`",
  "",
  "### What is actually true",
  "a sub-heading does NOT end the entry",
  "",
  "## 2. ~~A fixed problem~~ — CLOSED post-0.212.0",
  "body of two",
  "",
  "## Decided — do not re-litigate",
  "this section is not an entry and its prose is not entry 2's body",
  "",
  "## 3. Another live one — open",
  "```bash",
  "grep -c 'foo' src/app/bar.ts",
  "```",
].join("\n");

describe("parseEntries", () => {
  const entries = parseEntries(REGISTER_SAMPLE);

  it("finds only numbered level-2 headings", () => {
    expect(entries.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it("regression: a `###` sub-heading does not end an entry", () => {
    expect(entries[0].body.join("\n")).toContain("a sub-heading does NOT end the entry");
  });

  it("regression: a non-numbered `##` section ends the entry and is not one", () => {
    // The register carries three of these. Folding their prose into the entry
    // above would attribute unrelated claims to that entry.
    expect(entries[1].body.join("\n")).not.toContain("this section is not an entry");
    expect(entries.map((e) => e.n)).not.toContain(NaN);
  });

  it("records the heading's line number for reporting", () => {
    expect(entries[0].startLine).toBe(5);
  });
});

describe("isClosed", () => {
  it("reads CLOSED and strikethrough from the heading", () => {
    expect(isClosed("A fixed problem — CLOSED post-0.212.0")).toBe(true);
    expect(isClosed("~~A fixed problem~~ — done")).toBe(true);
  });

  it("does not read the word 'closed' inside an ordinary sentence", () => {
    expect(isClosed("The popover is never closed on Escape — open")).toBe(false);
  });
});

describe("symbolsIn", () => {
  it("extracts backticked mixed-case identifiers", () => {
    expect(symbolsIn("naming `resolveEntitySave` and `x`")).toEqual(["resolveEntitySave"]);
  });

  it("regression: ignores a path — that is the citation check's job", () => {
    expect(symbolsIn("see `src/app/types.ts` for the shape")).toEqual([]);
  });
});

describe("fencedLines / reproCommandsIn", () => {
  it("returns fenced content, without the fence delimiters", () => {
    expect(fencedLines(REGISTER_SAMPLE)).toEqual(["grep -c 'foo' src/app/bar.ts"]);
  });

  it("regression: reuses the hardened fence parser, so a blockquoted fence works", () => {
    // `stripFencedBlocks` handles blockquoted, tilde and nested fences. Writing
    // a second fence parser here is how the two would drift.
    const doc = "## 9. x — open\n> ```bash\n> grep -c foo src/a.ts\n> ```";
    expect(fencedLines(doc).length).toBeGreaterThan(0);
  });

  it("keeps only allowlisted commands", () => {
    const cmds = reproCommandsIn(
      "## 9. x\n```bash\ngrep -c foo src/a.ts\nrm -rf /\nnpm run test:run\n```",
    );
    expect(cmds).toEqual(["grep -c foo src/a.ts", "npm run test:run"]);
  });

  it("★★★ never returns a command with shell metacharacters", () => {
    // These are executed. A pipe, a redirect or a `;` would be passed to a
    // shell that this harness deliberately never spawns — and a piped command
    // would report the PIPE's exit status, which is the failure mode AGENTS.md
    // records at three stars.
    const cmds = reproCommandsIn("## 9. x\n```bash\ngrep -c foo src/a.ts | wc -l\n```");
    expect(cmds).toEqual([]);
  });
});

describe("classify", () => {
  const env = {
    knownSymbols: new Set(["resolveEntitySave"]),
    resolve: (p) => (p === "src/app/types.ts" ? [p] : []),
    lineCounts: new Map([["src/app/types.ts", 900]]),
  };

  it("CLEAN when every symbol resolves and every path exists", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `resolveEntitySave` in `src/app/types.ts`");
    expect(classify(entry, env).verdict).toBe("CLEAN");
  });

  it("SYMBOL_MISSING names the symbol that vanished", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `migrateTaskStatus` today");
    const r = classify(entry, env);
    expect(r.verdict).toBe("SYMBOL_MISSING");
    expect(r.problems[0].detail).toBe("migrateTaskStatus");
  });

  it("PATH_MISSING when a named file has left the tree", () => {
    const [entry] = parseEntries("## 1. x — open\nlives in `src/app/deleted.ts`");
    expect(classify(entry, env).verdict).toBe("PATH_MISSING");
  });

  it("CITE_BROKEN when a cite is past end of file", () => {
    const [entry] = parseEntries("## 1. x — open\nsee `src/app/types.ts:5000`");
    expect(classify(entry, env).verdict).toBe("CITE_BROKEN");
  });

  it("NO_MACHINE_CLAIM when the entry asserts nothing checkable", () => {
    // Not a failure. A large share of the register is a11y and CSS-geometry
    // work that no static check can judge; saying so routes it to a probe
    // instead of pretending it passed.
    const [entry] = parseEntries("## 1. x — open\nthe spacing feels wrong on dark schemes");
    expect(classify(entry, env).verdict).toBe("NO_MACHINE_CLAIM");
  });

  it("★★ CLEAN is not a pass — it means nothing static could disprove it", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `resolveEntitySave`");
    expect(classify(entry, env).needsProbe).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run scripts/followup-claims-lib.test.mjs --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: `EXIT=1`, failing to resolve `./followup-claims-lib.mjs`.

- [ ] **Step 3: Commit**

```bash
git add scripts/followup-claims-lib.test.mjs
git commit -m "test: pin the open-followups gate's parsing layer"
```

---

## Task 5: Implement the parsing library

**Files:**
- Create: `scripts/followup-claims-lib.mjs`

- [ ] **Step 1: Write the implementation**

```js
// Parsing and classification for the open-followups register gate.
// Pure: no `process.exit`, no `console`, no IO beyond what the caller injects —
// so every rule below is unit-testable. Mirrors `doc-claims-lib.mjs`, whose
// fence parser and citation resolver this file REUSES rather than re-derives.
import { citesOnLine, stripFencedBlocks } from "./doc-claims-lib.mjs";
import { isGatedSymbolName } from "./agents-symbols-lib.mjs";

export const REGISTER = "docs/open-followups.md";

/** `## 42. Title` opens an entry. */
export const ENTRY_RE = /^##\s+(\d+)\.\s+(.*)$/;

/** Any OTHER level-2 heading closes the current entry. The register carries
 *  three ("Decided — do not re-litigate", "Provenance …", "Standing notes …")
 *  and their prose makes no claim about the entry above. `###` sub-headings are
 *  body: `\s+` cannot match the third `#`. */
export const SECTION_RE = /^##\s+(?!\d+\.\s)/;

export function parseEntries(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  lines.forEach((line, i) => {
    const m = ENTRY_RE.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { n: Number(m[1]), title: m[2], startLine: i + 1, body: [] };
      return;
    }
    if (SECTION_RE.test(line)) {
      if (cur) out.push(cur);
      cur = null;
      return;
    }
    if (cur) cur.body.push(line);
  });
  if (cur) out.push(cur);
  return out;
}

/** ★ Matched on the HEADING only, and case-sensitively on the bare word. The
 *  register's bodies discuss popovers being "closed" constantly; reading the
 *  body would mark live entries done. */
export function isClosed(title) {
  return /\bCLOSED\b/.test(title) || title.includes("~~");
}

/** Fenced content, delimiters removed — the complement of `stripFencedBlocks`.
 *  ★★ Derived from that function rather than re-parsed: it is hardened against
 *  blockquoted, tilde, inline and nested fences, all four of which were live
 *  defects. A second parser here would drift from it silently. */
export function fencedLines(text) {
  const raw = text.split(/\r?\n/);
  const stripped = stripFencedBlocks(text);
  return raw.filter(
    (l, i) => stripped[i] === "" && l.trim() !== "" && !/^\s*(?:>\s?)*(?:`{3,}|~{3,})/.test(l),
  );
}

/** Commands safe to execute. ★★★ NO SHELL METACHARACTERS, because the runner
 *  spawns with `shell: false` — and because a piped command reports the PIPE's
 *  exit status, so a "reproduce" that silently always passes is worse than
 *  none. Blockquote markers are stripped first. */
const RUNNABLE_RE = /^(?:grep\b|node -e |node scripts\/[\w.-]+|npm run [a-z0-9:_-]+$|npx [\w@/.-]+)/;
const SHELL_META = /[|;&><`$(){}]/;

export function reproCommandsIn(text) {
  return fencedLines(text)
    .map((l) => l.replace(/^\s*(?:>\s?)*/, "").trim())
    .filter((l) => RUNNABLE_RE.test(l) && !SHELL_META.test(l));
}

/** Backticked names the symbol gate would check. Same predicate, imported —
 *  two gates disagreeing about what a symbol is would be worse than either. */
export function symbolsIn(text) {
  const out = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (isGatedSymbolName(m[1])) out.push(m[1]);
  }
  return out;
}

/** Bare repo paths an entry names. Excludes anything already carrying `:LINE`
 *  — that is a citation and is checked with the line number attached. */
export function pathsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([\w./-]+\.(?:tsx|ts|mjs|json|css|md|yml))`/g)) out.add(m[1]);
  return [...out];
}

export function citesIn(text) {
  const out = [];
  for (const line of stripFencedBlocks(text)) out.push(...citesOnLine(line));
  return out;
}

/** `env` is injected so this stays pure and testable:
 *    knownSymbols : Set<string>      identifiers present in src/scripts/e2e
 *    resolve      : (path) => path[] doc-claims-lib's resolveCandidates, bound
 *    lineCounts   : Map<path, number>
 */
export function classify(entry, env) {
  const prose = stripFencedBlocks(entry.body.join("\n")).join("\n");
  const symbols = symbolsIn(prose);
  const paths = pathsIn(prose);
  const cites = citesIn(entry.body.join("\n"));
  const repro = reproCommandsIn(entry.body.join("\n"));
  const problems = [];

  for (const s of symbols) {
    if (!env.knownSymbols.has(s)) problems.push({ kind: "SYMBOL_MISSING", detail: s });
  }
  for (const p of paths) {
    if (env.resolve(p).length === 0) problems.push({ kind: "PATH_MISSING", detail: p });
  }
  for (const c of cites) {
    const [resolved] = env.resolve(c.citedPath);
    if (!resolved) {
      problems.push({ kind: "CITE_BROKEN", detail: `${c.citedPath} (unresolvable)` });
      continue;
    }
    const max = env.lineCounts.get(resolved) ?? 0;
    if (Number(c.lineNo) > max) {
      problems.push({ kind: "CITE_BROKEN", detail: `${c.citedPath}:${c.lineNo} > ${max}` });
    }
  }

  const hasClaim = symbols.length + paths.length + cites.length + repro.length > 0;
  const verdict = problems.length ? problems[0].kind : hasClaim ? "CLEAN" : "NO_MACHINE_CLAIM";
  return {
    n: entry.n,
    title: entry.title,
    startLine: entry.startLine,
    verdict,
    problems,
    repro,
    counts: { symbols: symbols.length, paths: paths.length, cites: cites.length },
    // ★★ EVERY entry reaching here needs a human or a probe. CLEAN means
    // "nothing static disproved it", never "it still applies".
    needsProbe: true,
  };
}
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run scripts/followup-claims-lib.test.mjs --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 3: Run the lib against the real register — the only test that matters**

Every defect the sibling gate shipped was found this way, never by reading the code.

```bash
node -e "
const fs=require('fs');
import('./scripts/followup-claims-lib.mjs').then(({parseEntries,isClosed})=>{
  const e=parseEntries(fs.readFileSync('docs/open-followups.md','utf8'));
  console.log('entries',e.length,'| closed',e.filter(x=>isClosed(x.title)).length,'| open',e.filter(x=>!isClosed(x.title)).length);
  console.log('max',Math.max(...e.map(x=>x.n)));
});"
```

Expected exactly: `entries 129 | closed 37 | open 92` and `max 137`.

Any other number means the parser disagrees with the measured baseline — fix the parser, do not adjust the expectation.

- [ ] **Step 4: Commit**

```bash
git add scripts/followup-claims-lib.mjs
git commit -m "feat: parsing and classification layer for the open-followups register"
```

---

## Task 6: The CLI

**Files:**
- Create: `scripts/check-followup-claims.mjs`

- [ ] **Step 1: Write the CLI**

```js
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
import { collectSources, countLines, resolveCandidates } from "./doc-claims-lib.mjs";
import { collectIdentifiers } from "./agents-symbols-lib.mjs";
import { REGISTER, classify, isClosed, parseEntries } from "./followup-claims-lib.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const runRepro = args.includes("--run-repro");

const entries = parseEntries(readFileSync(REGISTER, "utf8")).filter((e) => !isClosed(e.title));

const knownSymbols = new Set();
for (const dir of ["src", "scripts", "e2e"]) collectIdentifiers(dir, knownSymbols);
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

const sources = collectSources();
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

if (runRepro) {
  for (const r of results) {
    r.reproResults = r.repro.map((cmd) => {
      // ★★★ `shell: false`. The command came out of a markdown file; a shell
      // would make every metacharacter in it executable. `reproCommandsIn`
      // already rejects metacharacters — this is the second layer.
      const [bin, ...rest] = cmd.split(/\s+/);
      const out = spawnSync(bin, rest, { encoding: "utf8", timeout: 60_000, shell: false });
      return { cmd, status: out.status, stdout: (out.stdout ?? "").trim().slice(0, 400) };
    });
    if (r.reproResults.some((x) => x.status !== 0)) {
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

if (jsonAt !== -1) {
  writeFileSync(args[jsonAt + 1], `${JSON.stringify({ tally, results }, null, 2)}\n`);
}
// Reporting tool, not a gate: it exits 0 with findings. Promoting it to
// blocking is a separate decision, once its false-positive rate is known.
process.exit(0);
```

- [ ] **Step 2: Run it**

```bash
node scripts/check-followup-claims.mjs > /tmp/sweep.txt 2>&1; echo "EXIT=$?"; tail -30 /tmp/sweep.txt
```

Expected: `EXIT=0`, a report opening with `92 open entries` and closing with a tally line.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-followup-claims.mjs
git commit -m "feat: open-followups claim checker CLI"
```

---

## Task 7: Wire it into package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script and its description**

In `scripts`:

```json
    "followups:check": "node scripts/check-followup-claims.mjs",
```

In `scriptsDescriptions`:

```json
    "followups:check": "Report which claims in docs/open-followups.md a machine can still check (reporting only, never blocking)",
```

- [ ] **Step 2: Regenerate the generated script tables**

A new script without a `scriptsDescriptions` entry fails `docs:scripts:check`.

```bash
npm run docs:scripts
npm run docs:scripts:check; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 3: Commit**

```bash
git add package.json README.md CONTRIBUTING.md docs
git commit -m "chore: register followups:check and regenerate the script tables"
```

Commit only the files `npm run docs:scripts` actually touched — check `git status` first and drop any path it did not modify.

---

## Task 8: Write the snapshot

**Files:**
- Create: `docs/baselines/followup-claims.json`

- [ ] **Step 1: Generate it**

```bash
node scripts/check-followup-claims.mjs --json docs/baselines/followup-claims.json > /tmp/sweep.txt 2>&1; echo "EXIT=$?"
node -e "const j=require('./docs/baselines/followup-claims.json');console.log(JSON.stringify(j.tally))"
```

Expected: `EXIT=0` and a tally object.

- [ ] **Step 2: Commit**

```bash
git add docs/baselines/followup-claims.json
git commit -m "chore: snapshot the open-followups claim sweep

A SNAPSHOT, not a ratchet — nothing reads this file as a gate input. It
exists so the next sweep can be diffed against this one."
```

---

## Task 9: Go/no-go — inspect the verdict spread

**This is a decision step, not an implementation step.** The spec makes it a hard gate: if the harness judges too little, the correct outcome is to stop and fall back to a sequential pass.

**Files:** none — this task produces a decision.

- [ ] **Step 1: Read the tally**

```bash
node -e "const j=require('./docs/baselines/followup-claims.json');
const t=j.tally, n=j.results.length;
for(const [k,v] of Object.entries(t)) console.log(k.padEnd(18), v, ((v/n)*100).toFixed(0)+'%');"
```

- [ ] **Step 2: Apply the decision rule**

| Observation | Decision |
|---|---|
| `NO_MACHINE_CLAIM` ≥ 70% | **Stop.** The harness is not earning its cost. Fall back to the sequential pass and keep the harness only as a cheap pre-filter. |
| At least one of `SYMBOL_MISSING` / `PATH_MISSING` / `CITE_BROKEN` is non-zero | **Proceed.** The harness found rot no human sweep would have hit reliably. |
| Everything is `CLEAN` | **Suspect the harness before believing the register.** A gate that flags nothing over 8428 lines of five-year-old prose is more likely broken than the docs are perfect. Hand-check five entries known to name symbols, and confirm it reports them. |

- [ ] **Step 3: Spot-check five findings by hand**

Take the first five entries with a `SYMBOL_MISSING` or `PATH_MISSING` problem and confirm each by grep. A false positive here is the expensive direction — it sends someone hunting for breakage that is not there.

```bash
grep -rn --include='*.ts' --include='*.tsx' --include='*.mjs' '<the reported symbol>' src scripts e2e; echo "EXIT=$?"
```

Expected for a true finding: `EXIT=1`, no output.

- [ ] **Step 4: Record the decision**

Append the tally and the go/no-go call to the spec's §2 as a dated measurement. Commit.

```bash
git add docs/superpowers/specs/2026-08-10-open-followups-consolidation-design.md
git commit -m "docs: record the P1 verdict spread and the go/no-go decision"
```

The spec lives under `docs/superpowers/`, which `.gitignore:76` excludes — this commit will be empty. Skip it and record the decision in the P2 plan's header instead.

---

## Task 10: Full gate run

**Files:** none.

- [ ] **Step 1: Run every gate, unpiped, reading each exit code directly**

Never read a gate's status through a pipe: `npm run test:run | tail -8` exits 0 while tests are failing, because that is `tail`'s status, and the pipe discards the diagnostic too.

```bash
npm run docs:symbols:check > /tmp/g1.log 2>&1; echo "symbols=$?"
npm run docs:claims:check  > /tmp/g2.log 2>&1; echo "claims=$?"
npm run docs:scripts:check > /tmp/g3.log 2>&1; echo "scripts=$?"
npx tsc --noEmit           > /tmp/g4.log 2>&1; echo "tsc=$?"
npx eslint --max-warnings=0 src/app > /tmp/g5.log 2>&1; echo "eslint=$?"
npm run test:run           > /tmp/g6.log 2>&1; echo "test=$?"
npm run size:check         > /tmp/g7.log 2>&1; echo "size=$?"
npm run dup:check          > /tmp/g8.log 2>&1; echo "dup=$?"
```

Expected: every value `0`.

Run these **serially**, not in parallel — two vitest processes on one machine is the saturation condition behind this repo's load-sensitive flakes.

- [ ] **Step 2: Run the shuffled suite**

The only local reproduction of the `unit-tests-shuffled` gate. Required because this plan adds test files.

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

Expected: `EXIT=0`.

- [ ] **Step 3: Confirm `origin/main` has not moved**

It moved once during design. Risk 5.

```bash
git fetch origin --prune
git log --oneline -1 origin/main
```

If it advanced, rebase and re-run Step 1 before opening anything.

---

## P1 RESULT — measured 2026-08-10 at `bc3ae74e`, branched off `origin/main` @ `fba42c18`

`npm run followups:check` over all 92 open entries:

| Verdict | n | % |
|---|---|---|
| CLEAN | 80 | 87% |
| SYMBOL_MISSING | 8 | 9% |
| NO_MACHINE_CLAIM | 1 | 1% |
| PATH_MISSING | 1 | 1% |
| PATH_THIRD_PARTY | 1 | 1% |
| CITE_THIRD_PARTY | 1 | 1% |

**Decision: PROCEED.** Row 2 of the rule fires — `SYMBOL_MISSING` and `PATH_MISSING` are both non-zero, so the harness found rot a human sweep would not have hit reliably. Row 1 does not fire (`NO_MACHINE_CLAIM` is 1%, not ≥70%). Row 3 does not fire — not everything is CLEAN.

Spot-check, ten symbols by hand (`grep -rl` over `src`/`scripts`/`e2e`): **all ten genuinely absent, zero false positives** in the `SYMBOL_MISSING` bucket — `migrateWorkspaceV11`, `RaidPanelToolbar`, `linkedEntities`, `importTemplate`, `exportTemplate`, `eventToGraphEvent`, `exceptionPlan`, `afterPush`, `replayExceptions`, `AiViewScopeDisclosure`.

★★★ **READ `CLEAN=87%` AS A WEAK SIGNAL, NOT AS GOOD NEWS — and note that row 3 of the decision rule nearly fired.** `hasClaim` is true whenever an entry names any backticked symbol, and nearly every entry does, so `CLEAN` collapses to "this entry names at least one symbol and all of its names still resolve". It says nothing about whether the entry's actual *claim* holds. The spec expected `NO_MACHINE_CLAIM` to be large — a11y and CSS-geometry work no static check can judge — and it came back at **1**. That is not the harness discovering the register is unusually checkable; it is the harness classifying by the presence of names rather than by the checkability of claims. **All 92 entries carry `needsProbe: true` and every one of the 80 CLEAN ones still needs P2's behavioural probe.** Do not let the tally shrink P2's scope.

★★ Three residual false positives are known and deliberately unfixed:
- **§131 `foo.tsx`** — a hypothetical name inside a regex discussion (`` `foo.tsxx` `` anchors to `foo.tsx`). Telling an illustrative name from a real one is not mechanically decidable. No allowlist was added; one hardcoded exception invites a hundred.
- **§36 `importTemplate`/`exportTemplate`** — a genuine absence assertion ("there is no template import channel"), but written in the bare `no <name>` idiom that measurement showed costs 15 false suppressions. Left flagged: the safe direction.
- **§44** keeps five findings under a blanket "none of this was built" sentence. Blanket claims are deliberately not honoured — the same sentence sweeps in `GraphEvent`, which exists and which the entry asks to *widen*, so honouring it would manufacture a false "done".

★★★ **THE PROXIMITY RULE DID NOT TRANSFER, and this is the finding most likely to be re-derived wrongly.** The symbol gate's `markedNear`/`PROXIMITY=240` was the obvious reuse for "the entry asserts this thing is absent". Measured on the register: **54 of 957 backticked mentions sit near a marker, and 48 of those name something that EXISTS** — every one would have become a false "this follow-up is done", the most expensive error the harness can make. The cause is structural, not a wrong window: §7's own table row puts a real absence assertion **15 characters** from a present symbol. Decisively, the motivating case fires on *nothing* at 240 — "no `X` exists" matches no marker at all. The fix was to **anchor**: the marker must capture the name it negates. Do not reintroduce a proximity window here.

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §5 harness, four check classes | 5, 6 |
| §5 reuse `check-agents-symbols.mjs` predicate | 2, 3 (required extracting it first — the spec assumed it was importable; it exports nothing) |
| §5 reuse `doc-claims-lib.mjs` | 5 |
| §5 allowlisted reproduce commands | 5 (`RUNNABLE_RE`), 6 (`shell: false`) |
| §5 harness never closes an entry | 5 (`needsProbe: true`), 6 (banner + `exit 0`) |
| §5 own unit test, no coverage floor raised | 2, 4 |
| §5 10-entry spread check before finishing | 9 (widened to the full tally, which is strictly more informative and no more expensive once the sweep runs) |
| §5 baseline JSON | 8 |
| §10 gates | 10 |
| §11 not a blocking gate | 6, 8 |
| §2–§4, §6–§9 (P2–P4) | **deliberately out of plan** — see Scope |

**Placeholder scan.** One placeholder remains by design: the `…move the existing doc comment here verbatim…` markers in Task 3 Step 1. They are instructions to *move existing text unchanged*, not to invent it — reproducing ~40 lines of measured commentary inline would invite a paraphrase, which is the drift this repo has been bitten by. The source lines are `check-agents-symbols.mjs:70-126` and `:183-194`.

**Type consistency.** `classify(entry, env)` takes two arguments in the test (Task 4), the implementation (Task 5) and the CLI (Task 6). `env.resolve` returns an array in all three. `env.lineCounts` is a `Map` in the test and an object with a `get` method in the CLI — both satisfy the only call made, `env.lineCounts.get(p)`. `collectIdentifiers(dir, into)` keeps its existing two-argument shape. `GATE_SELF_FILES` is an array in the lib and is asserted as an array in the test.

**One gap found and closed during review:** Task 9's decision rule originally had no branch for "everything is CLEAN". A harness that flags nothing reads as good news and is the most likely failure mode of the whole phase — the sibling gates both carry an explicit "refusing to report a pass" floor for exactly this. Added as the third row, plus the two floors in Task 6 Step 1.
