# AI cost basis + task-list narrowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI usage caps count what a request actually costs, and stop `list_tasks` shipping a per-task note log that four operating-guide bullets forbid the model to use.

**Architecture:** Usage buckets change from storing multiplier-scaled tokens to storing raw API counts, with a per-field billing weight applied at comparison time; `tokenMultiplier` is retired. Separately, `slimTaskForList` drops `noteLog` while `get_task` keeps it, and the resulting read-but-not-write asymmetry is stated in the `get_task` tool description, in the guide source, and in the note-log window.

**Tech Stack:** TypeScript, React 19, Next 16, vitest, i18n EN/DE dictionaries.

**Spec:** `docs/superpowers/specs/2026-09-09-ai-cost-basis-and-task-list-narrowing-design.md`

---

## Before you start — repo landmines that apply to this plan

Read these. Each has cost a build in this repo.

1. **Every `src/app/*.ts(x)` file is CRLF.** Use the `Edit` tool, never `Write`, on any file under `src/app/`. `Write` re-lines the whole file to LF, `core.autocrlf=true` hides it from `git diff`, and the next `\r\n` anchor silently no-ops. Files under `docs/` and `lib/` are LF and `Write` is correct there.
2. **`src/app/i18n.de.ts` must NEVER be touched with `Edit` or `Write`.** The Edit tool corrupts umlauts and curls double-quotes. Patch it with a node script writing UTF-8, using `\r\n` in anchors, with real umlauts (`ä ö ü ß`) and no `\uXXXX` escapes — the `i18n-encoding` test bans both ASCII substitutions (`fuer`) and unicode escapes. Assert the anchor is unique before replacing.
3. **Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports `tail`'s status. Redirect to a file, echo `EXIT=$?` on its own, then grep the file.
4. **Never run two vitest processes at once.** `Failed to start forks worker` is machine contention, not a real failure.
5. **`npm run lint` runs at `--max-warnings=0`.** An unused export or an unused import is fatal, not untidy. Every deletion in this plan must remove its imports too.
6. **`npx tsc --noEmit` after editing ANY test file.** `next build` does not typecheck tests and vitest never typechecks, so a test-only type error passes locally and fails CI. tsc also enforces EN/DE key parity, so a key added to one dictionary and not the other fails here.
7. **Never `git add -A` or `git add .`** — an untracked `not-in-use.env.local.bak` in this worktree holds a live token. Stage explicit paths; commit with `git commit --only <paths>`.
8. **Never `git commit --amend`** in this worktree; it has swallowed another session's commit twice. Make a new commit.
9. **Do not push, open an MR, or merge.** This plan ends at the last local commit.

Run targeted gates only. Do not run the full suite unless the user asks for it.

---

## File structure

| File | Change | Responsibility after the change |
|---|---|---|
| `src/app/ai-usage.ts` | modify | Owns `Usage`, the buckets, and now the billing weights + `usageCostEquivalent`. `usageTotal` is gone. |
| `src/app/ai-usage-context.tsx` | modify | Stores RAW usage in buckets and session state; applies the weighting only when comparing against a cap. No longer reads `tokenMultiplier`. Owns both one-time notice keys. |
| `src/app/settings-types.ts` | modify | `AiConfig` loses `tokenMultiplier`; `DEFAULT_TOKEN_MULTIPLIER` and its coercer are deleted; `sanitizeAiConfig` silently ignores a stored value. |
| `src/app/settings-sections/ai-section.tsx` | modify | Loses the token-multiplier `CapInput` row. |
| `src/app/settings-sections/ai-usage-panel.tsx` | modify | Adds an output row and a one-line explanation of the bars' unit. |
| `src/app/chat-tools-lists.ts` | modify | `slimTaskForList` no longer projects `noteLog`; `NoteLogListEntry` and `slimNoteEntry` are deleted. |
| `src/app/chat-tool-defs.ts` | modify | `list_tasks` loses its `noteLog` clause; `get_task` gains the read-only clause. |
| `lib/app-feature-guide.md` | modify | Three of four note bullets corrected; the RAID and Changes ones stay verbatim. |
| `src/app/operating-guide-builtin.generated.ts` | regenerate | Never hand-edited — produced by `scripts/gen-operating-guide.mjs`. |
| `src/app/note-log-panel.tsx` | modify | Takes an `aiReadable` prop and renders the disclosure line when it is true and AI is on. |
| `src/app/use-notes-window.ts` | modify | The single place that knows the register, so the single place that sets `aiReadable`. |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | modify | String add/remove/relabel, in lockstep (tsc enforces parity). |
| `docs/AGENTS/ai-assistant.md` | modify | Records the re-measured saving and the new cap basis. |
| `docs/open-followups.md` | modify | New entry recording why the C1 history budget is not being built. |

---

## Task 1: Billing weights and `usageCostEquivalent`

**Files:**
- Modify: `src/app/ai-usage.ts`
- Test: `src/app/ai-usage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/ai-usage.test.ts`. Add `usageCostEquivalent` and `USAGE_COST_WEIGHTS` to the existing import from `./ai-usage`.

```ts
describe("usageCostEquivalent", () => {
  // The four figures below are turns 1 and 4 of the NEW arm of the live
  // 8-request measurement recorded in docs/AGENTS/ai-assistant.md
  // (2026-09-09, claude-sonnet-5). They are used rather than round numbers
  // because the cold/warm SPREAD is the property under test: a single fixture
  // passes under several wrong weightings.
  it("prices a cold first turn, where the cache write dominates", () => {
    const cold = { input: 1279, cacheWrite: 13305, cacheRead: 17796, output: 64 };
    // 1279*1 + 13305*1.25 + 17796*0.1 + 64*5
    expect(usageCostEquivalent(cold)).toBeCloseTo(20009.85, 2);
  });

  it("prices a warm turn, where the cache read dominates", () => {
    const warm = { input: 306, cacheWrite: 41, cacheRead: 31664, output: 33 };
    // 306*1 + 41*1.25 + 31664*0.1 + 33*5
    expect(usageCostEquivalent(warm)).toBeCloseTo(3688.65, 2);
  });

  it("prices the warm turn far below the cold one even though their raw sums match", () => {
    const cold = { input: 1279, cacheWrite: 13305, cacheRead: 17796, output: 64 };
    const warm = { input: 306, cacheWrite: 41, cacheRead: 31664, output: 33 };
    const rawCold = cold.input + cold.cacheWrite + cold.cacheRead + cold.output;
    const rawWarm = warm.input + warm.cacheWrite + warm.cacheRead + warm.output;
    // Within 2% of each other on a raw sum...
    expect(Math.abs(rawCold - rawWarm) / rawCold).toBeLessThan(0.02);
    // ...and more than 5x apart on cost. This is the whole reason the basis
    // changed: a raw sum cannot rank two conversations by what they cost.
    expect(usageCostEquivalent(cold) / usageCostEquivalent(warm)).toBeGreaterThan(5);
  });

  it("defaults a missing field to 0 rather than yielding NaN", () => {
    // A bucket persisted before the cache-token widening carries only
    // input/output. `undefined * weight` is NaN, and every comparison against
    // NaN is false — which makes crossed80/crossed100 permanently false, i.e.
    // silently disables the cap the user configured.
    const legacy = { input: 100, output: 10 } as unknown as Parameters<typeof usageCostEquivalent>[0];
    expect(usageCostEquivalent(legacy)).toBe(150);
    expect(Number.isNaN(usageCostEquivalent(legacy))).toBe(false);
  });

  it("weights output heaviest and cached input lightest", () => {
    expect(USAGE_COST_WEIGHTS.output).toBeGreaterThan(USAGE_COST_WEIGHTS.cacheWrite);
    expect(USAGE_COST_WEIGHTS.cacheWrite).toBeGreaterThan(USAGE_COST_WEIGHTS.input);
    expect(USAGE_COST_WEIGHTS.input).toBeGreaterThan(USAGE_COST_WEIGHTS.cacheRead);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/ai-usage.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |usageCostEquivalent" /tmp/t1.log
```

