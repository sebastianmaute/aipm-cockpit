# Version-history completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the version-history registry see all six captured slices, make the three user-authored ones restorable, and stop the emptiness guard reading a documents-only project as an empty transient.

**Architecture:** One registry (`COLLECTION_SPECS` in `version-diff.ts`) drives both `diffWorkspaces` and `applyRestore`. Five rows are added to it; two carry a new `restorable: false` flag so they appear in the diff (which is what arms a capture) but are skipped by the restore (so `applyDocMutation` stays the single writer of document history). Separately, `isEmptyWorkspacePayload` in `use-version-history.ts` gains three user-authored slices.

**Tech Stack:** TypeScript, React 19, Next 16, vitest, Playwright, Turso (libSQL).

**Spec:** `docs/superpowers/specs/2026-08-26-version-history-completeness-design.md` (committed `ed6cfbd0`)

**Branch:** `feat/version-history-completeness`, off `main` at `964c20d1` (0.260.1 "Cho")

---

## Read before starting

- `AGENTS.md` — "Hard constraints". The i18n, byte-stable-serializer and CI-gate rules bite in this plan.
- `docs/AGENTS/documents.md` — why documents own their own version model. This is the whole justification for `restorable: false`.
- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s status. Redirect, echo `$?` unpiped, then grep the file.
- **`src/app/*.ts(x)` is CRLF.** A node anchored write whose pattern uses `\n` silently no-ops; match `\r\n`. `sed -i` re-lines the whole file.
- **Never touch `src/app/i18n.de.ts` with the Edit tool** — it corrupts umlauts and curls quotes. Patch via an anchored node utf8 write.

## File Structure

| File | Change | Responsibility after |
|---|---|---|
| `src/app/version-diff.ts` | modify (120 lines) | Registry + pure diff. Gains `RecordId`, the `restorable` flag, five rows. |
| `src/app/version-restore.ts` | modify (77 lines) | Pure selective restore. Honours `restorable`, hardens `changeKey`. |
| `src/app/use-version-history.ts` | modify | Capture lifecycle. `isEmptyWorkspacePayload` counts three more slices. |
| `src/app/version-diff-view.tsx` | modify (191 lines) | Renders a diff. Non-restorable rows become informational; record checkboxes get row-unique names. |
| `src/app/history-panel.tsx` | modify | Owns selection. Its two auto-select loops skip non-restorable changes. |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | modify | Two new keys, EN + DE. |
| `src/app/version-diff.test.ts` | modify (8 tests) | |
| `src/app/version-restore.test.ts` | modify (11 tests) | Two characterization tests flip; three must stay green. |
| `src/app/use-version-history.test.tsx` | modify | |
| `src/app/version-diff-view.test.tsx` | modify | |
| `e2e/version-history-documents.spec.ts` | **create** | Self-skipping live-Turso proof. |
| `docs/open-followups.md` | modify | §241/§242 partial closes; §254 minted. |

## Scope note discovered during planning

`version-diff-view.tsx` names each record checkbox `aria-label={c.recordLabel}`. `recordLabel`
falls back to `#${id}` (unique) but uses `nameField` when present — so two records sharing a name
render two identically-named checkboxes (WCAG 2.4.6). This is latent today and **this slice makes it
reachable with ordinary data**: two documents titled "Q3 report" is normal, two tasks named "Alpha"
is normal. Task 10 fixes it with `buildRowTokens`/`rowLabel` (`src/app/row-tokens.ts`), the primitive
the row-unique-accessible-names slice built for exactly this. Shipping the new rows without it would
knowingly create the defect.

★ The FIELD checkboxes (`aria-label={f.label}`) collide across two simultaneously-expanded records —
pre-existing, not made worse here. Recorded in Task 13, not fixed.

---

### Task 1: `RecordId` — widen the id type, no behaviour change

**Files:**
- Modify: `src/app/version-diff.ts`
- Test: `src/app/version-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("diffWorkspaces", …)` block in `src/app/version-diff.test.ts`:

```ts
  it("diffs a string-id collection without coercing the id", () => {
    const item = (id: string, name: string) => ({ id, name } as never);
    const c = diffWorkspaces(
      ws({ knowledgeItems: [item("drive!a1", "Old")] }),
      ws({ knowledgeItems: [item("drive!a1", "New")] }),
    );
    expect(c).toHaveLength(1);
    expect(c[0].recordId).toBe("drive!a1");
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/version-diff.test.ts -t "string-id collection" > /tmp/t1.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t1.log
```

Expected: FAIL, `expected [] to have a length of 1`. `knowledgeItems` is not in the registry yet, so
the diff is empty. This test therefore covers Task 1 AND Task 5; it goes green in Task 5.

- [ ] **Step 3: Widen the type**

In `src/app/version-diff.ts`, after the `ChangeType` declaration, add:

```ts
/** A list record's id. Almost every slice mints numbers; `knowledgeItems` ids are
 *  strings (a Graph driveItem id, or a generated one for manual entries), so the
 *  diff must carry both without coercing either. Never do arithmetic on this. */
export type RecordId = number | string;
```

Change `VersionChange.recordId` from `number | null` to `RecordId | null`.

Change `recordLabel`'s signature — its `#${id}` fallback already renders both:

```ts
function recordLabel(rec: Record<string, unknown> | undefined, id: RecordId, nameField?: string): string {
```

In `diffList`, change the map builder and the `base` helper:

```ts
  const byId = (arr: unknown[]) => new Map<RecordId, Record<string, unknown>>(
    arr.map((r) => [(r as { id: RecordId }).id, r as Record<string, unknown>]),
  );
```

```ts
  const base = (id: RecordId, rec: Record<string, unknown> | undefined, type: ChangeType, fields: FieldChange[]): VersionChange => ({
```

- [ ] **Step 4: Typecheck — the widening must not break a consumer**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0. ★ `tsc` exits **2** on diagnostics, not 1. If it reports an error in
`version-restore.ts` about `change.recordId as number`, that is expected and Task 2 fixes it — but do
not proceed with a red typecheck; do Task 2 first and commit the two together.

- [ ] **Step 5: Commit**

