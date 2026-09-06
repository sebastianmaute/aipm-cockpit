# Preview/apply parity round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/open-followups.md` §390-406 — make the preview and the writer share one acceptance predicate per field, move the divergences that needed both sides moved, and surface every refusal the code already computes.

**Architecture:** Five layers, ordered as a dependency chain. Layer 1 removes the second spelling of each acceptance rule by inverting the dependency — the load-path sanitizer calls the predicate the merge-site guard already uses. That inversion is what turns Layer 2's five "coordinated change" entries into single edits. Layer 3 surfaces refusals on the two surfaces that compute and discard them. Layer 4 repairs the gates that cannot see their own defect class. Layer 5 takes the two data-model decisions.

**Tech Stack:** TypeScript, React 19, Next 16.2.11, vitest 4.1.8, Playwright. No new dependencies.

---

## Ground rules for every task

Read these once before Task 1. They are repo constraints, not preferences, and several have already cost a build.

**Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status and discards the diagnostic. Redirect, echo unpiped, then read the file:

```bash
npx vitest run <path> > "$SCRATCH/run.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/run.log"
```

`$SCRATCH` is this session's scratchpad directory. **Never `/tmp`** — it is shared across sessions and has been clobbered by a peer.

**Never run two vitest processes at once.** `Failed to start forks worker` is contention, not a red suite.

**Never `git add -A` or `git add .`** — `not-in-use.env.local.bak` is untracked, not gitignored, and holds a live Turso token. Every commit in this plan uses `git commit --only <explicit paths>`. `git add` does not scope a commit.

**Never `git commit --amend`** — this is a shared worktree and an amend has swallowed a stranger's commit twice.

**`sample-workspace-big.json` and `sample-workspace-huge.json` are foreign modifications.** They are dirty at the start of this branch and must never be staged.

**Every `src/app/*.ts(x)` file is CRLF.** The `Edit` tool preserves line endings; the `Write` tool re-lines CRLF to LF. Use `Edit` on existing sources. Never `sed -i` on a source file — under Git Bash it re-lines the whole file to LF and `core.autocrlf=true` hides it from the diff.

**Do not touch `src/app/i18n.de.ts` with `Edit` or `Write`.** It corrupts umlauts and curls double quotes. Patch it with a `.mjs` script written via the `Write` tool, using `\r\n` anchors and real umlauts — never `\uXXXX` escapes, which the `i18n-encoding` test bans.

**`npx tsc --noEmit` exits 2 on diagnostics**, not 1. Run it after editing any test file — vitest never typechecks and `next build` skips `*.test.tsx`.

**Commit messages** end with the trailer:

```
Claude-Session: https://[session link removed]
```

Write the message with a `git commit -F -` heredoc, never a PowerShell here-string.

**Run only the gates a task needs.** No full suite until the end, and only on the user's say-so.

---

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/app/inline-ai-edit/str.ts` | **NEW.** The one `str` projection, imported by `plan.ts` and `entity-descriptor.ts` | 1 |
| `src/app/sanitize-records.ts` | The four load-path sanitizers, their acceptance predicates and the four merge-site guards | 2-5, 7, 8, 18 |
| `src/app/inline-ai-edit/entity-descriptor.ts` | Per-entity preview descriptors; `fieldSanitizers`; numeric range rules | 6, 7, 15 |
| `src/app/inline-ai-edit/plan.ts` | `describeEntityCalls`, `EditPlan`, `isEmptyPlan`, the update/link/create buckets | 6, 12, 19 |
| `src/app/chat-task-patch.ts` | `buildTaskCleanPatch` — the task update patch builder | 9 |
| `src/app/use-inline-entity-edit.ts` | Inline edit state machine and apply loop | 10 |
| `src/app/inline-ai-edit-popover.tsx` | The inline edit surface | 10 |
| `src/app/chat-proposal-describe.ts` | Chat approval card describers (i18n-free by construction) | 11, 13 |
| `src/app/chat-tool-defs.ts` | Tool schemas handed to the model | 17 |
| `src/app/inline-ai-edit/tool-input-coverage.test.ts` | The declared-input coverage gate | 16 |
| `src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` | The preview/apply differential sweep | 14 |
| `docs/open-followups.md` | The register | 20 |
| `CHANGELOG.md`, `src/app/version.ts` | Release | 20 |

---

## Task 1: One `str`, in a leaf module (§400)

**Files:**
- Create: `src/app/inline-ai-edit/str.ts`
- Modify: `src/app/inline-ai-edit/plan.ts` (delete the local `function str`, import instead)
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts` (delete the local `const str`, import instead)
- Test: `src/app/inline-ai-edit/str.test.ts`

Two definitions of one function exist. `plan.ts` imports `entity-descriptor.ts`, so importing the helper back would close a cycle; a leaf module both import breaks the tie.

- [ ] **Step 1: Write the failing test**

Create `src/app/inline-ai-edit/str.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { str } from "./str";

describe("str", () => {
  it("renders nullish as the empty string", () => {
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });

  it("joins an array with a comma and a space", () => {
    expect(str([1, 2, 3])).toBe("1, 2, 3");
  });

  it("renders an empty array as the empty string, which the clear predicates rely on", () => {
    expect(str([])).toBe("");
  });

  it("stringifies everything else verbatim", () => {
    expect(str(42)).toBe("42");
    expect(str(true)).toBe("true");
    expect(str("x")).toBe("x");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/inline-ai-edit/str.test.ts > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t1.log"
```

Expected: FAIL — `Failed to resolve import "./str"`.

- [ ] **Step 3: Create the leaf module**

Create `src/app/inline-ai-edit/str.ts`:

```ts
/** The ONE preview projection of an arbitrary tool-input value to the string the
 *  card renders.
 *
 *  ★★★ IT LIVES IN ITS OWN LEAF MODULE BECAUSE THE OBVIOUS HOMES BOTH FAIL.
 *  `plan.ts` imports `entity-descriptor.ts`, so putting it in `plan.ts` and
 *  importing it back would close a cycle; putting it in `entity-descriptor.ts`
 *  makes a descriptor concern out of a rendering one. It was two copies —
 *  `function str` in `plan.ts` and `const str` in `entity-descriptor.ts` — with
 *  a comment explaining why it was not an import (open-followups §400).
 *
 *  ★★ THE `[]` CASE IS LOAD-BEARING AND IS NOT INCIDENTAL. `rendersAsClear` in
 *  `sanitize-records.ts` treats `null`, `undefined`, `""` and `[]` alike
 *  BECAUSE this function renders all four as "", and the card therefore
 *  discloses all four as a clear. Changing this projection silently changes
 *  which model inputs the merge-site guards accept. */
export function str(v: unknown): string {
  return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
}
```

- [ ] **Step 4: Point both consumers at it**

In `src/app/inline-ai-edit/plan.ts`, delete the local declaration:

```ts
function str(v: unknown): string {
```

…through its closing brace, and add to the existing import block:

```ts
import { str } from "./str";
```

In `src/app/inline-ai-edit/entity-descriptor.ts`, delete:

```ts
const str = (v: unknown): string => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v));
```

and add:

```ts
import { str } from "./str";
```

- [ ] **Step 5: Verify — the new test, both consumers' suites, and tsc**

```bash
npx vitest run src/app/inline-ai-edit/str.test.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/entity-descriptor.test.ts > "$SCRATCH/t1b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t1b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0. A non-zero tsc here usually means one of the two `str` declarations was deleted but its import not added.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/inline-ai-edit/str.ts src/app/inline-ai-edit/str.test.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/entity-descriptor.ts -F - <<'MSG'
refactor(inline-ai-edit): one str projection in a leaf module

plan.ts imports entity-descriptor.ts, so importing the helper back would
close a cycle. A leaf module both import breaks the tie.

Closes open-followups 400.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 2: The RAID sanitizer calls its own predicate (§405)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`acceptsRiskScale`, `sanitizeRaidItem`)
- Test: `src/app/sanitize-records.test.ts`

`acceptsRiskScale` restates `sanitizeRaidItem`'s rule from ~50 lines away. Invert it: the sanitizer calls the predicate. **This task must not change behaviour** — the existing load-path tests are the control and must stay green with no edits.

- [ ] **Step 1: Write the failing test**

Append to `src/app/sanitize-records.test.ts`:

```ts
describe("delegate-never-restate: the raid sanitizer and its merge-site guard", () => {
  // ★★ This is a PROPERTY over the two, not a hand-picked row. The it.each
  //  tables in sanitize-raid-patch.test.ts cannot catch a divergence, because
  //  they assert chosen values against BOTH sides at once; a rule that drifted
  //  in the same direction on both would pass. Enumerating over a value set
  //  that straddles every boundary is what makes the delegation checkable.
  const PROBES: unknown[] = [
    1, 3, 5, 0, 6, -1, 2.5, "3", "abc", "", true, false, null, undefined, [], {}, NaN, Infinity,
  ];

  it.each(PROBES.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "stores probability %s exactly when acceptsRiskScale admits it",
    (_label, probe) => {
      const item = sanitizeRaidItem({ id: 1, title: "t", category: "R", probability: probe });
      expect(item).not.toBeNull();
      expect("probability" in item!).toBe(acceptsRiskScale(probe, "R"));
    },
  );
});
```

Add `acceptsRiskScale` to the file's import from `./sanitize-records`, and export it from `sanitize-records.ts` in Step 3.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "delegate-never-restate" > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t2.log"
```

Expected: FAIL — `acceptsRiskScale` is not exported.

- [ ] **Step 3: Export the predicate and have the sanitizer call it**

In `src/app/sanitize-records.ts`, change the declaration from `const acceptsRiskScale: RaidFieldGuard = (v) => {` to an exported one, and rewrite its docstring — the old one documents a consequence this task is about to remove:

```ts
/** The [1,5] risk-scale rule, and the ONE spelling of it.
 *
 *  ★★★ THE SANITIZER CALLS THIS; THIS DOES NOT RESTATE THE SANITIZER. That
 *  direction is the whole point (open-followups §405): the merge-site guard and
 *  `sanitizeRaidItem` used to hold two copies of one rule 50 lines apart, with
 *  nothing tying them together and no test able to see a drift, because every
 *  it.each row asserts a chosen value against both sides at once.
 *
 *  ★★ `toNumber`, NOT `typeof v === "number"` — the preview's `numberPreview`
 *  coerces with `toNumber`, so a stricter rule here refuses a value the card
 *  shows as accepted. Mutation-proved: swapping it turns the raid sweep in
 *  `plan.sanitizer-parity.test.ts` red. */
export const acceptsRiskScale: RaidFieldGuard = (v) => {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 5;
};
```

In `sanitizeRaidItem`, replace the two hand-spelled branches. Find them with:

```bash
grep -n "probability\|impact" src/app/sanitize-records.ts | sed -n '/sanitizeRaidItem/,$p'
```

and rewrite each to the delegating form, e.g.:

```ts
  if (acceptsRiskScale(o.probability, category)) r.probability = toNumber(o.probability);
  if (acceptsRiskScale(o.impact, category)) r.impact = toNumber(o.impact);
```

