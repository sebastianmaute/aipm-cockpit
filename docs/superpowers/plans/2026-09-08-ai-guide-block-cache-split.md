# AI guide-block cache split (slice G) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a mid-conversation view switch from re-writing ~9.9k tokens of operating-guide text that did not change, by splitting the stable system block into a view-invariant half (which keeps the cache marker) and a view-scoped half (which does not).

**Architecture:** `selectActiveGuides` already returns the active guides in priority order, with the unscoped ones (leadership, App overview) leading. This slice partitions that list on view-scope, assembles it as TWO strings instead of one, and has `buildStableSystemBlocks` return two `SystemBlock`s with `cache_control` on the first. No new breakpoint is spent — the existing system marker moves earlier. Nothing the model reads changes, so no answer-quality eval is required.

**Tech Stack:** TypeScript, vitest, React (Next 16). Pure engine in `src/app/operating-guide.ts`; wire layer in `src/app/chat-api.ts`.

**Spec:** `docs/superpowers/specs/2026-09-08-ai-guide-block-cache-split-design.md`

---

## Read this before Task 1

★★★ **The header count is the whole defect, not the split.** `assembleGuideBlock` opens with
`You have N operating guides, in priority order.` and N varies by view (2, 3 or 4). That digit sits
ahead of ~9.9k tokens of byte-identical guide text, so the cache prefix breaks on every view switch.
The longest common prefix of the assembled block across the 34 nav-reachable views is **9
characters** (`AppView` has 35 members; `learning-insights` is deep-link-only and not nav-reachable,
and including it could not raise the figure). If you
split the array and leave one shared counted header in front, block 1 still differs per view and
this slice saves NOTHING while every test but the sweep passes. Task 3 is the gate.

★★ **"Always-on" means the wildcard rule `dimensionMatches` already uses, which is `undefined` OR
empty array.** A guide with `scope: { views: [] }` is a wildcard and matches every view. Partitioning
on `g.scope.views == null` alone misfiles it. Use the predicate in Task 1 exactly as written.

★ Every `src/app/*.ts(x)` file is **CRLF**. Use the Edit tool, which preserves it; the Write tool
re-lines a file to LF, which is invisible to `git diff` and breaks later anchors. Verify with
`git ls-files --eol <file>` → expect `i/lf w/crlf`.

★ Never read a gate's exit code through a pipe — redirect to a log, `echo "EXIT=$?"` INTO the log,
then grep the file. `npm run test:run | tail` reports `tail`'s status and discards the diagnostic.

★ Run only targeted vitest files, never the full suite, and never two vitest processes at once.

★★ **`/tmp` is SHARED across sessions on this machine and another session's log can clobber yours.**
Every command below writes to `$SCRATCH`. Set it once, to this session's own scratchpad directory,
before running anything:

```bash
SCRATCH="$(mktemp -d)"    # or the scratchpad path your harness gave you
echo "$SCRATCH"
```

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/operating-guide.ts` | pure guide engine (no React, no i18n) | **Modify** — add `partitionGuidesByViewScope` and `assembleGuideBlocks`; delete `assembleGuideBlock` |
| `src/app/operating-guide.test.ts` | engine unit tests | **Modify** — replace the `assembleGuideBlock` describe |
| `src/app/chat-api.ts` | wire layer / prompt assembly | **Modify** — `buildStableSystemBlocks` returns two blocks |
| `src/app/chat-api.system-prompt.test.ts` | prompt-shape tests | **Modify** — add the cross-view byte-identity sweep |
| `src/app/chat-panel.test.tsx` | send-path integration tests | **Modify** — two `toHaveLength(1)` assertions become 2 |
| `docs/AGENTS/ai-assistant.md` | subsystem reference | **Modify** — record the split and the owed measurement |

`assembleGuideBlock` has exactly one non-test consumer (`chat-api.ts`), verified with
`grep -rn "assembleGuideBlock" src/ --include=*.ts --include=*.tsx`, so replacing it outright is
safe and avoids leaving a second assembly path to drift.

---

## Task 1: Partition and assemble the two guide segments

**Files:**
- Modify: `src/app/operating-guide.ts`
- Test: `src/app/operating-guide.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe("assembleGuideBlock", ...)` block in `src/app/operating-guide.test.ts`
with this. Keep the existing `base(...)` helper and the other describes untouched.

```ts
describe("partitionGuidesByViewScope", () => {
  it("treats an absent views list as always-on", () => {
    const g = base({ id: "a", scope: {} });
    expect(partitionGuidesByViewScope([g])).toEqual({ alwaysOn: [g], viewScoped: [] });
  });

  // ★ An EMPTY array is a wildcard too — `dimensionMatches` returns true for
  //   both `undefined` and `[]`, so a guide scoped `views: []` applies on
  //   every view and must land in the always-on half. Partitioning on
  //   `views == null` alone misfiles it, and the misfile is invisible until a
  //   view switch silently stops hitting the cache.
  it("treats an EMPTY views list as always-on, not view-scoped", () => {
    const g = base({ id: "a", scope: { views: [] } });
    expect(partitionGuidesByViewScope([g])).toEqual({ alwaysOn: [g], viewScoped: [] });
  });

  it("puts a guide naming any view in the view-scoped half", () => {
    const g = base({ id: "a", scope: { views: ["budget"] } });
    expect(partitionGuidesByViewScope([g])).toEqual({ alwaysOn: [], viewScoped: [g] });
  });

  it("preserves the incoming order within each half", () => {
    const a = base({ id: "a", scope: {}, priority: 1 });
    const b = base({ id: "b", scope: { views: ["budget"] }, priority: 2 });
    const c = base({ id: "c", scope: {}, priority: 3 });
    expect(partitionGuidesByViewScope([a, b, c])).toEqual({ alwaysOn: [a, c], viewScoped: [b] });
  });
});

