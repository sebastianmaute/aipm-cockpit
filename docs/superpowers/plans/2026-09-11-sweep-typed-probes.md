# Typed Probes for the Offered-Surface Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the offered-surface sweep's three probe derivations with one typed derivation whose every probe is admitted by the writer's own sanitizer first, fix §460, and fix any real undeclared write the stronger probes expose.

**Architecture:** A new pure helper module, `src/test/sweep-probes.ts`, owns `changedInKind`, the per-entity `ADMISSION_ORACLE`, `admitProbe` and `probeFor`. Both relations of `plan.offered-surface-sweep.test.ts` call `probeFor` and act on its three outcomes (`probe` / `dead` / `unmeasured`). Relation A gains a both-directions ledger like Relation B's. §460 is a one-condition product change in `plan.ts`, test-first.

**Tech Stack:** TypeScript, vitest 4.1.8 (jsdom), React Testing Library `renderHook`, the chat dispatcher test fixture.

**Spec:** `docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md` (commit `c9a501fb`). Task 1 corrects three points in it that planning disproved; read the corrected version.

## Global Constraints

- Branch `feat/sweep-typed-probes`, off `origin/main` `1e437e7e`. Never push, open an MR or merge without the user's explicit say.
- `src/app/*.ts(x)` and `src/test/*.ts` are CRLF in the working tree: edit existing ones with the **Edit tool only**. A NEW file is created with Write and then normalised to CRLF (command in Task 3).
- Docs (`docs/**/*.md`) are LF.
- Never touch `src/app/i18n.de.ts` with Edit or Write.
- `src/app/sanitize-records.ts` must stay at exactly 1600 lines. Any change there is a STOP: report back, do not edit.
- Stage explicit paths only. Commit with `git commit --only <paths> -F <msgfile>`. Never `git add -A` / `git add .` (an untracked `not-in-use.env.local.bak` holds a live credential — never open, print or stage it). Never `--amend`. Never bare `git stash`. Never `npm ci`.
- `git checkout -- <file>` is blocked and `git restore` is not used. Revert with an inverse anchored Edit whose old string is unique in BOTH directions, then prove `git diff --stat -- <file>` prints nothing.
- Scratch files only under `SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad"`, with the per-task prefix named in each task (`tp1-` … `tp8-`). Never overwrite a file another task created.
- vitest: always `--maxWorkers=1`, never backgrounded, never two vitest processes at once. Never read an exit code through a pipe: redirect to a log, `echo "EXIT=$?"`, then grep the log. Assert the `Test Files` count equals the number of files you passed.
- `npx tsc --noEmit`: read the count of `src/` error lines, not the exit code.
- No full suite. `npm run test:shuffle` is owed at the end and runs only on the user's say.
- Commit message trailer (last line): the session trailer. Never put an assistant session URL in an MR description or `CHANGELOG.md`.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md` | Modify (Task 1, Task 8) | Correct three disproved points; closing note with measurements |
| `src/app/inline-ai-edit/plan.ts` | Modify (Task 2) | Lift the `target === "row"` gate in `pushLinkDiffs`; rewrite its comment |
| `src/app/inline-ai-edit/plan.test.ts` | Modify (Task 2) | Rewrite the (C3) header and the case that pinned §460 as correct |
| `src/app/inline-ai-edit/plan.create-path-guards.test.ts` | Modify (Task 2, maybe Task 6) | New §460 pin driving card and write; pins for any Task 6 fix |
| `src/test/sweep-probes.ts` | Create (Task 3) | `changedInKind`, `isBlank`, `ADMISSION_ORACLE`, `admitProbe`, `probeFor`, `MAIL_UNSAFE_BOOLEANS` |
| `src/test/sweep-probes.test.ts` | Create (Task 3) | Unit tests for the module above |
| `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` | Modify (Tasks 2, 4, 5) | Both relations on `probeFor`; Relation A ledger; mail guard restated |
| `src/test/inline-sweep-fixtures.ts` | Modify (Task 5) | Seed `exceptions` on `seedGuardedCalendarEvent` |
| `src/app/use-register-tools.ts` / `src/app/use-chat-dispatcher.ts` | Maybe modify (Task 6) | Missing guard call, only if Relation A finds a real undeclared write |
| `docs/open-followups.md` | Modify (Task 8) | Close §459/§460, narrow §441/§443, file §462 |

---

### Task 1: Correct the spec before anyone builds on it

Planning disproved three points of the approved spec. Fix them first, so no later task inherits them.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Replace the oracle paragraph.** In section "### 2. The admission check", replace the paragraph that begins "Before either relation judges a field, the probe is put through the storage layer." and the paragraph that begins "`jsonToWorkspace` is the oracle because" with:

```markdown
Before either relation judges a field, the reference row with the probe substituted into the field is
passed to that entity's **writer sanitizer** for the arm being judged, `ADMISSION_ORACLE[entity][arm]`
(`src/test/sweep-probes.ts`):

| entity | create | update |
|---|---|---|
| raid | `sanitizeRaidItem` | `sanitizeRaidItem` |
| change | `sanitizeModelChangeItem` | `sanitizeChangeItem` |
| milestone | `sanitizeMilestone` | `sanitizeMilestone` |
| stakeholder | `sanitizeStakeholder` | `sanitizeStakeholder` |
| resource | `sanitizeResource` | `sanitizeResource` |
| absence | `sanitizeAbsence` | `sanitizeAbsence` |
| calendarEvent | `sanitizeCalendarEvent` | `sanitizeCalendarEvent` |
| task | one-row `jsonToWorkspace` round trip | same |

★★ **WHY NOT `jsonToWorkspace` FOR ALL EIGHT, as this section first said.** `jsonToWorkspace`
(`src/app/workspace.ts`) CASTS raid rows (only `sanitizeRaidRichFields` runs) and task rows (only
`migrateTask` and `sanitizeNoteFields` run). As the oracle it would admit almost any probe on those two
entities, including one the writer's own sanitizer reshapes, which is the vacuity this slice removes.
Reproduce: `grep -n "tasks: (p.tasks\|raid: (p.raid" src/app/workspace.ts`.

★ **TASK IS THE ONE WEAK ORACLE, AND IT IS WEAK ON PURPOSE.** `create_task` has no row sanitizer: its
writer builds the row field by field. The oracle for task is therefore the at-rest store alone, which
admits nearly any value. That is recorded, and pinned by a unit test, rather than hidden.
```

- [ ] **Step 2: Correct the fixture paragraph.** In section "### 5. Fixtures", replace the first sentence ("Seed `calendarEvent.exceptions` with a valid `EventException[]` on the sweep's calendar-event seed … and on `CREATE_BASE.calendarEvent` (`src/test/offered-surface-axis.ts`).") with:

```markdown
Seed `calendarEvent.exceptions` with a valid two-element `EventException[]` on the sweep's
calendar-event seed (`seedGuardedCalendarEvent`, `src/test/inline-sweep-fixtures.ts`) ONLY.
★★ NOT on `CREATE_BASE.calendarEvent`: the sweep's floor "the create base names only declared fields"
forbids an undeclared key there, and `exceptions` is undeclared. It is not needed either — the create
arm's reference is the control row, which holds no `exceptions`, so `probeFor` falls back to the
seeded array.
```

- [ ] **Step 3: Split `dead` from `unmeasured`.** In section "### 2. The admission check", replace the paragraph beginning "Otherwise the relation records a finding of the new kind `unmeasured`" with:

```markdown
The outcome has three kinds, and the two non-probe kinds want different repairs:

- **`dead`** — the harness cannot derive a distinguishable probe: nothing to derive from, the derived
  value equals the reference, or the mail-safety policy (`calendarEvent.sendInvitations`). The repair
  is a fixture or a probe shape. This is the existing kind, unchanged in meaning.
- **`unmeasured`** (new) — a probe was derived, but the writer's sanitizer will not hold it unchanged.
  The repair is a probe shape, or a product decision about what the column accepts.
```

And in section "### 6. Ledger", in the bullet beginning "**New `unmeasured` entries**", keep the text; add after the section's last bullet:

```markdown
- **Citation.** Every new `unmeasured` or `dead` entry cites §462, the register entry Task 8 files for
  "fields the typed probes cannot measure". Reserve the number by re-running the register-max command
  against `origin/main` before writing any citation.
```

- [ ] **Step 4: Verify LF and commit.**

```bash
node -e "const s=require('fs').readFileSync('docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md','utf8');console.log('CR',(s.match(/\r/g)||[]).length)"
```
Expected: `CR 0`.

Write the message to `$SP/tp1-msg.txt`:
```
docs(spec): correct the typed-probe spec's oracle, fixture and outcome kinds

jsonToWorkspace casts raid and task rows, so as the admission oracle it
would admit almost any probe on those two entities. The oracle is each
entity's writer sanitizer instead, with task alone falling back to the
at-rest store. CREATE_BASE cannot carry exceptions, which the create
base's declared-only floor forbids, and does not need to. dead and
unmeasured are separate outcome kinds because they want different
repairs.
```
```bash
git add docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md
git commit --only docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md -F "$SP/tp1-msg.txt"; echo "EXIT=$?"
```

---

### Task 2: §460 — a create card previews only the attendees the create stores

**Files:**
- Modify: `src/app/inline-ai-edit/plan.create-path-guards.test.ts` (new describe at the end)
- Modify: `src/app/inline-ai-edit/plan.ts` (`pushLinkDiffs`, the `const guard = …` line and the comment above it; the `toolName` parameter docstring)
- Modify: `src/app/inline-ai-edit/plan.test.ts` (the `(C3)` header, its `describe` title, and the case "does NOT apply the guard to a create, whose write never sees it")
- Modify: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` (the create-arm comment that says the guard "is looked up for `"row"` alone")

