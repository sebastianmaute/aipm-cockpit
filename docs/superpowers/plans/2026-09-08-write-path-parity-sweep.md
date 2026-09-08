# Preview ⟺ write-path parity sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mechanical sweep to `plan.write-path.test.ts` that drives every field of every one of the eight `INLINE_DESCRIPTORS` entities through the **real dispatcher** and reads the stored row back, closing the class of preview/write divergence that neither existing detector can see; then fix every divergence it finds.

**Architecture:** The sweep enumerates, per entity, the union of `INLINE_DESCRIPTORS[e].diffFields`, `Object.keys(storedRow)` and one junk key no schema declares. For each field it previews with `describeEntityCalls` and then replays the same tool input through `runTool` on a live `useChatDispatcher`, comparing three relations. It reuses the existing file's jsdom environment (a third test file would buy another ~25-30s of environment) and the existing `previewAndWrite` / `rejectedFields` helpers rather than re-deriving them.

**Tech Stack:** TypeScript, vitest 4.1.8 (jsdom), `@testing-library/react` `renderHook`/`act`, the `chat-dispatcher-fixture` test providers.

**Spec:** `docs/superpowers/specs/2026-09-07-preview-write-path-parity-sweep-design.md` (re-grounded 2026-09-08, commit `0798b9e3`). **Read its "Re-grounding, 2026-09-08" section first** — every count above that section which it corrects is stale.

**Branch:** `feat/write-path-parity-sweep`, based at `origin/main` = `960b639e` (0.293.0 "Vandermeer"). **No release, no version bump in this plan.**

---

## Standing constraints — read before the first edit

These are not suggestions. Each one has cost real work in this repo.

1. **`src/app/i18n.ts` and `src/app/i18n.de.ts` are OFF LIMITS.** A peer session owns both for the duration of this slice. If a fix in Task 7+ needs a new key, the step is to send the peer the key name plus its EN and DE values via `SendMessage` to `aipm-wt-a-ea` and wait — **never** edit either file.
2. **Follow-up numbers available to this slice are 435-449 only.** 450+ belong to the peer. A number is reserved only once it is on `origin/main`.
3. **Every file under `src/app/` is CRLF in the working tree** (`git ls-files --eol` reports `i/lf w/crlf`). Use the **Edit tool** for them. **Never `sed -i`** — under Git Bash it silently re-lines the whole file to LF, and `core.autocrlf=true` hides that from `git diff`. `docs/**` is LF-only.
4. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status and discards the diagnostic. Always:
   ```bash
   <command> > "$SP/<name>.log" 2>&1; echo "EXIT=$?" >> "$SP/<name>.log"
   grep -E "Test Files|Tests |EXIT=" "$SP/<name>.log"
   ```
   where `SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"`.
5. **Never run two vitest processes at once.** `Failed to start forks worker` is machine contention, not evidence of a broken suite.
6. **Never `git add -A` or `git add .`.** `sample-workspace-huge.json` (modified, foreign) and `not-in-use.env.local.bak` (untracked, holds live credentials) must never be staged, opened, or printed. Stage explicit paths only, and commit with `git commit --only <paths>`.
7. **Never `git commit --amend`** (shared worktree) and **never `git stash`**. `git checkout -- <file>` is deny-blocked; revert an edit with an anchored inverse write.
8. **Every commit message ends with** `Claude-Session: https://[session link removed]`. Write commit messages to a scratchpad file and use `git commit -F`, because backticks in a Bash heredoc can break the outer shell.
9. **`npx tsc --noEmit` exits 2 on diagnostics, not 1.** Neither `next build` nor vitest typechecks test files, so run it after every test edit.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/inline-ai-edit/plan.write-path.test.ts` | **Modify** (782 lines now) | Gains the sweep beside its 17 hand-written `CASES`. The two layers stay separate: `CASES` name specific defects, the sweep names none. |
| `src/app/sanitize-records.ts` | **Modify** (Task 12 only) | §405 tail — three named RAID enum predicates replacing two copies of one rule. |
| `src/app/use-register-tools.ts` | **Mutated and reverted only** (Tasks 10-11) | Never permanently modified by this plan. |
| `docs/open-followups.md` | **Modify** (Task 13) | Close §394 and §418; restate §405's residue. |
| Whatever files Task 6's findings implicate | **Modify** (Tasks 7-9) | Unknown until the sweep runs — that is why Task 6 is a hard stop. |

**Size budget.** `size:check` counts `readFileSync().split("\n").length`, which is `wc -l` **plus one**, against a LIMIT of 1600. Read the real number with:
```bash
node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)"
```
782 today. The sweep adds roughly 300. Budget from that command, never from `wc -l`.

---

### Task 1: Baseline — record what "green" and "how many tests" mean today

Every mutant in Tasks 10-11 is recorded as `N failed / M passed`, and **the sum must equal this file's runtime test count**. That number is meaningless unless it is captured before anything changes.

**Files:**
- Modify: none (measurement only)

- [ ] **Step 1: Confirm the branch and a clean tree**

```bash
cd /c/Projects/aipm-cockpit
git rev-parse --abbrev-ref HEAD    # expect: feat/write-path-parity-sweep
git log --oneline -1               # expect: 0798b9e3 docs(parity-sweep): re-ground the spec against 0.293.0
git status --short
```
Expected: exactly two lines — ` M sample-workspace-huge.json` and `?? not-in-use.env.local.bak`. **If anything else is dirty, stop and report it** — a foreign edit in the tree makes every measurement below unattributable.

- [ ] **Step 2: Record the baseline test count**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/baseline.log" 2>&1; echo "EXIT=$?" >> "$SP/baseline.log"
grep -E "Test Files|Tests |EXIT=|Duration" "$SP/baseline.log"
```
Expected: `Test Files 1 passed (1)`, `Tests 31 passed (31)`, `EXIT=0`, roughly 38s.

**If the test count is not 31, use the number you actually measured everywhere below.** Do not carry 31 forward on the strength of this sentence — it is the spec's 2026-09-07 figure and the file has changed since.

- [ ] **Step 3: Record the baseline line count**

```bash
node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)"
```
Expected: `782`.

- [ ] **Step 4: Write both numbers into the scratchpad so later tasks can cite them**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
printf 'baseline tests=%s\nbaseline lines=%s\n' "$(grep -oE 'Tests +[0-9]+' "$SP/baseline.log" | grep -oE '[0-9]+' | head -1)" "$(node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)")" > "$SP/parity-baseline.txt"
cat "$SP/parity-baseline.txt"
```

No commit — this task produces no diff.

---

### Task 2: The sweep entity table, asserted complete against the descriptor map

The one thing this slice maintains by hand. A new **field** is covered the moment it exists; a new **entity** is not, so the table reds when a descriptor is added.

**Files:**
- Modify: `src/app/inline-ai-edit/plan.write-path.test.ts`

- [ ] **Step 1: Write the failing test**

Append at the end of the file (after the last existing `describe` block). `WsKey` must first be widened — the existing union has no `"tasks"` member:

Find this line (it is unique in the file):
```ts
type WsKey = "raid" | "resources" | "changes" | "milestones" | "stakeholders" | "absences" | "calendarEvents";
```
Replace it with:
```ts
type WsKey = "tasks" | "raid" | "resources" | "changes" | "milestones" | "stakeholders" | "absences" | "calendarEvents";
```

Then append:

```ts
// --- the mechanical sweep ---------------------------------------------------
//
// ★★★ THE SECOND LAYER, DELIBERATELY NOT MERGED WITH `CASES` ABOVE. Each of
// those names a specific defect, and that name is what a red run tells you.
// This sweep names nothing and enumerates everything. Merging them would trade
// a legible failure for a uniform one.
//
// It exists for the gap between the two detectors that already exist:
// `plan.sanitizer-parity.test.ts` is exhaustive and shallow (it compares the
// preview against each field's SANITIZER, so it cannot see a merge-site guard
// it does not compose), and the `CASES` above are narrow and deep. The gap is a
// divergence at a layer the sanitizer cannot show, in a field nobody wrote a
// case for — which is `docs/open-followups.md` §394 and §418.

