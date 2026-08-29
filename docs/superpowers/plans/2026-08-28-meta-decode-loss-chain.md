# Meta-blob decode loss chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a malformed Turso meta blob from silently destroying every project document, and give the save-time data-loss guards a stated, tested rule for which workspace slices they count.

**Architecture:** Three links, fixed in order. **A** makes eleven silent decode catches emit a diagnostic. **B** reclassifies a decode failure as an INCOMPLETE LOAD and routes it into the existing §103 guard, which already owns the banner, the save lockout and the user escape. **C** states one classification rule over all 20 array-typed `Workspace` slices, widens the two counters accordingly, arms the destructive-save bypass so the widening cannot refuse a legitimate delete, and adds a registry test so a new slice cannot be silently omitted again.

**Tech Stack:** TypeScript, React 19, Next 16, vitest 4, libSQL/Turso.

**Spec:** `docs/superpowers/specs/2026-08-28-meta-decode-loss-chain-design.md`

**Branch:** `fix/meta-decode-loss-chain`, at `f4f865e2` (the spec commit), branched off `main` at `24581bc6`.

---

## Read this before Task 1

**The chain, in one paragraph.** `rowsToWorkspace` decodes twelve meta-blob slices inside `try`/`catch` pairs whose catch bodies are a bare comment. A malformed `documents` blob therefore leaves the slice undefined and says nothing. The load proceeds, because `isWorkspaceEmpty` refuses only a TOTALLY empty read and the entity tables came back populated. The next save runs `DELETE FROM meta` for the dirty table and re-inserts only the rows it has — and an empty `documents` writes no row, so the blob is destroyed. `meta` is dirty whenever ANY of its twelve slices changes reference, and `activityLog` is auto-appended by ordinary use, so **no documents-related action is needed to trigger it**. Neither save guard sees the loss, because `documents` contributes zero to both counters.

**Two facts that will bite you if you skip them.**

1. ★★★ **`src/app/use-storage-backend.ts` is at 799 lines and the ratchet limit is 800.** It is NOT in `docs/baselines/file-sizes.json`, so it has ONE line of headroom and TWO net added lines fail `size:check`. Task 3 extracts a pure function out of it before Task 7 touches it. This is `docs/open-followups.md` §229, and it comes due in this slice. Read the real number with:
   ```bash
   node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
   ```
   `size:check` counts `split("\n").length`, which is `wc -l` **+1**. Budget from the command above, never from `wc -l`.

2. ★★★ **Count the catches by the `catch`, NOT by the comment wording.** Nine say `malformed — leave undefined`; two say `malformed — leave the emptyWorkspace() default` and `malformed — leave default (undefined)`. A grep for the nine-way wording silently exempts two equally-silent catches — the first draft of the spec made exactly that error.

### Non-goals — state these in the MR description too

- NOT fixing §150 (the balanced-stray-quote CSV mislabel).
- NOT fixing §152 beyond the census widening Task 4 requires.
- NOT touching `isWorkspaceEmpty`. Its `documents` inclusion and its `activityLog` exclusion are both already correct and both already reasoned in place.
- NOT adding `insights` to any counter.
- NOT faking an end-to-end live-Turso proof. CI has no database (§215). The whole chain is established by reading code, and the end-to-end verification is recorded as **OWED** in the register, never implied by a green suite.

### Standing constraints for every task

- Every `src/app/*.ts(x)` is **CRLF**. Never patch one with a `\n`-only anchor (a guaranteed silent no-op) and **never use the Write tool on one** — it re-lines the file to LF, which `git diff` cannot show you. `docs/open-followups.md` and `AGENTS.md` are LF-only.
- **Never** touch `src/app/i18n.de.ts` with the Edit tool. Patch it via an anchored node utf8 write matching `\r\n`. Task 7 adds strings, and `tsc` enforces EN/DE key parity.
- **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the file. Put logs in the session scratchpad, never `/tmp` (shared across sessions). Set the log directory once per shell before Task 1 — every task below uses it:
  ```bash
  SCRATCH="C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/<session-id>/scratchpad"
  ```
  A peer session's gate log has overwritten one in a shared `/tmp` before, and the wrong checkout's result was read as this one's.