**Interfaces:**
- Consumes: `describeEntityCalls`, `INLINE_DESCRIPTORS`, `CREATE_BASE`, `seedResource` (resource `#4`), `snapshot`, `dispatcherWrapperWith`, `makeDispatcherArgs`, `runTool`, `useChatDispatcher`, `useWorkspace`.
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the failing card-and-write pin.** Append to `src/app/inline-ai-edit/plan.create-path-guards.test.ts` (Edit tool; anchor on the file's final `});` of the last describe — read the tail first and pick a unique anchor). Add the imports it needs to the existing import block: `seedResource` to the `../../test/inline-sweep-fixtures` import, plus

```ts
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import { describeEntityCalls } from "./plan";
```

Then the describe:

```ts
// ★★★ §460 — THE CARD AND THE WRITE, DRIVEN BY ONE INPUT. `pushLinkDiffs`
//  once applied the link guard on the ROW path only, which was right while both
//  allow-list creates handed `input` straight to their sanitizer. Since
//  `68486cd4` `createCalendarEvent` runs `dropUnacceptedCalendarEventFields`
//  first, and `CALENDAR_EVENT_FIELD_GUARDS.attendeeResourceIds` refuses the
//  WHOLE array when any member is not a number — so `[4, "4"]` stored no
//  attendee while the card, coercing each element with `toNumber`, previewed
//  attendee 4. No other detector sees both halves: a create card's links are
//  disclosure only, and the offered-surface sweep drives the seeded all-numeric
//  `[4]`.
//
//  ★★ THE FIRST CASE IS THE ANTI-VACUITY HALF. Without it, a card that
//   dropped every link and a create that stored nothing would pass the second.
describe("a create card previews only the attendees the create stores (§460)", () => {
  async function cardAndWrite(attendeeResourceIds: unknown[]) {
    const { result } = renderHook(
      () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
      { wrapper: dispatcherWrapperWith({ resources: [seedResource()] }) },
    );
    const input = { ...CREATE_BASE.calendarEvent, attendeeResourceIds };
    const card = describeEntityCalls([{ type: "tool_use", name: "create_calendar_event", input }], {
      descriptor: INLINE_DESCRIPTORS.calendarEvent,
      // No item on a create: `describeEntityCalls` reads `item.id` only on the update branch.
      item: undefined as unknown as { id: number },
      ws: snapshot(result.current.ws),
    });
    await act(async () => {
      await runTool(result.current.d, "create_calendar_event", input);
    });
    return { card, rows: snapshot(result.current.ws).calendarEvents ?? [] };
  }

  it("previews and stores attendee 4 from an all-numeric list", async () => {
    const { card, rows } = await cardAndWrite([4]);
    expect(rows).toHaveLength(1);
    expect(rows[0].attendeeResourceIds).toEqual([4]);
    expect(card.links.map((l) => l.rawIds)).toEqual([[4]]);
  });

  it('previews no attendee from [4, "4"], because the create stores none', async () => {
    const { card, rows } = await cardAndWrite([4, "4"]);
    expect(rows, "the create stored no row, so this pin would pass for the wrong reason").toHaveLength(1);
    expect(rows[0].attendeeResourceIds ?? []).toEqual([]);
    expect(card.links).toEqual([]);
  });
});
```

If `dispatcherWrapperWith`'s `TestSeed` type rejects `{ resources: [...] }`, read `src/test/chat-dispatcher-fixture.tsx` and use the shape it declares; do not cast the seed to `never`.

- [ ] **Step 2: Run it; the second case must fail.**

```bash
npx vitest run src/app/inline-ai-edit/plan.create-path-guards.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp2-red.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |FAIL|✗|×" "$SP/tp2-red.log" | head -20
```
Expected: `EXIT=1`, exactly 1 failed test — the `[4, "4"]` case, on `expect(card.links).toEqual([])` (the card shows one link with `rawIds: [4]`). If the FIRST case fails, or the second fails on the rows assertion, stop: the premise of §460 is not what the register says, and that is a finding to report, not something to fix.

- [ ] **Step 3: Lift the gate.** In `src/app/inline-ai-edit/plan.ts`, replace the comment block that begins `    //  ★★★ \`target === "row"\` WAS RIGHT WHEN IT WAS WRITTEN (2026-09-07) AND` and ends with the line `    const guard = target === "row" ? d.rawTypeGuards?.[f] : undefined;` with:

```ts
    //  ★★★ THE GUARD RUNS ON A CREATE TOO, BECAUSE THE CREATE WRITE RUNS IT.
    //   `93c9efe8` (2026-09-07) gated this on `target === "row"`: both
    //   allow-list creates then handed `input` straight to their sanitizer, so
    //   this module's `link.sanitize` was exactly what a create stored. Since
    //   `68486cd4` (2026-09-08) `create_absence` / `create_calendar_event` run
    //   `dropUnacceptedAbsenceFields` / `dropUnacceptedCalendarEventFields`
    //   first (`use-register-tools.ts`), and the gate let a create card preview
    //   `[4, "4"]` as attendee 4 while the write dropped the whole array — §460,
    //   closed by lifting it. A create call passes no `toolName`, so a refused
    //   link on a create is OMITTED from the card, never reported: disclosing
    //   it is §440's. ★ `absence.resourceId` never diverged — its
    //   `link.sanitize` already carries the row's `typeof` leg.
    const guard = d.rawTypeGuards?.[f];
```

Then, in the `toolName` parameter's docstring above (it currently ends "…so a create never pushes a `rejected` row (§440); see the guard and §460."), read the exact bytes and rewrite its last sentence so it ends: "…because the create branch passes none, so a refused link on a create is omitted rather than reported (§440)."

`target` stays a parameter: it still sets `LinkDiff.target` on the pushed link. Confirm with `grep -n "target" src/app/inline-ai-edit/plan.ts` that it is still read below the guard; if it is not, stop and report — removing the parameter is out of scope.

- [ ] **Step 4: Rewrite the `plan.test.ts` case that pinned the old behaviour.** In `src/app/inline-ai-edit/plan.test.ts`:

(a) Replace the `(C3)` header (the comment block beginning `// (C3) THE MERGE-SITE GUARD ON LINK FIELDS, AND THE \`target\` SPLIT THAT MAKES` through `//   would be the preview inventing a rule the write does not have.`) and the describe line `describe("link fields honour the merge-site guard on the ROW path only", () => {` with:

```ts
// (C3) THE MERGE-SITE GUARD ON LINK FIELDS, ON BOTH PATHS. `rawTypeGuards`
//  models an ALLOW-LIST merge site, and the update branch consults it for every
//  `diffFields` member — but a LINK field is not in `diffFields`, so
//  `attendeeResourceIds` and `absence.resourceId` bypassed it entirely.
//
//  ★★ THE CREATE PATH WAS ONCE THE EXCEPTION, AND THIS HEADER SAID SO. Until
//   `68486cd4` both allow-list CREATES handed `input` straight to their
//   sanitizer, so the guard ran on the row path only and a create previewed
//   `sanitizeAttendees` verbatim. Since then `createAbsence` /
//   `createCalendarEvent` (`use-register-tools.ts`) run `dropUnaccepted*Fields`
//   first, so a create refuses what an update refuses, and the card must too
//   (§460). A create passes no `toolName`, so its refusal is an OMITTED link,
//   never a `rejected` row — disclosing it is §440's.
describe("link fields honour the merge-site guard on the row and the create path", () => {
```

(b) Replace the comment `  // THE \`target\` GATE. A CREATE never passes through` … through the whole case `it("does NOT apply the guard to a create, whose write never sees it", () => { … });` with:

```ts
  // THE CREATE PATH. `createCalendarEvent` runs
  //  `dropUnacceptedCalendarEventFields` before `sanitizeCalendarEvent`, so
  //  `[7, "9"]` is dropped WHOLE and no attendee is stored; the card must show
  //  none. `rejected` stays empty because a create passes no `toolName` — that
  //  is §440's missing channel, not agreement. Restore a `target === "row"`
  //  condition in `pushLinkDiffs` and this goes red while every case above
  //  stays green.
  it("applies the guard to a create too, because the create write applies it", () => {
    const plan = planFor("create_calendar_event", { title: "Kickoff", attendeeResourceIds: [7, "9"] }, "calendarEvent");
    expect(plan.rejected).toEqual([]);
    expect(plan.links).toEqual([]);
  });

  // ANTI-VACUITY for the case above: an all-numeric list still previews on a create.
  it("still previews a create's attendee list the write accepts", () => {
    const plan = planFor("create_calendar_event", { title: "Kickoff", attendeeResourceIds: [7, 9] }, "calendarEvent");
    expect(plan.links).toEqual([
      { entity: "calendarEvent", target: "create", subject: "Kickoff", field: "attendeeResourceIds", before: "", after: "Ada Lovelace, Grace Hopper", rawIds: [7, 9] },
    ]);
  });
```

- [ ] **Step 5: Sweep the prose that described the gate.** Run:

```bash
grep -rn 'target === "row"\|for `"row"` alone\|looked up for' src docs/AGENTS AGENTS.md
```
Every hit must be either the new comments above (which name the old gate as history) or rewritten. The known one: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`, the create-arm comment block beginning `  // ★★★ THE CREATE ARM HAS NO REJECTION BRANCH`. Replace its sentences from `It stays silent there only because that call passes` through `fall through to, and this arm asserts LANDING ONLY.` with:

```ts
  //  It stays silent there because the create call passes no `toolName`: since
  //  §460 the guard itself runs on a create too, so a refused link is OMITTED
  //  from the card rather than reported. So there is nothing for a "or the
  //  card refused it" disjunct to fall through to, and this arm asserts
  //  LANDING ONLY.
```

- [ ] **Step 6: Run the three touched test files, green.**

```bash
npx vitest run src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp2-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp2-green.log"
```
Expected: `EXIT=0`, `Test Files  3 passed (3)`. If the sweep reds, read its finding lines: a create-arm `dropped` on `calendarEvent.attendeeResourceIds` would mean the sweep's seeded probe is now refused on the card — report it, do not ledger it.

- [ ] **Step 7: Mutation-check the new pin.** Temporarily restore the gate: Edit `    const guard = d.rawTypeGuards?.[f];` → `    const guard = target === "row" ? d.rawTypeGuards?.[f] : undefined;` (assert the old string occurs once). Run only `plan.create-path-guards.test.ts` and `plan.test.ts` (same command shape, log `$SP/tp2-mutant.log`). Expected: exactly 2 failed — the `[4, "4"]` pin and "applies the guard to a create too". Revert with the inverse Edit (assert the mutant string occurs once), then:

```bash
git diff --stat -- src/app/inline-ai-edit/plan.ts
```
Expected: the diff is exactly Step 3's change — re-read `grep -n 'const guard = ' src/app/inline-ai-edit/plan.ts` and confirm it reads `d.rawTypeGuards?.[f];`.

- [ ] **Step 8: Typecheck and lint.**

```bash
npx tsc --noEmit > "$SP/tp2-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "^src/" "$SP/tp2-tsc.log"
npx eslint --max-warnings=0 src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts; echo "EXIT=$?"
```
Expected: `0` src error lines; eslint `EXIT=0`.

- [ ] **Step 9: Commit.** Message to `$SP/tp2-msg.txt`:
```
fix(ai): apply the link guard to a create card, as the create write does

Since 68486cd4 both allow-list creates run their merge-site guard before
the sanitizer, but pushLinkDiffs still consulted rawTypeGuards on the row
path only. A create card therefore previewed create_calendar_event's
[4, "4"] as attendee 4 while the write dropped the whole array. The guard
now runs on both paths; a refused link on a create is omitted from the
card, and disclosing it stays 440's.

A new pin drives one input through both the card and the write, and
failed before the change. The plan.test.ts case that pinned the old
preview as correct is rewritten, with its (C3) header.

Closes 460.
```
```bash
git add src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
git commit --only src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -F "$SP/tp2-msg.txt"; echo "EXIT=$?"
```

---

### Task 3: `src/test/sweep-probes.ts` — one derivation, one admission check

**Files:**
- Create: `src/test/sweep-probes.ts`
- Create: `src/test/sweep-probes.test.ts`

**Interfaces:**
- Consumes: `schemaProperty(entity, op, field)` and `declaredProperties(entity, op)` and `ENTITIES` from `src/test/offered-surface-axis.ts`; `same(a, b)` from `src/test/inline-sweep-fixtures.ts`; the sanitizers named in the oracle table; `jsonToWorkspace(text)` from `src/app/workspace.ts`; `InlineEntity` from `src/app/inline-ai-edit/entity-descriptor.ts`.
- Produces (exact exports, used by Tasks 4, 5, 7):

```ts
export type Row = Record<string, unknown>;
export type Arm = "create" | "update";
/** `row` is the row the comparison is made against, for normalisers that read siblings. */
export type Compare = (a: unknown, b: unknown, row: Row) => boolean;
export type ProbeOutcome =
  | { kind: "probe"; value: unknown }
  | { kind: "dead"; reason: string }
  | { kind: "unmeasured"; reason: string };
export const MAIL_UNSAFE_BOOLEANS: ReadonlySet<string>;
export function isBlank(v: unknown): boolean;
export function changedInKind(v: unknown): unknown; // undefined = nothing to derive
export const ADMISSION_ORACLE: Readonly<Record<InlineEntity, Readonly<Record<Arm, (row: Row) => Row | null>>>>;
export function admitProbe(entity: InlineEntity, arm: Arm, field: string, reference: Row, probe: unknown, compare: Compare): string | undefined;
export function probeFor(args: {
  entity: InlineEntity; arm: Arm; field: string; declared: boolean;
  reference: Row; seedRow: Row; compare: Compare;
}): ProbeOutcome;
```

- [ ] **Step 1: Write the failing unit tests.** Create `src/test/sweep-probes.test.ts`:

```ts
// src/test/sweep-probes.test.ts
import { describe, expect, it } from "vitest";

import { same } from "./inline-sweep-fixtures";
import { declaredProperties, ENTITIES, schemaProperty } from "./offered-surface-axis";
import {
  admitProbe,
  ADMISSION_ORACLE,
  changedInKind,
  type Compare,
  isBlank,
  probeFor,
} from "./sweep-probes";

const sameAt: Compare = (a, b) => same(a, b);

describe("changedInKind", () => {
  it.each([
    [true, false],
    [false, true],
    [4, 5],
    ["2026-01-31", "2026-02-01"],
    ["14:00", "15:00"],
    ["23:30", "00:30"],
    ["2026-07-08T10:00:00.000Z", "2026-07-09T10:00:00.000Z"],
    ["m.bennett@example.com", "m.bennett+probed@example.com"],
    ["Room 1", "Room 1 probed"],
    [[1, 2, 3], [2, 3]],
    [[1], []],
  ])("changes %j into %j", (input, expected) => {
    expect(changedInKind(input)).toEqual(expected);
  });

  it.each([[""], [[]], [{}], [null], [undefined]])("has nothing to derive from %j", (input) => {
    expect(changedInKind(input)).toBeUndefined();
  });

  // ★★ A free-text leaf is the change most likely to be refused inside a
  //  structured value (a closed vocabulary such as a recurrence `freq`), so
  //  the object branch changes a number, boolean, date or time leaf first.
  it("changes a structured value's numeric leaf before its free text", () => {
    expect(changedInKind({ freq: "weekly", interval: 2, byDay: ["WE"] })).toEqual({
      freq: "weekly",
      interval: 3,
      byDay: ["WE"],
    });
  });

  it("falls back to a string leaf when an object has nothing else", () => {
    expect(changedInKind({ a: "x" })).toEqual({ a: "x probed" });
  });
});

describe("isBlank", () => {
  it.each([[undefined], [null], [""], [[]], [{}]])("%j is blank", (v) => expect(isBlank(v)).toBe(true));
  it.each([[false], [0], ["a"], [[0]], [{ a: 1 }]])("%j is not blank", (v) => expect(isBlank(v)).toBe(false));
});

describe("ADMISSION_ORACLE", () => {
  it("names a writer sanitizer for every inline entity and both arms", () => {
    expect(Object.keys(ADMISSION_ORACLE).sort()).toEqual([...ENTITIES].sort());
  });
});

describe("admitProbe", () => {
  const absence = { id: 1, assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" };

  it("admits a probe the writer's sanitizer keeps as sent", () => {
    expect(admitProbe("absence", "create", "startDate", absence, "2026-06-02", sameAt)).toBeUndefined();
  });

  // §459's absence probe: later than the end, so `sanitizeAbsence` orders the pair.
  it("refuses a probe the writer's sanitizer reshapes, and says what it became", () => {
    expect(admitProbe("absence", "create", "startDate", absence, "2026-06-03", sameAt)).toMatch(/reshapes/);
  });

  // §441's recurrence probe: `sanitizeRecurrence` drops a non-object.
  it("refuses a string sent to a structured field", () => {
    const meeting = { id: 2, title: "Sync", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 30 };
    expect(admitProbe("calendarEvent", "create", "recurrence", meeting, "probed", sameAt)).toBeDefined();
  });

  // ★★ THE ONE WEAK ORACLE, PINNED SO NOBODY READS IT AS STRONG. Task has no
  //  row sanitizer, so its oracle is the at-rest store, which keeps a string
  //  that is not an address.
  it("admits nearly anything on task, whose oracle is the at-rest store alone", () => {
    expect(admitProbe("task", "create", "assigneeEmail", { id: 3, taskName: "A task" }, "not-an-address", sameAt)).toBeUndefined();
  });
});

describe("probeFor", () => {
  it("never derives a probe for a mail-unsafe field", () => {
    for (const arm of ["create", "update"] as const) {
      for (const sendInvitations of [undefined, false, true]) {
        const outcome = probeFor({
          entity: "calendarEvent",
          arm,
          field: "sendInvitations",
          declared: true,
          reference: { sendInvitations },
          seedRow: { sendInvitations: true },
          compare: sameAt,
        });
        expect(outcome.kind).toBe("dead");
      }
    }
  });

  it("takes a declared enum member that differs from the reference", () => {
    const found = ENTITIES.flatMap((entity) =>
      declaredProperties(entity, "create").map((field) => ({ entity, field, prop: schemaProperty(entity, "create", field) })),
    ).find((x) => (x.prop.enum?.length ?? 0) >= 2);
    expect(found, "no declared field carries a 2+ member enum, so this case is vacuous").toBeDefined();
    const { entity, field, prop } = found!;
    const outcome = probeFor({
      entity, arm: "create", field, declared: true,
      reference: { [field]: prop.enum![0] }, seedRow: {}, compare: sameAt,
    });
    // Admission may still refuse it on this bare reference row; the DERIVATION is what is pinned.
    if (outcome.kind === "probe") expect(outcome.value).not.toEqual(prop.enum![0]);
    else expect(outcome.kind).not.toBe("dead");
  });

  // §459's task probe: the create reference holds no email, so the SEEDED address is sent as is.
  it("sends the seeded value as is when the reference carries none", () => {
    const outcome = probeFor({
      entity: "task", arm: "create", field: "assigneeEmail", declared: true,
      reference: { id: 1, taskName: "A task" }, seedRow: { assigneeEmail: "m.bennett@example.com" }, compare: sameAt,
    });
    expect(outcome).toEqual({ kind: "probe", value: "m.bennett@example.com" });
  });

  it("is dead when there is nothing to derive from", () => {
    const outcome = probeFor({
      entity: "absence", arm: "update", field: "note", declared: false,
      reference: { id: 1 }, seedRow: { id: 1 }, compare: sameAt,
    });
    expect(outcome.kind).toBe("dead");
  });

  it("is unmeasured when the writer's sanitizer will not hold the derived probe", () => {
    const outcome = probeFor({
      entity: "absence", arm: "create", field: "startDate", declared: false,
      reference: { id: 1, assignee: "Ada Lovelace", startDate: "2026-06-02", endDate: "2026-06-02" },
      seedRow: {}, compare: sameAt,
    });
    // 2026-06-02 + 1 day is later than the end date, so `sanitizeAbsence` swaps the pair.
    expect(outcome.kind).toBe("unmeasured");
  });
});
```

(`declared: false` in the last two cases only skips the enum lookup — `schemaProperty` throws for a field a tool does not declare, and these cases are about derivation and admission, not the schema.)

- [ ] **Step 2: Run; it fails on the missing module.**

```bash
npx vitest run src/test/sweep-probes.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp3-red.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" "$SP/tp3-red.log" | head
```
Expected: `EXIT=1`, a resolution error for `./sweep-probes`.

- [ ] **Step 3: Write the module.** Create `src/test/sweep-probes.ts`:

```ts
// src/test/sweep-probes.ts
//
// ★★★ ONE PROBE DERIVATION FOR BOTH OFFERED-SURFACE RELATIONS, AND EVERY PROBE
// ADMITTED BY THE WRITER'S OWN SANITIZER BEFORE A RELATION MAY JUDGE IT.
//
// Relation A asks whether an UNDECLARED value is stopped; Relation B asks
// whether a DECLARED one lands. Both need the same kind of value: one the
// column can hold, which the writer would not produce on its own. An invalid
// value is stopped by the sanitizer whether or not the guard runs, so it
// proves nothing to either relation — that was §441's whole probe-shape
// blindness, and `trespassProbeFor` (deleted) produced exactly such values.
//
// A field whose probe the writer's sanitizer will not hold unchanged is
// reported `unmeasured`, BY NAME, in the sweep's both-directions ledger. It is
// never judged, and it is never green by default.
import { sanitizeCalendarEvent } from "../app/calendar-event";
import type { InlineEntity } from "../app/inline-ai-edit/entity-descriptor";
import { sanitizeAbsence, sanitizeResource } from "../app/sanitize-entities";
import {
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeModelChangeItem,
  sanitizeRaidItem,
  sanitizeStakeholder,
} from "../app/sanitize-records";
import { jsonToWorkspace } from "../app/workspace";
import { schemaProperty } from "./offered-surface-axis";

export type Row = Record<string, unknown>;
export type Arm = "create" | "update";
/** `row` is the row the comparison is made against, for normalisers that read siblings. */
export type Compare = (a: unknown, b: unknown, row: Row) => boolean;
export type ProbeOutcome =
  | { kind: "probe"; value: unknown }
  | { kind: "dead"; reason: string }
  | { kind: "unmeasured"; reason: string };

/** ★★★ THE ONE FIELD NO PROBE MAY DRIVE, AND THE ONLY REASON IS MAIL.
 *  `calendarEvent.sendInvitations` true trips `shouldStage` in
 *  `chat-proposal.ts`, the one write in this app that leaves the building.
 *  A SAFETY EXCLUSION, not an exemption: the field stays on the axis and
 *  reports `dead`, so it is visibly unmeasured. Do NOT widen this set to make a
 *  red run green (§443). */
export const MAIL_UNSAFE_BOOLEANS: ReadonlySet<string> = new Set(["calendarEvent.sendInvitations"]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DAY_MS = 86_400_000;

export function isBlank(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/** Lower ranks are changed first inside a structured value. A free-text leaf
 *  is the change most likely to be refused there (a closed vocabulary such as
 *  a recurrence `freq`), so it goes last. Shape only — never a field name. */
function leafRank(v: unknown): number {
  if (typeof v === "number") return 0;
  if (typeof v === "boolean") return 1;
  if (typeof v === "string" && (DATE.test(v) || HHMM.test(v))) return 2;
  if (Array.isArray(v)) return 3;
  if (v !== null && typeof v === "object") return 4;
  return 5;
}

/** A value of the same KIND as `v` and different from it, or `undefined` when
 *  there is nothing to derive one from. Recognised by the value's SHAPE, as
 *  dates always were — there is no per-field override map, which would rot
 *  into an exemption list one rename at a time. */
export function changedInKind(v: unknown): unknown {
  if (typeof v === "boolean") return !v;
  if (typeof v === "number") return v + 1;
  if (typeof v === "string") {
    if (DATE.test(v)) {
      const d = new Date(`${v}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    if (HHMM.test(v)) {
      const [h, m] = v.split(":");
      return `${String((Number(h) + 1) % 24).padStart(2, "0")}:${m}`;
    }
    if (TIMESTAMP_PREFIX.test(v)) {
      const t = Date.parse(v);
      if (!Number.isNaN(t) && new Date(t).toISOString() === v) return new Date(t + DAY_MS).toISOString();
    }
    if (EMAIL_SHAPE.test(v)) {
      const at = v.indexOf("@");
      return `${v.slice(0, at)}+probed${v.slice(at)}`;
    }
    return v.length > 0 ? `${v} probed` : undefined;
  }
  // ★★ AN ARRAY DROPS A KNOWN-GOOD ELEMENT; IT NEVER APPENDS AN INVENTED ONE.
  //  Every element that remains is one the store already holds, so no type or
  //  foreign-key check can legitimately refuse it.
  if (Array.isArray(v)) {
    if (v.length >= 2) return v.slice(1);
    if (v.length === 1) return [];
    return undefined;
  }
  if (v !== null && typeof v === "object") {
    const obj = v as Row;
    const keys = Object.keys(obj).sort((a, b) => leafRank(obj[a]) - leafRank(obj[b]));
    for (const k of keys) {
      const changed = changedInKind(obj[k]);
      if (changed !== undefined) return { ...obj, [k]: changed };
    }
    return undefined;
  }
  return undefined;
}