/** One entity's sweep fixture: the two things no production code declares —
 *  WHICH row to drive, and the workspace to drive it against.
 *
 *  ★★★ `tool`, `wsKey` AND `kind` ARE DELIBERATELY ABSENT, and restoring any of
 *  them is a regression. Each is already declared by production code this file
 *  can read — `INLINE_DESCRIPTORS[entity].updateTool` / `.wsKey`, and
 *  `TOKEN_ROW_SOURCE[tool].kind`, which is the SAME map the replaying consumers
 *  read. The first cut of this table hand-copied all three per row: 24 restated
 *  cells, one of which was already wrong before anything consumed it (the
 *  resource row carried `id: 7` against a seed that mints 4, so that entity's
 *  entire sweep would have reported agreement over a row that was never
 *  written — a fabricated clean across one of eight entities). `sweepPlumbing`
 *  derives them instead, so a renamed tool or a moved workspace slice reaches
 *  the sweep as a type error or a loud throw rather than as silent agreement. */
interface SweepEntity {
  entity: InlineEntity;
  /** The id this entity's own seed mints — the one value no production code
   *  knows, and therefore the only one still worth asserting by hand. */
  id: number;
  seed: TestSeed;
}

const SWEEP: SweepEntity[] = [
  { entity: "task", id: 1, seed: { tasks: [seedTask(1, "First")] } },
  { entity: "raid", id: 10, seed: { raid: [seedGuardedRaid()], tasks: LINKED_TASKS } },
  { entity: "change", id: 20, seed: { changes: [seedGuardedChange()], tasks: LINKED_TASKS } },
  { entity: "milestone", id: 30, seed: { milestones: [seedGuardedMilestone()], tasks: LINKED_TASKS } },
  { entity: "stakeholder", id: 40, seed: { stakeholders: [seedGuardedStakeholder()], tasks: LINKED_TASKS } },
  { entity: "resource", id: 4, seed: { resources: [seedResource()] } },
  { entity: "absence", id: 50, seed: { absences: [seedGuardedAbsence()] } },
  { entity: "calendarEvent", id: 60, seed: { calendarEvents: [seedGuardedCalendarEvent()] } },
];

/** What the REPLAY needs, read from the same production declarations the
 *  replaying consumers themselves read. THROWS rather than returning a partial
 *  answer: a tool with no `TOKEN_ROW_SOURCE` entry cannot be replayed at all,
 *  and a sweep that skipped such an entity would report the same thing as a
 *  sweep that found no divergence — silence. */
function sweepPlumbing(entity: InlineEntity): { tool: string; kind: TokenEntity; wsKey: WsKey } {
  const tool = INLINE_DESCRIPTORS[entity].updateTool;
  const source = TOKEN_ROW_SOURCE[tool];
  if (!source) {
    throw new Error(`sweep: no TOKEN_ROW_SOURCE entry for "${tool}" (entity "${entity}") — it cannot be replayed`);
  }
  return { tool, kind: source.kind, wsKey: INLINE_DESCRIPTORS[entity].wsKey as WsKey };
}

describe("the sweep's own coverage", () => {
  // ★★ THE ONE MAINTAINED THING IN THE SWEEP, AND ITS GUARD. A new FIELD is
  //  covered the moment it exists, because the axis is derived at runtime. A new
  //  ENTITY is not — nothing would enumerate it — so the table is asserted exact
  //  rather than merely non-empty. `plan.sanitizer-parity.test.ts` uses the same
  //  trick on its own CASES; copying it is deliberate.
  it("has a row for every INLINE_DESCRIPTORS entity, and no others", () => {
    expect(SWEEP.map((s) => s.entity).sort()).toEqual(Object.keys(INLINE_DESCRIPTORS).sort());
  });
});
```

- [ ] **Step 2: Run to verify it fails for the right reason**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts -t "has a row for every INLINE_DESCRIPTORS entity" > "$SP/t2.log" 2>&1; echo "EXIT=$?" >> "$SP/t2.log"
grep -E "Tests |EXIT=|AssertionError|Expected|Received" "$SP/t2.log"
```
Expected: **PASS**, `EXIT=0`. The table was written complete, so this is a green-on-first-write guard rather than a red-to-green cycle.

**Prove it is not vacuous before continuing** — delete the `task` row from `SWEEP`, re-run the same command, and require a FAIL naming `task`. Then restore the row with an Edit and re-run to green. Record both outcomes. A completeness assertion that cannot fail is the exact shape this repo has shipped before.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`. (It exits **2** on diagnostics, not 1.)

- [ ] **Step 4: Commit**

```bash
git add src/app/inline-ai-edit/plan.write-path.test.ts
git commit --only src/app/inline-ai-edit/plan.write-path.test.ts -F "$SP/commit-t2.txt"
```
with `$SP/commit-t2.txt`:
```
test(parity-sweep): add the sweep entity table, asserted complete

One row per INLINE_DESCRIPTORS entity carrying what the REPLAY needs and
nothing the descriptor already declares. Asserted exact against
Object.keys(INLINE_DESCRIPTORS) rather than merely non-empty, so a ninth
entity reds this table instead of being silently uncovered.

Widens WsKey with "tasks"; the union had no task member because no
hand-written case needed one.

Claude-Session: https://[session link removed]
```

---

### Task 3: The enumeration axis, with an anti-vacuity floor

**Files:**
- Modify: `src/app/inline-ai-edit/plan.write-path.test.ts`

- [ ] **Step 1: Write the axis and its floor test**

Append after the `describe("the sweep's own coverage", ...)` block:

```ts
/** A key no schema declares. The non-vacuity control: it must be DROPPED on
 *  every entity. If it lands, that is a finding; if the assertion cannot tell
 *  "dropped" from "never probed", the sweep proves nothing. */
const JUNK_KEY = "zzzNotASchemaFieldAnywhere";

/** The fields swept for one entity: what the preview DECLARES, unioned with
 *  what the writer can actually MOVE.
 *
 *  ★★★ `Object.keys(storedRow)` IS THE §418 HALF AND IT IS NOT INTERCHANGEABLE
 *  WITH THE DESCRIPTOR. Seven of the eight update tools route through
 *  `patchWithoutId(input, kind)`, whose whole body is `{ ...input }` minus `id`,
 *  `expectedToken` and `TOKEN_EXCLUDED[kind]` — so the accepted surface is the
 *  ROW, not the descriptor, and the code never names the fields for a regex to
 *  find. Only `update_task` has a whitelist (`buildPatch`).
 *
 *  ★★ THE GUARD TABLES WOULD HAVE BEEN THE NATURAL SOURCE AND ARE THE WRONG
 *  ONE. Two of the six are exported now, so availability does not decide it —
 *  a guard table is one LAYER of the merge, and this sweep exists to see
 *  divergence at layers a table cannot show. Sourcing the axis from a table
 *  would narrow the sweep to the thing it is trying to get underneath.
 *
 *  ★ Rich fields are excluded: they route through `sanitizeRichText` and are
 *  swept by `plan.sanitizer-parity.test.ts`, which owns that comparison. `id` is
 *  excluded because it addresses the row rather than being written to it. */
function sweptFields(entity: InlineEntity, before: Record<string, unknown>): string[] {
  const declared = INLINE_DESCRIPTORS[entity].diffFields.filter(
    (f) => !RICH_FIELDS.has(`${entity}.${f}`),
  );
  const stored = Object.keys(before).filter(
    (f) => f !== "id" && !RICH_FIELDS.has(`${entity}.${f}`),
  );
  return [...new Set([...declared, ...stored])];
}
```

Then add this `it.each` **inside the existing `describe("the sweep's own coverage", ...)` block** — do not open a second `describe` with the same name. That block no longer holds only Task 2's completeness test: it now also carries `seeds the row each entity claims to drive`, `seeds a distinguishable value for every diffField`, and `derives replayable plumbing for every entity`, all added after Task 2 was written. Append this one after those; order within the block does not matter.

```ts
  // ★★ A FLOOR, NOT A TALLY. The exact number moves whenever a descriptor or a
  //  seed row gains a field, so pinning it would make this test a maintenance
  //  tax that gets "fixed" by lowering the number. What must never happen is a
  //  sweep over an EMPTY axis, which passes everything — that is what this
  //  catches. The floors are per entity so one rich entity cannot carry a
  //  starved one.
  it.each(SWEEP)("$entity sweeps a non-empty field axis", ({ entity, id, seed }) => {
    // `wsKey` is DERIVED — it is not a field on SweepEntity. See sweepPlumbing.
    const { wsKey } = sweepPlumbing(entity);
    const ws = { ...emptyWorkspace(), ...seed } as unknown as Workspace;
    const rows = ws[wsKey] as ReadonlyArray<{ id: number }> | undefined;
    const before = rows?.find((r) => r.id === id);
    expect(before, `fixture did not seed ${wsKey} #${id}`).toBeDefined();
    const fields = sweptFields(entity, before as unknown as Record<string, unknown>);
    expect(fields.length, `${entity} swept ${fields.length} fields`).toBeGreaterThanOrEqual(4);
    expect(fields).not.toContain("id");
    expect(fields).not.toContain(JUNK_KEY);
  });