`RaidFieldGuard` takes a category it ignores for this field; pass the already-resolved `category` local.

- [ ] **Step 4: Verify — the new property, and the untouched control tests**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/sanitize-raid-patch.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > "$SCRATCH/t2b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t2b.log"
git diff --stat src/app/sanitize-raid-patch.test.ts
```

Expected: EXIT=0, and the second command prints NOTHING. **A control test that needed editing means this was a behaviour change, not a refactor — stop and report it.**

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts -F - <<'MSG'
refactor(sanitize): the raid sanitizer calls acceptsRiskScale

Inverts the dependency so the merge-site guard and the load-path sanitizer
share one predicate rather than two spellings of one rule. Pinned by a
property over a boundary-straddling probe set, which is what the existing
it.each tables cannot do: they assert a chosen value against both sides at
once, so a rule that drifted the same way on both would pass.

Behaviour-neutral by construction; sanitize-raid-patch.test.ts is the
control and is unedited.

Part of open-followups 405.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 3: The change sanitizer calls its own predicates (§405)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`acceptsChangeAmount`, `sanitizeChangeItem`)
- Test: `src/app/sanitize-records.test.ts`

Same inversion, on the pair the register measures as divergent. Still behaviour-neutral — the precision split lands in Task 7.

- [ ] **Step 1: Write the failing test**

Append to `src/app/sanitize-records.test.ts`:

```ts
describe("delegate-never-restate: the change sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = [0, 1, 1.5, -1, "2", "abc", "", true, false, null, undefined, [], NaN, Infinity];

  it.each(PROBES.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "stores scheduleImpactDays %s exactly when acceptsScheduleDays admits it",
    (_label, probe) => {
      const item = sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: probe });
      expect(item).not.toBeNull();
      expect("scheduleImpactDays" in item!).toBe(acceptsScheduleDays(probe));
    },
  );

  it.each(PROBES.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "stores costImpact %s exactly when acceptsCostAmount admits it",
    (_label, probe) => {
      const item = sanitizeChangeItem({ id: 1, title: "t", costImpact: probe });
      expect(item).not.toBeNull();
      expect("costImpact" in item!).toBe(acceptsCostAmount(probe));
    },
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "delegate-never-restate: the change" > "$SCRATCH/t3.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t3.log"
```

Expected: FAIL — `acceptsScheduleDays` and `acceptsCostAmount` do not exist.

- [ ] **Step 3: Split the one amount predicate into two named ones**

In `src/app/sanitize-records.ts`, replace `acceptsChangeAmount` with the pair. Keep today's behaviour exactly — Task 7 changes it:

```ts
/** The schedule-impact rule. Split from the cost rule in this commit because
 *  the two fields have DIFFERENT precision, which one shared `acceptsChangeAmount`
 *  could not express: `change-edit-modal.tsx` clamps days with `round: 0` and
 *  cost with `round: 2`. Tightened to integers in the commit that closes §399. */
export const acceptsScheduleDays: ChangeFieldGuard = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 0;
};

/** The cost-impact rule. Bounded in the commit that closes §399; today it is
 *  the historical predicate verbatim. */
export const acceptsCostAmount: ChangeFieldGuard = (v) => {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 0;
};
```

Update `CHANGE_FIELD_GUARDS`:

```ts
  scheduleImpactDays: acceptsScheduleDays,
  costImpact: acceptsCostAmount,
```

And in `sanitizeChangeItem`, replace:

```ts
  const days = toNumber(o.scheduleImpactDays); if (Number.isFinite(days) && days >= 0) item.scheduleImpactDays = days;
  const cost = toNumber(o.costImpact); if (Number.isFinite(cost) && cost >= 0) item.costImpact = cost;
```

with:

```ts
  if (acceptsScheduleDays(o.scheduleImpactDays)) item.scheduleImpactDays = toNumber(o.scheduleImpactDays);
  if (acceptsCostAmount(o.costImpact)) item.costImpact = toNumber(o.costImpact);
```

- [ ] **Step 4: Verify — new property plus the untouched controls**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/sanitize-change-patch.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > "$SCRATCH/t3b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t3b.log"
git diff --stat src/app/sanitize-change-patch.test.ts
```

Expected: EXIT=0 and an empty diffstat.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts -F - <<'MSG'
refactor(sanitize): the change sanitizer calls its own amount predicates

Splits acceptsChangeAmount into acceptsScheduleDays and acceptsCostAmount
and has sanitizeChangeItem call them. The split is not cosmetic: the two
fields have different precision in their own form control (round 0 vs
round 2), which one shared predicate cannot express.

Behaviour-neutral; both predicates are today's rule verbatim.

Part of open-followups 405.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 4: The milestone sanitizer calls its own date predicate (§405)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`sanitizeMilestone`)
- Test: `src/app/sanitize-records.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("delegate-never-restate: the milestone sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = ["2026-01-01", "not-a-date", "", "1899-01-01", 42, true, null, undefined, [], {}];

  it.each(PROBES.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "keeps achievedDate %s only when the stored value is a real date",
    (_label, probe) => {
      const m = sanitizeMilestone({ id: 1, name: "n", date: "2026-01-01", achievedDate: probe });
      expect(m).not.toBeNull();
      // The guard's clear-carve-out admits values the sanitizer stores nothing
      // for, so the two are NOT equivalent here — assert the sanitizer's own
      // rule and let acceptsPatchDate stay the guard's business.
      expect("achievedDate" in m!).toBe(sanitizeIsoDate(probe) !== "");
    },
  );
});
```

Note the asymmetry the assertion encodes: `acceptsPatchDate` deliberately admits `null`/`""`/`[]` as a disclosed CLEAR, and the sanitizer stores nothing for them. Asserting equivalence here would be wrong and would red on correct code.

- [ ] **Step 2: Run it and watch it fail or pass**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "delegate-never-restate: the milestone" > "$SCRATCH/t4.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t4.log"
```

Expected: PASS. This test pins today's behaviour before Step 3 refactors it. If it FAILS, stop — the sanitizer does not do what this plan believes and the rest of the task is void.

- [ ] **Step 3: Delegate**

In `sanitizeMilestone`, replace:

```ts
  const achievedDate = sanitizeIsoDate(o.achievedDate);
  if (achievedDate) m.achievedDate = achievedDate;
```

with the form that names the shared rule, keeping the carve-out explicit:

```ts
  // ★ `acceptsPatchDate` is the GUARD's rule and is deliberately WIDER than this
  //  one: it admits a rendered-clear (null/""/[]) because the card discloses
  //  those as a clear. The sanitizer stores a date or nothing, so it consults
  //  `sanitizeIsoDate` — the leg `acceptsPatchDate` itself delegates to. One
  //  parser, two policies, and the policies differ on purpose.
  const achievedDate = sanitizeIsoDate(o.achievedDate);
  if (achievedDate) m.achievedDate = achievedDate;
```

Then extend `MILESTONE_FIELD_GUARDS`' docstring to name `sanitizeIsoDate` as the shared leg. **The code is unchanged here** — this task's deliverable is the pinned property plus the comment that stops a future reader "completing the pattern" by making the two identical.

- [ ] **Step 4: Verify**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/sanitize-milestone-patch.test.ts > "$SCRATCH/t4b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t4b.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts -F - <<'MSG'
test(sanitize): pin the milestone date asymmetry the guard depends on

acceptsPatchDate is deliberately WIDER than the sanitizer's own rule: it
admits a rendered-clear because the card discloses one. Pins that as a
property and says so in both docstrings, so the next reader does not
"complete the pattern" by making the two identical, which would make the
card promise a clear the write declines.

Part of open-followups 405.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 5: The stakeholder sanitizer calls its own enum predicates (§405)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`STAKEHOLDER_FIELD_GUARDS`, `sanitizeStakeholder`)
- Test: `src/app/sanitize-records.test.ts`

This is the entity whose divergence was a live production defect — a stored "Sponsor" demoted to "Other" — so the delegation matters most here.

- [ ] **Step 1: Write the failing test**

```ts
describe("delegate-never-restate: the stakeholder sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = ["Sponsor", "Other", "Nonsense", "", 42, true, null, undefined, [], {}];

  it.each(PROBES.map((v) => [JSON.stringify(v) ?? String(v), v] as const))(
    "keeps category %s verbatim exactly when acceptsStakeholderCategory admits it",
    (_label, probe) => {
      const s = sanitizeStakeholder({ id: 1, name: "n", category: probe });
      expect(s).not.toBeNull();
      // A REFUSED value is reset to the hardcoded fallback, which is the defect
      // class the merge-site guard exists to stop. Assert the RESET, not a
      // missing key: this sanitizer always emits the field.
      expect(s!.category === probe).toBe(acceptsStakeholderCategory(probe));
    },
  );
});
```

★★ Note the fixture choice. `"Other"` is in the probe set on purpose and is the ONE value where a broken delegation still passes, because it equals the fallback. That is exactly the shape that hid the production defect for four tasks: a fixture sitting on the sanitizer's own fallback reads back unchanged whether the rule ran or not.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "delegate-never-restate: the stakeholder" > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t5.log"
```

Expected: FAIL — `acceptsStakeholderCategory` does not exist.

- [ ] **Step 3: Name the predicates and delegate**

In `src/app/sanitize-records.ts`, add above `STAKEHOLDER_FIELD_GUARDS`:

```ts
export const acceptsStakeholderCategory: StakeholderFieldGuard = (v) =>
  typeof v === "string" && STAKEHOLDER_CATEGORY_SET.has(v);
export const acceptsInfluenceInterest: StakeholderFieldGuard = (v) =>
  typeof v === "string" && INFLUENCE_INTEREST_SET.has(v);
```

Rewrite the table to reference them:

```ts
const STAKEHOLDER_FIELD_GUARDS: Readonly<Record<string, StakeholderFieldGuard>> = {
  category: acceptsStakeholderCategory,
  influence: acceptsInfluenceInterest,
  interest: acceptsInfluenceInterest,
};
```

And in `sanitizeStakeholder`:

```ts
  const category = acceptsStakeholderCategory(o.category) ? (o.category as StakeholderCategory) : "Other";
  const influence = acceptsInfluenceInterest(o.influence) ? (o.influence as InfluenceInterest) : "Medium";
  const interest = acceptsInfluenceInterest(o.interest) ? (o.interest as InfluenceInterest) : "Medium";
```

- [ ] **Step 4: Verify, including the write-path replay**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/sanitize-stakeholder-patch.test.ts src/app/inline-ai-edit/plan.write-path.test.ts > "$SCRATCH/t5b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t5b.log"
git diff --stat src/app/sanitize-stakeholder-patch.test.ts
```

Expected: EXIT=0, empty diffstat.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts -F - <<'MSG'
refactor(sanitize): the stakeholder sanitizer calls its own enum predicates

The entity whose two spellings were a live production defect: a stored
Sponsor demoted to Other by a replayed patch. One predicate now serves the
sanitizer and the merge-site guard.

The probe set deliberately includes "Other" — the one value where a broken
delegation still passes, because it equals the fallback. That is the shape
that hid the defect from four earlier tasks.

Part of open-followups 405.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 6: The preview consults the predicate, on the RAW value (§395)

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts` (`intRangeFields` → `numericFields`)
- Modify: `src/app/inline-ai-edit/plan.ts` (the range check)
- Modify: `src/app/sanitize-records.ts` (`acceptsRiskScale` refuses a boolean)
- Test: `src/app/inline-ai-edit/plan.test.ts`, `src/app/sanitize-records.test.ts`