```bash
git add src/app/version-diff.ts src/app/version-diff.test.ts
git commit --only src/app/version-diff.ts src/app/version-diff.test.ts -m "refactor(version): widen recordId to number | string for string-id slices"
```

---

### Task 2: Harden `changeKey`

**Files:**
- Modify: `src/app/version-restore.ts`
- Test: `src/app/version-restore.test.ts`

`changeKey` builds `` `${collection}:${recordId ?? "_"}` ``. With string ids that is ambiguous, and
both failures are a **silent wrong-record restore** — no crash, no message.

- [ ] **Step 1: Write the failing tests**

Add a new top-level `describe` block at the end of `src/app/version-restore.test.ts`:

```ts
describe("changeKey", () => {
  // Both cases below are silent WRONG-RECORD restores, not crashes: the key is
  // how a selection finds its change, so two records sharing a key means the
  // user reverts one and the other one moves.
  it("keeps two records distinct when a string id contains the separator", () => {
    // `${collection}:${id}` cannot tell these apart: "a:b" in collection "x"
    // and "b" in collection "x:a" both render "x:a:b".
    expect(changeKey("x", "a:b")).not.toBe(changeKey("x:a", "b"));
  });
  it("keeps a string id of \"_\" distinct from the singleton sentinel", () => {
    // `recordId ?? "_"` renders null as "_", so a record literally named "_"
    // collides with its own collection's singleton row.
    expect(changeKey("x", "_")).not.toBe(changeKey("x", null));
  });
  it("still round-trips a plain numeric id and a null", () => {
    expect(changeKey("tasks", 1)).toBe(changeKey("tasks", 1));
    expect(changeKey("tasks", 1)).not.toBe(changeKey("tasks", 2));
    expect(changeKey("project", null)).toBe(changeKey("project", null));
  });
});
```

- [ ] **Step 2: Run and watch the first two fail**

```bash
npx vitest run src/app/version-restore.test.ts -t "changeKey" > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/t2.log
```

Expected: 2 failed, 1 passed. Both failures read `expected 'x:a:b' not to be 'x:a:b'` and
`expected 'x:_' not to be 'x:_'`.

- [ ] **Step 3: Implement**

In `src/app/version-restore.ts`, replace `changeKey` and widen `byId`:

```ts
import type { Workspace } from "./workspace";
import { COLLECTION_SPECS, type RecordId, type VersionChange } from "./version-diff";

/** Selection keyed by changeKey(collection, recordId); value is "all" (whole
 *  record / all changed fields) or an explicit list of field names. */
export type RestoreSelection = Record<string, "all" | string[]>;

/** ★★ NOT a `${collection}:${id}` join, and the reason is a data defect rather
 *  than tidiness. `knowledgeItems` ids are STRINGS, so a raw join is ambiguous
 *  two ways: an id containing the separator makes `x` + `a:b` collide with
 *  `x:a` + `b`, and an id of literally "_" collides with the `null` singleton
 *  sentinel. Either one silently reverts the WRONG record — the selection finds
 *  its change by this key. JSON encoding is unambiguous for both and stays
 *  readable in a devtools inspection.
 *  ★ Keys are built and looked up within ONE session (`RestoreSelection` is
 *  never persisted), so changing this format needs no compatibility shim. */
export function changeKey(collection: string, recordId: RecordId | null): string {
  return JSON.stringify([collection, recordId ?? null]);
}

type Rec = Record<string, unknown>;
const byId = (arr: unknown[]): Map<RecordId, Rec> =>
  new Map((arr ?? []).map((r) => [(r as { id: RecordId }).id, { ...(r as Rec) }]));
```

And in `applyRestore`, replace the cast on line 50 — `const id = change.recordId as number;` becomes:

```ts
        const id = change.recordId as RecordId;
```

- [ ] **Step 4: Run the whole restore suite**

```bash
npx vitest run src/app/version-restore.test.ts > /tmp/t2b.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" /tmp/t2b.log
```

Expected: EXIT=0, all pass. Every existing test builds its selection through `changeKey` itself, so
the format change is invisible to them. If one fails, it hardcoded a key string — fix the test to
call `changeKey`, never re-introduce the join.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/version-restore.ts src/app/version-restore.test.ts
git commit --only src/app/version-restore.ts src/app/version-restore.test.ts -m "fix(version): make changeKey unambiguous for string record ids"
```

---

### Task 3: The `restorable` flag

**Files:**
- Modify: `src/app/version-diff.ts`, `src/app/version-restore.ts`
- Test: `src/app/version-restore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("applyRestore", …)` block in `src/app/version-restore.test.ts`:

```ts
  it("skips a collection marked restorable: false, carrying it from live state", () => {
    // Proven against the REGISTRY, not a stub: `documents` carries
    // `restorable: false` because applyDocMutation owns document history.
    const version = ws({ documents: [doc(1, "Old")] });
    const now = ws({ documents: [doc(1, "New")] });
    const changes = diffWorkspaces(version, now);
    // It IS in the diff — that is what arms a capture for a documents-only session.
    expect(changes.map((c) => c.collection)).toContain("documents");
    expect(changes.find((c) => c.collection === "documents")?.restorable).toBe(false);
    // ...and selecting it anyway is a no-op, not a partial write.
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect((out.documents as readonly { title: string }[])[0].title).toBe("New");
  });
```

★ `doc` and `selectAll` already exist in that file's second `describe` block. Put this test THERE, not
in the first block, or those helpers are out of scope.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/version-restore.test.ts -t "restorable: false" > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```

Expected: FAIL at the first assertion — `documents` is not in the registry yet, so the diff has no
such change. It goes green in Task 6.

- [ ] **Step 3: Add the flag to both types**

In `src/app/version-diff.ts`, extend the two interfaces:

```ts
export interface VersionChange {
  collection: string;
  collectionLabel: string;
  kind: "list" | "singleton";
  recordId: RecordId | null;
  recordLabel: string;
  type: ChangeType;
  fields: FieldChange[];
  /** Mirrors the spec's flag so a renderer can tell an informational row from a
   *  revertible one without importing the registry. */
  restorable?: false;
}
```