describe("assembleGuideBlocks", () => {
  it("returns two empty strings for no guides", () => {
    expect(assembleGuideBlocks([])).toEqual({ alwaysOn: "", viewScoped: "" });
  });

  it("counts ONLY the always-on guides in the always-on header", () => {
    const one = assembleGuideBlocks([
      base({ id: "a", name: "Always", content: "AAA", scope: {} }),
      base({ id: "b", name: "Budget", content: "BBB", scope: { views: ["budget"] } }),
    ]);
    const two = assembleGuideBlocks([base({ id: "a", name: "Always", content: "AAA", scope: {} })]);
    // ★★ THE POINT OF THE WHOLE SLICE: the always-on text must not move when
    //    the number of view-scoped guides changes.
    expect(one.alwaysOn).toBe(two.alwaysOn);
  });

  it("numbers the view-scoped guides after the always-on ones", () => {
    const r = assembleGuideBlocks([
      base({ id: "a", name: "Always", content: "AAA", scope: {} }),
      base({ id: "b", name: "Budget", content: "BBB", scope: { views: ["budget"] } }),
    ]);
    expect(r.alwaysOn).toContain('=== GUIDE 1 (priority 1) — "Always" ===');
    expect(r.alwaysOn).toContain("AAA");
    expect(r.viewScoped).toContain('=== GUIDE 2 (priority 1) — "Budget" ===');
    expect(r.viewScoped).toContain("BBB");
    // The view-scoped half must not restate the always-on content.
    expect(r.viewScoped).not.toContain("AAA");
  });

  it("numbers from 1 and uses the plain header when there are no always-on guides", () => {
    const r = assembleGuideBlocks([
      base({ id: "b", name: "Budget", content: "BBB", scope: { views: ["budget"] } }),
    ]);
    expect(r.alwaysOn).toBe("");
    expect(r.viewScoped).toContain('=== GUIDE 1 (priority 1) — "Budget" ===');
    expect(r.viewScoped).toContain("You have 1 operating guide");
    expect(r.viewScoped).not.toContain("additional");
  });
});
```

Update the import at the top of `src/app/operating-guide.test.ts`:

```ts
import {
  selectActiveGuides, partitionGuidesByViewScope, assembleGuideBlocks, guidesCharCount,
} from "./operating-guide";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/operating-guide.test.ts --reporter=dot`
Expected: FAIL — `partitionGuidesByViewScope is not a function` / `assembleGuideBlocks is not a function`.

- [ ] **Step 3: Implement**

In `src/app/operating-guide.ts`, DELETE the existing `assembleGuideBlock` function and replace it
with the following. Leave `selectActiveGuides`, `guidesCharCount`, `dimensionMatches`,
`GUIDE_CHAR_BUDGET` and the types untouched.

```ts
/** Is this guide active on EVERY view? `dimensionMatches` treats both an
 *  absent list and an EMPTY one as a wildcard, so this predicate must accept
 *  both — a guide scoped `views: []` really does apply everywhere, and
 *  misfiling it as view-scoped moves ~KB of stable text into the half that
 *  changes on navigation, silently costing the cache hit this split exists to
 *  protect. Pinned by "treats an EMPTY views list as always-on". */