Expected: FAIL. The failure is a module error — `usageCostEquivalent is not a function` / `USAGE_COST_WEIGHTS is not defined` — not an assertion failure.

- [ ] **Step 3: Add the weights and the function**

In `src/app/ai-usage.ts`, insert immediately after the `EMPTY_USAGE` constant (`src/app/ai-usage.ts` is CRLF — use `Edit`):

```ts
/** Billing weight per usage class, as a RATIO against the base input price
 *  rather than as money. Anthropic holds these ratios across its current
 *  models (Sonnet $3/$15, Haiku $1/$5, Opus $15/$75 — all 1:5 input:output;
 *  cache write 1.25x and cache read 0.1x everywhere), so a cost basis built on
 *  them needs NO price table and NO per-model branch, and cannot go stale when
 *  a published rate moves.
 *  ★★ IF A FUTURE MODEL BREAKS THE RATIO these stop being model-free and the
 *  basis has to become model-aware. That is the one thing that would make this
 *  design wrong; see the spec's closing section. */
export const USAGE_COST_WEIGHTS = {
  input: 1,
  cacheWrite: 1.25,
  cacheRead: 0.1,
  output: 5,
} as const;

/** What one recording costs, in units of base input tokens — the number the
 *  caps compare against.
 *
 *  ★★★ THIS REPLACES `usageTotal`, WHICH WAS DELETED RATHER THAN RE-BODIED.
 *  That function summed the four fields unweighted, so a cached turn (billed at
 *  a tenth) consumed exactly as much of a cap as a fresh one. A reader seeing
 *  the name `usageTotal` expects a plain sum, so leaving it callable would let
 *  the raw sum back into a cap comparison by accident; deleting the name makes
 *  that mistake unavailable instead of merely discouraged.
 *
 *  ★★ Normalises first, for the reason `normalizeUsage`'s own docstring gives:
 *  `undefined * weight` is NaN, every comparison against NaN is false, and a
 *  NaN total makes `crossed80`/`crossed100` permanently false — a silently
 *  disabled cap, the worst outcome available here. */
export function usageCostEquivalent(u: Partial<Usage> | undefined): number {
  const n = normalizeUsage(u);
  return (
    n.input * USAGE_COST_WEIGHTS.input +
    n.cacheWrite * USAGE_COST_WEIGHTS.cacheWrite +
    n.cacheRead * USAGE_COST_WEIGHTS.cacheRead +
    n.output * USAGE_COST_WEIGHTS.output
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/ai-usage.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: PASS, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-usage.ts src/app/ai-usage.test.ts
git commit --only src/app/ai-usage.ts src/app/ai-usage.test.ts -m "feat(ai): add per-field billing weights and usageCostEquivalent"
```

---

## Task 2: Repoint `weekToDate` and delete `usageTotal`

**Files:**
- Modify: `src/app/ai-usage.ts`
- Test: `src/app/ai-usage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/ai-usage.test.ts`:

```ts
it("weekToDate totals the week on the cost basis, not the raw sum", () => {
  const now = new Date(2026, 8, 9); // Wed 2026-09-09
  const buckets = {
    "2026-09-08": { input: 0, output: 0, cacheWrite: 0, cacheRead: 1000 },
  };
  // Raw sum would be 1000; cached input is billed at a tenth.
  expect(weekToDate(buckets, now)).toBeCloseTo(100, 6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/ai-usage.test.ts -t "cost basis, not the raw sum" > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |expected" /tmp/t2.log
```

Expected: FAIL with `expected 1000 to be close to 100`.

- [ ] **Step 3: Repoint `weekToDate` and delete `usageTotal`**

In `src/app/ai-usage.ts`, delete this function entirely:

```ts
/** Every billed token in one number — what the caps compare against. */
export function usageTotal(u: Usage): number {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}
```

and inside `weekToDate`, replace:

```ts
    if (d >= start && d <= now) total += usageTotal(normalizeUsage(u));
```

with:

```ts
    // `usageCostEquivalent` normalises internally, so the explicit
    // normalizeUsage call this replaced would have been redundant.
    if (d >= start && d <= now) total += usageCostEquivalent(u);
```

- [ ] **Step 4: Run the test and the typechecker**

```bash
npx vitest run src/app/ai-usage.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t2.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: vitest PASS. tsc reports errors in `src/app/ai-usage-context.tsx` — `usageTotal` no longer exists. That is expected and is fixed in Task 3; do not fix it here, and do not commit until Task 3 if you prefer a green tree. If any test file other than `ai-usage-context.test.tsx` references `usageTotal`, repoint it now:

```bash
grep -rn "usageTotal" src/ ; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-usage.ts src/app/ai-usage.test.ts
git commit --only src/app/ai-usage.ts src/app/ai-usage.test.ts -m "refactor(ai): put weekToDate on the cost basis and delete usageTotal"
```

---

## Task 3: Store raw usage, weight at read, drop the multiplier from the provider

**Files:**
- Modify: `src/app/ai-usage-context.tsx`
- Test: `src/app/ai-usage-context.test.tsx`

The provider currently multiplies all four fields by `tokenMultiplier` before writing them to the buckets. That is why B's re-basing is permanent: the multiplier in force at write time was never stored beside the numbers. After this task, buckets hold raw API counts and the weighting happens at comparison time.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/ai-usage-context.test.tsx`, following that file's existing render/harness pattern for driving `record`:

```tsx
it("stores raw API counts in sessionUsage rather than scaled ones", async () => {
  // The panel labels these three figures as token counts. Before this change
  // they were multiplied by tokenMultiplier (default 5) and rendered at 5x
  // while claiming to be counts.
  const { result } = renderUsage({ ai: { ...defaultAiConfig } });
  act(() => result.current.record({ input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 }));
  expect(result.current.sessionUsage).toEqual({
    input: 100,
    output: 10,
    cacheWrite: 20,
    cacheRead: 1000,
  });
});

it("totals the session on the cost basis", () => {
  const { result } = renderUsage({ ai: { ...defaultAiConfig } });
  act(() => result.current.record({ input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 }));
  // 100*1 + 10*5 + 20*1.25 + 1000*0.1 = 275
  expect(result.current.sessionTotal).toBeCloseTo(275, 6);
});

it("ignores a stored tokenMultiplier instead of scaling by it", () => {
  // Every existing device has a persisted tokenMultiplier, so this is the
  // upgrade path, not an edge case.
  const ai = { ...defaultAiConfig, tokenMultiplier: 5 } as typeof defaultAiConfig;
  const { result } = renderUsage({ ai });
  act(() => result.current.record({ input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 }));
  expect(result.current.sessionTotal).toBeCloseTo(275, 6);
});
```

`renderUsage` is this file's existing helper. If it is named differently, use whatever the file already uses to mount `AiUsageProvider` and reach `useAiUsageContext`; do not add a second harness.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/ai-usage-context.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |expected" /tmp/t3.log
```

Expected: FAIL — `sessionUsage` comes back at 5x and `sessionTotal` at the scaled raw sum.

- [ ] **Step 3: Rewrite the record callback**

In `src/app/ai-usage-context.tsx` (CRLF — use `Edit`):

Change the import from `./ai-usage` so it pulls `usageCostEquivalent` instead of `usageTotal`:

```ts
import {
  addToBuckets,
  nextWeekReset,
  normalizeUsage,
  usageCostEquivalent,
  weekToDate,
  type Usage,
  type UsageBuckets,
} from "./ai-usage";
```

Change the settings import to drop the multiplier constant:

```ts
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "./settings-types";
```

Delete this line:

```ts
  const multiplier = ai.tokenMultiplier ?? DEFAULT_TOKEN_MULTIPLIER;