const asRow = (r: unknown): Row | null => (r === null || r === undefined ? null : (r as Row));
const taskAtRest = (row: Row): Row | null =>
  asRow(jsonToWorkspace(JSON.stringify({ tasks: [row], raid: [] })).tasks[0]);

/** The sanitizer each entity's WRITER runs on the given arm — the oracle for
 *  "can this column hold this value". Typed over `InlineEntity`, so a new
 *  entity is a tsc error until it names its writer.
 *
 *  ★★ NOT `jsonToWorkspace` FOR ALL EIGHT: it CASTS raid and task rows, so it
 *  would admit almost anything there. Task alone falls back to it, because
 *  `create_task` has no row sanitizer — its writer builds the row field by
 *  field. That oracle is WEAK on purpose and pinned as such in
 *  `sweep-probes.test.ts`. `change` differs by arm: the create writer repairs
 *  through `sanitizeModelChangeItem` (`use-register-tools.ts`). */
export const ADMISSION_ORACLE: Readonly<Record<InlineEntity, Readonly<Record<Arm, (row: Row) => Row | null>>>> = {
  task: { create: taskAtRest, update: taskAtRest },
  raid: { create: (r) => asRow(sanitizeRaidItem(r)), update: (r) => asRow(sanitizeRaidItem(r)) },
  change: { create: (r) => asRow(sanitizeModelChangeItem(r)), update: (r) => asRow(sanitizeChangeItem(r)) },
  milestone: { create: (r) => asRow(sanitizeMilestone(r)), update: (r) => asRow(sanitizeMilestone(r)) },
  stakeholder: { create: (r) => asRow(sanitizeStakeholder(r)), update: (r) => asRow(sanitizeStakeholder(r)) },
  resource: { create: (r) => asRow(sanitizeResource(r)), update: (r) => asRow(sanitizeResource(r)) },
  absence: { create: (r) => asRow(sanitizeAbsence(r)), update: (r) => asRow(sanitizeAbsence(r)) },
  calendarEvent: { create: (r) => asRow(sanitizeCalendarEvent(r)), update: (r) => asRow(sanitizeCalendarEvent(r)) },
};

