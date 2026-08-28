# Row-Unique Accessible Names Round 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buy file-size headroom by extraction, then close the remaining row-unique-accessible-name defects plus two data defects found behind them, and replace the enumeration method that made three rounds necessary.

**Architecture:** Two phases. Phase B is three refactor-only extractions, each its own independently-green commit — B1 is a hard prerequisite because `task-manager.tsx` sits at its file-size baseline with zero headroom, so any added line fails CI before it lands. Phase A then makes the behaviour changes, one register entry per task, each with a regression test whose vacuity traps are called out explicitly.

**Tech Stack:** Next.js 16 / React / TypeScript, vitest + @testing-library/react, Playwright + axe, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-27-row-unique-names-round-3-design.md`
**Branch:** `feat/row-unique-names-round-3`, already checked out at `186885b4`, branched off `main` at `adacc564` (0.262.1 "Swainston").
**Target release:** 0.263.0 "Okorafor" (spare codename: "Robson").

> ★★★ **THIS IS A DATED PRE-IMPLEMENTATION RECORD, NOT A LIVE DOCUMENT. Its `path:LINE` citations
> described the tree at the branch point (`adacc564`) and are deliberately NOT renumbered.**
> The plan's own tasks moved the lines it cites, so most of them now point somewhere else. A cite that
> still lands on the intended control is not reassurance either — it may be reading the POST-fix code,
> so it reads as if the plan had proposed what it in fact changed. Re-verify any line here against HEAD
> before acting on it, and if a claim still matters, restate it in a live doc rather than editing this
> one.
>
> ★★ **Rewriting a planning record to match today's tree destroys the only thing it is good for** — it
> says what was believed and measured BEFORE the work, which is what makes a plan reviewable against
> its outcome. Same treatment as `docs/security/findings-2026-07.md`. ★ Nothing gates these citations
> either way: `docs:claims:check` excludes `docs/superpowers/` outright, so no pipeline has ever read
> them and none will notice them rotting further.

---

## Rules that apply to EVERY task

Read these once. They are not repeated in each task.

★★★ **NEVER run `node scripts/check-file-sizes.mjs --update` anywhere in this slice.** It rewrites `docs/baselines/file-sizes.json` to *current* sizes for every file over 800. Running it after Task 1 would re-ratchet `task-manager.tsx` from its stale-high 3020 entry down to its new ~2830 and hand back **zero headroom**, silently undoing the whole phase. The stale-high entry IS the headroom.

★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail — that is `tail`'s status. Redirect, check unpiped, then read the file:

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

★★ **Measure every line count with the ratchet's own arithmetic**, which is ONE MORE than `wc -l`:

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"
```

★★ **`npx tsc --noEmit` after ANY test edit.** `next build` does not typecheck `*.test.tsx` and vitest never typechecks, so a test-only type error passes build + tests and fails CI. Note `tsc` exits **2** on diagnostics, not 1.

★★ **Never edit `src/app/i18n.de.ts` with the Edit tool.** It is CRLF and the Edit tool corrupts umlauts and curls double-quotes. Patch it with an anchored node utf8 write whose anchor matches `\r\n`. See Task 4 for the exact recipe.

★ **Use `npx eslint --max-warnings=0 src scripts e2e`**, not `npm run lint` — the latter exits 1 from gitignored `.demo-tmp/` leftovers.

★ **`src/app/*.ts(x)` are CRLF in the working tree** (`i/lf w/crlf`). The Edit tool preserves this; the Write tool and `sed -i` re-line the file to LF invisibly. Use Edit for existing source files.

★ Commit each task separately. Scope commits with `git commit --only <paths>` — `git add` does not scope a commit. Never use `--amend` on a commit you did not just create and verify by tree hash.

---

## File Structure

**Created:**
| File | Responsibility |
|---|---|
| `src/app/use-insight-recommendations.ts` | Deps-object hook: the whole Insights→Action-Loop SP2 block lifted out of `task-manager.tsx` |
| `src/app/use-register-tools.ts` | Deps-object hook: register-CRUD AI tools lifted out of `use-chat-dispatcher.ts` |
| `src/app/budget-panel-cards.tsx` | Presentational leaf: `ManualPercentCell` + `Cci` |
| `src/app/task-raid-badge.test.tsx` | New test file — the badge has none today |
| `scripts/rowname-surfaces-lib.mjs` | Pure enumeration logic for the row-name surface scanner |
| `scripts/check-rowname-surfaces.mjs` | CLI wrapper — the `npm run rownames:check` entry point |
| `scripts/rowname-surfaces-lib.test.mjs` | Unit tests for the lib |

**Modified:** `task-manager.tsx` · `use-chat-dispatcher.ts` · `budget-panel.tsx` · `vitest.config.ts` · `i18n.ts` · `i18n.de.ts` · `change-panel.tsx` · `raid-panel-toolbar.tsx` · `stakeholders-panel.tsx` · `column-config-popover.tsx` · `task-kanban-swimlanes.tsx` · `gantt.tsx` · `gantt-chart.tsx` · `gantt-rows.tsx` · `task-raid-badge.tsx` · `project-form-fields.tsx` · `resource-directory.tsx` · `package.json` · `docs/open-followups.md` · `AGENTS.md` · plus the six existing test files.

---

# PHASE B — extraction (refactor-only, NO behaviour change)

Phase B must fully precede Phase A. Each task must be independently green.

---

### Task 1: Extract the Insights→Action-Loop block from `task-manager.tsx`

**Why first:** `task-manager.tsx` measures **3020** against a baseline of **3020**. `file-size-ratchet` is BLOCKING in CI. Until this lands, *any* added line fails the pipeline.

**Files:**
- Create: `src/app/use-insight-recommendations.ts`
- Modify: `src/app/task-manager.tsx` (block at `:1708-1911`, const at `:185-189`, imports at `:47,102,103,105,106,107,108,110`)
- Modify: `vitest.config.ts` (`coverage.exclude`)

- [ ] **Step 1: Record the starting measurement**

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"
node -e "console.log(require('./docs/baselines/file-sizes.json')['src/app/task-manager.tsx'])"
```

Expected: `3020` and `3020`. If they differ, STOP and re-scope — the plan's arithmetic assumes this.

- [ ] **Step 2: Confirm the block boundaries before moving anything**

```bash
sed -n '1706,1712p;1909,1915p' src/app/task-manager.tsx
```

Expected: the block opens with the banner `// --- Insights → Action Loop (#6B SP2) ---` at `:1708` and the first line AFTER the block is `const cacheFxRates = ...` at `:1913`. The block is `:1708-1911` inclusive.

- [ ] **Step 3: Verify the dead-import claim with the compiler, not a grep**