```

Replace the scaling block at the top of `record` — everything from the `// Apply the counting multiplier ONCE` comment down to and including `const tokens = usageTotal(scaled);` — with:

```ts
      // ★★★ STORE RAW, WEIGHT AT READ. The buckets hold the API's own counts;
      // the per-field billing weights are applied here, at comparison time,
      // and never baked into what is persisted. The previous shape multiplied
      // every field by `tokenMultiplier` BEFORE writing, which is why that
      // re-basing was permanent — the multiplier in force at write time was
      // never recorded beside the numbers, so stored history could not be
      // re-interpreted. It still cannot, for buckets written before this
      // change; see the cost-basis notice.
      const normalized = normalizeUsage(u);
      const tokens = usageCostEquivalent(normalized);
```

Then replace every remaining use of `scaled` in the function body with `normalized`:

```ts
      const nextSessionUsage: Usage = {
        input: prevSessionUsage.input + normalized.input,
        output: prevSessionUsage.output + normalized.output,
        cacheWrite: prevSessionUsage.cacheWrite + normalized.cacheWrite,
        cacheRead: prevSessionUsage.cacheRead + normalized.cacheRead,
      };
      const prevWeek = weekToDate(prevBuckets, now);
      const nextBuckets = addToBuckets(prevBuckets, now, normalized);
```

And drop `multiplier` from the dependency array:

```ts
    [lang, sessionCap, weeklyCap, showToast],
```

- [ ] **Step 4: Run the tests and the typechecker**

```bash
npx vitest run src/app/ai-usage-context.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t3.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: vitest PASS. tsc still reports `DEFAULT_TOKEN_MULTIPLIER` is unused nowhere yet — it is still exported and still used by `ai-section.tsx`, so `TSC_EXIT=0` here.

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx
git commit --only src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx -m "feat(ai): store raw usage and apply billing weights at comparison time"
```

---

## Task 4: Retire `tokenMultiplier` from settings

**Files:**
- Modify: `src/app/settings-types.ts`
- Modify: `src/app/settings-sections/ai-section.tsx`
- Modify: `src/app/settings-sections/ai-usage-panel.test.tsx`
- Test: `src/app/settings-types.test.ts` (or whichever file holds `sanitizeAiConfig` tests — find it with the grep in Step 1)

- [ ] **Step 1: Locate the existing sanitize tests**

```bash
grep -rln "sanitizeAiConfig" src/app --include=*.test.ts --include=*.test.tsx; echo "EXIT=$?"
```

Add the test below to the file that comes back. If more than one comes back, use the one whose describe block is about `sanitizeAiConfig` itself.

- [ ] **Step 2: Write the failing test**

```ts
it("ignores a stored tokenMultiplier instead of rejecting the blob", () => {
  // ★★★ Every existing device has one persisted: `defaultAiConfig` carried it
  // and `writeSettings` writes the whole object. A reader that threw, or that
  // dropped the surrounding fields, would refuse every real settings blob in
  // existence. The field must simply not survive the round-trip.
  const out = sanitizeAiConfig({
    apiKey: "k",
    sessionTokenCap: 1234,
    tokenMultiplier: 5,
  });
  expect("tokenMultiplier" in out).toBe(false);
  expect(out.sessionTokenCap).toBe(1234);
  expect(out.apiKey).toBe("k");
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/app/settings-types.test.ts -t "ignores a stored tokenMultiplier" > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |expected" /tmp/t4.log
```

Expected: FAIL with `expected true to be false` — the key survives today.

- [ ] **Step 4: Remove the field, the constant, the coercer and the UI row**

In `src/app/settings-types.ts` (CRLF — use `Edit`):

Delete from the `AiConfig` type:

```ts
  tokenMultiplier?: number; // Multiplier applied to counted tokens before caps (>0, decimals ok). Default 5.
```

Delete the constant:

```ts
export const DEFAULT_TOKEN_MULTIPLIER = 5;
```

Delete from `defaultAiConfig`:

```ts
  tokenMultiplier: DEFAULT_TOKEN_MULTIPLIER,
```

Delete from `sanitizeAiConfig` the coercer:

```ts
  // Token multiplier: any finite value > 0 (decimals allowed); else default.
  const coerceMultiplier = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TOKEN_MULTIPLIER;
  };
```

and the emitted field:

```ts
    tokenMultiplier: coerceMultiplier(obj.tokenMultiplier),
```

In `src/app/settings-sections/ai-section.tsx` (CRLF — use `Edit`), delete the whole `CapInput` block:

```tsx
      <CapInput
        label={t(lang, "aiTokenMultiplier")}
        hint={t(lang, "aiTokenMultiplierHint")}
        value={settings.ai.tokenMultiplier}
        defaultValue={DEFAULT_TOKEN_MULTIPLIER}
        min={0.1}
        step={0.5}
        decimal
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, tokenMultiplier: n } })
        }
      />
```

and remove `DEFAULT_TOKEN_MULTIPLIER` from that file's import list from `../settings-types`. Leaving it imported is a fatal lint error at `--max-warnings=0`.

In `src/app/settings-sections/ai-usage-panel.test.tsx`, the fixture pins the multiplier to 1 so seeded usage lands unscaled. That is now the only behaviour, so replace:

```ts
// tokenMultiplier pinned to 1 so the seeded Usage lands in sessionUsage
```
```ts
  const ai = { ...defaultAiConfig, tokenMultiplier: 1 };
```

with:

```ts
// No scaling to defeat any more: the provider stores raw counts, so the
// seeded Usage lands in sessionUsage unchanged.
```
```ts
  const ai = { ...defaultAiConfig };
```

- [ ] **Step 5: Run the affected tests, the typechecker and lint**

```bash
npx vitest run src/app/settings-types.test.ts src/app/settings-sections/ai-usage-panel.test.tsx src/app/ai-usage-context.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t4.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/settings-types.ts src/app/settings-sections/ai-section.tsx; echo "LINT_EXIT=$?"
```

Expected: all three green. tsc will name any other file still referencing `tokenMultiplier` or `DEFAULT_TOKEN_MULTIPLIER`; fix each by deletion, not by reintroducing the field.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-usage-panel.test.tsx src/app/settings-types.test.ts
git commit --only src/app/settings-types.ts src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-usage-panel.test.tsx src/app/settings-types.test.ts -m "feat(ai): retire tokenMultiplier now that the caps price each field"
```

---

## Task 5: The cost-basis notice

**Files:**
- Modify: `src/app/ai-usage-context.tsx`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (by script only)
- Test: `src/app/ai-usage-context.test.tsx`

The existing `AI_CAP_BASIS_NOTICE_KEY` notice explained B's change. This slice changes the basis again, so the new notice **supersedes** it: `noteCostBasisOnce` sets both flags and shows one string covering both changes. That way a user who never saw the first notice is not shown two, and the old `aiUsageCapBasisChanged` string is retired.

★ This also resolves the owed native review of the 0.295.0 German cap-basis string — by deleting the string. Say so in the commit message rather than leaving the debt looking unaddressed.

- [ ] **Step 1: Write the failing test**

Append to `src/app/ai-usage-context.test.tsx`:

```tsx
it("shows the cost-basis notice once and never the superseded cap-basis one", () => {
  window.localStorage.setItem(AI_USAGE_KEY, JSON.stringify({
    "2026-09-08": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  }));
  const toasts: string[] = [];
  const { result } = renderUsage({
    ai: { ...defaultAiConfig, sessionTokenCap: 100 },
    showToast: (_k: string, text: string) => toasts.push(text),
  });
  act(() => result.current.record({ input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }));
  act(() => result.current.record({ input: 100, output: 0, cacheWrite: 0, cacheRead: 0 }));
  const notices = toasts.filter((x) => x === t("en-US", "aiUsageCostBasisChanged"));
  expect(notices).toHaveLength(1);
  // Setting the new flag must also set the superseded one, so a later build
  // that still reads it cannot re-explain a change already announced.
  expect(window.localStorage.getItem(AI_CAP_BASIS_NOTICE_KEY)).toBe("1");
  expect(window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY)).toBe("1");
});
```

Add `AI_COST_BASIS_NOTICE_KEY` to the imports from `../ai-usage-context` (adjust the relative path to match the file's existing imports).

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/ai-usage-context.test.tsx -t "cost-basis notice" > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |is not defined|expected" /tmp/t5.log
```

