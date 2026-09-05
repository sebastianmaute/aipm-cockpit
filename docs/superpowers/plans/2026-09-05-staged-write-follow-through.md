# Staged-Write Follow-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI staged review card tell the truth about the write it is about to make, and let a staged plan update a row it created in the same turn.

**Architecture:** Six independent defects across four layers — the apply loop (`chat-proposal-apply.ts`), the card and its wiring (`chat-proposal-block.tsx`, `chat-panel.tsx`), the title resolver (`chat-proposal-stage.ts`), and the shared preview engine (`inline-ai-edit/plan.ts` + `entity-descriptor.ts`). Each task is self-contained and commits on its own. The preview-engine tasks (5, 6) are shared with the inline-edit surface, so its tests gate them.

**Tech Stack:** TypeScript, React 19, Next 16, vitest 4, testing-library.

**Spec:** `docs/superpowers/specs/2026-09-05-staged-write-follow-through-design.md`

---

## Read before you start

**Landmines that will cost you a build if you skip them:**

- `npx tsc --noEmit` exits **2** on diagnostics, not 1. Run it after editing ANY test — vitest never typechecks.
- **Never** read a gate's exit code through a pipe. Redirect, `echo "EXIT=$?"` unpiped, then read the file.
- **Never** touch `src/app/i18n.de.ts` with Edit or Write. Patch it with a `.mjs` script written via the Write tool, using `\r\n` anchors and real umlauts (never `\uXXXX` — the `i18n-encoding` test bans ASCII substitutions like `fuer`).
- Every `src/app/*.ts(x)` file is CRLF. A node replace whose anchor uses `\n` is a silent no-op.
- A **missing** test path makes vitest exit **0**. Always confirm the file count in the run output.
- Never run two vitest processes at once. `Failed to start forks worker` means contention, not a broken suite.
- `sample-workspace-big.json` and `sample-workspace-huge.json` are modified in the working tree, are foreign to this slice, and must **never** be committed. Use `git commit --only <paths>` — `git add` does not scope a commit.
- Never use `git commit --amend` (shared worktree).

**Verify a test actually ran.** Every "Expected: FAIL" step below must fail for the stated reason. A test that passes before the implementation is vacuous and proves nothing.

**Set `$LOG` before you run anything.** Every command below redirects to `$LOG/...`.

```bash
LOG=<your session scratchpad directory>
mkdir -p "$LOG" && echo "LOG=$LOG"
```

★★★ **Not `/tmp`.** It is shared across sessions on this machine: a peer's run clobbers your log, and you read their failure as yours. A worse variant has already cost real time — an *unset* variable makes the redirect itself fail, and `$?` then reports the redirect rather than the gate, so a healthy run reads as red. Confirm `echo "LOG=$LOG"` prints a real path before trusting any exit code below.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/app/help-content.ts` | MODIFY — stale count in one comment | 1 |
| `src/app/chat-proposal-stage.ts` | MODIFY — `liveRowTitle` resolves document titles | 2 |
| `src/app/chat-proposal-stage.test.ts` | MODIFY — document-title cases | 2 |
| `src/app/chat-proposal-apply.ts` | MODIFY — `TOKEN_ROW_SOURCE` map, same-plan stamping, `failureKindOf` | 3, 4 |
| `src/app/chat-proposal-apply.test.tsx` | MODIFY — stamping + map-parity + classifier cases | 3, 4 |
| `src/app/chat-proposal-block.tsx` | MODIFY — `ProposalCardRow.failedKind`, four render branches | 4 |
| `src/app/chat-proposal-block.test.tsx` | MODIFY — one case per kind | 4 |
| `src/app/chat-panel.tsx` | MODIFY — stop collapsing the apply result to a bare index set | 4 |
| `src/app/i18n.ts` | MODIFY — three new EN strings | 4 |
| `src/app/i18n.de.ts` | MODIFY (via `.mjs` patch only) — three new DE strings | 4 |
| `src/app/inline-ai-edit/entity-descriptor.ts` | MODIFY — new `textCaps` member on six descriptors | 5 |
| `src/app/inline-ai-edit/plan.ts` | MODIFY — `normalizePreviewValue`, alias projection | 5, 6 |
| `src/app/inline-ai-edit/plan.test.ts` | MODIFY — divergence + alias cases | 5, 6 |
| `src/app/use-chat-dispatcher.undo.test.tsx` | MODIFY — redo legs | 7 |
| `docs/open-followups.md` | MODIFY — close seven entries (370 · 372 · 373 · 374 · 376 · 380 · 381), re-scope 375, file one new | 8 |

No new files. Nothing here crosses the 1600-line size ratchet; check with the command in Task 8 if you extract anything.

---

## Task 1: Fix the stale inline-entity count (§374)

**Files:**
- Modify: `src/app/help-content.ts` (the comment on line 162)

- [ ] **Step 1: Confirm the current text and the real count**

```bash
grep -n "Five entities" src/app/help-content.ts
grep -cE "^  (task|raid|change|milestone|stakeholder|resource): \{" src/app/inline-ai-edit/entity-descriptor.ts
```

Expected: the grep prints line 162 containing `★ Five entities, from \`InlineEntity\``, and the count prints `6`.

- [ ] **Step 2: Make the edit**

Change `Five entities` to `Six entities` on that line. Leave the rest of the comment untouched — its claim about which views the help entry relates to is still true; only the count was stale.

- [ ] **Step 3: Verify**

```bash
grep -n "Six entities" src/app/help-content.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: the grep prints line 162, `EXIT=0` from tsc.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/help-content.ts -m "docs: correct the inline-entity count in help-content

InlineEntity gained \`resource\`, so there are six. The comment's claim
about which views the help entry relates to was and stays true; only its
count was stale. Closes 374.

Claude-Session: https://[session link removed]"
```

---

## Task 2: Name the document in a staged row (§376)

`liveRowTitle` returns `null` for the three `*_document` tools because `TOOL_ENTITY[call.name]` is undefined for them, so the card falls back to the tool name and cannot say WHICH document a row touches. Document chat writes take no undo capture, so this card is the only review they get.

**Files:**
- Modify: `src/app/chat-proposal-stage.ts` (`liveRowTitle`, currently at line 182)
- Test: `src/app/chat-proposal-stage.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/chat-proposal-stage.test.ts`. Match the file's existing import style; `liveRowTitle` is already exported.