/** `undefined` when the writer's sanitizer holds `probe` unchanged in `field`
 *  of `reference`; otherwise the reason it does not. */
export function admitProbe(
  entity: InlineEntity,
  arm: Arm,
  field: string,
  reference: Row,
  probe: unknown,
  compare: Compare,
): string | undefined {
  const kept = ADMISSION_ORACLE[entity][arm]({ ...reference, [field]: probe });
  if (!kept) return `the ${arm} writer's sanitizer refuses the whole row once ${field} is ${JSON.stringify(probe)}`;
  if (!compare(kept[field], probe, kept)) {
    return `the ${arm} writer's sanitizer reshapes ${JSON.stringify(probe)} to ${JSON.stringify(kept[field])}`;
  }
  return undefined;
}

/** The probe for one field on one arm, or why there is none.
 *
 *  Reference: the CONTROL row (what `CREATE_BASE` produces on its own) on the
 *  create arm, the BEFORE row on the update arm — the row the probe will be
 *  judged against, so a probe can no longer be derived against one row and
 *  judged against another (§459's `absence.startDate`, §443's `startTime`).
 *
 *  Source, most specific first: a declared `enum` member that differs from
 *  the reference; the reference value changed in kind; the SEEDED value — sent
 *  as is where the reference carries none, because the fixture already proved
 *  the sanitizer accepts it; otherwise nothing, and the field is `dead`. */