```ts
interface CollectionSpec {
  key: keyof Workspace;
  label: string;
  kind: "list" | "singleton";
  nameField?: string;
  /** Omitted = restorable. `false` = diff-visible but `applyRestore` SKIPS it,
   *  because the slice owns its own history elsewhere and must keep a single
   *  writer. The diff row is still required: the diff is what arms a capture,
   *  so without one a session editing only this slice produces NO version. */
  restorable?: false;
}
```

In `diffList`, carry it onto every emitted change — add one line to the `base` helper's object:

```ts
  const base = (id: RecordId, rec: Record<string, unknown> | undefined, type: ChangeType, fields: FieldChange[]): VersionChange => ({
    collection: spec.key, collectionLabel: spec.label, kind: "list",
    recordId: id, recordLabel: recordLabel(rec, id, spec.nameField), type, fields,
    ...(spec.restorable === false ? { restorable: false as const } : {}),
  });
```

- [ ] **Step 4: Honour it in the restore**

In `src/app/version-restore.ts`, add one guard as the first statement of the `COLLECTION_SPECS` loop
in `applyRestore`:

```ts
  for (const spec of COLLECTION_SPECS) {
    // ★★ Diff-visible but NOT restorable. The slice is carried through from
    // `current` untouched — exactly what an absent registry row used to do —
    // because it owns its own history and a second writer would fight it.
    if (spec.restorable === false) continue;
    const key = spec.key as string;
```

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/version-diff.ts src/app/version-restore.ts src/app/version-restore.test.ts
git commit --only src/app/version-diff.ts src/app/version-restore.ts src/app/version-restore.test.ts -m "feat(version): add a restorable flag so a slice can be diffed without being restored"
```

---

### Task 4: Prove the two characterization tests RED before touching them

**Files:**
- Read only. No edits in this task.

Four tests in `src/app/version-restore.test.ts` describe today's behaviour. Adding the rows changes
what two of them assert. **The other two must stay green** — they are bug-class guards, and a plan
that rewrites them destroys the only protection against the array-as-object corruption.

- [ ] **Step 1: Record the pre-change state**

```bash
npx vitest run src/app/version-restore.test.ts > /tmp/t4-before.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4-before.log
```

Expected: EXIT=0, `Tests  14 passed` (11 original + 3 from Task 2). Write the number down.

- [ ] **Step 2: Classify the four, by prediction**

Record which you expect to flip and why, BEFORE running anything in Task 5:

| Test | Prediction |
|---|---|
| "keeps knowledgeItems and insights as ARRAYS through a full restore" | **stays green** — the slices become restorable lists; `result[key] = [...cur.values()]` is an array |
| "still emits both slices when the restored workspace is re-serialized" | **stays green** — still arrays, so `workspaceToJson` still gates on a real `.length` |
| "reverts settingsOverrides but carries the five array slices from live state" | **FLIPS** — three of the five now revert |
| "carries five slices through a short pre-0.259.0 capture and reverts the sixth" | **FLIPS** — the diff is no longer only `settingsOverrides`, and three slices get deleted as "added" |
| "turns no array-typed slice of the workspace into an object" | **stays green** — this is the guard that must survive |

- [ ] **Step 3: No commit** — this task produces a prediction, not a change.

---

### Task 5: The three restorable rows

**Files:**
- Modify: `src/app/version-diff.ts`
- Test: `src/app/version-diff.test.ts`, `src/app/version-restore.test.ts`

- [ ] **Step 1: Add the rows**

In `src/app/version-diff.ts`, insert three rows into `COLLECTION_SPECS`, immediately before the
`settingsOverrides` entry (after the big ★★★ comment, which Task 7 rewrites):

```ts
  { key: "knowledgeItems", label: "Knowledge", kind: "list", nameField: "name" },
  { key: "insights", label: "Insights", kind: "list", nameField: "key" },
  { key: "calendarEvents", label: "Calendar events", kind: "list", nameField: "title" },
```

★ Labels are hardcoded English, matching every existing row — this registry is not i18n'd.
★ `insights` has no human name field; `key` is its dedup key and reads better in a compare view than
the `#${id}` fallback.

- [ ] **Step 1b: Cover the two rows nothing else exercises**

`knowledgeItems` is covered by the Task 1 string-id test and `documents` by the Task 3
restorable test, but nothing yet proves `insights` or `calendarEvents` produce a change. Add to
`src/app/version-diff.test.ts`:

```ts
  it("diffs the remaining captured slices", () => {
    const ins = (id: number, severity: string) => ({ id, key: "milestoneSlip", severity } as never);
    const ev = (id: number, title: string) => ({ id, title } as never);
    const c = diffWorkspaces(
      ws({ insights: [ins(1, "low")], calendarEvents: [ev(1, "Old")] }),
      ws({ insights: [ins(1, "high")], calendarEvents: [ev(1, "New")] }),
    );
    // The label comes from each row nameField: insights key, events title.
    expect(c.map((x) => [x.collection, x.recordLabel]).sort()).toEqual([
      ["calendarEvents", "New"],
      ["insights", "milestoneSlip"],
    ]);
  });
```

- [ ] **Step 2: Run the suites and confirm the prediction from Task 4**

```bash
npx vitest run src/app/version-diff.test.ts src/app/version-restore.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL|✓ src|× " /tmp/t5.log | head -30
```

Expected: the Task 1 string-id test now PASSES, and exactly the two predicted tests FAIL. **If a
test you predicted would stay green is red, STOP** — that is the array-as-object corruption
reappearing, not a stale expectation. Do not rewrite it; re-read the `kind` on the row you just added.

- [ ] **Step 3: Re-point the two that flip**

Replace "reverts settingsOverrides but carries the five array slices from live state" with:

```ts
  // The SIX slices `getVersionPayload` captures now split 4/2 at the restore
  // layer: `settingsOverrides` (an object singleton) plus the three
  // user-authored arrays revert, while `documents`/`documentVersions` are
  // diff-visible but carried from live — they own their own history.
  it("reverts settingsOverrides and the user-authored arrays", () => {
    const version = ws({
      settingsOverrides: { timezone: { timezone: "Europe/Berlin" } },
      knowledgeItems: [kItem("a", "Old")],
      insights: [insight(1, "low")],
    });
    const now = ws({
      settingsOverrides: { timezone: { timezone: "UTC" } },
      knowledgeItems: [kItem("a", "New")],
      insights: [insight(1, "high")],
    });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect((out.settingsOverrides as { timezone: { timezone: string } }).timezone.timezone)
      .toBe("Europe/Berlin");
    expect((out.knowledgeItems as readonly { name: string }[])[0].name).toBe("Old");
    expect((out.insights as unknown as readonly { severity: string }[])[0].severity).toBe("low");
  });
```

Replace "carries five slices through a short pre-0.259.0 capture and reverts the sixth" with:

```ts
  // A capture taken before `getVersionPayload` emitted all 24 slices carries
  // NONE of the six, so every live record reads as "added" against it.
  // Restoring it therefore REMOVES the three restorable arrays and leaves the
  // two document slices alone.
  it("removes the restorable arrays on a restore to a short pre-0.259.0 capture", () => {
    const version = ws({});
    const now = ws({
      knowledgeItems: [kItem("a", "Live")],
      insights: [insight(1, "high")],
      documents: [doc(1, "Live")],
      documentVersions: [docVersion(1, "Live")],
      calendarEvents: [calEvent(1, "Live")],
      settingsOverrides: { timezone: { timezone: "Europe/Berlin" } },
    });
    const changes = diffWorkspaces(version, now);
    const out = applyRestore(now, version, changes, selectAll(changes));
    expect({
      knowledgeItems: out.knowledgeItems?.length,
      insights: out.insights?.length,
      calendarEvents: out.calendarEvents?.length,
      documents: out.documents?.length,
      documentVersions: out.documentVersions?.length,
    }).toEqual({
      knowledgeItems: 0, insights: 0, calendarEvents: 0,
      documents: 1, documentVersions: 1,
    });
    expect(out.settingsOverrides).toEqual({});
  });
```

★ This test asserts `documents: 1` before Task 6 adds that row, and passes either way (absent from
the registry it is also carried through). That is intentional: it pins the OUTCOME, which must not
change when the row lands.

- [ ] **Step 4: Green**

```bash
npx vitest run src/app/version-diff.test.ts src/app/version-restore.test.ts > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5b.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/version-diff.ts src/app/version-diff.test.ts src/app/version-restore.test.ts
git commit --only src/app/version-diff.ts src/app/version-diff.test.ts src/app/version-restore.test.ts -m "feat(version): make knowledgeItems, insights and calendarEvents diffable and restorable"
```

---

### Task 6: The two diff-only rows

**Files:**
- Modify: `src/app/version-diff.ts`
- Test: `src/app/version-restore.test.ts` (the Task 3 test goes green here)

- [ ] **Step 1: Add the rows**

Immediately after the three from Task 5:

```ts
  // ★★ DIFF-VISIBLE, NOT RESTORABLE — see the `restorable` docstring on
  // CollectionSpec. `applyDocMutation` owns document history (before-images,
  // tombstones, retention: docs/AGENTS/documents.md); a workspace-level restore
  // would bypass it, minting no before-image while rewriting documentVersions
  // underneath, so one document would have two histories and two writers. The
  // row still has to exist: without it a documents-only session produces an
  // empty diff and `writeVersion` captures NOTHING.
  { key: "documents", label: "Documents", kind: "list", nameField: "title", restorable: false },
  { key: "documentVersions", label: "Document versions", kind: "list", restorable: false },
```

★ `documentVersions` deliberately has no `nameField` — it has no human name, so `recordLabel` falls
back to `#${id}`.

- [ ] **Step 2: Run**

```bash
npx vitest run src/app/version-restore.test.ts src/app/version-diff.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```

Expected: EXIT=0. The Task 3 test ("skips a collection marked restorable: false") now passes for the
right reason: `documents` IS in the diff, carries `restorable: false`, and is not reverted.

- [ ] **Step 3: Mutation-check the guard**

The `continue` in `applyRestore` must be load-bearing. Temporarily delete it, re-run, and confirm the
Task 3 test goes RED with `expected 'Old' to be 'New'`. Then restore it and confirm green again.

```bash
npx vitest run src/app/version-restore.test.ts -t "restorable: false" > /tmp/t6b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6b.log
```

★ `git checkout -- <file>` is DENY-BLOCKED in this repo. Revert the mutant with an inverse anchored
write, then prove `git diff --stat` is empty for that file before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/app/version-diff.ts
git commit --only src/app/version-diff.ts -m "feat(version): give documents and documentVersions a diff-only registry row"
```

---

### Task 7: Rewrite the stale ★★★ comment block

**Files:**
- Modify: `src/app/version-diff.ts`

The block declaring `knowledgeItems` and `insights` "DELIBERATELY ABSENT" is now false — they are
present. **Do not simply delete it.** The corruption it documents is still live for any future array
slice, and that warning is the only record of it.

- [ ] **Step 1: Replace the block**

Replace the whole `// ★★★ \`knowledgeItems\` and \`insights\` are DELIBERATELY ABSENT …` comment (it
sits immediately before the `settingsOverrides` row) with:

```ts
  // ★★★ AN ARRAY SLICE TAKES `kind: "list"`. NEVER `"singleton"` — that is a
  //   silent data-loss bug, not a style choice. A singleton spec routes the key
  //   through `version-restore.ts`'s `mergeFields`, whose `{ ...target }` turns
  //   the array into an OBJECT with numeric keys. `workspaceToJson` then gates
  //   the slice on `.length` — `undefined` on an object — so the key is omitted
  //   and all six write paths drop the slice on the next save, permanently.
  //   It shipped exactly once, when `getVersionPayload` grew to emit all 24
  //   slices and `history-panel`'s Restore button (which auto-selects EVERY
  //   change) could finally reach two mis-declared rows.
  //   Pinned by `version-restore.test.ts`'s "turns no array-typed slice of the
  //   workspace into an object", which names the offending slice in its
  //   diagnostic and is generic over this registry — a new row is covered
  //   without being named.
```