The spec marks this UNVERIFIED. Comment out the eight import lines (`:47`, `:102`, `:103`, `:105`, `:106`, `:107`, `:108`, `:110`) **and** the block, then:

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Every error must name only the block you commented out. ★ Pay special attention to `:102` (`Insight`, `InsightActions`, `InsightRecommendation`) — these are TYPE positions, exactly where an identifier scan is weakest. If `tsc` reports a use elsewhere, that import stays. Restore the file before Step 4 (`git checkout` is deny-blocked here; revert by re-writing the commented lines).

- [ ] **Step 4: Create the hook file**

Move `:1708-1911` verbatim into a `useInsightRecommendations(deps)` function, plus the module const from `:185-189`. Structure:

```ts
// Deps-object hook factory extracted from task-manager.tsx (Phase 3 convention).
// Holds the Insights → Action Loop (#6B SP2) wiring.
//
// ★★★ CALL SITE PLACEMENT IS LOAD-BEARING. This block's original comment said it
// lived "after `dispatcher` exists" — confirmInsightRecommendation replays proposed
// tool calls through the useChatDispatcher result. The call must stay AFTER
// useChatDispatcher and BEFORE useFxRates.
const ENTITY_DIGEST_TEXT_CAP = 200;

export function useInsightRecommendations(deps: InsightRecommendationDeps) {
  // ... moved body, verbatim ...
  return {
    insightActions,
    insightGeneratingId,
    cancelInsightRecommendation,
    confirmInsightRecommendation,
    reviewInsight,
    reviewPlan,
    setReviewInsightId,
  };
}
```

★★ **Four things must survive the move unchanged:**
1. `useInsightRecommendRunner` is a SIDE-EFFECTING hook, not a value. It must move WITH the block or the background recommendation runner silently stops.
2. `reviewInsight` is deliberately NOT memoized — a bare `.find()` recomputed every render, and `reviewPlan`'s `useMemo` depends on that fresh identity. Do not "tidy" it into a `useMemo`.
3. `confirmInsightRecommendation`'s `setReviewInsightId(null)` runs BEFORE any `await` and is the documented double-click guard. Do not reorder.
4. Nine names must NOT be returned — they are internal: `applyInsightRecommendation`, `buildInsightGroundingIndex`, `buildInsightRecommendContext`, `generateInsightRecommendation`, `onApplyRecommendationInsight`, `onGenerateRecommendationInsight`, `onRejectRecommendationInsight`, `resolveInsightEntity`, `reviewInsightId`.

- [ ] **Step 5: Type the deps object against the compiler**

Do NOT hand-write the dep list from a grep. Declare `InsightRecommendationDeps` with the fields `tsc` demands, adding them one error at a time:

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

The spec estimates ~23 deps with ~2 known false positives (`s`, `capture` — destructuring artifacts). The compiler is the authority.

- [ ] **Step 6: Wire the call site**

In `task-manager.tsx`, replace the removed block with the call, positioned **exactly where the block was** — after `useChatDispatcher` (`:1694-1706`), before `useFxRates` (`:1913-1914`):

```tsx
const {
  insightActions,
  insightGeneratingId,
  cancelInsightRecommendation,
  confirmInsightRecommendation,
  reviewInsight,
  reviewPlan,
  setReviewInsightId,
} = useInsightRecommendations({ /* deps typed in Step 5 */ });
```

- [ ] **Step 7: Verify all seven consumers still resolve**

The seven returned names are consumed in three places inside `task-manager.tsx`: `workspaceProps` (`:2157-2388`), `modalsBlock` (`:2677-2802`), and — ★ easy to miss — the `RecommendationReviewModal` mount at `:2680`, which sits OUTSIDE `modalsBlock`.

```bash
grep -rn "insightActions\|insightGeneratingId\|cancelInsightRecommendation\|confirmInsightRecommendation\|reviewInsight\b\|reviewPlan\b\|setReviewInsightId" src e2e --include=*.ts --include=*.tsx | grep -v "use-insight-recommendations.ts"
```

Expected: hits in `task-manager.tsx` plus `dashboard-panel.tsx`, `dashboard-tile-bodies.tsx`, `workspace-section.tsx`, `workspace-section-types.ts`. ★ Every one of the latter is a **prop name on the receiving side, not an import** — nothing outside `task-manager.tsx` changes.

- [ ] **Step 8: Add the coverage exclusion**

`vitest.config.ts` has no `use-*.ts` glob — thirteen `.ts` files are listed BY NAME. Add to `coverage.exclude`, in the block of Phase-3 hooks:

```
        "src/app/use-insight-recommendations.ts",
```

★★ **Record the honest caveat in the commit message, not a false one in the code.** That exclude block's comment says its members "are not unit-testable in isolation". `resolveInsightEntity` and `confirmInsightRecommendation` are real logic and *are* testable, so this stretches the stated rationale. It is coverage-NEUTRAL (the code is unmeasured today inside the excluded `.tsx`), which is the actual justification. Do not edit that comment to claim otherwise. Task 16 files the follow-up.

- [ ] **Step 9: Verify the measurement and the gates**

```bash
node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src scripts e2e; echo "EXIT=$?"
npx vitest run src/app/task-manager.characterization.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: ~2830 (down from 3020), all four EXIT=0. ★ Do NOT run `--update` to make `size:check` pass — if it fails, the extraction is wrong.

- [ ] **Step 10: Commit**

```bash
git commit --only src/app/task-manager.tsx src/app/use-insight-recommendations.ts vitest.config.ts -m "refactor: extract insight recommendations hook from task-manager"
```

---

### Task 2: Extract register-CRUD tools from `use-chat-dispatcher.ts`

**Files:**
- Create: `src/app/use-register-tools.ts`
- Modify: `src/app/use-chat-dispatcher.ts` (tools `:479-675`, refs `:107-110`, effects `:142-153`, imports `:9-12,43-46`, destructure `:70-77`)
- Modify: `src/app/use-chat-dispatcher.test.tsx` (one stale comment), `src/app/chat-tool-defs.ts` (one stale comment)

- [ ] **Step 1: Record the starting measurement**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-dispatcher.ts','utf8').split('\n').length)"
```

Expected: `799`. The cap is a flat 800 with NO baseline entry, so 800 passes and 801 fails as `NEW file over 800`. Headroom is ONE line.

- [ ] **Step 2: Confirm the eight moved imports are exclusive**

```bash
for s in sanitizeRaidItem sanitizeChangeItem sanitizeMilestone sanitizeStakeholder toRaidSummary toChangeSummary toMilestoneSummary toStakeholderSummary; do
  echo "$s: $(grep -c "$s" src/app/use-chat-dispatcher.ts) total"
done
```

Each must appear only on its import line and inside `:479-675`. Confirm by eye with `grep -n`.

- [ ] **Step 3: Create the hook**