export function probeFor(args: {
  entity: InlineEntity;
  arm: Arm;
  field: string;
  declared: boolean;
  reference: Row;
  seedRow: Row;
  compare: Compare;
}): ProbeOutcome {
  const { entity, arm, field, declared, reference, seedRow, compare } = args;
  if (MAIL_UNSAFE_BOOLEANS.has(`${entity}.${field}`)) {
    return { kind: "dead", reason: "unmeasured by mail-safety policy: a strict true would stage a real invitation (§443)" };
  }
  const ref = reference[field];
  const eq = (a: unknown, b: unknown) => compare(a, b, reference);

  let candidate: unknown;
  const members = declared ? schemaProperty(entity, arm, field).enum : undefined;
  if (members && members.length > 0) {
    candidate = members.find((m) => !eq(m, ref));
  } else if (!isBlank(ref)) {
    candidate = changedInKind(ref);
  } else if (!isBlank(seedRow[field])) {
    candidate = eq(seedRow[field], ref) ? changedInKind(seedRow[field]) : seedRow[field];
  }

  if (candidate === undefined) return { kind: "dead", reason: "nothing to derive a distinguishable probe from" };
  if (eq(candidate, ref)) return { kind: "dead", reason: "the derived probe equals the reference value" };
  const refusal = admitProbe(entity, arm, field, reference, candidate, compare);
  return refusal === undefined ? { kind: "probe", value: candidate } : { kind: "unmeasured", reason: refusal };
}
```

- [ ] **Step 4: Normalise both new files to CRLF.**

```bash
for f in src/test/sweep-probes.ts src/test/sweep-probes.test.ts; do node -e "const f=process.argv[1],fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))" "$f"; done
node -e "for (const f of process.argv.slice(1)) { const s=require('fs').readFileSync(f,'utf8'); console.log(f, 'bareLF', (s.match(/(?<!\r)\n/g)||[]).length) }" src/test/sweep-probes.ts src/test/sweep-probes.test.ts src/test/offered-surface-axis.ts
```
Expected: `bareLF 0` for all three (the third is the known-CRLF control; if it prints non-zero the check is broken).

- [ ] **Step 5: Run the unit tests, green.**

```bash
npx vitest run src/test/sweep-probes.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp3-green.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp3-green.log"
```
Expected: `EXIT=0`, `Test Files  1 passed (1)`. If an `admitProbe` expectation fails, READ the named sanitizer before changing anything. If the sanitizer genuinely behaves otherwise, fix the TEST's expectation and its comment, and say so in your report with the sanitizer line you read. Never change `sweep-probes.ts` to satisfy a wrong expectation.

- [ ] **Step 6: Mutation-check `admitProbe` — do this AFTER Step 8's commit**, so the revert can be proven against a tracked file. Insert `  return undefined;` as the first line of `admitProbe`'s body — anchor the Edit on the unique line `  const kept = ADMISSION_ORACLE[entity][arm]({ ...reference, [field]: probe });` and put the mutant line above it. Re-run the file (log `$SP/tp3-mutant.log`). Expected: the two "refuses" cases and "is unmeasured when…" fail. Revert by deleting exactly that inserted line (same anchor), then `git diff --stat -- src/test/sweep-probes.ts` must print nothing.

- [ ] **Step 7: Typecheck and lint.**

```bash
npx tsc --noEmit > "$SP/tp3-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "^src/" "$SP/tp3-tsc.log"
npx eslint --max-warnings=0 src/test/sweep-probes.ts src/test/sweep-probes.test.ts; echo "EXIT=$?"
```
Expected: `0`; `EXIT=0`.

- [ ] **Step 8: Commit.** Message to `$SP/tp3-msg.txt`:
```
test(ai): add one typed probe derivation with a writer-sanitizer admission check

src/test/sweep-probes.ts derives a probe of the right kind against the row
it will be judged against, and admits it only if the entity's writer
sanitizer holds it unchanged. A probe the sanitizer reshapes is reported
unmeasured rather than judged. Unit-tested, including the one weak
oracle: task has no row sanitizer, so it falls back to the at-rest store.

Not wired into the sweep yet.
```
```bash
git add src/test/sweep-probes.ts src/test/sweep-probes.test.ts
git commit --only src/test/sweep-probes.ts src/test/sweep-probes.test.ts -F "$SP/tp3-msg.txt"; echo "EXIT=$?"
```

---

### Task 4: Relation B on `probeFor`

**Files:**
- Modify: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`

**Interfaces:**
- Consumes: everything Task 3 exports.
- Produces (used by Task 5): `loadedSeedRow(entity: InlineEntity): Row`, `viaPreview(normalize): Compare`, `FINDING_KINDS` including `"unmeasured"` and `"stored"`, `type Ledger`, `expectLedgerAgrees(relation: "A" | "B", entity, arm, findings)`.

- [ ] **Step 1: Imports and helpers.** In the sweep file:
  - Add `import { type Arm, type Compare, probeFor, type Row } from "../../test/sweep-probes";` to the import block, and delete the local `type Row = Record<string, unknown>;` line.
  - Delete `validProbeFor`, its docstring, `MAIL_UNSAFE_BOOLEANS` with its docstring, `probeAgainstControl` with its docstring. Leave `trespassProbeFor` for Task 5.
  - Add after `snapshotSeedRow`:

```ts
/** The seeded row as the PROVIDER holds it after load — the reference both
 *  update arms derive against and judge against, and the seed both create arms
 *  fall back to. ★★ Never the fixture literal: the provider's load path can
 *  reshape a seeded value, and a probe derived from the literal would then be
 *  judged against a row the provider never held. */
function loadedSeedRow(entity: InlineEntity): Row {
  const s = seedFor(entity);
  const { result } = renderHook(() => useWorkspace(), { wrapper: dispatcherWrapperWith(s.seed) });
  const wsKey = INLINE_DESCRIPTORS[entity].wsKey as WsKey;
  const row = (snapshot(result.current)[wsKey] as ReadonlyArray<Row> | undefined)?.find((r) => r.id === s.id);
  if (!row) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);
  return row;
}

/** Relation B's comparison: through the card's own normaliser, so a correct
 *  write of a normalised field is not read as a change or a drop. */
function viaPreview(normalize: ((v: unknown, row: Record<string, unknown>) => string) | undefined): Compare {
  return (a, b, row) => normalizedAs(a, row, normalize) === normalizedAs(b, row, normalize);
}
```

- [ ] **Step 2: Finding kinds and the two ledgers.** Replace the `FINDING_KINDS` line and its docstring's first paragraph so the kinds are:

```ts
const FINDING_KINDS = [
  "control-threw",
  "control-no-row",
  "dead",
  "unmeasured",
  "unchanged",
  "threw",
  "no-row",
  "dropped",
  "stored",
] as const;
```

and the docstring's first paragraph reads:

```ts
/** What a finding can SAY. `dead` — the harness cannot derive a
 *  distinguishable probe (nothing to derive from, it equals the reference, or
 *  mail safety). `unmeasured` — a probe was derived but the writer's sanitizer
 *  will not hold it unchanged, so neither relation may judge the field. Both
 *  are shared by every arm. Relation B's update arm adds `unchanged`; its
 *  create arm adds `threw`, `no-row` and `dropped` for a probed field and
 *  `control-threw` / `control-no-row` for the base create — the only two whose
 *  subject is the bare entity. Relation A adds `stored`: the model's
 *  undeclared value landed, which is a defect to FIX (plan Task 6), never to
 *  ledger.
```

Replace the `EXPECTED_FINDINGS` declaration's type annotation and add Relation A's ledger and the lookup directly after `EXPECTED_FINDINGS`'s closing `};`:

```ts
type LedgerKey = `${InlineEntity}:${Arm}`;
type Ledger = Readonly<Partial<Record<LedgerKey, readonly LedgerEntry[]>>>;
```
(declare these two immediately above `EXPECTED_FINDINGS`, and annotate it `const EXPECTED_FINDINGS: Ledger = {`)

```ts
/** Relation A's ledger — the same both-directions contract as
 *  `EXPECTED_FINDINGS`, for the undeclared axis. It holds `dead` and
 *  `unmeasured` entries only: a `stored` finding is a live undeclared write,
 *  and is fixed rather than ledgered. Filled by plan Task 5 from a measured run. */
const EXPECTED_UNDECLARED_FINDINGS: Ledger = {};

const LEDGERS = { A: EXPECTED_UNDECLARED_FINDINGS, B: EXPECTED_FINDINGS } as const;
```

Change `expectedFindings` and `expectLedgerAgrees` to take the relation:

```ts
function expectedFindings(relation: "A" | "B", entity: InlineEntity, arm: Arm): readonly LedgerEntry[] {
  return LEDGERS[relation][`${entity}:${arm}`] ?? [];
}
```
and in `expectLedgerAgrees(relation: "A" | "B", entity: InlineEntity, arm: Arm, findings: readonly Finding[])` use `expectedFindings(relation, entity, arm)`, name the ledger in the message (`relation === "A" ? "EXPECTED_UNDECLARED_FINDINGS" : "EXPECTED_FINDINGS"` in place of the literal `EXPECTED_FINDINGS`), and prefix the message with `Relation ${relation} — `.

Update the ledger-validity test at the top ("every expected-findings ledger entry names a real entity, arm, subject and kind") to walk BOTH ledgers:

```ts
  it("every expected-findings ledger entry names a real entity, arm, subject and kind", () => {
    const stray = (["A", "B"] as const).flatMap((relation) =>
      Object.entries(LEDGERS[relation]).flatMap(([key, entries]) => {
        const [entity, arm, ...rest] = key.split(":");
        if (rest.length > 0 || !ENTITIES.some((e) => e === entity) || !(arm === "create" || arm === "update")) {
          return [`${relation} ${key} (no such entity:arm)`];
        }
        return (entries ?? [])
          .filter(
            (f) =>
              !(f.subject === entity || f.subject.startsWith(`${entity}.`)) ||
              !FINDING_KINDS.some((k) => k === f.kind),
          )
          .map((f) => `${relation} ${key} → ${f.subject}:${f.kind}`);
      }),
    );
    expect(stray, `ledger entries naming no real entity:arm, subject or kind: ${stray.join(", ")}`).toEqual([]);
  });
```

- [ ] **Step 3: Rewrite Relation B's update arm loop.** Replace from `    const findings: Finding[] = [];` (first line of the update test body) through the `continue;` that ends the `dead` branch, i.e. up to and including the line `      probed += 1;` that precedes `const { before, stored, plan, threw } = await updateWith(entity, field, probe);`, with:

```ts
    const findings: Finding[] = [];
    let landed = 0;
    let probed = 0;
    let skipped = 0;
    const reference = loadedSeedRow(entity);

    for (const field of declaredProperties(entity, "update")) {
      const subject = `${entity}.${field}`;
      const outcome = probeFor({
        entity,
        arm: "update",
        field,
        declared: true,
        reference,
        seedRow: reference,
        compare: viaPreview(previewNormalizerFor(INLINE_DESCRIPTORS[entity], field)),
      });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
      probed += 1;
```

Then in the rest of that loop replace `` `${entity}.${field}` `` in the `unchanged` finding with `subject`. After the loop replace `expect(probed + dead, …)` with `expect(probed + skipped, \`${entity}: Relation B did not reach every declared field\`)` and `expectLedgerAgrees(entity, "update", findings);` with `expectLedgerAgrees("B", entity, "update", findings);`. Update the EXACT-bound comment: "`probed + skipped` must account for every declared field … the second a probe shape to fix or a column to decide".

- [ ] **Step 4: Rewrite Relation B's create arm loop.** In the create test body:
  - Replace `let dead = 0;` with `let skipped = 0;`, and `const s = seedFor(entity);` plus `const seedRow = (snapshotSeedRow(s) ?? {}) as Row;` with `const seedRow = loadedSeedRow(entity);`.
  - After `const controlRow = control.row;` add:

```ts
    // The reference the probe is derived and judged against. With no control
    // row (already reported above) the base payload is the nearest honest
    // stand-in, so derivation and admission still mean something.
    const reference: Row = controlRow ?? CREATE_BASE[entity];
```

  - Replace the loop head from `      const normalize = previewNormalizerFor(INLINE_DESCRIPTORS[entity], field);` through `      probed += 1;` (this removes `seeded`, `asBase`, the `probeAgainstControl` fallback and the `dead` branch together with their comments) with:

```ts
      const normalize = previewNormalizerFor(INLINE_DESCRIPTORS[entity], field);
      const subject = `${entity}.${field}`;
      const outcome = probeFor({
        entity,
        arm: "create",
        field,
        declared: true,
        reference,
        seedRow,
        compare: viaPreview(normalize),
      });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
      probed += 1;
```

  - After the loop: `expect(probed + skipped, …)` and `expectLedgerAgrees("B", entity, "create", findings);`.
  - Rewrite the big comment block above `const control = await createWith(entity, {});` so it no longer names `validProbeFor`, `probeAgainstControl` or the `startTime` example as live. Keep its first paragraph (why a control create exists) and its "A THROWING CONTROL IS REPORTED" paragraph; replace the rest with:

```ts
    //  ★★ `probeFor` derives against THIS row and judges against it, so a probe
    //   can no longer be derived against the seed and land on a value the base
    //   payload already produces — which is how `calendarEvent.startTime` and
    //   `absence.startDate` sat in the ledger until the typed-probe slice.
```
  - In the long comment above the create test (`// ★★★ THE CREATE ARM HAS NO REJECTION BRANCH …`), replace every mention of `validProbeFor` with `probeFor`, and replace the paragraph beginning `  //  ★★★ SO THE PROBE IS DERIVED FROM THE SEEDED ROW OF THIS ENTITY, NOT FROM` through the end of the `WHERE THE SEED CARRIES NO VALUE` paragraph with:

```ts
  //  ★★★ SO EVERY PROBE IS ADMITTED BEFORE IT IS JUDGED. `probeFor` puts the
  //   probe through this entity's create-writer sanitizer first
  //   (`ADMISSION_ORACLE`, `src/test/sweep-probes.ts`); a probe the sanitizer
  //   would not hold unchanged is `unmeasured` and never reaches this arm's
  //   verdict. So a `dropped` here is a value the column CAN hold and the create
  //   did not keep — never a probe the sanitizer was always going to refuse.
  //   Nothing is invented: a field with no value to derive from is `dead`.
```

- [ ] **Step 5: Restate the mail guard over `probeFor`.** Replace the whole block from the comment line `// ★★★ THE ONE PROBE IN THIS FILE WITH A REAL-WORLD SIDE EFFECT.` through the end of the test `it("no Relation B probe drives calendarEvent.sendInvitations true", …);` with:

```ts
// ★★★ THE ONE PROBE IN THIS FILE WITH A REAL-WORLD SIDE EFFECT.
//  `calendarEvent.sendInvitations` is DECLARED, so Relation B would drive it,
//  and a strict `true` trips `shouldStage` in `chat-proposal.ts`, which in
//  production mails the attendees. Whether a unit-test replay can send that
//  mail has NEVER BEEN ESTABLISHED, and is not worth finding out by accident.
//
//  ★★★ STATED OVER THE ONE DERIVATION, AT EVERY REFERENCE A ROW CAN HOLD.
//   Both relations and both arms call `probeFor` and nothing else, so this
//   covers every path a probe can take to the dispatcher — the hand-kept list
//   of derivations §443 warned about no longer exists to fall out of date. The
//   three references are the three states the flag can be stored in:
//   present-only-when-true means `undefined` is the create control's value.
//
//  ★★ SITED OUTSIDE THE RELATION LOOPS, so it runs even when no loop reaches
//   the field.
it("no probe drives calendarEvent.sendInvitations true", () => {
  expect(
    declaredProperties("calendarEvent", "update"),
    "`sendInvitations` left the declared surface — either it is genuinely unwritable now, or the schema narrowed and this guard has gone vacuous",
  ).toContain("sendInvitations");
  const seedRow = loadedSeedRow("calendarEvent");
  for (const arm of ["create", "update"] as const) {
    for (const sendInvitations of [undefined, false, true]) {
      const outcome = probeFor({
        entity: "calendarEvent",
        arm,
        field: "sendInvitations",
        declared: true,
        reference: { ...seedRow, sendInvitations },
        seedRow,
        compare: viaPreview(previewNormalizerFor(INLINE_DESCRIPTORS.calendarEvent, "sendInvitations")),
      });
      expect(
        outcome.kind,
        `a ${arm} probe at sendInvitations=${String(sendInvitations)} would reach the dispatcher — the one write in this file that leaves the building`,
      ).toBe("dead");
    }
  }
});
```

- [ ] **Step 6: Run the sweep and read every Relation B finding.**

```bash
npx vitest run src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp4-run1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp4-run1.log"; grep -nE "^\s+\[(dead|unmeasured|unchanged|threw|no-row|dropped|control-threw|control-no-row|stored)\]" "$SP/tp4-run1.log"
```

Classify every Relation B finding line. For each red entity:arm, the ledger must change to match — and each change needs a reason written beside the entry:

| Finding | Action |
|---|---|
| `task.assigneeEmail:threw` (create) GONE | delete its ledger entry (§459) |
| `absence.startDate:dropped` (create) GONE | delete its ledger entry (§459) |
| `calendarEvent.startTime:dead` (create) GONE | delete its ledger entry (§443) |
| `calendarEvent.sendInvitations:dead` | keep; update the comment to "mail-safety policy (§443); `probeFor` reports it dead" |
| `resource.name` (both arms) | keep unchanged |
| a NEW `unmeasured` or `dead` | add an entry citing `§462` with the reason from the finding's detail, e.g. `// §462 — create-writer sanitizer reshapes "x probed" (closed vocabulary)` |
| a NEW `unchanged`, `threw`, `no-row` or `dropped` | STOP. Do not ledger it. Report the full finding line — it is either a product defect or a probe-shape defect, and the controller decides |

If `task.assigneeEmail`, `absence.startDate` or `calendarEvent.startTime` did NOT stop firing, STOP and report: the derivation does not do what the spec says.

- [ ] **Step 7: Re-run, green.** Same command, log `$SP/tp4-run2.log`. Expected: `EXIT=0`, `Test Files  1 passed (1)`. Relation A is untouched in this task and must still pass unchanged.

- [ ] **Step 8: Typecheck, lint, commit.**

```bash
npx tsc --noEmit > "$SP/tp4-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "^src/" "$SP/tp4-tsc.log"
npx eslint --max-warnings=0 src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts; echo "EXIT=$?"
```
Expected `0` and `EXIT=0` (an unused `snapshotSeedRow` is still used by Relation A until Task 5; if eslint flags anything else unused, remove it).

Message to `$SP/tp4-msg.txt` — fill the bracketed counts from `tp4-run2.log` and the ledger diff before committing; do not commit with brackets left in:
```
test(ai): derive Relation B's probes through probeFor

Both Relation B arms now take their probe from the typed derivation, which
derives against the row each arm judges against and admits a probe only if
the writer's sanitizer holds it. validProbeFor and probeAgainstControl are
gone, and the mail guard is stated over the one remaining derivation.

task.assigneeEmail and absence.startDate (459) and calendarEvent.startTime
(443) now land, and their ledger entries are deleted. [N] new unmeasured
or dead entries cite 462: [subjects].
```
```bash
git add src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts
git commit --only src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts -F "$SP/tp4-msg.txt"; echo "EXIT=$?"
```

---

### Task 5: Relation A on `probeFor`, with its own ledger, and `exceptions` seeded

**Files:**
- Modify: `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`
- Modify: `src/test/inline-sweep-fixtures.ts` (`seedGuardedCalendarEvent`)

**Interfaces:**
- Consumes: Task 3's exports; Task 4's `loadedSeedRow`, `FINDING_KINDS`, `EXPECTED_UNDECLARED_FINDINGS`, `expectLedgerAgrees`.
- Produces: the list of `stored` findings (possibly empty), which Task 6 consumes.

- [ ] **Step 1: Seed `exceptions`.** In `seedGuardedCalendarEvent`, after `recurrence: { freq: "weekly", interval: 2, byDay: ["WE"] },` add:

```ts
    // ★★ TWO exceptions, so the array probe (drop one element) leaves a
    //  non-empty, still-valid list. Both dates fall on the seeded recurrence's
    //  Wednesday. Without a seed, Relation A could only send `exceptions` a value
    //  `sanitizeExceptions` drops for not being an array, whatever the guard
    //  does (§441). `CREATE_BASE` must NOT carry it: its declared-only floor
    //  forbids an undeclared key, and the create arm falls back to this seed.
    exceptions: [
      { date: "2026-07-22", kind: "skip" },
      { date: "2026-07-29", kind: "move", toDate: "2026-07-30" },
    ],
```

- [ ] **Step 2: Run every consumer of the fixtures module, before touching Relation A.**

```bash
npx vitest run src/app/inline-ai-edit/plan.create-path-guards.test.ts src/app/inline-ai-edit/plan.model-writable-surface.test.ts src/app/inline-ai-edit/plan.write-path-sweep.test.ts src/app/inline-ai-edit/plan.write-path.test.ts src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp5-fixture.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp5-fixture.log"
```
Expected: `Test Files  5 passed (5)`. A red here is caused by the seed alone: read the failure. If a test pinned the calendar event's exact shape, update that test's expectation in this task and say why; if a sweep gained a finding, STOP and report it.

- [ ] **Step 3: Rewrite Relation A's create arm.** Replace the body of `it("create: the created row carries none of the model's undeclared values", …)` with:

```ts
    const findings: Finding[] = [];
    let probed = 0;
    let skipped = 0;
    const control = await createWith(entity, {});
    const reference: Row = control.row ?? CREATE_BASE[entity];
    const seedRow = loadedSeedRow(entity);

    for (const field of undeclaredColumns(entity)) {
      const subject = `${entity}.${field}`;
      // ★★★ A PROBE THE COLUMN CAN HOLD, NOT A TRESPASS STRING. The relation
      //  asks whether the GUARD stops the model's value; a value the sanitizer
      //  refuses on its own proves nothing either way (§441). `probeFor` admits
      //  the probe through the create writer's sanitizer first, and a field it
      //  cannot admit is `unmeasured` — named in the ledger, never judged green.
      const outcome = probeFor({ entity, arm: "create", field, declared: false, reference, seedRow, compare: sameAt });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
      probed += 1;
      const { row, threw } = await createWith(entity, { [field]: probe });
      // A loud refusal is agreement: the field did not land, and the writer said so.
      if (threw !== undefined) continue;
      if (!row) {
        findings.push(finding(subject, "no-row", "the create stored no row at all — the base payload is not valid"));
        continue;
      }
      if (same(row[field], probe)) {
        findings.push(finding(subject, "stored", `create stored the model's undeclared value ${JSON.stringify(probe)}`));
      }
    }

    expect(probed + skipped, `${entity}: Relation A ran over an empty undeclared axis`).toBe(
      AXIS_BASELINE[entity].undeclared,
    );
    expectLedgerAgrees("A", entity, "create", findings);
```

and add near `viaPreview`:

```ts
/** Relation A's comparison: the model's LITERAL value, never its presence —
 *  which is what keeps the relation free of an exemption list for the fields
 *  every writer stamps (`localModifiedAt`, `outlookEventId`). */
const sameAt: Compare = (a, b) => same(a, b);
```

- [ ] **Step 4: Rewrite Relation A's update arm.** Replace its body from `    const s = seedFor(entity);` through the `for` loop's closing brace with:

```ts
    const s = seedFor(entity);
    const findings: Finding[] = [];
    let probed = 0;
    let skipped = 0;
    const reference = loadedSeedRow(entity);

    for (const field of undeclaredColumns(entity)) {
      const subject = `${entity}.${field}`;
      const outcome = probeFor({ entity, arm: "update", field, declared: false, reference, seedRow: reference, compare: sameAt });
      if (outcome.kind !== "probe") {
        skipped += 1;
        findings.push(finding(subject, outcome.kind, outcome.reason));
        continue;
      }
      const probe = outcome.value;
      probed += 1;
      const { before, stored, threw } = await updateWith(entity, field, probe);
      if (threw !== undefined) continue;
      // ★★ The comparison is against the PROBE, not against "did the field
      //  change". `localModifiedAt` changes on every single replay — all eight
      //  writers stamp it unconditionally — so a movement test would fire on
      //  every entity and bury every real finding.
      if (same(stored[field], probe)) {
        findings.push(
          finding(subject, "stored", `update stored the model's undeclared value (was ${JSON.stringify(before[field])})`),
        );
      }
    }
```

and after the loop replace `expect(probed, …)` with `expect(probed + skipped, …)` and `expect(findings, …).toEqual([]);` with `expectLedgerAgrees("A", entity, "update", findings);`. Keep the non-vacuity check on `s.seed`.

- [ ] **Step 5: Delete `trespassProbeFor`, `TRESPASS_STRING` and their docstring**, and `snapshotSeedRow` if nothing still calls it (`grep -n "snapshotSeedRow\|trespassProbeFor" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` → no hits). The docstring's §441 instance list moves to the register in Task 8 — copy it into `$SP/tp5-441-instances.txt` before deleting, for Task 8.

- [ ] **Step 6: Run the sweep and read every Relation A finding.**

```bash
npx vitest run src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp5-run1.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp5-run1.log"; grep -nE "Relation A — |^\s+\[(dead|unmeasured|stored|no-row)\]" "$SP/tp5-run1.log"
```

For each Relation A entity:arm:

| Finding | Action |
|---|---|
| `dead` or `unmeasured` | add an entry to `EXPECTED_UNDECLARED_FINDINGS` citing `§462` with the reason, e.g. `// §462 — writer-stamped; the update writer overwrites it on every call` |
| `stored` | do NOT ledger. Record the subject, arm and detail in `$SP/tp5-stored.txt` for Task 6 |
| `no-row` | STOP and report: the create base is not valid for that entity |

- [ ] **Step 7: Re-run.** Same command, log `$SP/tp5-run2.log`. Expected: the only failures left are Relation A cases whose findings are `stored` (listed in `tp5-stored.txt`). If `tp5-stored.txt` is empty, expect `EXIT=0`, `Test Files  1 passed (1)`.

- [ ] **Step 8: Typecheck, lint, commit.** Same tsc/eslint commands as Task 4 (logs `tp5-tsc.log`), plus `src/test/inline-sweep-fixtures.ts` in the eslint list. If `tp5-stored.txt` is non-empty the sweep is red at this commit on purpose; say so in the message. Message to `$SP/tp5-msg.txt` (fill the brackets):
```
test(ai): give Relation A typed probes and a both-directions ledger

Relation A now probes each undeclared field with a value the column can
hold, admitted through the writer's sanitizer, instead of a trespass value
the sanitizer refused whether or not the guard ran. A field it cannot
admit is reported unmeasured in a new EXPECTED_UNDECLARED_FINDINGS ledger,
checked in both directions like Relation B's. calendarEvent's sweep seed
now carries two exceptions, so that field can be probed at all.

[N] entries cite 462. [Either "No undeclared value landed." or "It finds
[K] live undeclared writes, fixed in the next commit: [subjects]; the
sweep is red at this commit until then."]
```
```bash
git add src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/test/inline-sweep-fixtures.ts
git commit --only src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts src/test/inline-sweep-fixtures.ts -F "$SP/tp5-msg.txt"; echo "EXIT=$?"
```

---

### Task 6: Fix each live undeclared write Relation A found (skip if none)

Runs once per entry in `$SP/tp5-stored.txt`. If the file is empty, record "Relation A found no live undeclared write" for Task 8 and skip to Task 7.

**Files (per finding):**
- Modify: the writer — `src/app/use-register-tools.ts` (raid, change, milestone, stakeholder, absence, calendarEvent) or `src/app/use-chat-dispatcher.ts` (task, resource).
- Modify: `src/app/inline-ai-edit/plan.create-path-guards.test.ts` (create finding) — one new `CASES` entry; or rely on `plan.write-path-sweep.test.ts` (update finding) after confirming it drives the field.

**Interfaces:** consumes the existing `dropUnaccepted<Entity>Fields` helper for that entity; produces nothing new.

**★★★ STOP RULE.** Stop and report back, without editing, if any of these holds:
- the fix is anything other than adding the entity's existing `dropUnaccepted<Entity>Fields(...)` call (or a key strip already used by the sibling arm) at the merge site;
- the entity has no such helper;
- the fix needs any line in `src/app/sanitize-records.ts`;
- the stored field is one the writer is SUPPOSED to accept from the model (then the schema is wrong, not the writer — a product decision).

- [ ] **Step 1: Locate the merge site.** For a create finding on entity `E`: `grep -n "create<E>\|const item = sanitize" <writer file>`; for an update finding: the `const merged = sanitize…({` call in `update<E>`. Read the sibling arm: it shows the guard call the finding's arm lacks.

- [ ] **Step 2: Write the failing pin first.**
  - Create finding: add to `CASES` in `plan.create-path-guards.test.ts`, following the existing entries' exact shape (read two of them first), a case whose `field` is the stored field, whose probe is the value from `tp5-stored.txt`, and whose `because` names this slice (e.g. `"undeclared — found by the typed-probe sweep"`).
  - Update finding: confirm `plan.write-path-sweep.test.ts` drives the field (`grep -n "<field>" src/app/inline-ai-edit/plan.write-path-sweep.test.ts`); if it does not, STOP (stop rule: this is not a missing guard call alone).
  Run the pin's file; it must fail on the stored field. Log `$SP/tp6-<entity>-red.log`.

- [ ] **Step 3: Add the guard call** at the merge site, spelled exactly as the sibling arm spells it, e.g. `sanitizeStakeholder({ ...dropUnacceptedStakeholderFields(input), id, raci: {} })`.

- [ ] **Step 4: Run the pin's file and the sweep**, `--maxWorkers=1`, one command, log `$SP/tp6-<entity>-green.log`. Expected: both files pass, and the sweep's `stored` finding for this subject is gone.