**This is the structural heart of Layer 2.** Today the preview checks `Number(after)` where `after` is already a STRING, so the boolean-ness is gone by the time the guard runs: `numberPreview(true)` yields `"1"` and the card shows a risk score changing to 1. The writer stores the same fabricated 1. Both sides must consult one predicate against the RAW value.

- [ ] **Step 1: Write the failing tests**

In `src/app/sanitize-records.test.ts`:

```ts
it("refuses a boolean probability rather than storing a fabricated 1", () => {
  // toNumber(true) is 1, which is inside [1,5] — so the old rule stored a
  // plausible score that feeds riskSeverityFromMatrix. toNumber(false) is 0
  // and was already out of range.
  expect(acceptsRiskScale(true, "R")).toBe(false);
  expect(acceptsRiskScale(false, "R")).toBe(false);
  expect(acceptsRiskScale(3, "R")).toBe(true);
  expect(acceptsRiskScale("3", "R")).toBe(true);
});
```

In `src/app/inline-ai-edit/plan.test.ts`:

```ts
it("rejects a boolean probability in the preview, not merely in the writer", () => {
  const ws = makeWs({ raid: [{ id: 1, title: "R", category: "R", probability: 4 }] });
  const plan = describeEntityCalls(
    [{ toolName: "update_raid_item", input: { id: 1, probability: true } }],
    { descriptor: RAID_DESCRIPTOR, item: ws.raid[0], ws },
  );
  expect(plan.updates).toEqual([]);
  expect(plan.rejected).toEqual([
    { toolName: "update_raid_item", reason: "bad-input", detail: "probability=true" },
  ]);
});
```

Use the file's own existing helpers for `makeWs`, the descriptor import and the call shape — match the surrounding tests rather than this sketch's names if they differ.

- [ ] **Step 2: Run and watch both fail**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "fabricated" src/app/inline-ai-edit/plan.test.ts -t "boolean probability" > "$SCRATCH/t6.log" 2>&1; echo "EXIT=$?"; tail -40 "$SCRATCH/t6.log"
```

Expected: FAIL. The plan test fails showing an `updates` entry with `after: "1"` — the fabrication, rendered.

- [ ] **Step 3: Refuse the boolean in the shared predicate**

In `src/app/sanitize-records.ts`:

```ts
export const acceptsRiskScale: RaidFieldGuard = (v) => {
  // ★★★ THE BOOLEAN LEG IS THE DEFECT (open-followups §395). `toNumber(true)`
  //  is 1 — inside [1,5] — so a boolean stored a plausible-looking score that
  //  feeds `riskSeverityFromMatrix`, and the PREVIEW coerced identically and
  //  showed it as accepted, which is why it never appeared as a divergence.
  //  `toNumber(false)` is 0 and was already out of range, so only one half of
  //  the boolean pair was ever reachable.
  if (typeof v === "boolean") return false;
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 1 && n <= 5;
};
```

- [ ] **Step 4: Give the descriptor a predicate instead of a tuple**

In `src/app/inline-ai-edit/entity-descriptor.ts`, replace the field declaration:

```ts
  intRangeFields: Record<string, [number, number]>;
```

with:

```ts
  /** Numeric fields → the WRITER's own acceptance predicate, applied to the RAW
   *  model value.
   *
   *  ★★★ RAW, NOT THE RENDERED STRING, AND THAT IS THE WHOLE CHANGE. The old
   *  `intRangeFields` tuple was checked against `Number(after)`, and `after` has
   *  already been through `numberPreview` — so `true` arrived as `"1"` and the
   *  boolean-ness the writer needed to refuse was gone (§395). A predicate over
   *  the raw value is the only shape that can see it.
   *
   *  ★★ The predicate is IMPORTED from `sanitize-records.ts`, never re-spelled
   *  here. That is §405's rule reaching the preview: one function, consulted by
   *  the card and by the write. */
  numericFields: Record<string, (v: unknown) => boolean>;
```

Update the six descriptors. Raid:

```ts
    numericFields: { probability: (v) => acceptsRiskScale(v, "R"), impact: (v) => acceptsRiskScale(v, "R") },
```

★ The category argument is ignored by `acceptsRiskScale` — pass any member so the closure typechecks; the risk scale is category-independent and the docstring on `RaidFieldGuard` says so.

Change:

```ts
    numericFields: { scheduleImpactDays: acceptsScheduleDays, costImpact: acceptsCostAmount },
```

The other four entities keep `numericFields: {}`.

- [ ] **Step 5: Consult it in the plan builder**

In `src/app/inline-ai-edit/plan.ts`, replace:

```ts
        const range = d.intRangeFields[f];
        if (range) {
          const n = Number(after);
          if (!Number.isInteger(n) || n < range[0] || n > range[1]) { bad(`${f}=${after}`); continue; }
        }
```

with:

```ts
        // ★★★ THE RAW VALUE, NEVER `after`. `after` has been through
        //  `numberPreview`, which renders `true` as "1" — so checking the
        //  rendered string cannot see a boolean, and the card showed a
        //  fabricated risk score of 1 as an accepted change (§395). The
        //  predicate is the WRITER's own, imported rather than restated (§405),
        //  so the two cannot disagree about what lands.
        const accepts = d.numericFields[f];
        if (accepts && !accepts(input[f])) { bad(`${f}=${after}`); continue; }
```

- [ ] **Step 6: Verify, wide enough to catch the descriptor rename**

```bash
npx vitest run src/app/inline-ai-edit src/app/sanitize-records.test.ts src/app/sanitize-raid-patch.test.ts > "$SCRATCH/t6b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t6b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0. tsc is the gate that finds every remaining `intRangeFields` reference.

- [ ] **Step 7: Mutation-prove the raw-value plumbing**

Revert the predicate call to the rendered string and confirm the plan test reds:

```bash
# temporary mutant: check `after` instead of the raw input
# (apply by hand, run, then revert by hand — never `git checkout --`, which is deny-blocked)
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "boolean probability" > "$SCRATCH/t6m.log" 2>&1; echo "EXIT=$?"
```

Expected: the mutant run EXITs non-zero. Record the result as `N failed / M passed`. Revert with an inverse anchored edit and prove the tree is clean:

```bash
git diff --stat
```

Expected: only the files this task intends to change.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts -F - <<'MSG'
fix(raid): stop a boolean storing a fabricated risk score of 1

toNumber(true) is 1, inside [1,5], so update_raid_item({probability:true})
stored a plausible score that feeds riskSeverityFromMatrix — and the preview
coerced identically and showed it as accepted, which is why it never
appeared in the list of preview/apply divergences.

The structural half: intRangeFields becomes numericFields, a per-field
predicate imported from the writer and applied to the RAW model value. The
old tuple was checked against the RENDERED string, where numberPreview had
already turned true into "1", so no rule expressed there could ever have
seen a boolean.

Closes open-followups 395.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 7: Each change amount gets its own precision (§399)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`acceptsScheduleDays`, `acceptsCostAmount`)
- Test: `src/app/sanitize-records.test.ts`, `src/app/inline-ai-edit/plan.test.ts`

**The two halves move in opposite directions**, which is the correction recorded in the spec. `change-edit-modal.tsx` clamps days with `round: 0` and cost with `round: 2, max: AMOUNT_MAX`. So the writer tightens for days, and the preview loosens for cost — and the cost predicate also gains the upper bound neither side had.

> **★★★ CORRECTED DURING EXECUTION — do not restore the original wording.** This
> task shipped saying "the form cannot produce a fraction", and that was FALSE:
> `describeClamp` ran only in `onBlur`, Enter submits without firing blur, and
> `handleSubmit` re-capped the three text fields while both number fields came
> off the `...draft` spread unclamped. The form was minting fractional days and
> over-cap costs until commit `555ee966` fixed it. Two consequences: the "opposite
> directions" framing is true only against §399 **as filed** — against the code
> this task actually edits, cost tightens exactly as days do — and because the
> at-risk population of stored values was real rather than empty, the loader now
> REPAIRS an out-of-precision or over-cap amount instead of dropping it
> (`867fbe13`). Acceptance and repair are deliberately different questions.

- [ ] **Step 1: Write the failing tests**

In `src/app/sanitize-records.test.ts`:

```ts
describe("change amount precision follows each field's own form control", () => {
  it("refuses a fractional schedule-impact day, which the form no longer produces", () => {
    expect(acceptsScheduleDays(1.5)).toBe(false);
    expect(acceptsScheduleDays(2)).toBe(true);
    expect(acceptsScheduleDays(0)).toBe(true);
  });

  it("accepts a two-decimal cost, which round:2 does produce", () => {
    expect(acceptsCostAmount(1500.5)).toBe(true);
    expect(acceptsCostAmount(1500.55)).toBe(true);
  });

  it("refuses a cost with more precision than the form can express", () => {
    expect(acceptsCostAmount(1500.555)).toBe(false);
  });

  it("refuses a cost above the cap the form clamps to", () => {
    // Neither the sanitizer nor the preview had an upper bound, so a model
    // could store a cost a thousand times larger than the form permits.
    expect(acceptsCostAmount(AMOUNT_MAX)).toBe(true);
    expect(acceptsCostAmount(AMOUNT_MAX + 1)).toBe(false);
  });

  it("refuses a boolean on both, for the same reason as the risk scale", () => {
    expect(acceptsScheduleDays(true)).toBe(false);
    expect(acceptsCostAmount(true)).toBe(false);
  });
});
```

In `src/app/inline-ai-edit/plan.test.ts`, pin the preview side of the cost loosening:

```ts
it("previews a two-decimal cost as an accepted change, matching the write", () => {
  const ws = makeWs({ changes: [{ id: 1, title: "C", costImpact: 100 }] });
  const plan = describeEntityCalls(
    [{ toolName: "update_change", input: { id: 1, costImpact: 1500.5 } }],
    { descriptor: CHANGE_DESCRIPTOR, item: ws.changes[0], ws },
  );
  expect(plan.rejected).toEqual([]);
  expect(plan.updates).toEqual([{ field: "costImpact", before: "100", after: "1500.5", raw: "1500.5" }]);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "precision follows" src/app/inline-ai-edit/plan.test.ts -t "two-decimal cost" > "$SCRATCH/t7.log" 2>&1; echo "EXIT=$?"; tail -40 "$SCRATCH/t7.log"
```

Expected: FAIL on the fractional day (today accepted), the over-precise cost (today accepted), the cap (today unbounded), and the booleans.

- [ ] **Step 3: Implement both predicates**