Expected: FAIL — `AI_COST_BASIS_NOTICE_KEY` is not exported.

- [ ] **Step 3: Add the EN strings**

In `src/app/i18n.ts` (CRLF — use `Edit`), replace:

```ts
  aiUsageCapBasisChanged:
    "Token counts now include cached input, which Anthropic bills separately. Your caps are unchanged, so warnings arrive earlier than before.",
```

with:

```ts
  aiUsageCostBasisChanged:
    "Your token caps now measure what a request costs: cached input counts at a tenth, cache writes at 1.25x, and output at 5x. The counting multiplier setting is gone — lower a cap directly instead. Usage recorded before this update reads high until the week resets.",
```

and relabel the three breakdown rows, which no longer show multiplied figures, plus add the two new lines:

```ts
  aiUsageCacheRead: "Cached input",
  aiUsageCacheWrite: "Cache writes",
  aiUsageUncachedInput: "Uncached input",
  aiUsageOutput: "Output",
  aiUsageBasisHint: "Bars count cost-equivalent tokens, not raw ones: cached input counts 0.1, cache writes 1.25, output 5.",
```

- [ ] **Step 4: Add the DE strings by script**

`src/app/i18n.de.ts` must never be touched with `Edit` or `Write`. Save this as `scripts/tmp-de-cost-basis.mjs`, run it, then delete it.

```js
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/i18n.de.ts";
const src = readFileSync(path, "utf8");

const oldNotice =
  '  aiUsageCapBasisChanged:\r\n' +
  '    "Die Token-Zählung umfasst jetzt zwischengespeicherte Eingaben, die Anthropic separat abrechnet. Ihre Obergrenzen bleiben unverändert, daher erscheinen Warnungen früher als bisher.",\r\n';
const newNotice =
  '  aiUsageCostBasisChanged:\r\n' +
  '    "Ihre Token-Obergrenzen messen jetzt die tatsächlichen Kosten einer Anfrage: zwischengespeicherte Eingaben zählen zu einem Zehntel, Cache-Schreibvorgänge mit dem 1,25-Fachen und Ausgaben mit dem 5-Fachen. Die Einstellung für den Zählfaktor entfällt — senken Sie stattdessen direkt eine Obergrenze. Vor dieser Aktualisierung erfasste Nutzung wird zu hoch angezeigt, bis die Woche zurückgesetzt wird.",\r\n';

const oldMultiplier =
  '  aiTokenMultiplier: "Token-Zählfaktor",\r\n' +
  '  aiTokenMultiplierHint: "Die gezählten Token jeder Anfrage werden hiermit multipliziert, bevor sie auf Ihre Limits angerechnet werden (Standard 5).",\r\n';

// Anchors must be unique in BOTH directions: present exactly once before the
// write, absent afterwards. A `\n`-joined anchor is a guaranteed no-op in this
// CRLF file, which is why every anchor above spells \r\n.
for (const [name, anchor] of [["notice", oldNotice], ["multiplier", oldMultiplier]]) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor ${name} matched ${n} times, expected exactly 1`);
}

// The three breakdown rows drop their "(gezählte Tokens)" qualifier — they now
// hold raw counts, so the parenthetical was describing the multiplied figure —
// and the two new keys land beside them. Anchor text below was read from the
// file on 2026-09-09; if any throw fires, re-read with the grep in the next
// step rather than adjusting the expected count.
const oldRows =
  '  aiUsageCacheRead: "Zwischengespeicherte Eingabe (gezählte Tokens)",\r\n' +
  '  aiUsageCacheWrite: "Cache-Schreibvorgänge (gezählte Tokens)",\r\n' +
  '  aiUsageUncachedInput: "Nicht zwischengespeicherte Eingabe (gezählte Tokens)",\r\n';
const newRows =
  '  aiUsageCacheRead: "Zwischengespeicherte Eingabe",\r\n' +
  '  aiUsageCacheWrite: "Cache-Schreibvorgänge",\r\n' +
  '  aiUsageUncachedInput: "Nicht zwischengespeicherte Eingabe",\r\n' +
  '  aiUsageOutput: "Ausgabe",\r\n' +
  '  aiUsageBasisHint: "Die Balken zählen kostenäquivalente Tokens, keine rohen: zwischengespeicherte Eingabe zählt 0,1, Cache-Schreibvorgänge 1,25, Ausgaben 5.",\r\n';

const rowsSeen = src.split(oldRows).length - 1;
if (rowsSeen !== 1) throw new Error(`anchor rows matched ${rowsSeen} times, expected exactly 1`);

const out = src
  .replace(oldNotice, newNotice)
  .replace(oldMultiplier, "")
  .replace(oldRows, newRows);
if (out === src) throw new Error("no replacement made");

writeFileSync(path, out, "utf8");
console.log("patched", path);
```

★ Every anchor above was read from `src/app/i18n.de.ts` on 2026-09-09. If a throw fires, the file has moved on — re-read the current values and use them verbatim:

```bash
grep -n "aiUsageCapBasisChanged\|aiTokenMultiplier\|aiUsageCacheRead\|aiUsageCacheWrite\|aiUsageUncachedInput" src/app/i18n.de.ts
```

Run and clean up:

```bash
node scripts/tmp-de-cost-basis.mjs; echo "EXIT=$?"
rm scripts/tmp-de-cost-basis.mjs
git ls-files --eol src/app/i18n.de.ts
```

Expected: `patched src/app/i18n.de.ts`, `EXIT=0`, and `i/lf w/crlf` from `git ls-files --eol` — `i/lf w/lf` means the file was re-lined and must be restored.

- [ ] **Step 5: Add the notice key and function**

In `src/app/ai-usage-context.tsx` (CRLF — use `Edit`), add beside the existing key:

```ts
/** ★★ SUPERSEDES `AI_CAP_BASIS_NOTICE_KEY`. Setting this one also sets that
 *  one (see `noteCostBasisOnce`), so a user who never saw B's notice is shown
 *  ONE message covering both changes rather than two. */
export const AI_COST_BASIS_NOTICE_KEY = "aipm-cockpit:ai-cost-basis-notice";
```

Rename `loadBucketsAndSeedCapBasisNotice` to `loadBucketsAndSeedBasisNotices` and, in its `raw === null` branch, seed both keys:

```ts
    if (raw === null) {
      window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
      window.localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "1");
      return {};
    }
