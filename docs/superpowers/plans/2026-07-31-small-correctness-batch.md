# Small-correctness batch (§11 · §14 · §15 · §29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four open entries in `docs/open-followups.md` — a user cancel reported as an error, a per-device cache keyed off an editable project code, two hand-rolled file-picker shapes, and dead form state that invites a known data-loss bug back.

**Architecture:** Four independent changes in four disjoint file groups, each fronted by a small pure/presentational unit that removes the duplication rather than patching each copy: a pure `isAbortError` predicate, a read-both-keys widening of the actuals store, a `FilePickerButton` primitive, and a field deletion whose type is derived so `tsc` finds every stale site.

**Tech Stack:** TypeScript · React 19 · Next 16 · vitest 4 + @testing-library/react + user-event · eslint flat config under `--max-warnings=0`.

**Spec:** `docs/superpowers/specs/2026-07-31-small-correctness-batch-design.md`

---

## Read this before Task 1

**Gate commands are never piped.** `npm run test:run | tail` reports *tail's* exit code — a failing suite reads as green. Always:

```bash
npx vitest run src/app/foo.test.ts > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
```

`npm run lint` is bare `eslint` with **no** `--max-warnings`, so it exits 0 on warnings and does **not** reproduce the CI gate. The gate is `npx eslint --max-warnings=0 src/app`. An unused import or variable is **fatal**.

`npx tsc --noEmit` must be run after touching any test — `next build` does not typecheck `*.test.tsx` and vitest never typechecks. The IDE's inline diagnostics are mid-edit snapshots; trust `tsc`, not squiggles.

Every commit message ends with:

```
Claude-Session: https://[session link removed]
```

---

## File Structure

**Created**

| file | responsibility |
|---|---|
| `src/app/abort-error.ts` | One predicate: is this thrown value a fetch/AbortController cancellation? Pure, no React, no i18n. |
| `src/app/abort-error.test.ts` | Its unit test (new coverage-gated `.ts` — must be fully covered). |
| `src/app/file-picker-button.tsx` | DS `Button` + the `sr-only` file input it owns. Presentational; owns no validation. |
| `src/app/file-picker-button.test.tsx` | Its unit test. |

**Modified**

| file | change |
|---|---|
| `src/app/use-tasks-dedup.tsx:121` | abort check → `isAbortError` |
| `src/app/use-action-analysis.ts:34` | abort check → `isAbortError` |
| `src/app/use-project-proposal.ts:51` | `instanceof` arm → `isAbortError` (keeps `signal?.aborted ||`) |
| `src/app/use-timelog-sync.ts:106` | same shape; plus `legacyProjectId` threading (Task 4) |
| `src/app/timelog-actuals-store.ts` | `loadActualsCache` / `clearActualsCache` take an optional legacy key |
| `src/app/timelog-panel.tsx` | rename the `projectId` local to `projectCode`; feed the sync the canonical key |
| `src/app/theme-gallery.tsx` | drops its ref + input → `FilePickerButton` |
| `src/app/color-scheme-editor.tsx` | drops its `<label>` shape → `FilePickerButton` |
| `src/app/branding-image-input.tsx` | drops its `<label>` shape → `FilePickerButton`; keeps all validation |
| `src/app/task-form-context.tsx:47` | remove `noteLog` from `emptyForm` (and its now-unused import) |
| `src/app/use-task-submit.ts:341` | remove the `noteLog` seed |
| `src/app/task-form-fields.tsx:632` | fallback count → literal `0` |
| tests listed per task | |
| `docs/open-followups.md` | close §11 §14 §15 §29; open §46 §47 |
| `AGENTS.md` | correct anything naming the retired symbols |
| version + changelog sites | Task 9 |

**Deliberately untouched:** `chat-panel.tsx`, `step0-import-panel.tsx` (→ new §47), `use-alloc-plan.tsx`, `use-raci-suggest.tsx`, `chat-panel.tsx:478` (correct-by-hand abort reads), `use-timelog-picker-scope.ts`.

---

## Task 1: `isAbortError` — the pure predicate

**Files:**
- Create: `src/app/abort-error.ts`
- Test: `src/app/abort-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/abort-error.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAbortError } from "./abort-error";

describe("isAbortError", () => {
  it("recognises a real DOMException abort", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  // ★ THE CASE THE HELPER EXISTS FOR. A DOMException is not reliably
  // `instanceof Error`/`instanceof DOMException` across the jsdom/Node
  // boundary, so the value can arrive as a plain object carrying only
  // `.name`. An `instanceof`-gated check returns false here — which is
  // exactly the defect (a user cancel reported as an error).
  it("recognises a plain object that merely carries name AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("recognises an Error subclass renamed to AbortError", () => {
    expect(isAbortError(Object.assign(new Error("stop"), { name: "AbortError" }))).toBe(true);
  });

  it("rejects an ordinary Error", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
  });

  it("rejects a different DOMException", () => {
    expect(isAbortError(new DOMException("quota", "QuotaExceededError"))).toBe(false);
  });

  it("rejects null, undefined, a string and a number without throwing", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/app/abort-error.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" /tmp/t1.log
```

Expected: non-zero exit, failure resolving `./abort-error`.

- [ ] **Step 3: Write the implementation**

Create `src/app/abort-error.ts`:

```ts
// Single predicate for "this thrown value is a user/controller cancellation".
// Pure — no React, no i18n, no DOM requirement.
//
// ★★ Reads `.name` DIRECTLY and never `instanceof DOMException`: a
// DOMException is not reliably `instanceof Error`/`instanceof DOMException`
// across the jsdom/Node boundary, so an `instanceof`-gated check silently
// falls through to the caller's generic error arm and reports a deliberate
// cancel as a failure. That was the defect in `use-tasks-dedup` and
// `use-action-analysis` (open-followups §11); this helper exists so a
// future caller cannot reinvent it.
export function isAbortError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : (e as { name?: unknown } | null | undefined)?.name;
  return name === "AbortError";
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npx vitest run src/app/abort-error.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: `EXIT=0`, 6 tests passed.

- [ ] **Step 5: Prove the test is not vacuous**

Temporarily change the implementation body to the broken shape:

```ts
  return e instanceof DOMException && e.name === "AbortError";