```ts
export function useRegisterTools(deps: RegisterToolsDeps) {
  // moved refs, moved sync effects, then:
  return useMemo(() => ({ listRaid, createRaid, /* ... through */ deleteStakeholder }), [/* deps */]);
}
```

- [ ] **Step 4: Wire it and set the dep array correctly**

```tsx
const registerTools = useRegisterTools({ /* deps */ });
```

Spread `registerTools` into the dispatcher `useMemo` and **add it to that memo's dep array**.

★★★ **This is the trap.** The dispatcher's `useMemo` at `:265` has deliberately narrow deps (`[args.isReadOnly, documentTools]` at `:794`), with a comment explaining that a memo'd tool object captured by the spread MUST be a dep or the first render's tools freeze into every later dispatcher. `registerTools` is the same shape and needs the same treatment. Getting it wrong serves stale tools after a read-only toggle — **no gate catches this, and the existing suite may not either.** Verify by reading `:794` and matching the pattern `documentTools` already follows.

- [ ] **Step 5: Fix the two comments this invalidates**

Both cite counts that this extraction changes. Leaving them is the "false coverage claim" failure mode — a stale count reads as verified.

- `src/app/use-chat-dispatcher.test.tsx:2551` cites `logActivityAs?.("ai"` = 23. Re-measure after the move and update:
  ```bash
  grep -c 'logActivityAs?.("ai"' src/app/use-chat-dispatcher.ts
  ```
- `src/app/chat-tool-defs.ts:410` cites `grep -c logActivity`. Re-measure and update the same way.

★ Do not copy the plan's predicted values (11 and 16) — run the greps and write what they return.

- [ ] **Step 6: Verify — no new coverage entry, no new test file**

★ Verified precedent: `use-document-tools.ts` (455 lines) was extracted from this same hook, is NOT in `coverage.exclude`, has no test file, and stays covered through the existing dispatcher harness because it is still reached via the same dispatcher object. Confirm the precedent still holds:

```bash
grep -c "use-document-tools" vitest.config.ts
```

Expected: `0`. Do NOT add a `coverage.exclude` entry for `use-register-tools.ts`.

- [ ] **Step 7: Run the gates**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-dispatcher.ts','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/use-chat-dispatcher.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|threshold" /tmp/cov.log | head
```

Expected: ~578, all EXIT=0. The coverage run matters here because both files are gated.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts src/app/use-chat-dispatcher.test.tsx src/app/chat-tool-defs.ts -m "refactor: extract register CRUD tools from chat dispatcher"
```

---

### Task 3: Extract `ManualPercentCell` + `Cci` from `budget-panel.tsx`

★★ **This extraction is INSURANCE, not a prerequisite.** §262's "no headroom" premise does not survive counting — the Task 9 fix DELETES ~20 lines of deferral comments it replaces, so its net delta is negative. If this task fights, drop it and proceed; Task 9 still fits.

**Files:**
- Create: `src/app/budget-panel-cards.tsx`
- Modify: `src/app/budget-panel.tsx` (`ManualPercentCell` `:61-118`, `Cci` `:157-180`, imports `:8,9,26,36,38`)

- [ ] **Step 1: Measure**

```bash
node -e "console.log(require('fs').readFileSync('src/app/budget-panel.tsx','utf8').split('\n').length)"
```

Expected: `795`, flat cap 800, headroom 5.

- [ ] **Step 2: Move both components verbatim, exporting them**

Both are already standalone, fully prop-driven, with explicit inline prop types and zero render-scope capture.

★ **Two comments MUST travel with the code:**
1. `ManualPercentCell:77-82` — clearing must write `undefined`, never `0`, or `bucketPercentComplete` treats it as a real override pinning the bucket at 0% forever.
2. `ManualPercentCell:89-101` — `budget-bucket-modal.tsx:493-501` renders a SECOND control with the same `budgetPercentComplete` label; the panel copy is bucket-qualified and the modal's is bare. **Task 9 must not assume the two are one control.**

- [ ] **Step 3: Remove the five imports that become unused**

`:8` `bucketPercentComplete` · `:9` `describeClamp` · `:26` `useCommitDraft` · `:36` `type { Health }` · `:38` `FOCUS_RING, TRANSITION`. Under `--max-warnings=0` removing them is not optional.

★ These STAY (other uses in the file): `InfoTooltip` (6), `RagBadge` (3), `CciValue` (5), `formatCurrency` (1), `Task` (1), `Lang` (1).

- [ ] **Step 4: Gates**

```bash
node -e "console.log(require('fs').readFileSync('src/app/budget-panel.tsx','utf8').split('\n').length)"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src scripts e2e; echo "EXIT=$?"
npx vitest run src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx src/app/budget-bucket-modal.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: ~710, all EXIT=0. ★ No test changes: all three test files reach these components through rendered output, never by import. `.tsx` is coverage-excluded by class, so no `vitest.config.ts` edit.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/budget-panel.tsx src/app/budget-panel-cards.tsx -m "refactor: extract budget panel cell components"
```

---

# PHASE A — round 3 behaviour changes

---

### Task 4: Add the eight new i18n keys

**Files:** `src/app/i18n.ts` · `src/app/i18n.de.ts`

- [ ] **Step 1: Confirm all eight names are unused**

```bash
for k in changeFilterType changeFilterStatus raidFilterCategory raidFilterSeverity raidFilterStatus raidFilterOwner stakeholderFilterName colConfigToggleColumn; do
  echo "$k: $(grep -rc "$k" src/app/i18n.ts)"
done
```

Expected: `0` for all eight.

- [ ] **Step 2: Add the EN keys** (Edit tool is fine for `i18n.ts`)

```ts
  changeFilterType: "Filter by type",
  changeFilterStatus: "Filter by status",
  raidFilterCategory: "Filter by category",
  raidFilterSeverity: "Filter by severity",
  raidFilterStatus: "Filter by status",
  raidFilterOwner: "Filter by owner",
  stakeholderFilterName: "Filter by name",
  colConfigToggleColumn: "Show column – {0}",
```

★ `colConfigToggleColumn` uses a 0-based positional placeholder — `t(lang, key, a)` → `{0}`. ★ The separator is an EN DASH (U+2013) with spaces, matching `rowLabel`'s existing separator.

- [ ] **Step 3: Add the DE keys with an anchored node write**

★★★ **Do NOT use the Edit tool on `i18n.de.ts`** — it corrupts umlauts and curls double-quotes even in umlaut-free strings. The file is CRLF, so a `\n` anchor silently no-ops; match `\r\n`.