```

Update its call site in the lazy `useState` initializer to the new name.

Replace `noteCapBasisOnce` with:

```ts
// ★ Guards a localStorage read+write with a synchronous try/catch so the flag
// is set BEFORE showToast is ever called — a second call in the same tick
// (session and weekly crossing together) sees the flag already "1" and stays
// silent, so the notice fires once GLOBALLY, not once per scope.
// ★★ Writes BOTH keys. The cap-basis notice this supersedes explained a
// change that is now subsumed by the cost-basis one; marking it seen here
// stops any later reader re-announcing something already announced.
function noteCostBasisOnce(showToast: (kind: "info" | "error", text: string) => void, lang: Lang): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(AI_COST_BASIS_NOTICE_KEY) === "1") return;
    window.localStorage.setItem(AI_COST_BASIS_NOTICE_KEY, "1");
    window.localStorage.setItem(AI_CAP_BASIS_NOTICE_KEY, "1");
  } catch {
    return; // storage unavailable: skip the notice rather than repeating it
  }
  showToast("info", t(lang, "aiUsageCostBasisChanged"));
}
```

Replace all four `noteCapBasisOnce(showToast, lang);` call sites with `noteCostBasisOnce(showToast, lang);`.

- [ ] **Step 6: Run the tests, the typechecker and the encoding gate**

```bash
npx vitest run src/app/ai-usage-context.test.tsx src/app/i18n-encoding.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t5.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: both green. tsc is what catches an EN key with no DE twin, so a `TSC_EXIT=1` naming `i18n.de.ts` means the script missed a key.

- [ ] **Step 7: Commit**

```bash
git add src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/ai-usage-context.tsx src/app/ai-usage-context.test.tsx src/app/i18n.ts src/app/i18n.de.ts -m "feat(ai): announce the cost basis once, superseding the cap-basis notice

Retires aiUsageCapBasisChanged in both dictionaries, which also closes the
owed native review of its German text from 0.295.0 — by deletion."
```

---

## Task 6: Show output and the bars' unit in the usage panel

**Files:**
- Modify: `src/app/settings-sections/ai-usage-panel.tsx`
- Test: `src/app/settings-sections/ai-usage-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/settings-sections/ai-usage-panel.test.tsx`, following the file's existing render helper:

```tsx
it("shows the output row, which carries the heaviest weight", () => {
  renderPanel({ input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 });
  expect(screen.getByText(t("en-US", "aiUsageOutput"))).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
});

it("renders raw counts, not multiplied ones", () => {
  // The three input-side rows were rendered at 5x while labelled as token
  // counts, because sessionUsage held multiplier-scaled values.
  renderPanel({ input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 });
  expect(screen.getByText("1,000")).toBeInTheDocument();
  expect(screen.queryByText("5,000")).not.toBeInTheDocument();
});

it("says what unit the bars are in", () => {
  renderPanel({ input: 100, output: 10, cacheWrite: 20, cacheRead: 1000 });
  expect(screen.getByText(t("en-US", "aiUsageBasisHint"))).toBeInTheDocument();
});
```

`renderPanel` is this file's existing helper for mounting the panel with a seeded `Usage`. Use whatever it is actually called; do not add a second one.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/settings-sections/ai-usage-panel.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Unable to find" /tmp/t6.log
```

Expected: FAIL — the output row and the hint do not exist.

- [ ] **Step 3: Add the row and the hint**

In `src/app/settings-sections/ai-usage-panel.tsx` (CRLF — use `Edit`), add an output row to the `<dl>`, after the cache-write row:

```tsx
        <div className="flex justify-between gap-2">
          <dt>{t(lang, "aiUsageOutput")}</dt>
          <dd className="tabular-nums">{sessionUsage.output.toLocaleString(locale)}</dd>
        </div>
```

and add the unit hint immediately after the `</dl>`, before the cache-hit-rate paragraph:

```tsx
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "aiUsageBasisHint")}</p>
```

★ Do not change the `inputSide` / `hitRatePct` arithmetic. It is a ratio over three commonly-scaled figures and was correct before and after; the comment above it explaining why output is excluded from the denominator stays true.

- [ ] **Step 4: Run the tests and the typechecker**

```bash
npx vitest run src/app/settings-sections/ai-usage-panel.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t6.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: PASS, `TSC_EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/ai-usage-panel.tsx src/app/settings-sections/ai-usage-panel.test.tsx
git commit --only src/app/settings-sections/ai-usage-panel.tsx src/app/settings-sections/ai-usage-panel.test.tsx -m "feat(ai): show output tokens and name the bars' unit in the usage panel"
```

---

## Task 7: Drop `noteLog` from the task list projection

**Files:**
- Modify: `src/app/chat-tools-lists.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Rewrite the affected tests**

In `src/app/chat-tools.test.ts` (CRLF — use `Edit`), replace the wire-shape types:

```ts
/** The list path's WIRE shape, spelled out here rather than imported, so these
 *  tests describe what a caller receives instead of restating the projection's
 *  own types back at it. `html` is optional because the projection drops it. */
type ListNote = Omit<NoteLogEntry, "html"> & { html?: string };
type ListEnvelope = {
  items: (Omit<Task, "noteLog"> & { noteLog?: ListNote[] })[];
  total: number;
  limit?: number;
};
```

with:

```ts
/** The list path's WIRE shape, spelled out here rather than imported, so these
 *  tests describe what a caller receives instead of restating the projection's
 *  own types back at it. `noteLog` is typed as `never` so a test asserting on
 *  one fails to compile rather than silently reading undefined. */
type ListEnvelope = {
  items: (Omit<Task, "noteLog"> & { noteLog?: never })[];
  total: number;
  limit?: number;
};
```

Replace the note-projection test entirely:

```ts
  it("list_tasks drops each note's html body and keeps its text projection", async () => {
    const d = makeDispatcher({ listTasks: vi.fn(() => [makeTask({ noteLog: [RICH_NOTE] })]) });
    const result = (await runTool(d, "list_tasks", {})) as ListEnvelope;
    const note = result.items[0].noteLog?.[0];
    expect(note?.text).toBe("Partner call moved to Friday");
    expect(note?.html).toBeUndefined();
    // Everything else about the entry survives — this is a projection, not a
    // truncation, so the model still sees when and by whom a note was written.
    expect(note?.id).toBe(7);
    expect(note?.timestamp).toBe("2026-05-01T00:00:00.000Z");
    expect(note?.authorName).toBe("Alice");
  });
```

with:

```ts
  it("list_tasks carries no note log at all", async () => {
    // ★★★ THIS IS THE TEST THAT PINS THE SAVING. `noteLog` was 37.8% of the
    // list payload on a 140-task project, and the operating guide denies the
    // model any note access — so the app was paying to ship data it had
    // instructed the model four times not to use. Without this assertion the
    // field drifts straight back in the next time `TaskListItem` is widened,
    // and no gate reports it.
    const d = makeDispatcher({ listTasks: vi.fn(() => [makeTask({ noteLog: [RICH_NOTE] })]) });
    const result = (await runTool(d, "list_tasks", {})) as ListEnvelope;
    expect("noteLog" in result.items[0]).toBe(false);
  });