```

(The snippet ends with one `});` closing the `it.each` — the `describe` was already opened and closed in Task 2, and this test goes inside it.)

`RICH_FIELDS` and `emptyWorkspace` need importing. `emptyWorkspace` is already imported. Add `RICH_FIELDS` to the existing `plan` import — change:
```ts
import { describeEntityCalls, type EditPlan } from "./plan";
```
to:
```ts
import { describeEntityCalls, previewNormalizerFor, RICH_FIELDS, type EditPlan } from "./plan";
```

- [ ] **Step 2: Run it**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts -t "sweeps a non-empty field axis" > "$SP/t3.log" 2>&1; echo "EXIT=$?" >> "$SP/t3.log"
grep -E "Tests |EXIT=" "$SP/t3.log"
```
Expected: `Tests 8 passed (8)`, `EXIT=0` — one per entity.

- [ ] **Step 3: Print the real axis widths, so the floor is calibrated rather than guessed**

Add a temporary `console.log(entity, fields.length, fields.join(","))` inside the `it.each`, re-run, read the eight widths from the log, then REMOVE the log line with an Edit. Record the eight numbers in the commit message. **If any entity's real width is below 8, raise this in the report** — a floor of 4 under a real width of 20 is nearly inert, and a floor calibrated well below the measured value is the shape that lets a silent narrowing back in.

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/inline-ai-edit/plan.write-path.test.ts
git commit --only src/app/inline-ai-edit/plan.write-path.test.ts -F "$SP/commit-t3.txt"
```
with `$SP/commit-t3.txt` (fill the eight measured widths into the body):
```
test(parity-sweep): derive the field axis and floor it per entity

The axis is the union of what the preview declares (diffFields) and what
the writer can actually move (Object.keys of the stored row). The second
half is the §418 case: seven of the eight update tools route through
patchWithoutId, so their accepted surface is the row and the code never
names the fields for a source scan to find.

Floored per entity rather than tallied, because the exact width moves
whenever a descriptor or a seed row gains a field, and a pinned total gets
"fixed" by lowering it. What the floor forbids is a sweep over an empty
axis, which passes everything.

Measured axis widths: (fill in the eight from Step 3)

Claude-Session: https://[session link removed]
```

---

### Hazards carried into Tasks 4-5 — read before writing a probe

Found while executing Tasks 2-3, not present when this plan was drafted. Each is a
way for the sweep to report a PARITY FINDING that is really a property of the
field, which would burn a fix cycle on a non-defect.

1. **`sendInvitations` carries three separate behaviours at once**, and only the
   first is a normal field.
   - It is **present-only-when-true** (`calendar-event.ts`, `sanitizeCalendarEvent`
     stores `true` or `undefined`, never `false`). So `false` and "refused" are the
     SAME stored shape — the same rule that governs `resource.isExternal`. A probe
     setting it `false` can never be distinguished from a rejection.
   - It **drives staging**: `shouldStage` in `chat-proposal.ts` returns true when a
     `create_calendar_event` / `update_calendar_event` call carries a strict
     `sendInvitations === true`. That is a different code path from every other
     probe in the sweep.
   - It is **token-excluded** for `calendarEvent` (`TOKEN_EXCLUDED`,
     `ai-entity-token.ts`), so `patchWithoutId` strips it before the merge. A
     probe on it is therefore expected NOT to move the stored row via the normal
     path, and the sweep must not read that as an undisclosed refusal.

2. **Token-excluded fields are a class, not a special case.** `TOKEN_EXCLUDED`
   lists per-entity fields `patchWithoutId` removes from every model patch —
   `localModifiedAt` and `outlookEventId` on most entities, plus `noteLog`,
   `inquiriesSent` and `lastSyncedAt` on some. They will appear in
   `Object.keys(storedRow)` and therefore enter the axis via the §418 half, but
   the writer cannot move them by construction. **Decide deliberately whether the
   sweep excludes them from the axis or asserts they never move** — asserting they
   never move is the stronger claim and is probably right, since it pins the
   exclusion rather than assuming it. What must not happen is discovering them one
   at a time as apparent findings.

3. **UNVERIFIED, inherited from the seed task and still open.** Whether a
   `recurrence` value interacts with `exceptions` or with the invitation path on
   `update_calendar_event`. The recurrence SHAPE was confirmed directly against the
   `RecurrenceRule` union; the interaction was not. No current test drives that row
   against a recurring event, so today's green says nothing about it. Check it
   before trusting a calendarEvent finding.

4. **No mail is believed to be sent by a unit-test replay** — the dispatcher stores
   a flag and the send lives outside it. **This was not verified**, and it is the
   one write in this file with a real-world side effect, so confirm it before
   driving `sendInvitations: true` through the sweep rather than assuming it.

---

### Task 4: The probe set and the single-field replay helper

**Files:**
- Modify: `src/app/inline-ai-edit/plan.write-path.test.ts`

- [ ] **Step 1: Write the probes and the replay helper**

Append:

```ts
/** Probes are derived from the STORED value's type rather than listed per
 *  field, so a new field is probed the moment it exists.
 *
 *  ★★ DELIBERATELY NARROWER THAN `plan.sanitizer-parity.test.ts`'s ten-probe
 *  list, and the reason is cost, not principle: every probe here is a full
 *  `renderHook` mount plus an `act`, where that file's is a function call. The
 *  ten-probe breadth over TEXT shapes (surrogate straddles, length caps, CRLF)
 *  is that sweep's job and it already does it at the sanitizer layer. This one
 *  exists for the LAYER, not the value space — so it probes each type just
 *  widely enough to move the field, plus one wrong-type probe to reach the
 *  merge-site guard.
 *
 *  ★ Each probe must be able to MOVE the field. A probe equal to the stored
 *  value makes `moved` false and every relation trivially satisfiable, which is
 *  why the string probes are built off the stored value rather than fixed. */
function probesFor(current: unknown): ReadonlyArray<{ label: string; value: unknown }> {
  if (typeof current === "boolean") {
    return [
      { label: "the opposite boolean", value: !current },
      { label: "a non-boolean string", value: "yes" },
    ];
  }
  if (typeof current === "number") {
    return [
      { label: "the number 3", value: 3 },
      { label: "a negative number", value: -1 },
      { label: "a numeric string", value: "7" },
    ];
  }
  if (Array.isArray(current)) {
    return [
      { label: "an empty array", value: [] },
      { label: "a non-array string", value: "nope" },
    ];
  }
  if (current === null) {
    return [
      { label: "a plain number", value: 1 },
      { label: "an explicit null", value: null },
    ];
  }
  // string, undefined, or an object-valued field (recurrence).
  return [
    { label: "a padded string", value: "  padded  " },
    { label: "the empty string", value: "" },
    { label: "the number 42", value: 42 },
  ];
}

/** Preview one field's probe and REPLAY it through the real dispatcher.
 *
 *  ★★ A near-copy of `previewAndWrite` above, and deliberately not folded into
 *  it: that one takes a whole hand-written `WriteCase` with an `expectStored`
 *  map, this one takes one field and returns raw rows for the caller to relate.
 *  Merging them would need a union parameter and would make the hand-written
 *  cases harder to read, which is the thing they are for. */