In `src/app/sanitize-records.ts`, import `AMOUNT_MAX` from `./sanitize-entities` alongside the existing `BUDGET_NAME_MAX` and `sanitizeIdList`, then:

```ts
/** Reject a boolean before coercing. Shared by every numeric predicate here.
 *  `toNumber(true)` is 1 and `toNumber(false)` is 0, both of which several
 *  ranges admit, so a boolean silently becomes a plausible number (§395). */
const isCoercibleNumber = (v: unknown): v is number | string => typeof v !== "boolean";

/** Schedule impact, in DAYS. Integer because `change-edit-modal.tsx` clamps this
 *  field with `describeClamp(value, { min: 0, round: 0 })` — the form cannot
 *  produce a fraction, and the preview already demanded an integer, so the
 *  writer was the side that disagreed (§399). */
export const acceptsScheduleDays: ChangeFieldGuard = (v) => {
  if (!isCoercibleNumber(v)) return false;
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 0;
};

/** Cost impact, in CURRENCY. Two decimals and capped, because the same modal
 *  clamps this one with `{ min: 0, max: AMOUNT_MAX, round: 2 }`.
 *
 *  ★★★ THE TWO AMOUNT FIELDS DO NOT SHARE A RULE, and reading them as a pair is
 *  the mistake this docstring exists to stop. They were one `acceptsChangeAmount`
 *  and the plan that split them originally said "a change amount must be an
 *  integer" — true of days, false of money, and the form refutes it.
 *
 *  ★★ The CAP was not in §399 as filed. Neither side had an upper bound while
 *  the form clamps at AMOUNT_MAX, so a model could store a cost a thousand times
 *  larger than a person can type. Same predicate, same edit, same field. */
export const acceptsCostAmount: ChangeFieldGuard = (v) => {
  if (!isCoercibleNumber(v)) return false;
  const n = toNumber(v);
  if (!Number.isFinite(n) || n < 0 || n > AMOUNT_MAX) return false;
  return Math.round(n * 100) === n * 100 || Number.isInteger(Math.round(n * 100) / 100 - n) === false
    ? Math.abs(Math.round(n * 100) / 100 - n) < Number.EPSILON * Math.max(1, Math.abs(n))
    : true;
};
```

★★ That last expression is deliberately not `n === Math.round(n * 100) / 100`: binary floating point makes that false for values a `round: 2` form legitimately produces. Simplify to the tolerance form and keep only it:

```ts
export const acceptsCostAmount: ChangeFieldGuard = (v) => {
  if (!isCoercibleNumber(v)) return false;
  const n = toNumber(v);
  if (!Number.isFinite(n) || n < 0 || n > AMOUNT_MAX) return false;
  // Two decimals, compared with a tolerance: `1500.55 !== Math.round(1500.55 *
  // 100) / 100` in binary floating point, so an exact comparison would refuse
  // a value the form itself produces.
  return Math.abs(Math.round(n * 100) / 100 - n) < Number.EPSILON * Math.max(1, Math.abs(n));
};
```

Use the second form. Delete the first.

- [ ] **Step 4: Verify**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/sanitize-change-patch.test.ts src/app/inline-ai-edit > "$SCRATCH/t7b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t7b.log"
```

Expected: EXIT=0. If `sanitize-change-patch.test.ts` reds, read the row: a test asserting `1.5` is accepted was pinning the defect and should be flipped with a comment naming §399. A test asserting a large cost is accepted is pinning the missing cap and should be flipped the same way.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts src/app/sanitize-change-patch.test.ts src/app/inline-ai-edit/plan.test.ts -F - <<'MSG'
fix(change): give each amount the precision its own form control produces

scheduleImpactDays tightens to an integer (the writer was the side that
disagreed); costImpact loosens to two decimals in the preview (the preview
was). The two move in OPPOSITE directions, which one shared
"amounts are integers" rule got wrong for money.

Also caps cost at AMOUNT_MAX. Neither side had an upper bound while the form
clamps at one, so a model could store a cost a thousand times larger than a
person can type. Not in 399 as filed; same predicate, same edit, same field.

Closes open-followups 399.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 8: A non-string no longer clears a milestone's rich text (§398)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`MILESTONE_FIELD_GUARDS`)
- Modify: `src/app/inline-ai-edit/plan.ts` or the milestone descriptor (the preview refusal)
- Test: `src/app/sanitize-milestone-patch.test.ts`, `src/app/inline-ai-edit/plan.test.ts`

Both sides move together, which is why this was filed rather than patched: guarding the writer alone would make the write keep a value the card says is changing.

- [ ] **Step 1: Write the failing tests**

In `src/app/sanitize-milestone-patch.test.ts`:

```ts
it("leaves a stored description alone when the patch value is not a string", () => {
  const stored = { id: 1, name: "M", date: "2026-01-01", description: "<p>kept</p>" };
  const patch = dropUnacceptedMilestoneFields({ description: true });
  expect("description" in patch).toBe(false);
  const merged = sanitizeMilestone({ ...stored, ...patch });
  expect(merged!.description).toBe("<p>kept</p>");
});
```

In `src/app/inline-ai-edit/plan.test.ts`:

```ts
it("refuses a non-string milestone description instead of projecting one", () => {
  const ws = makeWs({ milestones: [{ id: 1, name: "M", date: "2026-01-01", description: "<p>kept</p>" }] });
  const plan = describeEntityCalls(
    [{ toolName: "update_milestone", input: { id: 1, description: true } }],
    { descriptor: MILESTONE_DESCRIPTOR, item: ws.milestones[0], ws },
  );
  expect(plan.updates).toEqual([]);
  expect(plan.rejected).toEqual([
    { toolName: "update_milestone", reason: "bad-input", detail: "description=true" },
  ]);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/sanitize-milestone-patch.test.ts -t "not a string" src/app/inline-ai-edit/plan.test.ts -t "non-string milestone description" > "$SCRATCH/t8.log" 2>&1; echo "EXIT=$?"; tail -40 "$SCRATCH/t8.log"
```

Expected: FAIL both — the writer clears the field, the preview projects `"true"` as the new value.

- [ ] **Step 3: Guard the writer**

Add to `MILESTONE_FIELD_GUARDS`:

```ts
  // ★★ ADDED WITH ITS PREVIEW HALF, NEVER ALONE. `sanitizeRichText` returns ""
  //  for a non-string and `if (description)` then omits the key, so the rebuilt
  //  record LOSES the stored rich text. This was deliberately left out of the
  //  first cut of this table because the preview PROJECTED a non-string rather
  //  than refusing it, and guarding only here would have made the write keep a
  //  value the card said was changing — this slice's own defect, pointing the
  //  other way (§398). The preview refusal lands in the same commit.
  description: (v) => typeof v === "string",
```

and delete the `description` bullet from the docstring's "NOT IN THE TABLE, deliberately" list, since it now is.

- [ ] **Step 4: Refuse it in the preview**

Add `description` to the milestone descriptor's rich-field refusal set. If the descriptor has no such member, add one beside `numericFields`:

```ts
  /** Fields whose model value must be a STRING to be previewable at all. A
   *  non-string is REFUSED rather than projected, because the writer's
   *  `sanitizeRichText` drops the key and the merge-site guard now keeps the
   *  stored value — so projecting one would promise a change that will not
   *  happen (§398). */
  stringOnlyFields: Set<string>;
```

with `stringOnlyFields: new Set(["description"])` on the milestone descriptor and `new Set()` on the other five, and in `plan.ts`, immediately before the `numericFields` check:

```ts
        if (d.stringOnlyFields.has(f) && typeof input[f] !== "string") { bad(`${f}=${after}`); continue; }
```

- [ ] **Step 5: Verify**

```bash
npx vitest run src/app/sanitize-milestone-patch.test.ts src/app/inline-ai-edit src/app/sanitize-records.test.ts > "$SCRATCH/t8b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t8b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-milestone-patch.test.ts src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts -F - <<'MSG'
fix(milestone): a non-string no longer clears a stored description

sanitizeRichText returns "" for a non-string and the conditional assign then
omits the key, so the rebuilt record lost the stored rich text.

Both sides move in this commit and that is the point: guarding the writer
alone would have made the write keep a value the card said was changing,
which is the same defect pointing the other way. The preview now refuses a
non-string rich field rather than projecting one.

Closes open-followups 398.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 9: A blank `lastUpdateDate` clears the field (§396)

**Files:**
- Modify: `src/app/chat-task-patch.ts` (`buildTaskCleanPatch`)
- Test: `src/app/chat-task-patch.test.ts`

The user's decision: align the task path with the registers, whose full-record sanitizers clear theirs. The preview already shows a clear, so this is a writer-side change that makes the card true.

★ `dueDate`'s throw-on-blank is a DIFFERENT rule and is deliberately untouched.

- [ ] **Step 1: Write the failing test**

```ts
it("clears lastUpdateDate on a blank, matching what the preview already promises", () => {
  // The patch is merged over the stored task, so DROPPING the key left the
  // stored value in place while the card showed a clear (§396). The registers
  // all clear theirs; the task path was the outlier.
  const existing = { id: 1, taskName: "T", lastUpdateDate: "2026-01-01" } as Task;
  const patch = buildTaskCleanPatch({ lastUpdateDate: "" }, existing);
  expect(patch.lastUpdateDate).toBe("");
});

it("still refuses a malformed lastUpdateDate rather than clearing it", () => {
  const existing = { id: 1, taskName: "T", lastUpdateDate: "2026-01-01" } as Task;
  const patch = buildTaskCleanPatch({ lastUpdateDate: "not-a-date" }, existing);
  expect("lastUpdateDate" in patch).toBe(false);
});
```

Match the file's existing helper for building `existing` if it has one.

- [ ] **Step 2: Run and watch the first fail**

```bash
npx vitest run src/app/chat-task-patch.test.ts -t "lastUpdateDate" > "$SCRATCH/t9.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t9.log"
```

Expected: FAIL — `patch.lastUpdateDate` is `undefined`, because the key is dropped.

- [ ] **Step 3: Distinguish a blank from a malformed value**

In `src/app/chat-task-patch.ts`, replace:

```ts
  if (patch.lastUpdateDate !== undefined) {
    const d = sanitizeIsoDate(patch.lastUpdateDate);
    if (d) cleanPatch.lastUpdateDate = d;
  }
```

with:

```ts
  if (patch.lastUpdateDate !== undefined) {
    // ★★ THREE OUTCOMES, NOT TWO (§396). A BLANK is an intended CLEAR and is
    //  written as "": the preview renders `str(null)`/`str("")` as "" and
    //  discloses it to the user as a clear, and every register's full-record
    //  sanitizer clears theirs — the task path was the one that merely dropped
    //  the key, leaving the stored value against a card promising otherwise.
    //  A MALFORMED value is still refused (key dropped, stored value kept),
    //  which is the merge-site guards' rule. A VALID date is stored.
    //  ★ `dueDate` above THROWS on a blank instead; that is a different rule,
    //  it is what `requiredNonEmpty` means for that field, and it stays.
    const raw = patch.lastUpdateDate;
    const rendersAsClear = raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0);
    if (rendersAsClear) cleanPatch.lastUpdateDate = "";
    else {
      const d = sanitizeIsoDate(raw);
      if (d) cleanPatch.lastUpdateDate = d;
    }
  }