- [ ] **Step 2: Verify nothing else restates the removed claim**

```bash
grep -rn "DELIBERATELY ABSENT\|carried through from the LIVE\|carries the five array" src docs --include=*.ts --include=*.tsx --include=*.md | grep -v "^docs/superpowers/"
```

Expected: no hits outside this branch's own spec. Any hit is prose the behaviour change just
falsified — fix it now, in this commit, not later.

- [ ] **Step 3: Commit**

```bash
git add src/app/version-diff.ts
git commit --only src/app/version-diff.ts -m "docs(version): the absent-rows warning becomes the array-kind rule it always was"
```

---

### Task 8: The emptiness guard

**Files:**
- Modify: `src/app/use-version-history.ts`
- Test: `src/app/use-version-history.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/app/use-version-history.test.tsx`, beside the two existing `isEmptyWorkspacePayload` tests:

```ts
  it("isEmptyWorkspacePayload: false for a project holding only user-authored content", () => {
    // Each of these is a real project shape that captured NO version before:
    // the guard counted nine legacy lists and none of these three.
    expect(isEmptyWorkspacePayload(JSON.stringify({ documents: [{ id: 1, title: "Doc" }] }))).toBe(false);
    expect(isEmptyWorkspacePayload(JSON.stringify({ knowledgeItems: [{ id: "a", name: "K" }] }))).toBe(false);
    expect(isEmptyWorkspacePayload(JSON.stringify({ calendarEvents: [{ id: 1, title: "E" }] }))).toBe(false);
  });
  it("isEmptyWorkspacePayload: true for DERIVED slices alone", () => {
    // ★★ Deliberate, not an oversight. `insights` is written by a DEBOUNCED
    // detect effect whose timer can fire AFTER a project switch has reset the
    // content arrays, and `documentVersions` is derived from `documents`.
    // Counting either would let a stale write mark an empty transient
    // non-empty — re-opening the hole this guard exists to close.
    expect(isEmptyWorkspacePayload(JSON.stringify({ insights: [{ id: 1, key: "x" }] }))).toBe(true);
    expect(isEmptyWorkspacePayload(JSON.stringify({ documentVersions: [{ id: 1, documentId: 1 }] }))).toBe(true);
  });
```

- [ ] **Step 2: Run and watch the first fail**

```bash
npx vitest run src/app/use-version-history.test.tsx -t "isEmptyWorkspacePayload" > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -25 /tmp/t8.log
```

Expected: the "user-authored content" test FAILS (`expected true to be false`); the "DERIVED slices"
test already PASSES. That asymmetry is the point — one is the fix, the other is a guard on not
over-fixing.

- [ ] **Step 3: Implement**

In `src/app/use-version-history.ts`, extend the `lists` array and replace the comment above the
function's `★ Deliberately a SEPARATE …` line:

```ts
// ★ Deliberately a SEPARATE definition — NOT `isWorkspaceEmpty` (which counts
// roles/disciplines/grades and would be defeated by the seeded reference-data).
// ★★ THE RULE FOR ADDING TO THIS LIST: count USER-AUTHORED content, never a
// DERIVED slice. A slice qualifies only if a project-switch transient cannot
// carry it non-empty while the others are empty. Two of the six captured slices
// fail that test and are excluded on purpose:
//   - `insights` is written by a DEBOUNCED detect→reconcile effect
//     (`task-manager.tsx`); a timer armed by the OLD project's inputs can fire
//     after the reset, so counting it would let a stale write mask a transient.
//   - `documentVersions` is derived from `documents` (`workspace-context.tsx`
//     sets both from one loader result), so it adds nothing a `documents` count
//     does not, and inherits the same objection.
// Same reasoning already excludes `activityLog` — see docs/AGENTS/activity-log.md.
export function isEmptyWorkspacePayload(json: string): boolean {
  try {
    // Parse RAW (not jsonToWorkspace, which sanitizes/drops incomplete records) —
    // the guard reflects what the payload literally stores.
    const w = JSON.parse(json) as Record<string, unknown>;
    const lists = [
      "tasks", "raid", "milestones", "stakeholders", "resources",
      "changes", "budgets", "absences", "shifts",
      "knowledgeItems", "documents", "calendarEvents",
    ];
    return lists.every((k) => !Array.isArray(w[k]) || (w[k] as unknown[]).length === 0);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Green**

```bash
npx vitest run src/app/use-version-history.test.tsx > /tmp/t8b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t8b.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-version-history.ts src/app/use-version-history.test.tsx
git commit --only src/app/use-version-history.ts src/app/use-version-history.test.tsx -m "fix(version): count user-authored content in the empty-transient guard"
```

---

### Task 9: i18n for the two new keys

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, beside the other `history*` keys:

```ts
  historyNotRestorable: "Managed per document",
  historySelectRecord: "Select",
```

- [ ] **Step 2: Add the DE keys**

★★★ **Do NOT use the Edit tool on `src/app/i18n.de.ts`** — it corrupts umlauts and curls double
quotes. The file is CRLF, so an anchored write matching `\n` silently no-ops. Patch with node,
matching `\r\n`:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  historyNoChanges:";
if (!s.includes(anchor)) throw new Error("anchor not found");
const add = "  historyNotRestorable: \"Pro Dokument verwaltet\",\r\n  historySelectRecord: \"Auswählen\",\r\n";
s = s.replace(anchor, add + anchor);
fs.writeFileSync(p, s, "utf8");
console.log("ok");
'
```

- [ ] **Step 3: Verify the umlaut survived and parity holds**

```bash
grep -n "historyNotRestorable\|historySelectRecord" src/app/i18n.de.ts
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('has ä:', s.includes('Auswählen'), 'CRLF:', (s.match(/\r\n/g)||[]).length > 0)"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both keys present, `has ä: true`, `CRLF: true`, EXIT=0. `tsc` is what enforces EN/DE key
parity — a missing key fails there, not at runtime.

- [ ] **Step 4: Confirm no ASCII substitutions**

```bash
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t11.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t11.log
```

Expected: EXIT=0. This test BANS `ae`/`oe`/`ue` substitutions for real umlauts.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/i18n.ts src/app/i18n.de.ts -m "i18n: add the non-restorable hint and the record-select verb"
```