```bash
node -e '
const fs=require("fs");const p="src/app/i18n.de.ts";
let s=fs.readFileSync(p,"utf8");
const anchor="  colConfigTitle: \"Spalten konfigurieren\",\r\n";
if(s.split(anchor).length!==2){console.error("ANCHOR NOT UNIQUE");process.exit(1);}
const add=[
"  changeFilterType: \"Nach Typ filtern\",",
"  changeFilterStatus: \"Nach Status filtern\",",
"  raidFilterCategory: \"Nach Kategorie filtern\",",
"  raidFilterSeverity: \"Nach Schweregrad filtern\",",
"  raidFilterStatus: \"Nach Status filtern\",",
"  raidFilterOwner: \"Nach Verantwortlichem filtern\",",
"  stakeholderFilterName: \"Nach Name filtern\",",
"  colConfigToggleColumn: \"Spalte anzeigen – {0}\","
].join("\r\n")+"\r\n";
fs.writeFileSync(p,s.replace(anchor,anchor+add),"utf8");
console.log("OK");
'
```

- [ ] **Step 4: Verify parity, encoding and line endings**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > /tmp/i18n.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/i18n.log
git ls-files --eol src/app/i18n.de.ts
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('lone LF:',(s.match(/(?<!\r)\n/g)||[]).length)"
```

Expected: tsc EXIT=0 (it enforces EN/DE key parity), encoding test passes, `i/lf w/crlf`, **lone LF count 0**. A non-zero lone-LF count means the file was re-lined — revert and redo.

★ Methodology note so nobody chases a ghost: a naive `^  key:` regex over the two dictionaries reports EN 3784 / DE 3782. That is NOT parity drift — the two EN extras are `lang` and `key`, the parameter names in the `t(lang, key, …)` signature.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts -m "i18n: add filter and column-toggle keys for name disambiguation"
```

---

### Task 5: §261 — distinct filter names in `change-panel.tsx`