```

- [ ] **Step 4: Verify, including the write-path replay**

```bash
npx vitest run src/app/chat-task-patch.test.ts src/app/inline-ai-edit/plan.write-path.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > "$SCRATCH/t9b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t9b.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/chat-task-patch.ts src/app/chat-task-patch.test.ts -F - <<'MSG'
fix(task): a blank lastUpdateDate clears the field the card says it clears

The patch is merged over the stored task, so dropping the key left the
stored value in place while the preview showed a clear. Every register's
full-record sanitizer clears theirs; the task path was the outlier.

Three outcomes now, not two: a blank clears, a malformed value is refused
and keeps the stored one, a valid date is stored. dueDate's throw-on-blank
is a different rule and is untouched.

Closes open-followups 396.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 10: A rejection-only inline plan gets its own phase (§392)

**Files:**
- Modify: `src/app/use-inline-entity-edit.ts` (`InlinePhase`, the submit route)
- Modify: `src/app/inline-ai-edit-popover.tsx` (render the new phase)
- Test: `src/app/use-inline-entity-edit.test.ts`, `src/app/inline-ai-edit-popover.test.tsx`

`isEmptyPlan` counts `updates`/`creates`/`deletes`/`links` and not `rejected`, so a plan whose only content is a refusal routes to `clarify` and shows "no changes" instead of naming the refused field.

★★ Routing it to `preview` is NOT the fix: `apply()` also rejects an empty plan, so the user would get a live Apply button that no-ops. The new phase has no Apply button.

- [ ] **Step 1: Write the failing tests**

In `src/app/use-inline-entity-edit.test.ts`:

```ts
it("routes a rejection-only plan to the rejected phase, not to clarify", async () => {
  // The model understood and the writer will not take it — a different thing
  // from "the model needs more from you", which is what clarify means.
  const { result } = renderInlineEdit({
    planFor: () => ({ updates: [], creates: [], deletes: [], links: [], rejected: [
      { toolName: "update_raid_item", reason: "bad-input", detail: "probability=9" },
    ] }),
  });
  await act(() => result.current.submit("set probability to 9"));
  expect(result.current.phase).toBe("rejected");
  expect(result.current.plan?.rejected).toHaveLength(1);
});

it("still routes a wholly empty plan to clarify", async () => {
  const { result } = renderInlineEdit({
    planFor: () => ({ updates: [], creates: [], deletes: [], links: [], rejected: [] }),
  });
  await act(() => result.current.submit("do nothing"));
  expect(result.current.phase).toBe("clarify");
});
```

Use the file's own render helper and mock shape.

In `src/app/inline-ai-edit-popover.test.tsx`:

```ts
it("names the refused field and offers no Apply in the rejected phase", () => {
  render(<InlineAiEditPopover {...baseProps} phase="rejected" plan={{
    updates: [], creates: [], deletes: [], links: [],
    rejected: [{ toolName: "update_raid_item", reason: "bad-input", detail: "probability=9" }],
  }} />);
  expect(screen.getByText(/probability=9/)).toBeInTheDocument();
  // The trap this phase exists to avoid: apply() rejects an empty plan, so an
  // Apply button here would be live and would no-op.
  expect(screen.queryByRole("button", { name: t("en-US", "inlineAiEditApply") })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/use-inline-entity-edit.test.ts -t "rejection-only" src/app/inline-ai-edit-popover.test.tsx -t "rejected phase" > "$SCRATCH/t10.log" 2>&1; echo "EXIT=$?"; tail -40 "$SCRATCH/t10.log"
```

Expected: FAIL — phase is `"clarify"`, and the popover renders nothing for an unknown phase.

- [ ] **Step 3: Add the phase and route to it**

In `src/app/use-inline-entity-edit.ts`:

```ts
export type InlinePhase = "idle" | "thinking" | "preview" | "clarify" | "rejected" | "applying" | "error";
```

and replace the submit route:

```ts
      if (isEmptyPlan(next)) { setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges")); setPhase("clarify"); return; }
```

with:

```ts
      // ★★★ A REFUSAL IS NOT "NO CHANGES" (§392). `isEmptyPlan` counts what the
      //  plan would WRITE and deliberately does not count `rejected`, so a plan
      //  whose only content is a refusal is empty by that predicate and used to
      //  route here — telling the user nothing changed, when in fact the model
      //  understood and the writer refused a named field.
      //  ★★ Routing it to "preview" instead is NOT the fix and was measured as
      //  worse: `apply()` also rejects an empty plan, so the user would get a
      //  live Apply button that no-ops. "rejected" renders the reasons and
      //  offers no Apply.
      if (isEmptyPlan(next)) {
        if (next.rejected.length > 0) { setPlan(next); setPhase("rejected"); return; }
        setClarifyText(text || t(deps.lang, "inlineAiEditNoChanges")); setPhase("clarify"); return;
      }
```

- [ ] **Step 4: Render it**

In `src/app/inline-ai-edit-popover.tsx`, add after the `clarify` block:

```tsx
        {phase === "rejected" && plan && (
          <div className="mt-1">
            <p className="mb-2 text-xs font-medium text-foreground">{t(lang, "inlineAiEditRejectedOnly")}</p>
            <ul className="mb-3 space-y-1 text-xs">
              {plan.rejected.map((r, i) => (<li key={`r${i}`} className="text-ui-pink-strong">{t(lang, "inlineAiEditRejected", r.detail)}</li>))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onCancel}>{t(lang, "close")}</Button>
            </div>
          </div>
        )}
```

Then update the comment inside the `preview` block that says a rejection-only plan "never reaches `phase === "preview"` … That is a defect one layer up" — it is now fixed, and leaving the comment makes a closed defect read as open.

- [ ] **Step 5: Add the one new i18n key**

Add `inlineAiEditRejectedOnly` to `src/app/i18n.ts`:

```ts
  inlineAiEditRejectedOnly: "Nothing was applied — these values were refused:",
```

For `src/app/i18n.de.ts`, **do not use Edit or Write**. Write a script to `$SCRATCH/i18n-de-rejected-only.mjs` with the `Write` tool and run it with node:

```js
import { readFileSync, writeFileSync } from "node:fs";
const F = "C:/Projects/aipm-wt-a/src/app/i18n.de.ts";
const s = readFileSync(F, "utf8");
const anchor = "  inlineAiEditRejected:";
if (s.split(anchor).length - 1 !== 1) { console.error("anchor not unique"); process.exit(1); }
const line = '  inlineAiEditRejectedOnly: "Nichts wurde \u00fcbernommen \u2014 diese Werte wurden abgelehnt:",\r\n';
// Real umlauts in the FILE; the escape above is only so this script is ASCII-safe.
const out = s.replace(anchor, line.replace("\\u00fc", "\u00fc") + anchor);
if (out === s) { console.error("no replacement"); process.exit(1); }
writeFileSync(F, out, "utf8");
console.log("added inlineAiEditRejectedOnly");
```

★★ The DE file is CRLF, so the inserted line MUST end `\r\n`. The `i18n-encoding` test bans ASCII substitutions (`ue` for `ü`) and bans `\uXXXX` escapes surviving into the file — write the real character.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/app/use-inline-entity-edit.test.ts src/app/inline-ai-edit-popover.test.tsx src/app/i18n-encoding.test.ts > "$SCRATCH/t10b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t10b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
git ls-files --eol src/app/i18n.de.ts
```

Expected: EXIT=0, TSC_EXIT=0, and `i/lf w/crlf` for the DE file. `i/lf w/lf` means it was re-lined — recover it before committing.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/use-inline-entity-edit.ts src/app/use-inline-entity-edit.test.ts src/app/inline-ai-edit-popover.tsx src/app/inline-ai-edit-popover.test.tsx src/app/i18n.ts src/app/i18n.de.ts -F - <<'MSG'
fix(inline-ai-edit): a refusal is no longer reported as "no changes"

isEmptyPlan counts what a plan would WRITE and deliberately does not count
rejected, so a plan whose only content is a refusal was empty by that
predicate and routed to clarify — telling the user nothing changed when the
model had understood and the writer had refused a named field.

A seventh phase rather than a reuse of preview: apply() also rejects an
empty plan, so a preview route would give a live Apply button that no-ops.

Closes open-followups 392.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 11: A wholly-refused dependency proposal says why (§404)

**Files:**
- Modify: `src/app/chat-proposal-describe.ts` (the `set_task_dependencies` describer)
- Test: `src/app/chat-proposal-describe.test.ts`

`resolveDependencyWrite` already returns `rejected: { taskId, type, reason }[]` — the describer calls it, uses `applied`, and discards `rejected`.

- [ ] **Step 1: Write the failing test**

Replace the existing test named "shows no change when every proposed link is refused" — it pins the defect. Keep its name findable by adding the new one adjacent:

```ts
it("names every refused dependency instead of showing an empty card", () => {
  const tasks = [{ id: 1, taskName: "A" }, { id: 2, taskName: "B" }] as Task[];
  const plan = describeProposedCall(
    { toolName: "set_task_dependencies", input: { id: 1, dependencies: [
      { taskId: 1, type: "FS" },   // self-link
      { taskId: 99, type: "FS" },  // unknown id
    ] } },
    { tasks },
  );
  expect(plan.links).toEqual([]);
  expect(plan.rejected).toEqual([
    { toolName: "set_task_dependencies", reason: "bad-input", detail: "1:FS=self" },
    { toolName: "set_task_dependencies", reason: "bad-input", detail: "99:FS=unknown" },
  ]);
});
```

Match `describeProposedCall`'s real signature and the resolver's real `reason` strings — read them from `task-dependency-write.ts`'s `DependencyWriteResult` before writing the expectation, and use those spellings verbatim rather than the ones sketched here.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/chat-proposal-describe.test.ts -t "refused dependency" > "$SCRATCH/t11.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t11.log"
```

Expected: FAIL — `plan.rejected` is `[]`.

- [ ] **Step 3: Carry the resolver's refusals into the plan**

In the `set_task_dependencies` branch of `src/app/chat-proposal-describe.ts`, after the existing `resolveDependencyWrite` call:

```ts
  // ★★ THE RESOLVER ALREADY COMPUTED THESE and they were dropped on the floor
  //  (§404). Previewing only what WOULD land is correct — that is why a
  //  self-link or a cycle is not shown as a change — but a proposal whose links
  //  are ALL refused then rendered an empty card with no reason, which is §392's
  //  shape on this surface.
  //  ★ `detail` is `${taskId}:${type}=${reason}` rather than prose: this module
  //  is i18n-free by construction, and the renderer is what translates.
  for (const r of result.rejected) {
    plan.rejected.push({ toolName, reason: "bad-input", detail: `${r.taskId}:${r.type}=${r.reason}` });
  }
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/app/chat-proposal-describe.test.ts > "$SCRATCH/t11b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t11b.log"
```