---

### Task 10: Non-restorable rows are informational, and record names go row-unique

**Files:**
- Modify: `src/app/version-diff-view.tsx`
- Test: `src/app/version-diff-view.test.tsx`

Two changes in one file. A `restorable: false` row must not offer a checkbox or a "Restore this"
button (both would be silent no-ops), and record checkboxes must stop deriving their accessible name
from a value that repeats.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/version-diff-view.test.tsx`:

```ts
  it("renders a non-restorable row without a checkbox or a restore button", () => {
    const changes: VersionChange[] = [{
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: 1, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
      restorable: false,
    }];
    render(<VersionDiffView lang="en-US" changes={changes} selectable selection={{}}
      onToggleRecord={() => {}} onRestoreRecord={() => {}} />);
    // Selecting it would be a silent no-op: applyRestore skips the collection.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
    expect(screen.getByText(/managed per document/i)).toBeInTheDocument();
  });

  it("gives two same-named records distinct checkbox names", () => {
    const row = (id: number): VersionChange => ({
      collection: "documents", collectionLabel: "Documents", kind: "list",
      recordId: id, recordLabel: "Q3 report", type: "modified",
      fields: [{ field: "title", label: "Title", before: "a", after: "b" }],
    });
    render(<VersionDiffView lang="en-US" changes={[row(1), row(2)]} selectable selection={{}}
      onToggleRecord={() => {}} />);
    expectRowUniqueNames({ roles: ["checkbox"], minControls: 2, requireCollisionSeed: true });
  });