```

Update the control test so it pins `get_task` as the surviving path. Replace:

```ts
  // ★ THE CONTROL. Slimming BOTH paths would satisfy every assertion above; only
  // this pins that an assistant about to EDIT a description still gets the markup
  // it is editing. Both tools read the SAME row here, so a shared projection fails.
  it("get_task keeps the full markup that the list projection strips", async () => {
```

with:

```ts
  // ★★★ THE CONTROL, AND BOTH HALVES ARE LOAD-BEARING. A test proving only
  // that notes are gone from the list would still pass if `get_task` lost them
  // too — which would delete the capability rather than relocate it. Both
  // tools read the SAME row here, so a shared projection fails this.
  it("get_task keeps the full note log and markup that the list projection strips", async () => {
```

and inside that test, after the existing `expect(list.items[0].description).not.toContain("<strong>");`, add:

```ts
    expect("noteLog" in list.items[0]).toBe(false);
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t7.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |expected" /tmp/t7.log
```

Expected: FAIL with `expected true to be false` on the `"noteLog" in result.items[0]` assertions.

- [ ] **Step 3: Narrow the projection**

In `src/app/chat-tools-lists.ts` (CRLF — use `Edit`), delete `slimNoteEntry` entirely:

```ts
function slimNoteEntry(entry: NoteLogEntry): NoteLogListEntry {
  const { html, ...rest } = entry;
  // `text` is guaranteed non-empty by the load sanitizer, but this projection
  // also runs over rows minted in-session, so fall back rather than emit an
  // entry whose body is gone in both spellings.
  return { ...rest, text: entry.text || (html ? htmlToPlainText(html) : "") };
}
```

Delete the `NoteLogListEntry` type declaration and its docstring (the block whose comment begins "A `noteLog` entry as the list path reports it").

Replace the item type:

```ts
/** A task as `list_tasks` reports it: every field of `Task`, with the two rich
 *  HTML carriers projected to text. ★ `description` and `noteLog` are the
 *  ENTIRE slimming target on this path — the other five list tools already
 *  project to `*Summary` types that carry no rich HTML at all. */
export type TaskListItem = Omit<Task, "description" | "noteLog"> & {
  description: string;
  noteLog?: NoteLogListEntry[];
};
```

with:

```ts
/** A task as `list_tasks` reports it: every field of `Task` except the note
 *  log, with `description` projected to plain text.
 *
 *  ★★★ `noteLog` IS DROPPED OUTRIGHT, NOT PROJECTED, and it must stay dropped.
 *  It was 37.8% of this payload on a 140-task project — the single largest
 *  field by a factor of five — while `lib/app-feature-guide.md` told the model
 *  four times that it has no tool for notes. The app was paying to ship data
 *  it had forbidden the model to use.
 *  ★★ The capability was RELOCATED, not deleted: `get_task` still returns the
 *  full `Task` including `noteLog` with its HTML, at roughly 112 tokens per
 *  task on demand instead of thousands in bulk. `get_task`'s tool description
 *  carries the read-only constraint. Pinned by "list_tasks carries no note log
 *  at all" and by the get_task control beside it — both are needed.
 *  ★ The other five list tools already project to `*Summary` types that carry
 *  no rich HTML at all, which is why only this one needed narrowing. */
export type TaskListItem = Omit<Task, "description" | "noteLog"> & {
  description: string;
};
```

Replace `slimTaskForList`:

```ts
export function slimTaskForList(task: Task): TaskListItem {
  const { description, noteLog, ...rest } = task;
  return {
    ...rest,
    description: description ? htmlToPlainText(description) : "",
    ...(noteLog === undefined ? {} : { noteLog: noteLog.map(slimNoteEntry) }),
  };
}
```

with:

```ts
export function slimTaskForList(task: Task): TaskListItem {
  // `noteLog` is destructured only to EXCLUDE it from `rest`; it is
  // deliberately never re-attached. See TaskListItem's docstring.
  const { description, noteLog: _noteLog, ...rest } = task;
  return {
    ...rest,
    description: description ? htmlToPlainText(description) : "",
  };
}
```

★ `_noteLog` is prefixed but that buys nothing here — this repo sets no `argsIgnorePattern`, and the rule that would flag it applies to unused *variables* from destructuring, which eslint's default config does allow via `ignoreRestSiblings`. Run lint in Step 4 and, if it objects, use `delete`-free omission via `Omit` on a copied object rather than reintroducing the field.

Then remove any import in this file left unused by the deletions — check `NoteLogEntry` in particular:

```bash
grep -n "NoteLogEntry\|htmlToPlainText" src/app/chat-tools-lists.ts
```

- [ ] **Step 4: Run the tests, the typechecker and lint**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t7.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t7.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/chat-tools-lists.ts; echo "LINT_EXIT=$?"
```

Expected: all three green.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-tools-lists.ts src/app/chat-tools.test.ts
git commit --only src/app/chat-tools-lists.ts src/app/chat-tools.test.ts -m "perf(ai): drop the note log from the list_tasks projection"
```

---

## Task 8: Correct the two tool descriptions

**Files:**
- Modify: `src/app/chat-tool-defs.ts`
- Test: `src/app/chat-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/chat-tools.test.ts`, importing `TOOL_DEFS` from `./chat-tool-defs`:

```ts
describe("tool descriptions match what the tools actually return", () => {
  const defOf = (name: string) => {
    const d = TOOL_DEFS.find((x) => x.name === name);
    if (!d) throw new Error(`no tool def named ${name}`);
    return d;
  };

  it("list_tasks no longer advertises a note projection it does not perform", () => {
    expect(defOf("list_tasks").description).not.toContain("noteLog");
  });

  it("get_task states that the note log is read-only", () => {
    // The constraint lives HERE, in the tools array, rather than only in the
    // operating guide: this is the block the model reads while choosing what
    // to call, and the guide sits thousands of tokens away.
    const d = defOf("get_task").description;
    expect(d).toContain("noteLog");
    expect(d.toLowerCase()).toContain("read-only");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/chat-tools.test.ts -t "tool descriptions match" > /tmp/t8.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |expected" /tmp/t8.log
```

Expected: FAIL on both — `list_tasks` still names `noteLog`, `get_task`'s description is one sentence with no such clause.

- [ ] **Step 3: Rewrite the two descriptions**

In `src/app/chat-tool-defs.ts` (CRLF — use `Edit`), replace `list_tasks`'s description:

```ts
      "List the tasks in the app. Use this whenever you need to know what's in the app. Returns `{items, total}` — `total` is ALWAYS the number of tasks that exist, so you never need a second call to count them. Each item carries every task field, with `description` and each `noteLog` entry projected to PLAIN TEXT (the markup is stripped); call get_task when you need a description's original HTML, e.g. before editing it.",
```

with:

```ts
      "List the tasks in the app. Use this whenever you need to know what's in the app. Returns `{items, total}` — `total` is ALWAYS the number of tasks that exist, so you never need a second call to count them. Each item carries every task field EXCEPT the note log, with `description` projected to PLAIN TEXT (the markup is stripped). Call get_task when you need a description's original HTML, e.g. before editing it, or when you need one task's notes.",
```

and replace `get_task`'s description:

```ts
    description: "Fetch a single task by its numeric ID.",
```

with:

```ts
    description:
      "Fetch a single task by its numeric ID. Returns every field, including the original HTML of `description` and the task's full `noteLog`. The note log is READ-ONLY: no tool can add, edit or delete a note, so never offer to write one — the user does that in the task's notes window. Notes on RAID items and change items are not readable at all.",
```

- [ ] **Step 4: Run the tests and the typechecker**

```bash
npx vitest run src/app/chat-tools.test.ts > /tmp/t8.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t8.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: PASS, `TSC_EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat-tool-defs.ts src/app/chat-tools.test.ts
git commit --only src/app/chat-tool-defs.ts src/app/chat-tools.test.ts -m "fix(ai): state the note log's read-only contract on get_task"
```

---

## Task 9: Correct the operating guide's note claims

**Files:**
- Modify: `lib/app-feature-guide.md` (LF — `Write`/`Edit` both fine)
- Regenerate: `src/app/operating-guide-builtin.generated.ts`

Four bullets deny note access. Two are true and stay verbatim. One is task-only and is wholly false. One denies all three registers in a single sentence and is therefore true in part — **that one must be split, not rewritten as a single claim.** Correcting it as one statement makes it wrong in the opposite direction.

- [ ] **Step 1: Read the four bullets and confirm the split**

```bash
grep -n "no tool for notes\|no tool that can read or write a note" lib/app-feature-guide.md
```

Expected: exactly four lines. Line ~11 is the Overview bullet (all three registers, partly true), line ~30 is under Open Points (task-only, wholly false), and the remaining two are under RAID and Changes (wholly true).

- [ ] **Step 2: Rewrite the Overview bullet**

Replace this sentence inside the Overview `- Note log:` bullet:

```
You have no tool that can read or write a note — if the user asks about notes, say so and point them at the window rather than guessing from the description.
```

with:

```
You can read a TASK's notes with get_task, one task at a time; they are not included in list_tasks. You cannot write a note on anything, and you cannot read notes on RAID items or change items at all — for those, say so and point the user at the window rather than guessing from the description.
```

- [ ] **Step 3: Rewrite the Open Points bullet**

Replace this sentence inside the Open Points `- AI:` bullet:

```
It CANNOT read or write the note log: there is no tool for notes, so never answer a question about a task's notes from its description.
```

with:

```
It can READ a task's note log via get_task (list_tasks does not carry notes), but it CANNOT write one — there is no tool that adds, edits or deletes a note, so never offer to. Never answer a question about a task's notes from its description; fetch the task instead.
```

- [ ] **Step 4: Leave the RAID and Changes bullets untouched**

Both say "It CANNOT read or write the note log — there is no tool for notes." That is **true today**: `RaidSummary` and the change summary carry no `noteLog`, and `withRowTokens`'s full-row getter feeds token derivation rather than the model. Changing them would introduce the same class of false claim this task removes.

- [ ] **Step 5: Regenerate and verify**

```bash
node scripts/gen-operating-guide.mjs; echo "EXIT=$?"
grep -c "no tool for notes" src/app/operating-guide-builtin.generated.ts
git status --porcelain lib/app-feature-guide.md src/app/operating-guide-builtin.generated.ts
```

Expected: `EXIT=0`; the count drops from 4 to 2 (the RAID and Changes bullets); both files show as modified. Never hand-edit the generated file.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
git add lib/app-feature-guide.md src/app/operating-guide-builtin.generated.ts
git commit --only lib/app-feature-guide.md src/app/operating-guide-builtin.generated.ts -m "fix(ai): the guide denied note access the tools have always provided

Two of the four denials were true and are untouched. The Open Points one was
wholly false. The Overview one covered tasks, RAID and changes in a single
sentence and had to be split rather than rewritten."
```

---

## Task 10: Disclose the read capability where the notes are

**Files:**
- Modify: `src/app/note-log-panel.tsx`
- Modify: `src/app/use-notes-window.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (by script)
- Test: `src/app/note-log-panel.test.tsx`

★★★ `NoteLogPanel` is mounted for tasks, RAID items **and** changes. A blanket "the assistant can read these notes" line would be false on two of the three — the exact class of defect this slice exists to fix. The register is known in exactly one place, `notePanelPropsFor` in `use-notes-window.ts`, so that is where the flag is set.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/note-log-panel.test.tsx`, following its existing render helper and settings mock:

```tsx
it("discloses the assistant's read access when the log is AI-readable", () => {
  renderPanel({ aiReadable: true, aiEnabled: true });
  expect(screen.getByText(t("en-US", "noteLogAiReadOnly"))).toBeInTheDocument();
});

it("says nothing on a register the assistant cannot read", () => {
  // RAID and change note logs are genuinely unreadable by the assistant, so
  // the same line here would be a false claim on two of the three surfaces
  // this component serves.
  renderPanel({ aiReadable: false, aiEnabled: true });
  expect(screen.queryByText(t("en-US", "noteLogAiReadOnly"))).not.toBeInTheDocument();
});

it("says nothing when the AI master switch is off", () => {
  renderPanel({ aiReadable: true, aiEnabled: false });
  expect(screen.queryByText(t("en-US", "noteLogAiReadOnly"))).not.toBeInTheDocument();
});
```

If the existing helper does not take `aiEnabled`, extend it to set `settings.ai.enabled` and `settings.ai.apiKey` on the mocked settings, since `isAiEnabled` requires both.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/note-log-panel.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Unable to find" /tmp/t10.log
```

Expected: FAIL — the string and the prop do not exist.

- [ ] **Step 3: Add the EN string**

In `src/app/i18n.ts` (CRLF — use `Edit`), beside the other `noteLog*` keys:

```ts
  noteLogAiReadOnly: "The assistant can read these notes. It cannot add or change one.",
```

- [ ] **Step 4: Add the DE string by script**

Save as `scripts/tmp-de-note-readonly.mjs`, run, delete.

```js
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/i18n.de.ts";
const src = readFileSync(path, "utf8");

// Anchored on the noteLogAdd line, read from the file on 2026-09-09.
const anchor = '  noteLogAdd: "Notiz hinzufügen",\r\n';
const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error(`anchor matched ${n} times, expected exactly 1 — re-read the current value`);

const out = src.replace(
  anchor,
  anchor + '  noteLogAiReadOnly: "Der Assistent kann diese Notizen lesen. Er kann keine hinzufügen oder ändern.",\r\n',
);
if (out === src) throw new Error("no replacement made");
writeFileSync(path, out, "utf8");
console.log("patched", path);
```

```bash
grep -n "noteLogAdd" src/app/i18n.de.ts
node scripts/tmp-de-note-readonly.mjs; echo "EXIT=$?"
rm scripts/tmp-de-note-readonly.mjs
git ls-files --eol src/app/i18n.de.ts
```

Expected: `EXIT=0` and `i/lf w/crlf`. If the anchor throws, read the real `noteLogAdd` value from the grep and use it verbatim.

- [ ] **Step 5: Add the prop and render the line**

In `src/app/note-log-panel.tsx` (CRLF — use `Edit`), add to `NoteLogPanelProps`:

```ts
  /** Can the AI assistant read THIS register's notes?
   *
   *  ★★★ REQUIRED, not optional, and it is not a styling flag. This component
   *  serves tasks, RAID items and changes; `get_task` exposes a task's note
   *  log to the model and nothing exposes the other two. A blanket disclosure
   *  would therefore be a false claim on two of the three surfaces — the exact
   *  defect this prop exists to avoid. Set in ONE place, `notePanelPropsFor`
   *  in use-notes-window.ts, which is where the register is known. */
  aiReadable: boolean;
```

Add the import:

```ts
import { isAiEnabled } from "./settings-types";
```

(`useSettings` is already imported and called in this component.)

Destructure the prop:

```ts
  const { entries, onAdd, onEdit, onDelete, self, resources, lang, labelSuffix, aiReadable } = props;
```

and render the line as the first child of the composer block, immediately inside `<div className="shrink-0 border-b border-line p-3">`:

```tsx
        {aiReadable && isAiEnabled(settings.ai) && (
          <p className="mb-2 text-xs text-muted-foreground">{t(lang, "noteLogAiReadOnly")}</p>
        )}
```

★ Gated on the master switch as well as the register: telling a user with the assistant switched off what the assistant can read is noise about a feature they are not using.

- [ ] **Step 6: Set the flag at the one place that knows the register**

In `src/app/use-notes-window.ts` (CRLF — use `Edit`), in `notePanelPropsFor`:

```ts
    notePanelPropsFor: (kind, id) => ({
      entries: logOf(kind, id),
      ...noteHandlersFor(kind, id),
      self: notesSelf,
      resources,
      lang,
      labelSuffix: nameOf(kind, id),
      // Only `get_task` exposes a note log to the model; RaidSummary and the
      // change summary carry none, and withRowTokens' full-row getter feeds
      // token derivation rather than the model.
      aiReadable: kind === "task",
    }),
```

- [ ] **Step 7: Run the tests, the typechecker and lint**

```bash
npx vitest run src/app/note-log-panel.test.tsx src/app/use-notes-window.test.tsx src/app/notes-window.test.tsx src/app/i18n-encoding.test.ts > /tmp/t10.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t10.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/note-log-panel.tsx src/app/use-notes-window.ts; echo "LINT_EXIT=$?"
```

Expected: all green. Because `aiReadable` is required, tsc names every other construction site of `NoteLogPanelProps` — including test fixtures and `task-form-fields.tsx`'s `taskNotePanel` path if it builds props independently. Fix each by passing the correct value for its register; do not make the prop optional to silence them, since a default is exactly how a false claim would reach RAID and changes.

- [ ] **Step 8: Commit**

```bash
git add src/app/note-log-panel.tsx src/app/use-notes-window.ts src/app/note-log-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/note-log-panel.tsx src/app/use-notes-window.ts src/app/note-log-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts -m "feat(notes): disclose the assistant's read access on task note logs only"
```

---

## Task 11: Re-measure the saving and record both findings

**Files:**
- Create: a throwaway script in the session scratchpad (never committed)
- Modify: `docs/AGENTS/ai-assistant.md` (LF)
- Modify: `docs/open-followups.md` (LF)

The spec's 15,719-token figure is an **upper bound** taken from stored-row JSON. The projection strips markup from the two largest fields before the model sees them, so the real saving is smaller. Measure it rather than quoting the bound.

- [ ] **Step 1: Measure the real projection delta**

Write this to the session scratchpad (not the repo) and run it with `npx vite-node`. `jsonToWorkspace` needs a DOM, so read the JSON directly and call the projection on raw rows.

```ts
// measure-list-tasks.ts — scratchpad only, never committed
import { readFileSync } from "node:fs";
import { slimTaskForList } from "../../src/app/chat-tools-lists";
import type { Task } from "../../src/app/types";

const CHARS_PER_TOKEN = 2.92; // measured 2026-09-09 on block 0 of the real prompt

for (const size of ["small", "big", "huge"]) {
  const ws = JSON.parse(readFileSync(`sample-workspace-${size}.json`, "utf8"));
  const tasks: Task[] = ws.tasks ?? [];
  const after = JSON.stringify(tasks.map(slimTaskForList)).length;
  const withNotes = JSON.stringify(
    tasks.map((t) => ({ ...slimTaskForList(t), noteLog: t.noteLog })),
  ).length;
  const tok = (n: number) => Math.round(n / CHARS_PER_TOKEN);
  console.log(
    `${size.padEnd(6)} rows=${String(tasks.length).padStart(4)} ` +
      `with-notes=${String(tok(withNotes)).padStart(6)}t ` +
      `after=${String(tok(after)).padStart(6)}t ` +
      `saved=${String(tok(withNotes - after)).padStart(6)}t ` +
      `(${(((withNotes - after) / withNotes) * 100).toFixed(1)}%)`,
  );
}
```

★ The `withNotes` arm re-attaches the RAW `noteLog`, which is not what the old projection sent — the old one stripped each entry's `html`. If you want the exact old payload, reconstruct it by mapping each entry to `{...entry, html: undefined, text: entry.text}`. State in the write-up which of the two you measured; do not present one as the other.

- [ ] **Step 2: Record the measurement in the AI subsystem doc**

Add a bullet to `docs/AGENTS/ai-assistant.md` carrying: the measured saving with its date and the command that reproduces it; that `noteLog` is dropped from `list_tasks` and kept on `get_task`; and that the guide's four denials are now two. Cite the SYMBOL (`slimTaskForList`), never a `file:LINE` — `docs/AGENTS/` is inside the `doc-claims-check` ratchet and a new `path:LINE` citation fails the build.

Add a second bullet recording the new cap basis: the four weights, that buckets store raw and weight at read, that `usageTotal` is gone, and that `tokenMultiplier` is retired.

- [ ] **Step 3: Record why C1 is not being built**

Add an entry to `docs/open-followups.md` for the history-budget economics. It needs a `**Status:**` line with an ISO date that either cites a command or says `never machine-verified` — `followups-status-check` is blocking. This is modelled, not measured, so the honest Status is `never machine-verified`.

Content: a cached history bills at 0.1x, so trimming saves tenth-price tokens while each trim event pays a 1.25x rewrite of everything behind the cut; payback is ~47 turns at a 20,000-token history, ~26 at 50,000, ~19 at 100,000, against a 31,100-token fixed prefix — and only if the conversation continues that long after the cut. Note the one case that still favours it: bursty use, where the 5-minute cache TTL expires the prefix anyway.

Add the matching index row between `<!-- INDEX:BEGIN -->` and `<!-- INDEX:END -->` — `followups-index-check` is blocking and compares the two sets. Take the next free number from:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

★ A follow-up number is only reserved once it is on `origin/main`; two branches have minted the same one before. Check the register on `origin/main` too if another branch is in flight.

- [ ] **Step 4: Run the doc gates**

```bash
npm run docs:claims:check > /tmp/t11a.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t11a.log
npm run followups:status:check > /tmp/t11b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t11b.log
npm run followups:index:check > /tmp/t11c.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t11c.log
npm run docs:symbols:check > /tmp/t11d.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t11d.log
```

Expected: `EXIT=0` on all four. For the two followup gates, **exit 1 is drift and exit 2 is the gate unable to scan** — a 2 demands the opposite response to a 1 and must never be "fixed" by relaxing the check.

- [ ] **Step 5: Commit**

```bash
git add docs/AGENTS/ai-assistant.md docs/open-followups.md
git commit --only docs/AGENTS/ai-assistant.md docs/open-followups.md -m "docs(ai): record the measured list_tasks saving and the new cap basis"
```

---

## Task 12: Final verification

**Files:** none modified.

- [ ] **Step 1: Confirm no stray references survive**

```bash
grep -rn "tokenMultiplier\|DEFAULT_TOKEN_MULTIPLIER\|usageTotal\|slimNoteEntry\|NoteLogListEntry\|aiUsageCapBasisChanged\|aiTokenMultiplier" src/ scripts/ lib/; echo "EXIT=$?"
```

Expected: `EXIT=1` (grep found nothing). Any hit is a leftover — resolve it before proceeding.

- [ ] **Step 2: Run lint and typecheck across the source tree**

```bash
npx eslint src; echo "LINT_EXIT=$?"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: both 0. Use `npx eslint src`, not `npm run lint` — the npm script exits 1 on leftovers in gitignored `.worktrees/` and `.demo-tmp/` directories.

- [ ] **Step 3: Run the touched test files together**

One vitest process only. Never two at once.

```bash
npx vitest run \
  src/app/ai-usage.test.ts \
  src/app/ai-usage-context.test.tsx \
  src/app/settings-types.test.ts \
  src/app/settings-sections/ai-usage-panel.test.tsx \
  src/app/chat-tools.test.ts \
  src/app/note-log-panel.test.tsx \
  src/app/use-notes-window.test.tsx \
  src/app/notes-window.test.tsx \
  src/app/i18n-encoding.test.ts \
  > /tmp/final.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/final.log
```

Expected: `EXIT=0`. ★★ Assert `Test Files` equals **9**, the length of the list above — a mistyped path mixed with valid ones is dropped SILENTLY at exit 0, so a green run over 8 files is a false pass.

- [ ] **Step 4: Confirm the working tree is clean and the branch is local-only**

```bash
git status --porcelain
git log --oneline origin/main..HEAD
```

Expected: no output from the first; the commits from Tasks 1–11 from the second.

- [ ] **Step 5: Report and stop**

Do not push, open an MR, or merge. Report to the user: the measured saving from Task 11, the `Test Files` count from Step 3, and anything Step 1 turned up.

---

## Deferred — do not build in this plan

- **C2 row caps.** Five of the six list tools (`list_raid`, `list_changes`, `list_milestones`, `list_stakeholders`, `list_resources`) declare an empty `input_schema` properties object and return the whole array bare, so capping them means first giving each an envelope and a `total`. Its own slice.
- **The history budget (roadmap C1).** Recorded in `docs/open-followups.md` by Task 11 with the payback figures that argue against it.
- **Note writing.** No tool and no plan for one; the sanitizers drop `noteLog` because they are DOM-free.
- **A refusing `add_task_note` tool.** Considered and rejected in the spec: a model that sees the tool is *more* likely to promise a note edit, so it would routinise the failure it exists to catch.