Expected: EXIT=0. The old "shows no change when every proposed link is refused" test now also asserts the reasons; update its body rather than deleting it, and add a comment saying it was flipped from pinning the gap.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/chat-proposal-describe.ts src/app/chat-proposal-describe.test.ts -F - <<'MSG'
fix(chat): a wholly-refused dependency proposal now says why

resolveDependencyWrite already returns per-entry refusals — self-link,
unknown id, duplicate, cap, cycle — and the describer used `applied` and
dropped `rejected`. A proposal whose links were all refused therefore
rendered an empty card with no reason, which is 392's shape on this surface.

Closes open-followups 404.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 12: The inline CREATE path previews its link fields (§390)

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts` (the `CREATE_TOOLS` branch)
- Test: `src/app/inline-ai-edit/plan.test.ts`

`plan.creates.push({ entity, title, toolName, input })` forwards the model's raw input to `runTool`, so an inline `create_raid_item({title, linkedTaskIds})` writes those links while the card shows only the title.

★ Lower severity than the update case and the code should say so: a create has no prior row, so it cannot DROP existing links. The exposure is an undisclosed write, not an undisclosed destruction.

- [ ] **Step 1: Write the failing test**

```ts
it("discloses the links an inline create would write", () => {
  const ws = makeWs({ tasks: [{ id: 7, taskName: "Kickoff" }] });
  const plan = describeEntityCalls(
    [{ toolName: "create_raid_item", input: { title: "New risk", category: "R", linkedTaskIds: [7] } }],
    { descriptor: RAID_DESCRIPTOR, item: null, ws },
  );
  expect(plan.creates).toHaveLength(1);
  // Resolved TITLES, exactly as the update path renders them — a raw id on the
  // card is not a disclosure.
  expect(plan.links).toEqual([
    { field: "linkedTaskIds", before: "", after: "Kickoff", rawIds: [7] },
  ]);
});
```

Match `LinkDiff`'s real property names by reading its declaration in `plan.ts` first.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "inline create would write" > "$SCRATCH/t12.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t12.log"
```

Expected: FAIL — `plan.links` is `[]`.

- [ ] **Step 3: Project the create's links**

In the `if (name in CREATE_TOOLS)` branch of `plan.ts`, before the `plan.creates.push`, run the same link projection the update branch uses, with an empty `before` because there is no prior row. Extract the update branch's projection into a local helper rather than copying it — a second spelling here is the exact defect Layer 1 just removed.

```ts
    if (name in CREATE_TOOLS) {
      const entity = CREATE_TOOLS[name];
      // ★★ A CREATE WRITES LINKS TOO (§390). `plan.creates` carries the model's
      //  input verbatim to `runTool`, so these land whether or not the card
      //  mentions them.
      //  ★ Lower severity than the update case, deliberately stated: a create
      //  has no prior row, so it cannot DROP existing links. Undisclosed write,
      //  not undisclosed destruction — `before` is always "".
      pushLinkDiffs(plan, descriptorFor(entity), input, {}, name);
      plan.creates.push({ entity, title: titleOf(entity, input), toolName: name, input });
      continue;
    }
```

`pushLinkDiffs` is the helper extracted from the update branch; give it the signature `(plan, d, input, item, toolName)` and have the update branch call it too, so both paths share one projection.

- [ ] **Step 4: Verify — both paths, since the update branch was refactored**