function isAlwaysOn(g: OperatingGuide): boolean {
  return !g.scope.views || g.scope.views.length === 0;
}

/** Split the ACTIVE guides into the half that is identical on every view and
 *  the half that is not. Order within each half is preserved, so the priority
 *  ordering `selectActiveGuides` established still holds. */
export function partitionGuidesByViewScope(active: readonly OperatingGuide[]): {
  alwaysOn: OperatingGuide[];
  viewScoped: OperatingGuide[];
} {
  const alwaysOn: OperatingGuide[] = [];
  const viewScoped: OperatingGuide[] = [];
  for (const g of active) (isAlwaysOn(g) ? alwaysOn : viewScoped).push(g);
  return { alwaysOn, viewScoped };
}

const CONFLICT_RULE =
  "On conflict the earlier one wins; later guides refine but do not override unless they say so explicitly.";

function guideParts(guides: readonly OperatingGuide[], startIndex: number): string[] {
  return guides.map(
    (g, i) => `=== GUIDE ${startIndex + i} (priority ${g.priority}) — "${g.name}" ===\n${g.content}`,
  );
}

/** Assemble the active guides as TWO prompt segments.
 *
 *  ★★★ THE ALWAYS-ON HEADER COUNTS ONLY THE ALWAYS-ON GUIDES, and that is the
 *  entire point. The single-block predecessor opened with "You have N
 *  operating guides" where N included the view-scoped ones, so N moved from
 *  2 to 3 to 4 as the user navigated — putting a varying digit ahead of ~9.9k
 *  tokens of identical text and breaking the cache prefix on every view
 *  switch. Measured before this change: the longest common prefix of the
 *  assembled block across the 34 nav-reachable views (of 35 `AppView`
 *  members — `learning-insights` is deep-link-only) was 9 characters.
 *  Including it could not have raised that figure: a common prefix only
 *  shrinks as strings are added, and 9 (`"You have "`) is already the floor
 *  once the digit varies.
 *
 *  Numbering continues across the two segments so they cannot disagree about
 *  which guide is "GUIDE 3". */