**Files:** Modify `src/app/change-panel.tsx:418,432` · Test `src/app/change-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

★★★ **Do NOT pass `requireCollisionSeed`.** It defaults to `false`, which is correct here: this fix produces DISTINCT names, not occurrence indexing, so post-fix nothing collides and `requireCollisionSeed: true` would throw **on correct code**. Anti-vacuity comes from the positive assertions instead.

★★★ **Do NOT scope to `<tbody>`, and do NOT narrow `roles`.** The existing tests could never have seen this defect precisely because they narrow to one role family (`:228` `["combobox"]`, `:299/:450/:864` default `["button"]`). Scoping to `<tbody>` excludes the toolbar filter, which is half the collision.

```tsx
it("gives the type/status filter, sort header and column toggle three distinct names", async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));

  expectRowUniqueNames({
    minControls: /* MEASURE in Step 2 */ 0,
    roles: ["combobox", "button", "checkbox"],
  });

  for (const name of [
    t("en-US", "changeFilterType"),
    t("en-US", "changeFieldType"),
    t("en-US", "colConfigToggleColumn", t("en-US", "changeFieldType")),
  ]) {
    expect(screen.getByRole(/* matching role */ "combobox", { name })).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: MEASURE the `minControls` floor — never guess it**

★★★ `minControls` guarantees ONLY that the scope is non-empty. It counts CONTROLS of the requested roles over the whole document unless scoped — a panel toolbar alone satisfies any plausible floor. A loose floor silently re-admits a narrowed `roles` array. Print the real count and use it exactly:

```tsx
// temporary, delete after reading:
console.log(screen.getAllByRole("combobox").length, screen.getAllByRole("button").length, screen.getAllByRole("checkbox").length);
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/app/change-panel.test.tsx -t "three distinct names" > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |duplicate" /tmp/t5.log
```

Expected: FAIL, reporting the duplicated name.

- [ ] **Step 4: Fix the two filter call sites**

`change-panel.tsx:418` → `aria-label={t(lang, "changeFilterType")}`; `:432` → `aria-label={t(lang, "changeFilterStatus")}`.

★ Leave `:269` and `:274` ALONE — those are export column headers, not controls, and must keep the `changeField*` keys. ★ Leave the `SortResizeTh` labels at `:535`/`:544` alone — the column keeps its own name.

- [ ] **Step 5: Rewrite the stale comment**

`change-panel.test.tsx:922-928` documents scoping to `<tbody>` because of "a real but cross-ROLE, pre-existing naming overlap". That overlap is now fixed. Rewrite the comment to say the collision was closed and point at the new test — do not delete it silently.

- [ ] **Step 6: Verify**

```bash
npx vitest run src/app/change-panel.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/change-panel.tsx src/app/change-panel.test.tsx -m "fix(a11y): distinct names for change-panel filters, headers and column toggles"
```

---

### Task 6: §261 — distinct filter names in the RAID panel

**Files:** Modify `src/app/raid-panel-toolbar.tsx:90,105,120,133` · Test `src/app/raid-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Same shape as Task 5 (do not pass `requireCollisionSeed`; roles `["combobox","button","checkbox"]`; open the column popover first; measure `minControls`). Four keys here, and the collision spans two files — the filters are in `raid-panel-toolbar.tsx`, the sort headers in `raid-panel-rows.tsx`, and `raid-panel.tsx:53` mounts both into one DOM scope.

Assert all twelve expected names exist (4 filters × filter/header/toggle).

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/raid-panel.test.tsx -t "distinct names" > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log
```

- [ ] **Step 3: Fix the four filter call sites**

`raid-panel-toolbar.tsx`: `:90` → `raidFilterCategory`, `:105` → `raidFilterSeverity`, `:120` → `raidFilterStatus`, `:133` → `raidFilterOwner`.

★ Leave `raid-panel-rows.tsx:144,150,153,156` alone — the sort headers keep `raidCategory`/`raidSeverity`/`raidStatus`/`raidOwner`. ★ Leave `raid-panel-columns.ts:27,29,30,31` alone — Task 8 qualifies the checkbox generically.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/app/raid-panel.test.tsx > /tmp/t6b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6b.log
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/raid-panel-toolbar.tsx src/app/raid-panel.test.tsx -m "fix(a11y): distinct names for RAID filters, headers and column toggles"
```

---

### Task 7: §261 — distinct filter name in `stakeholders-panel.tsx`

**Files:** Modify `src/app/stakeholders-panel.tsx:313,314` · Test `src/app/stakeholders-panel.test.tsx`

★ This pair is a different role variant: the filter is `PaneSearchInput`'s `<input type="search">` (role **searchbox**), not a `<select>`. The test's `roles` must include `"searchbox"` or it cannot see the collision.

- [ ] **Step 1: Write the failing test** — roles `["searchbox", "button", "checkbox"]`, popover opened, `minControls` measured, no `requireCollisionSeed`.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/stakeholders-panel.test.tsx -t "distinct names" > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7.log
```

- [ ] **Step 3: Fix both call sites**

`:313` → `ariaLabel={t(lang, "stakeholderFilterName")}`; `:314` → `clearLabel={`${t(lang, "clear")} – ${t(lang, "stakeholderFilterName")}`}`. ★ Both, or the clear button still names the column.

★ Leave `:387` (`SortResizeTh`) alone.

- [ ] **Step 4: Rewrite the stale comment**

`stakeholders-panel.test.tsx:415-420` says "`roles` protects against the search box; the popover's closed-by-default state protects against the third control". Both crutches are now unnecessary. Rewrite it to record that the collision is fixed and point at the new test.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/app/stakeholders-panel.test.tsx > /tmp/t7b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7b.log
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx -m "fix(a11y): distinct name for stakeholder filter vs column"
```

---

### Task 8: §261 — qualify the `ColumnConfigPopover` checkbox

★ This single change closes the third collision leg in **all five** consumers at once, including `milestones-panel` and `tasks-section`, which §261 never named.

**Files:** Modify `src/app/column-config-popover.tsx:58-64` · Test `src/app/column-config-popover.test.tsx`

- [ ] **Step 1: Write the failing test** — render with two columns, assert each checkbox's accessible name is `"Show column – <label>"` and that it **contains** the visible label text.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/column-config-popover.test.tsx > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8.log
```

- [ ] **Step 3: Add the qualifier**

```tsx
<Checkbox
  size="sm"
  checked={!hidden.has(key)}
  onChange={() => onToggle(key)}
  aria-label={t(lang, "colConfigToggleColumn", t(lang, labelKey))}
/>
```

★★ The visible `{t(lang, labelKey)}` text stays as the label's content. WCAG 2.5.3 holds by **containment** — "Type" sits inside "Show column – Type". ★ Do NOT read 2.5.3 as requiring a prefix; that is stricter than the SC and flags conformant code elsewhere in this app.

- [ ] **Step 4: Verify no consumer regressed**

```bash
grep -rln "ColumnConfigPopover" src/app --include=*.tsx | grep -v test
npx vitest run src/app/column-config-popover.test.tsx src/app/change-panel.test.tsx src/app/raid-panel.test.tsx src/app/stakeholders-panel.test.tsx src/app/milestones-panel.test.tsx > /tmp/t8b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t8b.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/column-config-popover.tsx src/app/column-config-popover.test.tsx -m "fix(a11y): qualify column-toggle checkboxes with their action"
```

---

### Task 9: §262 — bucket-unique names in `budget-panel.tsx`

**Files:** Modify `src/app/budget-panel.tsx:505,506` and `src/app/budget-panel-cards.tsx` (`ManualPercentCell`) · Test `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

★★ **Trap: the percent input is `type="number"`, so its role is `spinbutton`, not `textbox`.** A `roles: ["button"]` scan silently misses half the fix.

★★ **Trap: scope it.** `budget-panel.test.tsx:973-978` already records that document-wide scope is unusable here — pre-existing unqualified "Edit bucket"/"Close bucket"/"Remove bucket" buttons and CCI tooltip collisions. Scope to the bucket-card container.

```tsx
it("keeps every bucket control bucket-unique when two buckets share a name", () => {
  renderPanel({ buckets: [{ name: "PAM", /* ... */ }, { name: "PAM", /* ... */ }] });
  expectRowUniqueNames({
    minControls: /* MEASURE */ 0,
    roles: ["button", "spinbutton"],
    scope: /* the bucket-card container element */,
    requireCollisionSeed: true,
  });
});
```

★ `requireCollisionSeed: true` IS appropriate here — this fix is occurrence indexing, so "PAM (1)"/"PAM (2)" strip to a genuine collision seed.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/budget-panel.test.tsx -t "bucket-unique" > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9.log
```

Expected: FAIL with two identical `"Reorder bucket … – PAM"` names.

- [ ] **Step 3: Build the token map**

In the `BudgetPanel` body:

```tsx
const bucketTokens = useMemo(
  () => buildRowTokens(bucketRows.map((br) => ({ id: br.bucketId, name: br.name }))),
  [bucketRows],
);
```

★★★ Use `buildRowTokens` **directly over the ORDERED rows**, NOT `useRowTokens` over `buckets`. Tokens number by RENDERED order, and the rendered list is reordered by `bucketOrder` (`:366`), not storage order. Bucket ids are `number`, so `useRowTokens` is type-compatible — which is exactly what makes it the tempting wrong answer.

- [ ] **Step 4: Apply the token to both controls**

`budget-panel.tsx:505` → `ariaLabel={rowLabel(t(lang, "budgetReorderHandle"), bucketTokens.get(br.bucketId) ?? br.name)}`.

`ManualPercentCell` gains a **new required prop** `rowToken: string` and uses it in place of `bucket.name` at `:102`. ★ It is a per-item component with no sibling visibility — it cannot disambiguate itself, so the token must be threaded in.

- [ ] **Step 5: Delete the deferral comments the fix replaces**

`:96-105` and `:497-504` document why this was deferred. The fix lands; the comments go. ★ This is why the net line delta is negative.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx > /tmp/t9b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t9b.log
node -e "console.log(require('fs').readFileSync('src/app/budget-panel.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/budget-panel.tsx src/app/budget-panel-cards.tsx src/app/budget-panel.test.tsx -m "fix(a11y): bucket-unique names for budget reorder and percent controls"
```

---

### Task 10: §266 — lane-unique names in `task-kanban-swimlanes.tsx`

**Files:** Modify `src/app/task-kanban-swimlanes.tsx:143,149,158,172` · Test `src/app/task-kanban-swimlanes.test.tsx`

- [ ] **Step 1: Write the failing test**

★★★ **Trap: the remove button only renders when the lane is EMPTY.** `:146` is `const canRemove = lane.resourceId != null && isEmptyLane;`. The fixture MUST seed two same-named directory resources via `extraLaneIds` with **zero tasks on either**, or zero remove buttons render and the test observes nothing while passing.

```tsx
it("gives twin same-named lanes distinct remove-lane names", () => {
  renderSwimlanes({
    resources: [{ id: 1, firstName: "John", lastName: "Smith" }, { id: 2, firstName: "John", lastName: "Smith" }],
    tasks: [],
    extraLaneIds: ["res:1", "res:2"],
  });
  expectRowUniqueNames({ minControls: /* MEASURE */ 0, roles: ["button"], requireCollisionSeed: true });
  expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toHaveLength(new Set(/* same */).size);
});
```

★ `task-kanban-swimlanes.test.tsx:98-100` carries a comment saying the helper was deliberately skipped for want of controls — that was the SINGLE-lane case. Two empty twin lanes render two buttons. Update that comment.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/task-kanban-swimlanes.test.tsx -t "twin same-named lanes" > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log
```

- [ ] **Step 3: Build the token map from the COMPUTED label**

★★★ **REGISTER CORRECTION — §266's fix shape is wrong on this point.** Build from the computed `laneLabel`, NOT from `lane.label`. `:143` substitutes `t(lang,"swimlaneUnassigned")` for the unassigned lane, whose raw label is `""`; tokenising the raw field names that lane off an empty string.

```tsx
const laneLabels = grouping.lanes.map((lane) => ({
  id: lane.key,
  name: lane.key === UNASSIGNED_LANE ? t(lang, "swimlaneUnassigned") : lane.label,
}));
const laneTokens = useMemo(() => buildRowTokens(laneLabels), [/* deps */]);
```

★ Lane ids are strings; `buildRowTokens` is generic over `Id` so this is fine. `useRowTokens` is constrained to a numeric `id` and does NOT fit.

- [ ] **Step 4: Apply the token to all three consumers**

`:149` `<section aria-label={laneToken}>` · `:158` remove button · `:172` `swimlaneCell`. ★ Tokenising once fixes all three at zero extra cost. The `<section>` maps to role `region`, so its duplicate IS exposed to AT; `:172`'s div carries no role and is largely inert, but consistency costs nothing.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/app/task-kanban-swimlanes.test.tsx > /tmp/t10b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10b.log
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/task-kanban-swimlanes.tsx src/app/task-kanban-swimlanes.test.tsx -m "fix(a11y): lane-unique names for swimlane regions and controls"
```

---

### Task 11: §267 — row-unique names for Gantt task/milestone buttons and bar-drag handles

**Files:** Modify `src/app/gantt.tsx:388,670` · `src/app/gantt-chart.tsx:234,264` · `src/app/gantt-rows.tsx:169,358,366,374,464` · Test `src/app/gantt.test.tsx`

★★ **The test goes in `gantt.test.tsx`, NOT `gantt-rows.test.tsx`.** The latter is 72 lines and imports only `GanttMilestoneRow`; `GanttTaskRow` has no test at all and needs a synthetic bar to render in isolation. More importantly the DEFECT is that the map must REACH the row — an isolated row test passes with the threading broken.

- [ ] **Step 1: Write the failing test** — two tasks named "Alpha" and two milestones named "M1", `roles: ["button"]`, `requireCollisionSeed: true`, `minControls` MEASURED.

★ Seeding two tasks also exposes the bar-drag defect (six identically-named handles), so this one test covers both halves.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/gantt.test.tsx -t "unique" > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t11.log
```

- [ ] **Step 3: Build the maps from `rows`, split by kind**

★★★ **REGISTER CORRECTION — build from `rows` (already a `useMemo` at `gantt.tsx:388`), NOT from `visible`/`visibleMilestones`.** `row-tokens.ts` states the rule: pass rows in the order the USER navigates, as rendered. `buildGanttRows` interleaves and reorders, and `gantt-chart.tsx:232-233` DROPS any task with no bar (`if (!bar) return null`). Numbering against the pre-filter arrays can emit a "(2)" whose "(1)" is not on screen.

```tsx
const taskTokens = useMemo(
  () => buildRowTokens(rows.filter((r) => r.kind === "task").map((r) => ({ id: r.task.id, name: r.task.taskName }))),
  [rows],
);
const milestoneTokens = useMemo(
  () => buildRowTokens(rows.filter((r) => r.kind === "milestone").map((r) => ({ id: r.m.id, name: r.m.name }))),
  [rows],
);
```

- [ ] **Step 4: Thread two new props through `GanttChart` to the row components**

`gantt.tsx:670` passes `taskTokens` and `milestoneTokens`; `gantt-chart.tsx:234` passes the task token to `GanttTaskRow`, `:264` the milestone token to `GanttMilestoneRow`.

- [ ] **Step 5: Apply the tokens in `gantt-rows.tsx`**

The name buttons have **no `aria-label` at all** today — they take their accessible name from content. Add `aria-label={rowToken}` unconditionally. ★ With no collision the token IS the bare name, so this restates the visible content rather than changing behaviour for the common case, and 2.5.3 containment holds because `buildRowTokens` APPENDS its suffix.

★ The `#id` disambiguates neither button: on the task row it sits in a SIBLING `<span>` at `:166`, OUTSIDE the button; the milestone row renders no id at all.

★★★ **Also fix the three bar-drag handles at `:358`, `:366`, `:374`** — `role="button"` with `aria-label={t(lang, "ganttBarResizeStart"|"ganttBarMove"|"ganttBarResizeEnd")}` and NO row qualifier, so two tasks render SIX identically-named buttons. Wrap each in `rowLabel(t(lang, key), rowToken)`. This defect is in no register entry; Task 16 files it as fixed.

- [ ] **Step 6: Comment the residual — do NOT claim it closed**

`gantt-chart.tsx` drops any task with no bar, so a numbered "(2)" can still render with its "(1)" off screen. Add a comment at the token `useMemo` saying so, and file it in Task 16.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run src/app/gantt.test.tsx src/app/gantt-rows.test.tsx > /tmp/t11b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t11b.log
npx tsc --noEmit; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt" --workers=1; echo "EXIT=$?"
git commit --only src/app/gantt.tsx src/app/gantt-chart.tsx src/app/gantt-rows.tsx src/app/gantt.test.tsx -m "fix(a11y): row-unique names for Gantt rows and bar-drag handles"
```

★ `--workers=1` is required for any multi-view axe selection: `playwright.config.ts` runs CI serially but local at CPU count, and over-subscription produces `Test timeout` failures that name no rule and are NOT violations.

---

### Task 12: §269 — WCAG 2.5.3 containment for the RAID badge

**Files:** Modify `src/app/task-raid-badge.tsx:55` · Create `src/app/task-raid-badge.test.tsx`

★ The badge has **no test file today** — it is exercised only indirectly.

- [ ] **Step 1: Write the failing test**

★ `expectRowUniqueNames` does NOT fit — it checks 2.4.6 UNIQUENESS, not 2.5.3 CONTAINMENT, and the repo has no 2.5.3 helper. Assert directly:

```tsx
it("contains its visible glyph string inside its accessible name (WCAG 2.5.3)", () => {
  render(<RaidBadge refs={/* 2 R, 1 A */} rowToken="Alpha" lang="en-US" onJumpToRaid={() => {}} />);
  const btn = screen.getByRole("button");
  expect(btn.getAttribute("aria-label")!.toLowerCase())
    .toContain(btn.textContent!.trim().toLowerCase());
});
```

★ 2.5.3 is case-INSENSITIVE and position-INDEPENDENT — containment, never a prefix rule.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/task-raid-badge.test.tsx > /tmp/t12.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t12.log
```

Expected: FAIL — visible `"2R · 1A · 0I · 0D"` is not inside `"Referenced by 2 RAID item(s) – Alpha"`.

- [ ] **Step 3: Nest the existing helper — zero new keys**

```tsx
const mix = t(lang, "raidReferencedByMix", counts.R, counts.A, counts.I, counts.D);
// aria-label at :55:
aria-label={rowLabel(rowLabel(mix, t(lang, "raidReferencedBy", refs.length)), rowToken)}
```

→ `"2R · 1A · 0I · 0D – Referenced by 2 RAID item(s) – Alpha"`. ★ Containment satisfied verbatim; round 2's 2.4.6 `rowToken` preserved; only existing keys and the existing separator, so no untranslated literal and no i18n churn.

★ `title` at `:54` stays the bare count and is unaffected — `aria-label` wins the accessible name, `title` becomes the description.

- [ ] **Step 4: Add a 2.4.6 test too, so the new file guards both**

Render two badges with equal reference counts and different `rowToken`s; assert distinct names.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run src/app/task-raid-badge.test.tsx src/app/task-row.test.tsx src/app/task-kanban-card.test.tsx > /tmp/t12b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t12b.log
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/task-raid-badge.tsx src/app/task-raid-badge.test.tsx -m "fix(a11y): make RAID badge visible text part of its accessible name"
```

---

### Task 13: §270 — remove contacts by index, not by name (DATA DEFECT)

★★ **This is silent data loss, not a naming defect.** `project-form-fields.tsx:693` filters on `c.name !== cp.name`, so for two contacts sharing a name **either button deletes BOTH**. Renaming the buttons would have hidden it behind a nicer label.

**Files:** Modify `src/app/project-form-fields.tsx:693,694` · Test `src/app/project-form-fields.test.tsx`

- [ ] **Step 1: Write two failing tests**

```tsx
it("removes only the clicked contact when two share a name", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<ContactPersonsControl contactPersons={[{ name: "Bob Jones" }, { name: "Bob Jones" }]} onChange={onChange} lang="en-US" />);
  await user.click(screen.getAllByRole("button", { name: /remove/i })[0]);
  expect(onChange).toHaveBeenCalledWith([{ name: "Bob Jones" }]); // ONE survivor, not zero
});