async function replayOneField(
  s: SweepEntity,
  field: string,
  probe: unknown,
): Promise<{ plan: EditPlan; before: Row; stored: Row }> {
  const { result } = renderHook(
    () => ({ d: useChatDispatcher(makeDispatcherArgs()), ws: useWorkspace() }),
    { wrapper: dispatcherWrapperWith(s.seed) },
  );

  // `tool`, `kind` and `wsKey` are DERIVED, never fields on `s` — see the
  // `sweepPlumbing` docstring in Task 2 for why hand-copying them is banned.
  const { tool, kind, wsKey } = sweepPlumbing(s.entity);

  const wsBefore = snapshot(result.current.ws);
  const rowsBefore = wsBefore[wsKey] as ReadonlyArray<{ id: number }> | undefined;
  const before = rowsBefore?.find((r) => r.id === s.id) as Row | undefined;
  if (!before) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);

  const input: Record<string, unknown> = { id: s.id, [field]: probe };

  const plan = describeEntityCalls([{ type: "tool_use", name: tool, input }], {
    descriptor: INLINE_DESCRIPTORS[s.entity],
    item: before,
    ws: wsBefore,
  });

  await act(async () => {
    await runTool(result.current.d, tool, { ...input, expectedToken: entityToken(kind, before) });
  });

  const wsAfter = snapshot(result.current.ws);
  const rowsAfter = wsAfter[wsKey] as ReadonlyArray<{ id: number }> | undefined;
  const stored = rowsAfter?.find((r) => r.id === s.id) as Row | undefined;
  if (!stored) throw new Error(`${wsKey} #${s.id} vanished during the replay`);

  return { plan, before, stored };
}
```

- [ ] **Step 2: Typecheck (nothing runs these yet)**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`. If eslint's `no-unused-vars` complains that `probesFor` / `replayOneField` are unused, that is expected until Task 5 — **do not** silence it with a disable comment; commit Tasks 4 and 5 together instead if lint is fatal at this point. Check with:
```bash
npx eslint --max-warnings=0 src/app/inline-ai-edit/plan.write-path.test.ts; echo "EXIT=$?"
```

- [ ] **Step 3: Commit (only if eslint is green; otherwise carry into Task 5)**

```bash
git add src/app/inline-ai-edit/plan.write-path.test.ts
git commit --only src/app/inline-ai-edit/plan.write-path.test.ts -F "$SP/commit-t4.txt"
```
with `$SP/commit-t4.txt`:
```
test(parity-sweep): add type-derived probes and the one-field replay

Probes are derived from the stored value's type rather than listed per
field, so a new field is probed the moment it exists, and each is built to
actually MOVE the field — a probe equal to the stored value makes every
relation trivially satisfiable.

Deliberately narrower than plan.sanitizer-parity.test.ts's ten probes: each
one here is a renderHook mount rather than a function call, and the breadth
over text shapes is that file's job at the sanitizer layer. This sweep is
about the LAYER, not the value space.

Claude-Session: https://[session link removed]
```

---

### Task 5: The three relations

The contract itself. Read the spec's "The contract" section before writing this.

**Files:**
- Modify: `src/app/inline-ai-edit/plan.write-path.test.ts`

- [ ] **Step 1: Write the sweep**

Append:

```ts
/** What the preview said about one field: whether it was refused, and if not,
 *  the string the card showed.
 *
 *  ★★ `rejectedFields` (above) is REUSED rather than re-derived, and that
 *  matters: a rejection detail is not always `${field}=${value}` — a joint
 *  `requiredNonEmptyGroups` refusal is spelled `${a}+${b}=empty`, so a naive
 *  `startsWith(field + "=")` misses it. A MISSED rejection does not read as
 *  "no outcome"; it reads as the preview ACCEPTING what it refused, which is
 *  the silent direction. */
function previewOutcome(plan: EditPlan, field: string) {
  const rejected = rejectedFields(plan).includes(field);
  const update = plan.updates.find((u) => u.field === field);
  // ★★★ `target === "row"` IS LOAD-BEARING AND `entity` CANNOT SUBSTITUTE FOR
  //  IT. A `"create"` LinkDiff is DISCLOSURE ONLY — projected off a `create_*`
  //  call so the card can say what that create will write to its OWN row — so
  //  counting one as a disclosure about THIS row is §393's data-loss shape read
  //  backwards. This sweep emits only `update_*` tools, so every link diff here
  //  should already be `"row"`; filtering anyway means a probe that later starts
  //  emitting a create cannot silently pass for the wrong reason.
  const link = plan.links.find((l) => l.field === field && l.target === "row");
  return { rejected, update, link, disclosed: Boolean(update ?? link) };
}

/** The stored value rendered the way the card would render it, so an accepted
 *  preview can be compared against what the writer actually stored.
 *
 *  ★ DELEGATED, not restated: `previewNormalizerFor` is the production
 *  resolution order (descriptor entry -> numeric coercion -> verbatim), so a
 *  field moving between those three cannot leave this behind. */
function shownForStored(entity: InlineEntity, field: string, stored: Row): string {
  const normalize = previewNormalizerFor(INLINE_DESCRIPTORS[entity], field);
  return normalize
    ? normalize(stored[field], stored as Record<string, unknown>)
    : String(stored[field] ?? "");
}

describe.each(SWEEP)("write-path parity sweep — $entity", (s) => {
  it("every field: the card and the writer agree", async () => {
    const { wsKey } = sweepPlumbing(s.entity);
    const seedWs = { ...emptyWorkspace(), ...s.seed } as unknown as Workspace;
    const seedRows = seedWs[wsKey] as ReadonlyArray<{ id: number }> | undefined;
    const seedRow = seedRows?.find((r) => r.id === s.id) as Row | undefined;
    if (!seedRow) throw new Error(`fixture did not seed ${wsKey} #${s.id}`);

    const violations: string[] = [];
    let moved = 0;

    for (const field of sweptFields(s.entity, seedRow)) {
      for (const { label, value } of probesFor(seedRow[field])) {
        const { plan, before, stored } = await replayOneField(s, field, value);
        const key = `${s.entity}.${field} on ${label}`;
        const changed = !same(before[field], stored[field]);
        if (changed) moved += 1;
        const { rejected, update, link, disclosed } = previewOutcome(plan, field);

        // RELATION 2 — a refusal in the card must be a refusal in the write.
        // Compared against the field's OWN before-value, never against "was
        // anything written": a replay always writes, so the latter would flag
        // every preview-only rejection. §384 is this relation's instance.
        if (rejected) {
          if (changed) {
            violations.push(
              `${key}: preview REJECTS, write moved ${JSON.stringify(before[field])} -> ${JSON.stringify(stored[field])}`,
            );
          }
          continue;
        }

        // RELATION 3 — an undisclosed write. §418 as a property, and the
        // relation no source scan can reach for the seven pass-through tools.
        if (changed && !disclosed) {
          violations.push(
            `${key}: write moved ${JSON.stringify(before[field])} -> ${JSON.stringify(stored[field])} with NO preview line`,
          );
          continue;
        }

        // RELATION 1 — what the card showed must be what the writer stored.
        //
        // ★★★ THE TWO DIFF KINDS ARE COMPARED DIFFERENTLY AND MUST NOT BE
        //  FLATTENED. A `FieldDiff` renders a VALUE, so it is compared against
        //  the stored value pushed through the same normaliser the card used. A
        //  `LinkDiff` renders RESOLVED TITLES (that is its entire purpose — see
        //  its docstring), so comparing `link.after` against a normalised value
        //  would never match and the sweep would report a violation on every
        //  correct link write. Its raw ids are the comparable half.
        if (disclosed) {
          if (!changed) {
            const shown = update ? (update.raw ?? update.after) : link?.after;
            violations.push(
              `${key}: preview disclosed ${JSON.stringify(shown)} but the write stored nothing new`,
            );
            continue;
          }
          if (update) {
            const shown = update.raw ?? update.after;
            const actual = shownForStored(s.entity, field, stored);
            if (shown !== actual) {
              violations.push(`${key}: preview showed ${JSON.stringify(shown)} ≠ stored ${JSON.stringify(actual)}`);
            }
          } else if (link) {
            if (!same(link.rawIds, stored[field])) {
              violations.push(
                `${key}: preview linked ${JSON.stringify(link.rawIds)} ≠ stored ${JSON.stringify(stored[field])}`,
              );
            }
          }
        }
      }
    }

    // ★★★ ANTI-VACUITY, AND IT IS THE ASSERTION THIS WHOLE FILE TURNS ON. A
    //  replay refused by a stale token leaves the row untouched and makes every
    //  relation above trivially true — green, and proving nothing. If NOTHING
    //  moved for an entire entity, the harness is broken, not the code.
    expect(moved, `${s.entity}: no probe moved any field — the sweep is vacuous`).toBeGreaterThan(0);
    expect(violations, `${violations.length} parity violations`).toEqual([]);
  });

  it("drops a key no schema declares", async () => {
    const { before, stored } = await replayOneField(s, JUNK_KEY, "should never land");
    expect(JUNK_KEY in before, "the junk key must not be on the seeded row").toBe(false);
    expect(JUNK_KEY in stored, "a key no schema declares reached the stored row").toBe(false);
  });
});
```

- [ ] **Step 2: Run it — this is the discovery run, and it is EXPECTED to be red**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/sweep-first.log" 2>&1; echo "EXIT=$?" >> "$SP/sweep-first.log"
grep -E "Test Files|Tests |EXIT=|Duration" "$SP/sweep-first.log"
```