```

Add the imports `import type { VersionChange } from "./version-diff";` and
`import { expectRowUniqueNames } from "../test/row-unique-names";` if absent.

- [ ] **Step 2: Run and watch both fail**

```bash
npx vitest run src/app/version-diff-view.test.tsx -t "non-restorable\|distinct checkbox" > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t9.log
```

Expected: 2 failed. The first finds a checkbox that should not exist; the second reports two controls
both named "Q3 report".

- [ ] **Step 3: Implement**

In `src/app/version-diff-view.tsx`, import the token helpers at the top:

```ts
import { buildRowTokens, rowLabel } from "./row-tokens";
```

Inside the default (non-`sideBySide`) return, replace the `items.map((c) => {` opening so each group
builds a token map first:

```ts
        {[...groups.entries()].map(([label, items]) => {
          // ★★ Row-unique accessible names. `recordLabel` uses the record's
          // nameField, and two documents titled "Q3 report" (or two tasks named
          // "Alpha") are ordinary — so the bare label names two checkboxes
          // identically, a WCAG 2.4.6 fail no gate in this repo can see. A
          // per-item component cannot fix this: only the list owner can see the
          // siblings, which is why the map is built HERE and threaded down.
          const tokens = buildRowTokens(items.map((c) => ({ id: keyOf(c), name: c.recordLabel })));
          return (
          <div key={label}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
            <ul className="flex flex-col gap-1">
              {items.map((c) => {
                const k = keyOf(c);
                const expandable = c.fields.length > 0;
                const revertible = c.restorable !== false;
```

Gate the checkbox and the restore button on `revertible`, and name the checkbox from the token:

```ts
                    {selectable && revertible && (
                      <Checkbox
                        checked={selection[k] !== undefined}
                        onChange={() => onToggleRecord?.(k)}
                        aria-label={rowLabel(t(lang, "historySelectRecord"), tokens.get(k) ?? c.recordLabel)}
                        className="mr-2"
                      />
                    )}
```

```ts
                    {onRestoreRecord && revertible && (
```

And after the type badge inside the row's header `<div>`, render the hint when it is not revertible:

```ts
                    {!revertible && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {t(lang, "historyNotRestorable")}
                      </span>
                    )}
```

Close the new arrow function — the group map now ends `); })}` instead of `))}`.

- [ ] **Step 4: Green, and mutation-check the token map**

```bash
npx vitest run src/app/version-diff-view.test.tsx > /tmp/t9b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t9b.log
```

Expected: EXIT=0. Then mutate: change `tokens.get(k) ?? c.recordLabel` to just `c.recordLabel` and
confirm the second test goes RED. Revert with an inverse anchored write and prove `git diff --stat`
clean for the file.

- [ ] **Step 5: Commit**

```bash
git add src/app/version-diff-view.tsx src/app/version-diff-view.test.tsx
git commit --only src/app/version-diff-view.tsx src/app/version-diff-view.test.tsx -m "fix(version): make non-restorable rows informational and record names row-unique"
```

---

### Task 11: The selection can never contain a non-restorable key

**Files:**
- Modify: `src/app/history-panel.tsx`
- Test: `src/app/history-panel.test.tsx`

`history-panel` has two loops that select EVERY change. With documents in the diff they would build
keys `applyRestore` ignores, so "Restore this state" would report success having skipped them.

- [ ] **Step 1: Write the failing test**

Add to `src/app/history-panel.test.tsx`:

```ts
  it("omits non-restorable changes from a select-all selection", () => {
    const changes: VersionChange[] = [
      { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1,
        recordLabel: "T1", type: "modified", fields: [] },
      { collection: "documents", collectionLabel: "Documents", kind: "list", recordId: 1,
        recordLabel: "Doc", type: "modified", fields: [], restorable: false },
    ];
    // A selection carrying a key applyRestore skips is a promise the restore
    // cannot keep: it reports success having reverted nothing for that row.
    expect(Object.keys(selectableSelection(changes))).toEqual([changeKey("tasks", 1)]);
  });
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/history-panel.test.tsx -t "non-restorable changes" > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t10.log
```

Expected: FAIL — `selectableSelection` is not exported yet.

★ The test needs `import { selectableSelection } from "./history-panel";`, `import { changeKey } from "./version-restore";` and `import type { VersionChange } from "./version-diff";` — add any that are absent.

- [ ] **Step 3: Extract and use one helper**

In `src/app/history-panel.tsx`, add above the component:

```ts
/** Build an "everything" selection from a diff, EXCLUDING changes the restore
 *  will skip. ★★ Keeping a non-restorable key in the selection makes the restore
 *  claim it reverted a row it silently ignored — the two select-all paths and
 *  the diff view's checkboxes must agree on this or the UI over-promises. */
export function selectableSelection(changes: readonly VersionChange[]): RestoreSelection {
  const sel: RestoreSelection = {};
  for (const c of changes) {
    if (c.restorable === false) continue;
    sel[changeKey(c.collection, c.recordId)] = "all";
  }
  return sel;
}
```

Replace the whole-version restore loop:

```ts
    const sel = selectableSelection(changes);
    await restore(v.id, sel, labelOf(v));
```

and `buildAllSelection`:

```ts
  const buildAllSelection = (): RestoreSelection => selectableSelection(diff ?? []);
```

- [ ] **Step 4: Green**

```bash
npx vitest run src/app/history-panel.test.tsx > /tmp/t10b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t10b.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/history-panel.tsx src/app/history-panel.test.tsx
git commit --only src/app/history-panel.tsx src/app/history-panel.test.tsx -m "fix(version): keep non-restorable changes out of every select-all path"
```

---

### Task 12: The live-Turso e2e

**Files:**
- Create: `e2e/version-history-documents.spec.ts`

- [ ] **Step 1: Read the pattern first**

```bash
sed -n '1,60p' e2e/documents-images-interactive.spec.ts
grep -n "readEnvLocal" e2e/documents-images-interactive.spec.ts
```

Copy its `readEnvLocal()` helper. **Playwright does not load `.env.local` — only Next does**, so
`test.skip(!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL, …)` written the obvious way is always true in
the test process and skips everything even against a live database.

- [ ] **Step 2: Write the spec**

Create `e2e/version-history-documents.spec.ts` with this header and structure:

```ts
// e2e/version-history-documents.spec.ts
// Proves §242: a project holding ONLY documents captures a version. Before this
// slice, `isEmptyWorkspacePayload` counted nine legacy lists and none of the
// document slices, so such a project read as an empty transient and every
// capture was dropped with a `version.skipEmptyTransientCapture` diagnostic.
//
// ★★★ THE GATE IS TWO-PART AND THE SECOND HALF IS AN ASSERTION, NOT A SKIP.
// A suite gated only on a skip condition SKIPS every test and prints as a PASS.
// `playwright.config.ts` sets `reuseExistingServer: !CI`, so this will happily
// attach to a server started before `.env.local` existed — where the config
// never reached the browser and the panel cannot mount. So we assert the
// history panel is live before testing anything through it. A skip is never
// evidence.
//
// ★★★ CREDENTIALS ARE NEVER PRINTED. No value from `.env.local` may be echoed,
// logged, put in an assertion message or embedded in a failure diff — every
// check here is on a BOOLEAN or on observable app behaviour.
//
// ★ CI is permanently silent on this file (open-followups §215: no live Turso
// database in CI). It exists so the claim can be RE-MEASURED by whoever has a
// database, not looked at once.
//
// Run against a fresh server on an isolated port, never the reused one:
//   PORT=3100 npm run dev
//   PORT=3100 npx playwright test e2e/version-history-documents.spec.ts --project=chromium --workers=1
//   PORT=3100 npm run stop
```

The test body: skip when `readEnvLocal()` yields no database URL; navigate to the app; **assert the
History view is reachable and mounted** (the liveness half of the gate); seed a project whose only
content is one document; edit the document; wait past the capture idle; then assert a version row
exists and that no `version.skipEmptyTransientCapture` diagnostic was emitted.

- [ ] **Step 3: Prove it actually runs (not skips) where a database exists**

```bash
PORT=3100 npm run dev > /tmp/dev3100.log 2>&1 &
npx playwright test e2e/version-history-documents.spec.ts --project=chromium --workers=1 > /tmp/t12.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t12.log
PORT=3100 npm run stop
```

Expected where `.env.local` is configured: 1 passed, **0 skipped**. A run reporting "1 skipped" is
NOT a pass — it means the credentials never reached the test process; fix that before continuing.
Where no database is configured, a skip is the correct outcome and the liveness assertion is not
reached.

- [ ] **Step 4: Prove the spec does not break the listing**

```bash
npx playwright test --list > /tmp/t12b.log 2>&1; echo "EXIT=$?"; grep -c "version-history-documents" /tmp/t12b.log
```

Expected: EXIT=0 and a non-zero count. This also proves `e2e/seed.ts`'s module-level sample read still
resolves — a broken path there ENOENTs the whole e2e job in CI.

- [ ] **Step 5: Commit**

```bash
git add e2e/version-history-documents.spec.ts
git commit --only e2e/version-history-documents.spec.ts -m "test(e2e): prove a documents-only project captures a version, against a real database"
```

---

### Task 13: Register and prose

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Close §241 and §242 as PARTIAL — each is a FOUR-place edit**

Neither heading may carry the bare word `CLOSED`: `isClosed()` in
`scripts/followup-claims-lib.mjs` tests for the bare word or a `~~` strike, so a partial entry using
it corrupts the closure witnesses. Every other partial entry in the file says FIXED instead.

For each of §241 and §242, edit all four places:
1. the `## NNN.` heading — append e.g. `— restore half FIXED 2026-08-26, documents deliberately not restorable`
2. the summary-table **status cell** — stays `open`, with the half-status in the description cell
3. the summary-table **anchor** — reslug it from the NEW heading text, or it becomes the file's one broken anchor
4. the **closure witnesses** — they must still agree afterwards

- [ ] **Step 2: Verify all four, every time**

```bash
grep -E "^## [0-9]+\." docs/open-followups.md | grep -c "— CLOSED"
grep -E "^## [0-9]+\." docs/open-followups.md | grep -cE "\bCLOSED\b|~~"
node -e 'const fs=require("fs");const lines=fs.readFileSync("docs/open-followups.md","utf8").split(/\r?\n/);const slug=h=>h.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu,"").replace(/ /g,"-");const heads=new Set();for(const l of lines){const m=l.match(/^## (.+)$/); if(m) heads.add(slug(m[1]));}let bad=[],tot=0;for(const l of lines){const m=l.match(/^\| \[§(\d+)\]\(#([^)]+)\)/); if(!m) continue; tot++; if(!heads.has(m[2])) bad.push("§"+m[1]);}console.log("toc rows:",tot,"broken:",bad.length,bad.join(" "));'
```

Expected: the two counts EQUAL each other, and `broken: 0`.

- [ ] **Step 3: Mint §254**

Append a new entry. Confirm 254 is free first — a number is only reserved once it is on
`origin/main`, and two branches have minted the same one before:

```bash
git fetch --prune origin >/dev/null 2>&1
git show origin/main:docs/open-followups.md | grep -cE "^## 254\."
```

Expected: `0`. Then add:

```markdown
## 254. `documentAssets` is absent from the version capture set entirely

**Status:** open. Filed 2026-08-26 at the close of the version-history-completeness slice, which
deliberately did not fix it.

`getVersionPayload` (`task-manager.tsx`) enumerates its slices literally, and `documentAssets` is not
among them — while the SAVE set in `use-storage-backend.ts` does carry it. So document image bytes
are outside version history at every layer: not captured, not diffed, not restorable.

```bash
grep -n -A 8 "const getVersionPayload" src/app/task-manager.tsx | grep -c documentAssets   # 0
```

Plausibly deliberate — versioning blobs is a different cost question from versioning JSON, and the
asset table is Turso-side with its own lifecycle. But nothing records that decision, so the next
reader cannot tell an omission from a choice. Decide and write it down; do not silently add the row.
```

- [ ] **Step 4: Sweep the prose the behaviour change falsified**

```bash
grep -rn "cannot be restored\|carried through from the LIVE\|carries the five array\|five array slices" docs src --include=*.md --include=*.ts --include=*.tsx | grep -v "^docs/superpowers/"
```

Every hit is a claim about the OLD behaviour. Fix each in this commit. ★ Do not rewrite a DATED
audit snapshot to match today's tree — banner it instead.

- [ ] **Step 5: Run the doc gates and commit**

```bash
npm run docs:claims:check > /tmp/t13.log 2>&1; echo "claims EXIT=$?"; tail -2 /tmp/t13.log
npm run docs:symbols:check > /tmp/t13b.log 2>&1; echo "symbols EXIT=$?"; tail -2 /tmp/t13b.log
git add docs/open-followups.md
git commit --only docs/open-followups.md -m "docs: close the restorable half of 241 and 242, and open 254 for documentAssets"
```

Expected: both EXIT=0. ★ `docs:claims:check` is a RATCHET — it fails on a NEW `path:LINE` citation.
Cite symbols and greps, never line numbers.

---

### Task 14: Full gate sweep

**Files:** none — verification only.

- [ ] **Step 1: Lint (unpiped)**

```bash
npx eslint src; echo "EXIT=$?"
```

Expected: EXIT=0. ★ Never pipe this — `| grep -v notice` reports grep's status, so a pass reads as a
failure and vice versa. ★ Use `npx eslint src`, not `npm run lint`, which exits 1 from gitignored
worktree leftovers.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0 (it exits **2** on diagnostics).

- [ ] **Step 3: Unit suite with coverage floors**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |ERROR|threshold" /tmp/cov.log | head -20
```

Expected: EXIT=0. The floors are BLOCKING in CI and `test:run` does not enforce them. ★ Never run two
vitest processes at once; a red carrying `Failed to start forks worker` is contention, not evidence.

- [ ] **Step 4: The shuffled gate — the only local reproduction of `unit-tests-shuffled`**

```bash
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```

Expected: EXIT=0.

- [ ] **Step 5: Size, duplication, and the axe view that renders this UI**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "size EXIT=$?"; tail -3 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "dup EXIT=$?"; tail -3 /tmp/dup.log
```

Expected: both EXIT=0. ★ History is Turso-gated and NOT in `A11Y_VIEWS`, so the axe gate never
renders this panel — the unit tests in Tasks 10 and 11 are the only coverage this surface will ever
have.

- [ ] **Step 6: No commit** — this task is a gate sweep. Report every exit code.

---

### Task 15: Release — GATED, do not execute without explicit say-so

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

**★★★ STOP. Do not run this task unless the user has said "release" (or equivalent) in their own
words.** No push, no MR, no merge without it.

- [ ] **Step 1: Pick the codename and confirm it is free**

Minor bump to `0.261.0` (user-visible behaviour change). Read the convention in `src/app/version.ts`,
then confirm the chosen name is unused with a NAME-anchored grep — a dash-anchored one reports used
names as free.

- [ ] **Step 2: Bump all nine sites**

`src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE`), `CHANGELOG.md`,
`package.json`, `package-lock.json` (**two** occurrences — root `version` and `packages[""]`),
`README.md` (shields badge: version **and** codename), and the `<!-- Generated: … -->` header on all
five `docs/CODEMAPS/*.md`. **No gate checks five of these.**

- [ ] **Step 3: Write the CHANGELOG entry**

Cover: documents-only and knowledge-only projects now capture versions; knowledge, insights and
calendar events are comparable and restorable; documents appear in the compare view but remain
managed per document; and the string-id restore correctness fix. ★ Never put a
`[session link removed]...` URL in `CHANGELOG.md` or an MR description.

- [ ] **Step 4: Re-run the gate sweep from Task 14 on the release commit**

- [ ] **Step 5: Push, open the MR, poll the pipeline, merge ONLY on green**

Never `--auto-merge`. ★ `glab` 1.114.0 enables auto-merge BY DEFAULT — pass `--auto-merge=false`.
After merging, verify the merge tree against the release commit's tree and confirm the combined diff
is empty (`git diff-tree --cc <merge>`).

---

## Owed after this slice

- **Eye-verify History against a real Turso project.** Task 12's spec makes it re-measurable, but a
  spec that skips in CI is only evidence when someone runs it.
- §219 remains outstanding from earlier work: open a generated `.docx`/`.pptx` in Word or LibreOffice.