```bash
npx vitest run src/app/inline-ai-edit src/app/use-inline-entity-edit.test.ts > "$SCRATCH/t12b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t12b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0. **A red in the UPDATE link tests means the extraction changed the update path** — that is the risk of this task and the reason both suites run.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts -F - <<'MSG'
fix(inline-ai-edit): the create path discloses the links it writes

plan.creates carries the model's input verbatim to runTool, so an inline
create_raid_item({linkedTaskIds}) wrote those links while the card showed
only the new row's title.

Lower severity than the update case and the comment says so: a create has no
prior row, so it cannot drop existing links. Undisclosed write, not
undisclosed destruction.

The projection is EXTRACTED and shared with the update branch rather than
copied — a second spelling here is the defect class layer 1 just removed.

Closes open-followups 390.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 13: The dependency card label is translated (§406)

**Files:**
- Modify: `src/app/chat-proposal-describe.ts` (the label becomes structured)
- Modify: the renderer that calls `fieldLabel` for a `LinkDiff`
- Test: `src/app/chat-proposal-describe.test.ts`, the renderer's test

The describer builds `` `${title} dependencies` `` and it reaches the card through `fieldLabel(lang, undefined, field)` verbatim, so a German user reads "Kickoff vorbereiten dependencies".

★ `chat-proposal-describe.ts` is i18n-free by construction and takes no `lang`. Passing one in would put `t()` into a module whose purity is deliberate — so the label becomes data the renderer translates.

- [ ] **Step 1: Write the failing test**

```ts
it("emits a structured dependency label rather than an English string", () => {
  const plan = describeProposedCall(
    { toolName: "set_task_dependencies", input: { id: 1, dependencies: [{ taskId: 2, type: "FS" }] } },
    { tasks: [{ id: 1, taskName: "Kickoff" }, { id: 2, taskName: "B" }] as Task[] },
  );
  // The module is i18n-free by construction, so it emits the PARTS and the
  // renderer translates. A German user was reading "Kickoff dependencies".
  expect(plan.links[0].field).toBe("dependencies");
  expect(plan.links[0].subject).toBe("Kickoff");
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/chat-proposal-describe.test.ts -t "structured dependency label" > "$SCRATCH/t13.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t13.log"
```

Expected: FAIL — `field` is `"Kickoff dependencies"` and `subject` does not exist.

- [ ] **Step 3: Add the optional subject to `LinkDiff`**

In `src/app/inline-ai-edit/plan.ts`, extend the interface:

```ts
/** ★ `subject` names the ROW a field belongs to, for the one case where the
 *  field label alone is ambiguous: `set_task_dependencies` rewrites one task's
 *  whole predecessor list, so the card has to say WHOSE. It is data rather than
 *  a built string because `chat-proposal-describe.ts` is i18n-free by
 *  construction — the renderer composes and translates (§406). */
subject?: string;
```

In the describer, emit `{ field: "dependencies", subject: task.taskName, ... }` instead of the template literal.

- [ ] **Step 4: Compose it in the renderer**

Where the card renders a `LinkDiff` label, replace `fieldLabel(lang, entity, l.field)` with:

```tsx
{l.subject ? `${l.subject} – ${fieldLabel(lang, entity, l.field)}` : fieldLabel(lang, entity, l.field)}
```

`fieldLabel(lang, undefined, "dependencies")` resolves through the existing `dependencies` key in `i18n.ts`. Verify it does before relying on it:

```bash
grep -nE '^\s+dependencies:' src/app/i18n.ts src/app/i18n.de.ts
```

Both must return a line. If the DE file lacks the key, tsc's EN/DE parity check fails the build and the key must be added with the `.mjs` script pattern from Task 10.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/app/chat-proposal-describe.test.ts src/app/inline-ai-edit src/app/chat-panel.test.tsx > "$SCRATCH/t13b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t13b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/chat-proposal-describe.ts src/app/chat-proposal-describe.test.ts src/app/inline-ai-edit/plan.ts -F - <<'MSG'
fix(chat): translate the dependency card label

The describer built `${title} dependencies` and it reached the card
verbatim, so a German user read "Kickoff vorbereiten dependencies" while
every other label on that surface was translated.

LinkDiff gains an optional `subject` so the label becomes DATA the renderer
composes. chat-proposal-describe.ts is i18n-free by construction and takes
no lang; passing one in would put t() into a module whose purity is
deliberate.

Closes open-followups 406.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 14: The sweep can see the silent-RESET half (§394)

**Files:**
- Modify: `src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` (the `resource` reader)
- Modify: the per-entity `sanitize-*-patch.test.ts` fixtures
- Test: those same files

Two parts, and they must not be confused. **Do NOT move the shared sweep's fixtures** — that manufactures reds outside the direction under test, and the file's own header says so.

- [ ] **Step 1: Move each per-entity fixture off its sanitizer's fallback**

For every required enum in `sanitize-raid-patch.test.ts`, `sanitize-change-patch.test.ts`, `sanitize-stakeholder-patch.test.ts` and `sanitize-milestone-patch.test.ts`, set the BASE row to a value that is NOT the sanitizer's hardcoded default. Add this comment above each:

```ts
// ★★★ OFF THE FALLBACK, DELIBERATELY (§394). Every required enum's fixture used
//  to coincide with its own sanitizer's default — "To Do", "R", "Other",
//  "Medium" — so a REFUSED value read back as the value already held and the
//  test recorded agreement. That is what hid a live defect for four tasks: a
//  stored Sponsor silently demoted to Other. A fixture on the fallback cannot
//  distinguish "the guard ran" from "the guard did nothing".
```

- [ ] **Step 2: Run and triage the reds**

```bash
npx vitest run src/app/sanitize-raid-patch.test.ts src/app/sanitize-change-patch.test.ts src/app/sanitize-stakeholder-patch.test.ts src/app/sanitize-milestone-patch.test.ts > "$SCRATCH/t14.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL" "$SCRATCH/t14.log"
```

Every red is a QUESTION, not a bug to paper over. For each: does the guard keep the stored value (correct — fix the assertion) or does the sanitizer reset it (a real defect — stop and report it, because Layers 1-2 should have closed all of these). Record the triage in the commit message.

- [ ] **Step 3: Compose the `resource` reader**

In `src/app/inline-ai-edit/plan.sanitizer-parity.test.ts`, replace the bare `sanitizerReader(RESOURCE_BASE, sanitizeResource)` with one that composes the real write path, mirroring how `taskReader` composes `buildTaskCleanPatch` + `applyStatusChange`:

```ts
// ★★★ COMPOSED, NOT RAW (§394). `resource` was the last bare sanitizerReader,
//  faithful ONLY because `updateResource` has no merge-site guard today. A
//  merge-site guard is structurally INVISIBLE to a raw-sanitizer reader —
//  measured on raid, where the fix left this gate green while four stale
//  exceptions went on excusing defects that no longer existed. Composing it
//  now means the next guard cannot reopen that hole.
const resourceReader = composedReader(RESOURCE_BASE, (patch, stored) =>
  sanitizeResource({ ...stored, ...patch }),
);
```

Use the file's own `composedReader` helper if one exists; if the composed readers are written inline per entity, follow that shape instead. Read the `stakeholder` reader — fixed in the previous slice — and copy its structure.

- [ ] **Step 4: Verify, and mutation-prove the composition**

```bash
npx vitest run src/app/inline-ai-edit/plan.sanitizer-parity.test.ts src/app/inline-ai-edit/plan.write-path.test.ts > "$SCRATCH/t14b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t14b.log"
```

Then prove the reader can see a merge-site fix: add a throwaway `dropUnacceptedResourceFields` that drops one field, confirm the sweep NOTICES (its exception list changes or a probe reds), then revert it with an inverse anchored edit and prove `git diff --stat` shows only the intended files.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/inline-ai-edit/plan.sanitizer-parity.test.ts src/app/sanitize-raid-patch.test.ts src/app/sanitize-change-patch.test.ts src/app/sanitize-stakeholder-patch.test.ts src/app/sanitize-milestone-patch.test.ts -F - <<'MSG'
test(gates): let the parity sweep see the silent-reset half

Every required enum's per-entity fixture sat on its own sanitizer's
hardcoded fallback, so a refused value read back as the value already held
and the test recorded agreement. That is what hid a live defect for four
tasks. The fixtures move OFF the fallbacks; the shared sweep's fixtures are
deliberately untouched, because moving those manufactures reds outside the
direction under test.

resource was the last bare sanitizerReader — faithful only because
updateResource has no merge-site guard yet. Composed now, so adding one
cannot reopen the hole raid already demonstrated.

Closes the remaining half of open-followups 394.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 15: `fieldSanitizers` receives the merged row (§397)

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts` (the signature and every entry)
- Modify: `src/app/inline-ai-edit/plan.ts` (both call sites of the normalizer)
- Test: `src/app/inline-ai-edit/plan.test.ts`

A `fieldSanitizers` entry receives only the field's value, so the preview calls `sanitizeEmailList(v, undefined)` where `sanitizeResource` calls it with the merged row's primary.

- [ ] **Step 1: Flip the `KNOWN DIVERGENCE` test**

Find it and read what it names as the expectation to flip:

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "KNOWN DIVERGENCE" > "$SCRATCH/t15.log" 2>&1; echo "EXIT=$?"; grep -n "KNOWN DIVERGENCE" -A 20 src/app/inline-ai-edit/plan.test.ts
```

Rewrite it to assert agreement, renaming it and replacing the `KNOWN DIVERGENCE` marker with a note that it was closed:

```ts
it("drops an extra email equal to the row's primary, as the write does", () => {
  // Was a KNOWN DIVERGENCE: the entry received only the field's value, so the
  // preview called sanitizeEmailList(v, undefined) where sanitizeResource calls
  // it with the merged row's primary — the preview KEPT an extra equal to the
  // primary and the write dropped it (§397).
  const ws = makeWs({ resources: [{ id: 1, name: "R", email: "a@x.com", emails: [] }] });
  const plan = describeEntityCalls(
    [{ toolName: "update_resource", input: { id: 1, emails: ["a@x.com", "b@x.com"] } }],
    { descriptor: RESOURCE_DESCRIPTOR, item: ws.resources[0], ws },
  );
  expect(plan.updates.find((u) => u.field === "emails")?.after).toBe("b@x.com");
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "equal to the row's primary" > "$SCRATCH/t15b.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t15b.log"
```

Expected: FAIL — `after` is `"a@x.com, b@x.com"`.

- [ ] **Step 3: Widen the signature**

In `entity-descriptor.ts`:

```ts
  /** ★★ THE ROW IS THE SECOND ARGUMENT, AND IT IS THE MERGED ONE. An entry used
   *  to receive only the field's VALUE, so `sanitizeEmailList(v, undefined)`
   *  ran where `sanitizeResource` calls it with the row's primary address —
   *  the preview kept an extra equal to the primary that the write dropped, and
   *  at the 10-address cap the two disagreed about WHICH address landed tenth
   *  (§397). Merged, not stored: the model may be changing the primary in the
   *  same call. */
  fieldSanitizers: Record<string, (v: unknown, row: Record<string, unknown>) => string>;
```

Update every entry to accept and ignore the second argument except the resource `emails` entry, which uses it:

```ts
      emails: (v, row) => sanitizeEmailList(v, typeof row.email === "string" ? row.email : undefined).join(", "),
```

Match the real return shape of the existing entry rather than this sketch's `.join`.

- [ ] **Step 4: Pass the merged row at both call sites**

In `plan.ts`, `previewNormalizerFor` returns the entry; both `before` and `after` must be normalized against the MERGED row:

```ts
        const merged = { ...(item as Record<string, unknown>), ...input };
        const normalize = previewNormalizerFor(d, f);
        const before = normalize ? normalize(item[f], merged) : str(item[f]);
        const after = normalize ? normalize(input[f], merged) : str(input[f]);
```

`numberPreview` gains an ignored second parameter so the two normalizer kinds share one call shape.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/app/inline-ai-edit src/app/sanitize-records.test.ts > "$SCRATCH/t15c.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t15c.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts -F - <<'MSG'
fix(inline-ai-edit): the emails preview can see the row's primary address

A fieldSanitizers entry received only the field's value, so the preview ran
sanitizeEmailList(v, undefined) where sanitizeResource calls it with the
row's primary. The preview kept an extra equal to the primary that the write
dropped, and at the 10-address cap the two disagreed about which address
landed tenth.

Entries now receive the MERGED row — merged, not stored, because the model
may be changing the primary in the same call. The KNOWN DIVERGENCE test is
flipped to the agreeing expectation it named.

Closes open-followups 397.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 16: The coverage gate reads the dispatcher, not only the schema (§401)

**Files:**
- Modify: `src/app/inline-ai-edit/tool-input-coverage.test.ts`
- Test: that file

`tool-input-coverage.test.ts` enumerates DECLARED schema properties, so `update_task`'s `notes` alias — `input.description ?? input.notes` — is invisible to it forever. A green run means "every declared input is covered", never "every accepted input is covered".

- [ ] **Step 1: Write the failing test**

Append to the gate file:

```ts
describe("undeclared dispatcher inputs", () => {
  // ★★★ THE GATE'S OWN REACH (§401). Everything above enumerates DECLARED
  //  schema properties, so an input the dispatcher ACCEPTS and the schema never
  //  advertises cannot be seen at all. This scan closes that: it reads the
  //  dispatcher source for `input.<name>` and asks whether the schema declares
  //  it.
  //  ★★ A finding is a QUESTION, not automatically a defect. `notes` is a
  //  deliberate pre-0.196.0 alias that lands in `description`, which IS
  //  previewed — so it is allowlisted WITH that reason, never silently.
  const ALLOWED: Record<string, string> = {
    "update_task.notes": "Deliberate pre-0.196.0 alias; resolves into `description`, which is previewed.",
  };

  it("declares every input the dispatcher reads, or allowlists it with a reason", () => {
    const src = readFileSync(new URL("../chat-tools-updates.ts", import.meta.url), "utf8");
    const read = new Set([...src.matchAll(/\binput\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    const undeclared: string[] = [];
    for (const name of read) {
      if (declaredTaskInputs.has(name)) continue;
      if (ALLOWED[`update_task.${name}`]) continue;
      undeclared.push(name);
    }
    expect(undeclared).toEqual([]);
  });

  it("keeps the allowlist honest — every entry must still be read by the dispatcher", () => {
    // An allowlist that outlives its call site is a false assurance, which is
    // the failure mode this whole register keeps recording.
    const src = readFileSync(new URL("../chat-tools-updates.ts", import.meta.url), "utf8");
    for (const key of Object.keys(ALLOWED)) {
      const field = key.split(".")[1];
      expect(src).toContain(`input.${field}`);
    }
  });
});
```

Reuse the file's existing schema-enumeration helper for `declaredTaskInputs` rather than re-deriving it.

- [ ] **Step 2: Run and confirm it passes with the allowlist and fails without**

```bash
npx vitest run src/app/inline-ai-edit/tool-input-coverage.test.ts > "$SCRATCH/t16.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t16.log"
```

Expected: EXIT=0. Then **prove the scan is not vacuous** — temporarily empty `ALLOWED`, re-run, and confirm it reds naming `notes`. Restore it. A scan that finds nothing because it matches nothing is the anti-vacuity trap this repo records repeatedly.

- [ ] **Step 3: Update the gate's header comment**

The header states the gate's limit — "a green run means every DECLARED input is covered". Rewrite it to say what is now true, and to name what remains outside: this scan reads one dispatcher file, so a tool whose inputs are read elsewhere is still outside its reach.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/inline-ai-edit/tool-input-coverage.test.ts -F - <<'MSG'
test(gates): the coverage gate reads the dispatcher, not only the schema

The gate enumerated DECLARED schema properties, so an input the dispatcher
accepts and the schema never advertises was invisible to it forever — a
green run meant "every declared input is covered", never "every accepted
input is covered".

Adds a source scan for input.<name> reads with no declared property,
allowlisted with written reasons, plus a second test that reds when an
allowlist entry outlives its call site. Proved non-vacuous by emptying the
allowlist and confirming it names `notes`.

Closes open-followups 401.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 17: `roleId` stops claiming it assigns rates (§402)

**Files:**
- Modify: `src/app/chat-tool-defs.ts`
- Test: `src/app/chat-tool-defs.test.ts`

The schema tells the model `roleId` "assigns the resource's discipline + grade + rates". It sets ONE foreign key; those values live on `Role` and resolve at read time.

- [ ] **Step 1: Write the failing test**

```ts
it("describes roleId as a link, not as a write of rate data", () => {
  // A model reading the old description may choose roleId to achieve something
  // it cannot achieve: discipline, grade and rates live on Role and resolve at
  // read time (§402).
  const desc = resourceFields.roleId.description;
  expect(desc).not.toMatch(/rates/i);
  expect(desc).toMatch(/role/i);
});
```

Match the real accessor for the field description in that module.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/chat-tool-defs.test.ts -t "roleId" > "$SCRATCH/t17.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t17.log"
```

Expected: FAIL on the `rates` assertion.

- [ ] **Step 3: Correct the description**

```ts
    roleId: { type: "number", description: "Link the resource to a role by id. The role's discipline, grade and rates are properties of the ROLE and are resolved when read — this sets the link only, and writes none of them." },
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/app/chat-tool-defs.test.ts src/app/inline-ai-edit/tool-input-coverage.test.ts > "$SCRATCH/t17b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t17b.log"
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/chat-tool-defs.ts src/app/chat-tool-defs.test.ts -F - <<'MSG'
fix(ai-tools): roleId sets a link and does not write rate data

The schema told the model roleId "assigns the resource's discipline + grade
+ rates". It sets one foreign key; those values are properties of Role and
resolve at read time. The risk is a model choosing roleId to achieve
something it cannot achieve.

Closes open-followups 402.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 18: Milestone links follow the same rule as every other register (§403)

**Files:**
- Modify: `src/app/sanitize-records.ts` (`sanitizeMilestoneTaskIds`)
- Test: `src/app/sanitize-records.test.ts`

**This moves stored data** — duplicate ids currently persisted collapse on the next write. That is the intent of the decision and the reason the entry asked to be argued first.

- [ ] **Step 1: Rewrite the test that pins the divergence**

Find it:

```bash
grep -n "unlike sanitizeIdList" -B 5 -A 15 src/app/sanitize-records.test.ts
```

Replace it with the alignment, keeping a comment that records what it used to pin:

```ts
it("parses a delimited string and dedupes, like sanitizeIdList", () => {
  // WAS "yields [] for a delimited string, unlike sanitizeIdList" — the
  // milestone rule was array-only and did not dedupe, so `linkedTaskIds: "1;2"`
  // linked two tasks on a raid item and NOTHING on a milestone, and duplicates
  // inflated the digest's linkedTasks count (§403).
  expect(sanitizeMilestoneTaskIds("1;2")).toEqual([1, 2]);
  expect(sanitizeMilestoneTaskIds([1, 1, 2])).toEqual([1, 2]);
  expect(sanitizeMilestoneTaskIds([3, 0, -1, "x"])).toEqual([3]);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/sanitize-records.test.ts -t "like sanitizeIdList" > "$SCRATCH/t18.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t18.log"
```

Expected: FAIL — `[]` for the delimited string, `[1,1,2]` for the duplicates.

- [ ] **Step 3: Delegate to the shared rule**

```ts
/** The milestone's linked-task rule. ★★ It USED to be deliberately different
 *  from `sanitizeIdList` — array-only and non-deduping — which meant
 *  `linkedTaskIds: "1;2"` linked two tasks on a raid item and nothing on a
 *  milestone, and duplicates inflated the digest's `linkedTasks` count. Aligned
 *  in 0.287.0 (§403). Kept as a named export because the preview calls it by
 *  name and because a future milestone-specific rule has somewhere to live. */
export function sanitizeMilestoneTaskIds(v: unknown): number[] {
  return sanitizeIdList(v);
}
```

- [ ] **Step 4: Verify widely — this one moves data**

```bash
npx vitest run src/app/sanitize-records.test.ts src/app/sanitize-milestone-patch.test.ts src/app/inline-ai-edit src/app/golden-workspace.test.ts > "$SCRATCH/t18b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t18b.log"
```

Expected: EXIT=0. **If `golden-workspace.test.ts` reds, stop.** That means the sample workspace holds a milestone whose links change shape under the new rule, and the fixture must only be regenerated when the INPUT legitimately changed — which here it did not.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/sanitize-records.ts src/app/sanitize-records.test.ts -F - <<'MSG'
fix(milestone): link ids follow the same rule as every other register

The milestone rule was array-only and did not dedupe, so linkedTaskIds:
"1;2" linked two tasks on a raid item and nothing on a milestone, and
duplicates inflated the digest's linkedTasks count.

This moves stored data: duplicate ids already persisted collapse on the next
write. That is the intent of the decision and the reason the entry asked to
be argued before being changed.

Closes open-followups 403.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 19: A diff carries its own entity (§393)

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts` (`FieldDiff`, `LinkDiff`, every push site)
- Modify: `src/app/insights/recommend-plan.ts` (the three merge sites)
- Modify: the label resolution in the renderers
- Test: `src/app/inline-ai-edit/plan.test.ts`

One `EditPlan` can hold two entities' field names in one array, and the label map is entity-qualified because it must be — `impact` is a 1-5 scale on a RAID item and free text on a change.

★★ **Extend the twelve `toEqual` assertions; never loosen them to `objectContaining`.** Loosening is the easy way to make them pass and would silently unpin the field values those assertions exist for.

- [ ] **Step 1: Write the failing test**

```ts
it("resolves both entities' labels in a merged recommendation plan", () => {
  // recommendationPlanEntity answers only when exactly ONE register is updated
  // and otherwise falls back to raw property names — worse to read, never
  // wrong. A per-diff entity removes the "one register or nothing" limit (§393).
  const plan = describeRecommendationPlan([
    { toolName: "update_raid_item", input: { id: 1, impact: 4 } },
    { toolName: "update_change", input: { id: 2, impact: "High" } },
  ], ctx);
  expect(plan.updates.map((u) => [u.entity, u.field])).toEqual([
    ["raid", "impact"],
    ["change", "impact"],
  ]);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "merged recommendation plan" > "$SCRATCH/t19.log" 2>&1; echo "EXIT=$?"; tail -30 "$SCRATCH/t19.log"
```

Expected: FAIL — `entity` is `undefined`.

- [ ] **Step 3: Add the property and populate it at every push site**

```ts
export interface FieldDiff {
  /** ★★ The entity this diff BELONGS to, so a merged plan can resolve a label
   *  per row. `impact` is a 1-5 scale on a RAID item and free text on a change,
   *  so the label map is entity-qualified and a plan holding both had no way to
   *  ask (§393). Populated at every push site from the descriptor in scope. */
  entity: EntityKind;
  field: string; before: string; after: string; raw: string;
}
```

Do the same on `LinkDiff`. Every `plan.updates.push` / `plan.links.push` already has a descriptor `d` in scope — pass `d.entity`.

- [ ] **Step 4: Extend the assertions, one by one**

```bash
grep -n "toEqual(\[{ field:" src/app/inline-ai-edit/plan.test.ts | wc -l
```

Add `entity: "<kind>"` to each object. **Do not** rewrite any of them as `expect.objectContaining` — a reviewer will check for exactly that.

- [ ] **Step 5: Simplify the label resolution**

`recommendationPlanEntity(calls)` exists only to answer "which entity, if exactly one". With a per-diff entity the renderers read `d.entity` directly. Delete the helper if nothing else calls it:

```bash
grep -rn "recommendationPlanEntity" src/app --include=*.ts --include=*.tsx
```

- [ ] **Step 6: Verify**

```bash
npx vitest run src/app/inline-ai-edit src/app/insights src/app/chat-proposal-describe.test.ts > "$SCRATCH/t19b.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SCRATCH/t19b.log"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/insights/recommend-plan.ts -F - <<'MSG'
feat(inline-ai-edit): a diff carries its own entity

describeRecommendationPlan merges entities, so one EditPlan can hold two
entities' field names in one array — and the label map is entity-qualified
because it must be: impact is a 1-5 scale on a RAID item and free text on a
change. recommendationPlanEntity answered only when exactly one register was
updated and otherwise fell back to raw property names.

The twelve exact toEqual assertions are EXTENDED with the new property, not
loosened to objectContaining, which would have unpinned the field values
they exist for.

Closes open-followups 393.

Claude-Session: https://[session link removed]
MSG
```

---

## Task 20: Close the register, changelog, release 0.287.0

**Files:**
- Modify: `docs/open-followups.md` (§390-406)
- Modify: `CHANGELOG.md`
- Modify: `src/app/version.ts` and the five satellites via `npm run version:sync`

- [ ] **Step 1: Close each entry**

For each of §390-406, change the heading to `— CLOSED 2026-09-06` and add a closing paragraph naming the commit and the verification. **Four places is a FLOOR, not the count**: recent closures took five and six, because cross-reference anchors in OTHER entries and body claims the fix falsified also have to move. Sweep for them:

```bash
grep -n "§39[0-9]\|§40[0-6]" docs/open-followups.md
```

§391 closes as a RECORD with no code — say so explicitly rather than implying a fix.

Entries that do NOT fully close: §394's sweep half closes, and any part this slice did not reach stays open with an updated Status line. §382, §385, §386, §387, §388, §389 are untouched by this slice and must keep their `**Status:**` lines — `followups-status-check` is blocking.

- [ ] **Step 2: Verify the register**

```bash
npm run followups:status:check > "$SCRATCH/t20.log" 2>&1; echo "EXIT=$?"; tail -20 "$SCRATCH/t20.log"
grep -cE "^## [0-9]+\." docs/open-followups.md
grep -c "^| \[§" docs/open-followups.md
```

Expected: EXIT=0, and the entry count equals the TOC row count. `docs/open-followups.md` is LF-only — a CR byte fails.

- [ ] **Step 3: Write the changelog**

`CHANGELOG.md` is LF-only. Write the section with a `.mjs` script in `$SCRATCH` that aborts on any CR byte and asserts the `## [0.286.0]` anchor is unique, following the pattern from the previous release.

★★ **No `[session link removed]...` URL in `CHANGELOG.md`.** Commit trailers are exempt; this file is not.

Write it for a user, not a maintainer: the risk score that was fabricated from a boolean, the milestone description that was cleared, the refusals that were computed and never shown, the German label.

- [ ] **Step 4: Bump the version**

```bash
# edit src/app/version.ts by hand: APP_VERSION, APP_BUILD_DATE, APP_MILESTONE
npm run version:sync
npm run version:check; echo "EXIT=$?"
```

Expected: EXIT=0. **Exit 1 is drift** (run `version:sync`); **exit 2 is the gate unable to scan** — a different problem needing a different fix.

The codename must be unique per MINOR LINE, not across all history. A bare `CHANGELOG` grep misleads in both directions — check the 0.287.x line specifically.

- [ ] **Step 5: Run the gates this slice actually needs**

```bash
npx eslint src; echo "ESLINT_EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run size:check > "$SCRATCH/size.log" 2>&1; echo "SIZE_EXIT=$?"
npm run dup:check > "$SCRATCH/dup.log" 2>&1; echo "DUP_EXIT=$?"
npm run docs:symbols:check > "$SCRATCH/sym.log" 2>&1; echo "SYM_EXIT=$?"
npm run docs:claims:check > "$SCRATCH/claims.log" 2>&1; echo "CLAIMS_EXIT=$?"
npm run followups:status:check > "$SCRATCH/fu.log" 2>&1; echo "FU_EXIT=$?"
npm run version:check; echo "VER_EXIT=$?"
```

All must be 0. `npm run lint` exits 1 from gitignored leftovers in `.worktrees/` and `.demo-tmp/` — use `npx eslint src`.

- [ ] **Step 6: Commit**

```bash
git commit --only docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS -F - <<'MSG'
chore(release): 0.287.0

Closes open-followups 390-406.

Claude-Session: https://[session link removed]
MSG
```

- [ ] **Step 7: Stop and report**

Do NOT run the full suite, push, or open an MR. The user runs the full suite on their say-so and `mr-only-on-explicit-say` governs everything after it. Report: which entries closed, which stayed open and why, every triage decision from Task 14, and each mutation result as `N failed / M passed`.

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: Layer 1 → Tasks 1-5; Layer 2 → 6-9; Layer 3 → 10-13; Layer 4 → 14-17; Layer 5 → 18-19; release → 20. §391 has no code task by design and is discharged in Task 20 Step 1.

**Type consistency.** `numericFields` (Task 6) is the name used in Tasks 7 and 8; `stringOnlyFields` (Task 8) is new in that task; `acceptsScheduleDays` / `acceptsCostAmount` are introduced in Task 3 and changed in Task 7; `FieldDiff.entity` and `LinkDiff.subject` are added in Tasks 19 and 13 respectively and do not collide.

**Ordering constraint.** Task 6 must precede Tasks 7 and 8 — both consult the `numericFields`/`stringOnlyFields` plumbing it introduces. Tasks 2-5 must precede Task 6 for the same reason. Task 12 refactors the link projection that Task 15 then calls; running 15 first is possible but doubles the edit.

**Where a sketch may not match the tree.** Tasks 6, 10, 11, 13, 15, 16, 17 and 19 quote helper names and test-render shapes from files this plan sampled but did not read end to end. Each of those steps says to read the real signature first and match it. That is deliberate: a plan that invents a helper name is worse than one that names the file and the symbol to look up.