```

Re-run Step 4. Expected: the "plain object" and "Error subclass" tests **FAIL**. Then restore the real body and re-run — all 6 pass again.

★ Restore by re-typing the correct body. Do **not** `git checkout` the file: it is untracked at this point and would be deleted.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0` from both.

- [ ] **Step 7: Commit**

```bash
git add src/app/abort-error.ts src/app/abort-error.test.ts
git commit -F - <<'EOF'
feat(errors): add a pure isAbortError predicate

Reads `.name` directly instead of gating on `instanceof DOMException`,
which is not reliable across the jsdom/Node boundary. No call sites yet.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 2: Route the four abort call sites through it (§11)

**Files:**
- Modify: `src/app/use-tasks-dedup.tsx:121`, `src/app/use-action-analysis.ts:34`, `src/app/use-project-proposal.ts:51`, `src/app/use-timelog-sync.ts:106`
- Create: `src/app/use-action-analysis.test.ts` (verified absent on 2026-07-31)
- Modify: `src/app/use-tasks-dedup.test.tsx` (exists — append one `it` to the existing `describe("useTasksDedup (plan-then-apply)")` block at `:82`)

- [ ] **Step 1: Write the failing behavioural tests**

Both exposed sites fail **differently** — dedup shows a toast, action-analysis sets an error state — so one test cannot cover the other.

Create `src/app/use-action-analysis.test.ts` in full:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionAnalysis } from "./use-action-analysis";
import * as jobAnalysis from "./scheduled-job-analysis";

afterEach(() => vi.restoreAllMocks());

describe("useActionAnalysis — a cancel is not an error", () => {
  // ★ A PLAIN OBJECT, not a DOMException. This is the cross-boundary shape;
  //   with an `instanceof DOMException` gate the hook falls through to the
  //   generic arm and sets an error for something the user did on purpose.
  it("sets no error when the call rejects with a plain AbortError shape", async () => {
    vi.spyOn(jobAnalysis, "runJobAnalysis").mockRejectedValue({ name: "AbortError" });
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "sk-ant-x", model: "claude-opus-5" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("still sets an error for a genuine failure", async () => {
    vi.spyOn(jobAnalysis, "runJobAnalysis").mockRejectedValue(new Error("parse"));
    const { result } = renderHook(() => useActionAnalysis({ apiKey: "sk-ant-x", model: "claude-opus-5" }));
    await act(async () => { await result.current.analyze("ctx"); });
    expect(result.current.error).toBe("parse");
  });
});
```

In `src/app/use-tasks-dedup.test.tsx`, append this `it` inside the existing `describe("useTasksDedup (plan-then-apply)")` block (starts at `:82`). It reuses that file's `renderHarness`, its module-level `showToast` spy and its `vi.mock("./task-dedup-call")` — all already in place at `:10`, `:54-61`:

```tsx
  // ★ A PLAIN OBJECT, not a DOMException — the cross-boundary shape. With an
  //   `instanceof DOMException` gate this falls through to the generic arm and
  //   the user sees an ERROR TOAST for a cancel they asked for.
  it("shows no error toast when the proposal rejects with a plain AbortError shape", async () => {
    vi.mocked(call.runDedupProposal).mockRejectedValue({ name: "AbortError" });
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Deduplicate & unify tasks" }));
    await waitFor(() => expect(call.runDedupProposal).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalledWith("error", expect.anything());
  });
```

- [ ] **Step 2: Run them and verify they fail**

```bash
npx vitest run src/app/use-action-analysis.test.ts src/app/use-tasks-dedup.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✕" /tmp/t2.log
```

Expected: non-zero exit; the two new cancel tests fail (an error is set / a toast fires). **If they PASS here, stop** — the harness is not reaching the catch block and the test would be vacuous.

- [ ] **Step 3: Apply the four edits**

`src/app/use-action-analysis.ts` — add the import beside the existing `./ai-errors` one:

```ts
import { isAbortError } from "./abort-error";
```

and replace line 34:

```ts
        if (isAbortError(e)) return null;
```

`src/app/use-tasks-dedup.tsx` — add the same import; replace line 121:

```ts
      if (isAbortError(e)) return;
```

★ The `reqId !== reqIdRef.current` stale-guard on the line **above** stays where it is. It discards a *superseded* request, which is a different condition from a *cancelled* one.

`src/app/use-project-proposal.ts` line 51 — keep the `signal?.aborted ||` short-circuit, replace only the `instanceof` arm:

```ts
        if (signal?.aborted || isAbortError(e)) return null;
```

`src/app/use-timelog-sync.ts` line 106 — same:

```ts
      if (signal.aborted || isAbortError(e)) return undefined;
```

★ Both short-circuits stay: they catch a cancel that never became a rejection, which the predicate cannot see.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npx vitest run src/app/use-action-analysis.test.ts src/app/use-tasks-dedup.test.tsx src/app/use-project-proposal.test.tsx src/app/use-timelog-sync.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=0`. The pre-existing abort tests in the last two files must still pass — they are the regression guard that the short-circuits were not lost.

- [ ] **Step 5: Typecheck, lint, full suite**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/full2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full2.log
```

Expected: `EXIT=0` from all three.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-tasks-dedup.tsx src/app/use-action-analysis.ts src/app/use-project-proposal.ts src/app/use-timelog-sync.ts src/app/use-action-analysis.test.ts src/app/use-tasks-dedup.test.tsx
git commit -F - <<'EOF'
fix(ai): a cancelled dedup or analysis no longer reports an error

Both sites gated on `instanceof DOMException`, which is unreliable across
the jsdom/Node boundary — a user cancel fell through to the generic arm and
surfaced an error toast (dedup) or an error state (action analysis). All
four abort sites now route through the shared isAbortError predicate; the
two that also read `signal.aborted` keep that short-circuit.

Closes open-followups §11.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: Actuals store reads both keys, clears both (§14, store half)

