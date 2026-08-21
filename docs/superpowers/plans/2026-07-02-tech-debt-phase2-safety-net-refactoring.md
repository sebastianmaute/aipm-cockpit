# Tech Debt Phase 2 — Safety Net + Code-Level Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the characterization-test net around `task-manager.tsx` and `workspace-section.tsx` before Phase 3 breaks them apart; finish dead-code/naming cleanup; close Phase 1's HIGH security findings.

**Architecture:** Characterization tests pin *what props/handlers reach the child layer* (coarse on purpose, replaceable in Phase 3). Refactoring is mechanical-only: one concern per MR, zero behavior change, zero renames of persisted/exported identifiers (CSV/MD columns, localStorage keys are byte-stable contracts).

**Tech Stack:** vitest + @testing-library/react (jsdom), fake-indexeddb setup, knip/ts-prune (Phase 1 reports as input), ESLint flat config.

**Entry gate:** Phase 1 exit checklist complete (CRITICALs = 0, baselines committed).

**Ground rules (from AGENTS.md):**
- `npx tsc --noEmit` after every test edit (vitest never typechecks).
- Coverage thresholds live in `vitest.config` at lines 90 / functions 89 / branches 78 / statements 87 on the scoped logic layer — **never lower them**. (Roadmap's "70%→75%" wording was written before measuring; the real ratchet action is Task 3 below.)
- `eslint.config.mjs` edits are HOOK-BLOCKED — Task 5 requires explicit user unblock or user applies the diff manually.
- jsdom has no layout engine; `IntersectionObserver`/`scrollIntoView` stubs already in `vitest.setup.ts`.

---

### Task 1: Characterization suite — task-manager orchestration seams

**Files:**
- Create: `src/app/task-manager.characterization.test.tsx`
- Read first: `src/app/task-manager.tsx`, existing `src/app/task-manager*.test.tsx` (mirror their render harness — do NOT invent a new one)

- [ ] **Step 1: Inventory the seams to pin**

Run: `grep -n "use[A-Z][A-Za-z]*(" src/app/task-manager.tsx | grep -v "useState\|useMemo\|useEffect\|useCallback\|useRef" | head -40`
Record the hook list. Expected clusters (per roadmap Phase 3 target table): 4× calendar push + 4× pull + auto-sync + auto-pull runner; action-analysis + scheduled-jobs + dispatcher; tour; storage backend.

- [ ] **Step 2: Locate the existing render harness**

Run: `grep -ln "render(<TaskManager" src/app/*.test.tsx`
Read that file's setup block (mocks for storage/MSAL/toast). Reuse it verbatim — a fresh divergent harness is itself debt.

- [ ] **Step 3: Write the props-reaching-children pin**

Mock the child layer, capture what the orchestrator threads down:

```tsx
import { describe, expect, test, vi } from "vitest";
// ...reuse imports/setup from the existing task-manager test harness (Step 2)

const seen: Record<string, unknown> = {};
vi.mock("./workspace-section", () => ({
  WorkspaceSection: (props: Record<string, unknown>) => {
    Object.assign(seen, props);
    return <div data-testid="ws-section" />;
  },
}));

describe("@characterization task-manager → workspace-section prop contract", () => {
  test("calendar props thread for all four entities", async () => {
    // render TaskManager with the harness's populated workspace + M365-configured settings
    // then assert the pane-boundary prop names exist (shape, not values):
    for (const k of [
      "calendarRaidEnabled", "onToggleCalendarRaid", "pushRaidToOutlook",
    ]) {
      expect(seen, `missing threaded prop ${k}`).toHaveProperty(k);
    }
    // repeat for change/absence prop bundles — copy exact names from
    // workspace-section-types.ts (grep "calendar" there), not from memory.
  });

  test("action-center handler bundle threads", () => {
    // assert the ActionHandlers-shaped props (onAssign/onMarkDone/onClearBlocker/
    // onReschedule…) are functions. Exact names from workspace-section-types.ts.
  });
});
```

Policy header comment in the file: `// @characterization — pins the pre-decomposition contract. MAY be updated freely during Phase 3 extractions when the diff is understood. Not a golden fixture.`

- [ ] **Step 4: Run, typecheck**

```bash
npx vitest run src/app/task-manager.characterization.test.tsx && npx tsc --noEmit
```
Expected: PASS, exit 0. If the mock breaks sibling tests (module cache), keep the mock file-local (it is — `vi.mock` is per-file).

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.characterization.test.tsx
git commit -m "test: characterization net over task-manager child-prop contract (pre-decomposition)"
```

---

### Task 2: Characterization suite — workspace-section view routing table

**Files:**
- Create: `src/app/workspace-section.characterization.test.tsx`
- Read first: `src/app/workspace-section.tsx`, `src/app/nav-config.ts` (AppView list), `src/app/workspace-panels.tsx`

- [ ] **Step 1: Build the routing expectation table**

From `workspace-section.tsx`'s tabpanel switch, list `AppView → panel component` for all routed views (~20). Lazy panels come from `workspace-panels.tsx`; static ones (Dashboard/Milestones/SteeringCommittee/ResourceDirectory) are direct imports.

- [ ] **Step 2: Write the table test**

```tsx
// @characterization — one assertion per routed view: given activeTab=V,
// the panel testid/heading for V mounts and no other panel does.
// Lazy panels render PanelSkeleton first — await findBy, not getBy.
import { describe, expect, test } from "vitest";

const ROUTES: Array<[view: string, marker: RegExp]> = [
  ["dashboard", /overall/i],
  ["raid", /raid/i],
  // ...complete from Step 1 table; marker = stable heading/aria-label per panel,
  // verified by running each panel's own existing test to see what it renders.
];

describe("@characterization workspace-section routing", () => {
  test.each(ROUTES)("view %s mounts its panel", async (view, marker) => {
    // render WorkspaceSection inside WorkspaceTabProvider with activeTab=view,
    // reusing the provider setup from existing workspace-section tests
    // (grep -ln "WorkspaceSection" src/app/*.test.tsx).
    expect(await screen.findByText(marker)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run full suite (this test is load-heavy — check the 20s timeout holds)**

```bash
npx vitest run src/app/workspace-section.characterization.test.tsx && npx tsc --noEmit
```
Expected: PASS. If a lazy panel times out under parallel load, split the table into two `describe` files rather than raising timeouts.

- [ ] **Step 4: Commit**

```bash
git add src/app/workspace-section.characterization.test.tsx
git commit -m "test: characterization routing table for workspace-section (~20 views)"
```

---

### Task 3: Coverage ratchet step 1

**Files:**
- Modify: `vitest.config.ts` (thresholds block, currently lines 90 / funcs 89 / branches 78 / stmts 87)

- [ ] **Step 1: Measure current headroom**

Run: `npm run test:coverage 2>&1 | tail -15`
Record actual lines/funcs/branches/stmts.

- [ ] **Step 2: Raise thresholds to measured-minus-1**

Edit the `thresholds` block: each value = floor(measured) − 1, but **never below current values**. Branches is the laggard (78) — expect the meaningful raise there.

- [ ] **Step 3: Targeted gap-fill in Phase-3-touched files only**

Run: `npm run test:coverage 2>&1 | grep -E "raid-panel|tasks-section|resources-panel|change-panel|task-manager" `
For each listed file with branch coverage < 70%: add behavior tests (AAA pattern) for the uncovered branches. No assertion-free tests — reviewer rejects coverage-only tests per roadmap risk note.

- [ ] **Step 4: Verify + commit**

```bash
npm run test:coverage && npx tsc --noEmit
git add vitest.config.ts src/app
git commit -m "test: ratchet coverage thresholds to measured floor; fill gaps in phase-3 target files"
```

---

### Task 4: Ambiguous dead-code deletion (pass 2)

**Files:**
- Input: `docs/baselines/deadcode-2026-07.md` AMBIGUOUS bucket (from Phase 1 Task 10)
- Delete: per-cluster

- [ ] **Step 1: Re-verify each AMBIGUOUS item**

Per item: `grep -rn "<symbol>" src e2e scripts` (note: `e2e/` is OUTSIDE the usual sweep — documented landmine; always include it). Dynamic-import check: `grep -rn "import(" src/app | grep -i "<module-stem>"`.

- [ ] **Step 2: Delete cluster-by-cluster, verify after each**

```bash
npm run lint && npx tsc --noEmit && npm run test:run
```

- [ ] **Step 3: Final e2e-adjacent check + commit**

```bash
npx playwright test --list
git add -A && git commit -m "refactor: delete reviewed-ambiguous dead code (pass 2 of knip/ts-prune report)"
```
Items that survive review as intentional: mark in code with `/** @public — kept: <reason> */` and move to FALSE-POSITIVE bucket in the baseline doc (update + commit it).

---

### Task 5: Naming-consistency lint rule (warn) — ⚠ requires user action

**Files:**
- Modify: `eslint.config.mjs` — **HOOK-BLOCKED for the agent** (config-protection hook)

- [ ] **Step 1: Prepare the diff, hand to user**

Proposed addition (user applies manually or unblocks the hook):

```js
// naming conventions (warn during phase 2 sweep; consider error in phase 4)
{
  rules: {
    "@typescript-eslint/naming-convention": ["warn",
      { selector: "variable", types: ["boolean"], format: ["camelCase"],
        prefix: ["is", "has", "should", "can", "show", "hide"] },
      { selector: "function", format: ["camelCase", "PascalCase"] },
    ],
  },
},
```

Note the extended prefix list (`show`/`hide`) — the codebase legitimately uses `showEmptyState`-style names; a strict 4-prefix rule would generate thousands of false warns.

- [ ] **Step 2: Measure blast radius BEFORE adopting**

After user applies: `npm run lint 2>&1 | grep -c "naming-convention"`.
If > ~150 warns, narrow the rule (e.g. `modifiers: ["const"]`) rather than planning a giant rename sweep — YAGNI on cosmetic churn.

- [ ] **Step 3: Fix warns only in files already being touched by Tasks 3–4**

**Never rename:** exported symbols consumed across modules, persisted identifiers (`*_CSV_COLUMNS` names, localStorage keys, i18n keys), anything in `types.ts` entity shapes.

- [ ] **Step 4: Commit (user commits the config; agent commits the fixes)**

```bash
git add -A src && git commit -m "refactor: boolean/hook naming-convention fixes in phase-2-touched files"
```

---

### Task 6: Magic-number extraction in touched files

**Files:**
- Modify: only files already open in Tasks 3–5

- [ ] **Step 1: Find candidates in touched files**

Run: `git diff --name-only main...HEAD | grep -E "\.tsx?$" | xargs grep -nE "[^0-9a-zA-Z_.](4000|86400|1440|30|14|21)[^0-9]" | head -30`
Judge each hit: repeated OR meaning-bearing thresholds/delays → extract to `UPPER_SNAKE_CASE` const beside existing ones (`STALE_DAYS`, `MAX_PER_BUCKET` are the in-repo pattern). One-off array indexes/layout numbers → leave.

- [ ] **Step 2: Verify + commit**

```bash
npm run test:run && npx tsc --noEmit
git add -A src && git commit -m "refactor: name meaning-bearing magic numbers in phase-2-touched files"
```

---

### Task 7: Commented-out code + stale TODO purge (repo-wide)

**Files:**
- Modify: repo-wide, grep-driven

- [ ] **Step 1: Inventory**

```bash
grep -rn "^\s*// *\(const\|function\|if\|return\|import\)" src/app --include="*.ts*" | grep -v "\.test\." | head -40
grep -rn "TODO\|FIXME\|XXX" src --include="*.ts*" | grep -v "\.test\." | head -40
```

- [ ] **Step 2: Judge each hit**

Commented-out code: delete (git history is the archive). TODOs: (a) still valid → convert to `docs/tech-debt-register-inputs.md` entry + delete comment; (b) stale → delete. Do NOT touch explanatory comments or the `★` landmine annotations in AGENTS.md-referenced files.

- [ ] **Step 3: Verify + commit**

```bash
npm run lint && npx tsc --noEmit && npm run test:run
git add -A && git commit -m "refactor: purge commented-out code; migrate live TODOs to debt register"
```

---

### Task 8: HIGH security findings burn-down — 🔁 RE-PLAN GATE

**Files:** unknown until `docs/security/findings-2026-07.md` exists (Phase 1 Task 4/5 output).

- [ ] **Step 1: Read the findings doc; extract HIGH rows**
- [ ] **Step 2: STOP — write a mini-plan per HIGH finding** (this plan cannot pre-specify fixes for findings that don't exist yet; inventing them would violate the no-invented-details rule). Use superpowers:writing-plans per finding if non-trivial; single-commit fix if trivial.
- [ ] **Step 3: Exit condition — findings doc updated: HIGH open = 0, each row gains `Fixed in <commit>`**

Budgeted at 1 engineer-week (roadmap A5). If HIGH count = 0 from Phase 1 (plausible — audit is currently clean), close this task with a one-line note in the findings doc.

---

### Task 9: Input-validation audit delta

**Files:**
- Read: every `/api/*` route + every AI tool-call implementation path
- Modify: only where a gap is found

- [ ] **Step 1: Route audit**

Per route in `src/app/api/`: confirm request-shape validation before use (pageId `/^\d+$/` pattern is the template). Record per-route verdict in `docs/security/findings-2026-07.md` appendix.

- [ ] **Step 2: AI write-path audit**

Run: `grep -n "sanitize" src/app/use-chat-dispatcher.ts | head -20`
Confirm every entity write tool routes through its `sanitizeX` (the documented contract). Confirm `use-project-proposal` seeds and `parseWeightSuggestions` coercion still route through validators. Any raw model-value reaching state = HIGH finding → loops back into Task 8.

- [ ] **Step 3: Fix gaps (if any) test-first**

For each gap: write the failing test showing the invalid value landing, then route through the validator, then green + commit per gap:

```bash
git commit -m "fix(security): route <path> through <sanitizer> (input-validation audit)"
```

---

## Phase exit checklist
- [ ] Both characterization suites merged, green, policy-commented.
- [ ] Coverage thresholds raised to measured floor; gate green.
- [ ] Dead-code report: 0 unexplained items (all deleted or `@public`-annotated).
- [ ] HIGH findings open = 0.
- [ ] Naming/magic-number/TODO sweeps done in touched files; no persisted-identifier renames anywhere (verify: golden fixtures untouched — `git diff main...HEAD --stat | grep __fixtures__` returns empty).