```ts
describe("liveRowTitle — document rows", () => {
  const ws = {
    ...emptyWorkspace(),
    documents: [
      { id: 7, title: "Kickoff pack", blocks: [], createdAt: "", updatedAt: "" },
    ],
  } as unknown as Workspace;

  it("names the document an update_document row touches", () => {
    expect(liveRowTitle({ name: "update_document", input: { id: 7 } }, ws)).toBe("Kickoff pack");
  });

  it("names the document a delete_document row removes", () => {
    expect(liveRowTitle({ name: "delete_document", input: { id: 7 } }, ws)).toBe("Kickoff pack");
  });

  it("returns null for an id no document has, so the caller falls back to the tool name", () => {
    expect(liveRowTitle({ name: "delete_document", input: { id: 999 } }, ws)).toBeNull();
  });

  it("returns null for a document whose title is blank, rather than an empty row label", () => {
    const blank = {
      ...emptyWorkspace(),
      documents: [{ id: 8, title: "   ", blocks: [], createdAt: "", updatedAt: "" }],
    } as unknown as Workspace;
    expect(liveRowTitle({ name: "update_document", input: { id: 8 } }, blank)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/chat-proposal-stage.test.ts -t "document rows" > $LOG/t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t2.log
```

Expected: `EXIT=1`, with the first three failing (`expected null to be "Kickoff pack"`). The fourth passes already — that is fine and expected; it pins the blank-title guard you must not break.

- [ ] **Step 3: Implement**

In `src/app/chat-proposal-stage.ts`, add above `liveRowTitle`:

```ts
/** The three document tools address a document by `input.id` but have no
 *  descriptor, so `TOOL_ENTITY` misses them and `liveRowTitle` would fall back
 *  to the bare tool name.
 *
 *  ★★★ THIS IS THE ROW THAT MOST NEEDS A NAME. Document chat writes take NO
 *   undo capture (they recover via `documentVersions` instead), so the staged
 *   card is the only thing between the model and an unreviewed multi-document
 *   rewrite — and it was the row the card could say least about.
 *
 *  ★ Deliberately NOT a `document` entry in `INLINE_DESCRIPTORS`: `blocks` is a
 *   typed union outside `diffFields`' scalar model, so a descriptor would diff
 *   the title alone while implying it diffs more. */
const DOCUMENT_TOOLS: ReadonlySet<string> = new Set([
  "create_document",
  "update_document",
  "delete_document",
]);
```

Then insert this block inside `liveRowTitle`, immediately after `const entity = TOOL_ENTITY[call.name];` and **before** the `if (entity === undefined) return null;` line:

```ts
  if (entity === undefined && DOCUMENT_TOOLS.has(call.name)) {
    const docId = Number((call.input as { id?: unknown }).id);
    if (!Number.isFinite(docId)) return null;
    const found = ws.documents?.find((doc) => doc.id === docId);
    const docTitle = found?.title;
    return typeof docTitle === "string" && docTitle.trim() !== "" ? docTitle : null;
  }
```

★ `create_document` carries no `id` yet, so it takes the `!Number.isFinite` exit and keeps the tool-name fallback. It is in the set anyway so the branch reads as covering the tool family rather than looking like an omission.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/chat-proposal-stage.test.ts > $LOG/t2b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t2b.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` from both; `Test Files  1 passed`.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/chat-proposal-stage.ts src/app/chat-proposal-stage.test.ts -m "feat: name the document a staged row touches

The three *_document tools have no descriptor, so liveRowTitle missed
them and the card rendered a bare tool name for the one row class that
takes no undo capture at all. Resolves the title from ws.documents by
input.id. Closes 376.

Claude-Session: https://[session link removed]"
```

---

## Task 3: Let a staged plan update a row it created (§380)

**Files:**
- Modify: `src/app/chat-proposal-apply.ts`
- Test: `src/app/chat-proposal-apply.test.tsx`

**Background you need.** `describeProposal` never stamps a token on a pending row, and must not: it runs at staging time (T1), before the create has happened, and a provisional id colliding with a live row would be stamped with THAT row's token. So the stamp has to happen in `applyProposal`, after the create resolves. Six full-row getters already exist on `ToolDispatcher` — `getTask`, `getRaidRow`, `getChangeRow`, `getMilestoneRow`, `getStakeholderRow`, `getResourceRow` — and they read the dispatcher's refs, which the writers update **synchronously**. Do **not** source this from `chat-panel`'s `workspaceRef`: it is updated in a `useEffect` and is still pre-create inside the apply loop.

- [ ] **Step 1: Write the failing map-parity test**

Add to `src/app/chat-proposal-apply.test.tsx`:

```ts
describe("TOKEN_ROW_SOURCE", () => {
  it("covers every token-guarded tool", () => {
    const missing = [...TOKEN_REQUIRED_TOOLS].filter((t) => !(t in TOKEN_ROW_SOURCE));
    expect({ missing, guarded: TOKEN_REQUIRED_TOOLS.size }).toEqual({
      missing: [],
      guarded: TOKEN_REQUIRED_TOOLS.size,
    });
  });

  it("names no tool that is not token-guarded", () => {
    const extra = Object.keys(TOKEN_ROW_SOURCE).filter((t) => !TOKEN_REQUIRED_TOOLS.has(t));
    expect({ extra, mapped: Object.keys(TOKEN_ROW_SOURCE).length }).toEqual({
      extra: [],
      mapped: Object.keys(TOKEN_ROW_SOURCE).length,
    });
  });
});
```

★★ Both directions are required and neither is redundant. A one-directional assertion passes against the mutant that matters — a future token-guarded tool added with no map entry, which would fall silently back to the refusal. Each assertion prints the population beside the verdict so an empty `TOKEN_REQUIRED_TOOLS` cannot read as a pass.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx -t "TOKEN_ROW_SOURCE" > $LOG/t3.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |TOKEN_ROW_SOURCE" $LOG/t3.log | head -5
```

Expected: `EXIT=1` — the import of `TOKEN_ROW_SOURCE` does not resolve yet.

- [ ] **Step 3: Add the map**

In `src/app/chat-proposal-apply.ts`, after the `TOKEN_REQUIRED_TOOLS` declaration. Add `import type { TokenEntity } from "./ai-entity-token";` and `import { entityToken } from "./ai-entity-token";` to the existing imports.

```ts
/** Token-guarded tool → how to read its target's FULL stored row, so a row this
 *  same plan created can be stamped with a real token at apply time.
 *
 *  ★★★ THE RESOLVERS ALREADY EXISTED. 380 was filed saying a fix "needs a
 *   per-entity full-row resolver"; six sit on the `ToolDispatcher` this function
 *   already takes, and every token-guarded case in `chat-tools.ts` already calls
 *   its own before `requireToken`. They are the `get*Row` family, distinct from
 *   the `list*`/`create*` family that returns a `*Summary` — which is what makes
 *   the summary-derived-token dead end 380 documents inapplicable here.
 *
 *  ★★★ READ THROUGH THE DISPATCHER, NEVER THROUGH A WORKSPACE PROP. These
 *   getters read the dispatcher's refs, which the writers update SYNCHRONOUSLY
 *   (the reason this loop is sequential and never `Promise.all`).
 *   `chat-panel.tsx`'s `workspaceRef` is updated in a `useEffect`, so inside a
 *   tight apply loop it is still PRE-CREATE: a resolver sourced from it would
 *   stamp a token for a row that is not there yet, and a unit test with a mock
 *   accessor would pass while production failed.
 *
 *  ★★★ THE GUARD THIS STAMPS IS VACUOUS FOR THESE ROWS, DELIBERATELY, AND THAT
 *   IS NOT PROTECTION. The token is read moments before the write, so such a row
 *   can never report `stale`. That is correct rather than a hole: the token
 *   answers "you reviewed state X, has it moved?", and a row that did not EXIST
 *   at review time has no reviewed state and nothing to clobber but what this
 *   same plan just wrote. Do not read the stamped token as evidence the row was
 *   checked against anything. */
