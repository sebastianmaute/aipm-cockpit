# Key facts: model, Next-actions provider, Projects indicator (MR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show how complete each project's eleven key facts are — as grouped nudges in Next actions and as a meter (plus a banner on the current project) in the Projects list.

**Architecture:** One pure i18n-free model (`project-key-facts.ts`) decides which of the eleven facts are set. A new core Next-actions provider turns each missing fact into one monitor/soon action that `groupNextActions` collapses to one row. A per-device cache (`project-key-facts-cache.ts`, modelled on `landing-state.ts`) lets non-current Projects rows show a measurement without loading their backends; absence reads as *unknown*. The Projects panel renders a presentational meter component built on `ProgressTrack` and `Banner`.

**Tech Stack:** Next 16 / React 19 client components, TypeScript, Vitest + Testing Library, Tailwind v4 tokens.

**Spec:** `docs/superpowers/specs/2026-09-12-project-key-facts-and-shell-polish-design.md` §5 (read §3, §5, §7 and §8). MR A (§4) is merged as `c59098b8`; this plan presumes it.

## Global Constraints

- Branch `feat/key-facts-indicator`, worktree `.worktrees/key-facts`, cut from `origin/main` `c59098b8`. Its first commit is the cherry-picked `.mimir` marker (`2a88bdb7`) — leave it; the MR description mentions it.
- Commit author "Sebastian Maute". Commit path-limited (`git add <paths>` then `git commit -m`); never `git add -A`/`.`, never `--amend`, no bare `git stash`, no `git checkout --`/`git restore`. No push, no MR.
- Gates run in CI. Locally run ONLY the single test file(s) a step names, one vitest at a time, redirected and exit-checked unpiped: `npx vitest run <file> > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG"`. No full suite, no whole-repo `tsc`/`eslint`, no docs gates. `$LOG` lives in the session scratchpad, never shared `/tmp`.
- `src/app/*.ts(x)` are CRLF in the working tree (`git ls-files --eol` shows `i/lf w/crlf`). Edit them with the Edit tool only; never `sed -i`.
- `src/app/i18n.de.ts`: NEVER Edit or Write. Patch with the node script given in Task 2 / Task 5 (utf8, EOL detected from the file, unique-anchor check, real umlauts).
- No hand-rolled UI controls: use `Button`, `Banner`, `ProgressTrack` and the `icons.ts` barrel. If a need is not covered by an existing primitive, stop and ask.
- Palette: only `var(--rag-green|amber|red)` fills written as concrete, separate class strings; no gradients, shadows, hatches or patterns (spec §5.4). Never put a `*` or `|` inside a Tailwind arbitrary-value bracket anywhere, including comments.
- Projects is NOT in axe `A11Y_VIEWS` (spec §5.5): the meter bar is `aria-hidden`; the visible count text carries the state; the banner's action renders on the current project row only.
- New coverage-gated `.ts` files (`project-key-facts.ts`, `project-key-facts-cache.ts`, `next-actions/providers/project-meta.ts`) need their own tests covering every branch — `next-actions/**` has a 97 % lines / 90 % branches floor. Do not add them to `coverage.exclude`.
- No follow-up register entry is expected. If one becomes necessary, take the next free number from `grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1` on `origin/main` at filing time (it was 532 on 2026-09-13) and stop for the GitLab issue — issue creation is user-gated.

## Rulings recorded before execution

These resolve drift between the spec (written before MR A merged) and today's tree. The spec is amended in the same commit as this plan.