export function assembleGuideBlocks(active: readonly OperatingGuide[]): {
  alwaysOn: string;
  viewScoped: string;
} {
  const { alwaysOn, viewScoped } = partitionGuidesByViewScope(active);

  const alwaysOnText =
    alwaysOn.length === 0
      ? ""
      : [
          `You have ${alwaysOn.length} operating guide${alwaysOn.length === 1 ? "" : "s"} that apply on every screen, in priority order. ${CONFLICT_RULE}`,
          ...guideParts(alwaysOn, 1),
        ].join("\n\n");

  // When there are no always-on guides at all (every built-in disabled) the
  // "additional" wording would be describing nothing, so this half falls back
  // to the plain header and numbers from 1.
  const viewHeader =
    alwaysOn.length === 0
      ? `You have ${viewScoped.length} operating guide${viewScoped.length === 1 ? "" : "s"}, in priority order. ${CONFLICT_RULE}`
      : `${viewScoped.length} additional operating guide${viewScoped.length === 1 ? "" : "s"} apply to the current screen, continuing the same priority order.`;

  const viewScopedText =
    viewScoped.length === 0
      ? ""
      : [viewHeader, ...guideParts(viewScoped, alwaysOn.length + 1)].join("\n\n");

  return { alwaysOn: alwaysOnText, viewScoped: viewScopedText };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/operating-guide.test.ts --reporter=dot`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Mutation-prove the wildcard predicate**

Change `isAlwaysOn`'s body to `return !g.scope.views;` (dropping the empty-array leg). Re-run the
file. Expected: exactly ONE test red — "treats an EMPTY views list as always-on, not view-scoped".
Restore the original body, then assert the revert landed in both directions:

```bash
grep -c "g.scope.views.length === 0" src/app/operating-guide.ts   # must be 1
git diff --stat -- src/app/operating-guide.ts                      # must show only your intended change
```

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/operating-guide.ts src/app/operating-guide.test.ts -m "feat(ai): split guide assembly into always-on and view-scoped segments"
```

---

## Task 2: Return two system blocks with the marker on the first

**Files:**
- Modify: `src/app/chat-api.ts`
- Test: `src/app/chat-api.system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Append this describe to `src/app/chat-api.system-prompt.test.ts`. It reuses the file's existing
`snapshot(...)` helper.

```ts
describe("buildStableSystemBlocks two-block split", () => {
  const guides: OperatingGuide[] = [
    {
      id: "always", name: "Leadership", content: "ALWAYSPROBE", enabled: true,
      priority: 1, scope: {}, builtIn: true,
    },
    {
      id: "budget", name: "Budget guide", content: "BUDGETPROBE", enabled: true,
      priority: 3, scope: { views: ["budget"] }, builtIn: true,
    },
  ];

  it("returns two blocks with cache_control on the FIRST only", () => {
    const blocks = buildStableSystemBlocks("en-US", snapshot({ currentView: "budget" }), guides, true, {});
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1].cache_control).toBeUndefined();
  });

  it("puts the always-on guide in block 0 and the view guide in block 1", () => {
    const blocks = buildStableSystemBlocks("en-US", snapshot({ currentView: "budget" }), guides, true, {});
    // Positive on BOTH sides first: a block dropped entirely satisfies every
    // `not.toContain` below, so the negatives alone would pass vacuously.
    expect(blocks[0].text).toContain("ALWAYSPROBE");
    expect(blocks[1].text).toContain("BUDGETPROBE");
    expect(blocks[0].text).not.toContain("BUDGETPROBE");
    expect(blocks[1].text).not.toContain("ALWAYSPROBE");
  });

  it("still returns two blocks when the view contributes no guide", () => {
    const blocks = buildStableSystemBlocks("en-US", snapshot({ currentView: "workload" }), guides, true, {});
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("ALWAYSPROBE");
    expect(blocks[1].text).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/chat-api.system-prompt.test.ts --reporter=dot`
Expected: FAIL — `expected [ …1 item… ] to have a length of 2 but got 1`.

- [ ] **Step 3: Implement**

In `src/app/chat-api.ts`, change the import on line 8:

```ts
import { selectActiveGuides, assembleGuideBlocks, type OperatingGuide } from "./operating-guide";
```

Then replace the tail of `buildStableSystemBlocks` — the `guideBlock` / `stableText` / `return`
lines — with:

```ts
  const segments = groundInGuides
    ? assembleGuideBlocks(selectActiveGuides(guides, {
        mode: snapshot.mode, modules: snapshot.enabledModules, view: snapshot.currentView,
      }))
    : { alwaysOn: "", viewScoped: "" };
  const stableText = [stableInstructions, segments.alwaysOn].filter(Boolean).join("\n\n");

  // ★★★ TWO BLOCKS, MARKER ON THE FIRST. Block 0 is byte-identical on every
  //     view, so its cache entry survives a view switch; block 1 holds only
  //     the current view's guide and deliberately carries NO marker. That
  //     spends no extra breakpoint — all four are already committed (tools 1,
  //     system 1, messages 2 via chat-cache-layout.ts) — and block 1 is still
  //     cached anyway, by the message-level breakpoints whose prefix contains
  //     it. Do NOT "tidy" this back into one block: the whole saving is that
  //     the view-scoped text sits AFTER the marker.
  return [
    { type: "text", text: stableText, cache_control: { type: "ephemeral" } },
    { type: "text", text: segments.viewScoped },
  ];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/chat-api.system-prompt.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit > $SCRATCH/g-tsc.log 2>&1; echo "EXIT=$?" >> $SCRATCH/g-tsc.log; grep -E "error TS|EXIT=" $SCRATCH/g-tsc.log
```
Expected: `EXIT=0`, no `error TS` lines. (`npx tsc --noEmit` exits **2** on diagnostics, not 1.)

- [ ] **Step 6: Commit**

```bash
git commit --only src/app/chat-api.ts src/app/chat-api.system-prompt.test.ts -m "feat(ai): return the stable system prompt as two blocks, marker on the view-invariant half"
```

---

## Task 3: The cross-view byte-identity sweep (this is the gate)

**Files:**
- Test: `src/app/chat-api.system-prompt.test.ts`

★★★ Without this test the slice can ship inert: split the array, leave the counted header, and every
other test above still passes while block 0 differs on every view and nothing caches. Do not weaken
it to a two-view check — a two-view test passes on any pair that happens to share a guide count,
which is exactly the defect.

- [ ] **Step 1: Write the failing test**

Append to `src/app/chat-api.system-prompt.test.ts`:

```ts
describe("block 0 is byte-identical across every view", () => {
  // A fixture spanning all three guide-count shapes the real app produces
  // (some views get 0 view-scoped guides, some 1, some 2). If block 0's
  // header counted the view-scoped guides, these would differ.
  const guides: OperatingGuide[] = [
    { id: "lead", name: "Leadership", content: "LEADPROBE", enabled: true, priority: 1, scope: {}, builtIn: true },
    { id: "overview", name: "App overview", content: "OVERVIEWPROBE", enabled: true, priority: 2, scope: {}, builtIn: true },
    { id: "budget", name: "Budget", content: "BUDGETPROBE", enabled: true, priority: 3, scope: { views: ["budget"] }, builtIn: true },
    { id: "raid1", name: "RAID a", content: "RAIDPROBEA", enabled: true, priority: 4, scope: { views: ["raid"] }, builtIn: true },
    { id: "raid2", name: "RAID b", content: "RAIDPROBEB", enabled: true, priority: 5, scope: { views: ["raid"] }, builtIn: true },
  ];
  // 0 view-scoped, 1 view-scoped, 2 view-scoped — the three real shapes.
  const views = ["workload", "budget", "raid"];

  it("emits the same block 0 on every view", () => {
    const blocks0 = views.map(
      (view) => buildStableSystemBlocks("en-US", snapshot({ currentView: view }), guides, true, {})[0].text,
    );
    expect(new Set(blocks0).size).toBe(1);
  });

  it("emits a DIFFERENT block 1 per view, so the sweep above is not comparing empty strings", () => {
    const blocks1 = views.map(
      (view) => buildStableSystemBlocks("en-US", snapshot({ currentView: view }), guides, true, {})[1].text,
    );
    expect(new Set(blocks1).size).toBe(3);
    expect(blocks1[1]).toContain("BUDGETPROBE");
    expect(blocks1[2]).toContain("RAIDPROBEA");
    expect(blocks1[2]).toContain("RAIDPROBEB");
  });
});
```

★★ **THIS TEST PASSES THE MOMENT YOU WRITE IT, and that is expected — Task 2 already implemented
the behaviour.** So the usual red-first step cannot apply here, and a green run proves nothing on
its own. Step 3's mutation is what establishes the test is not vacuous; do not skip it and do not
substitute a contrived failing accessor for it. This is the one place in the plan where the
mutation IS the verification.

- [ ] **Step 2: Run to confirm it passes**

Run: `npx vitest run src/app/chat-api.system-prompt.test.ts -t "byte-identical" --reporter=dot`
Expected: PASS (2 tests). A failure here means Task 2 is wrong, not this test.

- [ ] **Step 3: Mutation-prove the sweep actually detects the header bug**

In `src/app/operating-guide.ts`, change the always-on header so it counts every active guide again —
this reintroduces the original defect:

```ts
// MUTANT: count all guides, not just the always-on ones
`You have ${active.length} operating guide${active.length === 1 ? "" : "s"} that apply on every screen, in priority order. ${CONFLICT_RULE}`,
```

Run: `npx vitest run src/app/chat-api.system-prompt.test.ts -t "byte-identical" --reporter=dot`
Expected: FAIL on "emits the same block 0 on every view" (set size 3, not 1). **If it passes, the
sweep is vacuous and the whole slice is unprotected — stop and fix the test before continuing.**

Restore the original header, then prove the revert in both directions:

```bash
grep -c "alwaysOn.length} operating guide" src/app/operating-guide.ts   # must be 1
grep -c "active.length} operating guide" src/app/operating-guide.ts     # must be 0
git diff --stat -- src/app/operating-guide.ts                            # must be empty
```

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/chat-api.system-prompt.test.ts -m "test(ai): pin block 0 byte-identical across views, mutation-proved against the counted header"
```

---

## Task 4: Update the send-path assertions

**Files:**
- Modify: `src/app/chat-panel.test.tsx` (two `toHaveLength(1)` assertions)

★ These two assertions are what would otherwise catch an accidental change to the system block
count, so change them deliberately rather than mechanically, and keep the total-breakpoint check
they anchor.

- [ ] **Step 1: Update both assertions**

There are exactly two, found with `grep -n "body.system).toHaveLength(1)" src/app/chat-panel.test.tsx`.
Change each `expect(body.system).toHaveLength(1);` to:

```ts
    // Two blocks since the guide-block cache split: [0] is the view-invariant
    // half and carries the cache marker, [1] is the current view's guide and
    // deliberately carries none.
    expect(body.system).toHaveLength(2);
```

The assertion immediately after the first one — `expect(body.system[0].cache_control.type).toBe("ephemeral")`
— is still correct and must stay: the marker belongs on block 0.

- [ ] **Step 2: Add a breakpoint-budget assertion**

Directly after the first updated assertion, add:

```ts
    // ★★ Anthropic allows FOUR cache_control breakpoints per request and this
    //    app spends all four: tools 1, system 1, messages 2. Asserted on the
    //    ASSEMBLED request rather than any one layer, because exceeding four
    //    is an API error that no single layer can see coming.
    const markerCount = (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;
    expect(markerCount).toBeLessThanOrEqual(4);
```

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run src/app/chat-panel.test.tsx --reporter=dot`
Expected: PASS, whole file.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/chat-panel.test.tsx -m "test(ai): expect two system blocks and assert the four-breakpoint budget on the assembled request"
```

---

## Task 5: Record it, including what is NOT yet measured

**Files:**
- Modify: `docs/AGENTS/ai-assistant.md`

★ This file is **LF-only**. Use Edit, never Write. Verify `git ls-files --eol docs/AGENTS/ai-assistant.md`
still reads `i/lf w/lf`.

★ Do **not** add any `path:LINE` citation — `npm run docs:claims:check` is a blocking ratchet that
fails on a new one. Cite the symbol plus a reproduce command instead.

★ Any name you put in backticks must exist in `src`/`scripts`/`e2e` or `npm run docs:symbols:check`
(also blocking) fails.

- [ ] **Step 1: Add the bullet**

Add to the cache-boundary section of `docs/AGENTS/ai-assistant.md`, adjacent to the existing
`CACHED_TOOLS` bullet:

```markdown
  ★★★ **`buildStableSystemBlocks` RETURNS TWO BLOCKS AND ONLY THE FIRST CARRIES A MARKER.** Block 0
  is the instructions plus every always-on guide; block 1 is the current view's guide alone. The
  split exists because the guide payload is dominated by content that does NOT vary by view — and
  the comparison that matters is per-REQUEST, never against the whole feature-guide corpus, because
  only ONE view-scoped guide is ever active at a time: the unscoped leadership guide alone runs
  ~8x the largest single view guide, even though the 22 view-scoped guides are comparable to
  leadership IN TOTAL (1.14x) — which is exactly why view scoping saves far less than the 22-of-23
  guide-count ratio suggests. Measured 2026-09-09 via a `vite-node` script importing `builtinSeeds`
  from `use-operating-guides` and summing `content.length` grouped on whether `scope.views` is
  empty-or-absent: always-on (leadership + App overview) = 35,788 chars ≈ 9.9k tokens; the 22
  view-scoped guides total 28,977 chars, largest single guide 4,103 chars — re-run rather than trust
  these numbers. Meanwhile `assembleGuideBlocks`' predecessor put a varying guide COUNT in a single
  shared header ahead of
  all of it, so a view switch re-wrote ~9.9k tokens of byte-identical text at 1.25x. Measured before
  the change: the longest common prefix of the assembled block across the 34 nav-reachable views
  (of 35 `AppView` members — `learning-insights` is deep-link-only) was 9 characters.
  ★★ Block 1 has no marker ON PURPOSE — all four breakpoints are already committed (tools 1,
  system 1, messages 2) — and it still sits inside whatever a LATER marker covers, so it is not
  necessarily uncached, merely never the boundary of a cache lookup by itself. Adding a fifth is an
  API error, not a silent no-op.
  ★★ THE HISTORY IS STILL RE-WRITTEN ON A VIEW SWITCH, because block 1 precedes the messages in the
  prefix. That is this slice's ceiling, not an oversight; the successor that removes it (moving the
  view-scoped guide onto the turn tail) is slice G2 in
  `docs/superpowers/specs/2026-09-08-ai-guide-block-cache-split-design.md` and is gated on the
  answer-quality eval, because it is a `system`-to-`user` role change.
  ★★★ **THE SAVING IS ARITHMETIC, NOT OBSERVED — never machine-verified as of 2026-09-08.** No live
  run has confirmed that a view switch now reads the block-0 entry instead of re-writing it. The
  confirming measurement is two real sends with a view change between them, reading
  `cache_read_input_tokens` off the second. Do not cite this bullet as a measured win.
```

- [ ] **Step 2: Run the doc gates**

```bash
npm run docs:symbols:check > $SCRATCH/g-sym.log 2>&1; echo "EXIT=$?" >> $SCRATCH/g-sym.log
npm run docs:claims:check  > $SCRATCH/g-cl.log  2>&1; echo "EXIT=$?" >> $SCRATCH/g-cl.log
grep "EXIT=" $SCRATCH/g-sym.log $SCRATCH/g-cl.log
```
Expected: `EXIT=0` from both.

- [ ] **Step 3: Commit**

```bash
git commit --only docs/AGENTS/ai-assistant.md -m "docs(ai): record the two-block system split, its ceiling, and the owed measurement"
```

---

## Task 6: Final gates

- [ ] **Step 1: Lint the changed files**

```bash
npx eslint --max-warnings=0 src/app/operating-guide.ts src/app/operating-guide.test.ts src/app/chat-api.ts src/app/chat-api.system-prompt.test.ts src/app/chat-panel.test.tsx > $SCRATCH/g-lint.log 2>&1; echo "EXIT=$?" >> $SCRATCH/g-lint.log; grep "EXIT=" $SCRATCH/g-lint.log
```
Expected: `EXIT=0`. Every eslint warning is fatal here (`--max-warnings=0`), and `_`-prefixed unused
params are **not** exempt.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit > $SCRATCH/g-tsc2.log 2>&1; echo "EXIT=$?" >> $SCRATCH/g-tsc2.log; grep -E "error TS|EXIT=" $SCRATCH/g-tsc2.log
```
Expected: `EXIT=0`.

- [ ] **Step 3: Run the four affected test files together**

```bash
npx vitest run src/app/operating-guide.test.ts src/app/operating-guide-builtin.test.ts src/app/chat-api.system-prompt.test.ts src/app/chat-panel.test.tsx --reporter=dot > $SCRATCH/g-vitest.log 2>&1; echo "EXIT=$?" >> $SCRATCH/g-vitest.log; grep -E "Test Files|Tests |EXIT=" $SCRATCH/g-vitest.log
```
Expected: `Test Files 4 passed (4)` and `EXIT=0`.

★ Assert the file COUNT is 4 against your own list length. A mistyped path is dropped **silently**
when mixed with valid paths and the run still exits 0 — the tally alone will not tell you.

- [ ] **Step 4: Report what is owed**

State plainly in the final report that the live cache measurement (Task 5, Step 1's last bullet) is
**not** done, and that the slice's saving is arithmetic until it is.

---

## Self-review notes

- **Spec coverage.** Approach → Tasks 1-2. Header requirement → Task 1 (assembly) + Task 3 (the
  gate). Breakpoint accounting → Task 2's comment + Task 4's budget assertion. Consumers → Task 2
  (`chat-api`), Task 4 (`chat-panel`); `inline-ai-edit-call.ts` needs no change because it spreads
  `buildSystemPrompt`'s output and appends its own block, so 2→3 blocks is transparent. Testing
  items 1-5 → Tasks 2, 3, 4. Risks: "inert-but-green" → Task 3 Step 4's mutation; "measurement owed"
  → Task 5 Step 1 and Task 6 Step 4.
- **Not covered on purpose.** Slice G2 (turn-tail move) and the two out-of-scope items from the
  spec (trimming the leadership guide, gating tool families) are separate slices with their own
  eval requirements.
- **Type consistency.** `partitionGuidesByViewScope` and `assembleGuideBlocks` are spelled
  identically in Tasks 1, 2 and 5; both return the `{ alwaysOn, viewScoped }` shape throughout.
  `assembleGuideBlock` (singular) is deleted in Task 1 and referenced nowhere afterwards.
