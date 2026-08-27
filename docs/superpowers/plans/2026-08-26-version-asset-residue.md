# Version/asset residue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close §254, §255, §256 and §260, and repair the five `COLLECTION_SPECS` `nameField`s that
name a field no record carries.

**Architecture:** Five independent changes on one branch, each self-contained. One transport fix in
`turso-pipeline.ts` with app-wide reach; one pure-function extraction in `history-panel.tsx`; one
test fixture widened from 5 seeded slices to all 17; one registry repair adding a composed-label
escape hatch; one comment plus its pin. Nothing here shares state with anything else here — a task
that has to be dropped costs only itself.

**Tech stack:** TypeScript, React 19, vitest 4.1.8 (`npm run test:run`), fake timers for the
transport work. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-version-asset-residue-design.md` (commit `a5e53771`).
Two decisions were revised after that spec was approved, and this plan is the authority on both:
§255 uses **literal seeds plus a completeness assertion** rather than a registry-derived fixture
(the file forbids the cast that derivation needs), and a **fifth task** repairs the broken
`nameField`s (measured after the spec was written).

---

## File structure

| File | Change | Task |
|---|---|---|
| `src/app/turso-pipeline.ts` | `postPipeline` owns the whole exchange; timer covers the body read | 1 |
| `src/app/turso-pipeline.test.ts` | stalled-body abort, timer-count on 4 exit paths, non-JSON body | 1 |
| `src/app/history-panel.tsx` | new exported `recordSelection`; `restoreRecord` uses it | 2 |
| `src/app/history-panel.test.tsx` | 3 pure tests + 1 call-site pin with a mocked diff view | 2 |
| `src/test/workspace-records.ts` | NEW — the 17 shared record builders + `arraysFixture` | 3 |
| `src/app/version-restore.test.ts` | fixture seeds all 17 list slices; completeness assertion | 3 |
| `src/app/version-diff.ts` | `nameOf` on `CollectionSpec`; 5 spec rows repaired; `recordLabel` | 4 |
| `src/app/resource-foundation.ts` | `roleLabel` param widened to `Pick<Role, …>` | 4 |
| `src/app/version-diff.test.ts` | label tests incl. the removed-record side selection | 4 |
| `src/app/version-diff-view.test.tsx` | row controls stay distinct when two labels collide | 4 |
| `src/app/task-manager.tsx` | comment at `getVersionPayload` recording the §254 decision | 5 |
| `src/app/task-manager.restore-backfill.test.tsx` | payload key-set test (excludes/includes) | 5 |
| `docs/open-followups.md` | §254/§255/§256 closed; §260 corrected then closed; §261 filed | 6 |
| `src/app/version.ts`, `CHANGELOG.md`, + 6 satellites via `version:sync` | release | 6 |

**Line endings.** Every `src/app/*.ts(x)` in this repo is CRLF in the working tree and LF in the
index (`git ls-files --eol` → `i/lf w/crlf`). The `Write` tool re-lines a file to LF; `Edit` does
not. **Use `Edit` for every source file below, never `Write`.** `docs/*.md` are LF via
`.gitattributes` and are safe either way. After each source commit, confirm with:

```bash
git ls-files --eol src/app/turso-pipeline.ts src/app/history-panel.tsx src/app/version-diff.ts
```
Expected: `i/lf w/crlf` on each. `i/lf w/lf` means the file was re-lined — fix before committing.

**Never read a gate's exit code through a pipe.** Redirect, echo the unpiped status, then grep the
file. `npm run test:run | tail` reports `tail`'s status and discards the diagnostic.

---

## Task 1: Bound the whole Turso exchange, not just the headers

**Files:**
- Modify: `src/app/turso-pipeline.ts` (`postPipeline`, `rollbackBestEffort`, `runTursoPipeline`)
- Test: `src/app/turso-pipeline.test.ts`

**Context.** `postPipeline` arms an `AbortController` at `timeoutMs`, awaits `fetch`, and clears the
timer in a `finally`. `fetch` resolves when the **headers** arrive, so the timer is disarmed before
`runTursoPipeline` calls `await res.json()`. A server that sends headers and then stalls the body
hangs forever, on every Turso caller in the app. Measured: `json()` on a `Response` over a
never-closing `ReadableStream` is still pending at 300ms with no signal armed, and an abort raised
*during* an in-progress body read rejects `AbortError` — so keeping the timer armed is a working fix.

- [ ] **Step 1: Write the failing test**

Add to `src/app/turso-pipeline.test.ts`, inside the existing `describe("runTursoPipeline timeout")`
block (after `"honors an explicit timeoutMs"`):

```ts
  /** A fetch that RESOLVES its headers immediately and then stalls the body
   *  forever. The abort signal is wired into the stream so an abort raised
   *  during the body read surfaces as a stream error, which is what a real
   *  fetch body does. */
  function stubStalledBodyFetch() {
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream({
        start(ctrl) {
          init?.signal?.addEventListener("abort", () =>
            ctrl.error(new DOMException("The operation was aborted.", "AbortError")),
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // ★★★ THE TIMER USED TO BE DISARMED WHEN THE HEADERS LANDED, so this case —
  // headers OK, body never completes — hung forever on every Turso caller in
  // the app. The sibling test "clears the abort timer once the fetch resolves"
  // stays green under BOTH the old and the new placement (it asserts no LEAKED
  // timer after the call returns, which was always true), which is exactly why
  // it never caught this. Mutation-proof this one by moving `clearTimeout` back
  // above the body read: it must go red.
  it("aborts a stalled BODY, not just a stalled connection", async () => {
    vi.useFakeTimers();
    stubStalledBodyFetch();
    const p = runTursoPipeline(cfg, [{ sql: "SELECT 1" }]);
    const settled = vi.fn();
    void p.then(settled, settled);
    await vi.advanceTimersByTimeAsync(DEFAULT_PIPELINE_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toMatchObject({ hint: "storage-unreachable" });
  });
```

- [ ] **Step 2: Run it and watch it hang, then fail**

```bash
npx vitest run src/app/turso-pipeline.test.ts -t "stalled BODY" > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files|stalled" /tmp/t1.log
```
Expected: FAIL. The rejection never arrives, so the run ends on the assertion after the final
`advanceTimersByTimeAsync` — either an unresolved-promise assertion failure or the file's 20s
`testTimeout`. Both are the red we want; a PASS here means the stub is wrong, not that the code is
already correct.

- [ ] **Step 3: Make `postPipeline` own the whole exchange**

In `src/app/turso-pipeline.ts`, replace the `postPipeline` function and its docstring:

```ts
/** POST a pipeline request with an AbortController-based timeout, and read the
 *  response body INSIDE the armed window.
 *  ★★★ THE BODY READ IS THE POINT. `fetch` resolves when the HEADERS arrive, so
 *  clearing the timer on its return leaves `res.json()` unbounded: a server that
 *  sends headers and then stalls the body hung forever, on every caller of
 *  `runTursoPipeline` — workspace load and save, snapshots, chat threads,
 *  document assets and version history alike. Measured, not reasoned: `json()`
 *  on a never-completing body is still pending with no signal armed, and an
 *  abort raised DURING a body read rejects `AbortError`. Returning the parsed
 *  text rather than the `Response` is what makes that structural — a caller
 *  cannot forget to read the body in the window, because there is no `Response`
 *  to hand it.
 *  ★ AbortController + setTimeout (rather than `AbortSignal.timeout`, used by
 *  the server routes) so fake-timer tests can drive the abort deterministically. */
async function postPipeline(
  config: TursoConfig,
  stmts: SqlStmt[],
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: stmts.map(execute) }),
      signal: controller.signal,
    });
    // ★ Read the body even on 401 and other non-ok statuses. It is discarded,
    // but draining it inside the armed window keeps a stalled error body from
    // hanging and releases the connection instead of leaving it undrained.
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Adapt the two callers**

In the same file, replace the body of `runTursoPipeline` between the `config` guard and the results
loop:

```ts
  let res: { status: number; ok: boolean; text: string };
  try {
    res = await postPipeline(config, stmts, timeoutMs);
  } catch {
    // Network failure, or a timeout abort on either the headers or the body:
    // either way the host is unreachable.
    throw new StorageNotReadyError("storage-unreachable");
  }
  if (res.status === 401) {
    throw new StorageNotReadyError("Turso auth token rejected. Check the token in Settings.");
  }
  if (!res.ok) {
    throw new Error(`Turso returned ${res.status}. Try again later.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(res.text);
  } catch {
    // A non-JSON 200 used to escape as a raw SyntaxError from `res.json()`.
    throw new Error("Turso returned an unexpected response shape.");
  }
  if (!raw || typeof raw !== "object" || !("results" in raw)) {
    throw new Error("Turso returned an unexpected response shape.");
  }
```

`rollbackBestEffort` needs no change — it already discards whatever `postPipeline` returns, and now
gets a bounded body read for free.

- [ ] **Step 5: Run the whole file**

```bash
npx vitest run src/app/turso-pipeline.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" /tmp/t1.log
```
Expected: EXIT=0, all tests pass including the pre-existing `"clears the abort timer once the fetch
resolves"`.

- [ ] **Step 6: Add the no-leaked-timer assertions for all four exit paths**

Append inside the same `describe("runTursoPipeline timeout")`:

```ts
  // The timer now spans the body read, so it is disarmed on FOUR different exit
  // paths and a leak on any one of them would abort an unrelated later request.
  // The rollback path is the interesting one: it posts a SECOND pipeline, so it
  // arms a second timer.
  it.each([
    ["ok", () => new Response(JSON.stringify({ results: [{ type: "ok" }] }), { status: 200 })],
    ["non-ok", () => new Response("nope", { status: 500 })],
    ["401", () => new Response("no", { status: 401 })],
  ])("leaves no armed timer on the %s path", async (_name, make) => {
    vi.useFakeTimers();
    stubFetch(make);
    await runTursoPipeline(cfg, [{ sql: "SELECT 1" }]).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no armed timer when a statement error triggers the rollback", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes(errorResults))
      .mockResolvedValueOnce(jsonRes({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runTursoPipeline(cfg, beginBatch)).rejects.toThrow(/boom/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a non-JSON 200 as a shape error, not a raw SyntaxError", async () => {
    stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await expect(runTursoPipeline(cfg, [{ sql: "SELECT 1" }]))
      .rejects.toThrow(/unexpected response shape/);
  });
```

- [ ] **Step 7: Run them**

```bash
npx vitest run src/app/turso-pipeline.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" /tmp/t1.log
```
Expected: EXIT=0.

- [ ] **Step 8: Mutation-proof the stalled-body test**

Move the disarm back above the body read and confirm the new test — and only it — goes red.

```bash
node -e '
const fs=require("fs"), p="src/app/turso-pipeline.ts";
let s=fs.readFileSync(p,"utf8");
const from="    const text = await res.text();\r\n    return { status: res.status, ok: res.ok, text };";
const to="    clearTimeout(timer);\r\n    const text = await res.text();\r\n    return { status: res.status, ok: res.ok, text };";
if(s.split(from).length!==2) throw new Error("anchor not unique/found");
fs.writeFileSync(p, s.replace(from,to));'
npx vitest run src/app/turso-pipeline.test.ts > /tmp/mut.log 2>&1; echo "MUTANT_EXIT=$?"
grep -E "stalled BODY|Tests " /tmp/mut.log
```
Expected: `MUTANT_EXIT=1` with `"aborts a stalled BODY"` among the failures.

Revert with the inverse write (`git checkout --` is deny-blocked in this environment):

```bash
node -e '
const fs=require("fs"), p="src/app/turso-pipeline.ts";
let s=fs.readFileSync(p,"utf8");
const to="    const text = await res.text();\r\n    return { status: res.status, ok: res.ok, text };";
const from="    clearTimeout(timer);\r\n    const text = await res.text();\r\n    return { status: res.status, ok: res.ok, text };";
if(s.split(from).length!==2) throw new Error("mutant anchor not found — already reverted?");
fs.writeFileSync(p, s.replace(from,to));'
git diff --stat src/app/turso-pipeline.ts
```
Expected: the `git diff --stat` shows only the intended Task 1 changes, with no `clearTimeout` line
inside the `try`. If the mutant edit re-lined the file, `git ls-files --eol` will say `i/lf w/lf` —
repair before committing.

- [ ] **Step 9: Commit**

```bash
git add src/app/turso-pipeline.ts src/app/turso-pipeline.test.ts
git commit -m "fix(turso): bound the whole exchange, not just the headers

postPipeline armed an AbortController, awaited fetch, and cleared the timer
in a finally -- but fetch resolves when the HEADERS arrive, so the res.json()
body read that followed ran with nothing armed. A server that sent headers
and then stalled the body hung forever, on every runTursoPipeline caller:
workspace load and save, snapshots, chat threads, document assets, version
history.

postPipeline now reads the body to text inside the armed window and returns
{status, ok, text} instead of a Response, so a caller cannot forget to read
it in the window -- there is no Response to hand it. Non-ok and 401 bodies
are drained too, which also releases the connection.

Measured both halves before writing it: json() on a never-completing body is
still pending at 300ms with no signal armed, and an abort raised during a
body read rejects AbortError.

The pre-existing 'clears the abort timer once the fetch resolves' test stays
green under both the old and the new placement, which is why it never caught
this; the new test is mutation-proved against the old placement."
```

---

## Task 2: One rule, one place, for a single-record restore

**Files:**
- Modify: `src/app/history-panel.tsx` (new export beside `selectableSelection`; `restoreRecord`)
- Test: `src/app/history-panel.test.tsx`

**Context.** `restoreRecord` passes a caller-supplied key straight to `restore` as
`{ [key]: "all" }` without asking whether that change carries `restorable: false`. Unreachable
today, because `version-diff-view.tsx` renders no restore button on a non-restorable row (`const
revertible = c.restorable !== false`, twice — once per layout). §256 records why the previous slice
declined to fix it: an unreachable guard cannot be tested without first building the unreachable
state. Extracting a pure function removes that objection, which is the reason for this shape rather
than an inline `if`.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/history-panel.test.tsx`. Import `recordSelection` alongside whatever that file
already imports from `./history-panel`, and add a new describe block at the end:

```ts
describe("recordSelection", () => {
  const change = (collection: string, recordId: number, restorable?: false): VersionChange => ({
    collection, collectionLabel: collection, kind: "list", recordId,
    recordLabel: `#${recordId}`, type: "modified", fields: [],
    ...(restorable === false ? { restorable: false as const } : {}),
  });

  it("selects a restorable record by its key", () => {
    const changes = [change("tasks", 1)];
    expect(recordSelection(changeKey("tasks", 1), changes)).toEqual({ [changeKey("tasks", 1)]: "all" });
  });

  it("refuses a change marked restorable: false", () => {
    const changes = [change("documents", 7, false)];
    expect(recordSelection(changeKey("documents", 7), changes)).toBeNull();
  });

  it("refuses a key that names no change in the diff", () => {
    expect(recordSelection(changeKey("tasks", 99), [change("tasks", 1)])).toBeNull();
  });
});
```

`changeKey` and the `VersionChange` type come from `./version-restore` and `./version-diff`
respectively; add them to that file's imports if they are not already there.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/history-panel.test.tsx -t "recordSelection" > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Tests |recordSelection is not" /tmp/t2.log
```
Expected: FAIL — `recordSelection is not a function`, or a TS/import error naming it.

- [ ] **Step 3: Implement it**

In `src/app/history-panel.tsx`, immediately after `selectableSelection`:

```ts
/** The single-record counterpart of `selectableSelection`: the selection for ONE
 *  change key, or `null` when that key must not be restored.
 *  ★★ The handler and the two select-all paths must enforce ONE rule from ONE
 *  place. `version-diff-view.tsx` renders no restore control on a non-restorable
 *  row, so today nothing can hand this a refused key — but that invariant lives
 *  in the RENDER path alone, and a third caller, a keyboard shortcut or a layout
 *  that forgets one of its two `revertible` gates re-opens it. The symptom would
 *  be the one this whole slice exists to remove: a control that reports success
 *  and reverts nothing (`docs/open-followups.md` §256). */
export function recordSelection(key: string, changes: readonly VersionChange[]): RestoreSelection | null {
  const change = changes.find((c) => changeKey(c.collection, c.recordId) === key);
  if (!change || change.restorable === false) return null;
  return { [key]: "all" };
}
```

Then in `restoreRecord`, between the `rf` guard and the `runExclusiveRestore` call:

```ts
  const restoreRecord = (key: string) => {
    const rf = restoreFrom;
    if (!rf) return;
    // Refuse a key `applyRestore` would skip, rather than reporting success over
    // a row nothing reverted. Unreachable through the rendered UI today — see
    // `recordSelection`.
    const sel = recordSelection(key, diff ?? []);
    if (!sel) return;
    void runExclusiveRestore(() => restore(rf.id, sel, rf.label)).then((ok) => {
```

The rest of the handler is unchanged.

- [ ] **Step 4: Run them**

```bash
npx vitest run src/app/history-panel.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" /tmp/t2.log
```
Expected: EXIT=0, every pre-existing test in the file still passing.

- [ ] **Step 5: Pin the call site**

The three tests above would all still pass with `restoreRecord`'s use of `recordSelection` deleted —
they test the function, not the handler. Add a call-site pin at the end of the same describe block:

```ts
  // ★★★ THE THREE TESTS ABOVE DO NOT PIN THE CALL SITE — every one of them
  // passes with `restoreRecord`'s use of `recordSelection` deleted. The real
  // view renders no restore control on a non-restorable row, which is the same
  // unreachability that kept §256 open, so nothing driving the real component
  // can reach this handler with a refused key. Hence the stub: it is necessary,
  // not convenient.
  it("does not call restore when the handler is handed a non-restorable key", async () => {
    const restore = vi.fn().mockResolvedValue(true);
    const changes: VersionChange[] = [{
      collection: "documents", collectionLabel: "Documents", kind: "list", recordId: 7,
      recordLabel: "Doc", type: "modified", fields: [], restorable: false,
    }];
    renderPanelWithStubbedView({ restore, changes });
    await userEvent.click(screen.getByRole("button", { name: "stub-restore-record" }));
    expect(restore).not.toHaveBeenCalled();
  });
```

**This test goes in a NEW file**, `src/app/history-panel.record-guard.test.tsx`, not in
`history-panel.test.tsx`. Verified: that file mocks only `./confirm-dialog` and renders the **real**
`VersionDiffView` throughout, so a `vi.mock("./version-diff-view")` there would change every test in
it. The new file holds the mock, the helper and this one test; the three pure tests from Step 1 stay
in `history-panel.test.tsx`.

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryPanel } from "./history-panel";
import { changeKey } from "./version-restore";

// A stand-in for the diff view that exposes `onRestoreRecord` as a plain button,
// so a test can hand the handler a key the real view would never offer.
vi.mock("./version-diff-view", () => ({
  VersionDiffView: ({ onRestoreRecord }: { onRestoreRecord?: (key: string) => void }) => (
    <button type="button" onClick={() => onRestoreRecord?.(changeKey("documents", 7))}>
      stub-restore-record
    </button>
  ),
}));

const versions = [{
  id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z",
  trigger: "manual", label: "Baseline", summary: null,
}];
```

The handler is only passed once `restoreFrom !== null`, which is armed by the per-row
**"Compared with current"** control (`history-panel.tsx:371` — it sets `compareFrom`, `restoreFrom`
and runs the diff in one click). Its accessible name is `rowLabel`-qualified, so the button is
`"Compared with current – Baseline"` (EN DASH U+2013), matching how the sibling tests address
`"Restore this state – Baseline"`:

```tsx
    render(<HistoryPanel lang="en-US" versions={versions as never} busy={false}
      onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
    fireEvent.click(screen.getByRole("button", { name: "Compared with current – Baseline" }));
    await waitFor(() => screen.getByRole("button", { name: "stub-restore-record" }));
    fireEvent.click(screen.getByRole("button", { name: "stub-restore-record" }));
    expect(restore).not.toHaveBeenCalled();
```

with `loadDiff` resolving the single non-restorable change the assertion in Step 5 declares.

- [ ] **Step 6: Run and mutate**

```bash
npx vitest run src/app/history-panel*.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" /tmp/t2.log
```
Expected: EXIT=0.

Then delete the two guard lines from `restoreRecord` (`const sel = …` / `if (!sel) return;`,
restoring `{ [key]: "all" }` inline) and re-run: the call-site test must go red while the three pure
tests stay green. Restore them with an inverse anchored write and confirm `git diff --stat` shows
only the intended change.

- [ ] **Step 7: Commit**

```bash
git add src/app/history-panel.tsx src/app/history-panel*.test.tsx
git commit -m "fix(history): refuse a non-restorable key in restoreRecord (§256)

restoreRecord passed a caller-supplied change key straight to restore as
{ [key]: 'all' } without asking whether that change carries restorable:
false. Unreachable through the rendered UI -- version-diff-view renders no
restore control on a non-restorable row -- so the invariant 'a selection
never contains a skipped key' was held by the render path alone, while the
sibling whole-state path held it in selectableSelection.

recordSelection is the single-record counterpart of that function, so the
handler and both select-all paths now enforce one rule from one place. The
extraction is also what makes the guard testable: an unreachable guard
cannot be tested without building the unreachable state, which is why the
previous slice declined to add one inline.

Three pure tests plus a call-site pin -- the pure three all pass with the
handler's use of the helper deleted, so the pin uses a stubbed diff view to
hand the handler a key the real view would never offer."
```

---

## Task 3: Seed every list slice in the array-as-object guard

**Files:**
- Modify: `src/app/version-restore.test.ts` (the `arrays` fixture inside `"turns no array-typed
  slice of the workspace into an object"`, plus one new test)

**Context.** That test is the only protection against a `kind: "singleton"` spec landing on an array
slice — a corruption that spreads the array into an object and makes every backend drop the slice on
the next save, on all six write paths, permanently. Its assertion is already generic; its fixture is
not. `COLLECTION_SPECS` holds **17** `kind: "list"` specs (12 in the first block, 5 in the later
ones — verify with `grep -c 'kind: "list"' src/app/version-diff.ts` minus the 4 non-spec lines the
bare grep also matches: the type alias, the interface, a comment and `diffList`'s `base()`).

★ Two of the 17 can never be corrupted whatever `kind` they declare: `documents` and
`documentVersions` carry `restorable: false`, and `applyRestore` hits that guard **before** the kind
branch. The file's own comment says so and measured it. So a full mutation sweep must predict
**15 red, 2 green** — a run where `documents` goes red means the mutation harness, not the fixture,
is what is being measured.

★★ **Do not reach for a cast.** `version-restore.test.ts:75-87` carries a ★★★ prohibition with a
measured record behind it: the first cut used `as never` on all five fixtures and thereby encoded
five wrong facts tsc could not see (string ids where `ProjectDocument`/`DocVersion` take `number`,
`capturedAt` for `savedAt`, missing `title`/`source`/`op`, a `date` field `CalendarEvent` lacks, and
an `InsightType`/`InsightStatus` pair that are members of neither union). Every record below is
annotated and cast-free.

- [ ] **Step 1: Write the failing completeness test**

Add immediately after the existing `"turns no array-typed slice of the workspace into an object"`
test, inside the same describe block:

```ts
  // ★★★ THE FIXTURE IS THE COVERAGE, and a fixture is a snapshot: list slice 18
  // lands uncovered and nothing says so, which is the hole the test above exists
  // to close, one level up. This pins the fixture to the registry so a new
  // `kind: "list"` spec fails HERE, naming itself, on the day it lands.
  it("seeds every kind:'list' slice the registry declares", () => {
    const seeded = new Set(Object.keys(arraysFixture("Old")));
    const missing = COLLECTION_SPECS
      .filter((s) => s.kind === "list")
      .map((s) => s.key)
      .filter((k) => !seeded.has(k));
    expect(missing).toEqual([]);
  });
```

Add `COLLECTION_SPECS` to the existing `./version-diff` import at the top of the file.

- [ ] **Step 2: Create the shared fixture module and move the five existing builders into it**

Create `src/test/workspace-records.ts`. Move `kItem`, `insight`, `doc`, `docVersion` and `calEvent`
into it unchanged — carrying their ★★★ no-cast comment — and export them, plus the fixture itself,
renamed from `arrays` to `arraysFixture` so the change is visible at every call site:

```ts
export const arraysFixture = (n: string): Partial<Workspace> => ({
  knowledgeItems: [kItem("a", n)],
  insights: [insight(1, n === "Old" ? "low" : "high")],
  documents: [doc(1, n)],
  documentVersions: [docVersion(1, n)],
  calendarEvents: [calEvent(1, n)],
});
```

Import it into `version-restore.test.ts` and point the existing `const version = ws(arrays("Old"))`
/ `const now = ws(arrays("New"))` lines at the new name. `src/test/**` is already in
`vitest.config.ts`'s `coverage.exclude`, so this raises no floor and needs no config change — it is
where `row-unique-names.ts` and `toolbar-order.ts` already live. It starts at five slices; Steps 4
and 5 take it to seventeen.

★ `ws()` stays in each test file. The two files need different `Partial<Workspace>` bases, and
`version-diff.test.ts` already has its own.

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run src/app/version-restore.test.ts -t "seeds every" > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -A 6 "seeds every" /tmp/t3.log
```
Expected: FAIL listing the twelve unseeded keys: `tasks raid changes milestones stakeholders
resources roles disciplines grades budgets absences shifts`.

- [ ] **Step 4: Add the twelve record builders**

Add these to `src/test/workspace-records.ts` beside the five Step 2 moved there, exported, all
return-type-annotated, no casts:

```ts
  const taskRec = (id: number, n: string): Task =>
    ({ id, taskName: `Task ${n}`, assignee: "Ann", assigneeEmail: "ann@example.com",
       dueDate: "2026-02-01", lastUpdateDate: "2026-01-15", priority: "Low",
       status: "To Do", blockers: "", description: "" });
  const raidRec = (id: number, n: string): RaidItem =>
    ({ id, category: "R", title: `Risk ${n}`, status: "Open", linkedTaskIds: [],
       raisedDate: "2026-01-01", causedByRaidIds: [], stakeholderIds: [] });
  const changeRec = (id: number, n: string): ChangeItem =>
    ({ id, title: `Change ${n}`, description: "", type: "Scope", status: "Proposed",
       raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });
  const milestoneRec = (id: number, n: string): Milestone =>
    ({ id, name: `Milestone ${n}`, date: "2026-03-01", linkedTaskIds: [] });
  const stakeholderRec = (id: number, n: string): Stakeholder =>
    ({ id, name: `Stakeholder ${n}`, category: "Internal", influence: "Low",
       interest: "Low", raci: {} });
  const resourceRec = (id: number, n: string): Resource =>
    ({ id, firstName: `Res${n}`, lastName: "Example", roleId: 1,
       utilizationMode: "percent", utilization: {} });
  const roleRec = (id: number, n: string): Role =>
    ({ id, disciplineId: 1, gradeId: 1, internalRate: n === "Old" ? 100 : 110, externalRate: 200 });
  const disciplineRec = (id: number, n: string): Discipline => ({ id, name: `Discipline ${n}` });
  const gradeRec = (id: number, n: string): Grade => ({ id, name: `Grade ${n}` });
  const budgetRec = (id: number, n: string): BudgetBucket =>
    ({ id, name: `Bucket ${n}`, type: "tm", currency: "EUR", startDate: "2026-01-01",
       endDate: "2026-06-30", status: "open", allocations: [] });
  const absenceRec = (id: number, n: string): Absence =>
    ({ id, assignee: "Ann", startDate: "2026-04-01", endDate: "2026-04-05",
       type: "vacation", note: `Absence ${n}` });
  const shiftRec = (id: number, n: string): Shift =>
    ({ id, assignee: "Ann", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0], note: `Shift ${n}` });
```

Extend the type imports at the top of the file:

```ts
import type {
  Absence, BudgetBucket, ChangeItem, Discipline, Grade, Milestone, RaidItem,
  Resource, Role, Shift, Stakeholder, Task,
} from "./types";
```

- [ ] **Step 5: Seed all seventeen**

```ts
  // ★ Old and New must DIFFER in every slice. An identical record produces no
  // diff change; `applyRestore`'s singleton branch bails when the diff carries
  // no change for a spec, so the slice is never walked, never corrupted, and
  // invisible to the assertion — reproducing the exact hole this closes.
  const arraysFixture = (n: string): Partial<Workspace> => ({
    tasks: [taskRec(1, n)],
    raid: [raidRec(1, n)],
    changes: [changeRec(1, n)],
    milestones: [milestoneRec(1, n)],
    stakeholders: [stakeholderRec(1, n)],
    resources: [resourceRec(1, n)],
    roles: [roleRec(1, n)],
    disciplines: [disciplineRec(1, n)],
    grades: [gradeRec(1, n)],
    budgets: [budgetRec(1, n)],
    absences: [absenceRec(1, n)],
    shifts: [shiftRec(1, n)],
    knowledgeItems: [kItem("a", n)],
    insights: [insight(1, n === "Old" ? "low" : "high")],
    documents: [doc(1, n)],
    documentVersions: [docVersion(1, n)],
    calendarEvents: [calEvent(1, n)],
  });
```

★ `roles`, `disciplines` and `grades` are reference data and are excluded from
`isEmptyWorkspacePayload` (§242), but they are ordinary `kind: "list"` registry rows here and are
corrupted by the same mutation. The §242 exclusion does not carry across — the two lists answer
different questions.

- [ ] **Step 6: Update the stale comment above the test**

The existing comment says "FIVE SLICES, THREE COVERED". Replace it with:

```ts
  // ★★ SEVENTEEN SLICES, FIFTEEN COVERABLE. `documents` and `documentVersions`
  // carry `restorable: false`, and `applyRestore` hits that guard BEFORE the
  // kind branch — so neither can ever reach `mergeFields` and neither can be
  // corrupted here whatever `kind` its spec declares. Measured: flipping
  // `documents` to `"singleton"` leaves this test GREEN. They stay in the
  // fixture because the sibling completeness test requires every list spec, and
  // because `restorable` could be dropped from either row tomorrow.
```

- [ ] **Step 7: Run the file**

```bash
npx vitest run src/app/version-restore.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" /tmp/t3.log
npx tsc --noEmit > /tmp/tsc3.log 2>&1; echo "TSC_EXIT=$?"; head -20 /tmp/tsc3.log
```
Expected: EXIT=0 and TSC_EXIT=0. `npx tsc --noEmit` exits **2** on diagnostics, not 1. A type error
here means a record shape is wrong — fix the record, never add a cast.

- [ ] **Step 8: Mutation-sweep all seventeen list specs**

```bash
cat > /tmp/sweep.mjs <<'EOF'
import { execSync } from "node:child_process";
import fs from "node:fs";
const P = "src/app/version-diff.ts";
const src = fs.readFileSync(P, "utf8");
const keys = [...src.matchAll(/\{ key: "(\w+)", label: "[^"]*", kind: "list"/g)].map((m) => m[1]);
const results = [];
for (const k of keys) {
  const from = `{ key: "${k}", label:`;
  const line = src.split("\n").find((l) => l.includes(from));
  const mutated = line.replace('kind: "list"', 'kind: "singleton"');
  fs.writeFileSync(P, src.replace(line, mutated));
  let exit = 0;
  try { execSync(`npx vitest run ${"src/app/version-restore.test.ts"}`, { stdio: "pipe" }); }
  catch { exit = 1; }
  fs.writeFileSync(P, src);
  results.push([k, exit === 1 ? "RED" : "green"]);
  console.log(`${k.padEnd(18)} ${exit === 1 ? "RED" : "green"}`);
}
console.log("RED:", results.filter((r) => r[1] === "RED").length, "of", results.length);
EOF
node /tmp/sweep.mjs; echo "SWEEP_EXIT=$?"
git diff --stat src/app/version-diff.ts
```
Expected: **15 RED**, with `documents` and `documentVersions` green for the documented reason, and
`git diff --stat` empty for `version-diff.ts` (the sweep rewrites the original bytes after every
iteration). If any of the other 15 comes back green, that slice is not really covered — find out why
before proceeding; do not adjust the expected count to match the output.

★ The script writes `src` back verbatim, so it preserves CRLF. Confirm with `git ls-files --eol
src/app/version-diff.ts` → `i/lf w/crlf`.

- [ ] **Step 9: Commit**

```bash
git add src/app/version-restore.test.ts
git commit -m "test(version): seed every list slice in the array-as-object guard (§255)

The BUG-CLASS guard against a kind:'singleton' spec landing on an array
slice could only see slices its fixture populated: five seeded, of which
documents and documentVersions can never be corrupted (restorable: false is
checked before the kind branch), so three effective against seventeen list
specs in the registry.

All seventeen are now seeded with type-annotated, cast-free records that
differ between Old and New -- an identical record produces no diff change,
so applyRestore never walks the slice and the assertion cannot see it.

A sibling test pins the fixture's key set to the registry's, so list slice
18 fails there, naming itself, rather than landing silently uncovered.

Mutation-swept all seventeen: fifteen red, documents and documentVersions
green for the documented reason."
```

---

## Task 4: Repair the five `nameField`s that name a field no record carries

**Files:**
- Modify: `src/app/version-diff.ts` (`CollectionSpec`, `recordLabel`, `diffList`, `diffWorkspaces`,
  5 spec rows)
- Modify: `src/app/resource-foundation.ts` (`roleLabel` parameter type)
- Test: `src/app/version-diff.test.ts`

**Context, measured against the real sample workspace** (`sample-workspace-small.json` at the repo
root, not under `src/app/__fixtures__/`):

```
tasks       nameField=title    present on 0/14   <-- ALWAYS #id
resources   nameField=name     present on 0/5    <-- ALWAYS #id
roles       nameField=name     present on 0/6    <-- ALWAYS #id
absences    nameField=reason   present on 0/5    <-- ALWAYS #id
shifts      nameField=label    present on 0/4    <-- ALWAYS #id
```

Confirmed against the types, not only the data: `Task` has `taskName` and no `title`; `Resource` has
`firstName`/`lastName` and no `name`; `Role` has no name field at all (it is discipline × grade);
`Absence` and `Shift` both have `note`, not `reason`/`label`. `recordLabel` falls back to
`` `#${id}` ``, so every task, resource, role, absence and shift change in the version diff is
labelled by id. tsc cannot see it because `CollectionSpec.key` is `keyof Workspace` while
`nameField` is a bare `string`.

Two of the five cannot be fixed by correcting a field name: a resource's label is composed from two
fields, and a role's needs `disciplines` and `grades` — a cross-slice lookup `diffList` does not
currently have.

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `src/app/version-diff.test.ts`:

```ts
describe("record labels", () => {
  // ★★★ FIVE OF THE SIXTEEN nameFields NAMED A FIELD NO RECORD CARRIES, and
  // `recordLabel` falls back to `#id`, so every task, resource, role, absence
  // and shift change in the version diff was labelled by id. tsc could not see
  // it: `key` is `keyof Workspace` but `nameField` is a bare string. Measured
  // against sample-workspace-small.json — 0/14 tasks carried `title`, 0/5
  // resources and 0/6 roles carried `name`, 0/5 absences carried `reason`,
  // 0/4 shifts carried `label`.
  const labelFor = (older: Partial<Workspace>, newer: Partial<Workspace>, collection: string) =>
    diffWorkspaces(ws(older), ws(newer)).find((c) => c.collection === collection)?.recordLabel;

  it("labels a task by taskName", () => {
    expect(labelFor(
      { tasks: [taskRec(1, "Old")] },
      { tasks: [taskRec(1, "New")] },
      "tasks",
    )).toBe("Task New");
  });

  it("labels a resource by its composed display name", () => {
    expect(labelFor(
      { resources: [resourceRec(1, "Old")] },
      { resources: [resourceRec(1, "New")] },
      "resources",
    )).toBe("ResNew Example");
  });

  it("labels a role from the workspace's disciplines and grades", () => {
    const base = { disciplines: [disciplineRec(1, "Dev")], grades: [gradeRec(1, "Senior")] };
    expect(labelFor(
      { ...base, roles: [roleRec(1, "Old")] },
      { ...base, roles: [roleRec(1, "New")] },
      "roles",
    )).toBe("Discipline Dev Grade Senior");
  });

  it("labels absences and shifts by their note", () => {
    expect(labelFor({ absences: [absenceRec(1, "Old")] }, { absences: [absenceRec(1, "New")] }, "absences"))
      .toBe("Absence New");
    expect(labelFor({ shifts: [shiftRec(1, "Old")] }, { shifts: [shiftRec(1, "New")] }, "shifts"))
      .toBe("Shift New");
  });

  // ★★ A REMOVED record is gone from the NEWER workspace, so its label must be
  // resolved against the OLDER one. Renaming the discipline between the two
  // sides is what separates the branches: read the newer side and this returns
  // the new name for a record that no longer exists there.
  it("labels a removed role from the older workspace", () => {
    const older = { disciplines: [disciplineRec(1, "Dev")], grades: [gradeRec(1, "Senior")], roles: [roleRec(1, "Old")] };
    const newer = { disciplines: [disciplineRec(1, "Renamed")], grades: [gradeRec(1, "Senior")], roles: [] };
    const change = diffWorkspaces(ws(older), ws(newer)).find((c) => c.collection === "roles" && c.type === "removed");
    expect(change?.recordLabel).toBe("Discipline Dev Grade Senior");
  });

  // ★★★ BUG-CLASS GUARD. Any spec declaring a name source that its records do
  // not carry lands here — the fallback to `#id` is the only symptom, and
  // nothing else in the suite reads it.
  it("never falls back to #id for a fully-populated record", () => {
    const named = new Set(COLLECTION_SPECS.filter((s) => s.nameField || s.nameOf).map((s) => s.key));
    const changes = diffWorkspaces(ws(arraysFixture("Old")), ws(arraysFixture("New")));
    const byId = changes.filter((c) => named.has(c.collection) && c.recordLabel === `#${c.recordId}`);
    expect(byId.map((c) => c.collection)).toEqual([]);
  });
});
```

★ The record builders and `arraysFixture` come from `src/test/workspace-records.ts`, which Task 3
creates. Import them; do not copy them. `ws()` stays local to each test file — the two need
different `Partial<Workspace>` bases.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/version-diff.test.ts -t "record labels" > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "expected|Tests " /tmp/t4.log | head -20
```
Expected: FAIL on all six, with `#1` received where a name is expected, and a TS error on `s.nameOf`
(the property does not exist yet).

- [ ] **Step 3: Widen `roleLabel` so a partial role can be labelled**

In `src/app/resource-foundation.ts`, change the parameter type only — no call site changes:

```ts
/** Human label for a role: "Developer Senior". Empty string when role is undefined.
 *  ★ Takes only the two id fields it reads, so a caller holding a partial record
 *  (the version diff, which sees `Record<string, unknown>`) can use it without a
 *  cast. */
export function roleLabel(
  role: Pick<Role, "disciplineId" | "gradeId"> | undefined,
  disciplines: ReadonlyArray<Discipline>,
  grades: ReadonlyArray<Grade>,
): string {
```

- [ ] **Step 4: Add `nameOf` to the registry and thread the workspace**

In `src/app/version-diff.ts`:

```ts
import { resourceDisplayName, roleLabel } from "./resource-foundation";
```

```ts
/** Compose a record's label when a single field cannot express it. Receives the
 *  workspace the record came from — the OLDER one for a removed record, the
 *  NEWER one otherwise — because a role names itself through `disciplines` and
 *  `grades`, which is a cross-slice lookup a bare `nameField` cannot do. */
type RecordNameOf = (rec: Record<string, unknown>, ws: Workspace) => string;

interface CollectionSpec {
  key: keyof Workspace; label: string; kind: "list" | "singleton";
  nameField?: string; nameOf?: RecordNameOf; restorable?: false;
}
```

Repair the five rows:

```ts
  { key: "tasks", label: "Tasks", kind: "list", nameField: "taskName" },
  …
  { key: "resources", label: "Resources", kind: "list",
    nameOf: (r) => resourceDisplayName({ firstName: str(r.firstName), lastName: str(r.lastName) }) },
  { key: "roles", label: "Roles", kind: "list",
    nameOf: (r, ws) => roleLabel({ disciplineId: num(r.disciplineId), gradeId: num(r.gradeId) },
                                 ws.disciplines, ws.grades) },
  …
  { key: "absences", label: "Absences", kind: "list", nameField: "note" },
  { key: "shifts", label: "Shifts", kind: "list", nameField: "note" },
```

with two narrow accessors above the registry, so no cast is needed anywhere:

```ts
// ★ `diffList` holds records as `Record<string, unknown>`. These narrow a field
// to the primitive a label helper expects WITHOUT a cast — a cast here would
// re-admit exactly the class this repair exists to close: a spec naming a field
// the record does not carry, invisible to tsc.
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : -1);
```

★ `-1` is deliberate: no minted id is negative, so `roleLabel` misses the lookup and returns
`"n/a n/a"`, which `recordLabel` treats as a real name. That is honest — the record genuinely has no
resolvable role — and it is the same string the Resources report already shows.

Then `recordLabel` and the call chain:

```ts
function recordLabel(
  rec: Record<string, unknown> | undefined,
  id: RecordId,
  spec: CollectionSpec,
  ws: Workspace,
): string {
  const composed = rec && spec.nameOf ? spec.nameOf(rec, ws) : undefined;
  if (typeof composed === "string" && composed.trim()) return composed;
  const name = spec.nameField ? rec?.[spec.nameField] : undefined;
  return typeof name === "string" && name.trim() ? name : `#${id}`;
}

function diffList(
  spec: CollectionSpec, older: unknown[], newer: unknown[],
  olderWs: Workspace, newerWs: Workspace,
): VersionChange[] {
```

and inside `base`:

```ts
    recordId: id, recordLabel: recordLabel(rec, id, spec, type === "removed" ? olderWs : newerWs),
```

and at the `diffWorkspaces` call site:

```ts
    if (spec.kind === "list") out.push(...diffList(spec, older[spec.key] as unknown[], newer[spec.key] as unknown[], older, newer));
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/version-diff.test.ts src/app/version-restore.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" /tmp/t4.log
npx tsc --noEmit > /tmp/tsc4.log 2>&1; echo "TSC_EXIT=$?"; head -20 /tmp/tsc4.log
```
Expected: EXIT=0, TSC_EXIT=0. The pre-existing `"The label comes from each row nameField"` test
(insights/calendarEvents) is untouched by this change and must still pass.

★★ **This change can CREATE accessible-name collisions, and that is expected.** `#id` is unique by
construction; a name is not — two roles can both label as "Discipline Dev Grade Senior", and two
tasks can share a `taskName`. `version-diff-view.tsx` already builds its per-row control names
through `buildRowTokens`/`rowLabel`, which appends a 1-based occurrence index to **all** colliding
rows, so this is handled — but it is handled by a mechanism that was never exercised on this surface
while every label was unique. Add one test to `version-diff-view.test.tsx` rendering two changes
with the SAME `recordLabel` and assert the row controls stay distinct, using
`src/test/row-unique-names.ts` with `requireCollisionSeed: true` (two rows genuinely sharing a label
is exactly the collision seed it checks for). axe cannot see duplicate accessible names in any view
at any seed size, so a unit test is the only possible detector.

- [ ] **Step 6: Re-measure against the real sample data**

```bash
node -e '
const fs=require("fs");
const ws=JSON.parse(fs.readFileSync("sample-workspace-small.json","utf8"));
const pairs=[["tasks","taskName"],["resources",null],["roles",null],["absences","note"],["shifts","note"]];
for(const [k,f] of pairs){
  const arr=ws[k]||[];
  if(!f){console.log(k.padEnd(12)+" composed label (nameOf) — see the unit tests"); continue;}
  const have=arr.filter(r=>typeof r[f]==="string"&&r[f].trim()).length;
  console.log(k.padEnd(12)+" nameField="+f.padEnd(9)+" present on "+have+"/"+arr.length);
}'
```
Expected: `tasks` 14/14. **`absences` and `shifts` will still be 0/N** — `note` is optional on both
and the sample sets none, so those two keep falling back to `#id` on this data. That is correct and
must be recorded rather than papered over: the spec now names a field that exists, and an absence
with no note has no name to show.

- [ ] **Step 7: Commit**

```bash
git add src/app/version-diff.ts src/app/version-diff.test.ts src/app/version-diff-view.test.tsx src/app/resource-foundation.ts src/test/workspace-records.ts
git commit -m "fix(version): repair five nameFields that named a field no record carries

Measured against sample-workspace-small.json: tasks title 0/14, resources
name 0/5, roles name 0/6, absences reason 0/5, shifts label 0/4. Confirmed
against the types -- Task has taskName, Resource has firstName/lastName,
Role has no name field at all, and Absence and Shift both have note. So
every task, resource, role, absence and shift change in the version diff
was labelled '#id'.

tsc could not see it: CollectionSpec.key is keyof Workspace while nameField
is a bare string.

tasks, absences and shifts are corrected field names. Resources and roles
cannot be: a resource's label composes two fields and a role's needs
disciplines and grades, a cross-slice lookup diffList did not have. Both go
through a new optional nameOf(rec, ws), and diffList now receives both
workspaces so a REMOVED record resolves against the older one -- pinned by
a test that renames the discipline between the two sides.

roleLabel's parameter widens to Pick<Role, 'disciplineId'|'gradeId'> so the
diff can call it without a cast. A cast here would re-admit the very class
this repairs.

absences and shifts still show #id on the sample data because note is
optional and unset there. That is correct: the spec now names a field that
exists, and a record with no note has no name to show."
```

---

## Task 5: Record the §254 decision at the site

**Files:**
- Modify: `src/app/task-manager.tsx` (`getVersionPayload`, around line 1037)
- Test: `src/app/task-manager.restore-backfill.test.tsx`

**Context.** `getVersionPayload` enumerates its slices literally and `documentAssets` is not among
them, while the save set in `use-storage-backend.ts` carries it (8 references). So document image
bytes are outside version history at every layer: not captured, not diffed, not restorable. §254
judges this plausibly deliberate and the silence the real problem — no comment, no `restorable:
false` row standing in for it, no test. Its decision, which this task honours: **leave
`documentAssets` out and write the reason down.** Do not add the slice.

- [ ] **Step 1: Write the failing test**

Add to `src/app/task-manager.restore-backfill.test.tsx`:

```ts
  // ★★ `documentAssets` IS DELIBERATELY ABSENT (docs/open-followups.md §254).
  // A capture carrying image bytes changes the cost of every autosave-triggered
  // version on a Turso project, and that is a measurement, not a docs task. This
  // pins the decision so adding the slice is a conscious act that fails here
  // first. `documents` is the positive control: an absence assertion alone would
  // pass against a payload that was never built.
  it("captures documents but not documentAssets", async () => {
    const payload = await capturePayloadFromMountedApp();
    const keys = Object.keys(JSON.parse(payload));
    expect(keys).toContain("documents");
    expect(keys).not.toContain("documentAssets");
  });
```

★ `capturePayloadFromMountedApp` is not a new helper — that file already drives the app and reads a
captured payload in `"round-trips all six optional slices through getVersionPayload, not just
applyWorkspace"`. Reuse whatever that test uses to obtain the payload string; if it is inline, lift
it to a helper in the same file and have both call it.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/task-manager.restore-backfill.test.tsx -t "documentAssets" > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Tests |expected" /tmp/t5.log | head
```
Expected: FAIL if the helper does not exist yet. If it passes immediately, that is fine and
expected — the behaviour is already correct and this test pins it. Prove it is not vacuous by
temporarily adding `documentAssets` to `getVersionPayload`'s object and dep array, re-running (it
must go red), then reverting with an inverse anchored write.

- [ ] **Step 3: Write the comment**

In `src/app/task-manager.tsx`, directly above `const getVersionPayload = useCallback(`:

```tsx
  // ★★★ `documentAssets` IS DELIBERATELY ABSENT, and this comment is the record
  // of that decision (docs/open-followups.md §254). The SAVE set carries the
  // slice, so this is an omission from version history specifically, not a slice
  // that does not exist. Two reasons: a version row per capture carrying every
  // image byte in the project has a storage profile nothing else in this payload
  // has, and the asset table is Turso-side with its own lifecycle (an
  // `ENTITY_SPECS` row plus a separate byte side table — see
  // docs/AGENTS/documents.md, "Asset images (S3c-1)").
  // ★★ THE USER-VISIBLE CONSEQUENCE, so nobody has to derive it: deleting an
  // image from a document IS captured, because the referencing block changes and
  // `documents` is diff-visible — but restoring that version cannot bring the
  // bytes back. Two independent reasons for one outcome: `documents` is
  // `restorable: false`, and `documentAssets` is not in the payload at all.
  // ★ If it is ever added, decide the metadata slice and the byte side table
  // SEPARATELY — metadata is small and diffable, bytes are neither — and measure
  // the autosave cost first. Pinned by "captures documents but not
  // documentAssets" in task-manager.restore-backfill.test.tsx.
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/app/task-manager.restore-backfill.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Tests |Test Files" /tmp/t5.log
```
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx src/app/task-manager.restore-backfill.test.tsx
git commit -m "docs(version): record why documentAssets is out of the capture (§254)

getVersionPayload enumerates its slices literally and documentAssets is not
among them, while the save set carries it -- so image bytes are outside
version history at every layer: not captured, not diffed, not restorable.

§254's judgement was that this is plausibly deliberate and that the silence
is the problem: no comment, no restorable: false row standing in for it, no
test, so the next reader cannot tell an omission from a choice. This
honours its decision -- leave the slice out, write the reason down -- and
adds the test that makes adding it a conscious act.

documents is the test's positive control; an absence assertion alone passes
against a payload that was never built."
```

---

## Task 6: Register, prose sweep, release

**Files:**
- Modify: `docs/open-followups.md`, `src/app/version.ts`, `CHANGELOG.md`, README badge + 5 codemap
  headers (via `npm run version:sync`)

- [ ] **Step 1: Sweep prose for the old transport claim**

```bash
grep -rniE "timeout|abort" AGENTS.md docs/AGENTS/*.md docs/CODEMAPS/*.md docs/RUNBOOK.md | grep -iE "turso|pipeline|fetch" 
```
Correct anything stating or implying that the Turso timeout covers a whole request, or that a
`Response` is returned from `postPipeline`. If the sweep returns nothing, say so in the commit
rather than silently skipping the step.

- [ ] **Step 2: Close §254, §255, §256 in place**

Mark each `##` heading with the literal `— CLOSED 2026-08-26` marker. Do **not** move the entries.
For each, append a short "**Closed by:**" line naming the commit and what changed. §255's entry
still says "covers 5 of 17" — leave the filed text as the record, and let the closing line carry the
correction that only three of the five were ever effective.

- [ ] **Step 3: Correct §260 before closing it**

Rewrite the heading to name the real mechanism, then close it:

```
## 260. The Turso pipeline timeout stopped at the headers, so a stalled response BODY hung every caller — CLOSED 2026-08-26
```

The body must record, in the house style, that the entry as filed was **refuted by measurement**:
the version-history path does route through `runTursoPipeline`, which already armed an
`AbortController` at 15s, so a hung connection could never dead-lock the panel; what was real was
the body read after the disarm, and it was app-wide rather than history-scoped. Keep the original
text as the record of what was filed — it was reasoned from source by a cold review and says so.

- [ ] **Step 4: File §261 for what this slice did not fix**

The `nameField` repair leaves `CollectionSpec.nameField` a bare `string` that tsc cannot check
against the slice's record type. File it:

```
## 261. `CollectionSpec.nameField` is an unchecked string, so a spec can still name a field no record carries
```

Body: the five that were broken and are now fixed (with the sample-data command that measured them),
the type-level cause, the fact that the new `"never falls back to #id for a fully-populated record"`
test is the only detector and it depends on the fixture staying complete, and the option not taken —
making `CollectionSpec` generic in its key so `nameField` is `keyof Workspace[K][number]`, which is
awkward for a heterogeneous array and would need `version-diff.test.ts`'s registry push/pop test
rewritten.

- [ ] **Step 5: Verify the register counts still derive**

```bash
grep -cE "^## [0-9]+\." docs/open-followups.md
grep -E  "^## [0-9]+\." docs/open-followups.md | grep -c  "— CLOSED"
grep -E  "^## [0-9]+\." docs/open-followups.md | grep -cv "— CLOSED"
npm run followups:check 2>&1 | tail -5
```
The three greps must agree by construction. A partially-closed entry must never carry `— CLOSED`.

- [ ] **Step 6: Bump the version**

Pick a codename not already used — check with `grep -oE '"[A-Z][a-z]+"' CHANGELOG.md | sort -u`
before choosing. Edit `src/app/version.ts` (`APP_VERSION` → `0.262.0`, `APP_BUILD_DATE`,
`APP_MILESTONE`), add the `CHANGELOG.md` entry, then:

```bash
npm run version:sync
npm run version:check; echo "EXIT=$?"
```
Expected: EXIT=0. Exit **1** is drift (re-run `version:sync`); exit **2** means the gate could not do
its job (a missing file or a moved regex) — investigate, do not re-baseline.

★ `CHANGELOG.md` must carry **no** `[session link removed]...` URL.

- [ ] **Step 7: Run every local gate**

```bash
npx tsc --noEmit > /tmp/g-tsc.log 2>&1; echo "TSC=$?"
npx eslint src scripts e2e > /tmp/g-lint.log 2>&1; echo "LINT=$?"
npm run test:run > /tmp/g-test.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/g-test.log
npm run test:shuffle > /tmp/g-shuf.log 2>&1; echo "SHUF=$?"; grep -E "Test Files|Tests " /tmp/g-shuf.log
npm run test:coverage > /tmp/g-cov.log 2>&1; echo "COV=$?"; grep -E "All files|ERROR" /tmp/g-cov.log | head
npm run docs:claims:check > /tmp/g-claims.log 2>&1; echo "CLAIMS=$?"
npm run docs:symbols:check > /tmp/g-sym.log 2>&1; echo "SYM=$?"
npm run docs:scripts:check > /tmp/g-scripts.log 2>&1; echo "SCRIPTS=$?"
npm run size:check > /tmp/g-size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/g-dup.log 2>&1; echo "DUP=$?"
```

Every one must be 0 (tsc exits **2** on diagnostics). `test:shuffle` matters here because this slice
adds and reorders tests. Never run two vitest processes at once, and never read any of these through
a pipe.

★ `size:check` counts `readFileSync().split("\n").length`, one MORE than `wc -l`.
`history-panel.tsx` and `version-diff.ts` both grow in this slice — read their real numbers with:

```bash
node -e "for (const f of ['src/app/history-panel.tsx','src/app/version-diff.ts','src/app/task-manager.tsx']) console.log(f, require('fs').readFileSync(f,'utf8').split('\n').length)"
```

- [ ] **Step 8: Commit the closeout**

```bash
git add docs/open-followups.md src/app/version.ts CHANGELOG.md package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore(release): 0.262.0 — version/asset residue

Closes §254, §255, §256 and §260, and repairs five COLLECTION_SPECS
nameFields that named a field no record carries.

§260 is closed against a correction: the entry as filed said nothing on the
version-history path carried an AbortSignal or a timeout, and measurement
refutes that -- every version-store call routes through runTursoPipeline,
which already armed an AbortController at 15s. What was real is the body
read after the disarm, and it was app-wide rather than history-scoped.

§261 is filed for what this did not fix: nameField is still a bare string
tsc cannot check against the slice's record type."
```

- [ ] **Step 9: Stop**

Do not push, open an MR, or merge. Those happen only on an explicit instruction from the user
("release" = push → MR → poll pipeline → merge on green).

---

## Notes for the implementer

- **Two vitest processes at once will produce a false red.** A run carrying `Failed to start forks
  worker` is machine contention, not a defect.
- **`--reporter=basic` and `--minWorkers` do not exist** in vitest 4.1.8; use `--reporter=dot` and
  `--maxWorkers=N`.
- **Never `git commit --amend`** — this worktree shares its object store with two others, and an
  amend has swallowed a stranger's commit twice. New commits, `git commit --only <paths>`.
- **Never bare `git stash`/`git stash pop`** — the stash stack is shared across worktrees.
- **Do not run `npm ci`.** It wipes `node_modules` and aborts on a Windows EPERM lock.
- **After every mutation experiment, sweep for live mutants** before reporting anything: `git diff
  --stat` must show only intended changes.