**Do not fix anything yet.** Task 6 is a hard stop.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: `EXIT=0`.

- [ ] **Step 4: Commit the sweep, red or green**

Commit the detector before any fix, so the fixes have something to be measured against and the diff separates "what we can now see" from "what we changed".

```bash
git add src/app/inline-ai-edit/plan.write-path.test.ts
git commit --only src/app/inline-ai-edit/plan.write-path.test.ts -F "$SP/commit-t5.txt"
```
with `$SP/commit-t5.txt`:
```
test(parity-sweep): assert the three relations across all eight entities

Per entity, per field, per probe: a refusal in the card must be a refusal
in the write (relation 2, §384's shape); a write that moved must carry a
preview line (relation 3, §418 as a property); and a disclosed change must
match what the writer stored (relation 1).

Carries its own anti-vacuity guard. A replay refused by a stale token
leaves the row untouched and satisfies every relation trivially, so an
entity where nothing moved is a hard failure rather than a pass.

This commit may be RED. The detector lands before the fixes deliberately,
so the fixes have something to be measured against.

Claude-Session: https://[session link removed]
```

---

### Task 6: HARD STOP — report the finding count and get a go/cut decision

**This task writes no code.** The user chose "fix everything found", which makes the slice's size unbounded by construction. They asked to see the count before any fixing starts so they can cut it back deliberately.

**Files:**
- Modify: none

- [ ] **Step 1: Extract every violation from the discovery run**

```bash
SP="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad"
grep -E "preview REJECTS|NO preview line|preview showed|preview linked|stored nothing new|reached the stored row|is vacuous" "$SP/sweep-first.log" | sort | uniq > "$SP/findings.txt"
wc -l < "$SP/findings.txt"
cat "$SP/findings.txt"
```

- [ ] **Step 2: Classify each finding by relation and by entity**

Produce a table with one row per finding: entity, field, probe label, which relation fired, and the before → after values. Group them — several findings often share one cause, and the count of CAUSES is the number that predicts the work, not the count of lines.

- [ ] **Step 3: Report to the user and WAIT**

Report, in this order:
1. The raw violation count and the estimated **cause** count.
2. Which are user-visible (relation 1 and relation 3 — the card lied about what would be stored) versus preview-only (relation 2 with no movement is not a violation at all and will not appear; relation 2 with movement IS user-visible and is §384's shape).
3. Any finding whose fix would need an i18n key — **those are blocked on the peer** and must be called out separately.
4. Whether the anti-vacuity guard fired for any entity, which would mean the harness is broken rather than the code.

Then **stop and wait for a go/cut decision.** Do not start Task 7 without one.

---

### Task 7: Fix the findings — one cause per commit

**Files:**
- Modify: unknown until Task 6. Expect `src/app/inline-ai-edit/entity-descriptor.ts`, `src/app/inline-ai-edit/plan.ts`, `src/app/sanitize-records.ts`, `src/app/use-register-tools.ts`.

Repeat this five-step cycle **once per cause**, in the order the user agreed in Task 6.

- [ ] **Step 1: Reproduce the single finding in isolation**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts -t "<entity>" > "$SP/fix-<n>-before.log" 2>&1; echo "EXIT=$?" >> "$SP/fix-<n>-before.log"
grep -E "Tests |EXIT=" "$SP/fix-<n>-before.log"
```
Expected: FAIL, with the finding's own message in the output.

- [ ] **Step 2: Decide WHICH SIDE is wrong before editing either**

This is the step that decides whether the fix is correct, and it cannot be skipped. For each cause, answer in writing:

- Is the **preview** overstating (it disclosed a change the writer will not make)? Fix the preview — usually a `fieldSanitizers` entry or a `rawTypeGuards` row in `entity-descriptor.ts`.
- Is the **preview** understating (it refused something the writer accepts, or stayed silent about something the writer moved)? Fix the preview the same way.
- Is the **writer** wrong (it stores something the user was never shown, or drops something they were)? Fix `sanitize-records.ts` or the merge site in `use-register-tools.ts`.

**Overstating a write is worse than saying nothing** — a user approving a card must never get more than the card described. Where both sides are defensible, prefer narrowing the write over widening the card.

- [ ] **Step 3: Make the edit**

Use the **Edit tool** — these are CRLF files. If the fix needs a new i18n key, **stop and send it to the peer**:

```
SendMessage to aipm-wt-a-ea:
  "Blocked on an i18n key for the parity sweep. Need <keyName>:
   EN: <english value>
   DE: <german value, real umlauts>
   Context: <where it renders>.
   You own i18n.ts / i18n.de.ts for the duration, so I have not touched either."
```
Then move to the next cause and return to this one when the peer confirms.

- [ ] **Step 4: Verify the fix, and that it fixed only what it claimed**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/fix-<n>-after.log" 2>&1; echo "EXIT=$?" >> "$SP/fix-<n>-after.log"
grep -E "Test Files|Tests |EXIT=" "$SP/fix-<n>-after.log"
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > "$SP/fix-<n>-parity.log" 2>&1; echo "EXIT=$?" >> "$SP/fix-<n>-parity.log"
grep -E "Test Files|Tests |EXIT=" "$SP/fix-<n>-parity.log"
npx tsc --noEmit; echo "EXIT=$?"
```
The violation count in `fix-<n>-after.log` must have dropped by exactly the cause's findings and by nothing else. **A fix that clears more findings than it was aimed at has changed something you did not intend** — investigate before continuing.

- [ ] **Step 5: Commit this cause alone**

```bash
git add <the exact files this cause touched>
git commit --only <the exact files this cause touched> -F "$SP/commit-fix-<n>.txt"
```
The message must state: which relation fired, the before → after values the sweep reported, which side was wrong and why, and what a user would have seen. Ending with the session trailer.

---

### Task 8: Re-run the whole sweep to green

**Files:**
- Modify: none

- [ ] **Step 1: Full file, green**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/sweep-green.log" 2>&1; echo "EXIT=$?" >> "$SP/sweep-green.log"
grep -E "Test Files|Tests |EXIT=" "$SP/sweep-green.log"
```
Expected: `EXIT=0`, and a test count of the baseline from Task 1 **plus 17** (8 sweep parity tests + 8 junk-key tests + 1 completeness test), plus 8 more if the axis-floor `it.each` is counted separately. Read the real number; do not assert this arithmetic.

- [ ] **Step 2: Confirm both exception sets are still empty**

```bash
grep -n -A 2 "const APPLY_ONLY_REJECTS" src/app/inline-ai-edit/plan.sanitizer-parity.test.ts
grep -n -A 2 "const PREVIEW_REJECTS_APPLY_WRITES" src/app/inline-ai-edit/plan.sanitizer-parity.test.ts
```
Expected: both still empty. The user's decision was that findings are fixed, not excused — **an entry in either set is a position to argue in review, not a default.**

- [ ] **Step 3: Write the sweep's own limits block**

The spec requires these be written into the file rather than claimed away. Append immediately below the sweep's `describe.each`, and **check each against what actually happened in Tasks 5-7** — a limit that did not bite is still a limit, but one that bit and is not listed here is a false coverage claim, which reads as protection and stops the next audit.

```ts
// ★★★ WHAT THIS SWEEP STILL CANNOT SEE. Written down because a detector that
// does not state its blind spots gets read as covering them.
//
//  (1) A COUPLING NO PROBE GENERATES. One field is set per replay, so raid's
//      `category` -> `status` drag is exercised only by the hand-written case
//      above that already covers it. The general two-field case is uncovered.
//  (2) A KEY ON NEITHER THE ROW NOR THE DESCRIPTOR. Bounded — such a key cannot
//      survive the sanitizer — but not zero, and `JUNK_KEY` probes exactly one
//      shape of it.
//  (3) A FIELD WHOSE PROBE THE SCHEMA REFUSES AT THE DOOR. A probe that never
//      reaches the writer tests nothing. `probesFor` is type-derived so this is
//      rare, and the per-entity `moved` floor catches the total-starvation case,
//      but a single always-refused field is invisible.
//  (4) CONSUMER BEHAVIOUR. Everything here is measured on the WRITER's output.
//      "Nothing is written" is reasoning about a consumer, and it is the
//      reasoning that shipped §384.
//  (5) ★★ THE GUARD LAYER OF `absence` AND `calendarEvent` IS SHARED, NOT
//      VERIFIED. Their preview reads the merge site's own tables through
//      `rawTypeGuards` (`ABSENCE_FIELD_GUARDS` / `CALENDAR_EVENT_FIELD_GUARDS`),
//      so at that layer the two sides agree BY CONSTRUCTION and agreement there
//      is worth nothing. What this does certify for those two is the layer below
//      (their sanitizers) and the wiring — which is where 0.293.0's cold review
//      actually found defects, so it is a narrowing rather than a hole. Do not
//      report those two entities as "fully parity-checked".
//  (6) THE TOKEN IS INJECTED, NOT OBTAINED. `replayOneField` stamps
//      `expectedToken` from the stored row itself, so this proves the writer
//      ACCEPTS a correct token and never that a model could OBTAIN one. That
//      half is pinned by the `ROUND_TRIP` block in `chat-tools.test.ts`, whose
//      own comment names this file as the one that cannot see it. Do not
//      duplicate it here, and do not claim it.
```

- [ ] **Step 4: Commit the limits block**

```bash
git add src/app/inline-ai-edit/plan.write-path.test.ts
git commit --only src/app/inline-ai-edit/plan.write-path.test.ts -F "$SP/commit-t8.txt"
```
with `$SP/commit-t8.txt`:
```
docs(parity-sweep): state the sweep's six blind spots in the file

A detector that does not state its blind spots gets read as covering them.
Two of these are new since the spec was drafted: the guard layer of absence
and calendarEvent is shared with the preview through rawTypeGuards and so
agrees by construction, and the token is injected rather than obtained.

Claude-Session: https://[session link removed]
```

---

### Task 9: Size and lint check before the mutants

**Files:**
- Modify: none

- [ ] **Step 1: Size ratchet**

```bash
node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)"
npm run size:check > "$SP/size.log" 2>&1; echo "EXIT=$?" >> "$SP/size.log"
grep -E "EXIT=|LIMIT|exceeds|over" "$SP/size.log"
```
Expected: under 1600 and `EXIT=0`. The ratchet counts `split("\n").length`, which is `wc -l` **plus one** — budget from the node command, never from `wc -l`.

- [ ] **Step 2: Lint at CI strictness**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```
Expected: `EXIT=0`. Use `src`, not `.` — a bare run picks up gitignored `.worktrees/` leftovers and exits 1 on files nobody owns.