1. **§5.6 mirror test is retargeted.** After MR A, `validateProjectMeta` checks only `name`, so "the model and `validateProjectMeta` agree" is vacuous for 10 of 11 facts. The mirror instead pins the model against `sanitizeProjectMeta`'s blank rules: a blank-able value that the sanitizer normalises to blank (whitespace string → `""`, a contact person with a blank name → dropped, an unknown regulatory entry → dropped) must read as missing. *Cost if wrong:* a form-side emptiness rule that differs from the sanitizer would go unpinned; today the form has no emptiness rule of its own.
2. **`name` counts but never nudges.** `name` stays one of the eleven (total is 11, per §3.3), so a saved project's meter floor is `1 of 11`. The provider emits no `name` action — a blank name cannot be persisted, and nudging for it would be noise. *Cost:* none known.
3. **Blank enums are missing.** MR A made `deployment: ""` and `naceSection: ""` valid; the model treats them exactly like a blank string.
4. **String CTA ids navigate without a deep-link.** `executeActionCta` calls `requestOpen(view, Number(cta.id))`, which for a project id such as `"p1"` pushes `#projects/NaN`. The `open` arm now calls `setActiveTab(cta.view)` alone when `cta.id` is a string. Every existing provider passes a number (verified: `grep -rn 'kind: "open"' src/app/next-actions/providers/*.ts`), so no current behaviour changes. *Cost:* none known.
5. **Weights sit below `TIER_NOW - BIAS_CAP`.** `applyLearnedBias` can add up to `BIAS_CAP` (20, `action-learning.ts`). Every weight is `< 40`, so no project-meta action reaches `now` even with maximum learned bias; this is pinned through the engine, not only the provider.
6. **The cache write relies on React batching, not a registry name guard.** `renameProject` has no non-test caller, so the registry entry's name does not follow meta edits and cannot be used as a guard. Both switch paths (`switchToProject` in `use-storage-file-ops.ts`, the Turso switch in `use-storage-turso-ops.ts`) call `applyWorkspace` and then set the new id in one synchronous continuation after their last `await`, which React batches into one render. *Cost if wrong:* if an `await` is ever inserted between the two, one render could file a project's snapshot under the previous id; bounded by reopening that project. Recorded in a code comment at the write site.
7. **Banner "Complete them" opens the existing edit modal** (`setModal({ mode: "edit" })`, the same handler as the row's Edit button).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/project-key-facts.ts` | Create | Pure model: `KEY_FACT_IDS`, `KeyFactId`, `keyFactCompleteness` |
| `src/app/project-key-facts.test.ts` | Create | Model + sanitizer mirror tests |
| `src/app/next-actions/providers/project-meta.ts` | Create | Provider: one action per missing fact |
| `src/app/next-actions/providers/project-meta.test.ts` | Create | Provider tests incl. grouping, tier, verbs |
| `src/app/next-actions/types.ts` | Modify | `ActionSource` + `"project-meta"`; `ActionInput.projectId?`/`projectMeta?` |
| `src/app/next-actions/index.ts` | Modify | Register the provider |
| `src/app/action-source-label.ts` | Modify | Exhaustive label row |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | Modify | Provider keys (Task 2), panel keys (Task 5) |
| `src/app/project-key-facts-cache.ts` | Create | Per-device snapshot cache |
| `src/app/project-key-facts-cache.test.ts` | Create | Cache tests |
| `src/app/next-actions-input.ts` (+ test) | Modify | Pass `projectId`/`projectMeta` through |
| `src/app/action-cta-exec.ts` (+ test) | Modify | Ruling 4 |
| `src/app/task-manager.tsx` | Modify | Feed provider input; write cache snapshot |
| `src/app/project-key-facts-meter.tsx` (+ test) | Create | Presentational meter + banner |
| `src/app/projects-panel.tsx` (+ test) | Modify | Render meter per row, banner on current row |

---

### Task 1: Pure key-fact model

**Files:**
- Create: `src/app/project-key-facts.ts`
- Test: `src/app/project-key-facts.test.ts`

**Interfaces:**
- Consumes: `ProjectMeta` (`src/app/types.ts`), `sanitizeProjectMeta` (`src/app/sanitize-records.ts`, test only).
- Produces:
  - `export const KEY_FACT_IDS: readonly ["name","code","projectManager","customer","products","profitCenter","naceSection","deployment","contactPersons","regulatory","startDate"]`
  - `export type KeyFactId = (typeof KEY_FACT_IDS)[number]`
  - `export interface KeyFactCompleteness { filled: number; total: number; missing: KeyFactId[] }`
  - `export function keyFactCompleteness(meta: ProjectMeta): KeyFactCompleteness`

- [ ] **Step 1: Write the failing test**

Create `src/app/project-key-facts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { KEY_FACT_IDS, keyFactCompleteness, type KeyFactId } from "./project-key-facts";
import { sanitizeProjectMeta } from "./sanitize-records";
import type { ProjectMeta } from "./types";

const FULL: ProjectMeta = {
  name: "Apollo",
  code: "APL-1",
  projectManager: "Dana PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "ACME Corp",
  naceSection: "C",
  identityTypes: [],
  products: "Widget",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "",
  profitCenter: "PC-9",
  contactPersons: [{ name: "Pat Contact", email: "", synced: false }],
  regulatory: ["GDPR / data protection regulation"],
};

const NAME_ONLY: ProjectMeta = {
  ...FULL,
  code: "",
  projectManager: "",
  customer: "",
  naceSection: "",
  products: "",
  deployment: "",
  startDate: "",
  profitCenter: "",
  contactPersons: [],
  regulatory: [],
};

describe("KEY_FACT_IDS", () => {
  it("lists the eleven facts O-1 de-mandated, in declaration order", () => {
    expect([...KEY_FACT_IDS]).toEqual([
      "name", "code", "projectManager", "customer", "products", "profitCenter",
      "naceSection", "deployment", "contactPersons", "regulatory", "startDate",
    ]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(KEY_FACT_IDS)).toBe(true);
  });
});

describe("keyFactCompleteness", () => {
  it("reports 11 of 11 with nothing missing for a complete project", () => {
    expect(keyFactCompleteness(FULL)).toEqual({ filled: 11, total: 11, missing: [] });
  });

  it("reports 1 of 11 for a name-only project, missing listed in declaration order", () => {
    expect(keyFactCompleteness(NAME_ONLY)).toEqual({
      filled: 1,
      total: 11,
      missing: KEY_FACT_IDS.filter((id) => id !== "name"),
    });
  });

  it("counts a partially filled project", () => {
    const r = keyFactCompleteness({ ...FULL, code: "", regulatory: [] });
    expect(r).toEqual({ filled: 9, total: 11, missing: ["code", "regulatory"] });
  });

  it("treats a whitespace-only string as missing", () => {
    expect(keyFactCompleteness({ ...FULL, customer: "   " }).missing).toEqual(["customer"]);
  });

  it("treats a blank deployment and a blank NACE section as missing (MR A made both valid)", () => {
    expect(keyFactCompleteness({ ...FULL, deployment: "", naceSection: "" }).missing).toEqual([
      "naceSection", "deployment",
    ]);
  });

  it("treats a blank name as missing (an in-memory draft can hold one)", () => {
    expect(keyFactCompleteness({ ...FULL, name: "" }).missing).toEqual(["name"]);
  });
});

// Ruling 1: the model mirrors what the SANITIZER normalises to blank. A model
// that disagreed would render a meter contradicting what every backend stores.
describe("keyFactCompleteness mirrors sanitizeProjectMeta's blank rules", () => {
  const STRING_FACTS: KeyFactId[] = [
    "code", "projectManager", "customer", "products", "profitCenter", "naceSection", "deployment", "startDate",
  ];

  it.each(STRING_FACTS)("a whitespace %s survives sanitising as blank and reads missing", (id) => {
    const sanitized = sanitizeProjectMeta({ ...FULL, [id]: "   " });
    expect(sanitized).not.toBeNull();
    expect(keyFactCompleteness(sanitized!).missing).toEqual([id]);
  });

  it("a contact person with a blank name is dropped by the sanitizer and reads missing", () => {
    const sanitized = sanitizeProjectMeta({ ...FULL, contactPersons: [{ name: "  ", email: "", synced: false }] });
    expect(keyFactCompleteness(sanitized!).missing).toEqual(["contactPersons"]);
  });

  it("an unknown regulatory entry is dropped by the sanitizer and reads missing", () => {
    const sanitized = sanitizeProjectMeta({ ...FULL, regulatory: ["not a real requirement"] });
    expect(keyFactCompleteness(sanitized!).missing).toEqual(["regulatory"]);
  });

  it("a complete project survives sanitising as 11 of 11", () => {
    expect(keyFactCompleteness(sanitizeProjectMeta(FULL)!).filled).toBe(11);
  });

  it("a blank name cannot be persisted — the sanitizer rejects the record, so a saved project floors at 1 of 11", () => {
    expect(sanitizeProjectMeta({ ...FULL, name: "   " })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project-key-facts.test.ts > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Failed to resolve|Cannot find" "$LOG"`
Expected: EXIT=1, failure resolving `./project-key-facts`.

- [ ] **Step 3: Write the implementation**

Create `src/app/project-key-facts.ts` (the Write tool produces LF; that is fine for a new file — `autocrlf` normalises it):

```ts
// Pure, i18n-free key-fact completeness model (spec §5.1). Feeds the
// `project-meta` Next-actions provider and the Projects-list meter.
//
// ★★ The emptiness test MIRRORS sanitizeProjectMeta's blank rules — `.trim()`
// for strings, `length > 0` for the two arrays — and a test pins that. A model
// that disagreed with what the backends store would render a meter that
// contradicts the data (the defect class resolveEffectiveFilters exists for).
// It is deliberately NOT mirrored against validateProjectMeta: after O-1 that
// checks only `name`, so the comparison would be vacuous for ten facts.

import type { ProjectMeta } from "./types";

/** The eleven facts O-1 de-mandated, in declaration order (spec §3.3). */
export const KEY_FACT_IDS = Object.freeze([
  "name",
  "code",
  "projectManager",
  "customer",
  "products",
  "profitCenter",
  "naceSection",
  "deployment",
  "contactPersons",
  "regulatory",
  "startDate",
] as const);

export type KeyFactId = (typeof KEY_FACT_IDS)[number];

export interface KeyFactCompleteness {
  filled: number;
  total: number;
  /** Declaration order, so a list rendered from it is stable between renders. */
  missing: KeyFactId[];
}

function isFactSet(meta: ProjectMeta, id: KeyFactId): boolean {
  switch (id) {
    case "contactPersons":
      return meta.contactPersons.length > 0;
    case "regulatory":
      return meta.regulatory.length > 0;
    default:
      // name, code, projectManager, customer, products, profitCenter,
      // naceSection, deployment ("" = not set since O-1), startDate.
      return meta[id].trim() !== "";
  }
}

export function keyFactCompleteness(meta: ProjectMeta): KeyFactCompleteness {
  const missing = KEY_FACT_IDS.filter((id) => !isFactSet(meta, id));
  return { filled: KEY_FACT_IDS.length - missing.length, total: KEY_FACT_IDS.length, missing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project-key-facts.test.ts > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG"`
Expected: EXIT=0, `Test Files  1 passed`, 20 tests passed (8 of them from `it.each`).

- [ ] **Step 5: Mutation check (record the result in your report)**

Temporarily change `return meta.contactPersons.length > 0;` to `return true;`, rerun Step 4 → must FAIL. Restore, then temporarily drop `.trim()` from the default branch → must FAIL. Restore; `git diff --stat` must show only the two new files.

- [ ] **Step 6: Commit**

```bash
git add src/app/project-key-facts.ts src/app/project-key-facts.test.ts
git commit -m "feat(projects): add the pure key-fact completeness model"
```

---

### Task 2: `project-meta` Next-actions provider

**Files:**
- Create: `src/app/next-actions/providers/project-meta.ts`
- Test: `src/app/next-actions/providers/project-meta.test.ts`
- Modify: `src/app/next-actions/types.ts` (`ActionSource`, `ActionInput`, the `../types` import)
- Modify: `src/app/next-actions/index.ts` (`ALL_PROVIDERS`)
- Modify: `src/app/action-source-label.ts` (`ACTION_SOURCE_LABEL`)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Consumes: `keyFactCompleteness`, `KeyFactId` (Task 1); `scoreAction`, `bandTier`, `TIER_NOW` (`next-actions/score.ts`); `BIAS_CAP` (`action-learning.ts`, test only); `groupNextActions` (`next-actions/group.ts`); `pickPrimaryCta`, `overflowCtas`, `ActionCaps` (`next-actions/action-cta.ts`); `computeNextActions` (`next-actions/engine.ts`, test only).
- Produces:
  - `ActionSource` gains `"project-meta"`.
  - `ActionInput` gains `projectId?: string` and `projectMeta?: ProjectMeta`.
  - `export const PROJECT_META_WEIGHT: Readonly<Record<Exclude<KeyFactId, "name">, number>>`
  - `export const projectMetaProvider: ActionProvider`
  - Action shape: `id: "project-meta:<projectId>:<factId>"`, `source: "project-meta"`, `title: { key: "actionProjectMetaTitle", params: [meta.name] }`, `why: { key: <per-fact key> }`, `cta: { kind: "open", view: "projects", id: projectId }`, no `moduleId`.

- [ ] **Step 1: Widen the engine types**

In `src/app/next-actions/types.ts` (Edit tool):

Replace
```ts
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee } from "../types";
```
with
```ts
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee, ProjectMeta } from "../types";
```

Replace
```ts
  | "schedule" | "workload" | "committee" | "task-attention";
```
with
```ts
  | "schedule" | "workload" | "committee" | "task-attention" | "project-meta";
```

Replace
```ts
  dismissed: ReadonlySet<string>;     // snoozed/dismissed action ids (injected; SP3 wires the store)
}
```
with
```ts
  dismissed: ReadonlySet<string>;     // snoozed/dismissed action ids (injected; SP3 wires the store)
  /** Current project's id + metadata, feeding the `project-meta` provider.
   *  Additive (spec §5.2): absent → that provider returns []. */
  projectId?: string;
  projectMeta?: ProjectMeta;
}
```

Add the label row in `src/app/action-source-label.ts`: replace
```ts
  "task-attention": "actionSourceAttention",
```
with
```ts
  "task-attention": "actionSourceAttention",
  "project-meta": "actionSourceProjectMeta",
```

- [ ] **Step 2: Add the EN strings**

In `src/app/i18n.ts` (Edit tool), replace
```ts
  actionSourceAttention: "Attention",
```
with
```ts
  actionSourceAttention: "Attention",
  actionSourceProjectMeta: "Project facts",
  actionProjectMetaTitle: "Complete the key facts of {0}",
  actionProjectMetaWhyCode: "Project code not set",
  actionProjectMetaWhyProjectManager: "Project manager not set",
  actionProjectMetaWhyCustomer: "Customer not set",
  actionProjectMetaWhyStartDate: "Start date not set",
  actionProjectMetaWhyProducts: "Products not set",
  actionProjectMetaWhyProfitCenter: "Profit center not set",
  actionProjectMetaWhyNaceSection: "NACE section not set",
  actionProjectMetaWhyDeployment: "Deployment not set",
  actionProjectMetaWhyContactPersons: "No contact persons recorded",
  actionProjectMetaWhyRegulatory: "No regulatory requirements recorded",
```

- [ ] **Step 3: Add the DE strings (node script, never Edit/Write on the dictionary)**

Write this script with the Write tool to `<scratchpad>/i18n-de-task2.cjs` (the Write tool saves UTF-8, so the umlauts are real characters), then run `node <scratchpad>/i18n-de-task2.cjs` from the worktree root:

```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const anchor = '  actionSourceAttention: "Handlungsbedarf",' + eol;
if (s.split(anchor).length !== 2) throw new Error("anchor not found exactly once");
const lines = [
  'actionSourceProjectMeta: "Projektdaten",',
  'actionProjectMetaTitle: "Kernangaben von {0} vervollständigen",',
  'actionProjectMetaWhyCode: "Projektkürzel nicht gesetzt",',
  'actionProjectMetaWhyProjectManager: "Projektleiter nicht gesetzt",',
  'actionProjectMetaWhyCustomer: "Kunde nicht gesetzt",',
  'actionProjectMetaWhyStartDate: "Startdatum nicht gesetzt",',
  'actionProjectMetaWhyProducts: "Produkte nicht gesetzt",',
  'actionProjectMetaWhyProfitCenter: "Profit-Center nicht gesetzt",',
  'actionProjectMetaWhyNaceSection: "NACE-Abschnitt nicht gesetzt",',
  'actionProjectMetaWhyDeployment: "Deployment nicht gesetzt",',
  'actionProjectMetaWhyContactPersons: "Keine Ansprechpartner erfasst",',
  'actionProjectMetaWhyRegulatory: "Keine regulatorischen Anforderungen erfasst",',
];
s = s.replace(anchor, anchor + lines.map((l) => "  " + l + eol).join(""));
fs.writeFileSync(p, s, "utf8");
console.log("inserted", lines.length);
```

Verify: `grep -c "actionProjectMeta" src/app/i18n.de.ts` → `11` (the title + ten why keys; `actionSourceProjectMeta` does not contain that substring), `grep -c "actionSourceProjectMeta" src/app/i18n.de.ts` → `1`, and `grep -n "actionProjectMetaTitle" src/app/i18n.de.ts` shows `vervollständigen` with a real `ä`. Then `git diff --stat src/app/i18n.de.ts` must read `12 insertions(+)` and no deletions.

- [ ] **Step 4: Write the failing test**

Create `src/app/next-actions/providers/project-meta.test.ts`:

```ts
// src/app/next-actions/providers/project-meta.test.ts
import { describe, expect, it } from "vitest";
import { projectMetaProvider, PROJECT_META_WEIGHT } from "./project-meta";
import { computeNextActions } from "../engine";
import { groupNextActions } from "../group";
import { overflowCtas, pickPrimaryCta, type ActionCaps } from "../action-cta";
import { TIER_NOW } from "../score";
import { BIAS_CAP } from "../../action-learning";
import { KEY_FACT_IDS } from "../../project-key-facts";
import type { ActionInput } from "../types";
import type { ProjectMeta } from "../../types";

const TODAY = "2026-09-13";

const FULL: ProjectMeta = {
  name: "Apollo",
  code: "APL-1",
  projectManager: "Dana PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "ACME Corp",
  naceSection: "C",
  identityTypes: [],
  products: "Widget",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "",
  profitCenter: "PC-9",
  contactPersons: [{ name: "Pat Contact", email: "", synced: false }],
  regulatory: ["GDPR / data protection regulation"],
};

const NAME_ONLY: ProjectMeta = {
  ...FULL,
  code: "", projectManager: "", customer: "", naceSection: "", products: "",
  deployment: "", startDate: "", profitCenter: "", contactPersons: [], regulatory: [],
};

function input(over: Partial<ActionInput> = {}): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: {} as ActionInput["dashboard"],
    features: [],
    today: TODAY,
    now: new Date(`${TODAY}T00:00:00Z`),
    reminderLeadDays: 0,
    dueSoonWorkdays: 3,
    raidReviewIntervalDays: 30,
    dismissed: new Set(),
    projectName: "Apollo",
    commsReminders: [],
    ...over,
  } as ActionInput;
}

const ALL_CAPS: ActionCaps = {
  assign: true, draft: true, escalate: true, rebaseline: true, snapshotActive: true,
  reschedule: true, markDone: true, clearBlocker: true, snooze: true, createTask: true,
};

describe("projectMetaProvider — absent input", () => {
  it("returns [] when projectMeta is absent", () => {
    expect(projectMetaProvider.provide(input({ projectId: "p1" }))).toEqual([]);
  });

  it("returns [] when projectId is absent", () => {
    expect(projectMetaProvider.provide(input({ projectMeta: NAME_ONLY }))).toEqual([]);
  });

  it("is core — it declares no moduleId", () => {
    expect(projectMetaProvider.moduleId).toBeUndefined();
  });
});

describe("projectMetaProvider — one action per missing fact", () => {
  it("returns [] for a complete project", () => {
    expect(projectMetaProvider.provide(input({ projectId: "p1", projectMeta: FULL }))).toEqual([]);
  });

  const acts = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: NAME_ONLY }));

  it("emits ten actions for a name-only project, none for name", () => {
    expect(acts.map((a) => a.id).sort()).toEqual(
      KEY_FACT_IDS.filter((id) => id !== "name").map((id) => `project-meta:p1:${id}`).sort(),
    );
  });

  it("never emits a name action, even for a blank in-memory name", () => {
    const blankName = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: { ...FULL, name: "" } }));
    expect(blankName).toEqual([]);
  });

  it("deep-links every action to the Projects view with the project id", () => {
    for (const a of acts) expect(a.cta).toEqual({ kind: "open", view: "projects", id: "p1" });
  });

  it("titles every action with the project's name and uses its own source", () => {
    for (const a of acts) {
      expect(a.source).toBe("project-meta");
      expect(a.title).toEqual({ key: "actionProjectMetaTitle", params: ["Apollo"] });
    }
  });

  it("gives every missing fact a distinct why key", () => {
    expect(new Set(acts.map((a) => a.why.key)).size).toBe(acts.length);
  });

  it("maps a single missing fact to its own why key", () => {
    const one = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: { ...FULL, customer: "" } }));
    expect(one).toHaveLength(1);
    expect(one[0].why).toEqual({ key: "actionProjectMetaWhyCustomer" });
  });
});

describe("projectMetaProvider — ranking", () => {
  const acts = projectMetaProvider.provide(input({ projectId: "p1", projectMeta: NAME_ONLY }));

  it("collapses to ONE group whose primary is the project code and whose extras are the other nine", () => {
    const groups = groupNextActions(acts);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("projects:p1");
    expect(groups[0].primary.why.key).toBe("actionProjectMetaWhyCode");
    expect(groups[0].extra).toHaveLength(9);
  });

  it("leads with identity facts, then the start date, then the rest", () => {
    const w = PROJECT_META_WEIGHT;
    expect(w.code).toBeGreaterThan(w.projectManager);
    expect(w.projectManager).toBeGreaterThan(w.customer);
    expect(w.customer).toBeGreaterThan(w.startDate);
    for (const k of ["products", "profitCenter", "naceSection", "deployment", "contactPersons", "regulatory"] as const) {
      expect(w.startDate).toBeGreaterThan(w[k]);
    }
  });

  it("never reaches tier now from the provider", () => {
    for (const a of acts) expect(a.tier).not.toBe("now");
  });

  // Ruling 5: pinned THROUGH the engine, at the maximum learned bias.
  it("never reaches tier now through the engine even at +BIAS_CAP learned bias on every kind", () => {
    const learnedBias = Object.fromEntries(acts.map((a) => [`project-meta:${a.why.key}`, BIAS_CAP]));
    const ranked = computeNextActions(input({ projectId: "p1", projectMeta: NAME_ONLY, learnedBias }), [projectMetaProvider]);
    expect(ranked).toHaveLength(10);
    for (const a of ranked) expect(a.score).toBeLessThan(TIER_NOW);
  });

  it("attaches no task verbs: the primary is open, and the overflow holds no mark-done or draft", () => {
    for (const a of acts) {
      expect(pickPrimaryCta(a, ALL_CAPS)).toBe("open");
      expect(overflowCtas(a, ALL_CAPS)).not.toContain("markDone");
      expect(overflowCtas(a, ALL_CAPS)).not.toContain("draft");
    }
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/app/next-actions/providers/project-meta.test.ts > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Failed to resolve" "$LOG"`
Expected: EXIT=1, failure resolving `./project-meta`.

- [ ] **Step 6: Write the provider**

Create `src/app/next-actions/providers/project-meta.ts`:

```ts
// src/app/next-actions/providers/project-meta.ts
import { keyFactCompleteness, type KeyFactId } from "../../project-key-facts";
import { bandTier, scoreAction } from "../score";
import type { TranslationKey } from "../../i18n";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

type NudgedFact = Exclude<KeyFactId, "name">;

/** Per-fact weight (spec §5.2). There is no date math, so these exist only to
 *  make the group's primary deterministic: identity facts lead, then the start
 *  date, then the rest.
 *  ★★ Every weight must stay below TIER_NOW - BIAS_CAP (60 - 20 = 40): a blank
 *  profit centre must never outrank an overdue milestone, even at maximum
 *  learned bias. A test pins that through the engine. */
export const PROJECT_META_WEIGHT: Readonly<Record<NudgedFact, number>> = Object.freeze({
  code: 36,
  projectManager: 35,
  customer: 34,
  startDate: 31,
  products: 20,
  profitCenter: 19,
  naceSection: 18,
  deployment: 17,
  contactPersons: 16,
  regulatory: 15,
});

const WHY_KEY: Readonly<Record<NudgedFact, TranslationKey>> = {
  code: "actionProjectMetaWhyCode",
  projectManager: "actionProjectMetaWhyProjectManager",
  customer: "actionProjectMetaWhyCustomer",
  startDate: "actionProjectMetaWhyStartDate",
  products: "actionProjectMetaWhyProducts",
  profitCenter: "actionProjectMetaWhyProfitCenter",
  naceSection: "actionProjectMetaWhyNaceSection",
  deployment: "actionProjectMetaWhyDeployment",
  contactPersons: "actionProjectMetaWhyContactPersons",
  regulatory: "actionProjectMetaWhyRegulatory",
};

/** Core (always-on) provider: one action per missing key fact on the CURRENT
 *  project. They share a CTA target, so groupNextActions collapses them into one
 *  row whose "+N more reasons" lists the rest (spec §3.2).
 *  ★ `name` is never nudged: a blank name cannot be persisted (sanitizeProjectMeta
 *  rejects the record), so the only blank name is a transient in-memory one.
 *  ★ The CTA id is the project id STRING; action-cta-exec navigates without a
 *  deep-link for string ids, and `onPoints` stays false because the view is
 *  `projects`, so no task verb attaches. */
export const projectMetaProvider: ActionProvider = {
  provide(input: ActionInput): SuggestedAction[] {
    const { projectId, projectMeta } = input;
    if (!projectId || !projectMeta) return [];
    const out: SuggestedAction[] = [];
    for (const fact of keyFactCompleteness(projectMeta).missing) {
      if (fact === "name") continue;
      const score = scoreAction({ impact: PROJECT_META_WEIGHT[fact] });
      out.push({
        id: `project-meta:${projectId}:${fact}`,
        source: "project-meta",
        title: { key: "actionProjectMetaTitle", params: [projectMeta.name] },
        why: { key: WHY_KEY[fact] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "projects", id: projectId },
      });
    }
    return out;
  },
};
```

Register it in `src/app/next-actions/index.ts` (Edit tool): replace
```ts
import { taskAttentionProvider } from "./providers/task-attention";
```
with
```ts
import { taskAttentionProvider } from "./providers/task-attention";
import { projectMetaProvider } from "./providers/project-meta";
```
and replace
```ts
  taskAttentionProvider,
];
```
with
```ts
  taskAttentionProvider,
  projectMetaProvider,
];
```

- [ ] **Step 7: Run the provider test, then the neighbours that enumerate sources or providers**

Run each separately (never two vitest at once):
1. `npx vitest run src/app/next-actions/providers/project-meta.test.ts` → EXIT=0, 15 tests.
2. `npx vitest run src/app/next-actions/index.test.ts` → EXIT=0. If it pins the provider count or order, update that assertion to include `projectMetaProvider` last and say so in the report.
3. `grep -rln "ActionSource\b" src --include=*.test.ts --include=*.test.tsx` — run every listed file that enumerates the source union (e.g. a label-map exhaustiveness test) one at a time; each must pass. List what you ran in the report.

- [ ] **Step 8: Mutation check (record results)**

(a) Change `code: 36` to `code: 45` → the engine/tier test must FAIL. (b) Delete the `if (fact === "name") continue;` line → the blank-name test must FAIL. (c) Change `view: "projects"` to `view: "open-points"` → the verbs test must FAIL. Restore each; confirm `git diff` contains only the intended changes.

- [ ] **Step 9: Commit**

```bash
git add src/app/next-actions/providers/project-meta.ts src/app/next-actions/providers/project-meta.test.ts src/app/next-actions/types.ts src/app/next-actions/index.ts src/app/action-source-label.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(next-actions): nudge each missing project key fact"
```
(Add any enumerating test you had to update in Step 7 to the `git add` list.)

---

### Task 3: Per-device key-facts cache

**Files:**
- Create: `src/app/project-key-facts-cache.ts`
- Test: `src/app/project-key-facts-cache.test.ts`

**Interfaces:**
- Consumes: `readDeviceJson`, `writeDeviceJson`, `removeDeviceKey` (`device-store.ts`); `KEY_FACT_IDS`, `KeyFactId`, `keyFactCompleteness` (Task 1); `ProjectMeta`.
- Produces:
  - `export const KEY_FACTS_CACHE_MAX_PROJECTS = 50`
  - `export interface KeyFactsSnapshot { filled: number; missing: KeyFactId[]; customer: string; at: string }`
  - `export function keyFactsSnapshot(meta: ProjectMeta, at: string): KeyFactsSnapshot`
  - `export function loadKeyFactsSnapshot(projectId: string): KeyFactsSnapshot | null` — `null` means *unknown*, never zero
  - `export function saveKeyFactsSnapshot(projectId: string, snap: KeyFactsSnapshot): void`
  - `export function clearKeyFactsCache(): void`

- [ ] **Step 1: Write the failing test**

Create `src/app/project-key-facts-cache.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  KEY_FACTS_CACHE_MAX_PROJECTS,
  clearKeyFactsCache,
  keyFactsSnapshot,
  loadKeyFactsSnapshot,
  saveKeyFactsSnapshot,
  type KeyFactsSnapshot,
} from "./project-key-facts-cache";
import type { ProjectMeta } from "./types";

const KEY = "aipm-cockpit:project-key-facts";

const SNAP: KeyFactsSnapshot = {
  filled: 9,
  missing: ["code", "regulatory"],
  customer: "ACME Corp",
  at: "2026-09-13T10:00:00.000Z",
};

afterEach(() => clearKeyFactsCache());

describe("project-key-facts-cache", () => {
  it("round-trips a project's snapshot", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    expect(loadKeyFactsSnapshot("p1")).toEqual(SNAP);
  });

  // ★★ Spec §5.3: absence is UNKNOWN, never a measurement of zero.
  it("reads a never-cached project as null (unknown), not as zero", () => {
    expect(loadKeyFactsSnapshot("never-opened")).toBeNull();
  });

  it("keeps projects isolated", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    saveKeyFactsSnapshot("p2", { ...SNAP, filled: 11, missing: [], customer: "Globex" });
    expect(loadKeyFactsSnapshot("p1")?.customer).toBe("ACME Corp");
    expect(loadKeyFactsSnapshot("p2")?.filled).toBe(11);
  });

  it("caps the map, evicting the oldest by `at`", () => {
    for (let i = 0; i < KEY_FACTS_CACHE_MAX_PROJECTS + 5; i++) {
      const n = String(i).padStart(2, "0");
      saveKeyFactsSnapshot(`p${n}`, { ...SNAP, at: `2026-06-${n}T00:00:00.000Z` });
    }
    expect(loadKeyFactsSnapshot("p00")).toBeNull();
    expect(loadKeyFactsSnapshot(`p${KEY_FACTS_CACHE_MAX_PROJECTS + 4}`)).not.toBeNull();
  });

  it("reads corrupt JSON as unknown without throwing", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it("reads a non-object stored value as unknown", () => {
    window.localStorage.setItem(KEY, JSON.stringify([1, 2]));
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it.each([
    ["a non-object entry", 5],
    ["a non-integer filled", { ...SNAP, filled: "9" }],
    ["an out-of-range filled", { ...SNAP, filled: 12, missing: [] }],
    ["an unknown fact id", { ...SNAP, missing: ["code", "nope"] }],
    ["a count that does not add up to eleven", { ...SNAP, filled: 5 }],
    ["a non-string customer", { ...SNAP, customer: 3 }],
    ["a non-string at", { ...SNAP, at: null }],
    ["a non-array missing", { ...SNAP, missing: "code" }],
  ])("reads %s as unknown", (_label, entry) => {
    window.localStorage.setItem(KEY, JSON.stringify({ p1: entry }));
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it("clears every snapshot", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    clearKeyFactsCache();
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it("builds a snapshot from live metadata", () => {
    const meta: ProjectMeta = {
      name: "Apollo", code: "", projectManager: "Dana", keyStakeholdersInternal: [], keyStakeholdersExternal: [],
      customer: "ACME Corp", naceSection: "C", identityTypes: [], products: "Widget", deployment: "Cloud",
      startDate: "2026-01-01", endDate: "", profitCenter: "PC-9",
      contactPersons: [{ name: "Pat", email: "", synced: false }], regulatory: [],
    };
    expect(keyFactsSnapshot(meta, "2026-09-13T10:00:00.000Z")).toEqual({
      filled: 9, missing: ["code", "regulatory"], customer: "ACME Corp", at: "2026-09-13T10:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/project-key-facts-cache.test.ts > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Failed to resolve" "$LOG"`
Expected: EXIT=1, failure resolving `./project-key-facts-cache`.

- [ ] **Step 3: Write the implementation**

Create `src/app/project-key-facts-cache.ts`:

```ts
// Per-device, per-project key-fact snapshot backing the Projects-list meter on
// NON-current rows (spec §5.3). A ProjectRegistryEntry holds only
// {id, name, code, storageConfig}; the eleven facts and the customer live inside
// each project's own backend, and reading every backend per render was rejected.
// Modelled on landing-state.ts: one device-store key, defensive parse, bounded
// size. NOT a Workspace field — never exported, never in Turso, cleared by
// app-reset's `aipm-cockpit:*` sweep.
//
// ★★ Absence reads as `null` = UNKNOWN, never as zero. Rendering a never-opened
// project as "0 of 11" would be a fabricated measurement.
// ★ The CURRENT project never reads this cache — it computes live from memory.

import { readDeviceJson, removeDeviceKey, writeDeviceJson } from "./device-store";
import { KEY_FACT_IDS, keyFactCompleteness, type KeyFactId } from "./project-key-facts";
import type { ProjectMeta } from "./types";

const KEY_FACTS_CACHE_KEY = "aipm-cockpit:project-key-facts";
export const KEY_FACTS_CACHE_MAX_PROJECTS = 50;

export interface KeyFactsSnapshot {
  filled: number;
  missing: KeyFactId[];
  customer: string;
  /** ISO timestamp of the write; drives eviction. */
  at: string;
}

type SnapshotMap = Record<string, KeyFactsSnapshot>;

const FACT_ID_SET: ReadonlySet<string> = new Set(KEY_FACT_IDS);

function isSnapshot(v: unknown): v is KeyFactsSnapshot {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.customer !== "string" || typeof s.at !== "string") return false;
  if (!Number.isInteger(s.filled)) return false;
  const filled = s.filled as number;
  if (filled < 0 || filled > KEY_FACT_IDS.length) return false;
  if (!Array.isArray(s.missing)) return false;
  if (!s.missing.every((id) => typeof id === "string" && FACT_ID_SET.has(id))) return false;
  return filled + s.missing.length === KEY_FACT_IDS.length;
}

function readMap(): SnapshotMap {
  const parsed = readDeviceJson<unknown>(KEY_FACTS_CACHE_KEY, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: SnapshotMap = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (isSnapshot(v)) out[k] = v;
  }
  return out;
}

export function keyFactsSnapshot(meta: ProjectMeta, at: string): KeyFactsSnapshot {
  const { filled, missing } = keyFactCompleteness(meta);
  return { filled, missing, customer: meta.customer, at };
}

export function loadKeyFactsSnapshot(projectId: string): KeyFactsSnapshot | null {
  return readMap()[projectId] ?? null;
}

export function saveKeyFactsSnapshot(projectId: string, snap: KeyFactsSnapshot): void {
  const map = readMap();
  map[projectId] = snap;
  const entries = Object.entries(map);
  if (entries.length > KEY_FACTS_CACHE_MAX_PROJECTS) {
    entries.sort((a, b) => b[1].at.localeCompare(a[1].at));
    writeDeviceJson(KEY_FACTS_CACHE_KEY, Object.fromEntries(entries.slice(0, KEY_FACTS_CACHE_MAX_PROJECTS)));
    return;
  }
  writeDeviceJson(KEY_FACTS_CACHE_KEY, map);
}

export function clearKeyFactsCache(): void {
  removeDeviceKey(KEY_FACTS_CACHE_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/project-key-facts-cache.test.ts > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG"`
Expected: EXIT=0, 16 tests passed (8 of them from `it.each`).

- [ ] **Step 5: Mutation check (record results)**

(a) Change `?? null` in `loadKeyFactsSnapshot` to `?? { filled: 0, missing: [], customer: "", at: "" }` → the unknown-not-zero test must FAIL. (b) Delete the `filled + s.missing.length === KEY_FACT_IDS.length` check (return `true`) → the "does not add up" case must FAIL. Restore both.

- [ ] **Step 6: Commit**

```bash
git add src/app/project-key-facts-cache.ts src/app/project-key-facts-cache.test.ts
git commit -m "feat(projects): cache key-fact snapshots per device for non-current rows"
```

---

### Task 4: Wire the provider input, the string-id CTA, and the cache write

**Files:**
- Modify: `src/app/next-actions-input.ts`, `src/app/next-actions-input.test.ts`
- Modify: `src/app/action-cta-exec.ts`, `src/app/action-cta-exec.test.ts`
- Modify: `src/app/task-manager.tsx`

**Interfaces:**
- Consumes: `ActionInput.projectId?`/`projectMeta?` (Task 2); `keyFactsSnapshot`, `saveKeyFactsSnapshot` (Task 3).
- Produces: `BuildActionInputArgs` gains `projectId?: string; projectMeta?: ProjectMeta;`. `executeActionCta`'s `open` arm: string id → `setActiveTab(view)` only.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/next-actions-input.test.ts`, inside the file (after the last `describe` block):

```ts
describe("project key-fact passthrough", () => {
  const base = {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
    dashboard: {} as never, commsReminders: [], features: [], projectName: "P",
    today: "2026-09-13", now: new Date("2026-09-13T00:00:00Z"),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30,
  };

  it("passes projectId and projectMeta through", () => {
    const meta = { name: "P" } as never;
    const input = buildActionInput({ ...base, projectId: "p1", projectMeta: meta });
    expect(input.projectId).toBe("p1");
    expect(input.projectMeta).toBe(meta);
  });

  it("leaves both undefined when omitted", () => {
    const input = buildActionInput(base);
    expect(input.projectId).toBeUndefined();
    expect(input.projectMeta).toBeUndefined();
  });
});
```

Append to `src/app/action-cta-exec.test.ts`, inside `describe("executeActionCta", ...)` directly after the `"deep-links an open CTA"` test:

```ts
  // Ruling 4: a string id (a project id) cannot be a numeric deep-link —
  // Number("p1") is NaN and would push #projects/NaN.
  it("navigates without a deep-link when the open CTA carries a string id", () => {
    const d = deps();
    executeActionCta({ kind: "open", view: "projects", id: "p1" }, d);
    expect(d.setActiveTab).toHaveBeenCalledWith("projects");
    expect(d.requestOpen).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run both to verify they fail**

Run separately:
- `npx vitest run src/app/next-actions-input.test.ts` → EXIT=1 on "passes projectId and projectMeta through".
- `npx vitest run src/app/action-cta-exec.test.ts` → EXIT=1 on the string-id test (`requestOpen` was called with `NaN`).

- [ ] **Step 3: Implement the passthrough and the CTA arm**

In `src/app/next-actions-input.ts` (Edit tool): replace
```ts
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee } from "./types";
```
with
```ts
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee, ProjectMeta } from "./types";
```
replace
```ts
  /** Learned per-kind bias (`${source}:${why.key}` -> points). Off when undefined/empty. */
  learnedBias?: Record<string, number>;
}
```
with
```ts
  /** Learned per-kind bias (`${source}:${why.key}` -> points). Off when undefined/empty. */
  learnedBias?: Record<string, number>;
  /** Current project's id + metadata for the `project-meta` provider. */
  projectId?: string;
  projectMeta?: ProjectMeta;
}
```
and replace
```ts
    learnedBias: a.learnedBias,
  };
}
```
with
```ts
    learnedBias: a.learnedBias,
    projectId: a.projectId,
    projectMeta: a.projectMeta,
  };
}
```

In `src/app/action-cta-exec.ts` (Edit tool): replace
```ts
    case "open":
      deps.requestOpen(cta.view, Number(cta.id));
      return;