export const TOKEN_ROW_SOURCE: Readonly<
  Record<string, { kind: TokenEntity; getRow: (d: ToolDispatcher, id: number) => object | null }>
> = {
  update_task: { kind: "task", getRow: (d, id) => d.getTask(id) },
  set_task_dependencies: { kind: "task", getRow: (d, id) => d.getTask(id) },
  update_raid_item: { kind: "raid", getRow: (d, id) => d.getRaidRow(id) },
  update_change: { kind: "change", getRow: (d, id) => d.getChangeRow(id) },
  update_milestone: { kind: "milestone", getRow: (d, id) => d.getMilestoneRow(id) },
  update_resource: { kind: "resource", getRow: (d, id) => d.getResourceRow(id) },
  update_stakeholder: { kind: "stakeholder", getRow: (d, id) => d.getStakeholderRow(id) },
};
```

- [ ] **Step 4: Run to verify the parity tests pass**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx -t "TOKEN_ROW_SOURCE" > $LOG/t3b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " $LOG/t3b.log
```

Expected: `EXIT=0`, `Tests  2 passed`.

- [ ] **Step 5: Write the failing behaviour test**

Add to the same file. Follow the file's existing dispatcher-stub pattern; the stub must implement `getTask` returning the created task.

```ts
it("applies an update whose target this same plan created", async () => {
  // create_task mints #101; the update row was staged against the provisional
  // id and therefore carries NO expectedToken.
  const created = { id: 101, taskName: "Drafted", status: "To Do" };
  const dispatcher = makeDispatcherStub({
    createTask: () => created,
    getTask: (id: number) => (id === 101 ? created : null),
    updateTask: (id: number, patch: Record<string, unknown>) => ({ ...created, ...patch }),
  });

  const rows = [
    { call: { name: "create_task", input: { taskName: "Drafted" } }, stamped: { name: "create_task", input: { taskName: "Drafted" } }, plan: emptyPlan(), mintedId: 5 },
    { call: { name: "update_task", input: { id: 5, status: "Done" } }, stamped: { name: "update_task", input: { id: 5, status: "Done" } }, plan: emptyPlan(), pendingOn: 0 },
  ];

  const result = await applyProposal({
    dispatcher,
    rows,
    selected: new Set([0, 1]),
    batch: { runBatched: (fn) => fn() },
  });

  expect(result.rows).toEqual([
    { index: 0, ok: true },
    { index: 1, ok: true },
  ]);
});

it("still refuses the row when the created row cannot be read back", async () => {
  const dispatcher = makeDispatcherStub({
    createTask: () => ({ id: 101 }),
    getTask: () => null, // the create landed, the row is unreadable
  });

  const rows = [
    { call: { name: "create_task", input: { taskName: "Drafted" } }, stamped: { name: "create_task", input: { taskName: "Drafted" } }, plan: emptyPlan(), mintedId: 5 },
    { call: { name: "update_task", input: { id: 5, status: "Done" } }, stamped: { name: "update_task", input: { id: 5, status: "Done" } }, plan: emptyPlan(), pendingOn: 0 },
  ];

  const result = await applyProposal({
    dispatcher,
    rows,
    selected: new Set([0, 1]),
    batch: { runBatched: (fn) => fn() },
  });

  expect(result.rows[1]).toEqual({
    index: 1,
    ok: false,
    error: NEW_ROW_TOKEN_UNAVAILABLE_ERROR,
  });
});
```

★★ The second test is the one that stops the refusal being deleted. Removing the guard because the happy path now works would convert a loud, recoverable failure into an untokened write attempt.