**Files:**
- Modify: `src/app/timelog-actuals-store.ts:47-56`
- Test: `src/app/timelog-actuals-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/timelog-actuals-store.test.ts` (it already imports `loadActualsCache`, `saveActualsCache`, `TIMELOG_ACTUALS_KEY`; add `clearActualsCache` to that import):

```ts
describe("legacy-key fallback", () => {
  const entry = (h: number) => ({
    fetchedAt: "2026-01-01T00:00:00Z",
    aggregates: { unattributed: { hours: h } },
  } as never);

  it("prefers the canonical entry when both keys exist", () => {
    saveActualsCache("legacy-code", entry(1));
    saveActualsCache("canonical", entry(2));
    expect(loadActualsCache("canonical", "legacy-code")?.aggregates?.unattributed.hours).toBe(2);
  });

  it("falls back to the legacy entry when the canonical one is absent", () => {
    saveActualsCache("legacy-code", entry(1));
    expect(loadActualsCache("canonical", "legacy-code")?.aggregates?.unattributed.hours).toBe(1);
  });

  it("returns undefined when neither key has an entry", () => {
    expect(loadActualsCache("canonical", "legacy-code")).toBeUndefined();
  });

  it("is safe when the legacy key equals the canonical one", () => {
    saveActualsCache("same", entry(3));
    expect(loadActualsCache("same", "same")?.aggregates?.unattributed.hours).toBe(3);
  });

  it("keeps the one-argument call working (no legacy key passed)", () => {
    saveActualsCache("legacy-code", entry(1));
    expect(loadActualsCache("canonical")).toBeUndefined();
  });

  // ★★ THE BUG THIS MIGRATION CAN MINT. Clear only the canonical entry and
  //    the next mount's read falls back to the legacy one — "Clear all"
  //    appears to work and the cleared data resurrects on remount.
  it("clear removes BOTH keys, so a cleared cache cannot resurrect", () => {
    saveActualsCache("legacy-code", entry(1));
    saveActualsCache("canonical", entry(2));
    clearActualsCache("canonical", "legacy-code");
    expect(loadActualsCache("canonical", "legacy-code")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run src/app/timelog-actuals-store.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✕" /tmp/t3.log
```

Expected: non-zero exit. The fallback and clear-both tests fail; the arity errors also surface under `tsc` in Step 5.

- [ ] **Step 3: Implement**

In `src/app/timelog-actuals-store.ts`, replace lines 47-56 with:

```ts
/** Reads the entry for `projectId`, falling back ONCE to `legacyProjectId`.
 *
 *  ★ Read-only on purpose. The four call sites are lazy `useState`
 *  initializers, so writing here would be a side effect during render
 *  (double-invoked under StrictMode). The entry migrates to the canonical
 *  key on the next `saveActualsCache`, which already writes whatever key it
 *  is given. The orphaned legacy entry is bounded by MAX_PROJECTS. */
export function loadActualsCache(projectId: string, legacyProjectId?: string): ActualsCacheEntry | undefined {
  const map = readMap();
  const hit = map[projectId];
  if (hit) return hit;
  if (legacyProjectId && legacyProjectId !== projectId) return map[legacyProjectId];
  return undefined;
}

/** ★★ Deletes BOTH keys. Clearing only the canonical one would let the
 *  legacy fallback above resurrect the cleared cache on the next mount. */
export function clearActualsCache(projectId: string, legacyProjectId?: string): void {
  const map = readMap();
  const ids = legacyProjectId && legacyProjectId !== projectId ? [projectId, legacyProjectId] : [projectId];
  const present = ids.filter((id) => id in map);
  if (present.length === 0) return;
  for (const id of present) delete map[id];
  writeDeviceJson(TIMELOG_ACTUALS_KEY, map);
}
```

- [ ] **Step 4: Run and verify pass**

```bash
npx vitest run src/app/timelog-actuals-store.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: `EXIT=0`, all pre-existing tests still green (the one-argument calls in them prove back-compat).

- [ ] **Step 5: Prove the clear-both test is not vacuous**

Temporarily revert `clearActualsCache` to deleting only `projectId`, re-run Step 4, and confirm the "cannot resurrect" test **FAILS**. Restore.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 7: Commit**

```bash
git add src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts
git commit -F - <<'EOF'
feat(timelog): actuals cache reads a legacy key and clears both

Prepares the move to the canonical per-device key. Read-only fallback (the
call sites are lazy state initializers); clear deletes both keys so a
cleared cache cannot resurrect through the fallback.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 4: Point the actuals cache at the canonical key (§14, wiring half)

**Files:**
- Modify: `src/app/use-timelog-sync.ts:38` (Args), `:45`, `:56-62`, `:345`
- Modify: `src/app/timelog-panel.tsx:57-62` (prop doc), `:92`, `:98-106`, `:363`
- Test: `src/app/use-timelog-sync.test.ts`

★★ **`timelog-panel.tsx`'s `projectId` local has TWO consumers and only one of them is the defect.** Besides keying the actuals cache it is passed to `useTimelogPickerScope` as the *in-place project-switch signal* (`use-timelog-picker-scope.ts:49-50`, `:213`), which resets one-shot seeding when the project changes without a remount. That use is correct and must keep receiving `ws.project?.code`. This task renames the local to `projectCode` to make the two ids unconfusable, and changes only which value the **sync** receives.

- [ ] **Step 1: Write the failing test**

`src/app/use-timelog-sync.test.ts` already has everything needed: a `beforeEach` that calls `window.localStorage.clear()` (`:31-37`), an `args(over)` helper defaulting `projectId: "p1"` and spreading overrides (`:39-41`), and top-level `it(...)` calls (no wrapping `describe`).

Add one import beside the existing ones at `:23`:

```ts
import { saveActualsCache } from "./timelog-actuals-store";
```

and append at the end of the file:

```ts
it("seeds from a cache written under the legacy project-code key", () => {
  // A user who fetched before the key moved has their entry under the old
  // project CODE. The hook reads the canonical key first, so without the
  // fallback their KPIs and "Last synced" line come back empty.
  saveActualsCache("OLD-CODE", { fetchedAt: "2026-01-01T00:00:00Z" });
  const { result } = renderHook(() =>
    useTimelogSync(args({ projectId: "canonical-id", legacyProjectId: "OLD-CODE" })),
  );
  expect(result.current.fetchedAt).toBe("2026-01-01T00:00:00Z");
});

it("prefers the canonical entry over the legacy one", () => {
  saveActualsCache("OLD-CODE", { fetchedAt: "2026-01-01T00:00:00Z" });
  saveActualsCache("canonical-id", { fetchedAt: "2026-06-06T00:00:00Z" });
  const { result } = renderHook(() =>
    useTimelogSync(args({ projectId: "canonical-id", legacyProjectId: "OLD-CODE" })),
  );
  expect(result.current.fetchedAt).toBe("2026-06-06T00:00:00Z");
});
```

★ `ActualsCacheEntry.aggregates` is optional (a directory-only "Load people" writes an entry without it), so a bare `fetchedAt` is a valid entry and keeps these tests free of the aggregate shape.

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run src/app/use-timelog-sync.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✕" /tmp/t4.log
```

Expected: non-zero exit (`legacyProjectId` is not a known Args member; `fetchedAt` is `undefined`).

- [ ] **Step 3: Thread `legacyProjectId` through the hook**

`src/app/use-timelog-sync.ts` — in the `Args` type, after line 38:

```ts
  projectId: string;
  /** The pre-0.211.1 store key (`ws.project?.code`). Read-only fallback so a
   *  cache written before the key moved is still found. See open-followups §14. */
  legacyProjectId?: string;
```

After line 45:

```ts
  const legacyProjectId = args.legacyProjectId;
```

Replace lines 56-62's four reads:

```ts
  const [aggregates, setAggregates] = useState<ActualsAggregate | undefined>(() => loadActualsCache(projectId, legacyProjectId)?.aggregates);
  const [fetchedAt, setFetchedAt] = useState<string | undefined>(() => loadActualsCache(projectId, legacyProjectId)?.fetchedAt);
  // Displayable directory users + distinct projects seen in the latest fetch.
  // Seeded from the per-project cache so the matching tables survive a view
  // remount (the KPIs already restore from `aggregates` — keep them in sync).
  const [users, setUsers] = useState<TimelogUser[]>(() => loadActualsCache(projectId, legacyProjectId)?.users ?? []);
  const [projectRefs, setProjectRefs] = useState<TimelogProjectRef[]>(() => loadActualsCache(projectId, legacyProjectId)?.projectRefs ?? []);
```

Line 345, inside `clearAll`:

```ts
    clearActualsCache(projectId, legacyProjectId);
```

★ The four `saveActualsCache(projectId, …)` calls (`:136`, `:178`, `:218`, `:334`) are **unchanged** — writes always go to the canonical key, which is what migrates the entry.

- [ ] **Step 4: Rewire the panel**

`src/app/timelog-panel.tsx` — replace the prop doc at `:57-62` with:

```tsx
  /** Canonical per-device store key (`portfolioCurrentId ?? "default"`). Keys
   *  BOTH per-device Timelog stores (picker scope and actuals cache). */
  projectKey?: string;
```

Replace line 92:

```tsx
  // `ws.project?.code`. NOT a store key — it is the in-place project-switch
  // SIGNAL consumed by useTimelogPickerScope, plus the legacy actuals-cache key
  // kept only as a read fallback. The code is user-editable, which is why it
  // stopped keying the cache (open-followups §14).
  const projectCode = ws.project?.code ?? "default";
```

In the `useTimelogSync({...})` call, replace `projectId,` (line 105) with:

```tsx
    projectId: projectKey,
    legacyProjectId: projectCode,
```

In the `useTimelogPickerScope({...})` call, replace `projectId,` (line 363) with:

```tsx
    projectId: projectCode,
```

★ Do **not** rename the picker-scope hook's `projectId` prop — its contract is documented at `use-timelog-picker-scope.ts:49-50` and is unchanged.

- [ ] **Step 5: Run and verify pass**

```bash
npx vitest run src/app/use-timelog-sync.test.ts src/app/timelog-panel.test.tsx src/app/timelog-picker-store.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4.log
```

Expected: `EXIT=0`. If `timelog-panel.test.tsx` fails on the picker-scope seeding, the wrong value was threaded — re-check Step 4.

★ `timelog-panel.test.tsx` is the file the register's §39 records as a CI flake (a partial-failure toast). If a timeout failure appears **there and only there**, do not raise its timeout — re-run once and note it.

- [ ] **Step 6: Typecheck, lint, full suite**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/full4.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full4.log
```

- [ ] **Step 7: Commit**

```bash
git add src/app/use-timelog-sync.ts src/app/timelog-panel.tsx src/app/use-timelog-sync.test.ts
git commit -F - <<'EOF'
fix(timelog): key the actuals cache on the canonical project id

The cache was keyed on `ws.project?.code`, which is user-editable, so a code
rename orphaned it while the picker scope (canonical key) survived — the
picker then restored a selection for bookings that were no longer loaded.
Both per-device stores now share the canonical key; the old code key is read
once as a fallback and cleared alongside the new one.

Closes open-followups §14.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 5: `FilePickerButton` primitive (§15, primitive half)

**Files:**
- Create: `src/app/file-picker-button.tsx`
- Test: `src/app/file-picker-button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/file-picker-button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePickerButton } from "./file-picker-button";