it("gives whitespace-variant duplicates distinct accessible names", () => {
  render(<ContactPersonsControl contactPersons={[{ name: "Bob  Jones" }, { name: "Bob Jones" }]} onChange={() => {}} lang="en-US" />);
  expectRowUniqueNames({ minControls: /* MEASURE */ 0, roles: ["button"], requireCollisionSeed: true });
});
```

★ The whitespace case is reachable through the form: the add guard `hasName` (`:654`) trims but does **not** collapse internal whitespace, while accessible-name computation does. Exact duplicates additionally arrive via `sanitizeProjectMeta`, which does not dedupe an imported project.

- [ ] **Step 2: Run both and watch them fail**

```bash
npx vitest run src/app/project-form-fields.test.tsx -t "contact" > /tmp/t13.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t13.log
```

- [ ] **Step 3: Fix removal and naming together**

```tsx
onClick={() => onChange(contactPersons.filter((_, i) => i !== idx))}
aria-label={`${t(lang, "remove")} ${contactTokens.get(idx) ?? cp.name}`}
```

with a `buildRowTokens` map keyed by index built over the rendered list.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/app/project-form-fields.test.tsx > /tmp/t13b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t13b.log
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/project-form-fields.tsx src/app/project-form-fields.test.tsx -m "fix: remove the clicked contact only, and name duplicate rows distinctly"
```