- [ ] **Step 6: Run to verify it fails**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx -t "same plan created" > $LOG/t3c.log 2>&1; echo "EXIT=$?"
grep -E "Tests |NEW_ROW_TOKEN" $LOG/t3c.log | head -5
```

Expected: `EXIT=1` — the first test fails with row 1 reporting `ok: false` and `NEW_ROW_TOKEN_UNAVAILABLE_ERROR`. The second already passes; it is the regression pin.

- [ ] **Step 7: Wire the stamping into the apply loop**

In `applyProposal`, the current order is: pending-mint refusal, then the token refusal, then `const call = remapStagedCall(stamped, real);`. Move the `remapStagedCall` line **above** the token-refusal block (the remapped call is what carries the real id), then replace the refusal block with:

```ts
      const call = remapStagedCall(stamped, real);
      // ★★ A pending row is never stamped at describe time (it runs before the
      //  create exists), so the token has to be minted HERE — after the create
      //  resolved and `remapStagedCall` pointed this row at the real id.
      let guarded = call;
      if (
        row.pendingOn !== undefined &&
        TOKEN_REQUIRED_TOOLS.has(call.name) &&
        !hasUsableToken(call)
      ) {
        const source = TOKEN_ROW_SOURCE[call.name];
        const targetId = Number((call.input as { id?: unknown }).id);
        const current =
          source !== undefined && Number.isFinite(targetId)
            ? source.getRow(dispatcher, targetId)
            : null;
        if (current === null) {
          // The create landed but its row cannot be read back, so no honest
          // token exists. Refuse BEFORE `runTool` so the failure cannot reach
          // `requireToken` and inherit the `stale` label.
          applied.push({ index, ok: false, error: NEW_ROW_TOKEN_UNAVAILABLE_ERROR });
          continue;
        }
        guarded = {
          ...call,
          input: { ...call.input, expectedToken: entityToken(source.kind, current) },
        };
      }
      try {
        const result = await runTool(dispatcher, guarded.name, guarded.input);
```

Leave the `namesPendingMint` refusal above it untouched, and leave the rest of the `try`/`catch` unchanged.

- [ ] **Step 8: Run the whole file**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx > $LOG/t3d.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t3d.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` from both, `Test Files  1 passed`.

- [ ] **Step 9: Mutation-prove the map parity**

Delete the `update_stakeholder` line from `TOKEN_ROW_SOURCE`, run the parity tests, confirm RED, then restore it by writing the exact line back and confirm `git diff --stat` is empty for the file.

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx -t "TOKEN_ROW_SOURCE" > $LOG/t3e.log 2>&1; echo "EXIT=$?"
# after restoring:
git diff --stat src/app/chat-proposal-apply.ts
```

Expected: `EXIT=1` with the mutant in place; empty `--stat` after restoring.

- [ ] **Step 10: Update the stale docstring**

`NEW_ROW_TOKEN_UNAVAILABLE_ERROR`'s docstring currently ends "That needs a per-entity full-row resolver and is its own slice." Replace that sentence with:

```
 *   The resolver turned out to already exist — six `get*Row` getters on the
 *   dispatcher — so this refusal now fires ONLY when the created row cannot be
 *   read back. See `TOKEN_ROW_SOURCE` below.
```

- [ ] **Step 11: Commit**

```bash
git commit --only src/app/chat-proposal-apply.ts src/app/chat-proposal-apply.test.tsx -m "feat: let a staged plan update a row it created in the same plan

Stamps a real concurrency token at apply time, resolved through the
full-row getters already on ToolDispatcher, so a create-then-update plan
applies both rows instead of refusing the update. The tool layer is
unchanged and still enforcing.

Read through the dispatcher, never chat-panel's workspaceRef: the
dispatcher's refs update synchronously, the effect-updated ref is still
pre-create inside the apply loop.

The refusal is retained for the case it is now honest about — a create
that landed whose row cannot be read back. Closes 380.

Claude-Session: https://[session link removed]"
```

---

## Task 4: Stop labelling every failure a conflict (§381)

`ProposalCardRow.failed` is one boolean and the card renders `chatProposalFailed` — "Not applied — changed since you reviewed" — for **every** not-ok row. `chat-panel.tsx` collapses the apply result to a set of indices, discarding `AppliedRow.error` and `AppliedRow.stale`.

★★ **Scope note — this covers four outcomes, not the two the entry names.** §381 describes `stale`, `PENDING_MINT_ERROR` and `NEW_ROW_TOKEN_UNAVAILABLE_ERROR`. A fourth exists and is mislabelled by the identical bug: an ordinary dispatcher throw (a sanitizer rejection such as `assigneeEmail is invalid`, a not-found) is caught with `stale: false` and also renders "changed since you reviewed". Fixing three of four would leave the same lie in place, so all four get a truthful string.

**Files:**
- Modify: `src/app/chat-proposal-apply.ts`, `src/app/chat-proposal-block.tsx`, `src/app/chat-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/chat-proposal-apply.test.tsx`, `src/app/chat-proposal-block.test.tsx`

- [ ] **Step 1: Write the failing classifier test**

Add to `src/app/chat-proposal-apply.test.tsx`:

```ts
describe("failureKindOf", () => {
  it("calls a moved target a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, stale: true, error: "x changed" })).toBe("conflict");
  });

  it("calls an uncreated dependency a dependency failure, not a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, error: PENDING_MINT_ERROR })).toBe("dependency");
  });

  it("calls an unreadable new row unreadable, not a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, error: NEW_ROW_TOKEN_UNAVAILABLE_ERROR })).toBe("unreadable");
  });

  it("calls any other dispatcher throw a plain error, not a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, stale: false, error: "assigneeEmail is invalid" })).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx -t "failureKindOf" > $LOG/t4.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1` — `failureKindOf` is not exported yet.

- [ ] **Step 3: Add the classifier**

In `src/app/chat-proposal-apply.ts`:

```ts
/** Which of the four not-ok outcomes a row hit, so the card can say something
 *  true about it.
 *
 *  ★★★ KEYED OFF THE EXPORTED CONSTANTS, NEVER BY MATCHING PROSE. Both refusal
 *   strings are exported precisely so a consumer can recognise the outcome
 *   without string-sniffing a message that may be reworded.
 *
 *  ★★ `stale` IS CHECKED FIRST because it is the only outcome the original card
 *   string was ever right about. Everything else is a row that did not land for
 *   a reason that has nothing to do with concurrency. */
export type ProposalFailureKind = "conflict" | "dependency" | "unreadable" | "error";

export function failureKindOf(row: AppliedRow): ProposalFailureKind {
  if (row.stale === true) return "conflict";
  if (row.error === PENDING_MINT_ERROR) return "dependency";
  if (row.error === NEW_ROW_TOKEN_UNAVAILABLE_ERROR) return "unreadable";
  return "error";
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/chat-proposal-apply.test.tsx -t "failureKindOf" > $LOG/t4b.log 2>&1; echo "EXIT=$?"
grep -E "Tests " $LOG/t4b.log
```

Expected: `EXIT=0`, `Tests  4 passed`.

- [ ] **Step 5: Add the three EN strings**

In `src/app/i18n.ts`, beside the existing `chatProposalFailed`:

```ts
  chatProposalFailedDependency: "Not applied — a row it depends on was not created",
  chatProposalFailedUnreadable: "Not applied — its target could not be read back",
  chatProposalFailedError: "Not applied",
```

Leave `chatProposalFailed` exactly as it is — it stays correct for the `conflict` kind.

- [ ] **Step 6: Add the three DE strings via a .mjs patch**

**Do not use Edit or Write on `src/app/i18n.de.ts`.** Write this script to the scratchpad with the Write tool and run it with node. Note the real umlaut in `abhängt` and the `\r\n` anchors.

```js
import { readFileSync, writeFileSync } from "node:fs";
const FILE = "C:/Projects/aipm-wt-a/src/app/i18n.de.ts";
const src = readFileSync(FILE, "utf8");
const anchor = "  chatProposalFailed:";
const hits = src.split(anchor).length - 1;
if (hits !== 1) { console.error(`anchor matched ${hits} times, expected 1 — not writing`); process.exit(1); }
const line = src.slice(src.indexOf(anchor)).split("\r\n")[0];
const added =
  line + "\r\n" +
  '  chatProposalFailedDependency: "Nicht angewendet — eine Zeile, von der sie abhängt, wurde nicht erstellt",\r\n' +
  '  chatProposalFailedUnreadable: "Nicht angewendet — das Ziel konnte nicht erneut gelesen werden",\r\n' +
  '  chatProposalFailedError: "Nicht angewendet",';
const out = src.replace(line, added);
if (out === src) { console.error("replace was a no-op — not writing"); process.exit(1); }
writeFileSync(FILE, out, "utf8");
const check = readFileSync(FILE, "utf8");
console.log("umlauts=" + (check.match(/[äöüÄÖÜß]/g) || []).length);
console.log("lf_without_cr=" + (check.match(/(?<!\r)\n/g) || []).length);
```

Expected: `lf_without_cr=0`, and `umlauts=` a number **larger than before** the patch (capture the before value by running the same count first).

- [ ] **Step 7: Verify key parity and encoding**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > $LOG/t4c.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t4c.log
```

Expected: `EXIT=0` from both. tsc enforces EN/DE key parity, so a missing DE key fails here.

- [ ] **Step 8: Write the failing card tests**

Add to `src/app/chat-proposal-block.test.tsx`:

```ts
it.each([
  ["conflict", "changed since you reviewed"],
  ["dependency", "a row it depends on was not created"],
  ["unreadable", "could not be read back"],
  ["error", "Not applied"],
] as const)("labels a %s failure with its own string", (kind, expected) => {
  render(
    <ChatProposalBlock
      rows={[{ index: 0, call: { name: "update_task", input: { id: 1 } }, plan: emptyPlan(), title: "A task", failed: true, failedKind: kind }]}
      selected={new Set()}
      onToggleRow={() => {}}
      onApply={() => {}}
      onDiscard={() => {}}
    />,
  );
  expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
});
```

- [ ] **Step 9: Run to verify it fails**

```bash
npx vitest run src/app/chat-proposal-block.test.tsx -t "labels a" > $LOG/t4d.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1` — `failedKind` is not on the type and three of the four strings do not render.

- [ ] **Step 10: Add the field and the render branches**

In `src/app/chat-proposal-block.tsx`, extend `ProposalCardRow` (after `failed`):

```ts
  /** Apply reached this row and it did not land. */
  readonly failed?: boolean;
  /** WHY it did not land. ★★ `failed` still covers EVERY not-ok row —
   *  under-reporting is the worse direction and a row that did not land must
   *  never read as applied — so this narrows the MESSAGE, never the set.
   *  Absent is treated as "conflict", preserving the pre-existing string for
   *  any caller that has not been updated. */
  readonly failedKind?: ProposalFailureKind;
```

Import `ProposalFailureKind` from `./chat-proposal-apply`. Replace the render at the `row.failed &&` site so the key is chosen by kind:

The current markup is `<p className="mt-1 text-xs text-ui-pink-strong">{t(lang, "chatProposalFailed")}</p>`. Keep the element and classes exactly — only the key becomes conditional:

```tsx
      {row.failed && (
        <p className="mt-1 text-xs text-ui-pink-strong">
          {t(
            lang,
            row.failedKind === "dependency"
              ? "chatProposalFailedDependency"
              : row.failedKind === "unreadable"
                ? "chatProposalFailedUnreadable"
                : row.failedKind === "error"
                  ? "chatProposalFailedError"
                  : "chatProposalFailed",
          )}
        </p>
      )}
```

- [ ] **Step 11: Run to verify it passes**

```bash
npx vitest run src/app/chat-proposal-block.test.tsx > $LOG/t4e.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t4e.log
```

Expected: `EXIT=0`.

- [ ] **Step 12: Stop chat-panel collapsing the outcome**

In `src/app/chat-panel.tsx`, change the state field (around line 110) from

```ts
  /** Row indices `applyProposal` reported as not applied. */
  readonly failed: ReadonlySet<number>;
```

to

```ts
  /** Row indices `applyProposal` reported as not applied → WHY.
   *  ★★ A Map, not a Set: the apply path distinguishes four outcomes and
   *  collapsing them here is what made the card call every one a conflict. */
  readonly failed: ReadonlyMap<number, ProposalFailureKind>;
```

Replace line 829's collapse with:

```ts
      const failed = new Map(
        result.rows.filter((r) => !r.ok).map((r) => [r.index, failureKindOf(r)] as const),
      );
```

`selected: failed` on the next line must become `selected: new Set(failed.keys())`. At the site that builds `ProposalCardRow`s, pass `failedKind: p.failed.get(index)` alongside the existing `failed: p.failed.has(index)`.

- [ ] **Step 13: Verify the whole chat surface**

```bash
npx vitest run src/app/chat-panel.test.tsx src/app/chat-proposal-block.test.tsx src/app/chat-proposal-apply.test.tsx > $LOG/t4f.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t4f.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` from both, and **`Test Files  3 passed`** — confirm the count is 3, since a mistyped path exits 0 silently.

- [ ] **Step 14: Commit**

```bash
git commit --only src/app/chat-proposal-apply.ts src/app/chat-proposal-apply.test.tsx src/app/chat-proposal-block.tsx src/app/chat-proposal-block.test.tsx src/app/chat-panel.tsx src/app/i18n.ts src/app/i18n.de.ts -m "fix: stop labelling every refused row a concurrency conflict

The apply path distinguishes four not-ok outcomes and the card threw the
distinction away, telling the user 'changed since you reviewed' for rows
where nothing had changed and inviting the one recovery that cannot work.

failed still covers every not-ok row; it now carries WHICH kind, keyed
off the exported constants rather than by matching prose. Adds three
EN/DE strings. Closes 381.

Claude-Session: https://[session link removed]"
```

---

## Task 5: Make the preview show what Apply will store (§373)

The preview's `after` is `str(input[f])` — `String(v)` with a null/array shim, no trim, no cap, no format check — while Apply runs a sanitizer. `describeEntityCalls`' own docstring already promises the opposite ("so a previewed diff never diverges from what the sanitizer would persist"); this task makes that true.

**Files:**
- Modify: `src/app/inline-ai-edit/entity-descriptor.ts`, `src/app/inline-ai-edit/plan.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/inline-ai-edit/plan.test.ts`, following the file's existing `describeEntityCalls` call style:

```ts
describe("preview matches what Apply stores", () => {
  it("shows a trimmed value, not the raw padded one", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assignee: "  Ada  " } }],
      { descriptor: INLINE_DESCRIPTORS.task, item: { id: 1, assignee: "Ada" }, ws: emptyWorkspace() },
    );
    // "  Ada  " trims to "Ada", which EQUALS the stored value — so there is no
    // change to show at all, and the old code showed a spurious one.
    expect(plan.updates).toEqual([]);
  });

  it("shows the empty string a non-string coerces to, not its String() form", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assignee: 42 } }],
      { descriptor: INLINE_DESCRIPTORS.task, item: { id: 1, assignee: "Ada" }, ws: emptyWorkspace() },
    );
    expect(plan.updates.map((u) => u.after)).toEqual([""]);
  });

  it("clips an over-cap email at the task cap", () => {
    const long = "a".repeat(400) + "@x.com";
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_task", input: { id: 1, assigneeEmail: long } }],
      { descriptor: INLINE_DESCRIPTORS.task, item: { id: 1, assigneeEmail: "old@x.com" }, ws: emptyWorkspace() },
    );
    expect(plan.updates[0].after.length).toBe(320);
  });

  it("clips a stakeholder email at ITS cap, which is not the task one", () => {
    const long = "a".repeat(400) + "@x.com";
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_stakeholder", input: { id: 1, email: long } }],
      { descriptor: INLINE_DESCRIPTORS.stakeholder, item: { id: 1, email: "old@x.com" }, ws: emptyWorkspace() },
    );
    expect(plan.updates[0].after.length).toBe(200);
  });
});
```

★★ The last two are deliberately separate assertions at different numbers. A single shared-cap assumption is the defect — one test covering both caps with the same expected length would pass against exactly the wrong implementation.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "preview matches" > $LOG/t5.log 2>&1; echo "EXIT=$?"
grep -E "Tests " $LOG/t5.log
```