---

### Task 10: The four denylist mutants

Acceptance, not the green run. Each mutant is recorded as `N failed / M passed`, and **the sum must equal the file's runtime test count** from Task 8.

**Files:**
- Mutated and reverted: `src/app/use-register-tools.ts`

★★★ **MUTATE THE CALL SITE, NEVER THE GUARD TABLE.** For `absence` and `calendarEvent` (Task 11) the preview reads the same table objects the merge site does, via `rawTypeGuards` — so editing a table moves both sides together, the differential stays green over changed behaviour, and the sweep certifies itself. This is the single most likely way to finish this slice holding a confident and wrong "certified" claim. The four here are denylists and do not share their tables with the preview, but the rule is uniform so it cannot be misapplied by habit.

Repeat for each of the four, one at a time — **never two mutants live at once**, or the earlier guard short-circuits the later one and its mutant is unreachable, surviving for the wrong reason.

| # | Guard | Call site |
|---|---|---|
| 1 | `dropUnacceptedRaidFields` | `src/app/use-register-tools.ts:293` |
| 2 | `dropUnacceptedChangeFields` | `src/app/use-register-tools.ts:418` |
| 3 | `dropUnacceptedMilestoneFields` | `src/app/use-register-tools.ts:517` |
| 4 | `dropUnacceptedStakeholderFields` | `src/app/use-register-tools.ts:597` |

- [ ] **Step 1: Apply mutant 1 with the Edit tool**

Change (in `use-register-tools.ts`, CRLF — Edit tool only):
```ts
          ...withAiRichFields(dropUnacceptedRaidFields(patch, existing), AI_RICH_FIELDS.raid),
```
to:
```ts
          ...withAiRichFields(patch, AI_RICH_FIELDS.raid),
```

- [ ] **Step 2: Assert the mutant actually landed**

```bash
git diff --stat src/app/use-register-tools.ts
grep -c "dropUnacceptedRaidFields" src/app/use-register-tools.ts
```
Expected: one file changed, 1 insertion 1 deletion; the grep drops from 2 (import + call) to **1** (import only). A mutant that did not land produces a "surviving mutant" that is really a no-op edit.

- [ ] **Step 3: Run the sweep and record the split**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/mutant-raid.log" 2>&1; echo "EXIT=$?" >> "$SP/mutant-raid.log"
grep -E "Tests |EXIT=" "$SP/mutant-raid.log"
grep -E "preview REJECTS|NO preview line|preview showed" "$SP/mutant-raid.log" | head -5
```
Expected: **red**, recorded as `N failed / M passed` where `N + M` equals Task 8's test count. Record **which relation fired** — a denylist mutant should fail **relation 2** (a refused value now overwrites the stored one). A mutant that reds a different relation landed somewhere other than where it was aimed; say so rather than counting it.

**If the mutant SURVIVES (green):** that is a question, not a licence. "Equivalent mutant" and "missing test" look identical from the harness. Report it with the seed row's values for that entity's guarded fields — the most likely cause is a fixture sitting on the sanitizer's own fallback, where a reset is indistinguishable from a preserved value.

- [ ] **Step 4: Revert with an anchored inverse write and prove the tree is clean**

Use the Edit tool to restore the exact original line. Then:
```bash
git diff --stat src/app/use-register-tools.ts
grep -c "dropUnacceptedRaidFields" src/app/use-register-tools.ts
```
Expected: **empty diff output**, and the grep back to **2**. An empty `git diff --stat` is the only acceptable end state — a live mutant left behind poisons every later measurement in this plan.

- [ ] **Step 5: Repeat Steps 1-4 for mutants 2, 3 and 4**

Mutant 2 — change `...withAiRichFields(dropUnacceptedChangeFields(patch), AI_RICH_FIELDS.change),` to `...withAiRichFields(patch, AI_RICH_FIELDS.change),`.

Mutant 3 — change `...withAiRichFields(dropUnacceptedMilestoneFields(patch), AI_RICH_FIELDS.milestone),` to `...withAiRichFields(patch, AI_RICH_FIELDS.milestone),`.

Mutant 4 — change `...dropUnacceptedStakeholderFields(patch),` to `...patch,`.

For each: assert it landed, run, record `N failed / M passed` and which relation fired, revert, prove the empty diff.

- [ ] **Step 6: Record all four in the scratchpad**

```bash
cat > "$SP/mutants-denylist.txt" <<'MUTANTS'
(one line per mutant: guard, N failed / M passed, sum, relation that fired)
MUTANTS
cat "$SP/mutants-denylist.txt"
```

No commit — this task leaves no diff by construction.

---

### Task 11: The two allowlist mutants

**Files:**
- Mutated and reverted: `src/app/use-register-tools.ts`

These fail a **different relation** from Task 10's four, and that difference is the point. A denylist guard removed lets a refused value **overwrite** the stored one (relation 2). An allowlist guard removed lets **everything the model sent** through, including fields with no table entry — so it fails relation 2 as well, but via a wider blast radius, and may additionally trip relation 3.

| # | Guard | Call site |
|---|---|---|
| 5 | `dropUnacceptedAbsenceFields` | `src/app/use-register-tools.ts:694` |
| 6 | `dropUnacceptedCalendarEventFields` | `src/app/use-register-tools.ts:765` |

- [ ] **Step 1: Apply mutant 5 with the Edit tool**

Change `...dropUnacceptedAbsenceFields(patch),` to `...patch,`.

- [ ] **Step 2: Assert it landed**

```bash
git diff --stat src/app/use-register-tools.ts
grep -c "dropUnacceptedAbsenceFields" src/app/use-register-tools.ts
```
Expected: 1 insertion / 1 deletion; grep from 2 to **1**.

- [ ] **Step 3: Run and record**

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/mutant-absence.log" 2>&1; echo "EXIT=$?" >> "$SP/mutant-absence.log"
grep -E "Tests |EXIT=" "$SP/mutant-absence.log"
grep -E "preview REJECTS|NO preview line|preview showed" "$SP/mutant-absence.log" | head -5
```
Expected: red. Record `N failed / M passed`, the sum against Task 8's count, and the relation.