---

### Task 14: §268 — dedupe the resource address list (DATA DEFECT + recorded answer)

★ **Recorded answer, not a deferral:** cross-row sharing of a mailbox is genuinely SAME-PURPOSE — both buttons copy the identical string — so WCAG 2.4.6 permits the shared name. **No qualifier.** Only the within-row repeat is a bug.

**Files:** Modify `src/app/resource-directory.tsx:411` · Test `src/app/resource-directory.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders one copy button per distinct address when email and emails overlap", () => {
  renderDirectory({ resources: [{ id: 1, email: "ops@acme.com", emails: ["ops@acme.com"] }] });
  expect(screen.getAllByRole("button", { name: t("en-US", "resourceEmailCopyLabel", "ops@acme.com") })).toHaveLength(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/resource-directory.test.tsx -t "distinct address" > /tmp/t14.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t14.log
```

Expected: FAIL, received 2.

- [ ] **Step 3: Dedupe at the build site**

`resource-directory.tsx:411`:

```tsx
const emailList = [...new Set([r.email, ...(r.emails ?? [])].filter((e): e is string => !!e))];
```

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run src/app/resource-directory.test.tsx > /tmp/t14b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t14b.log
npx tsc --noEmit; echo "EXIT=$?"
git commit --only src/app/resource-directory.tsx src/app/resource-directory.test.tsx -m "fix: render one copy button per distinct resource address"
```

---

### Task 15: §245 — the row-name surface scanner (built LAST)

★★★ **Whatever this finds is FILED, NOT FIXED.** That bound is the only thing keeping this slice from becoming round 4 inside round 3.

★ It is a **report, not a gate**, and must not be added to `.gitlab-ci.yml`. A real gate would have to render every panel with a collision fixture — precisely the thing the register keeps recording that only a unit test can do. Do not overclaim it.

**Files:** Create `scripts/rowname-surfaces-lib.mjs`, `scripts/check-rowname-surfaces.mjs`, `scripts/rowname-surfaces-lib.test.mjs` · Modify `package.json`

- [ ] **Step 1: Write the lib tests first**

Follow the existing `followup-claims-lib.test.mjs` triple pattern. Cover: a file with a per-row control and a matching test → CLEAN; one without → GAP; a control whose name comes from CONTENT with no `aria-label` (leg (b) — invisible to any attribute grep by construction) → detected.

★★★ **Do NOT put a `#!` shebang on the lib** — a shebang on an IMPORTED `.mjs` makes vitest throw a SyntaxError naming the WRONG file, while node, `--check` and esbuild all pass.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run scripts/rowname-surfaces-lib.test.mjs > /tmp/t15.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t15.log
```

- [ ] **Step 3: Implement the lib**

Enumerate by the three legs AGENTS.md prescribes, because a field-name grep alone has repeatedly missed real collisions:
(1) `aria-label` / `ariaLabel` with whitespace tolerance; (2) controls with **no** `aria-label`, whose name falls back to CONTENT; (3) shared per-row components handed a whole entity that compose a name inside their own file.

Cross-reference against test files asserting the property by CONTENT (`"accessible name"`, `"unique"`), not by test NAME — the name-grep bound is exactly what §245 records as provably incomplete.

- [ ] **Step 4: Wire the CLI and the npm script**

Add to `package.json`: `"rownames:check": "node scripts/check-rowname-surfaces.mjs"`.

★★ A new script also needs a `scriptsDescriptions` entry or `npm run docs:scripts:check` fails.

- [ ] **Step 5: Run it and FILE the findings**

```bash
npm run rownames:check > /tmp/rownames.txt 2>&1; echo "EXIT=$?"; cat /tmp/rownames.txt
npm run docs:scripts:check; echo "EXIT=$?"
```

Record the output verbatim for Task 16. **Fix nothing it reports.**

- [ ] **Step 6: Commit**

```bash
git commit --only scripts/rowname-surfaces-lib.mjs scripts/check-rowname-surfaces.mjs scripts/rowname-surfaces-lib.test.mjs package.json -m "chore: add row-name surface enumeration report"
```

---

### Task 16: Update the register and AGENTS.md

**Files:** Modify `docs/open-followups.md` · `AGENTS.md`

- [ ] **Step 1: Close the eight entries**

§261, §262, §266, §267, §268, §269, §270, §272.

★★ **An open-followups heading edit is a FOUR-place edit:** heading, table status, table anchor, and the `isClosed` witness. Missing one leaves the index disagreeing with the body — exactly the §250 defect below.

- [ ] **Step 2: Write the three register corrections into the entries themselves**

§261 said "six of the seven" — it is SEVEN of seven. §266's fix shape omitted that the token must come from the computed `laneLabel`. §267's fix shape named the wrong source array and missed the bar-drag defect. ★ Record these as corrections with their commands, not as silent edits.

- [ ] **Step 3: Fix the §250 index/heading desync**

Its index row says `open`; its heading says `CLOSED 2026-08-25 (0.260.1)`.

```bash
PYTHONIOENCODING=utf-8 python -c "
import re,io
L=io.open('docs/open-followups.md',encoding='utf-8').read().split('\n')
B=[i for i,l in enumerate(L) if l.strip()=='<!-- INDEX:BEGIN -->'][0]
E=[i for i,l in enumerate(L) if l.strip()=='<!-- INDEX:END -->'][0]
print([l for l in L[B:E] if '[§250]' in l])"
```

- [ ] **Step 4: Narrow §229 with the B4 evidence table**

Record that `use-storage-backend.ts` was surveyed and declined: four tests read it as raw source text as the anti-vacuity guards for the six-write-paths invariant, and simulating the extraction fails three of them. ★★ §229's own prohibition stands — do NOT close it by adding a baseline entry.

- [ ] **Step 5: File the new entries**

(a) The Gantt `!bar` residual from Task 11 Step 6. (b) The `budget-panel.tsx` 303-line bucket-card map extraction the panel-split convention prescribes. (c) The Task 1 coverage-exclude tension (logic excluded under a glue rationale). (d) Everything Task 15 reported.

★★ A register number is reserved only once it is on `origin/main` — two branches have already minted the same one. Check `origin/main` before choosing numbers, and renumber DESCENDING if renumbering.

- [ ] **Step 6: Update AGENTS.md**

Add `use-insight-recommendations.ts` to the "task-manager decomposition map" (it enumerates the Phase-3 hooks by name; a fourth belongs). ★ Do NOT add a count of row-token surfaces anywhere — AGENTS.md explicitly records that restoring one is a regression.

- [ ] **Step 7: Verify and commit**

```bash
head -1 docs/open-followups.md
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
git commit --only docs/open-followups.md AGENTS.md -m "docs: close round-3 entries, correct three fix shapes, fix the 250 desync"
```

★ `head -1` must print the H1. A doc gate suite can be fully green over a register whose H1 was destroyed — no gate reads structure.

---

### Task 17: Full gate run

- [ ] **Step 1: Run everything, unpiped**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src scripts e2e; echo "LINT=$?"
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
npm run docs:scripts:check; echo "SCRIPTS=$?"
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"; grep -E "Test Files|Tests |threshold" /tmp/cov.log
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "SHUF=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```