Expected: `EXIT=1`, all four failing.

- [ ] **Step 3: Add `textCaps` to the descriptor type and the six descriptors**

In `src/app/inline-ai-edit/entity-descriptor.ts`, add to the `EntityDescriptor` interface after `numberFields`:

```ts
  /** Text fields whose sanitizer clips at a cap, → that cap.
   *
   *  ★★★ POPULATED FROM THE SANITIZERS' OWN EXPORTED CONSTANTS, NEVER TYPED-OUT
   *   NUMBERS. A literal here is a second copy of a value that lives in
   *   `sanitize-core.ts`, and it goes stale silently the first time that cap
   *   moves — reintroducing the preview/apply divergence this member exists to
   *   close, by the same mechanism.
   *
   *  ★ A field absent from this map is trimmed and non-string-coerced but not
   *   clipped. That is the correct default: those two divergences are universal,
   *   a cap is not. */
  textCaps: Record<string, number>;
```

**The two constants live in different modules** — verified 2026-09-05, and getting this wrong is a build failure:

```ts
import { EMAIL_MAX } from "../sanitize-core";        // 320
import { BUDGET_NAME_MAX } from "../sanitize-entities"; // 200
```

★★ **Check the second import for a cycle before committing to it.** `sanitize-entities.ts` is a large module and `entity-descriptor.ts` may not currently reach it. If `npx tsc --noEmit` or a vitest run reports a cycle, do **not** inline the number — re-export `BUDGET_NAME_MAX` from `sanitize-core.ts` (where `EMAIL_MAX` already lives) and import both from there. Verify with:

```bash
grep -n "^import" src/app/inline-ai-edit/entity-descriptor.ts
grep -n "BUDGET_NAME_MAX" src/app/sanitize-records.ts
```

Expected: the second prints `sanitizeText(o.email, BUDGET_NAME_MAX)` — the stakeholder cap this map must mirror.

Then add to each descriptor:

- `task`: `textCaps: { assigneeEmail: EMAIL_MAX },`
- `raid`: `textCaps: { ownerEmail: EMAIL_MAX },`
- `resource`: `textCaps: { email: EMAIL_MAX },`
- `stakeholder`: `textCaps: { email: BUDGET_NAME_MAX },`
- `change`, `milestone`: `textCaps: {},`

Confirm the constants' names and values first:

```bash
grep -rn "export const EMAIL_MAX\|export const BUDGET_NAME_MAX" src/app/
```

Expected: `sanitize-core.ts` `EMAIL_MAX = 320` and `sanitize-entities.ts` `BUDGET_NAME_MAX = 200`. **If either differs, use the real value and fix the two test expectations in Step 1 to match** — the constant is the source of truth, not this plan.

- [ ] **Step 4: Add the normalizer to plan.ts**

In `src/app/inline-ai-edit/plan.ts`, below `str`:

```ts
/** What Apply will actually store for a text field, so the preview cannot show
 *  a value the sanitizer would change.
 *
 *  ★★★ MIRRORS `sanitizeText`: a non-string becomes `""`, a string is trimmed
 *   and clipped at the field's cap. `str` did none of that, so the card showed
 *   the raw input while Apply stored the sanitized form — diverging on length,
 *   on non-strings and on whitespace.
 *
 *  ★★ THE NON-STRING CASE IS THE EXPENSIVE ONE. `sanitize-entities.ts` writes
 *   `if (email) resource.email = email;`, so an empty result OMITS the key, and
 *   on an update built by spreading the stored row that CLEARS an address the
 *   row already had. The card previewed `old@x.com → 42`; the row ended with no
 *   email at all. */
function normalizePreviewValue(v: unknown, cap: number | undefined): string {
  if (typeof v !== "string") return v == null || Array.isArray(v) ? str(v).trim() : "";
  const trimmed = v.trim();
  return cap === undefined ? trimmed : trimmed.slice(0, cap);
}
```

★ Arrays keep going through `str` (comma-join) because `arrayFields` means "comma-split on Apply" — that path is already correct and must not change.

Then in `describeEntityCalls`, replace line 153:

```ts
        const after = normalizePreviewValue(input[f], d.textCaps[f]);
```

Leave `const before = str(item[f]);` alone — the stored item is already sanitized — and leave the `if (before === after) continue;` line where it is, so a whitespace-only change now correctly shows no diff.

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts > $LOG/t5b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t5b.log
```

Expected: `EXIT=0`.

- [ ] **Step 6: Run the whole inline-edit and staging surface**

This is the blast-radius check — `plan.ts` is shared with the inline-edit surface, which is a gate on this task, not a bystander.

```bash
npx vitest run src/app/inline-ai-edit src/app/chat-proposal-describe.test.ts > $LOG/t5c.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |FAIL" $LOG/t5c.log | head -20
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. **If a test fails asserting an untrimmed or uncapped preview string, that is this fix landing, not a regression** — update the expectation and say so in the commit. If a test fails for any other reason, stop and investigate.

- [ ] **Step 7: Commit**