- [ ] **Step 4: Revert and prove clean**

Edit the line back. Then `git diff --stat src/app/use-register-tools.ts` must print nothing and the grep must return to 2.

- [ ] **Step 5: Repeat for mutant 6**

Change `...dropUnacceptedCalendarEventFields(patch),` to `...patch,`; assert landed; run; record; revert; prove clean.

- [ ] **Step 6: The negative control — prove the table mutant is the wrong instrument**

This step exists to make the ★★★ rule above demonstrable rather than asserted, and it is the most valuable measurement in the plan.

Mutate the **table** instead of the call site: in `src/app/sanitize-records.ts`, change `ABSENCE_FIELD_GUARDS`' `type` row to accept anything — `type: () => true`. Run the sweep. **Expected: GREEN**, because `rawTypeGuards` feeds the preview the same object, so both sides moved together.

```bash
npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts > "$SP/mutant-table-control.log" 2>&1; echo "EXIT=$?" >> "$SP/mutant-table-control.log"
grep -E "Tests |EXIT=" "$SP/mutant-table-control.log"
```

Record the result either way. **If it goes RED, the ★★★ rule is wrong and the spec must be corrected** — that would mean the two sides are not as coupled as the re-grounding claims, which is a finding about the codebase worth more than the rule it refutes. Then revert with an anchored inverse write and prove `git diff --stat src/app/sanitize-records.ts` is empty.

- [ ] **Step 7: Record all three outcomes**

```bash
cat > "$SP/mutants-allowlist.txt" <<'MUTANTS'
(mutant 5, mutant 6, and the table negative control: N failed / M passed, sum, relation)
MUTANTS
cat "$SP/mutants-allowlist.txt"
```

No commit — no diff by construction.

---

### Task 12: §405 tail — one spelling of the three RAID enum predicates

**Separate commit**, as the spec requires.

**Files:**
- Modify: `src/app/sanitize-records.ts`

**What is actually duplicated, and what is not.** The three guard rows and `sanitizeRaidItem` **already share the set objects** (`RAID_CATEGORY_SET`, `RAID_SEVERITY_SET`, `statusSetForCategory`). What is restated is the *predicate around them* — `typeof v === "string" && SET.has(v)` — written once in the table and again ~100 lines up in the sanitizer. Narrow, but not absent, which is exactly what §405 says.

★★ **`MILESTONE_FIELD_GUARDS.achievedDate` is OUT and must not be "completed".** `acceptsPatchDate` is deliberately wider than `sanitizeMilestone`'s own rule by exactly the clear carve-out, and both sites carry a docstring saying so. Sharing it there would be a behaviour change.

- [ ] **Step 1: Add the three named predicates**

In `src/app/sanitize-records.ts` (CRLF — Edit tool), immediately after `statusSetForCategory`'s closing brace, insert:

```ts
/** The three RAID enum rules, each with ONE spelling.
 *
 *  ★★★ THE SANITIZER CALLS THESE; THESE DO NOT RESTATE THE SANITIZER — the same
 *  direction `acceptsRiskScale` and `acceptsRaidDate` already run in
 *  (open-followups §405). Before this, `RAID_FIELD_GUARDS` and
 *  `sanitizeRaidItem` held two copies of one predicate ~100 lines apart. They
 *  shared the SETS, so the residual drift was narrow — but a test cannot see a
 *  drift when every it.each row asserts a chosen value against both sides at
 *  once, and narrow is not absent. */
const acceptsRaidCategory = (v: unknown): boolean =>
  typeof v === "string" && RAID_CATEGORY_SET.has(v);

const acceptsRaidStatus = (v: unknown, category: RaidCategory): boolean =>
  typeof v === "string" && statusSetForCategory(category).set.has(v);

const acceptsRaidSeverity = (v: unknown): boolean =>
  typeof v === "string" && RAID_SEVERITY_SET.has(v);
```

- [ ] **Step 2: Point the guard table at them**

Change:
```ts
  category: (v) => typeof v === "string" && RAID_CATEGORY_SET.has(v),
  status: (v, category) => typeof v === "string" && statusSetForCategory(category).set.has(v),
  severity: (v) => typeof v === "string" && RAID_SEVERITY_SET.has(v),
```
to:
```ts
  category: acceptsRaidCategory,
  status: acceptsRaidStatus,
  severity: acceptsRaidSeverity,
```

- [ ] **Step 3: Point the sanitizer at them**

Change:
```ts
  const category: RaidCategory =
    typeof o.category === "string" && RAID_CATEGORY_SET.has(o.category)
      ? (o.category as RaidCategory)
      : "R";
```
to:
```ts
  const category: RaidCategory = acceptsRaidCategory(o.category) ? (o.category as RaidCategory) : "R";
```

Change:
```ts
  const { set: statusSet, statuses } = statusSetForCategory(category);
  const status: RaidStatus =
    typeof o.status === "string" && statusSet.has(o.status)
      ? (o.status as RaidStatus)
      : statuses[0];
```
to:
```ts
  // `statuses` is still needed for the fallback, so the destructure stays; only
  // the PREDICATE moves out. `acceptsRaidStatus` re-derives the set from the
  // category, which is the same set this line already destructured.
  const { statuses } = statusSetForCategory(category);
  const status: RaidStatus = acceptsRaidStatus(o.status, category) ? (o.status as RaidStatus) : statuses[0];
```

Change:
```ts
  if (typeof o.severity === "string" && RAID_SEVERITY_SET.has(o.severity)) {
    item.severity = o.severity as RaidSeverity;
  }
```
to:
```ts
  if (acceptsRaidSeverity(o.severity)) {
    item.severity = o.severity as RaidSeverity;
  }
```

- [ ] **Step 4: Verify no behaviour changed**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run --maxWorkers=1 src/app/sanitize-records.test.ts src/app/inline-ai-edit/plan.write-path.test.ts src/app/inline-ai-edit/plan.sanitizer-parity.test.ts > "$SP/t405.log" 2>&1; echo "EXIT=$?" >> "$SP/t405.log"
grep -E "Test Files|Tests |EXIT=" "$SP/t405.log"
```
Expected: `EXIT=0` on both, with the same test counts as before. This is a behaviour-preserving refactor — **any changed count is a real change and must be understood, not accepted.**

If `sanitize-records.test.ts` does not exist under that name, find the right file first:
```bash
ls src/app/sanitize*.test.ts src/app/sanitize-*-patch.test.ts 2>/dev/null
```

- [ ] **Step 5: Prove the dedup is real, not cosmetic**

```bash
grep -c "RAID_CATEGORY_SET.has\|RAID_SEVERITY_SET.has" src/app/sanitize-records.ts
```
Expected: **2** — one inside each new predicate, and nowhere else. Before this change it was 4. If it is still 4, a call site was missed.

- [ ] **Step 6: Commit**

```bash
git add src/app/sanitize-records.ts
git commit --only src/app/sanitize-records.ts -F "$SP/commit-t405.txt"
```
with `$SP/commit-t405.txt`:
```
refactor(raid): give the three enum rules one spelling each (§405 tail)