- **Never run two vitest processes at once.** A vitest red carrying `Failed to start forks worker` is machine contention, not a defect — retry, do not debug it.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1.
- Do not push, open an MR, or merge. Task 13 is gated on the user saying "release".

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/turso-schema.ts` | modify | Task 1 adds `logDiag` to eleven catches; Task 5 accumulates failed slice keys into the diag |
| `src/app/document-model.ts` | modify | Task 5 widens `DocTruncationDiag` with `decodeFailedSlices` |
| `src/app/turso-backend.ts` | modify | Task 6 publishes the failed slices beside `lastLoadTruncation` |
| `src/app/workspace.ts` | modify | Task 6 adds the optional `lastDecodeFailures` field to `StorageBackend` |
| `src/app/use-load-truncation.ts` | modify | Task 2 renames; Task 7 adds the decode-failure cause |
| `src/app/save-guard.ts` | **create** | Task 3 — pure L3 + Layer-B decision, extracted for headroom and for a pure test surface |
| `src/app/save-guard.test.ts` | **create** | Task 3 — unit tests for the extracted decision |
| `src/app/use-storage-backend.ts` | modify | Task 3 calls the extracted function; Task 7 consults the widened guard |
| `src/app/use-load-truncation.test.ts` | modify | Task 4 widens the `reportFor` census with marked exemptions |
| `src/app/workspace-metrics.ts` | modify | Task 9 — the classification and the two widened counters |
| `src/app/workspace-slice-policy.ts` | **create** | Task 10 — the slice registry the counters and the test both read |
| `src/app/workspace-slice-policy.test.ts` | **create** | Task 10 — the forcing function |
| `src/app/documents-panel.tsx` | modify | Task 8 arms `allowDestructiveSave` on the documents delete path |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | modify | Task 7 — one new count string, EN + DE |
| `docs/open-followups.md` | modify | Task 11 — new entry, §98 corrected, §229 closed |

---

### Task 1: Fix A — eleven silent catches emit a diagnostic

**Files:**
- Modify: `src/app/turso-schema.ts`
- Test: `src/app/turso-schema.documents.test.ts`

`logDiag` is NOT currently imported in `turso-schema.ts`. It lives in `src/app/diagnostics.ts`, which imports only `./version` and `./diagnostics-redact` — so there is no import cycle to worry about.

- [ ] **Step 1: Confirm the starting numbers**

```bash
cd /c/Projects/aipm-cockpit
grep -c "// malformed" src/app/turso-schema.ts
grep -c "malformed — leave undefined" src/app/turso-schema.ts
grep -A3 "// malformed" src/app/turso-schema.ts | grep -c diag
```

Expected: `11`, `9`, `0`. If the first number is not 11, STOP and re-derive the list — do not proceed against a stale count.

- [ ] **Step 2: Write the failing test**

Append to `src/app/turso-schema.documents.test.ts`. `metaOnlyResults` is already defined in that file.

```ts
describe("malformed meta blobs are reported, not swallowed", () => {
  it("logs a diagnostic naming the slice that failed to decode", () => {
    const seen: Array<{ level: string; code: string; fields?: Record<string, unknown> }> = [];
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation((level, code, fields) => {
      seen.push({ level, code, fields });
    });
    try {
      const ws = rowsToWorkspace(metaOnlyResults([["documents", "{not json"]]));
      expect(ws.documents).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    const hit = seen.find((e) => e.code === "turso.metaSliceUnreadable");
    expect(hit, "a malformed documents blob must emit turso.metaSliceUnreadable").toBeDefined();
    expect(hit?.level).toBe("error");
    expect(hit?.fields?.slice).toBe("documents");
  });

  it("leaves sibling slices intact when one blob is malformed", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    try {
      const ws = rowsToWorkspace(
        metaOnlyResults([
          ["documents", "{not json"],
          ["insights", JSON.stringify([])],
        ]),
      );
      expect(ws.documents).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
```

Add the import at the top of the file if it is not already there:

```ts
import * as diagnostics from "./diagnostics";
```

- [ ] **Step 3: Run the test and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t1.log"
npx vitest run src/app/turso-schema.documents.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "turso.metaSliceUnreadable|Tests " "$L"
```

Expected: EXIT=1, with the first test failing on `a malformed documents blob must emit turso.metaSliceUnreadable`.

- [ ] **Step 4: Add the import**

`turso-schema.ts` is CRLF. Use the Edit tool (which preserves line endings) — not Write.

Add beside the other imports:

```ts
import { logDiag } from "./diagnostics";
```

- [ ] **Step 5: Give every one of the eleven catches a body**

For each catch, replace the bare comment with a `logDiag` call naming that slice. The slice name is the `key` string the row was found by. Worked example — the `insights` catch becomes:

```ts
  const insRow = rowObjects(byTable.get("meta")).find((r) => r.key === "insights");
  if (insRow?.value) {
    try {
      const ins = sanitizeInsights(JSON.parse(insRow.value));
      if (ins.length) ws.insights = ins;
    } catch (err) {
      // ★★ NOT silent, and NOT a rethrow. The diagnostics ring is the channel
      //    for this loss, exactly as `jsonToWorkspace` does for the same field
      //    ("a user who opens a file and finds no documents has something to
      //    find"). Rethrowing would let ONE corrupt slice discard the whole
      //    workspace, which is the failure that function's own scoping comment
      //    warns against.
      logDiag("error", "turso.metaSliceUnreadable", {
        slice: "insights",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
```

Apply the same shape to all eleven. The `slice` value for each is the row key it looks up: `project_status`, `field_visibility`, `features`, `steering_committee`, `timelog_links`, `knowledge_items`, `insights`, `activityLog`, `documents`, `documentVersions`, `settings_overrides`. Write the full comment block ONCE (on the first catch) and a one-line back-reference on the other ten — eleven copies of a six-line comment is noise the duplication gate will also notice.

- [ ] **Step 6: Verify all eleven now report**

```bash
cd /c/Projects/aipm-cockpit
grep -c "turso.metaSliceUnreadable" src/app/turso-schema.ts
grep -A4 "} catch" src/app/turso-schema.ts | grep -c "logDiag"
```

Expected: `11` from the first command. If it prints fewer, you matched on comment wording rather than on `catch` — go back to Step 1.

- [ ] **Step 7: Run the test and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t1b.log"
npx vitest run src/app/turso-schema.documents.test.ts src/app/turso-schema.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
```

Expected: EXIT=0.

- [ ] **Step 8: Typecheck and lint**

```bash
cd /c/Projects/aipm-cockpit
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app/turso-schema.ts; echo "LINT_EXIT=$?"
```

Expected: both 0. (`tsc` exits **2** on diagnostics, not 1.)

- [ ] **Step 9: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/turso-schema.ts src/app/turso-schema.documents.test.ts
git commit --only src/app/turso-schema.ts src/app/turso-schema.documents.test.ts -F - <<'MSG'
fix(turso): name the meta slice that failed to decode instead of swallowing it

rowsToWorkspace decoded twelve meta-blob slices inside try/catch pairs whose
catch bodies were a bare comment. Eleven such catches existed and none called
diag, though diag was a parameter in scope. A malformed documents blob left the
slice undefined and said nothing, and the load then proceeded because
isWorkspaceEmpty refuses only a totally empty read.

jsonToWorkspace already handles the same field's failure the other way, logging
workspace.documentsDropped under a comment that states the posture: a user who
opens a file and finds no documents has something to find. This follows that
precedent rather than inventing one.

The catch stays a catch. Rethrowing would let one corrupt slice discard the
whole workspace.

Counted by the catch, not by the comment wording: nine say "leave undefined",
two word it differently, and all eleven were equally silent.
MSG
```

---

### Task 2: Rename the guard from "truncated" to "incomplete" — mechanical, zero behaviour change

**Files:**
- Modify: `src/app/use-load-truncation.ts`, `src/app/use-storage-backend.ts`, `src/app/task-manager.tsx`, `src/app/notifications.tsx`
- Modify (tests): `src/app/use-load-truncation.test.ts`, `src/app/use-storage-backend.test.tsx`, `src/app/use-storage-turso-ops.test.ts`, `src/app/task-manager.truncation-banner.test.tsx`

Task 7 gives the guard a SECOND cause. Doing the rename in the same commit as the behaviour change would bury a real diff in a mechanical one, so it lands first and alone.

**Do NOT rename `truncationOps`, `LoadTruncation`, `reportLoadTruncation`, `lastLoadTruncation`, or any `documentsTruncated*` i18n key.** Those stay about truncation specifically, which remains one cause among two. Only the three names that become cause-agnostic are renamed:

| Before | After |
|---|---|
| `loadWasTruncated` | `loadWasIncomplete` |
| `mayCommitAfterTruncation` | `mayCommitAfterIncompleteLoad` |
| `allowTruncatedSave` | `allowIncompleteSave` |

- [ ] **Step 1: Record the before-state**

```bash
cd /c/Projects/aipm-cockpit
for s in loadWasTruncated mayCommitAfterTruncation allowTruncatedSave; do
  echo "$s: $(grep -rn "$s" src/app --include=*.ts --include=*.tsx | wc -l) occurrences in $(grep -rln "$s" src/app --include=*.ts --include=*.tsx | wc -l) files"
done
```

Write the numbers down. Step 4 checks that the same totals moved to the new names.

- [ ] **Step 2: Rename, preserving CRLF**

These are all `src/app/*.ts(x)` — CRLF. Use the Edit tool with `replace_all: true` per file, never a `sed -i` (which re-lines the whole file to LF invisibly to `git diff`, because `core.autocrlf=true` cleans it back to the same blob).

Also update the interface member names and their docstrings in `LoadTruncationGuard`, and the `§103` prose that says "truncated load" where it now means either cause. Leave the `§103` history sentences alone — they describe what the guard was built for and that is still true.

- [ ] **Step 3: Verify no stale name survives**

```bash
cd /c/Projects/aipm-cockpit
grep -rn "loadWasTruncated\|mayCommitAfterTruncation\|allowTruncatedSave" src/app --include=*.ts --include=*.tsx
echo "EXIT=$?  (1 = clean; 0 means a stale name survives)"
```

- [ ] **Step 4: Verify the counts carried over**

```bash
cd /c/Projects/aipm-cockpit
for s in loadWasIncomplete mayCommitAfterIncompleteLoad allowIncompleteSave; do
  echo "$s: $(grep -rn "$s" src/app --include=*.ts --include=*.tsx | wc -l)"
done
```

Each total must equal its Step 1 counterpart. A smaller number means a call site was dropped rather than renamed.

- [ ] **Step 5: Prove it is mechanical**

```bash
cd /c/Projects/aipm-cockpit
git diff --stat
L="$SCRATCH/t2.log"
npx vitest run src/app/use-load-truncation.test.ts src/app/use-storage-backend.test.tsx src/app/use-storage-turso-ops.test.ts src/app/task-manager.truncation-banner.test.tsx --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0, and **the same test count as before the rename**. A mechanical rename that changes a test count is not mechanical.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add -u src/app
git commit -F - <<'MSG'
refactor: rename the load guard's three cause-agnostic names to "incomplete"

Truncation is about to stop being the only reason a load is incomplete: a
malformed meta blob leaves a slice undefined, and that must pause saving for the
same reason an over-cap truncation does. The three names that describe the STATE
rather than the CAUSE are renamed ahead of that change so the behavioural diff
lands on its own:

  loadWasTruncated         -> loadWasIncomplete
  mayCommitAfterTruncation -> mayCommitAfterIncompleteLoad
  allowTruncatedSave       -> allowIncompleteSave

truncationOps, LoadTruncation, reportLoadTruncation, lastLoadTruncation and
every documentsTruncated* i18n key keep their names — those stay about
truncation specifically, which remains one cause among two.

Mechanical: no behaviour change, same test count before and after.
MSG
```

---

### Task 3: Extract the save-guard decision — headroom, and a pure test surface

**Files:**
- Create: `src/app/save-guard.ts`
- Create: `src/app/save-guard.test.ts`
- Modify: `src/app/use-storage-backend.ts`

`use-storage-backend.ts` is at **799** lines against a limit of **800**, and is not in the size baseline. Task 7 adds to it, so two net lines would fail `size:check`. This extraction buys the headroom AND gives Task 9's classification tests a pure function to assert against instead of a React hook.

- [ ] **Step 1: Confirm the headroom problem is real**

```bash
cd /c/Projects/aipm-cockpit
node -e "console.log('lines:', require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
node -e "const j=require('./docs/baselines/file-sizes.json');console.log('baseline entry:', j['src/app/use-storage-backend.ts'] ?? '(none)')"
grep -n "^const LIMIT" scripts/check-file-sizes.mjs
```

Expected: `799`, `(none)`, `const LIMIT = 800;`.

- [ ] **Step 2: Write the failing test**

Create `src/app/save-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateSaveGuard } from "./save-guard";

describe("evaluateSaveGuard", () => {
  const base = { prevCollections: 3, prevRecords: 100, curCollections: 3, curRecords: 100, allowDestructive: false };

  it("allows an ordinary save", () => {
    expect(evaluateSaveGuard(base)).toEqual({ refuse: false, forensic: false });
  });

  it("refuses a full wipe of a multi-collection project", () => {
    expect(evaluateSaveGuard({ ...base, curCollections: 0, curRecords: 0 }))
      .toEqual({ refuse: true, forensic: false });
  });

  it("refuses an unexplained mass deletion", () => {
    expect(evaluateSaveGuard({ ...base, curRecords: 4 }))
      .toEqual({ refuse: true, forensic: false });
  });

  it("lets an explicit destructive action through", () => {
    expect(evaluateSaveGuard({ ...base, curCollections: 0, curRecords: 0, allowDestructive: true }))
      .toEqual({ refuse: false, forensic: false });
  });

  it("flags a single-collection full-empty for the forensic trail without refusing", () => {
    expect(evaluateSaveGuard({ ...base, prevCollections: 1, prevRecords: 2, curCollections: 0, curRecords: 0 }))
      .toEqual({ refuse: false, forensic: true });
  });
});
```

- [ ] **Step 3: Run it and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t3.log"
npx vitest run src/app/save-guard.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Cannot find module|Tests " "$L"
```

Expected: EXIT=1, failing to resolve `./save-guard`.

- [ ] **Step 4: Create the module**

Create `src/app/save-guard.ts` (a NEW file — the Write tool is fine here, it has no CRLF to preserve yet; but confirm afterwards that the repo's other `src/app` files' line endings are untouched):

```ts
// src/app/save-guard.ts
//
// The persistence choke point's data-loss decision, extracted from
// use-storage-backend.ts's save effect so it can be tested without a React
// hook — and so that file stays under the 800-line ratchet (it sat at 799 with
// no baseline entry; see docs/open-followups.md §229).
//
// ★ PURE. No clock, no storage, no i18n. The caller owns the baselines, the
//   toast and the forensic record; this answers only "may this save proceed?".

import { isMassDeletion } from "./workspace-metrics";

export interface SaveGuardInput {
  /** Non-empty collection count of the LAST committed workspace. */
  prevCollections: number;
  /** Total record count of the LAST committed workspace. */
  prevRecords: number;
  /** Non-empty collection count of the workspace about to be written. */
  curCollections: number;
  /** Total record count of the workspace about to be written. */
  curRecords: number;
  /** True when the user took an explicit destructive action (clear-all, bulk
   *  delete, delete-all-documents) and armed the one-shot bypass. */
  allowDestructive: boolean;
}

export interface SaveGuardVerdict {
  /** Withhold the save and tell the user. */
  refuse: boolean;
  /** Let the save through, but leave a forensic record — a single-collection
   *  project emptying itself is legitimate often enough that refusing it would
   *  be worse, and rare enough to be worth recording. */
  forensic: boolean;
}

/** L3 + Layer B, the two invariants at the persistence choke point.
 *
 *  L3 — a full wipe of a project that had at least TWO non-empty collections.
 *  Protects small projects, where a record-count fraction is meaningless.
 *
 *  Layer B — an unexplained MASS deletion: at least 5 records removed leaving
 *  at most 10% of the prior total. Protects big projects, catching the
 *  partial-but-catastrophic loss L3 misses. */
export function evaluateSaveGuard(input: SaveGuardInput): SaveGuardVerdict {
  const { prevCollections, prevRecords, curCollections, curRecords, allowDestructive } = input;
  const fullWipe = curCollections === 0 && prevCollections >= 2;
  const massDelete = isMassDeletion(prevRecords, curRecords);
  if ((fullWipe || massDelete) && !allowDestructive) return { refuse: true, forensic: false };
  return { refuse: false, forensic: curCollections === 0 && prevCollections === 1 };
}
```

- [ ] **Step 5: Run the test and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t3b.log"
npx vitest run src/app/save-guard.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$L"
```

Expected: EXIT=0, 5 tests passing.

- [ ] **Step 6: Call it from the save effect**

In `src/app/use-storage-backend.ts` (CRLF — Edit tool), replace the inline `fullWipe`/`massDelete` block with a call. The existing block reads:

```ts
    const fullWipe = curCollections === 0 && prevCollectionCountRef.current >= 2;
    const massDelete = isMassDeletion(prevRecordCountRef.current, curRecords);
    if ((fullWipe || massDelete) && !allowDestructiveRef.current) {
```

Replace through the end of the single-collection forensic branch with:

```ts
    const verdict = evaluateSaveGuard({
      prevCollections: prevCollectionCountRef.current,
      prevRecords: prevRecordCountRef.current,
      curCollections,
      curRecords,
      allowDestructive: allowDestructiveRef.current,
    });
    if (verdict.refuse) {
      recordDataLossEvent({ path: "save-effect", prevCollections: prevCollectionCountRef.current, nextCollections: curCollections, refused: true });
      emitToast("info", t(langRef.current, "storageRefusedWipe"));
      return; // keep baselines so a later change re-evaluates
    }
    if (verdict.forensic) {
      recordDataLossEvent({ path: "save-effect", prevCollections: 1, nextCollections: 0, refused: false });
    }
```

Update the import line: drop `isMassDeletion` if it now has no other use in the file, and add `import { evaluateSaveGuard } from "./save-guard";`.

- [ ] **Step 7: Verify the headroom is real and nothing regressed**

```bash
cd /c/Projects/aipm-cockpit
node -e "console.log('lines now:', require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
L="$SCRATCH/t3c.log"
npm run size:check > "$L" 2>&1; echo "SIZE_EXIT=$?"; tail -3 "$L"
npx vitest run src/app/use-storage-backend.test.tsx src/app/save-guard.test.ts src/app/is-workspace-empty.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: line count comfortably below 799, SIZE_EXIT=0, EXIT=0, TSC_EXIT=0. If the file is still above ~790, extract more before continuing — Task 7 needs the room.

- [ ] **Step 8: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/save-guard.ts src/app/save-guard.test.ts src/app/use-storage-backend.ts
git commit --only src/app/save-guard.ts src/app/save-guard.test.ts src/app/use-storage-backend.ts -F - <<'MSG'
refactor(storage): extract the save-guard decision as a pure function

use-storage-backend.ts sat at 799 lines against the 800-line ratchet with no
baseline entry, so two net added lines would have failed size:check — and the
next commit adds to it. That is docs/open-followups.md §229, now paid.

The extraction is worth more than the headroom: L3 and Layer B were only
reachable through a React effect, so the classification tests that follow could
not assert on the decision directly. evaluateSaveGuard is pure — no clock, no
storage, no i18n — and the caller keeps the baselines, the toast and the
forensic record.

No behaviour change.
MSG
```

---

### Task 4: Widen the `reportFor` census, with marked exemptions

**Files:**
- Modify: `src/app/use-load-truncation.test.ts`
- Modify: `src/app/use-storage-backend.ts` (adds one exemption marker comment)

A source-scanning census in `use-load-truncation.test.ts` catches a load path that forgets to call `reportFor`. It reads a hardcoded `OPS_FILES` of two files, and `use-storage-backend.ts` — which holds three of the six load sites — is not among them.

★★★ **Widening it naively goes RED on correct code.** The unreported load is `onOpenStorageFile`, and its omission is deliberate and documented: that path applies tasks and RAID only, never the loaded documents, so raising the flag would warn about documents the user still has and lowering it would clear a warning still true of the live ones. The census therefore needs a MARKED EXEMPTION, modelled on `ABSENCE_MARKERS` in `scripts/check-agents-symbols.mjs` — a deliberate absence declared NEAR the site, which the scanner honours.

- [ ] **Step 1: Reproduce the blind spot**

```bash
cd /c/Projects/aipm-cockpit
grep -n "OPS_FILES *=" src/app/use-load-truncation.test.ts
for f in src/app/use-storage-backend.ts src/app/use-storage-file-ops.ts src/app/use-storage-turso-ops.ts; do
  echo "$f loads=$(grep -o '\.load()' $f | wc -l) reports=$(grep -o 'reportFor(' $f | wc -l)"
done
```

Expected: `OPS_FILES` holds the file-ops and turso-ops files only; `use-storage-backend.ts` reports `loads=3 reports=2`.

- [ ] **Step 2: Write the failing test**

Add to `src/app/use-load-truncation.test.ts`:

```ts
/** ★★★ THE CENSUS IS THE ONLY THING THAT CATCHES A LOAD PATH FORGETTING TO
 *  REPORT, AND IT USED TO BE BLIND TO HALF OF THEM. `OPS_FILES` listed two
 *  files while `use-storage-backend.ts` held THREE of the six `.load()` sites,
 *  sitting at loads=3 reports=2 and unseen.
 *
 *  ★★ A load MAY legitimately not report — `onOpenStorageFile` applies tasks
 *  and RAID only and never the loaded documents, so raising the flag would warn
 *  about documents the user still has. That is why this is a MARKED exemption
 *  and not a lower expected number: a bare count would be satisfied by any
 *  three-loads-two-reports file, including one that forgot. The marker names
 *  the site, the way ABSENCE_MARKERS does for the symbol gate. */
const CENSUS_FILES = [
  "src/app/use-storage-backend.ts",
  "src/app/use-storage-file-ops.ts",
  "src/app/use-storage-turso-ops.ts",
];
const REPORT_EXEMPT_MARKER = "NO reportFor:";

it.each(CENSUS_FILES)("%s reports for every load it does not explicitly exempt", (file) => {
  const src = readFileSync(file, "utf8");
  const loads = (src.match(/\.load\(\)/g) ?? []).length;
  const reports = (src.match(/reportFor\(/g) ?? []).length;
  const exempt = (src.match(new RegExp(REPORT_EXEMPT_MARKER, "g")) ?? []).length;
  expect(loads, `${file}: no load sites found — the census would be vacuous`).toBeGreaterThan(0);
  expect(
    reports + exempt,
    `${file}: ${loads} load(s), ${reports} report(s), ${exempt} marked exemption(s). ` +
      `Every load must call truncationOps.reportFor, or carry a "${REPORT_EXEMPT_MARKER}" ` +
      `comment at the site saying why it must not.`,
  ).toBe(loads);
});
```

★ The `toBeGreaterThan(0)` is the vacuity guard: without it, a file that stopped loading at all would pass with `0 === 0`.

- [ ] **Step 3: Run it and verify it FAILS on the right file**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t4.log"
npx vitest run src/app/use-load-truncation.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "use-storage-backend.*load|Tests " "$L"
```

Expected: EXIT=1, failing on `use-storage-backend.ts: 3 load(s), 2 report(s), 0 marked exemption(s)`.

- [ ] **Step 4: Mark the deliberate exemption**

In `src/app/use-storage-backend.ts` (CRLF — Edit tool), the `onOpenStorageFile` load already carries its reason in a comment beginning `// ★ NO reportFor:`. Confirm the marker text matches `REPORT_EXEMPT_MARKER` exactly:

```bash
cd /c/Projects/aipm-cockpit
grep -n "NO reportFor:" src/app/use-storage-backend.ts
```

If it prints one line, no edit is needed — the existing comment already IS the marker. If the wording differs, adjust the comment to contain the literal `NO reportFor:` while keeping its existing explanation intact.

- [ ] **Step 5: Run and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t4b.log"
npx vitest run src/app/use-load-truncation.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$L"
```

Expected: EXIT=0.

- [ ] **Step 6: Mutation-check the census**

The census is worthless if it passes with a report removed. Prove it bites:

```bash
cd /c/Projects/aipm-cockpit
# Mutant: neuter one reportFor call in use-storage-turso-ops.ts
node -e "
const fs=require('fs'); const p='src/app/use-storage-turso-ops.ts';
const s=fs.readFileSync(p,'utf8');
const m=s.replace('truncationOps.reportFor(','truncationOps.NOPEreportFor(');
if (m===s) { console.error('ANCHOR MISS - mutant not applied'); process.exit(1); }
fs.writeFileSync(p,m); console.log('mutant applied');
"
L="$SCRATCH/t4mut.log"
npx vitest run src/app/use-load-truncation.test.ts --reporter=dot > "$L" 2>&1; echo "MUTANT_EXIT=$?"
grep -E "use-storage-turso-ops" "$L" | head -2
```

Expected: MUTANT_EXIT=1. **Then revert the mutant immediately** — `git checkout --` is deny-blocked in this environment, so use an inverse anchored write and prove the tree is clean:

```bash
cd /c/Projects/aipm-cockpit
node -e "
const fs=require('fs'); const p='src/app/use-storage-turso-ops.ts';
const s=fs.readFileSync(p,'utf8');
const n=(s.match(/NOPEreportFor\(/g)||[]).length;
if (n!==1) { console.error('EXPECTED EXACTLY 1 MUTANT MARKER, GOT '+n); process.exit(1); }
fs.writeFileSync(p, s.replace('truncationOps.NOPEreportFor(','truncationOps.reportFor('));
console.log('reverted');
"
git diff --stat src/app/use-storage-turso-ops.ts
echo "^ must print NOTHING"
```

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/use-load-truncation.test.ts src/app/use-storage-backend.ts
git commit --only src/app/use-load-truncation.test.ts src/app/use-storage-backend.ts -F - <<'MSG'
test(storage): widen the reportFor census to every load site, with marked exemptions

The census exists to catch a load path that forgets to publish its truncation
signal, and it read a hardcoded two-file list while use-storage-backend.ts held
three of the six load sites — sitting at loads=3 reports=2, unseen.

Widening it naively goes red on correct code: onOpenStorageFile deliberately
does not report, because it applies tasks and RAID only and never the loaded
documents, so raising the flag would warn about documents the user still has.
So the census honours a marked exemption at the site, the way ABSENCE_MARKERS
does for the symbol gate. A bare lower expected count would have been satisfied
by any file with the same ratio, including one that simply forgot.

Carries a vacuity guard: a file with no load sites fails rather than passing on
0 === 0. Mutation-checked — neutering one reportFor call turns it red.

The next commit adds a third signal to reportFor; this is the coverage that
makes that safe.
MSG
```

---

### Task 5: Fix B, part 1 — `rowsToWorkspace` accumulates which slices failed

**Files:**
- Modify: `src/app/document-model.ts`
- Modify: `src/app/turso-schema.ts`
- Test: `src/app/turso-schema.documents.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/turso-schema.documents.test.ts`:

```ts
describe("decode failures are accumulated for the caller", () => {
  it("records the slice key in the diag", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    const diag: DocTruncationDiag = {};
    try {
      rowsToWorkspace(metaOnlyResults([["documents", "{not json"]]), diag);
    } finally {
      spy.mockRestore();
    }
    expect(diag.decodeFailedSlices).toEqual(["documents"]);
  });

  it("records every failing slice, and stays absent when all decode cleanly", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    const bad: DocTruncationDiag = {};
    const good: DocTruncationDiag = {};
    try {
      rowsToWorkspace(metaOnlyResults([["documents", "{not json"], ["insights", "{also not json"]]), bad);
      rowsToWorkspace(metaOnlyResults([["insights", JSON.stringify([])]]), good);
    } finally {
      spy.mockRestore();
    }
    expect(bad.decodeFailedSlices).toEqual(["insights", "documents"]);
    expect(good.decodeFailedSlices).toBeUndefined();
  });
});
```

★ The expected order is the order `rowsToWorkspace` decodes them in, which puts `insights` before `documents`. Verify against the source rather than assuming; if the order differs, fix the expectation, not the code — decode order is not a contract worth pinning.

Add `type DocTruncationDiag` to the file's existing import from `./document-model`.

- [ ] **Step 2: Run and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t5.log"
npx vitest run src/app/turso-schema.documents.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "decodeFailedSlices|Tests " "$L"
```

Expected: EXIT=1 — `decodeFailedSlices` is undefined.

- [ ] **Step 3: Widen the diag type**

In `src/app/document-model.ts` (CRLF — Edit tool):

```ts
export interface DocTruncationDiag {
  truncatedEntries?: number;
  truncatedBlocks?: number;
  /** Meta-blob slices whose stored JSON could not be decoded at all. ★ A
   *  DIFFERENT loss from the two counts above: those record what the CAPS
   *  deliberately discarded, this records what was unreadable. Absent (not
   *  empty) when every slice decoded cleanly, so a caller can distinguish
   *  "nothing failed" from "nobody looked". */
  decodeFailedSlices?: string[];
}
```

- [ ] **Step 4: Accumulate in each catch**

In `src/app/turso-schema.ts`, add a local helper above the meta decoding and call it from all eleven catches alongside the `logDiag` added in Task 1:

```ts
  /** One place to record an unreadable meta slice: the diagnostics ring for the
   *  operator, and the diag accumulator for the load guard. Both, always —
   *  the ring is not reachable from the save path and the accumulator is not
   *  visible to an operator reading logs. */
  const reportUnreadableSlice = (slice: string, err: unknown): void => {
    logDiag("error", "turso.metaSliceUnreadable", {
      slice,
      message: err instanceof Error ? err.message : String(err),
    });
    if (diag) (diag.decodeFailedSlices ??= []).push(slice);
  };
```

Each catch becomes:

```ts
    } catch (err) {
      reportUnreadableSlice("insights", err);
    }
```

This also removes the eleven-fold comment duplication introduced in Task 1 — keep the explanatory comment on `reportUnreadableSlice` itself.

- [ ] **Step 5: Run and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t5b.log"
npx vitest run src/app/turso-schema.documents.test.ts src/app/turso-schema.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/document-model.ts src/app/turso-schema.ts src/app/turso-schema.documents.test.ts
git commit --only src/app/document-model.ts src/app/turso-schema.ts src/app/turso-schema.documents.test.ts -F - <<'MSG'
feat(turso): accumulate which meta slices failed to decode

DocTruncationDiag gains decodeFailedSlices — a different loss from the two
counts beside it, which record what the caps deliberately discarded rather than
what was unreadable. Absent rather than empty when everything decoded, so a
caller can tell "nothing failed" from "nobody looked".

Folds the eleven per-catch comment copies into one reportUnreadableSlice helper
that does both jobs: the diagnostics ring for an operator reading logs, and the
accumulator for the load guard that cannot reach the ring.
MSG
```

---

### Task 6: Fix B, part 2 — the backend publishes it

**Files:**
- Modify: `src/app/workspace.ts` (the `StorageBackend` interface)
- Modify: `src/app/turso-backend.ts`
- Test: `src/app/turso-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/turso-backend.test.ts`, following the existing load-test setup in that file:

```ts
it("publishes the slices whose meta blob could not be decoded", async () => {
  const backend = makeBackendReturning(rowsWithMalformedDocumentsBlob());
  await backend.load();
  expect(backend.lastDecodeFailures).toEqual(["documents"]);
});

it("resets the published failures on a clean load", async () => {
  const backend = makeBackendReturning(rowsWithMalformedDocumentsBlob());
  await backend.load();
  expect(backend.lastDecodeFailures).toEqual(["documents"]);
  backend.__setRows(cleanRows());
  await backend.load();
  expect(backend.lastDecodeFailures).toEqual([]);
});
```

★★ The second test is the one that matters. A stale value is worse than none: every backend already resets `lastLoadTruncation` before any early return for exactly this reason, and the guard's own comment records that a clean load must LOWER the flag. Build the fixtures (`makeBackendReturning`, `rowsWithMalformedDocumentsBlob`, `cleanRows`, `__setRows`) from the patterns already in that test file — do not invent a new harness.

- [ ] **Step 2: Run and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t6.log"
npx vitest run src/app/turso-backend.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "lastDecodeFailures|Tests " "$L"
```

Expected: EXIT=1.

- [ ] **Step 3: Add the interface field**

In `src/app/workspace.ts`, beside `lastLoadTruncation`:

```ts
  /**
   * Optional: which meta-blob slices the LAST {@link load} could not decode at
   * all. Distinct from {@link StorageBackend.lastLoadTruncation}, which counts
   * what the CAPS discarded — this is data that was unreadable.
   *
   * ★★ A backend that leaves this undefined reports no decode failure, and its
   * users lose those slices in silence on the next save. Today only the Turso
   * backend can produce one (meta blobs are a Turso storage detail), but the
   * field is on the interface so a future blob-storing backend inherits the
   * obligation rather than rediscovering it.
   * ★ Reset it on EVERY load before any early return. A stale value pauses
   * saving on a healthy project.
   */
  lastDecodeFailures?: readonly string[];
```

- [ ] **Step 4: Publish it from the Turso backend**

`turso-backend.ts` already has ONE accumulator and ONE publish point, with a comment saying why. Extend that publish rather than adding a second:

```ts
  lastDecodeFailures: readonly string[] = [];
```

and at the existing publish site, beside the `lastLoadTruncation` assignment:

```ts
      this.lastDecodeFailures = diag.decodeFailedSlices ?? [];
```

Also reset it wherever `lastLoadTruncation` is reset at the top of `load()`.

- [ ] **Step 5: Run and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t6b.log"
npx vitest run src/app/turso-backend.test.ts src/app/turso-backend.tenant.test.ts src/app/turso-load-empty.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/workspace.ts src/app/turso-backend.ts src/app/turso-backend.test.ts
git commit --only src/app/workspace.ts src/app/turso-backend.ts src/app/turso-backend.test.ts -F - <<'MSG'
feat(storage): publish which meta slices a load could not decode

StorageBackend gains lastDecodeFailures, beside lastLoadTruncation and distinct
from it: truncation counts what the caps discarded, this names what was
unreadable. Only Turso can produce one today, but the obligation belongs on the
interface so a future blob-storing backend inherits it.

Published from the Turso backend's existing single accumulator and single
publish point, and reset on every load before any early return — a stale value
would pause saving on a healthy project, which is the invariant every backend
already holds for lastLoadTruncation.
MSG
```

---

### Task 7: Fix B, part 3 — the guard pauses saving, and the banner says so

**Files:**
- Modify: `src/app/use-load-truncation.ts`
- Modify: `src/app/notifications.tsx` (the banner must name the magnitude)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-load-truncation.test.ts`, `src/app/task-manager.truncation-banner.test.tsx`

The existing banner text is already cause-agnostic — *"Some of this project's document data could not be opened. Saving is paused to protect your saved project - it still holds everything."* So this needs ONE new count string, not a new banner.

★ **Do not surface raw slice keys to the user.** `documentVersions` and `settings_overrides` are internal identifiers, and a label map for twelve of them is a translation surface nobody asked for. Count them for the user; name them in the diagnostics ring, which is already where the operator channel is.

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-load-truncation.test.ts`:

```ts
it("pauses saving when a load could not decode a slice", () => {
  const { result } = renderHook(() => useLoadTruncation(langRef, showToast, saveCurrent));
  act(() => {
    result.current.truncationOps.reportFor({
      lastLoadTruncation: { entries: 0, blocks: 0 },
      lastImportDroppedRows: 0,
      lastImportUnterminatedQuote: false,
      lastDecodeFailures: ["documents"],
    });
  });
  expect(result.current.loadWasIncomplete).toBe(true);
  expect(result.current.mayCommitAfterIncompleteLoad()).toBe(false);
});

it("a clean load lowers the flag again", () => {
  const { result } = renderHook(() => useLoadTruncation(langRef, showToast, saveCurrent));
  act(() => {
    result.current.truncationOps.reportFor({
      lastLoadTruncation: { entries: 0, blocks: 0 },
      lastImportDroppedRows: 0,
      lastImportUnterminatedQuote: false,
      lastDecodeFailures: ["documents"],
    });
  });
  act(() => {
    result.current.truncationOps.reportFor({
      lastLoadTruncation: { entries: 0, blocks: 0 },
      lastImportDroppedRows: 0,
      lastImportUnterminatedQuote: false,
      lastDecodeFailures: [],
    });
  });
  expect(result.current.loadWasIncomplete).toBe(false);
});

it("the escape hatch releases a decode-failure lockout", () => {
  const { result } = renderHook(() => useLoadTruncation(langRef, showToast, saveCurrent));
  act(() => {
    result.current.truncationOps.reportFor({
      lastLoadTruncation: { entries: 0, blocks: 0 },
      lastImportDroppedRows: 0,
      lastImportUnterminatedQuote: false,
      lastDecodeFailures: ["documents", "insights"],
    });
  });
  expect(result.current.mayCommitAfterIncompleteLoad()).toBe(false);
  act(() => { result.current.allowIncompleteSave(); });
  expect(result.current.loadWasIncomplete).toBe(false);
  expect(result.current.mayCommitAfterIncompleteLoad()).toBe(true);
});
```

★★★ The third test is MANDATORY, not a nicety. A decode failure is stickier than a truncation — the user cannot repair a corrupt blob from inside the app at any cap — so without a reachable escape this ships a permanent save lockout, which the guard's own comment calls a worse defect than the one being fixed.

- [ ] **Step 2: Run and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t7.log"
npx vitest run src/app/use-load-truncation.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$L"
```

Expected: EXIT=1 on all three new tests.

- [ ] **Step 3: Add the i18n strings**

`src/app/i18n.ts` is CRLF — Edit tool. Beside the other `documentsTruncated*` keys:

```ts
  documentsUnreadableWarning: "{0} kinds of saved data could not be read. Saving is paused so nothing is overwritten.",
  documentsUnreadableCount: "{0} kinds of saved data could not be read.",
```

★★ `src/app/i18n.de.ts` must NOT be touched with the Edit tool — it corrupts umlauts and curls double quotes, and the file is CRLF so a `\n` anchor silently no-ops. Patch it with an anchored node utf8 write matching `\r\n`:

```bash
cd /c/Projects/aipm-cockpit
node -e "
const fs=require('fs'); const p='src/app/i18n.de.ts';
const s=fs.readFileSync(p,'utf8');
const anchor='  documentsTruncatedBlocksWarning:';
const i=s.indexOf(anchor);
if (i<0) { console.error('ANCHOR MISS'); process.exit(1); }
const add='  documentsUnreadableWarning: \"{0} Arten gespeicherter Daten konnten nicht gelesen werden. Das Speichern ist pausiert, damit nichts überschrieben wird.\",\r\n  documentsUnreadableCount: \"{0} Arten gespeicherter Daten konnten nicht gelesen werden.\",\r\n';
fs.writeFileSync(p, s.slice(0,i)+add+s.slice(i), 'utf8');
console.log('inserted');
"
grep -c "documentsUnreadable" src/app/i18n.de.ts
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('lone LF:',(s.match(/(?<!\r)\n/g)||[]).length,'| curly quotes:',(s.match(/[“”]/g)||[]).length)"
```

Expected: `2`, then `lone LF: 0 | curly quotes: 0`. A non-zero lone-LF count means the file was re-lined — revert and retry.

- [ ] **Step 4: Teach the guard the second cause**

In `src/app/use-load-truncation.ts` (CRLF — Edit tool), widen the state to a cause union and derive the flag from both:

```ts
  const [truncation, setTruncation] = useState<{ entries: number; blocks: number } | null>(null);
  /** ★★ A SEPARATE state, not a second copy of the flag. The hook's own note
   *  warns against a boolean duplicating the counts — that is about restating
   *  the SAME fact twice. This is a different fact with different data (which
   *  slices, not how many entries), and `loadWasIncomplete` below is the single
   *  derivation over both. */
  const [decodeFailures, setDecodeFailures] = useState<readonly string[] | null>(null);
  const loadWasIncomplete = truncation !== null || decodeFailures !== null;
```

`allowIncompleteSave` clears BOTH:

```ts
  const allowIncompleteSave = () => {
    allowTruncatedSaveRef.current = true;
    lastTruncationRef.current = null;
    setTruncation(null);
    setDecodeFailures(null);
  };
```

And `reportFor` records the new signal, lowering it on a clean load exactly as truncation does:

```ts
    const failed = backend.lastDecodeFailures ?? [];
    if (failed.length === 0) {
      setDecodeFailures(null);
    } else {
      logDiag("error", "workspace.metaSlicesUnreadable", { slices: failed.join(","), count: failed.length });
      showToast("error", t(langRef.current, "documentsUnreadableWarning", failed.length));
      setDecodeFailures(failed);
    }
```

★ Widen `reportFor`'s parameter type to include `"lastDecodeFailures"` in its `Pick<StorageBackend, …>`.

- [ ] **Step 5: Make the banner name the magnitude**

★★★ **WITHOUT THIS STEP THE SECOND i18n KEY IS DEAD AND THE USER IS TOLD
NOTHING.** `TruncationBanner` (`notifications.tsx`) builds `countText` from the
`truncation` prop alone, so on a decode failure — where `truncation` is null —
`countText` is null and the "Save anyway" confirm dialog shows only the generic
body. That dialog is the last thing a user sees before permanently discarding
data, and it would name no magnitude at all.

Expose the count on the guard so the banner can render it. In
`use-load-truncation.ts`, add to `LoadTruncationGuard`:

```ts
  /** How many meta slices the last load could not read, 0 when none. ★ A COUNT,
   *  not the keys: the keys are internal identifiers (`documentVersions`,
   *  `settings_overrides`) and the diagnostics ring already carries them for an
   *  operator. */
  decodeFailureCount: number;
```

returned as `decodeFailureCount: decodeFailures?.length ?? 0`.

Then in `notifications.tsx` (CRLF — Edit tool), take `decodeFailureCount: number`
as a prop and extend the existing ternary, keeping its precedence comment true:

```ts
  const countText =
    truncation != null && truncation.entries > 0
      ? t(lang, "documentsTruncatedEntriesCount", truncation.entries)
      : truncation != null && truncation.blocks > 0
        ? t(lang, "documentsTruncatedBlocksCount", truncation.blocks)
        : decodeFailureCount > 0
          ? t(lang, "documentsUnreadableCount", decodeFailureCount)
          : null;
```

Thread `decodeFailureCount` from wherever `task-manager.tsx` already passes
`truncation` to the banner.

- [ ] **Step 6: Pin the banner text with a test**

Add to `src/app/task-manager.truncation-banner.test.tsx`, following that file's
existing render helper:

```ts
it("names how many kinds of data were unreadable in the save-anyway dialog", async () => {
  const user = userEvent.setup();
  renderBanner({ truncation: null, decodeFailureCount: 2 });
  await user.click(screen.getByRole("button", { name: "Save anyway", exact: true }));
  expect(screen.getByText(/2 kinds of saved data could not be read/)).toBeInTheDocument();
});
```

★ Mutation-check it: revert the ternary's new branch to `: null` and confirm this
test goes RED. A dialog test that passes without the branch pins nothing.

- [ ] **Step 7: Run and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t7b.log"
npx vitest run src/app/use-load-truncation.test.ts src/app/use-storage-backend.test.tsx src/app/task-manager.truncation-banner.test.tsx --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0. TSC is what enforces EN/DE key parity — a DE key missing or misspelled fails here.

- [ ] **Step 8: Check the size ratchet**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t7size.log"
npm run size:check > "$L" 2>&1; echo "SIZE_EXIT=$?"; tail -3 "$L"
```

Expected: 0. If `use-storage-backend.ts` is over, Task 3's extraction was not deep enough — extract more rather than adding a baseline entry.

- [ ] **Step 9: Commit**

```bash
cd /c/Projects/aipm-cockpit
FILES="src/app/use-load-truncation.ts src/app/use-load-truncation.test.ts src/app/notifications.tsx src/app/task-manager.tsx src/app/task-manager.truncation-banner.test.tsx src/app/i18n.ts src/app/i18n.de.ts"
git add $FILES
git commit --only $FILES -F - <<'MSG'
fix(storage): treat an undecodable meta slice as an incomplete load

A malformed meta blob left its slice undefined and the load proceeded, because
isWorkspaceEmpty refuses only a totally empty read. The next save then ran
DELETE FROM meta and re-inserted only the rows it had, destroying the blob —
and meta is dirty whenever any of its twelve slices changes reference, with
activityLog auto-appended by ordinary use, so nothing document-related had to
happen for the loss to land.

This routes the failure into the existing §103 guard rather than inventing a
second mechanism: same banner, same save lockout, same escape hatch. The escape
is the load-bearing part — a decode failure is stickier than a truncation
because the user cannot repair a corrupt blob from inside the app at any cap,
so without a reachable way out this would be a permanent save lockout.

The user is told how many kinds of data were unreadable, not which: the slice
keys are internal identifiers and the diagnostics ring is already the operator
channel. A clean load lowers the flag, as it does for truncation.
MSG
```

---

### Task 8: Arm the destructive-save bypass on the documents delete path

**Files:**
- Modify: `src/app/documents-panel.tsx`
- Test: `src/app/documents-panel.test.tsx`

This MUST land before Task 9 widens `workspaceRecordCount`. Without it, a user deleting five or more of their own documents from a documents-heavy project is told the save was refused.

- [ ] **Step 1: Confirm the gap**

```bash
cd /c/Projects/aipm-cockpit
grep -rn "allowDestructiveSave" src/app/documents-panel.tsx src/app/document-*.tsx
echo "EXIT=$?  (1 = confirmed absent)"
grep -rn "allowDestructiveSave" src/app/use-bulk-operations.ts | head -3
```

The second command shows the established pattern to copy.

- [ ] **Step 2: Write the failing test**

Add to `src/app/documents-panel.test.tsx`:

```ts
it("arms the destructive-save bypass when a document is deleted", async () => {
  const allowDestructiveSave = vi.fn();
  const user = userEvent.setup();
  renderPanel({ allowDestructiveSave });
  await user.click(screen.getByRole("button", { name: "Delete – Steering deck", exact: true }));
  await user.click(screen.getByRole("button", { name: "Delete", exact: true }));
  expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
});
```

★ Match the existing delete-flow test in that file for the confirm-dialog steps and for `renderPanel`'s prop shape — do not invent a harness. Use `exact: true` on every `getByRole` name in this repo's tests where a per-row control could collide.

- [ ] **Step 3: Run and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t8.log"
npx vitest run src/app/documents-panel.test.tsx --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "allowDestructiveSave|Tests " "$L"
```

Expected: EXIT=1.

- [ ] **Step 4: Thread and call it**

Add `allowDestructiveSave?: () => void` to the panel's props, thread it from `workspace-section.tsx` and `task-manager.tsx` the way the bulk-operations path already receives it, and call it in `handleDelete` immediately before the mutation:

```ts
    // ★★ Arm the one-shot destructive-save bypass. Documents now count toward
    //    workspaceRecordCount, so deleting several in one debounce window is a
    //    mass deletion by Layer B's arithmetic — and this IS the explicit user
    //    action the bypass exists for. Without it the widening refuses a
    //    legitimate delete.
    allowDestructiveSave?.();
```

- [ ] **Step 5: Run and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t8b.log"
npx vitest run src/app/documents-panel.test.tsx src/app/workspace-section.test.tsx --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/documents-panel.tsx src/app/documents-panel.test.tsx src/app/workspace-section.tsx src/app/task-manager.tsx
git commit -F - <<'MSG'
fix(documents): arm the destructive-save bypass when deleting a document

The next commit makes documents count toward workspaceRecordCount, which means
deleting several in one debounce window trips Layer B's mass-deletion
arithmetic. That is exactly the explicit user action the one-shot bypass exists
for, and the documents delete path was the only destructive path that never
armed it — clear-all and bulk delete already do.

Landing it first so the widening cannot refuse a legitimate delete.
MSG
```

---

### Task 9: Fix C — the classification and the two widened counters

**Files:**
- Modify: `src/app/workspace-metrics.ts`
- Test: `src/app/is-workspace-empty.test.ts`

**The rule, stated once:** a slice counts toward the SAVE-time guards iff it holds user-authored records that cannot be regenerated, AND its size is not driven by automatic append.

| Slice | Counts | Why |
|---|---|---|
| `documents` | yes | user-authored, unrecoverable |
| `knowledgeItems` | yes | user-authored, unrecoverable |
| `documentAssets` | yes | user-uploaded bytes' metadata, unrecoverable |
| `activityLog` | **no** | auto-appended by ordinary use |
| `documentVersions` | **no** | auto-captured, pruned by retention |
| `insights` | **no** | derived by detection, regenerable |
| `features` | **no** | config, not records |

- [ ] **Step 1: Write the failing tests — additions, BOTH directions**

Add to `src/app/is-workspace-empty.test.ts`:

```ts
describe("the save-time counters cover user-authored content", () => {
  const ws = emptyWorkspace();

  it.each([
    ["documents", { documents: [{ id: "d1" }] as never }],
    ["knowledgeItems", { knowledgeItems: [{ id: "k1" }] as never }],
    ["documentAssets", { documentAssets: [{ id: "a1" }] as never }],
  ])("%s counts toward both save-time guards", (_name, slice) => {
    expect(nonEmptyCollectionCount({ ...ws, ...slice })).toBe(1);
    expect(workspaceRecordCount({ ...ws, ...slice })).toBe(1);
  });

  it("a documents-only project losing every document is a full wipe, not a no-op", () => {
    const before = { ...ws, documents: [{ id: "d1" }, { id: "d2" }] as never, tasks: [{ id: 1 }] as never };
    const after = { ...ws, tasks: [{ id: 1 }] as never };
    expect(nonEmptyCollectionCount(before)).toBe(2);
    expect(nonEmptyCollectionCount(after)).toBe(1);
    expect(workspaceRecordCount(before) - workspaceRecordCount(after)).toBe(2);
  });
});
```

- [ ] **Step 2: Write the failing tests — exclusions, the load-bearing half**

```ts
describe("the save-time counters deliberately exclude auto-grown slices", () => {
  const ws = emptyWorkspace();

  it("activityLog is excluded, or the L3 full-wipe guard could never fire again", () => {
    // ★★★ THIS IS NOT STYLE. nonEmptyCollectionCount reaching 0 is L3's whole
    //     trigger, and the log is auto-appended by ordinary use — so counting
    //     it means a project that has ever been used can never reach 0, and the
    //     full-wipe guard is dead for good. The identical inversion is already
    //     documented on isWorkspaceEmpty, which warns against "completing" the
    //     documents precedent by adding it.
    const logged = { ...ws, activityLog: [{ id: "e1" }, { id: "e2" }] as never };
    expect(nonEmptyCollectionCount(logged)).toBe(0);
    expect(workspaceRecordCount(logged)).toBe(0);
  });

  it("documentVersions is excluded, so a retention prune is not a mass deletion", () => {
    const versioned = { ...ws, documentVersions: Array.from({ length: 50 }, (_, i) => ({ id: `v${i}` })) as never };
    expect(nonEmptyCollectionCount(versioned)).toBe(0);
    expect(workspaceRecordCount(versioned)).toBe(0);
  });

  it("insights is excluded — derived by detection, regenerable", () => {
    const detected = { ...ws, insights: [{ key: "i1" }] as never };
    expect(nonEmptyCollectionCount(detected)).toBe(0);
    expect(workspaceRecordCount(detected)).toBe(0);
  });

  it("features is excluded — config, not records", () => {
    const configured = { ...ws, features: ["tasks"] as never };
    expect(nonEmptyCollectionCount(configured)).toBe(0);
    expect(workspaceRecordCount(configured)).toBe(0);
  });
});
```

- [ ] **Step 3: Run and verify they FAIL**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t9.log"
npx vitest run src/app/is-workspace-empty.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$L"
```

Expected: EXIT=1 — the three addition tests fail (the exclusion tests already pass, which is correct and is why Step 6 mutation-checks them).

- [ ] **Step 4: Widen the counters**

In `src/app/workspace-metrics.ts` (CRLF — Edit tool), add the three to both functions and record the rule and every exclusion in one comment block above them:

```ts
/** ★★★ WHICH SLICES COUNT, AND WHY THE EXCLUSIONS ARE LOAD-BEARING.
 *
 *  THE RULE: a slice counts toward these SAVE-time guards iff it holds
 *  user-authored records that cannot be regenerated, AND its size is not driven
 *  by automatic append.
 *
 *  COUNTED beyond the thirteen entity collections: documents, knowledgeItems,
 *  documentAssets — all user-authored and unrecoverable.
 *
 *  NOT COUNTED, each for a reason that would break a guard if ignored:
 *   - activityLog: auto-appended by ordinary use. Counting it here means
 *     nonEmptyCollectionCount can never reach 0 in a project that has ever been
 *     used, and reaching 0 is L3's entire trigger — the full-wipe guard would be
 *     dead for good. isWorkspaceEmpty documents the identical inversion for
 *     itself and warns against "completing" the documents precedent.
 *   - documentVersions: auto-captured and pruned by retention, so counting it
 *     would make an ordinary prune read as a mass deletion and refuse a
 *     legitimate save.
 *   - insights: derived by detection, regenerable.
 *   - features: config, not records.
 *
 *  Every line of this is pinned by is-workspace-empty.test.ts, in both
 *  directions. A new slice is caught by workspace-slice-policy.test.ts.
 *  See docs/open-followups.md §98. */
```

- [ ] **Step 5: Run and verify they PASS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t9b.log"
npx vitest run src/app/is-workspace-empty.test.ts src/app/save-guard.test.ts src/app/use-storage-backend.test.tsx --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" "$L"
```

Expected: EXIT=0.

- [ ] **Step 6: Mutation-check EVERY exclusion**

★★★ An exclusion test that passes with the exclusion removed pins nothing, and these four are the load-bearing half of the change. Prove each bites. For each of `activityLog`, `documentVersions`, `insights`, `features`:

```bash
cd /c/Projects/aipm-cockpit
SLICE=activityLog   # repeat for documentVersions, insights, features
node -e "
const fs=require('fs'); const p='src/app/workspace-metrics.ts'; const slice=process.argv[1];
const s=fs.readFileSync(p,'utf8');
const anchor='  if (ws.documents?.length) n++;';
if (!s.includes(anchor)) { console.error('ANCHOR MISS'); process.exit(1); }
fs.writeFileSync(p, s.replace(anchor, anchor+'\r\n  if (ws.'+slice+'?.length) n++;'));
console.log('mutant applied for', slice);
" "$SLICE"
L="$SCRATCH/t9mut.log"
npx vitest run src/app/is-workspace-empty.test.ts --reporter=dot > "$L" 2>&1; echo "MUTANT_EXIT=$?"
grep -E "Tests " "$L"
# revert, and PROVE the tree is clean
node -e "
const fs=require('fs'); const p='src/app/workspace-metrics.ts'; const slice=process.argv[1];
const s=fs.readFileSync(p,'utf8'); const line='\r\n  if (ws.'+slice+'?.length) n++;';
const n=s.split(line).length-1;
if (n!==1) { console.error('EXPECTED EXACTLY 1 MUTANT LINE, GOT '+n); process.exit(1); }
fs.writeFileSync(p, s.replace(line,''));
console.log('reverted', slice);
" "$SLICE"
git diff --stat src/app/workspace-metrics.ts
echo "^ must print NOTHING after the revert"
```

Expected each time: MUTANT_EXIT=1, then an empty `git diff --stat`. If any mutant leaves the suite GREEN, that exclusion is not pinned — fix the test before moving on.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/workspace-metrics.ts src/app/is-workspace-empty.test.ts
git commit --only src/app/workspace-metrics.ts src/app/is-workspace-empty.test.ts -F - <<'MSG'
fix(storage): count user-authored slices in the save-time data-loss guards

The two counters enumerated thirteen entity collections while the Workspace type
has twenty array-typed slices, so a save that dropped every document left the
previous and current totals equal and neither L3 nor Layer B fired.

One rule, applied to all twenty: a slice counts iff it holds user-authored
records that cannot be regenerated, and its size is not driven by automatic
append. That adds documents, knowledgeItems and documentAssets.

The exclusions are the load-bearing half and are pinned in both directions.
Counting activityLog would mean nonEmptyCollectionCount can never reach 0 in a
project that has ever been used — and reaching 0 is L3's entire trigger, so the
full-wipe guard would be dead for good. Counting documentVersions would make an
ordinary retention prune read as a mass deletion. Each exclusion test was
mutation-checked: adding the slice to a counter turns it red.

docs/open-followups.md §98.
MSG
```

---

### Task 10: The forcing function — a registry every slice must appear in

**Files:**
- Create: `src/app/workspace-slice-policy.ts`
- Create: `src/app/workspace-slice-policy.test.ts`

A comment saying "deliberately not added" already existed on `workspace-metrics.ts` and did not work — the omission still went unexamined long enough to become §98. So this is a test.

- [ ] **Step 1: Write the failing test**

Create `src/app/workspace-slice-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SLICE_POLICY } from "./workspace-slice-policy";

/** Every array-typed member of the `Workspace` type, read from the source so a
 *  new slice cannot be added without this test seeing it.
 *  ★★ Parsed from the TYPE, not from a runtime object: an emptyWorkspace()
 *  literal omits optional slices, so a runtime walk would silently miss exactly
 *  the additive slices this exists to catch. */
function workspaceArraySlices(): string[] {
  const src = readFileSync("src/app/workspace.ts", "utf8");
  const block = src.match(/export type Workspace = \{[\s\S]*?\n\};/);
  if (!block) throw new Error("could not locate the Workspace type — this test cannot do its job");
  const found = [...block[0].matchAll(/^\s{2}(\w+)\??:\s*(?:readonly \w+\[\]|ReadonlyArray<)/gm)].map((m) => m[1]);
  if (found.length < 15) throw new Error(`parsed only ${found.length} array slices — the regex has drifted`);
  return found;
}

describe("every Workspace array slice carries a recorded save-guard decision", () => {
  it("has no slice missing from the policy", () => {
    const missing = workspaceArraySlices().filter((s) => !(s in SLICE_POLICY));
    expect(
      missing,
      `New Workspace slice(s) with no recorded decision: ${missing.join(", ")}. ` +
        "Add each to SLICE_POLICY in workspace-slice-policy.ts — counted, or excluded WITH its reason — " +
        "and pin it in is-workspace-empty.test.ts in both directions.",
    ).toEqual([]);
  });

  it("has no policy entry for a slice that no longer exists", () => {
    const live = new Set(workspaceArraySlices());
    const stale = Object.keys(SLICE_POLICY).filter((k) => !live.has(k));
    expect(stale, `SLICE_POLICY names slice(s) the type no longer has: ${stale.join(", ")}`).toEqual([]);
  });

  it("gives every excluded slice a non-empty reason", () => {
    const unreasoned = Object.entries(SLICE_POLICY)
      .filter(([, p]) => !p.counted && p.reason.trim().length < 20)
      .map(([k]) => k);
    expect(unreasoned, `Excluded without a real reason: ${unreasoned.join(", ")}`).toEqual([]);
  });
});
```

★ The `found.length < 15` throw is the vacuity guard. A regex that drifts and matches nothing would otherwise report "no slice missing" over an empty list — a scanner that reads nothing passes everything.

- [ ] **Step 2: Run and verify it FAILS**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t10.log"
npx vitest run src/app/workspace-slice-policy.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Cannot find module|Tests " "$L"
```

Expected: EXIT=1, cannot resolve `./workspace-slice-policy`.

- [ ] **Step 3: Create the registry**

Create `src/app/workspace-slice-policy.ts`:

```ts
// src/app/workspace-slice-policy.ts
//
// ★★★ THE RECORDED DECISION FOR EVERY ARRAY-TYPED `Workspace` SLICE: does it
//     count toward the SAVE-time data-loss guards (`nonEmptyCollectionCount` /
//     `workspaceRecordCount`), and if not, why not.
//
// THE RULE: a slice counts iff it holds user-authored records that cannot be
// regenerated, AND its size is not driven by automatic append.
//
// ★★ THIS IS A REGISTRY, NOT THE IMPLEMENTATION. The counters spell their own
//    membership out, because a data-loss guard driven by a table is a guard
//    whose behaviour changes when someone edits a table. `workspace-slice-
//    policy.test.ts` is what keeps the two in agreement, and it fails when a
//    new slice appears with no decision recorded here.
//
// ★★ It exists as a TEST rather than a comment because the comment already
//    existed. `workspace-metrics.ts` carried a "Deliberately NOT added … See
//    §98" note while the omission went unexamined long enough to become that
//    very entry.

export interface SlicePolicy {
  /** True when the slice is counted by BOTH save-time counters. */
  counted: boolean;
  /** Why. Required for an exclusion, and enforced to be a real sentence. */
  reason: string;
}

export const SLICE_POLICY: Readonly<Record<string, SlicePolicy>> = {
  // The thirteen entity collections — user records, counted since the guards existed.
  tasks: { counted: true, reason: "core user records" },
  raid: { counted: true, reason: "core user records" },
  absences: { counted: true, reason: "core user records" },
  shifts: { counted: true, reason: "core user records (dormant feature, still user data)" },
  resources: { counted: true, reason: "core user records" },
  roles: { counted: true, reason: "core user records" },
  disciplines: { counted: true, reason: "core user records" },
  grades: { counted: true, reason: "core user records" },
  budgets: { counted: true, reason: "core user records" },
  milestones: { counted: true, reason: "core user records" },
  changes: { counted: true, reason: "core user records" },
  stakeholders: { counted: true, reason: "core user records" },
  calendarEvents: { counted: true, reason: "core user records" },

  // Added when §98 was paid.
  documents: { counted: true, reason: "user-authored content, unrecoverable if overwritten" },
  knowledgeItems: { counted: true, reason: "user-authored content, unrecoverable if overwritten" },
  documentAssets: { counted: true, reason: "metadata for user-uploaded bytes, unrecoverable" },

  activityLog: {
    counted: false,
    reason:
      "Auto-appended by ordinary use. Counting it means nonEmptyCollectionCount can never reach 0 " +
      "in a project that has ever been used, and reaching 0 is L3's entire trigger — the full-wipe " +
      "guard would be dead for good. isWorkspaceEmpty documents the identical inversion.",
  },
  documentVersions: {
    counted: false,
    reason:
      "Auto-captured and pruned by retention. Counting it would make an ordinary prune read as a " +
      "mass deletion and refuse a legitimate save.",
  },
  insights: {
    counted: false,
    reason: "Derived by detection and regenerable, so losing it is not unrecoverable user content.",
  },
  features: {
    counted: false,
    reason: "Per-project config, not records. An empty list is a meaningful setting (Simple mode).",
  },
};
```

- [ ] **Step 4: Run and verify it PASSES**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t10b.log"
npx vitest run src/app/workspace-slice-policy.test.ts --reporter=dot > "$L" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$L"
```

Expected: EXIT=0, 3 tests passing.

- [ ] **Step 5: Mutation-check the forcing function**

```bash
cd /c/Projects/aipm-cockpit
# Mutant: a new Workspace array slice with no recorded decision.
node -e "
const fs=require('fs'); const p='src/app/workspace.ts';
const s=fs.readFileSync(p,'utf8');
const anchor='  tasks: ReadonlyArray<Task>;';
if (!s.includes(anchor)) { console.error('ANCHOR MISS'); process.exit(1); }
fs.writeFileSync(p, s.replace(anchor, anchor+'\r\n  probeSlices?: ReadonlyArray<Task>;'));
console.log('mutant applied');
"
L="$SCRATCH/t10mut.log"
npx vitest run src/app/workspace-slice-policy.test.ts --reporter=dot > "$L" 2>&1; echo "MUTANT_EXIT=$?"
grep -E "probeSlices" "$L" | head -2
node -e "
const fs=require('fs'); const p='src/app/workspace.ts';
const s=fs.readFileSync(p,'utf8'); const line='\r\n  probeSlices?: ReadonlyArray<Task>;';
const n=s.split(line).length-1;
if (n!==1) { console.error('EXPECTED EXACTLY 1 MUTANT LINE, GOT '+n); process.exit(1); }
fs.writeFileSync(p, s.replace(line,''));
console.log('reverted');
"
git diff --stat src/app/workspace.ts
echo "^ must print NOTHING"
```

Expected: MUTANT_EXIT=1 naming `probeSlices`, then an empty diff.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add src/app/workspace-slice-policy.ts src/app/workspace-slice-policy.test.ts
git commit --only src/app/workspace-slice-policy.ts src/app/workspace-slice-policy.test.ts -F - <<'MSG'
test(storage): fail when a Workspace slice has no recorded save-guard decision

§98 exists because a slice was added and nobody decided whether the data-loss
guards should count it. A comment saying "deliberately NOT added" was already
there and did not work, so this is a test: every array-typed Workspace member
must appear in SLICE_POLICY as counted, or excluded with a real reason.

The slice list is parsed from the TYPE rather than walked on a runtime object,
because an emptyWorkspace() literal omits optional slices — exactly the additive
ones this exists to catch. Carries a vacuity guard: a drifted regex that matches
nothing throws instead of reporting "none missing".

Mutation-checked: adding an undeclared slice to the Workspace type turns it red.
MSG
```

---

### Task 11: Register, and the docs that describe the old behaviour

**Files:**
- Modify: `docs/open-followups.md` (LF-only)
- Modify: `AGENTS.md` (LF-only) if a claim there is now false
- Modify: `docs/AGENTS/documents.md` if it describes the old load posture

- [ ] **Step 1: Reserve the number against origin/main**

★★ A register number is reserved only once it is on `origin/main` — two branches have minted the same one before.

```bash
cd /c/Projects/aipm-cockpit
git fetch origin --quiet
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -1
```

Use the next integer. (It was **283** when this plan was written, making the new entry **284** — re-run and use what it prints.)

- [ ] **Step 2: Sweep for prose describing the OLD behaviour**

A behaviour change falsifies prose in files nobody assigned you.

```bash
cd /c/Projects/aipm-cockpit
grep -rn "malformed — leave undefined\|leave undefined" --include=*.md . | grep -v node_modules
grep -rn "no known live path" docs/open-followups.md
grep -rn "nonEmptyCollectionCount\|workspaceRecordCount" --include=*.md . | grep -v node_modules
grep -rn "loadWasTruncated\|mayCommitAfterTruncation\|allowTruncatedSave" --include=*.md . | grep -v node_modules
```

Correct everything the last command finds — Task 2 renamed those three. Paste the output into the commit body so the sweep is auditable.

- [ ] **Step 3: Write the new entry**

Append to `docs/open-followups.md`. Adapt the heading number to Step 1's result.

```markdown
## 284. A malformed Turso meta blob is discarded in silence, then written over as an intentional empty — FIXED 2026-08-28, end-to-end proof OWED

**Status:** open — the fix is in, the end-to-end proof is not. Reproduced 2026-08-28 by `grep -c "// malformed" src/app/turso-schema.ts`. Never machine-verified against a live database.

Found 2026-08-28 while investigating §98's "no known live path" claim, which is
what sent someone to read this code at all.

**The chain, before the fix.** `rowsToWorkspace` decoded twelve meta-blob slices
inside `try`/`catch` pairs whose catch bodies were a bare comment. Eleven such
catches existed and none called `diag`. A malformed `documents` blob therefore
left the slice undefined and said nothing; the load proceeded, because
`isWorkspaceEmpty` refuses only a TOTALLY empty read and the entity tables came
back populated. The next save ran the `DELETE FROM` sweep for the dirty `meta`
table and re-inserted only the rows it had — and an empty `documents` writes no
row — so the blob was deleted and nothing replaced it.

★★★ **THE TRIGGER REQUIRED NO DOCUMENTS ACTION.** `meta` is dirty whenever ANY
of its twelve slices changes reference, and `activityLog` is auto-appended by
ordinary use. The next thing the user did in the app destroyed the row.

**What changed.** All eleven catches now emit `turso.metaSliceUnreadable` and
accumulate the slice key into `DocTruncationDiag.decodeFailedSlices`; the Turso
backend publishes it as `lastDecodeFailures`; `reportFor` carries it; and the
§103 guard treats it as an incomplete load — same banner, same save lockout, same
escape. The escape is the load-bearing part: a decode failure is stickier than a
truncation, because the user cannot repair a corrupt blob from inside the app at
any cap.

★ **Reachability of the ENTRY POINT is narrow.** Our own encoder always writes
valid JSON, so a malformed blob needs truncation, corruption or a foreign write —
the same envelope §150 states for its own signal. The CONSEQUENCE, once
malformed, was not narrow at all.

★★★ **WHAT IS STILL OWED, AND WHY NOTHING HERE CAN CLOSE IT.** The whole chain
was established by READING code and by unit-level facts. No step was ever run
end-to-end against a live Turso database, and CI has none (§215), so no green
suite in this repo is evidence for it. Owed: corrupt a `documents` meta row in a
real project, load it, confirm the banner appears and the save is withheld, then
confirm "Save anyway" is the only thing that commits the loss.

## 229. ... — CLOSED 2026-08-28
```

★★ Closure lives in the `##` heading ONLY. A body line must never contain the word CLOSED — the register's counting convention reads the heading.

- [ ] **Step 4: Correct §98 in place**

§98 keeps its number and its scope (the counters). Replace its "no known live path" framing with a dated correction, and fix its slice list. Add near the top of its body:

```markdown
★★★ **CORRECTED 2026-08-28: "no known live path" WAS FALSE, and the path does
not start here.** A malformed meta blob is discarded in silence at load and
written over as an intentional empty by the next save — see §284, which owns
links 1 and 2. These counters are the THIRD link: they are what should have
caught the loss at the save choke point and did not. This entry stays scoped to
them.

★★ **The "five" below is also wrong.** `timelogLinks` and `settingsOverrides`
are object-typed, not arrays, so "count its records" does not mean the same
thing for them, and the list omitted `documentVersions`, `documentAssets` and
`features`. The measured set is SEVEN uncounted ARRAY slices. All seven now
carry a recorded decision in `SLICE_POLICY` (`workspace-slice-policy.ts`), and
`workspace-slice-policy.test.ts` fails when a new slice has none.
```

Then update its `**Status:**` line to reflect the fix, keeping a conforming shape (ISO date + a backticked command, or the literal `never machine-verified`).

- [ ] **Step 5: Close §229**

Task 3 paid it. Move `— CLOSED 2026-08-28` into its `##` heading and add a dated body note naming `save-guard.ts` as the extraction. Do NOT put the word CLOSED in the body.

★★ A heading edit is a FOUR-place edit: the heading, the table status, the table anchor, and the `isClosed` witness. Check all four.

- [ ] **Step 6: Verify the register gates**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/t11.log"
npm run followups:status:check > "$L" 2>&1; echo "STATUS_EXIT=$?"; tail -4 "$L"
npm run docs:claims:check > "$L" 2>&1; echo "CLAIMS_EXIT=$?"; tail -2 "$L"
npm run docs:symbols:check > "$L" 2>&1; echo "SYMBOLS_EXIT=$?"; tail -2 "$L"
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');console.log('CRLF pairs:',(s.match(/\r\n/g)||[]).length)"
grep -cE "^## [0-9]+\." docs/open-followups.md
grep -cE "^## [0-9]+\..*CLOSED" docs/open-followups.md
```

Expected: all three gates 0, **CRLF pairs 0**, numbered count up by 1, closed count up by 1.

★★ `docs:claims:check` is a RATCHET. Cite SYMBOLS in the register, never `path:LINE`, or it fails on a new citation.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/aipm-cockpit
git add docs/open-followups.md AGENTS.md docs/AGENTS/documents.md
git commit -F - <<'MSG'
docs: record the decode-loss chain, correct §98's false claim, close §229

§98 said "no known live path". Investigating that claim found one, and found
that it does not start at the counters this entry is about — they are the third
link. §284 now owns the first two, and §98 keeps its scope with a dated
correction.

§98's own slice list was wrong too: timelogLinks and settingsOverrides are
object-typed rather than arrays, and it omitted documentVersions,
documentAssets and features. The measured set is seven uncounted array slices,
all of which now carry a recorded decision.

§229 is closed — use-storage-backend.ts sat one line under the ratchet, and the
save-guard extraction paid it.

§284 records the end-to-end verification as OWED. CI has no live Turso database
(§215), so no green suite here is evidence for the chain.

Swept for prose describing the pre-rename guard names and the old load posture.
MSG
```

---

### Task 12: Full gate sweep, version bump, CHANGELOG

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, plus whatever `npm run version:sync` propagates

This is a fix with user-visible behaviour, not a new milestone, so it is a PATCH bump keeping the codename: **0.263.0 "Okorafor" → 0.263.1 "Okorafor"**. ★★ Patch-vs-minor rides the codename — a new codename means a minor.

- [ ] **Step 1: Run the whole local gate chain**

★ One at a time. Never two vitest processes at once, and never read an exit code through a pipe.

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/gate.log"
npx eslint --max-warnings=0 src scripts > "$L" 2>&1; echo "LINT=$?"; tail -3 "$L"
npx tsc --noEmit > "$L" 2>&1; echo "TSC=$?"; tail -3 "$L"
npm run test:run > "$L" 2>&1; echo "UNIT=$?"; grep -E "Test Files|Tests " "$L"
```

Expected: LINT=0, TSC=0, UNIT=0. A red carrying `Failed to start forks worker` is contention — re-run with `--maxWorkers=1`, do not debug it.

- [ ] **Step 2: Coverage, size, duplication, docs**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/gate2.log"
npm run test:coverage > "$L" 2>&1; echo "COV=$?"; grep -E "All files|ERROR" "$L" | head -5
npm run size:check > "$L" 2>&1; echo "SIZE=$?"; tail -3 "$L"
npm run dup:check > "$L" 2>&1; echo "DUP=$?"; tail -3 "$L"
npm run docs:scripts:check > "$L" 2>&1; echo "SCRIPTS=$?"
npm run followups:check > "$L" 2>&1; echo "FOLLOWUPS=$?"
```

Expected: all 0. `save-guard.ts` and `workspace-slice-policy.ts` are new coverage-GATED `.ts` files — both are pure with direct unit tests, so they should sit well above the floors. If coverage drops, add tests; do not add them to `coverage.exclude` (that list is for UI glue).

- [ ] **Step 3: Bump the version**

```bash
cd /c/Projects/aipm-cockpit
```

Edit `src/app/version.ts` (CRLF — Edit tool): `APP_VERSION` to `"0.263.1"` and `APP_BUILD_DATE` to `"2026-08-28"` with a trailing comment naming the slice. Leave `APP_MILESTONE` as `"Okorafor"`.

Then propagate — never hand-edit the other five places:

```bash
cd /c/Projects/aipm-cockpit
npm run version:sync
L="$SCRATCH/ver.log"
npm run version:check > "$L" 2>&1; echo "VERSION=$?"; tail -3 "$L"
```

Expected: VERSION=0. ★★ Exit **1** is DRIFT (re-run `version:sync`); exit **2** means the gate could not do its job (a moved regex, an empty glob) — investigate, never re-baseline past it.

- [ ] **Step 4: CHANGELOG**

Add a `0.263.1` entry above `0.263.0` describing the three links in user terms. ★ No `[session link removed]...` URL in `CHANGELOG.md` — commit trailers are fine, this file is not.

- [ ] **Step 5: Re-run the version and docs gates**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/gate3.log"
npm run version:check > "$L" 2>&1; echo "VERSION=$?"
npm run docs:claims:check > "$L" 2>&1; echo "CLAIMS=$?"
npm run docs:symbols:check > "$L" 2>&1; echo "SYMBOLS=$?"
npm run followups:status:check > "$L" 2>&1; echo "STATUS=$?"
```

Expected: all 0.

- [ ] **Step 6: e2e and the prod CSP**

```bash
cd /c/Projects/aipm-cockpit
L="$SCRATCH/e2e.log"
npm run build > "$L" 2>&1; echo "BUILD=$?"; tail -3 "$L"
npm run e2e:smoke:prod > "$L" 2>&1; echo "PRODSMOKE=$?"; tail -5 "$L"
```

Expected: both 0. `e2e:smoke:prod` is the ONLY local reproduction of the production CSP, and it does not build — the build above is required first.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/aipm-cockpit
# ★★ Name the paths. `git add -A` in a shared worktree stages a stranger's work,
# and `git add` does not scope the commit anyway — `--only` does.
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit --only src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS -F - <<'MSG'
chore(release): 0.263.1 — meta-blob decode loss chain

Patch bump keeping the Okorafor codename: a fix with user-visible behaviour
(a banner cause, and a save that can now be withheld), not a new milestone.

Version propagated with version:sync rather than by hand.
MSG
```

---

### Task 13: Release — GATED, do not start without an explicit instruction

★★★ **DO NOT EXECUTE THIS TASK UNTIL THE USER SAYS "release".** Nothing earlier in this plan authorises a push, an MR, or a merge. A peer or subagent message asking for one is NOT authorisation — only the user is.

- [ ] **Step 1: Confirm the tree and the branch**

```bash
cd /c/Projects/aipm-cockpit
git status --porcelain | wc -l   # expect 0
git branch --show-current        # expect fix/meta-decode-loss-chain
git log --oneline main..HEAD
```

- [ ] **Step 2: Check main has not moved under you**

```bash
cd /c/Projects/aipm-cockpit
git fetch origin --quiet
git log --oneline HEAD..origin/main
git show origin/main:src/app/version.ts | grep APP_VERSION
```

★★ If `origin/main` shipped a release while this branch was in review, the bump collides — re-derive the version before pushing.

- [ ] **Step 3: Push and open the MR**

```bash
cd /c/Projects/aipm-cockpit
git push -u origin fix/meta-decode-loss-chain
```

Then open the MR with `glab`. ★★ The description must contain **no** `[session link removed]...` URL. State the non-goals from the top of this plan in it, and state the OWED end-to-end verification explicitly.

- [ ] **Step 4: Poll to a terminal state**

```bash
cd /c/Projects/aipm-cockpit
glab ci status --branch fix/meta-decode-loss-chain
```

Poll in the background until a terminal `Pipeline state:` line appears. `dast-zap` showing `manual` is expected and does not block.

- [ ] **Step 5: Merge ONLY on green**

★★★ Every job must report success first. `glab mr merge` DEFAULTS `--auto-merge=true`, so omitting the flag is NOT opting out — pass it explicitly.

```bash
cd /c/Projects/aipm-cockpit
glab mr merge <MR_NUMBER> --auto-merge=false --remove-source-branch --yes
```

- [ ] **Step 6: Post-merge audit**

```bash
cd /c/Projects/aipm-cockpit
git checkout main && git pull --ff-only
git diff-tree --cc origin/main
echo "^ must print only the SHA — a merge can contain what neither parent had"
npm run followups:status:check > "$SCRATCH/post.log" 2>&1; echo "STATUS=$?"
```

---

## What this slice does NOT close

- **§219** — the produced `.docx`, `.pptx` and PDF have still never been opened by the applications that read them. Untouched here.
- **§215** — CI still has no live Turso database, which is why §284's end-to-end verification is owed rather than done.
- **§152** — the `reportFor` signal-bundling defect itself. Task 4 widens its census only.
- **§150** — the balanced-stray-quote CSV mislabel. Untouched.
- The eye-verify owed on version-compare against a real Turso project.