★ `test:shuffle` is not optional — this slice adds tests, and it is the ONLY local reproduction of the blocking `unit-tests-shuffled` job. ★ Never run two vitest processes at once. ★ A vitest red carrying `Failed to start forks worker` is machine contention, not evidence.

- [ ] **Step 2: Run the axe gate on the touched views**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt|RAID|Changes|Stakeholders|Budget" --workers=1; echo "EXIT=$?"
```

★ `--workers=1` is mandatory whenever more than one view is matched.

- [ ] **Step 3: Fix anything red, then re-run. Do NOT proceed to Task 18 with any gate red.**

---

### Task 18: Release — REQUIRES EXPLICIT USER SAY-SO

★★★ **STOP HERE. Do not execute this task until the user explicitly says to release.** Do not push, do not open an MR, do not merge on your own initiative. Report that Tasks 1-17 are complete and wait.

- [ ] **Step 1: Bump the version** — `src/app/version.ts`, all three constants together (`APP_VERSION` → `0.263.0`, `APP_BUILD_DATE`, `APP_MILESTONE` → `"Okorafor"`). ★ Use the Edit tool to preserve CRLF. ★ Bumping `APP_VERSION` while leaving `APP_MILESTONE` at the prior name is a shipped defect this repo has already made.

- [ ] **Step 2: Add the `CHANGELOG.md` entry** (LF file). ★ Never put a `[session link removed]...` URL in `CHANGELOG.md` or an MR description.

- [ ] **Step 3: Propagate the six satellites**

```bash
npm run version:sync; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```

★ Never hand-edit the satellites. ★ `version:check` exit **1 is drift**, exit **2 is the gate unable to do its job** — they demand opposite responses.

- [ ] **Step 4: Commit, push, open the MR, poll until green, then merge**

★★★ `glab mr merge` **defaults `--auto-merge=true`** — omission is NOT opt-out. Pass `--auto-merge=false` explicitly. ★ MERGE ONLY AFTER the pipeline is green.

- [ ] **Step 5: After merging, verify the merge introduced nothing**

```bash
git rev-parse '<merge>^{tree}' '<branch-tip>^{tree}'
```

Both must be identical. ★ `git diff-tree --cc --stat` is misleading here; the tree hash is the durable check.

---

## Self-Review

**Spec coverage:** B1→T1, B2→T2, B3→T3, B4 (declined)→T16 Step 4, A1→T4-T8, A2→T9, A3→T10, A4→T11, A5→T12, A6→T13, A7→T14, A8→T15, register→T16, gates→T17, version→T18. No gaps.

**Placeholder scan:** The `minControls: /* MEASURE */ 0` markers are deliberate and each carries a step explaining how to measure — a hardcoded floor would be the actual plan failure, since a loose floor silently re-admits a narrowed `roles` array.

**Type consistency:** `buildRowTokens(rows) → Map<Id, string>` and `rowLabel(verb, token) → string` are used consistently. `useRowTokens` is deliberately NOT used in Tasks 9, 10 or 13 — it is constrained to a numeric `id` and, for Task 9, would number by storage rather than rendered order.