RAID_FIELD_GUARDS and sanitizeRaidItem held two copies of the same
`typeof v === "string" && SET.has(v)` predicate about 100 lines apart. They
already shared the SETS, so the residual drift was narrow -- but no test
can see a drift when every it.each row asserts a chosen value against both
sides at once, and narrow is not absent.

Inverts the dependency the way acceptsRiskScale and acceptsRaidDate already
run: the sanitizer now calls the predicate rather than restating it.

MILESTONE_FIELD_GUARDS.achievedDate is deliberately NOT included.
acceptsPatchDate is wider than sanitizeMilestone's own rule by exactly the
clear carve-out and both sites document that; sharing it there would be a
behaviour change, not a dedup. §405 therefore stays OPEN with that residue.

Behaviour-preserving: test counts unchanged across sanitize-records,
plan.write-path and plan.sanitizer-parity.

Claude-Session: https://[session link removed]
```

---

### Task 13: Register bookkeeping

**Files:**
- Modify: `docs/open-followups.md` (**LF-only** — never edit it with a tool that re-lines)

- [ ] **Step 1: Confirm the numbers still available to this slice**

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```
Expected: 434 (or higher if the peer has landed work). **This slice may mint only 435-449.** A number is reserved only once it is on `origin/main`.

- [ ] **Step 2: Close §394 and §418**

Both close with a `**Status:**` line carrying an ISO date and **an executed command** — `followups-status-check` is BLOCKING. Append ` — CLOSED 2026-09-08` to each heading and update the matching index row between `<!-- INDEX:BEGIN -->` and `<!-- INDEX:END -->`.

★★★ **Do not invent a verification.** `never machine-verified` is a conforming and honest answer where nothing was probed. Cite the command you actually ran:
```
**Status:** 2026-09-08 — closed by the write-path sweep. `npx vitest run --maxWorkers=1
src/app/inline-ai-edit/plan.write-path.test.ts` → EXIT=0, Tests <N> passed. The §394 probe
(delete `dropUnacceptedStakeholderFields` at its call site in `use-register-tools.ts`) now reds:
<N failed / M passed>.
```

- [ ] **Step 3: Restate §405's residue, keeping it OPEN**

§405 does not close — the `MILESTONE_FIELD_GUARDS.achievedDate` carve-out is deliberately out of scope. Update its body to say the three RAID enum rows are done and that the milestone row is the remaining residue, **with the reason**, so a later reader does not "complete the pattern" and ship a behaviour change.

- [ ] **Step 4: File any finding from Task 6 the user chose to CUT rather than fix**

One entry each, numbered from 435. If the user cut nothing, skip this step and say so.

- [ ] **Step 5: Run both blocking register gates**

```bash
npm run followups:index:check > "$SP/idx.log" 2>&1; echo "EXIT=$?" >> "$SP/idx.log"
grep -E "EXIT=" "$SP/idx.log"; tail -20 "$SP/idx.log"
npm run followups:status:check > "$SP/status.log" 2>&1; echo "EXIT=$?" >> "$SP/status.log"
grep -E "EXIT=" "$SP/status.log"; tail -20 "$SP/status.log"
```
Expected `EXIT=0` on both. **Exit 1 is drift** (write the missing rows). **Exit 2 is the gate unable to scan at all** — markers missing or duplicated, either set empty, or under the 50-per-axis floor — and demands the opposite response: a scan that reads nothing passes everything.

- [ ] **Step 6: Verify no CR bytes crept in, then commit**

```bash
node -e "console.log((require('fs').readFileSync('docs/open-followups.md','utf8').match(/\r/g)||[]).length)"
```
Expected: `0`.

```bash
git add docs/open-followups.md
git commit --only docs/open-followups.md -F "$SP/commit-t13.txt"
```

---

### Task 14: Full gate run

**Files:**
- Modify: none

- [ ] **Step 1: The full unit suite**

```bash
npm run test:run > "$SP/full.log" 2>&1; echo "EXIT=$?" >> "$SP/full.log"
grep -E "Test Files|Tests |EXIT=" "$SP/full.log"
```
Expected `EXIT=0`. On a contended machine add `--maxWorkers=4`: at default parallelism an I/O-bound test can starve past its 20s timeout and then pass in isolation in ~8s. **That is contention, not a regression — do not "fix" the test.**

- [ ] **Step 2: Shuffled run at the pinned seed**

```bash
npm run test:shuffle > "$SP/shuffle.log" 2>&1; echo "EXIT=$?" >> "$SP/shuffle.log"
grep -E "Test Files|Tests |EXIT=" "$SP/shuffle.log"
```
Expected `EXIT=0`. This slice adds tests, so this is the only local reproduction of CI's blocking `unit-tests-shuffled` job and it must be run.

- [ ] **Step 3: Coverage floors**

```bash
npm run test:coverage > "$SP/cov.log" 2>&1; echo "EXIT=$?" >> "$SP/cov.log"
grep -E "EXIT=|ERROR|Coverage|threshold" "$SP/cov.log" | head -20
```
Expected `EXIT=0`. `test:run` does **not** enforce the floors, so a fix in Task 7 that touched a coverage-gated source file can be green there and fail the unit job.

- [ ] **Step 4: The remaining blocking gates**

```bash
npx tsc --noEmit; echo "tsc EXIT=$?"
npx eslint --max-warnings=0 src; echo "eslint EXIT=$?"
npm run size:check > "$SP/size2.log" 2>&1; echo "EXIT=$?" >> "$SP/size2.log"; grep -E "EXIT=" "$SP/size2.log"
npm run dup:check > "$SP/dup.log" 2>&1; echo "EXIT=$?" >> "$SP/dup.log"; grep -E "EXIT=|duplicate" "$SP/dup.log"
npm run docs:symbols:check > "$SP/sym.log" 2>&1; echo "EXIT=$?" >> "$SP/sym.log"; grep -E "EXIT=" "$SP/sym.log"
npm run docs:claims:check > "$SP/claims.log" 2>&1; echo "EXIT=$?" >> "$SP/claims.log"; grep -E "EXIT=" "$SP/claims.log"
npm run version:check > "$SP/ver.log" 2>&1; echo "EXIT=$?" >> "$SP/ver.log"; grep -E "EXIT=" "$SP/ver.log"
```
All `EXIT=0`. `version:check` should pass untouched — **this plan bumps no version.**

- [ ] **Step 5: Final tree check**

```bash
git status --short
git log --oneline origin/main..HEAD
```
Expected: the working tree shows only ` M sample-workspace-huge.json` and `?? not-in-use.env.local.bak`, and the commit list contains no mutant residue. Confirm `use-register-tools.ts` appears in **no** commit on this branch:
```bash
git log --oneline --name-only origin/main..HEAD -- src/app/use-register-tools.ts
```
Expected: **empty.** Tasks 10 and 11 mutate that file and revert it; if it appears in a commit, a mutant shipped.

---

## Verification summary

| what | command | expect |
|---|---|---|
| the sweep | `npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.write-path.test.ts` | EXIT=0 |
| its complement | `npx vitest run --maxWorkers=1 src/app/inline-ai-edit/plan.sanitizer-parity.test.ts` | EXIT=0 |
| types | `npx tsc --noEmit` | EXIT=0 (**2** means diagnostics) |
| lint at CI strictness | `npx eslint --max-warnings=0 src` | EXIT=0 |
| test-order independence | `npm run test:shuffle` | EXIT=0 |
| coverage floors | `npm run test:coverage` | EXIT=0 |
| file size | `node -e "console.log(require('fs').readFileSync('src/app/inline-ai-edit/plan.write-path.test.ts','utf8').split('\n').length)"` | < 1600 |
| register gates | `npm run followups:index:check` · `npm run followups:status:check` | EXIT=0 (**2** = gate could not scan) |
| no mutant shipped | `git log --oneline --name-only origin/main..HEAD -- src/app/use-register-tools.ts` | empty |

**No release and no version bump in this plan.** Pushing, opening an MR or merging requires an explicit instruction from the user.