```bash
git commit --only src/app/inline-ai-edit/entity-descriptor.ts src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts -m "fix: preview the value Apply will store, not the raw input

The preview coerced with String() and no trim, cap or format check while
Apply ran a sanitizer, so the card diverged on length, on non-strings and
on whitespace. The non-string case was the expensive one: an empty result
omits the key, which on a spread update clears an email the row had.

Adds textCaps to EntityDescriptor, populated from the sanitizers' own
exported constants so the two cannot drift. Applies to every diffField,
not just the four email-shaped ones the entry named — trim and
non-string divergence affect all text fields. Closes 373.

Claude-Session: https://[session link removed]"
```

---

## Task 6: Diff a rename sent as the `name` alias (§372)

`name` is a write alias the dispatcher splits into `firstName`/`lastName`. It is not a stored field and is deliberately absent from the `resource` descriptor's `diffFields`, so `update_resource({id, name})` produces no diff, previews as an **empty plan**, and renames the person on apply.

**Files:**
- Modify: `src/app/inline-ai-edit/plan.ts`
- Test: `src/app/inline-ai-edit/plan.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("resource rename sent as the name alias", () => {
  const item = { id: 1, firstName: "Grace", lastName: "Hopper" };

  it("previews the split parts instead of an empty plan", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "Ada Lovelace" } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: emptyWorkspace() },
    );
    expect(plan.updates.map((u) => [u.field, u.before, u.after])).toEqual([
      ["firstName", "Grace", "Ada"],
      ["lastName", "Hopper", "Lovelace"],
    ]);
  });

  it("does not override explicit parts, matching the dispatcher", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "Ada Lovelace", firstName: "Anita" } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: emptyWorkspace() },
    );
    expect(plan.updates.map((u) => [u.field, u.after])).toEqual([["firstName", "Anita"]]);
  });

  it("ignores a blank name, matching the dispatcher", () => {
    const plan = describeEntityCalls(
      [{ type: "tool_use", name: "update_resource", input: { id: 1, name: "   " } }],
      { descriptor: INLINE_DESCRIPTORS.resource, item, ws: emptyWorkspace() },
    );
    expect(plan.updates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts -t "name alias" > $LOG/t6.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1` — the first two fail with `[]`; the third already passes and pins the blank guard.

- [ ] **Step 3: Implement the projection**

Add `import { splitName } from "../resource-foundation";` to `plan.ts`, then insert this immediately before the `for (const f of d.diffFields)` loop in `describeEntityCalls`:

```ts
      // ★★★ THE SPLIT MUST BE THE DISPATCHER'S OWN, AND SO MUST THE PREDICATE.
      //  `name` is a WRITE ALIAS, not a stored field, so it is correctly absent
      //  from `diffFields` — which left an alias-only rename previewing an EMPTY
      //  plan and then renaming the person. Projecting it here closes that.
      //  A second copy of the split rule is exactly how preview and apply
      //  diverge again, which is this whole slice's subject: the four conditions
      //  below mirror `updateResource` in `use-chat-dispatcher.ts` line for line,
      //  including the `typeof … !== "string"` part tests (a JSON `null` is
      //  neither a string nor `undefined`, and `=== undefined` there once
      //  dropped a rename AND wiped the first name).
      let input = b.input as Record<string, unknown>;
      if (
        d.entity === "resource" &&
        typeof input.name === "string" &&
        input.name.trim() !== "" &&
        typeof input.firstName !== "string" &&
        typeof input.lastName !== "string"
      ) {
        input = { ...input, ...splitName(input.name) };
      }
```

If the loop already binds `input` from `b.input`, replace that binding rather than shadowing it.

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/app/inline-ai-edit/plan.test.ts > $LOG/t6b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t6b.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Update the descriptor comment**

`entity-descriptor.ts`'s `resource` block documents the old consequence: "★ CONSEQUENCE: a rename sent as `update_resource({name})` alone produces NO diff and previews as an empty plan." Replace that sentence with:

```
    //     Diffing the parts is the honest form. ★ `describeEntityCalls` projects
    //     an alias-only rename onto the parts before diffing (via the
    //     dispatcher's own `splitName`), so such a rename previews correctly —
    //     see 372.
```

- [ ] **Step 6: Full inline-edit run and commit**

```bash
npx vitest run src/app/inline-ai-edit > $LOG/t6c.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t6c.log
npx tsc --noEmit; echo "EXIT=$?"
```

```bash
git commit --only src/app/inline-ai-edit/plan.ts src/app/inline-ai-edit/plan.test.ts src/app/inline-ai-edit/entity-descriptor.ts -m "fix: preview a resource rename sent as the name alias

update_resource({id, name}) previewed an empty plan and then renamed the
person. The preview now projects the alias onto firstName/lastName using
the dispatcher's own splitName and its exact predicate, so the two cannot
diverge. Closes 372.

Claude-Session: https://[session link removed]"
```

---

## Task 7: Prove the redo direction on AI-captured writes (§370)

The Phase 1 round trips all stop after `undo()`. The undo direction is proved at all 14 capture sites and the redo direction at none.

**Files:**
- Test: `src/app/use-chat-dispatcher.undo.test.tsx`

- [ ] **Step 1: Find the existing round trips**

```bash
grep -n "undo()" src/app/use-chat-dispatcher.undo.test.tsx | head -20
```

- [ ] **Step 2: Add a redo leg to the delete round trip**

Pick the `delete_task` round trip (the §295 arming shape the entry names) and extend it, after its existing post-undo assertions:

```ts
    // ★★ THE REDO DIRECTION, which no AI-capture round trip exercised. A redo of
    //  an AI delete RE-REMOVES rows, which is the arming shape 295 records, so
    //  this asserts the row is gone again rather than merely that redo ran.
    act(() => { redo(); });
    expect(tasksRef.current.find((t) => t.id === deletedId)).toBeUndefined();
```

Bind `redo` from the same hook result the test already destructures `undo` from.

- [ ] **Step 3: Run**

```bash
npx vitest run src/app/use-chat-dispatcher.undo.test.tsx > $LOG/t7.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/t7.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` from both. This test is expected to pass on first run — it closes a coverage asymmetry, not a bug. **Prove it is not vacuous** by temporarily making the redo a no-op and confirming the assertion goes red, then restoring.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/use-chat-dispatcher.undo.test.tsx -m "test: exercise the redo direction on an AI-captured delete

Every Phase 1 round trip stopped after undo(), so the redo direction was
covered at none of the 14 capture sites. Closes 370.

Claude-Session: https://[session link removed]"
```

---

## Task 8: Close the register entries

★★★ **Closing an entry takes four to six places, not one.** `isClosed` reads the TITLE only, so the heading is what the gate sees — but cross-reference anchors in OTHER entries and body claims this slice falsified must move too, or the register starts contradicting itself.

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Find every mention**

```bash
for n in 370 372 373 374 376 380 381; do
  echo "=== $n:"; grep -n "§$n\b\|^## $n\." docs/open-followups.md