```
with
```ts
    case "open":
      // A string id (the project-meta provider's project id) has no numeric
      // deep-link — Number("p1") is NaN and would push `#<view>/NaN`. Navigate
      // to the view alone. Every numeric-id provider is unaffected.
      if (typeof cta.id === "string") {
        deps.setActiveTab(cta.view);
        return;
      }
      deps.requestOpen(cta.view, cta.id);
      return;
```

- [ ] **Step 4: Run both to verify they pass**

Run separately: `npx vitest run src/app/next-actions-input.test.ts` → EXIT=0; `npx vitest run src/app/action-cta-exec.test.ts` → EXIT=0.

- [ ] **Step 5: Feed the provider from task-manager**

In `src/app/task-manager.tsx` (Edit tool). ★ `portfolioCurrentId` is declared much LATER in this component than the `nextActions` memo (it sits beside `portfolioProjects`); referencing it inside the memo would throw a temporal-dead-zone `ReferenceError` on the first render. Declare a local with the identical expression immediately above the memo.

Replace
```ts
  // Suggested next-actions engine. Reuses comms.items (already computed above)
  // so we don't run getStakeholderCommsItems a second time.
  const nextActions = useMemo(
```
with
```ts
  // Same expression as `portfolioCurrentId` below — duplicated here because that
  // const is declared later in this component, and reading it from this memo
  // would be a temporal-dead-zone ReferenceError on the first render.
  const actionProjectId = portfolioMode === "turso" ? tursoProjectId : currentProjectId;
  // Suggested next-actions engine. Reuses comms.items (already computed above)
  // so we don't run getStakeholderCommsItems a second time.
  const nextActions = useMemo(
```

Replace
```ts
          projectName: project?.name ?? "",
          today,
```
with
```ts
          projectName: project?.name ?? "",
          projectId: actionProjectId ?? undefined,
          projectMeta: project ?? undefined,
          today,
```

Replace the memo's dependency array
```ts
    [tasks, raid, changes, milestones, stakeholders, steeringCommittee, dashboardModel, comms.items, settings.features, effectiveNotifications, effectiveNextActions, project, today, workloadAlerts, actionSnooze.dismissed, actionTrends, learnedBias],
```
with
```ts
    [tasks, raid, changes, milestones, stakeholders, steeringCommittee, dashboardModel, comms.items, settings.features, effectiveNotifications, effectiveNextActions, project, actionProjectId, today, workloadAlerts, actionSnooze.dismissed, actionTrends, learnedBias],
```

Verify the declaration order before moving on: `grep -n "const tursoProjectId\|tursoProjectId,\|const portfolioMode\|const actionProjectId" src/app/task-manager.tsx` — both `tursoProjectId` and `portfolioMode` must be bound on a line number LOWER than `actionProjectId`. If either is not, stop and report (NEEDS_CONTEXT); do not reorder task-manager on your own.

- [ ] **Step 6: Write the cache snapshot from task-manager**

Add the imports next to `import { loadLandingState } from "./landing-state";` (Edit tool): replace
```ts
import { loadLandingState } from "./landing-state";
```
with
```ts
import { loadLandingState } from "./landing-state";
import { keyFactsSnapshot, saveKeyFactsSnapshot } from "./project-key-facts-cache";
```

Then, directly after the declaration
```ts
  const portfolioCurrentId =
    portfolioMode === "turso" ? tursoProjectId : currentProjectId;
```
insert:
```ts

  // Per-device key-fact snapshot for the Projects list's NON-current rows
  // (spec §5.3). Side-effect-only localStorage write (no setState); `new Date()`
  // lives in the effect, never the render body; popouts are read-only and must
  // not mutate device state (mirrors use-landing-delta).
  // ★★ This relies on React batching `project` and the id into ONE render.
  // Both switch paths — switchToProject (use-storage-file-ops.ts) and the Turso
  // switch (use-storage-turso-ops.ts) — call applyWorkspace and then set the new
  // id in the same synchronous continuation after their last `await`. If an
  // `await` is ever inserted between those two calls, one render will hold the
  // NEW project's meta under the OLD id and this effect will file it there
  // (bounded: reopening that project overwrites it). A registry name/code guard
  // is NOT a fix: renameProject has no caller, so the registry name does not
  // follow meta edits and such a guard would block every write after a rename.
  useEffect(() => {
    if (isPopout || !project || !portfolioCurrentId) return;
    saveKeyFactsSnapshot(portfolioCurrentId, keyFactsSnapshot(project, new Date().toISOString()));
  }, [isPopout, project, portfolioCurrentId]);
```

Confirm `useEffect` is already imported from `react` in this file (`grep -n "useEffect" src/app/task-manager.tsx | head -2`); if not, add it to the existing `react` import.

- [ ] **Step 7: Run the task-manager neighbours**

Run separately, each must EXIT=0:
- `npx vitest run src/app/task-manager.characterization.test.tsx`
- `npx vitest run src/app/next-actions/index.test.ts`

Then check the file-size ratchet by hand (the gate counts `split("\n").length`): `node -e "console.log(require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"` must print less than the `task-manager.tsx` entry in `docs/baselines/file-sizes.json`.

- [ ] **Step 8: Commit**

```bash
git add src/app/next-actions-input.ts src/app/next-actions-input.test.ts src/app/action-cta-exec.ts src/app/action-cta-exec.test.ts src/app/task-manager.tsx
git commit -m "feat(projects): feed key facts to next actions and cache them per device"
```

---

### Task 5: Projects-list meter and banner

**Files:**
- Create: `src/app/project-key-facts-meter.tsx`
- Test: `src/app/project-key-facts-meter.test.tsx`
- Modify: `src/app/projects-panel.tsx`, `src/app/projects-panel.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

**Interfaces:**
- Consumes: `KEY_FACT_IDS`, `KeyFactId`, `keyFactCompleteness` (Task 1); `loadKeyFactsSnapshot`, `saveKeyFactsSnapshot`, `clearKeyFactsCache` (Task 3); `ProgressTrack` (`progress-track.tsx`); `Banner` (`banner.tsx`); `Button` (`button.tsx`); `QuestionMarkCircleIcon` (`icons.ts`); `t`, `tPlural` (`i18n.ts`).
- Produces:
  - `export type KeyFactsRowState = { kind: "measured"; filled: number; total: number; missing: readonly KeyFactId[] } | { kind: "unknown"; total: number }`
  - `export const KEY_FACTS_AMBER_MIN = 8`
  - `export function KeyFactsMeter(props: { lang: Lang; state: KeyFactsRowState })`
  - `export function KeyFactsBanner(props: { lang: Lang; missing: readonly KeyFactId[]; onComplete: () => void })`

- [ ] **Step 1: Add the EN strings**

In `src/app/i18n.ts` (Edit tool), replace
```ts
  projectCurrentLabel: "Current project",
```
with
```ts
  projectCurrentLabel: "Current project",
  projectKeyFactsMissing: "{0} key facts missing",
  projectKeyFactsMissingOne: "1 key fact missing",
  projectKeyFactsComplete: "Key facts complete",
  projectKeyFactsUnknown: "Key facts not measured here",
  projectKeyFactsCount: "{0} of {1}",
  projectKeyFactsCountUnknown: "— / {0}",
  projectKeyFactsBannerMissing: "Missing key facts: {0}",
  projectKeyFactsBannerComplete: "All key facts are set.",
  projectKeyFactsCompleteAction: "Complete them",
```

- [ ] **Step 2: Add the DE strings (node script)**

Write `<scratchpad>/i18n-de-task5.cjs` with the Write tool and run it with `node` from the worktree root:

```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const anchor = '  projectCurrentLabel: "Aktuelles Projekt",' + eol;
if (s.split(anchor).length !== 2) throw new Error("anchor not found exactly once");
const lines = [
  'projectKeyFactsMissing: "{0} Kernangaben fehlen",',
  'projectKeyFactsMissingOne: "1 Kernangabe fehlt",',
  'projectKeyFactsComplete: "Kernangaben vollständig",',
  'projectKeyFactsUnknown: "Kernangaben auf diesem Gerät nicht erfasst",',
  'projectKeyFactsCount: "{0} von {1}",',
  'projectKeyFactsCountUnknown: "— / {0}",',
  'projectKeyFactsBannerMissing: "Fehlende Kernangaben: {0}",',
  'projectKeyFactsBannerComplete: "Alle Kernangaben sind gesetzt.",',
  'projectKeyFactsCompleteAction: "Jetzt ergänzen",',
];
s = s.replace(anchor, anchor + lines.map((l) => "  " + l + eol).join(""));
fs.writeFileSync(p, s, "utf8");
console.log("inserted", lines.length);
```

Verify: `git diff --stat src/app/i18n.de.ts` shows 9 insertions and 0 deletions; `grep -n "projectKeyFactsComplete:" src/app/i18n.de.ts` shows a real `ä`.

- [ ] **Step 3: Write the failing meter test**

Create `src/app/project-key-facts-meter.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KEY_FACTS_AMBER_MIN, KeyFactsBanner, KeyFactsMeter } from "./project-key-facts-meter";

function fill(container: HTMLElement) {
  return container.querySelector("[data-key-facts-fill]");
}

describe("KeyFactsMeter", () => {
  it("renders a complete project green with the complete sentence and count", () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: 11, total: 11, missing: [] }} />,
    );
    expect(screen.getByText("Key facts complete")).toBeInTheDocument();
    expect(screen.getByText("11 of 11")).toBeInTheDocument();
    expect(fill(container)?.className).toContain("bg-[var(--rag-green)]");
    expect((fill(container) as HTMLElement).style.width).toBe("100%");
  });

  it(`renders amber from ${KEY_FACTS_AMBER_MIN} filled`, () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: KEY_FACTS_AMBER_MIN, total: 11, missing: ["code", "customer", "regulatory"] }} />,
    );
    expect(screen.getByText("3 key facts missing")).toBeInTheDocument();
    expect(fill(container)?.className).toContain("bg-[var(--rag-amber)]");
  });

  it("renders red below the amber threshold", () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: KEY_FACTS_AMBER_MIN - 1, total: 11, missing: ["code", "customer", "regulatory", "products"] }} />,
    );
    expect(fill(container)?.className).toContain("bg-[var(--rag-red)]");
  });

  it("uses the singular sentence for one missing fact", () => {
    render(<KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: 10, total: 11, missing: ["code"] }} />);
    expect(screen.getByText("1 key fact missing")).toBeInTheDocument();
  });

  // Spec §5.4: unknown is the bare track with NO fill child, told apart by text.
  it("renders unknown as a bare track with no fill, a dash count and a question glyph", () => {
    const { container } = render(<KeyFactsMeter lang="en-US" state={{ kind: "unknown", total: 11 }} />);
    expect(screen.getByText("Key facts not measured here")).toBeInTheDocument();
    expect(screen.getByText("— / 11")).toBeInTheDocument();
    expect(fill(container)).toBeNull();
    expect(container.querySelector("[data-key-facts-unknown-glyph]")).not.toBeNull();
  });

  it("hides the bar from assistive tech so the count text carries the state", () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: 5, total: 11, missing: ["code", "customer", "products", "profitCenter", "naceSection", "deployment"] }} />,
    );
    expect(container.querySelector("[data-key-facts-track]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("KeyFactsBanner", () => {
  it("names the missing facts in declaration order and offers to complete them", () => {
    const onComplete = vi.fn();
    render(<KeyFactsBanner lang="en-US" missing={["code", "customer"]} onComplete={onComplete} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Missing key facts: Project code, Customer");
    fireEvent.click(screen.getByRole("button", { name: "Complete them" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("switches to the success message with no action at eleven of eleven", () => {
    render(<KeyFactsBanner lang="en-US" missing={[]} onComplete={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("All key facts are set.");
    expect(screen.queryByRole("button", { name: "Complete them" })).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/app/project-key-facts-meter.test.tsx > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Failed to resolve" "$LOG"`
Expected: EXIT=1, failure resolving `./project-key-facts-meter`.

- [ ] **Step 5: Write the meter component**

Create `src/app/project-key-facts-meter.tsx`:

```tsx
"use client";

// Projects-list key-fact meter + current-project banner (spec §5.4). Purely
// presentational; the panel decides live vs cached vs unknown.
//
// ★★ Projects is NOT in axe A11Y_VIEWS (spec §5.5), so unit tests are the only
// coverage. The bar is aria-hidden decoration and the visible count text carries
// the state, so colour is never the sole cue. The *unknown* state is the bare
// muted track with NO fill child — told apart by its "— / 11" text and the
// question glyph, never by a hatch or pattern (the palette bans gradients).
// ★ Fill tokens are written as three concrete class strings on purpose — never
// one arbitrary-value bracket with a pipe or wildcard (Tailwind v4 scans every
// file and an invalid bracket breaks globals.css).
// ★ The banner renders on the current project row only, so its action needs no
// row token. Extending it to every row would need buildRowTokens: a repeated
// "Complete them" is a WCAG 2.4.6 failure no gate in this repo can detect.

import { Banner } from "./banner";
import { Button } from "./button";
import { t, tPlural, type Lang, type TranslationKey } from "./i18n";
import { QuestionMarkCircleIcon } from "./icons";
import { ProgressTrack } from "./progress-track";
import type { KeyFactId } from "./project-key-facts";

export type KeyFactsRowState =
  | { kind: "measured"; filled: number; total: number; missing: readonly KeyFactId[] }
  | { kind: "unknown"; total: number };

/** Filled count at which the meter turns amber (below: red; all: green). */
export const KEY_FACTS_AMBER_MIN = 8;

const FACT_LABEL: Readonly<Record<KeyFactId, TranslationKey>> = {
  name: "projectName",
  code: "projectCode",
  projectManager: "projectManager",
  customer: "projectCustomer",
  products: "projectProducts",
  profitCenter: "projectProfitCenter",
  naceSection: "projectNaceSection",
  deployment: "projectDeployment",
  contactPersons: "projectContactPersons",
  regulatory: "projectRegulatory",
  startDate: "projectStartDate",
};

function fillClass(filled: number, total: number): string {
  if (filled >= total) return "bg-[var(--rag-green)]";
  if (filled >= KEY_FACTS_AMBER_MIN) return "bg-[var(--rag-amber)]";
  return "bg-[var(--rag-red)]";
}

export function KeyFactsMeter({ lang, state }: { lang: Lang; state: KeyFactsRowState }) {
  const measured = state.kind === "measured";
  const missingCount = measured ? state.missing.length : 0;
  const sentence = !measured
    ? t(lang, "projectKeyFactsUnknown")
    : missingCount === 0
      ? t(lang, "projectKeyFactsComplete")
      : tPlural(lang, "projectKeyFactsMissing", missingCount, missingCount);
  const count = measured
    ? t(lang, "projectKeyFactsCount", state.filled, state.total)
    : t(lang, "projectKeyFactsCountUnknown", state.total);

  return (
    <div className="flex flex-col gap-1" data-key-facts={state.kind}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 text-foreground">
          {!measured && (
            <QuestionMarkCircleIcon
              data-key-facts-unknown-glyph=""
              aria-hidden="true"
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          )}
          {sentence}
        </span>
        <span className="font-mono text-muted-foreground">{count}</span>
      </div>
      <ProgressTrack height="h-1.5" aria-hidden="true" data-key-facts-track="">
        {measured && (
          <div
            data-key-facts-fill=""
            className={`h-full ${fillClass(state.filled, state.total)}`}
            style={{ width: `${Math.round((state.filled / state.total) * 100)}%` }}
          />
        )}
      </ProgressTrack>
    </div>
  );
}

export function KeyFactsBanner({
  lang,
  missing,
  onComplete,
}: {
  lang: Lang;
  missing: readonly KeyFactId[];
  onComplete: () => void;
}) {
  if (missing.length === 0) {
    return <Banner severity="success">{t(lang, "projectKeyFactsBannerComplete")}</Banner>;
  }
  const list = missing.map((id) => t(lang, FACT_LABEL[id])).join(", ");
  return (
    <Banner severity="warn" className="flex flex-wrap items-center justify-between gap-2">
      <span>{t(lang, "projectKeyFactsBannerMissing", list)}</span>
      <Button variant="secondary" size="sm" onClick={onComplete}>
        {t(lang, "projectKeyFactsCompleteAction")}
      </Button>
    </Banner>
  );
}
```

If `QuestionMarkCircleIcon` does not accept a `data-*` attribute under tsc's JSX typing, wrap it in `<span data-key-facts-unknown-glyph="" aria-hidden="true">` instead and keep the test's selector — note which you did in the report.

- [ ] **Step 6: Run the meter test to verify it passes**

Run: `npx vitest run src/app/project-key-facts-meter.test.tsx > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG"`
Expected: EXIT=0, 8 tests passed.

- [ ] **Step 7: Write the failing panel tests**

In `src/app/projects-panel.test.tsx`:

Add to the imports (after `import { expectRowUniqueNames } from "../test/row-unique-names";`):
```ts
import { clearKeyFactsCache, saveKeyFactsSnapshot } from "./project-key-facts-cache";
```

Append at the end of the file:
```tsx
describe("ProjectsPanel — key-fact indicator", () => {
  afterEach(() => clearKeyFactsCache());

  function row(name: string): HTMLElement {
    const li = screen.getByText(name).closest("li");
    if (!li) throw new Error(`no row for ${name}`);
    return li;
  }

  it("renders the current project live at 11 of 11 with a success banner", () => {
    setup();
    const r = within(row("Apollo"));
    expect(r.getByText("Key facts complete")).toBeInTheDocument();
    expect(r.getByText("11 of 11")).toBeInTheDocument();
    expect(r.getByRole("status")).toHaveTextContent("All key facts are set.");
  });

  it("renders a partial current project with a warn banner whose action opens the editor", () => {
    setup({ currentProject: { ...CURRENT_META, code: "", customer: "" } });
    const r = within(row("Apollo"));
    expect(r.getByText("2 key facts missing")).toBeInTheDocument();
    expect(r.getByText("9 of 11")).toBeInTheDocument();
    expect(r.getByRole("status")).toHaveTextContent("Missing key facts: Project code, Customer");
    fireEvent.click(r.getByRole("button", { name: "Complete them" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // ★ Spec §5.3: the current project never reads the cache.
  it("ignores a cached snapshot for the current project", () => {
    saveKeyFactsSnapshot("p1", { filled: 1, missing: ["code", "projectManager", "customer", "products", "profitCenter", "naceSection", "deployment", "contactPersons", "regulatory", "startDate"], customer: "Stale Co", at: "2026-01-01T00:00:00.000Z" });
    setup();
    const r = within(row("Apollo"));
    expect(r.getByText("11 of 11")).toBeInTheDocument();
    expect(r.queryByText("Stale Co")).toBeNull();
  });

  // ★★ Spec §5.3: a never-opened project is UNKNOWN, never "0 of 11".
  it("renders a never-cached non-current project as unknown with no banner", () => {
    setup();
    const r = within(row("Gemini"));
    expect(r.getByText("Key facts not measured here")).toBeInTheDocument();
    expect(r.getByText("— / 11")).toBeInTheDocument();
    expect(r.queryByText("0 of 11")).toBeNull();
    expect(r.queryByRole("status")).toBeNull();
  });

  it("renders a cached non-current project from its snapshot, with its customer and no banner", () => {
    saveKeyFactsSnapshot("p2", { filled: 4, missing: ["code", "projectManager", "products", "profitCenter", "naceSection", "contactPersons", "regulatory"], customer: "Globex", at: "2026-09-13T10:00:00.000Z" });
    setup();
    const r = within(row("Gemini"));
    expect(r.getByText("7 key facts missing")).toBeInTheDocument();
    expect(r.getByText("4 of 11")).toBeInTheDocument();
    expect(r.getByText("Globex")).toBeInTheDocument();
    expect(r.queryByRole("status")).toBeNull();
  });

  it("renders the banner action once across the list", () => {
    saveKeyFactsSnapshot("p2", { filled: 4, missing: ["code", "projectManager", "products", "profitCenter", "naceSection", "contactPersons", "regulatory"], customer: "Globex", at: "2026-09-13T10:00:00.000Z" });
    setup({ currentProject: { ...CURRENT_META, code: "" } });
    expect(screen.getAllByRole("button", { name: "Complete them" })).toHaveLength(1);
  });

  it("renders the current row as unknown when its metadata is not loaded", () => {
    setup({ currentProject: undefined });
    const r = within(row("Apollo"));
    expect(r.getByText("Key facts not measured here")).toBeInTheDocument();
    expect(r.queryByRole("status")).toBeNull();
  });
});
```

If `setup` in this file does not spread `overrides` onto `ProjectsPanel`'s props, read it first and pass the override the way it supports; do not rewrite `setup`. If the Turso-mode `role="status"` or any other pre-existing status element lands inside a row and breaks the `queryByRole("status")` assertions, scope them to `[data-key-facts-banner]` instead (add that attribute on the wrapper in Step 9) and note it.

- [ ] **Step 8: Run the panel test to verify the new block fails**

Run: `npx vitest run src/app/projects-panel.test.tsx > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✗|×" "$LOG" | head -20`
Expected: EXIT=1; only tests in "key-fact indicator" fail; every pre-existing test still passes.

- [ ] **Step 9: Render the indicator in the panel**

In `src/app/projects-panel.tsx` (Edit tool).

Imports: replace
```ts
import { type ProjectMeta, type Resource } from "./types";
```
with
```ts
import { type ProjectMeta, type Resource } from "./types";
import { KEY_FACT_IDS, keyFactCompleteness } from "./project-key-facts";
import { loadKeyFactsSnapshot } from "./project-key-facts-cache";
import { KeyFactsBanner, KeyFactsMeter, type KeyFactsRowState } from "./project-key-facts-meter";
```

Derive per-row state. Replace
```ts
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
```
with
```ts
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });

  // Per-row key-fact state (spec §5.3/§5.4). The CURRENT project is measured live
  // from memory and never reads the cache; every other row reads its per-device
  // snapshot, and a missing snapshot is UNKNOWN — never "0 of 11".
  const keyFactsByRow = useMemo(() => {
    const byId = new Map<string, { state: KeyFactsRowState; customer: string }>();
    for (const p of projects) {
      if (p.id === currentProjectId) {
        if (currentProject) {
          const c = keyFactCompleteness(currentProject);
          byId.set(p.id, { state: { kind: "measured", ...c }, customer: currentProject.customer });
        } else {
          byId.set(p.id, { state: { kind: "unknown", total: KEY_FACT_IDS.length }, customer: "" });
        }
        continue;
      }
      const snap = loadKeyFactsSnapshot(p.id);
      byId.set(
        p.id,
        snap
          ? { state: { kind: "measured", filled: snap.filled, total: KEY_FACT_IDS.length, missing: snap.missing }, customer: snap.customer }
          : { state: { kind: "unknown", total: KEY_FACT_IDS.length }, customer: "" },
      );
    }
    return byId;
  }, [projects, currentProjectId, currentProject]);
```

Row body. Replace
```tsx
            {projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              return (
```
with
```tsx
            {projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const keyFacts = keyFactsByRow.get(p.id);
              return (
```

Add the cached customer line for non-current rows: replace
```tsx
                      {isCurrent && currentProject && (
                        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
```
with
```tsx
                      {!isCurrent && keyFacts?.customer && (
                        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          <div className="flex gap-1">
                            <dt className="font-medium">{t(lang, "projectCustomer")}:</dt>
                            <dd>{keyFacts.customer}</dd>
                          </div>
                        </dl>
                      )}
                      {isCurrent && currentProject && (
                        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
```

Render meter + banner as the last children of the `<li>`. Read the `<li>` for the active-projects list (the first `projects.map`, not the archived list) and locate its closing `</li>`; the element immediately before it is the closing `</div>` of the `flex flex-wrap items-start justify-between gap-2` header row. Insert between that `</div>` and `</li>`:
```tsx
                  {keyFacts && <KeyFactsMeter lang={lang} state={keyFacts.state} />}
                  {isCurrent && keyFacts?.state.kind === "measured" && (
                    <KeyFactsBanner
                      lang={lang}
                      missing={keyFacts.state.missing}
                      onComplete={() => setModal({ mode: "edit" })}
                    />
                  )}
```
The `<li>` is already `flex flex-col gap-2`, so no spacing wrapper is needed. Do NOT touch the archived-projects list.

- [ ] **Step 10: Run the panel test to verify it passes**

Run: `npx vitest run src/app/projects-panel.test.tsx > "$LOG" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$LOG"`
Expected: EXIT=0, all tests pass (pre-existing + 7 new). Then run `npx vitest run src/app/project-key-facts-meter.test.tsx` once more → EXIT=0.

- [ ] **Step 11: Mutation check (record results)**

(a) In the panel memo, make the current row read `loadKeyFactsSnapshot(p.id)` first → "ignores a cached snapshot for the current project" must FAIL. (b) Change the unknown branch to `{ kind: "measured", filled: 0, total: 11, missing: [...KEY_FACT_IDS] }` → "never-cached … unknown" must FAIL. (c) Drop `isCurrent &&` from the banner condition → "banner action once" must FAIL. Restore each; `git diff --stat` shows only intended files.

- [ ] **Step 12: Commit**

```bash
git add src/app/project-key-facts-meter.tsx src/app/project-key-facts-meter.test.tsx src/app/projects-panel.tsx src/app/projects-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(projects): show key-fact completeness on every project row"
```

---

## Owed by eye-verify after merge (spec §7, not verifiable in CI — never report as done)

- §7.5 — meter fill and banner contrast in all seven scheme combinations (Projects is not axe-scanned).
- §7.7 — a never-opened project renders "Key facts not measured here" / "— / 11", not "0 of 11".
- The Next actions row for a name-only project shows one grouped row with "+9 more reasons", and its Open lands on the Projects view without a `#projects/NaN` URL.
- Switching between two file-mode projects and back leaves each row's cached count matching that project (exercises Ruling 6).