- [ ] **Step 5: Mutation-check** by removing the call you added (Edit, assert unique), re-running the pin's file (log `tp6-<entity>-mutant.log`, expect exactly that pin red), and reverting with the inverse Edit; prove the revert with `git diff -- <writer file>` showing only Step 3's line.

- [ ] **Step 6: tsc, eslint, commit.** Same commands as earlier tasks. Message (fill the brackets):
```
fix(ai): guard [tool] against the model's undeclared [field]

[tool] spread the model's input into its sanitizer without
dropUnaccepted[Entity]Fields, which its [sibling arm] already applies, so
an undeclared [field] the model sent was stored. Found by the offered-
surface sweep's typed Relation A probes; a new pin fails without the
guard.
```

---

### Task 7: Measure the acceptance mutants and the admission check's own mutants

No product change is committed by this task. Every mutant is applied with Edit (old string asserted unique), measured with ONE sweep run, and reverted with the inverse Edit (old string asserted unique); after each revert `git diff --stat` must print nothing for that file.

**Files:** temporarily modified and reverted: `src/app/use-chat-dispatcher.ts`, `src/app/use-register-tools.ts`, `src/test/sweep-probes.ts`.

Record every result in `$SP/tp7-results.md` as `mutant | command | Test Files / Tests line | failing cases | verdict`.

- [ ] **Step 1: Acceptance mutant 2.** In `updateResource` (`src/app/use-chat-dispatcher.ts`), replace `...dropUnacceptedResourceFields(patch),` with `...patch,` — `grep -n "dropUnacceptedResourceFields(patch)" src/app/use-chat-dispatcher.ts` must print exactly one line first. Run:

```bash
npx vitest run src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp7-m2.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp7-m2.log"; grep -nE "\[stored\]" "$SP/tp7-m2.log"
```
Expected (not promised): `resource` Relation A update red with `stored` findings (e.g. `resource.utilization`). Revert; `git diff --stat -- src/app/use-chat-dispatcher.ts` → empty.

- [ ] **Step 2: Acceptance mutant 3.** In `createCalendarEvent` (`src/app/use-register-tools.ts`), replace `...dropUnacceptedCalendarEventFields(input)` with `...input` (assert one hit in the create handler; the update handler spells it differently — read both). Same run, log `tp7-m3.log`. Expected: `calendarEvent` Relation A create red on `calendarEvent.exceptions:stored`. Revert; prove empty diff.

- [ ] **Step 3: Admission admits everything.** In `admitProbe` (`src/test/sweep-probes.ts`), insert `  return undefined;` as the first line of its body, anchored above the unique line `  const kept = ADMISSION_ORACLE[entity][arm]({ ...reference, [field]: probe });`. Run the sweep (log `tp7-admit-all.log`). Expected: red wherever the ledger holds an `unmeasured` entry — those findings disappear. If the ledgers hold no `unmeasured` entry at all, record "not killable: no unmeasured entry" — that is a finding against the design for Task 8. Revert: delete exactly that line; `git diff --stat -- src/test/sweep-probes.ts` → empty.

- [ ] **Step 4: Admission admits nothing.** Insert `  return "mutant: admits nothing";` as the first line of `admitProbe`'s body, anchored above the unique line `  const kept = ADMISSION_ORACLE[entity][arm]({ ...reference, [field]: probe });` (the file has several `return undefined;` lines, so never anchor on one). Run (log `tp7-admit-none.log`). Expected: red on every entity, with new `unmeasured` findings. Revert by deleting that inserted line; prove empty diff.

- [ ] **Step 5: Confirm a clean tree and a green sweep.**

```bash
git status --porcelain | grep -v "not-in-use.env.local.bak"; echo "---"; npx vitest run src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts --maxWorkers=1 --reporter=dot > "$SP/tp7-final.log" 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " "$SP/tp7-final.log"
```
Expected: no modified files; `EXIT=0`, `Test Files  1 passed (1)`.

A surviving mutant is recorded, never argued away. Hand `tp7-results.md` to Task 8.

---

### Task 8: Register, spec closing note, and the doc gates

**Files:**
- Modify: `docs/open-followups.md` (LF)
- Modify: `docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md` (closing note)

**Interfaces:** consumes `tp4-msg.txt`, `tp5-msg.txt`, `tp5-441-instances.txt`, `tp5-stored.txt`, `tp7-results.md`, and the final ledgers.

- [ ] **Step 1: Reserve §462 against `origin/main`.**

```bash
git fetch -q origin; git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```
Expected: `461`. If it is higher, another branch took 462: use max+1, and replace every `§462` citation in the sweep's two ledgers with that number in this task's commit.

- [ ] **Step 2: Close §459 and §460; narrow §443 and §441; file §462.** For each, edit the heading, the `**Status:**` line and the index row. A closed heading ends `— CLOSED 2026-09-11`; its index row's State cell is `**CLOSED** 2026-09-11`; its anchor is DERIVED from the new heading with the same slug rule as the existing rows (lowercase, drop punctuation other than hyphens, spaces to hyphens — an em dash between spaces becomes TWO hyphens), never hand-written. Every Status line carries an ISO date and a command.
  - **§459 CLOSED:** Status: `CLOSED 2026-09-11 — both probes now land: the typed derivation (`src/test/sweep-probes.ts`) derives against the create control row, and neither subject is in the sweep's ledger. Reproduce: `grep -c 'subject: "task.assigneeEmail"\|subject: "absence.startDate"' src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` → 0.`
  - **§460 CLOSED:** Status: `CLOSED 2026-09-11 — `pushLinkDiffs` applies the link guard on both paths; the pin "a create card previews only the attendees the create stores (§460)" in `plan.create-path-guards.test.ts` drives `[4, "4"]` through card and write. Reproduce: `grep -n 'const guard = d.rawTypeGuards' src/app/inline-ai-edit/plan.ts`.` Keep §440 OPEN and say so in §460's body.
  - **§443 narrowed** (stays OPEN): append a paragraph — `calendarEvent.startTime` is CLOSED 2026-09-11 (its probe now derives against the control row and lands); the mail-guard concern about a hand-kept derivation list is CLOSED (one derivation remains, `probeFor`, and the guard is stated over it); `sendInvitations` stays OPEN by policy. Update the Status line's date and reproduce command: `grep -n "no probe drives calendarEvent.sendInvitations true" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`.
  - **§441 narrowed** (stays OPEN): append a paragraph with the measured mutant 2 / mutant 3 verdicts from `tp7-results.md` (exact `Test Files`/`Tests` lines), the fields from `tp5-441-instances.txt` that are now probed versus now `unmeasured` (read the final ledger), and a sentence that the "destroys rather than stores" half is unchanged and still owned by `plan.write-path-sweep.test.ts`.
  - **§462 NEW, OPEN:** heading `## 462. Fields the offered-surface sweep's typed probes cannot measure — OPEN`. Body: one bullet per `dead` / `unmeasured` ledger entry, grouped by relation and arm, each with the reason from its finding; a paragraph that each is a probe-shape or product-decision question, not a green; any mutant from Task 7 Steps 3–4 that survived. Status: `OPEN 2026-09-11 — measured by the offered-surface sweep's ledgers. Reproduce: `grep -n "§462" src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts`.` Index row: `| [§462](#<derived anchor>) | Fields the offered-surface sweep's typed probes cannot measure — OPEN | found 2026-09-11 by the typed-probe slice's first measured run | S per field — a probe shape or a column decision each | open |`.

- [ ] **Step 3: Spec closing note.** Append to the spec a section `## Closing note (2026-09-11)` with: the final `Test Files`/`Tests` line of each gate run; the Task 7 mutant table; the count of `dead`/`unmeasured` entries per relation; what Task 6 fixed (or "none found"); anything the plan got wrong and how it was corrected.

- [ ] **Step 4: Run the doc and size gates, each unpiped.**

```bash
npm run followups:index:check > "$SP/tp8-idx.log" 2>&1; echo "EXIT=$?"
npm run followups:status:check > "$SP/tp8-status.log" 2>&1; echo "EXIT=$?"
npm run docs:claims:check > "$SP/tp8-claims.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$SP/tp8-symbols.log" 2>&1; echo "EXIT=$?"
npm run size:check > "$SP/tp8-size.log" 2>&1; echo "EXIT=$?"
node -e "console.log(require('fs').readFileSync('src/app/sanitize-records.ts','utf8').split('\n').length)"
```
Expected: five `EXIT=0`; the last line prints `1601` (the gate's `wc -l`+1 count for a 1600-line file) — compare it against the same command on `origin/main` (`git show origin/main:src/app/sanitize-records.ts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(s.split('\n').length))"`); the two must be equal.

- [ ] **Step 5: Re-run every reproduce command** written in Step 2 against the final tree and confirm each prints what its Status line says.

- [ ] **Step 6: Commit.** Message to `$SP/tp8-msg.txt`:
```
docs(followups): close 459 and 460, narrow 441 and 443, file 462

459 and 460 are fixed on this branch. 443's startTime half and its
derivation-list concern are closed; sendInvitations stays open by policy.
441's probe-shape half is narrowed to the fields 462 names, with the
acceptance mutants measured. 462 records every field the typed probes
cannot measure, which the sweep's ledgers cite.

followups:index:check, followups:status:check, docs:claims:check,
docs:symbols:check and size:check exit 0.
```
```bash
git add docs/open-followups.md docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md
git commit --only docs/open-followups.md docs/superpowers/specs/2026-09-11-sweep-typed-probes-design.md -F "$SP/tp8-msg.txt"; echo "EXIT=$?"
```
(If Step 1 renumbered §462, add `src/app/inline-ai-edit/plan.offered-surface-sweep.test.ts` to both path lists.)

---

## After the tasks

- Final cold review of the whole branch (`git diff origin/main...HEAD`) by a fresh reviewer, per subagent-driven development.
- `npm run test:shuffle` is owed; ask the user before running it.
- No push, MR or merge without the user's explicit say.