function renderPicker(over: Partial<React.ComponentProps<typeof FilePickerButton>> = {}) {
  const onFile = vi.fn();
  const { container } = render(
    <FilePickerButton label="Load theme file…" accept="application/json,.json" onFile={onFile} {...over} />,
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  return { onFile, input };
}

describe("FilePickerButton", () => {
  it("clicking the button opens the file input", async () => {
    const user = userEvent.setup();
    const { input } = renderPicker();
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: "Load theme file…" }));
    expect(click).toHaveBeenCalled();
  });

  // ★ The input is sr-only, NOT display:none — a hidden input cannot be
  //   clicked in every browser. So it must be removed from the tab order
  //   explicitly, or it is a SECOND tab stop announcing the same name as
  //   the Button. axe reports missing accessible names, never duplicated
  //   ones, so nothing automated would catch that.
  it("the input is not a tab stop", async () => {
    const user = userEvent.setup();
    const { input } = renderPicker();
    const button = screen.getByRole("button", { name: "Load theme file…" });
    // ★ .focus() proves nothing — it succeeds on tabIndex={-1}. Only a real
    //   tab walk proves the input is out of the sequential order.
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.tab();
    expect(document.activeElement).not.toBe(input);
  });

  it("does not use display:none", () => {
    const { input } = renderPicker();
    expect(input.className).toContain("sr-only");
    expect(input.className).not.toContain("hidden");
  });

  it("calls onFile with the picked file", async () => {
    const user = userEvent.setup();
    const { onFile, input } = renderPicker();
    await user.upload(input, new File(["{}"], "a.json", { type: "application/json" }));
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe("a.json");
  });

  // ★ Without the value reset the browser fires no change event for a
  //   re-pick of the SAME file, so "remove, then re-add the same logo"
  //   silently does nothing.
  it("fires again when the same file is picked twice", async () => {
    const user = userEvent.setup();
    const { onFile, input } = renderPicker();
    const file = () => new File(["{}"], "a.json", { type: "application/json" });
    await user.upload(input, file());
    await user.upload(input, file());
    expect(onFile).toHaveBeenCalledTimes(2);
  });

  it("disables the button when asked", () => {
    renderPicker({ disabled: true });
    expect(screen.getByRole("button", { name: "Load theme file…" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npx vitest run src/app/file-picker-button.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Error" /tmp/t5.log
```

Expected: non-zero exit, module not found.

- [ ] **Step 3: Implement**

Create `src/app/file-picker-button.tsx`:

```tsx
"use client";

// One way to open a file dialog. Replaces two hand-rolled shapes that had
// diverged onto the same settings surface (open-followups §15).
//
// ★★ The Button is the control; the input is only its file dialog. Three
// properties are load-bearing and each closes a real defect:
//   1. `sr-only`, never `display:none` — a display:none input cannot be
//      clicked in every browser.
//   2. `tabIndex={-1}` + `aria-hidden` — an sr-only input is otherwise a
//      SECOND tab stop announcing the same accessible name as the Button.
//      axe reports missing names, never duplicated ones, so nothing
//      automated catches a regression here; the unit test above does.
//   3. A real <button> rather than a styled <label>. A <label> is not
//      focusable, so a focus ring on it can never render — the label shape
//      this replaces had no visible focus indicator at all (WCAG 2.4.7),
//      and axe has no focus-visibility rule to catch that either.
//
// Owns NO validation: mime/size/parse rules stay with the caller, which is
// why `onFile` hands back the raw File.

import { useRef, type ChangeEvent } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

export interface FilePickerButtonProps {
  /** Visible button text AND its accessible name. Caller translates. */
  label: string;
  /** Forwarded verbatim to the input's `accept`. */
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function FilePickerButton({
  label, accept, onFile, disabled = false, variant = "secondary", size = "sm",
}: FilePickerButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset BEFORE dispatching so re-picking the same file fires again.
    e.target.value = "";
    if (!file) return;
    onFile(file);
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onChange}
      />
    </>
  );
}
```

- [ ] **Step 4: Run and verify pass**

```bash
npx vitest run src/app/file-picker-button.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```

Expected: `EXIT=0`, 6 tests passed.

- [ ] **Step 5: Prove the tab-stop test is not vacuous**

Temporarily delete `tabIndex={-1}` from the input, re-run Step 4, and confirm "the input is not a tab stop" **FAILS**. Restore.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 7: Commit**

```bash
git add src/app/file-picker-button.tsx src/app/file-picker-button.test.tsx
git commit -F - <<'EOF'
feat(ds): add a FilePickerButton primitive

Button + the sr-only input it owns, with the tab-stop and same-file re-pick
behaviour settled in one place. No call sites yet.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 6: Move the three pickers onto it (§15, call sites)

**Files:**
- Modify: `src/app/theme-gallery.tsx:12`, `:39`, `:42-45`, `:66-88`
- Modify: `src/app/color-scheme-editor.tsx:3`, `:146-149`, `:212-215`
- Modify: `src/app/branding-image-input.tsx:2`, `:24-27`, `:52-64`

- [ ] **Step 1: Migrate `theme-gallery.tsx`**

Change the handler signature (lines 42-45) from a `ChangeEvent` to a `File`:

```tsx
  function onFile(file: File) {
    setBusy(true);
    setError(null);
```

(the rest of the body is unchanged) and replace the JSX block at `:66-88`:

```tsx
      <div>
        <FilePickerButton
          label={t(lang, "themeGalleryLoadFile")}
          accept="application/json,.json"
          disabled={busy}
          onFile={onFile}
        />
      </div>
```

Imports: add `import { FilePickerButton } from "./file-picker-button";`, drop `Button` if it has no other use in the file, and drop `useRef` and `ChangeEvent` from the React import. Delete the `inputRef` declaration at `:39`.

★ Verify each removal is real before deleting — an unused import is a **fatal** lint error, and so is a still-used one you removed:

```bash
grep -n "useRef\|ChangeEvent\|Button" src/app/theme-gallery.tsx
```

- [ ] **Step 2: Migrate `color-scheme-editor.tsx`**

Change `onImportFile` (line 146-149) to take a `File`:

```tsx
  function onImportFile(file: File) {
    const reader = new FileReader();
```

Replace the `<label>` at `:212-215`:

```tsx
        <FilePickerButton
          label={t(lang, "schemeImport")}
          accept="application/json,.json"
          onFile={onImportFile}
        />
```

Add the import. Then check whether `ChangeEvent` is still used anywhere in the file and drop it from line 3 if not:

```bash
grep -n "ChangeEvent" src/app/color-scheme-editor.tsx
```

★ Expect a visual change: the Import control becomes a DS `Button` while its neighbours keep the file-local `btn` string. Accepted per the spec — correctness over local consistency.

- [ ] **Step 3: Migrate `branding-image-input.tsx`**

Change `onFile` (lines 24-27) to take a `File` and drop the manual reset (the primitive owns it):

```tsx
  function onFile(file: File) {
    // Cap on the RAW file bytes (matches the original appearance-section check) —
    // NOT the base64 data-URL length, which inflates ~33% and would reject
    // otherwise-valid ~400 KB logos.
    if (file.size > MAX_BYTES) {
```

(the rest of the body is unchanged) and replace the `<label>` at `:52-64`:

```tsx
      <div className="flex items-center gap-2">
        <FilePickerButton
          label={props.label}
          accept="image/png,image/jpeg,image/webp,image/gif"
          onFile={onFile}
        />
```

Add the import; drop `ChangeEvent` from line 2 and `FOCUS_RING`/`TRANSITION` from line 3 **only if** the remove button below no longer uses them:

```bash
grep -n "ChangeEvent\|FOCUS_RING\|TRANSITION" src/app/branding-image-input.tsx
```

★ All validation stays exactly where it is. The primitive hands over picker chrome only.

- [ ] **Step 4: Run the affected suites**

```bash
npx vitest run src/app/theme-gallery.test.tsx src/app/color-scheme-editor.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✕" /tmp/t6.log
```

Expected: `EXIT=0`. `theme-gallery.test.tsx:53-62` (the tab-order test) must pass **unchanged** — it is the regression guard for the duplicate-name fix and proves the migration preserved it.

★ There is no `appearance-section.test.tsx` (verified absent 2026-07-31), so `BrandingImageInput` has no panel-level suite of its own — its migration is covered only by `tsc`, the lint gate and the new `file-picker-button.test.tsx`. Eye-verify the logo/favicon pickers in Settings → Appearance before the release commit.

★ If a test queries the picker by `getByLabelText(/import/i)`, it may now resolve differently — the accessible name moved from the wrapping `<label>` to the Button. Update the query to `getByRole("button", { name: … })`; do **not** re-add a label to make an old query pass.

- [ ] **Step 5: Typecheck, lint, dup gate, full suite**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run dup:check > /tmp/dup6.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dup6.log
npm run test:run > /tmp/full6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full6.log
```

Expected: `EXIT=0` from all four. `dup:check` should be no worse than before and is expected to improve.

- [ ] **Step 6: Commit**

```bash
git add src/app/theme-gallery.tsx src/app/color-scheme-editor.tsx src/app/branding-image-input.tsx src/app/theme-gallery.test.tsx src/app/color-scheme-editor.test.tsx
git commit -F - <<'EOF'
refactor(settings): move all three file pickers onto FilePickerButton

Two shapes had diverged onto one settings surface. The label shape also had
no visible focus indicator — a <label> is not focusable, so its focus ring
could never render (WCAG 2.4.7, invisible to axe). All three sites now use
the Button+ref shape; branding keeps its own mime/size validation.

Closes open-followups §15.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 7: Retire `form.noteLog` (§29)

**Files:**
- Modify: `src/app/task-form-context.tsx:45-47` (+ its `NoteLogEntry` import)
- Modify: `src/app/use-task-submit.ts:167-173`, `:341`
- Modify: `src/app/task-form-fields.tsx:632`
- Test: `src/app/use-task-submit.test.ts:57`, `:597`; `src/app/task-form-modal.test.tsx:243-254`, `:288`, `:320`, `:328-330`, `:300`

★ The type is derived — `TaskFormDraft = ReturnType<typeof emptyForm>` (`task-form-context.tsx:51`) — so deleting the field from `emptyForm` deletes it from the type, and `tsc --noEmit` then reports **every** stale literal as an excess-property error. That is the discovery mechanism for this task; run it early and often.

- [ ] **Step 1: Delete the source of the dead state**

`src/app/task-form-context.tsx` — delete lines 45-47:

```ts
    // Running note log — appended in-form, persisted on save. Separate from the
    // freeform `notes` field. Timestamps are stamped in the add handler.
    noteLog: [] as NoteLogEntry[],
```

Then drop `NoteLogEntry` from that file's imports if it has no other use:

```bash
grep -n "NoteLogEntry" src/app/task-form-context.tsx
```

`src/app/use-task-submit.ts` — delete line 341 (`noteLog: task.noteLog ?? [],`).

`src/app/task-form-fields.tsx` line 632 — the fallback button count becomes a literal:

```tsx
              {/* Always 0: this branch renders only for an UNSAVED task, which
                  has no id for the write-through path to append to. The draft
                  deliberately carries no note log at all (open-followups §29). */}
              {t(lang, "noteLogTitle")} (0)
```

`src/app/use-task-submit.ts` — extend the comment at `:167-173`, replacing its first sentence:

```ts
        // ★★ `noteLog` is DELIBERATELY absent — from this payload AND from the
        // form draft itself (`emptyForm` carries no such field). The note log is
        // WRITE-THROUGH —
```

- [ ] **Step 2: Let tsc find every stale site**

```bash
npx tsc --noEmit > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -n "noteLog" /tmp/t7.log
```

Expected: non-zero exit, one error per remaining literal. Work the list; the known ones are handled in Steps 3-4.

- [ ] **Step 3: Update `use-task-submit.test.ts`**

Delete `noteLog: [],` from the draft fixture at line 57.

At line 597, delete the assertion that pins the seeding:

```ts
    expect(draft.noteLog).toHaveLength(opened.noteLog?.length ?? 0);
```

★ **Do NOT delete the surrounding `describe` block or its two `it`s** (`:616-630`). They assert that Save does not write a stale log over the live row — the data-loss guard `fe779f32` added, and the reason this entry exists at all. Only the seeding assertion goes.

Rewrite the block comment at `:568-572` so it stops describing the deleted behaviour:

```ts
// The note log is written STRAIGHT THROUGH to the workspace by NoteLogPanel /
// the floating notes window while the editor is open — it never touches the
// form draft, which carries no note log at all. Save must therefore never
// write anything note-log-shaped back over the live row.
```

- [ ] **Step 4: Update `task-form-modal.test.tsx`**

Delete `DRAFT_NOTE_LOG` (`:251-254`) and the `beforeEach` stub at `:287-289` — replace with `stubTaskForm({})` if the harness requires a call, else delete the `beforeEach` entirely.

Rewrite the `PANEL_ENTRIES` comment at `:243-245`:

```tsx
// TWO entries, so the summary count is distinguishable from the unsaved-task
// fallback's 0. There is no competing draft copy any more — the form carries
// no note log (open-followups §29) — so the count can only come from these.
```

Line 300 — delete `expect(screen.queryByText("Stale draft note")).toBeNull();`. No such state exists; the assertion would be vacuous.

Line 320 — the unsaved-task fallback now reads `(0)`:

```tsx
    const button = screen.getByRole("button", { name: `${t(EN, "noteLogTitle")} (0)` });
```

Lines 328-330 — keep the positive assertion, delete the now-vacuous negative, and say what the test actually proves:

```tsx
    // The panel holds 2 and the unsaved-task fallback renders 0, so "(2)" can
    // only have come from the live panel props.
    expect(screen.getByText(`${t(EN, "noteLogTitle")} (2)`)).toBeInTheDocument();
```

★ Honest note: with the draft copy gone the old 1-vs-2 discriminator is structurally impossible, because the bug it guarded against is. Do not leave a negative assertion that *looks* like a discriminator and proves nothing.

- [ ] **Step 5: Run the affected suites**

```bash
npx vitest run src/app/use-task-submit.test.ts src/app/task-form-modal.test.tsx src/app/task-form-fields.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |✕" /tmp/t7.log
```

Expected: `EXIT=0`. `task-form-fields.test.tsx:194-196` (an empty draft reads "Notes log (0)") must still pass, now against the literal.

- [ ] **Step 6: Typecheck, lint, full suite**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/full7.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full7.log
```

- [ ] **Step 7: Commit**

```bash
git add src/app/task-form-context.tsx src/app/use-task-submit.ts src/app/task-form-fields.tsx src/app/use-task-submit.test.ts src/app/task-form-modal.test.tsx
git commit -F - <<'EOF'
refactor(tasks): remove the dead noteLog field from the task form draft

The submit payload stopped carrying it in fe779f32 (the note log is
write-through and owns itself), but the draft still seeded it, where its only
reader was a disabled button's permanently-zero count. Removing the field
leaves nothing for a future writer to put back into the payload, which is the
data-loss bug that commit fixed.

Closes open-followups §29.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 8: Register + AGENTS.md

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `AGENTS.md` (only if a grep hits)

- [ ] **Step 1: Grep AGENTS.md for the retired symbols**

```bash
grep -n "form.noteLog\|clearActualsCache\|loadActualsCache\|instanceof DOMException\|color-scheme-editor\|theme-gallery" AGENTS.md
```

Correct any hit in place. ★ A landmine bullet's *tail* is where resolution status lives and nothing re-reads tails — that is how the last stale claim survived. If a bullet describes one of these as current behaviour, fix the bullet, not just the register.

- [ ] **Step 2: Close the four entries in the summary table**

In `docs/open-followups.md`, change the `State` cell for rows 11, 14, 15 and 29 to `**CLOSED 0.211.1** — see Provenance`, and strike the item text with `~~…~~` (matching how row 34 records a closed entry).

- [ ] **Step 3: Add the two new rows**

Append to the same table:

```markdown
| 46 | A `<label>`-wrapped file input has no visible focus indicator | 0.211.1 | S | closed for 3 sites — pattern open |
| 47 | `chat-panel.tsx` clicks a `display:none` file input | 0.211.1 | S | open — contradicts §15's own warning |
```

- [ ] **Step 4: Write the two new sections**

Insert after §45, before `## Decided — do not re-litigate`:

```markdown
## 46. A `<label>`-wrapped file input has no visible focus indicator — pattern open

Found while grounding §15. `color-scheme-editor.tsx` and `branding-image-input.tsx` both put
`INTERACTIVE` (→ `focus:ring-2`) on a `<label>` that wraps an `sr-only` `<input type="file">`. A
`<label>` is not focusable, so its `focus:` variant can never match; focus lands on the 1px clipped
input and **nothing visible changes**. WCAG 2.4.7.

★ Nothing catches it. axe has no focus-visibility rule, and the accessible NAME is fine (a wrapping
`<label>` supplies it), so the one property axe does check passes. Same blind-spot family as §15's
duplicate-name finding and §21's.

**Closed for the three sites 0.211.1 touched** — all now use `FilePickerButton`, which is a real
`<button>`. The entry stays open as a PATTERN: `focus:` on a non-focusable wrapper is a mistake
anyone can repeat, and `focus-within:` is the fix if a label shape is ever genuinely wanted.

★ Sweep for it with `grep -rn "focus:ring" src/app --include=*.tsx | grep -i "label"` — presence of a
ring class proves nothing about whether the element it sits on can receive focus.

---

## 47. `chat-panel.tsx` clicks a `display:none` file input — open, pre-existing

`chat-panel.tsx:805` gives its attachment input `className="hidden"` (Tailwind `display:none`) and
opens it via `fileInputRef.current?.click()`. That is exactly what §15 warns against — both theme
pickers use `sr-only` precisely because a `display:none` input cannot be clicked in every browser.

★ Scoped out of the 0.211.1 batch deliberately: the attachment flow is multi-file with its own
classification and size caps (`chat-attachments.ts`), so it is a bigger read than swapping one class.
`step0-import-panel.tsx` is the same class of flow and was excluded for the same reason, though it
uses a plain visible input and is not affected by this particular bug.

**Fix when taken:** move it onto `FilePickerButton` (which would need a `multiple` prop — deliberately
NOT added speculatively in 0.211.1) or, minimally, swap `hidden` for `sr-only` plus `tabIndex={-1}`
and `aria-hidden`.
```

- [ ] **Step 5: Record what closed each item in Provenance**

Add a subsection under `## Provenance`:

```markdown
### 0.211.1 — the small-correctness batch

| was | what closed it |
|---|---|
| §11 abort check misreports a cancel | pure `abort-error.ts` `isAbortError` (reads `.name`, never `instanceof`), applied at all four sites; the two that also read `signal.aborted` keep that short-circuit |
| §14 two per-device keys | actuals cache moved to the canonical `portfolioCurrentId` key; `loadActualsCache` reads the legacy project code once as a fallback and `clearActualsCache` deletes both, so a cleared cache cannot resurrect through it |
| §15 two file-picker shapes | `FilePickerButton` (DS `Button` + the `sr-only` input it owns); theme-gallery, color-scheme-editor and branding-image-input all migrated |
| §29 dead `form.noteLog` | field removed from `emptyForm`, so the derived `TaskFormDraft` type dropped it and `tsc` found every stale literal |

★ **§11's "four call sites" was already an undercount of the PATTERN when it closed.**
`use-raci-suggest.tsx:203` was added by 0.211.0, after the entry was written, and reads `.name`
correctly by hand — as do `chat-panel.tsx:478` and `use-alloc-plan.tsx:166`. Three verbatim copies of
the same read-plus-comment remain; they are not defects, but they are `dup:check` fuel and the helper
is now there to absorb them if the gate ever flags them.

★ **§15 turned up two findings the entry did not have**, now §46 and §47. The register's own scoping
("the follow-up is scoped to those two") was right about what to change and wrong about what was
there to find — the third and fourth pickers each carried their own defect.
```

- [ ] **Step 6: Verify the file still reads correctly**

```bash
grep -n "^## " docs/open-followups.md | tail -12
```

Expected: §45, §46, §47, then `Decided`, `Provenance`, `Standing notes` — in that order.

- [ ] **Step 7: Commit**

```bash
git add docs/open-followups.md AGENTS.md
git commit -F - <<'EOF'
docs: close open-followups 11, 14, 15 and 29; open 46 and 47

Two findings surfaced while grounding 15 and neither was in the entry: a
label-wrapped file input can never show a focus ring, and chat-panel clicks
a display:none input, which 15 itself warns against.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 9: Release 0.211.1

★ §11 and §14 change user-visible behaviour, so this is not internal-only work and does take a bump. A patch keeps the `0.211.x` codename "Samatar" — do **not** mint a new one, and specifically do not take "Bodard", which §44 reserves for S6.

**Files:**
- Modify: `src/app/version.ts:5-6`
- Modify: `CHANGELOG.md`
- Modify: `package.json`, `package-lock.json` (two occurrences), `README.md`, `docs/CODEMAPS/*.md` (five headers)

- [ ] **Step 1: Bump `version.ts`**

Lines 5-6:

```ts
export const APP_VERSION = "0.211.1";
export const APP_BUILD_DATE = "2026-07-31"; // 0.211.1: small-correctness batch (Samatar)
```

`APP_MILESTONE` stays `"Samatar"`. No new `versionHighlight*` key (a patch adds no headline feature), so `APP_HIGHLIGHT_KEYS` is untouched.

- [ ] **Step 2: Add the CHANGELOG entry**

At the top of `CHANGELOG.md`, matching the file's existing entry format:

```markdown
## 0.211.1 — "Samatar" — 2026-07-31

**Fixed**
- Cancelling an AI task-dedup or Action Center analysis no longer reports it as an error. The abort check gated on `instanceof DOMException`, which is unreliable across runtimes, so a deliberate cancel fell through to the generic error arm.
- The TimeLog actuals cache is keyed on the canonical project id instead of the editable project code, so renaming the code no longer orphans fetched bookings while the project-scope picker keeps its selection. A cache written under the old key is still read.

**Changed**
- The three file pickers in Settings → Appearance share one `FilePickerButton` control. The two that were built as a styled `<label>` had no visible keyboard focus indicator; they do now.
- The task form draft no longer carries a `noteLog` field. It was dead state — the note log writes straight through to the workspace and the draft's copy was never saved.
```

- [ ] **Step 3: Bump the five ungated sites**

**No gate checks any of these.** Verified in sync at `0.211.0` on 2026-07-31; keep them that way.

```bash
# package.json line 3, package-lock.json lines 3 and 9
# ★ line 566's "0.21.2" is a DEPENDENCY version — do not touch it
grep -n '"version": "0.211.0"' package.json package-lock.json
# README badge line 5 — version only; the codename "Samatar" is unchanged
grep -n 'version-v0.211.0' README.md
# five codemap headers
grep -n "App 0.211.0" docs/CODEMAPS/*.md
```

Edit each hit `0.211.0` → `0.211.1`. Re-run the greps and expect **no** hits.

- [ ] **Step 4: Run the full gate set, each unpiped**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/dup.log
npm run test:run > /tmp/full.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full.log
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/build.log
```

Every one must print `EXIT=0`. A gate result is a measurement, not a property — do not carry an earlier run's number forward.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -F - <<'EOF'
chore(release): 0.211.1

Small-correctness batch: abort-check, TimeLog cache key, FilePickerButton,
dead task-form state. Bumps version.ts plus the five ungated version sites.

Claude-Session: https://[session link removed]
EOF
```

- [ ] **Step 6: STOP — do not push, open an MR or merge**

Push, MR and merge happen only on an explicit instruction from the user. When that comes, the chain is:

1. `git push -u origin <branch>`
2. `glab mr create …`
3. **Poll the `refs/merge-requests/<iid>/head` pipeline** to `status:success` yourself.
4. `glab mr merge <iid> --remove-source-branch --yes`
5. Sync main, confirm the post-merge main pipeline is green.

★ **NEVER `glab mr merge --auto-merge`** — it checks the branch-head pipeline, not the MR-ref one, and merges instantly pre-green. It has bitten this repo twice.

---

## Notes carried from the spec

- **No golden regeneration.** No serializer, sanitizer or codec is touched, so `golden-workspace.test` must stay green without a fixture commit. If it goes red, something in this batch reached further than intended — investigate, do not regenerate.
- **No i18n keys.** No `A11Y_VIEWS`, CSP or palette change.
- **None of the four is reachable by the axe gate**, for four different reasons (Settings → Appearance is not the scanned Settings sub-section; the task form's create mode is not seeded in e2e; dedup and analysis sit behind an unconfigured AI key; the actuals cache is per-device state e2e never exercises). The vitest suites are the only automated coverage, and §46's focus-visibility defect has none at all — it is closed by construction.