done
```

- [ ] **Step 2: Close the six code entries**

For §370, §372, §373, §374, §376, §380, §381: change each heading's trailing `— OPEN` to `— CLOSED 2026-09-05`, and rewrite each `**Status:**` line to name what closed it and the command that shows it. Do **not** delete the bodies — they record mechanisms worth keeping.

★ §380's body says a fix "needs a per-entity full-row resolver and is its own slice". That claim is now false and must be corrected in place, not left standing under a CLOSED heading: the resolvers already existed on the dispatcher.

★ §381's body says "THE FIX IS A SECOND CARD STRING". Record that it took **three**, because an ordinary dispatcher throw was mislabelled by the same bug and the entry did not account for it.

- [ ] **Step 3: Re-scope §375**

§375 stays OPEN — it is the eye-verify, and it is owed until a human performs it. Update its `**Status:**` line to record that §380 and §381 have since been fixed, so the two outcomes it tells the reader to watch for should now behave differently.

- [ ] **Step 4: File the one non-goal**

Add a new entry at the current maximum + 1 for `resource.emails`: `sanitizeEmailList` dedupes against the primary `email` and caps, so a previewed list diverges from the stored one exactly as §373's scalar fields did; `arrayFields` cannot express it (it means "comma-split on Apply"). Mint the number with:

```bash
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

★★ A number is reserved only once it is on `origin/main`. Re-run this against `origin/main` before minting: `git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1`.

- [ ] **Step 5: Run the register gates**

```bash
npm run followups:status:check > $LOG/t8.log 2>&1; echo "EXIT=$?"; tail -3 $LOG/t8.log
npm run docs:claims:check > $LOG/t8b.log 2>&1; echo "EXIT=$?"; tail -2 $LOG/t8b.log
npm run docs:symbols:check > $LOG/t8c.log 2>&1; echo "EXIT=$?"; tail -2 $LOG/t8c.log
```

Expected: `EXIT=0` from all three. Exit **1** from the first is drift (write the Status line); exit **2** means the gate could not scan at all.

- [ ] **Step 6: Commit**

```bash
git commit --only docs/open-followups.md -m "docs(followups): close 370, 372, 373, 374, 376, 380, 381

Corrects two body claims the slice falsified rather than leaving them
standing under CLOSED headings: 380's 'needs a per-entity full-row
resolver' (six already existed on the dispatcher) and 381's 'the fix is a
second card string' (it took three — an ordinary dispatcher throw was
mislabelled by the same bug). 375 stays open; it is owed.

Claude-Session: https://[session link removed]"
```

---

## Task 9: Full local verification

- [ ] **Step 1: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src; echo "LINT_EXIT=$?"
```

Expected: both `0`. Use `npx eslint src`, not `npm run lint` — the latter exits 1 from gitignored leftovers.

- [ ] **Step 2: Unit suite**

```bash
npm run test:run > $LOG/suite.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " $LOG/suite.log
```

Expected: `EXIT=0`. Never pipe this — `| tail` reports tail's status and discards the failure diagnostic.

- [ ] **Step 3: Ratchets**

```bash
npm run size:check > $LOG/size.log 2>&1; echo "SIZE=$?"
npm run version:check > $LOG/ver.log 2>&1; echo "VER=$?"
npm run docs:scripts:check > $LOG/scr.log 2>&1; echo "SCR=$?"
```

Expected: all `0`.

- [ ] **Step 4: Confirm the foreign files are still uncommitted**

```bash
git status --porcelain
```

Expected: exactly `M sample-workspace-big.json` and `M sample-workspace-huge.json`, nothing else.

---

## Task 10: Cold review

★★★ **Six of these entries were filed by the author of the code they describe, who wrote the spec and the plan.** That is the configuration in which a defect in the *justification* survives every gate. Dispatch a reviewer that receives the spec and `git diff origin/main...HEAD` and **not** the conversation that produced them.

- [ ] **Step 1: Dispatch the reviewer with this brief**

> Review this diff against its spec. Your job is to **refute**, not confirm. For each claim in the spec and in each new docstring, ask "what command shows this is true?" and run it. Specifically:
> - Is `TOKEN_ROW_SOURCE` really parity-checked in both directions, and does the test fail when an entry is deleted?
> - Does the same-plan stamping read through the dispatcher and never through a workspace prop?
> - Is `NEW_ROW_TOKEN_UNAVAILABLE_ERROR` still reachable, and is there a test that fails if the refusal is deleted?
> - Does `failed` still cover every not-ok row, or did narrowing the message narrow the set?
> - Does `textCaps` reference the sanitizers' exported constants, or does it contain typed-out numbers?
> - Does the §372 projection call the dispatcher's `splitName` with the dispatcher's exact four-condition predicate?
> - Report any test that would pass against the unfixed code.

- [ ] **Step 2: Fix what it refutes; re-run Task 9.**

---

## Task 11: The owed eye-verify (§375) — performed by the user

Not automatable here: it needs a real model turn against a live Anthropic key. The unit tests render the card from fixture props, so they prove the card's behaviour and nothing about whether a real turn produces those props. No e2e seed can reach it — the axe run seeds file mode, and the card exists only after a model turn.

- [ ] **Step 1: Hand the user this script**

Against `PORT=3100 npm run dev` (never port 3000, and never the user's live-data tab):

1. Provoke a destructive or multi-write turn — e.g. ask the assistant to retitle several tasks and delete one.
2. Confirm the review card renders and lists every row it intends to write.
3. Reject one row another row depends on; confirm the dependent deselects **and disables**.
4. Apply.
5. Confirm **one** undo entry restores every applied update and delete.
6. **New in this slice:** ask for a task to be created and then updated in the same turn. Confirm both rows apply (§380 — this previously refused the update).
7. **New in this slice:** if any row does not land, confirm the label names the real reason and does not say "changed since you reviewed" unless the target genuinely moved (§381).

- [ ] **Step 2: Record the result in §375's Status line, and close it only if steps 1-7 all pass.**

---

## Notes for the implementer

- **Order matters between Tasks 5 and 6** — Task 6 edits the same function Task 5 touches. Do 5 first.
- **Tasks 3 and 4 both edit `chat-proposal-apply.ts`.** Do 3 first; Task 4's classifier depends on the constants Task 3 leaves in place.
- **Tasks 1, 2 and 7 are independent** and can be done in any order.
- If a file you touch approaches 1600 lines, check it with
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"` — `size:check` counts `wc -l` + 1.
