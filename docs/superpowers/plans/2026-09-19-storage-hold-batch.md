# Storage-hold batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §591, §548, §577 and §573: a load after a storage-target change replaces the activity log and budget history instead of merging another project's into it; no edit can start while a project load or project swap is pending; the budget-variance insight compares actuals with budget to date; the Open Points visual baseline is refreshed.

**Architecture:** §591 adds a pure `storageTargetKey` and a ref in `useStorageBackend` recording which target the in-scope workspace belongs to; the load effect and `reloadCurrentProject` merge only when it is unchanged. §548 publishes `loadPending` from `useStorageBackend` (an identity stamp set on every terminal branch of the load effect, plus a counter held by the nine project-swap ops), renders the existing `PanelSkeleton` in place of the main-window app tree while it is true, and gates the five background writers that do not unmount. §577 threads `today` into `budgetVarianceInsight` and compares actual hours with the bucket's own budget in the periods that have started. §573 re-baselines one PNG through its spec.

**Tech Stack:** Next.js (App Router, exact-pinned), React 19, TypeScript, vitest 4.1 + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-storage-hold-batch-design.md` (binding; deviations are ruled in "Plan deviations / rulings" below).

**Execution method:** subagent-driven (already chosen).

## Global Constraints

- Work in `C:/Projects/aipm-cockpit` on `fix/storage-hold-batch`. Use absolute paths in every tool call.
- No hand-rolled UI controls; reuse existing primitives (`PanelSkeleton`) and existing notice paths. Ask if none fits.
- Run only the gates each task names, one task at a time and in order. Never a full unit suite. Read exit codes unpiped.
- vitest always runs `--maxWorkers=1 --reporter=dot`, never two runs at once on this machine. The CONTROLLER announces "starting vitest" / "vitest done" to the peer session (worktree `C:/Projects/aipm-wt-a`) around every vitest run.
- `src/app/*.ts(x)` are CRLF: edit them with the Edit tool, never `sed -i`, never the Write tool on an existing file. Docs (`*.md`) are LF. `src/app/i18n.de.ts` only via a node utf8 write matching `\r\n`; EN/DE key parity.
- **No new i18n string** (spec). If a task seems to need one, stop and report it; do not add it.
- Commits cite §N; `Closes #NN` appears only in the MR description. Stage explicit paths; never `--amend`, never `git add -A` / `git add .`. Never stage `not-in-use.env.local.bak` or `sample-workspace-huge.json`; never read `not-in-use.env.local.bak`.
- Every "this is covered" claim is backed by a named mutation that turns the named test red. Revert every mutation before the next step and prove it with `git diff --stat`.
- `src/app/use-insight-recommendations.ts` is also edited by the peer's §534 (`fix/data-loss-batch`). The controller tells the peer before Task 4 edits it; whichever branch merges second resolves the conflict.
- Cite symbols, never line numbers, in docs and comments.
- Register max on `origin/main` is §591. This plan files no new register entry. If one becomes necessary, get its number from the peer session first.

## Global section V — how to run a gate

`$SCRATCH` is your session scratchpad directory. Use a fresh log name per run.

```bash
cd /c/Projects/aipm-cockpit
npx vitest run <files…> --maxWorkers=1 --reporter=dot > "$SCRATCH/<task>-vitest.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/<task>-vitest.log"
npx tsc --noEmit > "$SCRATCH/<task>-tsc.log" 2>&1; echo "EXIT=$?"
grep -c "error TS" "$SCRATCH/<task>-tsc.log"
npx eslint --max-warnings=0 <touched source and test files…>; echo "EXIT=$?"
```

- vitest passes only on `EXIT=0` **and** `Test Files  N passed (N)` with the N the task states. A missing path mixed with real ones is silently dropped at exit 0, so the N is load-bearing.
- tsc passes only on `EXIT=0` **and** a count of `0`. Run it after every test edit: vitest never typechecks.
- Never pipe a gate to read its exit code.
- Size ratchet (LIMIT 1600, counts `wc -l` + 1): `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`.

## Global section C — how to commit

```bash
cd /c/Projects/aipm-cockpit
MSG="$SCRATCH/<task>-msg.txt"
cat > "$MSG" <<'EOF'
<subject line given in the task>

<body given in the task>

Claude-Session: https://[session link removed]
EOF
git add -- <NEW files only, if any>
git commit -F "$MSG" --only -- <every path the task lists>
git show --stat HEAD
```

`git show --stat HEAD` must list exactly the task's paths.

## Plan deviations / rulings

Each ruling is where the tree contradicts or refines the spec.

1. **§591, the boot load keeps merging.** The spec says "an unknown or absent previous key counts as a change (replace)". Taken literally, the FIRST load of a session would replace, and that breaks the mutation-pinned test "MERGES a loaded activity log with entries appended locally — never replaces" in `use-storage-backend.test.tsx`, plus the §548 writer inventory's claim that activity appends made during the first load survive because the load merges. At boot the in-scope workspace holds nothing from another project: only this session's own appends for the target being loaded. **Ruling:** the load effect seeds the ref with the current key on its first hydrated run, so the boot load merges. Every later "unknown" case (the ref not re-stamped after an empty-load refusal or a failed load) still compares against the last applied key and so counts as a change.
2. **§591, the ref is also re-stamped in the load effect's suppress branch.** The spec names only the load effect's applied branch and `reloadCurrentProject`. The project ops apply their workspace BEFORE flipping the config and then arm `suppressNextLoadRef`, so the suppressed run is where "scope now holds THIS target's project" becomes true. Without the re-stamp, a same-project reload right after a project switch would replace (safe, but it would drop in-flight appends). This mirrors the existing `setLoadedBackend` re-stamp there.
3. **§591, local-file and IndexedDB targets key on the kind alone.** `StorageConfig` carries no file identity for `browser` / `local-*`. A different file is reached only through an op (which arms the suppress re-stamp) or "Pick storage file" (which writes the current project, so it is the same project).
4. **§577, a closed predecessor's spillover is kept.** The spec's budget-to-date is "the sum of `effectiveBudgetHours` over `bucketActivePeriods(bucket, plan)` filtered to periods whose start is ≤ `today`". Today's detector compares against the REPORTED budget, which is the own budget plus `spilloverInHours` (a closed predecessor's `winLossHours`, positive or negative). Dropping it would flag a successor as overspent while the carried-over remainder covers it, a regression the spec does not ask for. **Ruling:** budget to date = own budget to date + `spilloverInHours`, the spillover counted once the bucket's first period has started. It gets its own pin test and mutation.
5. **§573 is closed in its own task, not in the docs/register task.** Closing it before the baseline lands would be a false closure. The spec's order ("docs/register → §573 last") is otherwise kept.
6. **Popouts DO run a backend load.** The spec says popouts "never run a backend load". The load effect in `useStorageBackend` has no `isPopout` guard, so a popout calls `backend.load()` too. This does not affect the hold, because `TaskManagerInner` returns the popout tree before the main return where the hold sits. A test pins that a popout never shows the skeleton while its own load is pending.
7. **The undo hotkey is gated through a forward ref, not by moving the hook.** Draft 4b moved `useUndoHotkey` below `useStorageBackend`, which changes the registration order of the document `keydown` listeners. This plan keeps the call where it is and reads `loadPending` through `loadPendingRef`, filled in the existing `allowDestructiveSaveRef` effect (the same forward-ref pattern that effect already serves).
8. **Pre-hydration window, not addressed (spec: "The existing pre-hydration render is unchanged").** `useSettings` sets `hydrated` only after its async secret merge, while the tree renders as soon as `i18nReady` is true. In that window the app tree is live over the empty boot workspace, and an edit made there is still overwritten by the first load. `loadPending` deliberately reads false before hydration. Flagged for the controller; out of scope for this plan.
9. **Coverage of the nine `holdDuring` wraps.** Three are pinned behaviourally (`reloadCurrentProject`, `switchToProject`, `onOpenStorageFile`). The other six (`createProject`, `loadProjectFromFile`, `createDemoProject`, `switchToTursoProject`, `createTursoProject`, `migrateCurrentProjectToTurso`) are held by the same one-line wrap in the return object and are verified by review only. No task may claim them as covered.

**Risks the controller should weigh (no task changes them):**
- **A load that never settles keeps the skeleton up, with no route to Settings.** Turso loads time out (`LOAD_TIMEOUT_MS` in `turso-pipeline.ts`). SharePoint loads run through `sharepoint-graph.ts` with no fetch timeout, after an interactive `acquireToken`. Before this change a hung load left the app usable (with saving paused). A failed load settles, so the storage banner stays reachable in every failure that ends.
- The hold unmounts the whole tree, including `panel-chat` and `panel-raid` (which otherwise never remount). An in-flight chat agent loop or calendar push/pull that resolves during a swap still writes into render scope. That is pre-existing and not changed here.
- Every boot, backend rebuild and project swap now shows a skeleton, including behind the OS file picker in `loadProjectFromFile` / `onOpenStorageFile`. The user chose this on 2026-09-19.

## Review Focus

The five inputs most likely to bite a user that the spec implies but does not spell out. Each has a test in the owning task.

1. **A load that FAILS or is REFUSED must release the hold**, so the storage banner, Settings and "Pick storage file" stay reachable. Tests: Task 2 (b) and (c); Task 3 "a FAILED load releases the hold".
2. **A project-swap op that throws must not strand the skeleton.** Test: Task 2 (g).
3. **An M365 sign-in or sign-out (an `acquireToken`-only rebuild) must keep merging**, so the activity entries this device appended during that load survive. Test: Task 1 (d).
4. **A popout must never show the skeleton**, even while its own load is pending. Test: Task 3 "a popout never shows the skeleton".
5. **A bucket whose window has not started but already has hours booked must not raise a variance.** Test: Task 5 "a bucket whose window has not started is skipped even with hours booked".

---

### Task 1: §591 — merge only when the storage target is unchanged

**Files:**
- Create: `src/app/storage-target-key.ts`
- Create: `src/app/storage-target-key.test.ts`
- Create: `src/app/use-storage-backend.target-key.test.tsx`
- Modify: `src/app/use-storage-backend.ts` (import; `targetKey` + `scopeTargetKeyRef` after the `backend` memo; load effect; `reloadCurrentProject`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `storageTargetKey(input: StorageTargetInput): string` and `interface StorageTargetInput { storageConfig: StorageConfig; tursoDatabaseUrl: string | undefined; tursoAuthToken: string | undefined; tursoProjectId: string | null }` in `src/app/storage-target-key.ts`. Inside `useStorageBackend`: `const targetKey: string` and `const scopeTargetKeyRef: MutableRefObject<string | null>`. Task 2 edits lines next to these; do not rename them.

- [ ] **Step 1: Write the failing unit test `src/app/storage-target-key.test.ts`**

```ts
// §591 — the identity of the stored project a backend reads. Pure; coverage-gated.
import { describe, expect, it } from "vitest";
import { storageTargetKey, type StorageTargetInput } from "./storage-target-key";

const NO_TURSO = { tursoDatabaseUrl: undefined, tursoAuthToken: undefined, tursoProjectId: null };
const turso = (url: string | undefined, token: string | undefined, projectId: string | null): StorageTargetInput => ({
  storageConfig: { kind: "turso" }, tursoDatabaseUrl: url, tursoAuthToken: token, tursoProjectId: projectId,
});
const sp = (kind: "sp-json" | "sp-csv", itemPath: string, hostname = "contoso.sharepoint.com", sitePath = "/sites/pm"): StorageTargetInput => ({
  storageConfig: { kind, hostname, sitePath, itemPath }, ...NO_TURSO,
});

describe("storageTargetKey", () => {
  it("is stable for the same Turso target", () => {
    expect(storageTargetKey(turso("libsql://a", "t1", "p1"))).toBe(storageTargetKey(turso("libsql://a", "t1", "p1")));
  });

  it("keys a Turso target on the URL, the token and the project id", () => {
    const base = storageTargetKey(turso("libsql://a", "t1", "p1"));
    expect(storageTargetKey(turso("libsql://b", "t1", "p1"))).not.toBe(base);
    expect(storageTargetKey(turso("libsql://a", "t2", "p1"))).not.toBe(base); // a token-only edit is a new target (spec)
    expect(storageTargetKey(turso("libsql://a", "t1", "p2"))).not.toBe(base);
    expect(storageTargetKey(turso("libsql://a", "t1", null))).not.toBe(base);
  });

  it("treats a missing Turso field like an empty one", () => {
    expect(storageTargetKey(turso(undefined, undefined, null))).toBe(storageTargetKey(turso("", "", null)));
  });

  it("cannot be fooled by a delimiter inside a field", () => {
    expect(storageTargetKey(turso("a|b", "c", null))).not.toBe(storageTargetKey(turso("a", "b|c", null)));
  });

  it("keys a SharePoint target on the hostname, the site path and the item path", () => {
    const base = storageTargetKey(sp("sp-json", "/a.json"));
    expect(storageTargetKey(sp("sp-json", "/a.json"))).toBe(base);
    expect(storageTargetKey(sp("sp-json", "/b.json"))).not.toBe(base);
    expect(storageTargetKey(sp("sp-json", "/a.json", "fabrikam.sharepoint.com"))).not.toBe(base);
    expect(storageTargetKey(sp("sp-json", "/a.json", "contoso.sharepoint.com", "/sites/other"))).not.toBe(base);
    expect(storageTargetKey(sp("sp-csv", "/a.json"))).not.toBe(base);
  });

  it("keys browser and each local-file kind by the kind alone, and ignores the Turso fields there", () => {
    const kinds = ["browser", "local-json", "local-csv", "local-md"] as const;
    const keys = kinds.map((kind) => storageTargetKey({ storageConfig: { kind }, ...NO_TURSO }));
    expect(new Set(keys).size).toBe(kinds.length);
    expect(storageTargetKey({ storageConfig: { kind: "browser" }, tursoDatabaseUrl: "libsql://x", tursoAuthToken: "t", tursoProjectId: "p" }))
      .toBe(keys[0]);
  });

  it("never equals a Turso key for a non-Turso kind with the same strings", () => {
    expect(storageTargetKey({ storageConfig: { kind: "browser" }, ...NO_TURSO })).not.toBe(storageTargetKey(turso(undefined, undefined, null)));
  });
});
```

- [ ] **Step 2: Write the failing hook test `src/app/use-storage-backend.target-key.test.tsx`**

```tsx
// Regression pins for open-followups §591: after a settings-driven REBUILD onto a different storage
// target (a Turso URL/token edit, a SharePoint target change), the load effect and
// `reloadCurrentProject` MERGED the previous target's activity log and budget history into the new
// one. The rule under test: MERGE only when the in-scope workspace belongs to the SAME target
// (`storageTargetKey`), otherwise REPLACE. (d) and (e) are the anti-overcorrection pins: a rebuild
// of the SAME target must keep merging.
// ★ Own file, like the load-gate pins: the main suite's module-level `mockBackend` is shared state,
//   and this file also mocks `useMsAuth` to drive an `acquireToken`-only rebuild.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { BudgetHistoryEntry } from "./budget-history";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageConfig } from "./storage";
import type { Task } from "./types";

const auth = vi.hoisted(() => ({
  acquireToken: (async () => null) as (scopes: readonly string[], options?: { interactive?: boolean }) => Promise<string | null>,
}));

vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: async () => {}, signOut: async () => {}, acquireToken: auth.acquireToken }),
}));
vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  openFileForBackend: vi.fn(() => null),
  loadFromHandleForBackend: vi.fn(),
  pickFileForBackend: vi.fn(() => null),
  pickOpenFileAny: vi.fn(),
  formatFromFileName: vi.fn(() => "json"),
  requestWriteAccessForBackend: vi.fn(() => null),
  setBackendFileHandle: vi.fn(() => null),
  getBackendFileHandle: vi.fn(() => null),
}));
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

import * as storageMod from "./storage";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

function entry(id: string, timestamp: string): ActivityEntry {
  return { id, timestamp, kind: "task.updated", args: [1, id] } as unknown as ActivityEntry;
}
function hist(id: string): BudgetHistoryEntry {
  return {
    id, at: "2026-09-01T08:00:00.000Z", date: "2026-09-01", kind: "baseline", bucketId: null, bucketName: "",
    projectBacHours: 0, projectBacValue: 0, deltaHours: 0, deltaValue: 0,
  };
}

const TASK_A = [{ id: 1, taskName: "A" } as unknown as Task];
const TASK_B = [{ id: 9, taskName: "B" } as unknown as Task];
const A_WS = { tasks: TASK_A, raid: [], absences: [], shifts: [], activityLog: [entry("a-1", "2026-09-01T08:00:00.000Z")], budgetHistory: [hist("ha-1")] };
const B_WS = { tasks: TASK_B, raid: [], absences: [], shifts: [], activityLog: [entry("b-1", "2026-09-02T08:00:00.000Z")], budgetHistory: [hist("hb-1")] };
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };
const LOCAL_ENTRY = entry("local-1", "2026-09-03T08:00:00.000Z");
const LOCAL_HIST = hist("hl-1");

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};

/** A backend whose load resolves with `stored` after `ms` on the (fake) clock. */
function makeBackend(ms: number, stored: object): FakeBackend {
  return {
    kind: "browser",
    load: vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve(stored), ms); })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

type Args = Parameters<typeof useStorageBackend>[0];
function makeArgs(storageConfig: StorageConfig, turso?: { databaseUrl: string; authToken: string }): Args {
  return {
    settings: { storageConfig, integrations: turso ? { turso: { enabled: true, ...turso } } : undefined } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated: true,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}
const tursoArgs = (databaseUrl: string, authToken = "tok-a") => makeArgs({ kind: "turso" }, { databaseUrl, authToken });
const spArgs = (itemPath: string) => makeArgs({ kind: "sp-json", hostname: "contoso.sharepoint.com", sitePath: "/sites/pm", itemPath });

function useProbe(args: Args) {
  const hook = useStorageBackend(args);
  const { tasks, activityLog, setActivityLog, budgetHistory, setBudgetHistory } = useWorkspace();
  return { ...hook, tasks, activityLog, setActivityLog, budgetHistory, setBudgetHistory };
}

function render(args: Args) {
  return renderHook((props: { args: Args }) => useProbe(props.args), {
    initialProps: { args },
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

/** Advance the fake clock in small steps, each in its own `act` (see the load-gate file for why). */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

const ids = (list: readonly { id: string }[]) => list.map((e) => e.id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  auth.acquireToken = async () => null;
});
afterEach(() => { vi.useRealTimers(); });

describe("§591 — a load merges the activity log and budget history only onto the SAME target", () => {
  it("(a) a Turso URL change onto a POPULATED target: both slices are the target's own", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(100, B_WS);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]); // control: A applied

    rerender({ args: tursoArgs("libsql://b.turso.io") });
    await advance(300);
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]); // control: B applied
    expect(ids(result.current.activityLog)).toEqual(["b-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["hb-1"]);
  });

  it("(b) a same-kind SharePoint target change onto a POPULATED target: both slices are the target's own", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(100, B_WS);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(spArgs("/Shared Documents/a.json"));
    await advance(300);
    expect(ids(result.current.activityLog)).toEqual(["a-1"]);

    rerender({ args: spArgs("/Shared Documents/b.json") });
    await advance(300);
    expect(result.current.tasks.map((x) => x.id)).toEqual([9]);
    expect(ids(result.current.activityLog)).toEqual(["b-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["hb-1"]);
  });

  it("(c) a rebuild onto an EMPTY target, then \"Reload project\": both slices are REPLACED, as the confirm text promises", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(100, EMPTY);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, rerender } = render(tursoArgs("libsql://a.turso.io"));
    await advance(300);

    rerender({ args: tursoArgs("libsql://b.turso.io") });
    await advance(300);
    expect(result.current.loadPause).toBe("empty-refused"); // control: the refusal kept A in scope
    expect(ids(result.current.activityLog)).toEqual(["a-1"]);

    await act(async () => {
      const p = result.current.reloadCurrentProject();
      await vi.advanceTimersByTimeAsync(200);
      await p;
    });
    expect(confirmSpy).toHaveBeenCalled(); // control: the reload took the confirm path and applied
    expect(result.current.tasks).toEqual([]);
    expect(result.current.activityLog).toEqual([]);
    expect(result.current.budgetHistory).toEqual([]);
    confirmSpy.mockRestore();
  });

  it("(d) an acquireToken-only rebuild (M365 sign-in/out) is the SAME target: an entry appended during its load is still MERGED", async () => {
    const args = spArgs("/Shared Documents/a.json");
    const a = makeBackend(100, A_WS);
    const b = makeBackend(1000, A_WS); // the same target's stored copy: it has never seen the local append
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(args);
    await advance(300);

    auth.acquireToken = async () => "signed-in";
    rerender({ args }); // same settings object: only acquireToken moved
    await advance(100);
    expect(b.load).toHaveBeenCalledTimes(1); // control: the rebuild really started a load
    await act(async () => {
      result.current.setActivityLog((prev) => [...prev, LOCAL_ENTRY]);
      result.current.setBudgetHistory((prev) => [...prev, LOCAL_HIST]);
    });
    await advance(1000);

    expect(ids(result.current.activityLog)).toEqual(["a-1", "local-1"]);
    expect(ids(result.current.budgetHistory)).toEqual(["ha-1", "hl-1"]);
  });

  it("(e) a rebuild with an EQUAL config (new object, same values) keeps merging", async () => {
    const a = makeBackend(100, A_WS);
    const b = makeBackend(1000, A_WS);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render(makeArgs({ kind: "browser" }));
    await advance(300);

    rerender({ args: makeArgs({ kind: "browser" }) });
    await advance(100);
    expect(b.load).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.setActivityLog((prev) => [...prev, LOCAL_ENTRY]); });
    await advance(1000);

    expect(ids(result.current.activityLog)).toEqual(["a-1", "local-1"]);
  });
});
```

- [ ] **Step 3: Run both new tests and verify they fail**

Run (Global section V): `npx vitest run src/app/storage-target-key.test.ts src/app/use-storage-backend.target-key.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t1-red.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1`. `storage-target-key.test.ts` fails to import the missing module. In the hook file, (a), (b) and (c) fail (the previous target's `a-1` / `ha-1` are merged in), and (d) and (e) pass (they pin behaviour that already exists).

- [ ] **Step 4: Create `src/app/storage-target-key.ts`**

```ts
import type { StorageConfig } from "./workspace";

/**
 * §591 — the inputs that decide WHICH stored project a backend reads. They mirror `createBackend`'s
 * inputs with ONE deliberate omission: `acquireToken`. An M365 sign-in or sign-out rebuilds the
 * backend against the SAME target, and a load after it must keep MERGING the activity log and budget
 * history (see `applyWorkspace`'s `logMode`).
 */
export interface StorageTargetInput {
  storageConfig: StorageConfig;
  tursoDatabaseUrl: string | undefined;
  tursoAuthToken: string | undefined;
  tursoProjectId: string | null;
}

/**
 * A stable string naming the storage target. Equal keys = the same stored project.
 * - Turso: the URL, the token and the tenant project id. A token-only edit on the same URL counts as a
 *   NEW target: the app cannot tell "same database, new token" from a switch, and wrongly replacing
 *   loses at most a bounded in-flight append, while wrongly merging leaks another project's audit trail.
 * - SharePoint: the hostname, the site path and the item path.
 * - IndexedDB and local files: the kind alone. The config carries no file identity; a different file
 *   is reached only through a project op or "Pick storage file".
 * JSON-encoded so no field value can collide with a delimiter.
 * ★ The key CONTAINS the Turso auth token. Keep it in memory: never log, persist or display it.
 */
export function storageTargetKey(input: StorageTargetInput): string {
  const config = input.storageConfig;
  switch (config.kind) {
    case "turso":
      return JSON.stringify([config.kind, input.tursoDatabaseUrl ?? "", input.tursoAuthToken ?? "", input.tursoProjectId ?? ""]);
    case "sp-json":
    case "sp-csv":
      return JSON.stringify([config.kind, config.hostname, config.sitePath, config.itemPath]);
    default:
      return JSON.stringify([config.kind]);
  }
}
```

This is a NEW file, so the Write tool is correct here. Afterwards convert it to CRLF like its neighbours and confirm: `node -e "const f='src/app/storage-target-key.ts';const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\r?\n/g,'\r\n'))"` then `git ls-files --eol src/app/storage-target-key.ts` after `git add` in Step 9 must show `w/crlf`. Do the same for the two new test files.

- [ ] **Step 5: Wire it into `src/app/use-storage-backend.ts` (CRLF — Edit tool)**

(a) Import. Replace:

```ts
import { mergeBudgetHistories } from "./budget-history";
```

with:

```ts
import { mergeBudgetHistories } from "./budget-history";
import { storageTargetKey } from "./storage-target-key";
```

(b) After the `backend` memo. Replace:

```ts
    tursoProjectId,
  ]);

  // ★★★ IDENTITY, NOT A LATCH (open-followups §77 — full rationale there).
```

with:

```ts
    tursoProjectId,
  ]);

  // ★★★ §591 — WHICH STORAGE TARGET THE IN-SCOPE WORKSPACE BELONGS TO. `applyWorkspace`'s "merge"
  //   unions the loaded activity log and budget history with whatever is in memory, so it is right only
  //   when memory holds THIS target's project. A settings-driven rebuild (a Turso URL/token edit, a
  //   SharePoint target change) leaves the PREVIOUS target's project in scope, and merging it would
  //   carry that project's audit trail into this one. `targetKey` excludes `acquireToken`: an M365
  //   sign-in/out rebuilds against the same target and must keep merging.
  // ★ The ref is stamped (1) on the load effect's first hydrated run (the boot workspace holds only
  //   this session's own appends), (2) wherever a load is APPLIED from the current target, and (3) on
  //   the suppress-branch re-stamp after a project op. It is deliberately NOT stamped by the empty-load
  //   refusal or a failed load: scope still holds the previous target there.
  // ★ `targetKey` contains the Turso auth token. Never log it.
  const targetKey = storageTargetKey({
    storageConfig: args.settings.storageConfig,
    tursoDatabaseUrl: args.settings.integrations?.turso?.databaseUrl,
    tursoAuthToken: args.settings.integrations?.turso?.authToken,
    tursoProjectId,
  });
  const scopeTargetKeyRef = useRef<string | null>(null);

  // ★★★ IDENTITY, NOT A LATCH (open-followups §77 — full rationale there).
```

(c) Load effect, boot seed. Replace:

```ts
    if (!args.hydrated) return;
    let cancelled = false;
```

with:

```ts
    if (!args.hydrated) return;
    // §591 — the boot workspace holds nothing but this session's own appends for the target being loaded.
    if (scopeTargetKeyRef.current === null) scopeTargetKeyRef.current = targetKey;
    let cancelled = false;
```

(d) Load effect, suppress-branch re-stamp. Replace:

```ts
        allowSavesTo(backend); // §586 — the op already loaded or built what scope holds.
```

with:

```ts
        allowSavesTo(backend); // §586 — the op already loaded or built what scope holds.
        scopeTargetKeyRef.current = targetKey; // §591 — and that workspace belongs to THIS target.
```

(e) Load effect, applied branch. Replace:

```ts
        applyWorkspace(workspace, "reset", "merge"); // "merge": SAME project — keep appends made while this load was in flight.
```

with:

```ts
        // §591 — "merge" (keep appends made while this load was in flight) ONLY onto the same target;
        // after a rebuild onto another target, scope holds the previous project, so REPLACE.
        applyWorkspace(workspace, "reset", scopeTargetKeyRef.current === targetKey ? "merge" : "replace");
        scopeTargetKeyRef.current = targetKey;
```

(f) `reloadCurrentProject`. Replace:

```ts
      applyWorkspace(workspace, "raise", "merge"); // "merge": SAME project — a reload must not drop this device's entries.
```

with:

```ts
      // §591 — "merge" (a reload must not drop this device's entries) ONLY while scope holds THIS target's
      // project. After a rebuild onto an EMPTY target the refusal left the previous project in scope, and
      // `reloadEmptyConfirm` promises the user a REPLACE.
      applyWorkspace(workspace, "raise", scopeTargetKeyRef.current === targetKey ? "merge" : "replace");
      scopeTargetKeyRef.current = targetKey;
```

- [ ] **Step 6: Run the new tests and the existing hook suites**

Run (Global section V): `npx vitest run src/app/storage-target-key.test.ts src/app/use-storage-backend.target-key.test.tsx src/app/use-storage-backend.test.tsx src/app/use-storage-backend.load-gate.test.tsx src/app/use-storage-backend.steering.test.tsx src/app/use-load-truncation.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t1-green.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`, `Test Files  6 passed (6)`. The two existing merge tests in `use-storage-backend.test.tsx` ("MERGES a loaded activity log with entries appended locally — never replaces" and "MERGES a loaded activity log on reloadCurrentProject") must stay green. If the first one fails, the boot seed (ruling 1) is missing.

- [ ] **Step 7: Mutations (each must turn the named test red; revert each and prove `git diff --stat` shows only this task's edits)**

- M1a (the comparison): in the load effect's applied branch, change `scopeTargetKeyRef.current === targetKey ? "merge" : "replace"` to `"merge"`. Expected red: (a) and (b). Revert.
- M1b (reload): the same change in `reloadCurrentProject`. Expected red: (c). Revert.
- M1c (over-correction): change both ternaries to `"replace"`. Expected red: (d), (e), and the two existing "MERGES a loaded activity log…" tests. Revert.
- M1d (boot seed): delete the `if (scopeTargetKeyRef.current === null) scopeTargetKeyRef.current = targetKey;` line. Expected red: "MERGES a loaded activity log with entries appended locally — never replaces". Revert.
- M1e (token in the key): in `storageTargetKey`, drop `input.tursoAuthToken ?? "",` from the Turso array. Expected red: "keys a Turso target on the URL, the token and the project id". Revert.

Run each with: `npx vitest run src/app/storage-target-key.test.ts src/app/use-storage-backend.target-key.test.tsx src/app/use-storage-backend.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t1-mut-<id>.log" 2>&1; echo "EXIT=$?"` and name the failing tests from the log.

- [ ] **Step 8: Gates**

- vitest: Step 6's command, `EXIT=0`, `Test Files  6 passed (6)`.
- tsc: `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/storage-target-key.ts src/app/storage-target-key.test.ts src/app/use-storage-backend.ts src/app/use-storage-backend.target-key.test.tsx; echo "EXIT=$?"` gives `EXIT=0`.
- Size: `use-storage-backend.ts` ≤ 1600 lines (it is ~905 after this task).

- [ ] **Step 9: Commit (Global section C)**

Subject: `fix(storage): §591 — merge the log and budget history only onto the same target`
Body: `The load effect and reloadCurrentProject passed logMode "merge" unconditionally, so after a Turso URL/token or SharePoint target change the previous project's activity log and budget history were merged into the new target. useStorageBackend now records which storage target the in-scope workspace belongs to (storageTargetKey, which excludes acquireToken) and merges only when it is unchanged. Mutations M1a-M1e each turn a named test red.`
New files: `src/app/storage-target-key.ts src/app/storage-target-key.test.ts src/app/use-storage-backend.target-key.test.tsx`
Paths: those three plus `src/app/use-storage-backend.ts`.

---

### Task 2: §548 — publish `loadPending` from `useStorageBackend`

**Files:**
- Modify: `src/app/use-storage-backend.ts` (signal state; four settle stamps; `holdDuring`; return object; the "29 setters" comment)
- Create: `src/app/use-storage-backend.load-pending.test.tsx`
- Modify: `docs/AGENTS/activity-log.md` (the `applyWorkspace` setter-diff paragraph, which this task makes false)

**Interfaces:**
- Consumes: Task 1's `targetKey` / `scopeTargetKeyRef` (untouched here; the anchors below are the post-Task-1 text).
- Produces: `useStorageBackend(...).loadPending: boolean`. It is `false` before hydration. After hydration it is `true` until the load effect for the CURRENT `backend` instance reaches a terminal branch (applied, suppressed re-stamp, empty-load refusal, failure), and `true` while any of the nine project-swap ops is in flight. The nine ops keep their names and signatures in the returned object. Tasks 3 and 4 consume `loadPending`.

- [ ] **Step 1: Write the failing test `src/app/use-storage-backend.load-pending.test.tsx`**

```tsx
// Regression pins for open-followups §548's SIGNAL. `loadPending` drives the render hold in
// task-manager: while it is true the main window shows PanelSkeleton instead of the app, so no edit
// can start inside the window a landing load would overwrite.
// ★★★ It is deliberately NOT `workspaceLoaded`. That gate stays shut after a FAILED load and after
//   the empty-load REFUSAL (§77), which is right for snapshot capture and saving and wrong here: a hold
//   keyed on it would lock the app for the session after one load error. So EVERY terminal branch of
//   the load effect settles this one, and (b) and (c) pin exactly that difference.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageConfig } from "./storage";
import type { Task } from "./types";

vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  openFileForBackend: vi.fn(() => null),
  loadFromHandleForBackend: vi.fn(),
  pickFileForBackend: vi.fn(() => null),
  pickOpenFileAny: vi.fn(),
  formatFromFileName: vi.fn(() => "json"),
  requestWriteAccessForBackend: vi.fn(() => null),
  setBackendFileHandle: vi.fn(() => null),
  getBackendFileHandle: vi.fn(() => null),
}));
vi.mock("./project-file-handles", () => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./broadcast-sync", () => ({ useBroadcastSync: vi.fn() }));
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

import * as storageMod from "./storage";
import * as handles from "./project-file-handles";
import { addProject, emptyRegistry, saveRegistry } from "./projects-registry";
import { TestProviders } from "./test-providers";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";

const createBackendMock = storageMod.createBackend as ReturnType<typeof vi.fn>;

const STORED = { tasks: [{ id: 1, taskName: "Stored" } as unknown as Task], raid: [], absences: [], shifts: [] };
const EMPTY = { tasks: [], raid: [], absences: [], shifts: [] };

type FakeBackend = {
  kind: string;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  describe: ReturnType<typeof vi.fn>;
};

/** A backend whose load settles after `ms` on the (fake) clock. */
function makeBackend(ms: number, outcome: "resolve" | "reject" = "resolve", stored: object = STORED): FakeBackend {
  return {
    kind: "browser",
    load: vi.fn(() => new Promise((resolve, reject) => {
      setTimeout(() => (outcome === "resolve" ? resolve(stored) : reject(new Error("load boom"))), ms);
    })),
    save: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockResolvedValue(true),
    describe: vi.fn().mockResolvedValue(null),
  };
}

type Args = Parameters<typeof useStorageBackend>[0];
function makeArgs(storageConfig: StorageConfig = { kind: "browser" }, hydrated = true): Args {
  return {
    settings: { storageConfig } as unknown as Settings,
    lang: "en-US" as Lang,
    hydrated,
    isPopout: false,
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    onRevealSavingPaused: vi.fn(),
    setStorageConfig: vi.fn(),
  };
}

function useProbe(args: Args) {
  const hook = useStorageBackend(args);
  const { tasks } = useWorkspace();
  return { ...hook, tasks };
}

function render(args = makeArgs()) {
  return renderHook((props: { args: Args }) => useProbe(props.args), {
    initialProps: { args },
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

/** Advance the fake clock in small steps, each in its own `act` (see the load-gate file for why). */
async function advance(ms: number) {
  const STEP = 25;
  for (let done = 0; done < ms; done += STEP) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done)); });
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe("§548 — loadPending", () => {
  it("(a) is true while the first load is in flight and false once it is applied", async () => {
    const backend = makeBackend(1000);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(100);
    expect(backend.load).toHaveBeenCalledTimes(1); // control: the load really started
    expect(result.current.loadPending).toBe(true);

    await advance(1000);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]); // control: it dropped BECAUSE data landed
    expect(result.current.loadPending).toBe(false);
  });

  it("(b) a FAILED load releases it, unlike workspaceLoaded, which stays false", async () => {
    const backend = makeBackend(100, "reject");
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(300);
    expect(result.current.loadPause).toBe("load-failed"); // control: the catch ran
    expect(result.current.workspaceLoaded).toBe(false);
    expect(result.current.loadPending).toBe(false);
  });

  it("(c) a REBUILT backend raises it again, and an EMPTY-load refusal releases it", async () => {
    const a = makeBackend(100);
    const b = makeBackend(500, "resolve", EMPTY);
    createBackendMock.mockReturnValueOnce(a).mockReturnValue(b);
    const { result, rerender } = render();
    await advance(300);
    expect(result.current.loadPending).toBe(false);

    rerender({ args: makeArgs({ kind: "browser" }) }); // new config identity → new backend instance
    await advance(100);
    expect(b.load).toHaveBeenCalledTimes(1);
    expect(result.current.loadPending).toBe(true); // a rebuilt backend starts unsettled

    await advance(600);
    expect(result.current.loadPause).toBe("empty-refused"); // control: the refusal branch ran
    expect(result.current.workspaceLoaded).toBe(false);
    expect(result.current.tasks.map((x) => x.id)).toEqual([1]);
    expect(result.current.loadPending).toBe(false);
  });

  it("(d) is true while switchToProject awaits, and the suppressed load re-stamps it for the memo's new instance", async () => {
    saveRegistry(addProject(emptyRegistry(), { id: "target", name: "Target", code: "T", storageConfig: { kind: "local-json" } }, false));
    (handles.getHandle as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "t.json" });
    const current = makeBackend(0);
    const built = makeBackend(500); // backendFor(target) — the instance the switch loads
    const memo = makeBackend(0); // the memo's own instance once storageConfig flips
    createBackendMock.mockReturnValueOnce(current).mockReturnValueOnce(built).mockReturnValue(memo);
    let rerenderWith: (cfg: StorageConfig) => void = () => {};
    const setStorageConfig = vi.fn((cfg: StorageConfig) => rerenderWith(cfg));
    const { result, rerender } = render({ ...makeArgs(), setStorageConfig });
    rerenderWith = (cfg) => rerender({ args: { ...makeArgs(cfg), setStorageConfig } });
    await advance(100);
    expect(result.current.loadPending).toBe(false);

    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.switchToProject("target"); });
    await advance(100);
    expect(result.current.loadPending).toBe(true); // the op is awaiting the target's load

    await advance(600);
    await act(async () => { await op; });
    await advance(100);
    expect(setStorageConfig).toHaveBeenCalledWith({ kind: "local-json" });
    expect(memo.load).not.toHaveBeenCalled(); // control: the SUPPRESS branch ran, not a load
    expect(result.current.loadPending).toBe(false);
  });

  it("(e) is true for the whole of a held reloadCurrentProject, and false after it", async () => {
    const backend = makeBackend(0);
    createBackendMock.mockReturnValue(backend);
    const { result } = render();
    await advance(100);
    expect(result.current.loadPending).toBe(false);

    backend.load.mockImplementationOnce(() => new Promise((resolve) => { setTimeout(() => resolve(STORED), 1000); }));
    let op: Promise<void> = Promise.resolve();
    act(() => { op = result.current.reloadCurrentProject(); });
    await advance(100);
    expect(result.current.loadPending).toBe(true);

    await advance(1000);
    await act(async () => { await op; });
    expect(backend.load).toHaveBeenCalledTimes(2); // control: the reload really re-read the backend
    expect(result.current.loadPending).toBe(false);
  });

  it("(f) before hydration it claims nothing, and no load starts", async () => {
    const backend = makeBackend(0);
    createBackendMock.mockReturnValue(backend);
    const { result } = render(makeArgs({ kind: "browser" }, false));
    await advance(100);
    expect(backend.load).not.toHaveBeenCalled(); // control: the load effect really waits for hydration
    expect(result.current.loadPending).toBe(false);
  });

  it("(g) a held op that THROWS does not strand it", async () => {
    const backend = makeBackend(0);
    createBackendMock.mockReturnValue(backend);
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockImplementationOnce(() => Promise.reject(new Error("picker boom")));
    const { result } = render();
    await advance(100);
    expect(result.current.loadPending).toBe(false);

    await act(async () => {
      await expect(result.current.onOpenStorageFile()).rejects.toThrow("picker boom"); // control: the op really threw
    });
    expect(result.current.loadPending).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run (Global section V): `npx vitest run src/app/use-storage-backend.load-pending.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t2-red.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1`. Every test that asserts `loadPending` fails because it is `undefined`.

- [ ] **Step 3: Implement in `src/app/use-storage-backend.ts` (CRLF — Edit tool)**

(a) The signal. Replace:

```ts
  const workspaceLoaded = loadedBackend !== null && loadedBackend === backend;
```

with:

```ts
  const workspaceLoaded = loadedBackend !== null && loadedBackend === backend;
  // ★★★ §548 — THE LOAD HOLD'S SIGNAL, and deliberately NOT `workspaceLoaded`. That gate stays shut
  //   after a FAILED load and on the empty-load refusal, which is right for snapshots and saving and
  //   wrong for editing: a hold keyed on it would lock the app for the session after one load error.
  //   This asks a narrower question — is a load still IN FLIGHT for the current backend? — so EVERY
  //   terminal branch of the load effect stamps it: applied, suppressed re-stamp, refused, failed.
  //   Identity, not a latch (§77): a rebuilt backend starts unsettled by construction.
  const [settledBackend, setSettledBackend] = useState<ReturnType<typeof createBackend> | null>(null);
  // ★★ §548 — project-swap ops in flight (see `holdDuring`): each awaits and THEN replaces the
  //   workspace, so an edit made during its await would be discarded exactly like one made during the
  //   first load.
  const [swapsInFlight, setSwapsInFlight] = useState(0);
  // ★ False before hydration (spec: the pre-hydration render is unchanged; no load has started yet).
  const loadPending = args.hydrated && (settledBackend !== backend || swapsInFlight > 0);
```

(b) `applyWorkspace`'s stamp. Replace:

```ts
    setLoadedBackend(backend);
    allowSavesTo(backend); // §586 — beside the stamp, and LAST for the same reason.
```

with:

```ts
    setLoadedBackend(backend);
    setSettledBackend(backend); // §548 — see `settledBackend`; beside the stamp, and late for the same reason.
    allowSavesTo(backend); // §586 — beside the stamp, and LAST for the same reason.
```

(c) The suppress-branch re-stamp. Replace:

```ts
        setLoadedBackend(backend);
        allowSavesTo(backend); // §586 — the op already loaded or built what scope holds.
```

with:

```ts
        setLoadedBackend(backend);
        setSettledBackend(backend); // §548 — nothing is in flight: the op already put this target in scope.
        allowSavesTo(backend); // §586 — the op already loaded or built what scope holds.
```

(d) The empty-load refusal. Replace:

```ts
          emitToast("info", t(langRef.current, "storageKeptCurrentData"));
```

with:

```ts
          setSettledBackend(backend); // §548 — nothing applied, but nothing is still in flight either.
          emitToast("info", t(langRef.current, "storageKeptCurrentData"));
```

(e) The load effect's `catch`. Replace:

```ts
        setSavesPaused({ backend, reason: "load-failed" });
```

with:

```ts
        setSettledBackend(backend); // §548 — a FAILED load leaves nothing in flight to overwrite an edit. (`cancelled` above covers teardown.)
        setSavesPaused({ backend, reason: "load-failed" });
```

(Only the start of that line is replaced; its trailing `// §586: …` comment stays on the `setSavesPaused` line. Use the full original line as `old_string` and repeat it unchanged after the inserted line.)

(f) `holdDuring`. Directly above the line `  // Grouped one line per concern — a plain re-export list, and the cheapest block`, insert:

```ts
  // ★★ §548 — hold `loadPending` for the WHOLE of an op that awaits and then REPLACES the workspace.
  //   The op flushes the outgoing project BEFORE its await; an edit made during the await would be
  //   replaced in memory when the op applies. `finally`, so a throwing op cannot strand the hold;
  //   `mountedRef`, so a teardown cannot throw (§72). Wraps exactly the nine ops in the return object.
  function holdDuring<A extends unknown[]>(op: (...opArgs: A) => Promise<void>): (...opArgs: A) => Promise<void> {
    return async (...opArgs: A) => {
      setSwapsInFlight((n) => n + 1);
      try {
        await op(...opArgs);
      } finally {
        if (mountedRef.current) setSwapsInFlight((n) => n - 1);
      }
    };
  }

```

(g) The return object. Replace:

```ts
    storageDescription, storageReady, workspaceLoaded, loadPause,
    onPickStorageFile, onGrantWriteAccess, onOpenStorageFile, onRequestStorageSwitch,
```

with:

```ts
    storageDescription, storageReady, workspaceLoaded, loadPause, loadPending,
    onPickStorageFile, onGrantWriteAccess, onOpenStorageFile: holdDuring(onOpenStorageFile), onRequestStorageSwitch,
```

Replace `    reloadCurrentProject, allowDestructiveSave, allowDestructiveSaveAnyway` (the start of the next line) with `    reloadCurrentProject: holdDuring(reloadCurrentProject), allowDestructiveSave, allowDestructiveSaveAnyway` (leave the rest of that line unchanged). Then replace:

```ts
    switchToProject, createProject, createDemoProject, loadProjectFromFile,
    switchToTursoProject, createTursoProject, migrateCurrentProjectToTurso,
```

with:

```ts
    switchToProject: holdDuring(switchToProject), createProject: holdDuring(createProject),
    createDemoProject: holdDuring(createDemoProject), loadProjectFromFile: holdDuring(loadProjectFromFile),
    switchToTursoProject: holdDuring(switchToTursoProject), createTursoProject: holdDuring(createTursoProject),
    migrateCurrentProjectToTurso: holdDuring(migrateCurrentProjectToTurso),
```

Leave `onPickStorageFile`, `onGrantWriteAccess`, `onRequestStorageSwitch` and the archive/restore/hard-delete ops unwrapped: they replace no render-scope workspace.

(h) The setter count this task makes false. Run:

```bash
sed -n '/^  const applyWorkspace = /,/^  };$/p' src/app/use-storage-backend.ts | grep -oE 'set[A-Za-z0-9_]+\(' | sort -u | wc -l
```

Expected `30` (it was 29; `setSettledBackend` is new). In the comment block above `refreshBackendStatus`, replace `` `applyWorkspace`'s 29 setters `` with `` `applyWorkspace`'s <measured> setters `` and `That "29" is the likeliest claim` with `That "<measured>" is the likeliest claim`, using the number the command printed.

- [ ] **Step 4: Update `docs/AGENTS/activity-log.md` (LF — Edit tool), which this task makes false**

Run the three commands the file itself carries (they start `sed -n '/^  const applyWorkspace = /` and `comm -23`) and the anchored span command (`sed -n '/^  const applyWorkspace = /,/^  };$/p' src/app/use-storage-backend.ts | wc -l`). Then:

- Replace the result line `→ **29**` (the one after the first `sed … | wc -l` command) with the measured count (expected **30**).
- Replace the `comm` result line `` → `setActivityLog(` `setDocumentAssets(` `setFeatures(` `setFieldVisibility(` `setLoadedBackend(` `` with the measured output (expected: the same five plus `` `setSettledBackend(` ``).
- Replace `The anchored form spans 64 lines.` with the measured span (expected 65).
- Replace this passage:

```
  which is why the commands sit below rather than the count. ★★ That diff returns FIVE names, not
  four — the fifth is `setLoadedBackend`, which is the load GATE (`workspaceLoaded` derives from it),
  not a workspace slice, and the comment above `applyRestoredWorkspace` already says the restore
  funnel deliberately omits it. Four SLICES, five NAMES; a reader who stops at the count will think
  this line is wrong. ★ A range that stops at `setCalendarEvents` hides `setLoadedBackend` and returns
  four — it is deliberately the LAST setter in `applyWorkspace` (only the §586 save-gate call
  `allowSavesTo`, which the `set` grep does not match, follows it), so end the range at the function's close
  brace. ★ It does NOT hide `setDocumentAssets`, which shares `setCalendarEvents`' source line.
```

with:

```
  which is why the commands sit below rather than the count. ★★ That diff returns SIX names, not
  four — the fifth and sixth are `setLoadedBackend` and `setSettledBackend`: the load GATE
  (`workspaceLoaded` derives from the first) and the §548 load-hold signal (`loadPending` derives
  from the second), not workspace slices. The comment above `applyRestoredWorkspace` already says the
  restore funnel deliberately omits the first; a restore settles no load, so it omits the second too.
  Four SLICES, six NAMES; a reader who stops at the count will think this line is wrong. ★ A range
  that stops at `setCalendarEvents` hides both — they are deliberately the LAST two setters in
  `applyWorkspace` (only the §586 save-gate call `allowSavesTo`, which the `set` grep does not match,
  follows them), so end the range at the function's close brace. ★ It does NOT hide
  `setDocumentAssets`, which shares `setCalendarEvents`' source line.
```

- In the paragraph starting `★★ **SUPERSEDED 2026-09-03`, replace `so \`use-storage-backend.ts\` (still 799) now has ~800 lines of room` with `so \`use-storage-backend.ts\` (no longer 799 — measure it with the node one-liner in AGENTS.md's size:check note) has hundreds of lines of room`. Leave the dated "799 of the 800-line cap" sentence above it as the historical record it is.

- [ ] **Step 5: Run the new test and the existing hook suites**

Run (Global section V): `npx vitest run src/app/use-storage-backend.load-pending.test.tsx src/app/use-storage-backend.target-key.test.tsx src/app/use-storage-backend.test.tsx src/app/use-storage-backend.load-gate.test.tsx src/app/use-storage-backend.steering.test.tsx src/app/use-load-truncation.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t2-green.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`, `Test Files  6 passed (6)`.

- [ ] **Step 6: Mutations (revert each; prove with `git diff --stat`)**

- M2a (failure settles): delete the `setSettledBackend(backend);` line in the `catch`. Expected red: (b). Revert.
- M2b (signal source): change `settledBackend !== backend` to `loadedBackend !== backend`. Expected red: (b) and (c). Revert.
- M2c (refusal settles): delete the `setSettledBackend(backend);` line in the refusal branch. Expected red: (c). Revert.
- M2d (suppress re-stamp): delete the `setSettledBackend(backend);` line in the suppress branch. Expected red: (d). Revert.
- M2e (swap hold): delete `|| swapsInFlight > 0`. Expected red: (d) and (e). Revert.
- M2f (finally): replace the `try { await op(...opArgs); } finally { … }` body with `await op(...opArgs); if (mountedRef.current) setSwapsInFlight((n) => n - 1);`. Expected red: (g). Revert.
- M2g (hydration): delete `args.hydrated && `. Expected red: (f). Revert.

Run each against `src/app/use-storage-backend.load-pending.test.tsx` alone (Global section V form) and name the failing tests from the log.

- [ ] **Step 7: Gates**

- vitest: Step 5's command, `EXIT=0`, `Test Files  6 passed (6)`.
- tsc: `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/use-storage-backend.ts src/app/use-storage-backend.load-pending.test.tsx; echo "EXIT=$?"` gives `EXIT=0`.
- `npm run docs:symbols:check; echo "EXIT=$?"` gives `EXIT=0`. `npm run docs:claims:check; echo "EXIT=$?"` gives `EXIT=0`.
- Size: `use-storage-backend.ts` ≤ 1600.

- [ ] **Step 8: Commit (Global section C)**

Subject: `fix(storage): §548 — publish loadPending for loads and project swaps`
Body: `useStorageBackend now reports whether a load is still in flight for the current backend. Every terminal branch of the load effect settles it (a failed load and the empty-load refusal too, unlike workspaceLoaded), and the nine ops that await and then replace the workspace hold it for their whole duration via holdDuring. Mutations M2a-M2g each turn a named test red.`
New files: `src/app/use-storage-backend.load-pending.test.tsx`
Paths: that plus `src/app/use-storage-backend.ts docs/AGENTS/activity-log.md`.

---

### Task 3: §548 — hold the main-window app tree; gate the reconcile effect and the undo hotkey

**Files:**
- Modify: `src/app/task-manager.tsx` (destructure `loadPending`; `loadPendingRef`; undo hotkey; reconcile effect; render hold)
- Create: `src/app/task-manager.load-hold.test.tsx`
- Modify: `src/app/task-manager.template-notice.test.tsx` (comment only: the window it describes is now closed)
- Create: `e2e/load-hold.spec.ts`
- Modify: `AGENTS.md` ("Remount-swallow" bullet)

**Interfaces:**
- Consumes: `loadPending` from Task 2.
- Produces: no new exports. Task 4 appends tests to `src/app/task-manager.load-hold.test.tsx` and passes `loadPending` from the same destructuring.

- [ ] **Step 1: Write the failing test `src/app/task-manager.load-hold.test.tsx`**

```tsx
// §548 — the load hold, pinned at its only call site. While `loadPending` is true the MAIN window
// renders PanelSkeleton instead of the app tree, so no control that writes workspace state exists to
// race the load. The writers that do NOT unmount — the insight reconcile timer and the undo hotkey —
// gate themselves. The load is held open with a deferred `BrowserBackend.load`, so the pending window
// is observable rather than a race the test would usually lose.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { t } from "./i18n";
import { BrowserBackend } from "./browser-backend";
import { emptyWorkspace, type Workspace } from "./workspace";
import { DEFAULT_TASK_STATUS, type Task } from "./types";
import { reconcileInsights } from "./insights/reconcile";

const undoCalls = vi.hoisted(() => ({ n: 0 }));

// Count real undo calls without changing `undo`'s identity between renders.
vi.mock("./undo/use-undo-stack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./undo/use-undo-stack")>();
  const wrapped = new WeakMap<() => void, () => void>();
  return {
    ...actual,
    useUndoStack: (deps: Parameters<typeof actual.useUndoStack>[0]) => {
      const api = actual.useUndoStack(deps);
      let undo = wrapped.get(api.undo);
      if (!undo) {
        const real = api.undo;
        undo = () => { undoCalls.n += 1; real(); };
        wrapped.set(real, undo);
      }
      return { ...api, undo };
    },
  };
});

vi.mock("./insights/reconcile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./insights/reconcile")>();
  return { ...actual, reconcileInsights: vi.fn(actual.reconcileInsights) };
});

vi.mock("./workspace-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-section")>();
  const { useWorkspace } = await import("./workspace-context");
  return {
    ...actual,
    WorkspaceSection: () => {
      const { tasks } = useWorkspace();
      return <div data-testid="ws-section-mock" data-task-count={tasks.length} />;
    },
  };
});

import TaskManager from "./task-manager";

function task(id: number, taskName: string): Task {
  return {
    id, taskName, assignee: "M. Jordan", assigneeEmail: "", dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19", priority: "Medium", status: DEFAULT_TASK_STATUS,
    blockers: "", description: "",
  };
}

const LOADED: Workspace = { ...emptyWorkspace(), tasks: [task(1, "Loaded one"), task(2, "Loaded two")] };

/** A deferred `BrowserBackend.load`. `land` resolves EVERY call made so far and answers any later call
 *  at once. ★ Settings hydration can rebuild the backend memo and re-run the load effect, so there may
 *  be more than one call, and resolving only the latest could leave the effective run pending. */
function holdLoad() {
  const waiting: Array<(w: Workspace) => void> = [];
  let landed: Workspace | null = null;
  const spy = vi.spyOn(BrowserBackend.prototype, "load").mockImplementation(() =>
    landed !== null ? Promise.resolve(landed) : new Promise<Workspace>((resolve) => { waiting.push(resolve); }),
  );
  return {
    spy,
    land: (w: Workspace) => {
      landed = w;
      for (const resolve of waiting.splice(0)) resolve(w);
    },
  };
}

function mountAt(search: string) {
  window.localStorage.clear();
  window.localStorage.setItem("aipm-cockpit:projects", JSON.stringify({
    projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
    currentProjectId: "p1",
  }));
  window.history.replaceState(null, "", search);
  render(<TaskManager />);
}

const loadingText = () => screen.queryByText(t("en-US", "loading"));

beforeEach(() => {
  __resetMintStateForTests();
  undoCalls.n = 0;
  vi.mocked(reconcileInsights).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("§548 — no edit can start while the load is pending", () => {
  it("renders the loading placeholder instead of the app until the load lands, and the landed load is intact", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled()); // the hold answers a REAL pending load
    await waitFor(() => expect(loadingText()).not.toBeNull());
    expect(loadingText()!.closest('[role="status"]')).not.toBeNull();
    // No app tree, so no control that writes: no pane, no shell navigation.
    expect(screen.queryByTestId("ws-section-mock")).toBeNull();
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);

    await act(async () => { load.land(LOADED); });
    const pane = await screen.findByTestId("ws-section-mock");
    expect(pane.getAttribute("data-task-count")).toBe("2"); // the loaded data is what shows
    expect(screen.queryAllByRole("navigation").length).toBeGreaterThan(0);
  }, 45000);

  it("a FAILED load releases the hold: the app renders", async () => {
    vi.spyOn(BrowserBackend.prototype, "load").mockRejectedValue(new Error("load boom"));
    mountAt("/");
    expect(await screen.findByTestId("ws-section-mock")).toBeInTheDocument();
    expect(screen.queryAllByRole("navigation").length).toBeGreaterThan(0);
  }, 45000);

  it("a popout never shows the skeleton, even while its own load is pending", async () => {
    const load = holdLoad();
    mountAt("/?popout=raid");
    expect(await screen.findByTestId("ws-section-mock")).toBeInTheDocument();
    expect(loadingText()).toBeNull();
    await act(async () => { load.land(LOADED); });
  }, 45000);

  it("does not run the insight reconcile while the load is pending, and runs it once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    // Well past INSIGHTS_RECONCILE_DEBOUNCE_MS (4 s), with the load still held.
    await act(async () => { await new Promise((r) => setTimeout(r, 6000)); });
    expect(vi.mocked(reconcileInsights)).not.toHaveBeenCalled();

    await act(async () => { load.land(LOADED); });
    await waitFor(() => expect(vi.mocked(reconcileInsights)).toHaveBeenCalled(), { timeout: 10000 });
  }, 45000);

  it("ignores the undo hotkey while the load is pending, and honours it once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    await waitFor(() => expect(loadingText()).not.toBeNull()); // the hold is up
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoCalls.n).toBe(0);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undoCalls.n).toBe(1); // control: the same keystroke does undo once the load has landed
  }, 45000);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run (Global section V): `npx vitest run src/app/task-manager.load-hold.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t3-red.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1`. The first, fourth and fifth tests fail (the app renders during the pending load, the reconcile runs, the hotkey undoes). The failed-load and popout tests pass already; they pin the release and the popout exemption.

- [ ] **Step 3: Implement in `src/app/task-manager.tsx` (CRLF — Edit tool)**

(a) Destructure the signal. Replace:

```ts
    restoreTursoProject, hardDeleteTursoProject, tursoProjectId,
```

with:

```ts
    restoreTursoProject, hardDeleteTursoProject, tursoProjectId, loadPending,
```

(b) The forward ref. Replace:

```ts
  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined);
  const isPopoutRef = useRef(isPopout);
```

with:

```ts
  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined);
  const isPopoutRef = useRef(isPopout);
  const loadPendingRef = useRef(false); // §548 — filled beside `allowDestructiveSaveRef`, read by the undo hotkey below.
```

(c) The undo hotkey. Replace:

```ts
  useUndoHotkey(undoApi.undo, undoApi.redo);
```

with:

```ts
  // ★★ §548 — the one undo path that does NOT unmount with the app tree during the load hold (a document
  //   keydown listener), and an undo applied then is replaced when the load lands, so it is dropped.
  //   `loadPending` comes from `useStorageBackend` further down, so it is read through a ref (the same
  //   forward-ref pattern as `allowDestructiveSaveRef`). The call stays HERE so the document keydown
  //   listeners keep their registration order.
  useUndoHotkey(
    () => { if (!loadPendingRef.current) undoApi.undo(); },
    () => { if (!loadPendingRef.current) undoApi.redo(); },
  );
```

(d) Fill the ref. Replace:

```ts
  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; isPopoutRef.current = isPopout; }, [allowDestructiveSave, isPopout]);
```

with:

```ts
  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; isPopoutRef.current = isPopout; loadPendingRef.current = loadPending; }, [allowDestructiveSave, isPopout, loadPending]);
```

(e) The insight reconcile effect. Replace:

```ts
    if (!hydrated || isPopout) return;
    const timer = setTimeout(() => {
```

with:

```ts
    // §548 — never while a load or swap is pending: its write would be replaced when the load lands.
    // `loadPending` is a dep, so the reconcile runs once the load does.
    if (!hydrated || isPopout || loadPending) return;
    const timer = setTimeout(() => {
```

and in that effect's dependency array replace `holidaySet, holidaysReady, shifts, priorOverdueCount]);` with `holidaySet, holidaysReady, shifts, priorOverdueCount, loadPending]);`.

(f) The render hold. Replace:

```ts
  const showTursoListLoading =
    hydrated && portfolioMode === "turso" && !tursoListLoaded && !showTursoUnlock && !storageError;
```

with:

```ts
  const showTursoListLoading =
    hydrated && portfolioMode === "turso" && !tursoListLoaded && !showTursoUnlock && !storageError;
  // ★★★ §548 — THE LOAD HOLD. While `loadPending` (the first load, a backend-change reload, or a
  //   project-swap op is in flight) the MAIN window renders the same `PanelSkeleton` the Turso list-load
  //   window uses INSTEAD of the app tree, so no control that writes workspace state exists — an edit
  //   made in that window was silently replaced when the load landed. A failed or refused load SETTLES,
  //   so the storage banner and its recovery paths stay reachable. Popouts returned above and are never
  //   held. Every panel mounts FRESH after a hold (AGENTS.md "Remount-swallow"). Writers that do not
  //   unmount gate on `loadPending` themselves (docs/AGENTS/platform.md, "The load hold").
```

and replace `            ) : showTursoListLoading ? (` with `            ) : showTursoListLoading || loadPending ? (`.

- [ ] **Step 4: Sweep the stale prose in `src/app/task-manager.template-notice.test.tsx` (CRLF — Edit tool)**

In `mount()`'s comment, replace:

```ts
  // `ws-section-mock` renders unconditionally on mount, before that load effect has necessarily
```

with:

```ts
  // `ws-section-mock` rendered unconditionally on mount (before §548's load hold), before that load effect had necessarily
```

Then, directly above the `await waitFor(` line that waits for `storage.loaded` in `mount()`, insert:

```ts
  // ★ §548 CLOSED the product window this comment describes: the main window now renders PanelSkeleton
  //   until the load settles, so `findByTestId("ws-section-mock")` above already implies it. The wait is
  //   kept as a second, independent pin on the same fact.
```

Read the surrounding comment first. If the first `old_string` does not match (the comment wraps differently), keep the original line and add only the inserted `★ §548` block. Do not change any assertion.

- [ ] **Step 5: Run the new test**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  1 passed (1)`.

- [ ] **Step 6: Run the existing TaskManager suites, which may now race the hold**

Run (Global section V): `npx vitest run src/app/task-manager.load-hold.test.tsx src/app/task-manager.activity-actor.test.tsx src/app/task-manager.characterization.test.tsx src/app/task-manager.clear-unlinked-arming.test.tsx src/app/task-manager.editor-modal.test.tsx src/app/task-manager.guardrail-reconcile.test.tsx src/app/task-manager.key-facts-cache.test.tsx src/app/task-manager.popout-guard.test.tsx src/app/task-manager.portfolio-mode.test.tsx src/app/task-manager.restore-backfill.test.tsx src/app/task-manager.shell.test.tsx src/app/task-manager.snapshot-gate-failed-load.test.tsx src/app/task-manager.snapshot-gate.test.tsx src/app/task-manager.template-notice.test.tsx src/app/task-manager.timelog-links-blank.test.tsx src/app/task-manager.truncation-banner.test.tsx src/app/task-manager.version-history-wiring.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t3-suites.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`, `Test Files  17 passed (17)`.

If a suite goes red because it queried the app (or captured a probe's props) before the first load landed, fix it ONLY by awaiting the load: `await screen.findBy…` for the pane, or the `storage.loaded` diag wait that `task-manager.template-notice.test.tsx`'s `mount()` uses:

```ts
await waitFor(
  () => expect(window.localStorage.getItem("aipm-cockpit:diag-log") ?? "").toContain("storage.loaded"),
  { timeout: 15000 },
);
```

Never weaken or delete an assertion. A suite that drives a project-swap op and then queries the tree must await the op before querying. List every suite you changed, and why, in the task report, and add each changed file to this task's commit paths.

- [ ] **Step 7: Write the e2e spec `e2e/load-hold.spec.ts` (LF)**

```ts
// §548 — the load hold, end to end. The seeded project's IndexedDB open is held until the test releases
// it, so the first load is visibly pending: the skeleton shows and the app does not, then the loaded
// project appears. The shim holds only the WORKSPACE database ("aipm-cockpit"); settings secrets and
// file handles live in their own databases and hydrate normally.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openView } from "./seed";

const MASTER = JSON.parse(readFileSync(join(process.cwd(), "sample-workspace-small.json"), "utf8")) as {
  tasks: Array<{ taskName: string; status: string }>;
};
const OPEN_TASK = MASTER.tasks.find((x) => x.status !== "Done" && x.status !== "Cancelled");

test("§548 — a delayed project load shows the skeleton, then the loaded app", async ({ page }) => {
  expect(OPEN_TASK, "the sample workspace has an open task").toBeDefined();
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (window as unknown as { __releaseAipmLoad: () => void }).__releaseAipmLoad = () => release();
    const onsuccess = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
    const realOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function open(this: IDBFactory, name: string, version?: number): IDBOpenDBRequest {
      const req = version === undefined ? realOpen.call(this, name) : realOpen.call(this, name, version);
      if (name === "aipm-cockpit" && onsuccess?.set) {
        Object.defineProperty(req, "onsuccess", {
          configurable: true,
          set(fn: ((this: IDBRequest, ev: Event) => unknown) | null) {
            onsuccess.set!.call(req, fn === null ? null : (ev: Event) => { void gate.then(() => fn.call(req, ev)); });
          },
        });
      }
      return req;
    };
  });

  await page.goto("/");
  const skeleton = page.getByRole("status").filter({ hasText: "Loading…" });
  await expect(skeleton).toBeVisible({ timeout: 90_000 }); // the first navigation pays a dev compile
  await expect(page.getByRole("navigation")).toHaveCount(0); // no app chrome, so no control to edit with

  await page.evaluate(() => (window as unknown as { __releaseAipmLoad: () => void }).__releaseAipmLoad());
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
  await openView(page, "Open Points");
  await expect(page.getByText(OPEN_TASK!.taskName, { exact: true }).first()).toBeAttached();
});
```

(Any `getByRole` with a `name` added later must pass `exact: true`: Playwright's `name` is a case-insensitive substring by default.)

- [ ] **Step 8: Run the e2e spec, then one axe view**

Stop any dev server you started yourself first (`npm run stop`). Do not chain Playwright invocations.

`npx playwright test e2e/load-hold.spec.ts --project=chromium --workers=1 > "$SCRATCH/t3-e2e.log" 2>&1; echo "EXIT=$?"` gives `EXIT=0`.

`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard" --workers=1 > "$SCRATCH/t3-axe.log" 2>&1; echo "EXIT=$?"` gives `EXIT=0`. A timeout under local contention is not a violation: re-run once and report both runs.

- [ ] **Step 9: Mutations (revert each; prove with `git diff --stat`)**

- M3a (render hold): change `showTursoListLoading || loadPending` back to `showTursoListLoading`. Expected red: "renders the loading placeholder…" (unit) AND the e2e spec (the skeleton never appears; it fails at the 90 s visibility wait). Revert.
- M3b (reconcile): delete `|| loadPending` from the reconcile effect's early return. Expected red: "does not run the insight reconcile…". If it stays green, the 6 s wait is too short on this machine: raise it and re-prove red. Revert.
- M3c (hotkey): change the undo closure to `() => { undoApi.undo(); }`. Expected red: "ignores the undo hotkey…". Revert.
- M3d (popout exemption): in the popout return, wrap `{legacyTree}` as `{loadPending ? <PanelSkeleton lang={lang} /> : legacyTree}`. Expected red: "a popout never shows the skeleton…". Revert.

Run the unit mutations against `src/app/task-manager.load-hold.test.tsx` alone.

- [ ] **Step 10: AGENTS.md (LF — Edit tool)**

In the "Remount-swallow" bullet, replace:

```
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
```

with:

```
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
  ★★ **THE WHOLE MAIN-WINDOW TREE UNMOUNTS WHILE `loadPending` IS TRUE (§548)** — the first load, a
  backend-change reload and every project-swap op render `PanelSkeleton` instead — so EVERY panel, the
  two exceptions below included, mounts fresh after each; the sentinel rule applies to them too. A new
  BACKGROUND writer (timer, listener, interval) does not unmount and must gate on `loadPending` itself:
  [`docs/AGENTS/platform.md`](docs/AGENTS/platform.md) "The load hold".
```

(The platform.md section is written in Task 6. `docs:claims:check` does not validate anchors, so the forward link is safe for one commit.)

- [ ] **Step 11: Gates**

- vitest: Step 6's command, `EXIT=0`, `Test Files  17 passed (17)`.
- tsc: `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/task-manager.tsx src/app/task-manager.load-hold.test.tsx src/app/task-manager.template-notice.test.tsx e2e/load-hold.spec.ts <any suite changed in Step 6>; echo "EXIT=$?"` gives `EXIT=0`.
- `npm run size:check; echo "EXIT=$?"` gives `EXIT=0` (`task-manager.tsx` is baselined at 6040 and is ~3350).
- `npm run docs:symbols:check; echo "EXIT=$?"` gives `EXIT=0`.

- [ ] **Step 12: Commit (Global section C)**

Subject: `fix(shell): §548 — hold the main window while a load or swap is pending`
Body: `While loadPending, the main window renders the existing PanelSkeleton instead of the app tree, so no UI writer can start inside the window a landing load would overwrite. A failed or refused load settles, so the storage banner stays reachable; popouts are never held. The insight reconcile effect and the undo hotkey, which do not unmount, gate on the same signal. Mutations M3a-M3d each turn a named test red.`
New files: `src/app/task-manager.load-hold.test.tsx e2e/load-hold.spec.ts`
Paths: those two plus `src/app/task-manager.tsx src/app/task-manager.template-notice.test.tsx AGENTS.md` and any suite changed in Step 6.

---

### Task 4: §548 — gate the background recommendation and calendar writers

**Files:**
- Modify: `src/app/use-insight-recommendations.ts` (`InsightRecommendationDeps.loadPending`; `applyInsightRecommendation`)
- Modify: `src/app/use-calendar-integrations.ts` (`CalendarIntegrationDeps.loadPending`; the four auto-sync flags; the auto-pull runner; the explanatory comment)
- Modify: `src/app/task-manager.tsx` (pass `loadPending` to both hooks)
- Modify: `src/app/use-insight-recommendations.test.tsx`
- Create: `src/app/use-calendar-integrations.load-hold.test.ts` (no JSX, so `.ts`)
- Modify: `src/app/task-manager.load-hold.test.tsx` (the wiring test)

**Interfaces:**
- Consumes: `loadPending` (Task 2), destructured in `task-manager.tsx` (Task 3).
- Produces: `InsightRecommendationDeps.loadPending: boolean` and `CalendarIntegrationDeps.loadPending: boolean`, both REQUIRED, so tsc catches a missed call site.

- [ ] **Step 0: Coordination (controller)**

The CONTROLLER notifies the peer session (worktree `C:/Projects/aipm-wt-a`, `fix/data-loss-batch`, §534 edits the same file) that this task is about to edit `src/app/use-insight-recommendations.ts`, and waits for an acknowledgement before dispatching the implementer.

- [ ] **Step 1: Write the failing tests**

(a) `src/app/use-insight-recommendations.test.tsx`. In `mkDeps`, add `    loadPending: false,` directly after `    isPopout: false,`. Then append at the end of the file:

```ts
// §548 — the recommendation store is the ONE choke point both the background runner and the on-demand
// generate write through. A result stored while a load or swap is pending would be replaced when the
// load lands. The settled control is "stores the target row's real token on a generated recommendation"
// above, which runs with `loadPending: false`.
it("does not store a generated recommendation while the project load is pending (§548)", async () => {
  const generate = vi.spyOn(recommendCall, "runInsightRecommendation").mockResolvedValue(mkRec({ id: 42, status: "In Progress" }));
  const store = mkStore([mkInsight()]);
  const { result } = renderHook(() => useInsightRecommendations(mkDeps({ insights: store.read(), setInsights: store.setInsights, loadPending: true })));
  await act(async () => { result.current.insightActions.onGenerateRecommendation(1); });
  expect(generate).toHaveBeenCalled(); // control: the generate really ran to the store point
  expect(store.read()[0].recommendation).toBeUndefined();
});
```

(b) Create `src/app/use-calendar-integrations.load-hold.test.ts`:

```ts
// §548 — the calendar background writers (four auto-sync pushes, four background pulls, the auto-pull
// runner) run on timers and never unmount with the held app tree, so they gate on `loadPending`
// themselves. The Graph-facing hooks are stubbed; what is pinned is the enable flags this hook hands them.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings-types";

const seen = vi.hoisted(() => ({ autoSync: [] as boolean[], autoPull: [] as boolean[], backgroundPull: [] as boolean[] }));

vi.mock("./use-calendar-auto-sync", () => ({
  useCalendarAutoSync: (a: { active: boolean }) => { seen.autoSync.push(a.active); },
}));
vi.mock("./use-calendar-auto-pull", () => ({
  useCalendarAutoPull: (a: { enabled: boolean }) => { seen.autoPull.push(a.enabled); },
}));
vi.mock("./use-entity-calendar-push", () => ({
  useEntityCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }),
}));
vi.mock("./use-entity-calendar-pull", () => ({
  useEntityCalendarPull: (a: { enabled: boolean; background?: boolean }) => {
    if (a.background) seen.backgroundPull.push(a.enabled);
    return { pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() };
  },
}));
vi.mock("./use-outlook-calendar-push", () => ({
  useOutlookCalendarPush: () => ({ pushToOutlook: vi.fn(), busy: false }),
}));
vi.mock("./use-milestone-calendar-pull", () => ({
  useMilestoneCalendarPull: () => ({ pull: vi.fn(), busy: false, result: null, clearResult: vi.fn(), keepApp: vi.fn(), applyMove: vi.fn() }),
}));
vi.mock("./use-committee-outlook-push", () => ({
  useCommitteeOutlookPush: () => ({ pushToOutlook: vi.fn(), pushingTarget: null }),
}));

import { useCalendarIntegrations, type CalendarIntegrationDeps } from "./use-calendar-integrations";

const ON = { enabled: true, auto: true };

function deps(loadPending: boolean): CalendarIntegrationDeps {
  return {
    isPopout: false,
    loadPending,
    settings: {
      integrations: { m365: { enabled: true, outlookCalendarPush: true } },
      outlookCalendar: { task: ON, raid: ON, change: ON, absence: ON },
    } as unknown as Settings,
    m365Enabled: true,
    portfolioCurrentId: "p1",
    project: undefined,
    lang: "en-US",
    today: "2026-09-19",
    logActivityAs: vi.fn() as unknown as CalendarIntegrationDeps["logActivityAs"],
    setSettings: vi.fn(),
    milestones: [], setMilestones: vi.fn(),
    steeringCommittee: undefined, setSteeringCommittee: vi.fn(),
    tasks: [], setTasks: vi.fn(),
    raid: [], setRaid: vi.fn(),
    changes: [], setChanges: vi.fn(),
    absences: [], setAbsences: vi.fn(),
  };
}

function lastRender() {
  return { autoSync: seen.autoSync.slice(-4), backgroundPull: seen.backgroundPull.slice(-4), autoPull: seen.autoPull.slice(-1) };
}

beforeEach(() => {
  seen.autoSync.length = 0;
  seen.autoPull.length = 0;
  seen.backgroundPull.length = 0;
});

describe("useCalendarIntegrations — background writers hold while the load is pending (§548)", () => {
  it("keeps every auto-sync push, background pull and the auto-pull runner OFF while loadPending", () => {
    renderHook(() => useCalendarIntegrations(deps(true)));
    expect(lastRender()).toEqual({ autoSync: [false, false, false, false], backgroundPull: [false, false, false, false], autoPull: [false] });
  });

  it("control: the same settings switch them ON once the load has settled", () => {
    renderHook(() => useCalendarIntegrations(deps(false)));
    expect(lastRender()).toEqual({ autoSync: [true, true, true, true], backgroundPull: [true, true, true, true], autoPull: [true] });
  });
});
```

(c) `src/app/task-manager.load-hold.test.tsx` (wiring). Directly after the line `const undoCalls = vi.hoisted(() => ({ n: 0 }));`, add:

```tsx
const handed = vi.hoisted(() => ({ calendar: [] as boolean[], recs: [] as boolean[] }));

vi.mock("./use-calendar-integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-calendar-integrations")>();
  return {
    ...actual,
    useCalendarIntegrations: (d: Parameters<typeof actual.useCalendarIntegrations>[0]) => {
      handed.calendar.push(d.loadPending);
      return actual.useCalendarIntegrations(d);
    },
  };
});

vi.mock("./use-insight-recommendations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-insight-recommendations")>();
  return {
    ...actual,
    useInsightRecommendations: (d: Parameters<typeof actual.useInsightRecommendations>[0]) => {
      handed.recs.push(d.loadPending);
      return actual.useInsightRecommendations(d);
    },
  };
});
```

In `beforeEach`, add `  handed.calendar.length = 0;` and `  handed.recs.length = 0;`. Inside the `describe`, append:

```tsx
  it("hands loadPending to the background hooks: true while held, false once the load lands", async () => {
    const load = holdLoad();
    mountAt("/");
    await waitFor(() => expect(load.spy).toHaveBeenCalled());
    await waitFor(() => expect(loadingText()).not.toBeNull()); // the hold is up
    expect(handed.calendar[handed.calendar.length - 1]).toBe(true);
    expect(handed.recs[handed.recs.length - 1]).toBe(true);

    await act(async () => { load.land(LOADED); });
    await screen.findByTestId("ws-section-mock");
    expect(handed.calendar[handed.calendar.length - 1]).toBe(false);
    expect(handed.recs[handed.recs.length - 1]).toBe(false);
  }, 45000);
```

- [ ] **Step 2: Run the tests and verify they fail**

Run (Global section V): `npx vitest run src/app/use-insight-recommendations.test.tsx src/app/use-calendar-integrations.load-hold.test.ts src/app/task-manager.load-hold.test.tsx --maxWorkers=1 --reporter=dot > "$SCRATCH/t4-red.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1`. The recommendation is stored while pending, the calendar flags are `true` while pending, and `handed` records `undefined`. The missing `loadPending` member shows only in Step 7's tsc run.

- [ ] **Step 3: Implement (CRLF — Edit tool)**

`src/app/use-insight-recommendations.ts`:

- In `InsightRecommendationDeps`, replace `  isPopout: boolean;\n  settings: Settings;` with:

```ts
  isPopout: boolean;
  /** §548 — a load or project swap is still in flight (`useStorageBackend`). A recommendation stored
   *  meanwhile would be replaced when the load lands. */
  loadPending: boolean;
  settings: Settings;
```

- In the destructuring, replace `    isPopout,\n    settings,\n    lang,` with `    isPopout,\n    loadPending,\n    settings,\n    lang,`.
- In `applyInsightRecommendation`, replace:

```ts
    (id: number, rec: InsightRecommendation) => {
      const stamped = stampRecommendationTokens(rec, { tasks, raid, changes, milestones, stakeholders });
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: stamped } : i)));
    },
    [setInsights, tasks, raid, changes, milestones, stakeholders],
```

with:

```ts
    (id: number, rec: InsightRecommendation) => {
      // §548 — this is the ONE store both the background runner and the on-demand generate write
      // through, so the hold lives here: a result stored while a load or swap is pending would be
      // replaced when it lands. Dropped, not queued — the runner's next tick regenerates it.
      if (loadPending) return;
      const stamped = stampRecommendationTokens(rec, { tasks, raid, changes, milestones, stakeholders });
      setInsights((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, recommendation: stamped } : i)));
    },
    [setInsights, tasks, raid, changes, milestones, stakeholders, loadPending],
```

`src/app/use-calendar-integrations.ts`:

- In `CalendarIntegrationDeps`, replace `  isPopout: boolean;\n  settings: Settings;\n  m365Enabled: boolean;` with:

```ts
  isPopout: boolean;
  /** §548 — a load or project swap is still in flight (`useStorageBackend`). The BACKGROUND writers
   *  below (auto-sync pushes, background pulls, the auto-pull runner) run on timers and never unmount
   *  with the held app tree, so they hold themselves; the manual controls are unmounted by the hold. */
  loadPending: boolean;
  settings: Settings;
  m365Enabled: boolean;
```

- In the destructuring, replace `  const {\n    isPopout,\n    settings,\n    m365Enabled,` with `  const {\n    isPopout,\n    loadPending,\n    settings,\n    m365Enabled,`.
- Change these five expressions:
  - `const taskAutoSyncActive = taskSync.auto && m365Enabled && !isPopout;` → `const taskAutoSyncActive = taskSync.auto && m365Enabled && !isPopout && !loadPending;`
  - `const raidAutoSyncActive = raidSync.auto && m365Enabled && !isPopout;` → `const raidAutoSyncActive = raidSync.auto && m365Enabled && !isPopout && !loadPending;`
  - `const changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout;` → `const changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout && !loadPending;`
  - `const absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout;` → `const absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout && !loadPending;`
  - in the `useCalendarAutoPull({` call, `    enabled: m365Enabled && !isPopout,` → `    enabled: m365Enabled && !isPopout && !loadPending,`
- In the comment above the background pulls, replace `` on its own `<entity>AutoSyncActive` (`.auto && m365Enabled && !isPopout`) and `` with `` on its own `<entity>AutoSyncActive` (`.auto && m365Enabled && !isPopout && !loadPending`) and ``.

`src/app/task-manager.tsx`:

- In the `useInsightRecommendations({` call, replace `    isPopout, settings, lang, today, project,` with `    isPopout, loadPending, settings, lang, today, project,`.
- In the `useCalendarIntegrations({` call, replace `  } = useCalendarIntegrations({\n    isPopout,\n` with `  } = useCalendarIntegrations({\n    isPopout,\n    loadPending,\n`.

- [ ] **Step 4: Run the tests**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  3 passed (3)`.

- [ ] **Step 5: Mutations (revert each; prove with `git diff --stat`)**

- M4a (recommendation store): delete `if (loadPending) return;`. Expected red: "does not store a generated recommendation while the project load is pending (§548)". Revert.
- M4b (auto-sync): delete `&& !loadPending` from `taskAutoSyncActive` only. Expected red: "keeps every auto-sync push … OFF while loadPending" (first auto-sync and first background-pull entries flip). Revert.
- M4c (auto-pull runner): delete `&& !loadPending` from `useCalendarAutoPull`'s `enabled`. Expected red: the same test. Revert.
- M4d (wiring): in task-manager's `useCalendarIntegrations({` call, change `loadPending,` to `loadPending: false,`. Expected red: "hands loadPending to the background hooks…". Revert.

- [ ] **Step 6: Re-run the Task 3 suite list plus the two new hook files**

Run the Task 3 Step 6 command with `src/app/use-insight-recommendations.test.tsx src/app/use-calendar-integrations.load-hold.test.ts` appended. Expected: `EXIT=0`, `Test Files  19 passed (19)`.

- [ ] **Step 7: Gates**

- vitest: Step 6, `EXIT=0`, `Test Files  19 passed (19)`.
- tsc: `EXIT=0`, `0`. This is where a missed call site of either hook fails, because the member is required.
- `npx eslint --max-warnings=0 src/app/use-insight-recommendations.ts src/app/use-calendar-integrations.ts src/app/task-manager.tsx src/app/use-insight-recommendations.test.tsx src/app/use-calendar-integrations.load-hold.test.ts src/app/task-manager.load-hold.test.tsx; echo "EXIT=$?"` gives `EXIT=0`.

- [ ] **Step 8: Commit (Global section C)**

Subject: `fix(storage): §548 — gate the background recommendation and calendar writers on loadPending`
Body: `The recommendation store and the calendar auto-sync pushes, background pulls and auto-pull runner run on timers and never unmount with the held app tree, so they now do nothing while loadPending. Mutations M4a-M4d each turn a named test red.`
New files: `src/app/use-calendar-integrations.load-hold.test.ts`
Paths: that plus `src/app/use-insight-recommendations.ts src/app/use-calendar-integrations.ts src/app/task-manager.tsx src/app/use-insight-recommendations.test.tsx src/app/task-manager.load-hold.test.tsx`.

---

### Task 5: §577 — the budget-variance insight compares budget to date

**Files:**
- Modify: `src/app/insights/detect.ts` (import; `ownBudgetHoursToDate`; `budgetVarianceInsight`; `detectInsights`)
- Modify: `src/app/insights/detect.test.ts` (four tests in `describe("budgetVariance")`)

**Interfaces:**
- Consumes: `bucketActivePeriods`, `bucketRateRows`, `effectiveBudgetHours`, `computeBudgetReport` from `src/app/budget-report.ts` (all exported today); `BucketReport.bucketId`, `.actualHours`, `.spilloverInHours`.
- Produces: no new exports. `budgetVarianceInsight` gains a trailing `today: string` parameter (module-private).

- [ ] **Step 1: Write the failing tests**

In `src/app/insights/detect.test.ts`, inside `describe("budgetVariance", () => {`, after the test "fires when plan.budgetFollowsPlan and actual exceeds planned capacity", append (TODAY is `2026-06-15`, PLAN runs Jan–Dec 2026 by month):

```ts
  // ★★★ §577 — the register's reproduction, reduced: an OPEN bucket budgeted across the whole year with
  // nothing booked read 100% against the whole-window budget and beat a real overspend to "worst".
  it("an untouched bucket neither breaches nor wins; the real overspend is worst (§577)", () => {
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    const untouched = bucket({
      id: 1, name: "Advisory retainer",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: Object.fromEntries(months.map((m) => [`2026-${m}`, 27])), actualHours: {} }],
    });
    const overspend = bucket({
      id: 2, name: "Capped SOW",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 150 } }],
    });
    const bv = detect({ budgets: [untouched, overspend], plan: PLAN }).filter((i) => i.type === "budgetVariance");
    expect(bv).toHaveLength(1);
    expect(bv[0].data.name).toBe("Capped SOW");
    expect(bv[0].data.buckets).toBe(1);
    expect(bv[0].data.variancePct).toBe(50);
  });

  it("future periods do not count toward the budget (§577)", () => {
    // Whole-window budget 1000 vs 105 read as an 89% variance; to date it is 100 vs 105 = 5%.
    const b = bucket({ allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100, "2026-12": 900 }, actualHours: { "2026-01": 105 } }] });
    expect(detect({ budgets: [b], plan: PLAN }).filter((i) => i.type === "budgetVariance")).toHaveLength(0);
  });

  it("a bucket whose window has not started is skipped even with hours booked (§577)", () => {
    const b = bucket({
      startDate: "2026-09-01", endDate: "2026-12-31",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-09": 100 }, actualHours: { "2026-09": 40 } }],
    });
    expect(detect({ budgets: [b], plan: PLAN }).filter((i) => i.type === "budgetVariance")).toHaveLength(0);
  });

  // Ruling 4 in the plan: a closed predecessor's spillover stays part of the successor's budget to date.
  // Predecessor: 1000 budgeted, 910 booked (9%, under the threshold), so 90 h spill into the successor.
  // Successor: 300 budgeted Apr–Jun, 380 booked. Own-only that is 26.7%; with the spillover 390 vs 380.
  it("a closed predecessor's spillover counts toward the successor's budget to date", () => {
    const predecessor = bucket({
      id: 1, name: "Phase 1", status: "closed", successorId: 2, startDate: "2026-01-01", endDate: "2026-03-31",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 400, "2026-02": 300, "2026-03": 300 }, actualHours: { "2026-01": 910 } }],
    });
    const successor = bucket({
      id: 2, name: "Phase 2", startDate: "2026-04-01", endDate: "2026-12-31",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-04": 100, "2026-05": 100, "2026-06": 100 }, actualHours: { "2026-04": 380 } }],
    });
    expect(detect({ budgets: [predecessor, successor], plan: PLAN }).filter((i) => i.type === "budgetVariance")).toHaveLength(0);
  });
```

If tsc rejects `status: "closed"` or `successorId` on the `bucket()` factory's `Partial<BudgetBucket>`, read `BudgetBucket` in `src/app/types.ts` and use its real field spellings; do not cast.

- [ ] **Step 2: Run them and verify the right ones fail**

Run (Global section V): `npx vitest run src/app/insights/detect.test.ts --maxWorkers=1 --reporter=dot > "$SCRATCH/t5-red.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1`. The first three new tests fail. The spillover test passes (today's code already counts spillover; it pins ruling 4 against the change). The existing four `budgetVariance` tests and "orders by severity desc then key asc" pass.

- [ ] **Step 3: Implement in `src/app/insights/detect.ts` (CRLF — Edit tool)**

(a) Import. Replace `import { computeBudgetReport } from "../budget-report";` with:

```ts
import { bucketActivePeriods, bucketRateRows, computeBudgetReport, effectiveBudgetHours } from "../budget-report";
```

(b) Replace the whole `budgetVarianceInsight` function (from `// --- budgetVariance ---` through its closing `}`, ending just before `// --- raidAging ---`) with:

```ts
// --- budgetVariance --------------------------------------------------------
// Reuses computeBudgetReport for the actual HOURS and the spillover, then compares each started
// bucket's actuals with its budget TO DATE and flags the worst |variance %| that meets the threshold.
// Singleton.

/** §577 — a bucket's OWN budget hours in the periods that have STARTED by `today`: the same per-period
 *  rule the report and the burn-down use (`effectiveBudgetHours`, budget-follows-plan included) and the
 *  burn-down's cutoff (a period counts once its start is <= today). `null` when no period of the
 *  bucket's window has started. Periods are filtered by DATE, never by bucket status. */
function ownBudgetHoursToDate(
  bucket: BudgetBucket,
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  holidaySet: ReadonlySet<string>,
  today: string,
): number | null {
  const periods = bucketActivePeriods(bucket, plan);
  const started = periods.filter((p) => p.start <= today);
  if (started.length === 0) return null;
  const followsPlan = plan.budgetFollowsPlan ?? false;
  const byId = new Map(resources.map((r) => [r.id, r]));
  let hours = 0;
  for (const row of bucketRateRows(bucket, roles)) {
    for (const p of started) {
      hours += effectiveBudgetHours(row, p, periods, resources, BUDGET_WORKDAY_HOURS, holidaySet, plan.granularity, [], followsPlan, byId);
    }
  }
  return hours;
}

function budgetVarianceInsight(
  budgets: readonly BudgetBucket[],
  plan: ResourcePlan | null,
  roles: readonly Role[],
  resources: readonly Resource[],
  holidaySet: ReadonlySet<string>,
  today: string,
): DetectedInsight | null {
  if (plan === null || budgets.length === 0) return null;
  // roles/resources are forwarded so that when plan.budgetFollowsPlan is true the
  // engine derives real budget HOURS from planned capacity (empty resources would
  // collapse budgetHours to 0 and silently drop the overrun).
  // Hours-only detector: it reads budgetHours/actualHours and no money term, so
  // no FX is needed. Explicit null rather than a threaded rate — stated here so
  // it is a visible decision, not a silent default. If this detector ever reads
  // a money figure, thread fxRates through InsightInput first (§465).
  const report = computeBudgetReport(budgets, plan, roles, resources, BUDGET_WORKDAY_HOURS, holidaySet, [], [], null);
  const bucketsById = new Map(budgets.map((b) => [b.id, b]));
  let worstName = "";
  let worstPct = 0;
  let breaching = 0;
  for (const b of report.buckets) {
    // ★★★ §577 — actuals are TO DATE, so the budget must be too: the whole-window budget flagged every
    //   open bucket with future months, and an untouched bucket read 100% and won "worst".
    // An untouched bucket (nothing booked) is not a variance.
    if (b.actualHours === 0) continue;
    const source = bucketsById.get(b.bucketId);
    if (!source) continue;
    const ownToDate = ownBudgetHoursToDate(source, plan, roles, resources, holidaySet, today);
    if (ownToDate === null) continue; // the window has not started: nothing is budgeted to date
    // A closed predecessor's spillover (±) is available from this bucket's start, as in the report.
    const budgetToDate = ownToDate + b.spilloverInHours;
    if (budgetToDate <= 0) continue;
    const pct = Math.abs(((b.actualHours - budgetToDate) / budgetToDate) * 100);
    if (pct < BUDGET_VARIANCE_PCT) continue;
    breaching++;
    if (pct > worstPct) { worstPct = pct; worstName = b.name; }
  }
  if (breaching === 0) return null;
  return {
    key: "budgetVariance",
    type: "budgetVariance",
    severity: "medium",
    data: { name: worstName, variancePct: Math.round(worstPct), buckets: breaching },
  };
}
```

(c) In `detectInsights`, replace `  const budget = budgetVarianceInsight(input.budgets, input.plan, input.roles, input.resources, input.holidaySet);` with `  const budget = budgetVarianceInsight(input.budgets, input.plan, input.roles, input.resources, input.holidaySet, today);`.

- [ ] **Step 4: Run the tests**

Run Step 2's command. Expected: `EXIT=0`, `Test Files  1 passed (1)`.

- [ ] **Step 5: Re-measure the register's reproduction (read-only, throwaway)**

Write `$SCRATCH/bv-577.ts` (scratch only, never committed):

```ts
import { readFileSync } from "node:fs";
import { detectInsights } from "C:/Projects/aipm-cockpit/src/app/insights/detect";
const m = JSON.parse(readFileSync("C:/Projects/aipm-cockpit/sample-workspace-small.json", "utf8"));
const out = detectInsights({
  tasks: m.tasks ?? [], milestones: m.milestones ?? [], raid: m.raid ?? [], budgets: m.budgets ?? [],
  roles: m.roles ?? [], resources: m.resources ?? [], plan: m.plan ?? null,
  priorOverdueCount: null, timelogViolations: null, holidaySet: new Set<string>(),
}, "2026-09-18");
console.log(JSON.stringify(out.find((i) => i.type === "budgetVariance") ?? null));
```

Run `npx vite-node "$SCRATCH/bv-577.ts" > "$SCRATCH/t5-repro.log" 2>&1; echo "EXIT=$?"`. If vite-node cannot resolve the absolute import, change it to a path relative to the script. Record the printed line in the task report. The register measured 6 of 7 buckets breaching with "Advisory Retainer (blended)" (0/324) as worst, beating "Capped SOW" (83.5%). Expected now: the worst is no longer an untouched bucket. Report what it actually prints.

- [ ] **Step 6: Mutations (revert each; prove with `git diff --stat`)**

- M5a (untouched skip): delete `if (b.actualHours === 0) continue;`. Expected red: "an untouched bucket neither breaches nor wins…". Revert.
- M5b (cutoff): in `ownBudgetHoursToDate`, change `for (const p of started)` to `for (const p of periods)`. Expected red: "future periods do not count…". Revert.
- M5c (not-started skip): change `if (started.length === 0) return null;` to `if (started.length === 0) return 0;` AND the loop to `for (const p of periods)`. Expected red: "a bucket whose window has not started…". Revert.
- M5d (spillover, ruling 4): change `ownToDate + b.spilloverInHours` to `ownToDate`. Expected red: "a closed predecessor's spillover counts…". Revert.

- [ ] **Step 7: Gates**

- vitest: Step 2's command, `EXIT=0`, `Test Files  1 passed (1)`.
- tsc: `EXIT=0`, `0`.
- `npx eslint --max-warnings=0 src/app/insights/detect.ts src/app/insights/detect.test.ts; echo "EXIT=$?"` gives `EXIT=0`.

- [ ] **Step 8: Commit (Global section C)**

Subject: `fix(insights): §577 — budget variance compares actuals with budget to date`
Body: `budgetVarianceInsight compared to-date actuals with the whole-window budget, so every open bucket with future months was flagged and an untouched bucket read 100% and won "worst". It now compares each bucket's actual hours with its own budget in the periods started by today (effectiveBudgetHours, the burn-down's cutoff) plus a closed predecessor's spillover, and skips buckets with nothing booked or whose window has not started. Mutations M5a-M5d each turn a named test red.`
Paths: `src/app/insights/detect.ts src/app/insights/detect.test.ts`.

---

### Task 6: Docs and register — the load hold, target-key merging; close §548 §591 §577

**Files:**
- Modify: `docs/AGENTS/platform.md` (new section; title)
- Modify: `docs/AGENTS/activity-log.md` (the `logMode` paragraph)
- Modify: `docs/AGENTS/insights.md` only if it describes the `budgetVariance` detector's budget figure (Step 3)
- Modify: `AGENTS.md` (the two platform.md table rows)
- Modify: `docs/open-followups.md` (close §548, §591, §577)

**Interfaces:**
- Consumes: the symbols shipped by Tasks 1–5: `loadPending`, `settledBackend`, `holdDuring`, `storageTargetKey`, `scopeTargetKeyRef`, `ownBudgetHoursToDate`.
- Produces: nothing code-facing.

- [ ] **Step 1: `docs/AGENTS/platform.md` (LF — Edit tool)**

Replace the title line `# Diagnostics · guards · dictation · AI master switch` with `# Diagnostics · guards · dictation · AI master switch · the load hold`. Append at the end of the file:

```markdown

### The load hold (§548)

- **`loadPending` (`useStorageBackend`) is true while a project load or project swap is in flight**:
  from hydration until the load effect for the CURRENT `backend` instance reaches a terminal branch,
  and while any of the nine ops wrapped by `holdDuring` runs (`reloadCurrentProject`,
  `switchToProject`, `createProject`, `loadProjectFromFile`, `createDemoProject`, `onOpenStorageFile`,
  `switchToTursoProject`, `createTursoProject`, `migrateCurrentProjectToTurso`). It is false before
  hydration. ★ Enumerate the wraps with `grep -n "holdDuring(" src/app/use-storage-backend.ts`.
- ★★★ **It is NOT `workspaceLoaded`.** `workspaceLoaded` stays false after a FAILED load and after the
  empty-load refusal (§77), which is right for snapshot capture and saving. Holding edits on it would
  lock the app for the whole session after one load error. `settledBackend` is stamped on EVERY terminal
  branch: applied (inside `applyWorkspace`), the suppress-branch re-stamp, the refusal and the `catch`.
  Identity, not a latch, so a rebuilt backend (project switch, kind switch, Turso or SharePoint target
  edit) starts unsettled with no reset code.
- **The render hold.** `task-manager.tsx` renders `PanelSkeleton` instead of the main-window app tree
  while `loadPending` is true (the same ternary `showTursoListLoading` uses). No control that writes
  workspace state exists during the hold, so the UI writers outside `guardEdit` are covered, and so is
  any writer added later. A failed or refused load settles, so the storage banner, Settings and "Pick
  storage file" stay reachable. Popouts return before this ternary and are never held. `guardEdit` /
  `makeEditGuard` are unchanged.
- ★★ **Background writers do not unmount, and each gates itself.** Today: the insight reconcile effect
  (`task-manager.tsx`), the recommendation store `applyInsightRecommendation`
  (`use-insight-recommendations.ts`, which both the background runner and the on-demand generate write
  through), the four calendar auto-sync pushes and four background pulls plus the auto-pull runner
  (`use-calendar-integrations.ts`), and the undo hotkey (`useUndoHotkey`, read through `loadPendingRef`).
  **A new timer, interval, listener or subscription that writes workspace state must check
  `loadPending` too**; the render hold cannot reach it.
- ★ Pinned by `use-storage-backend.load-pending.test.tsx` (the signal), `task-manager.load-hold.test.tsx`
  (render hold, reconcile, hotkey, popout exemption, wiring), `use-calendar-integrations.load-hold.test.ts`,
  `use-insight-recommendations.test.tsx` and `e2e/load-hold.spec.ts`. Six of the nine `holdDuring` wraps
  are verified by review only (see the plan's ruling 9).
- ★ Not covered: the window between `i18nReady` and `hydrated`, when the tree is live over the boot
  workspace (the spec left the pre-hydration render unchanged), and a load that never settles, which
  keeps the skeleton up (SharePoint's Graph fetch has no timeout).
```

- [ ] **Step 2: `docs/AGENTS/activity-log.md` (LF — Edit tool)**

Replace:

```
  `logMode` and silently take the default. Widening that contract is what would let one of them opt into
  the contaminating branch — check the TYPE, not the call text.
```

with:

```
  `logMode` and silently take the default. Widening that contract is what would let one of them opt into
  the contaminating branch — check the TYPE, not the call text.
  ★★★ **The two MERGE callers merge only onto the SAME storage target (§591).** The load effect and
  `reloadCurrentProject` compare `storageTargetKey` (the storage kind plus the Turso URL, token and
  project id, or the SharePoint host, site and item path; `acquireToken` deliberately excluded) with
  `scopeTargetKeyRef`, the target the in-scope workspace belongs to, and pass "replace" when they differ.
  A settings-driven rebuild used to merge the PREVIOUS target's log and budget history into the new one.
  The ref is stamped on the load effect's first hydrated run (so the boot load merges this session's own
  appends), on every applied load and on the suppress-branch re-stamp after a project op; the empty-load
  refusal and a failed load leave it alone, so a later "Reload project" onto that target REPLACES, as
  `reloadEmptyConfirm` says. An M365 sign-in/out (an `acquireToken`-only rebuild) keeps merging. Pinned
  by `use-storage-backend.target-key.test.tsx`.
```

- [ ] **Step 3: `docs/AGENTS/insights.md`**

Run `grep -n "budgetVariance\|budget-to-date\|whole-window\|computeBudgetReport" docs/AGENTS/insights.md docs/AGENTS/dashboard.md`. If a line there describes which budget figure the `budgetVariance` detector compares with, correct it to: actual hours against the bucket's own budget in periods started by `today` (by `effectiveBudgetHours`) plus a closed predecessor's spillover, skipping buckets with nothing booked or whose window has not started (§577). If nothing describes it, change nothing and say so in the report.

- [ ] **Step 4: `AGENTS.md` (LF — Edit tool)**

Replace `| [platform](docs/AGENTS/platform.md) | diagnostics · guard transparency · dictation · AI master switch |` with `| [platform](docs/AGENTS/platform.md) | diagnostics · guard transparency · dictation · AI master switch · the load hold (§548) |`, and replace `| [platform.md](docs/AGENTS/platform.md) | diagnostics ring · guard transparency · dictation · the AI master switch |` with `| [platform.md](docs/AGENTS/platform.md) | diagnostics ring · guard transparency · dictation · the AI master switch · the load hold (`loadPending`, the render hold, the background-writer gates) |`.

- [ ] **Step 5: Close §548, §591 and §577 in `docs/open-followups.md`**

The register's convention (the most recent closures, §586/§587): the `##` heading's ` — OPEN` becomes ` — CLOSED <date>`; the `**Status:**` paragraph is replaced by ONE `**Status:** CLOSED <date> by \`fix/storage-hold-batch\`: …` line; **the `**Work item:** #NN` line is DELETED** (`followups:workitems:check` fails a closed entry that still carries one — this has broken CI three times); the index row gets the new anchor, its Item cell loses ` — OPEN`, and its last cell becomes `**CLOSED** <date>`; every other link in the register to the old `--open` anchor is re-pointed. Origin and Size cells are kept. Use the commit date (`date +%F`); the texts below say `2026-09-19`.

Create `$SCRATCH/close-followup.cjs` with the Write tool:

```js
// close-followup.cjs — close ONE docs/open-followups.md entry in place and re-point links to it.
// Usage (from the repo root): node close-followup.cjs <n> <YYYY-MM-DD> <status-file>
"use strict";
const fs = require("fs");
const P = "docs/open-followups.md";
const [n, date, statusFile] = process.argv.slice(2);
if (!/^\d+$/.test(n || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !statusFile) {
  throw new Error("usage: <n> <YYYY-MM-DD> <status-file>");
}
const status = fs.readFileSync(statusFile, "utf8").trim();
if (!status.startsWith("**Status:** CLOSED ")) throw new Error("status must start with **Status:** CLOSED");
if (status.includes("\n")) throw new Error("status must be ONE line");
const src = fs.readFileSync(P, "utf8");
if (src.includes("\r\n")) throw new Error("register is expected to be LF");
const L = src.split("\n");
const slugOf = (heading) => heading.slice(3).replace(/`|~~|\*\*/g, "").toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");
const h = L.findIndex((l) => l.startsWith(`## ${n}. `));
if (h < 0) throw new Error(`no heading for §${n}`);
if (!L[h].endsWith(" — OPEN")) throw new Error(`§${n} heading does not end in " — OPEN": ${L[h]}`);
const oldSlug = slugOf(L[h]);
L[h] = L[h].slice(0, -" — OPEN".length) + ` — CLOSED ${date}`;
const newSlug = slugOf(L[h]);
const sectionEnd = () => {
  const i = L.findIndex((l, j) => j > h && /^## \d+\. /.test(l));
  return i < 0 ? L.length : i;
};
// 1. Replace the Status paragraph (first **Status:** line of the section through the line before the next blank).
const s = L.findIndex((l, j) => j > h && j < sectionEnd() && l.startsWith("**Status:**"));
if (s < 0) throw new Error(`§${n} has no **Status:** line`);
let e = s;
while (e + 1 < L.length && L[e + 1] !== "") e++;
L.splice(s, e - s + 1, status);
// 2. DELETE the Work item line and the blank line after it.
const w = L.findIndex((l, j) => j > h && j < sectionEnd() && l.startsWith("**Work item:**"));
if (w < 0) throw new Error(`§${n} has no **Work item:** line`);
if (L[w + 1] !== "") throw new Error(`§${n}: the line after Work item is not blank`);
L.splice(w, 2);
// 3. Rewrite the index row.
const r = L.findIndex((l) => l.startsWith(`| [§${n}](#`));
if (r < 0) throw new Error(`no index row for §${n}`);
const cells = L[r].slice(2, -2).split(" | ");
if (cells.length !== 5) throw new Error(`index row for §${n} has ${cells.length} cells, expected 5`);
cells[0] = `[§${n}](#${newSlug})`;
cells[1] = cells[1].replace(/ — OPEN$/, "");
cells[4] = `**CLOSED** ${date}`;
L[r] = `| ${cells.join(" | ")} |`;
// 4. Re-point every other link to the old anchor.
let out = L.join("\n");
const before = out.split(`(#${oldSlug})`).length - 1;
out = out.split(`(#${oldSlug})`).join(`(#${newSlug})`);
fs.writeFileSync(P, out);
console.log(`closed §${n}\n  anchor: #${newSlug}\n  re-pointed links: ${before}`);
```

Expected anchors after closing on 2026-09-19 (computed from today's headings with that slug rule):

| § | anchor |
|---|---|
| 548 | `#548-an-edit-made-during-a-projects-first-backend-load-is-overwritten-when-that-load-lands--closed-2026-09-19` |
| 577 | `#577-the-budgetvariance-insight-compares-full-window-budget-against-to-date-actuals-so-open-buckets-with-future-months-are-flagged-and-an-unstarted-bucket-can-read-100-and-win-worst--closed-2026-09-19` |
| 591 | `#591-after-a-turso-urltoken-or-sharepoint-target-change-the-previous-projects-activity-log-and-budget-history-are-merged-into-the-new-target--closed-2026-09-19` |

Write the three status files (one line each, no trailing newline needed):

`$SCRATCH/status-591.txt`:
```
**Status:** CLOSED 2026-09-19 by `fix/storage-hold-batch`: `useStorageBackend` records which storage target the in-scope workspace belongs to (`scopeTargetKeyRef`, compared with `storageTargetKey` — the storage kind plus the Turso URL, token and project id, or the SharePoint host, site and item path; `acquireToken` deliberately excluded), and the load effect and `reloadCurrentProject` pass `logMode` "merge" only when it is unchanged, otherwise "replace". Pinned by `src/app/use-storage-backend.target-key.test.tsx` (a Turso URL change and a SharePoint target change onto a populated target, a rebuild onto an empty target then "Reload project", and an `acquireToken`-only rebuild that still merges) and `src/app/storage-target-key.test.ts`; never machine-verified against a live Turso project or SharePoint.
```

`$SCRATCH/status-548.txt`:
```
**Status:** CLOSED 2026-09-19 by `fix/storage-hold-batch`: `useStorageBackend` publishes `loadPending` — true from hydration until the load effect for the current backend reaches any terminal branch (applied, suppressed re-stamp, empty-load refusal or failure), and while one of the nine project-swap ops wrapped by `holdDuring` is in flight — and `task-manager.tsx` renders the existing `PanelSkeleton` instead of the main-window app tree while it is true, so no UI edit can start inside the window; the writers that do not unmount (the insight reconcile, the recommendation store, calendar auto-sync and auto-pull, the undo hotkey) gate on the same boolean. Pinned by `src/app/use-storage-backend.load-pending.test.tsx`, `src/app/task-manager.load-hold.test.tsx`, `src/app/use-calendar-integrations.load-hold.test.ts`, `src/app/use-insight-recommendations.test.tsx` and `e2e/load-hold.spec.ts`; see `docs/AGENTS/platform.md` "The load hold" for what it does not cover.
```

`$SCRATCH/status-577.txt`:
```
**Status:** CLOSED 2026-09-19 by `fix/storage-hold-batch`: `budgetVarianceInsight` now compares each bucket's actual hours with its budget to date — its own `effectiveBudgetHours` over the periods started by `today` (`ownBudgetHoursToDate`), plus a closed predecessor's spillover — and skips buckets with nothing booked or whose window has not started. Pinned by four tests in the `budgetVariance` block of `src/app/insights/detect.test.ts`; the sample-workspace reproduction was re-run with a throwaway `vite-node` script (result in the MR description).
```

Run, from the repo root:

```bash
node "$SCRATCH/close-followup.cjs" 591 2026-09-19 "$SCRATCH/status-591.txt"; echo "EXIT=$?"
node "$SCRATCH/close-followup.cjs" 548 2026-09-19 "$SCRATCH/status-548.txt"; echo "EXIT=$?"
node "$SCRATCH/close-followup.cjs" 577 2026-09-19 "$SCRATCH/status-577.txt"; echo "EXIT=$?"
```

Each must print `EXIT=0` and the expected anchor. Then prove the Work item lines are gone and no stale link remains:

```bash
for n in 548 577 591; do s=$(grep -n "^## $n\. " docs/open-followups.md | cut -d: -f1); e=$(awk -v s="$s" 'NR>s && /^## [0-9]+\. /{print NR; exit}' docs/open-followups.md); sed -n "${s},${e}p" docs/open-followups.md | grep -c "^\*\*Work item:\*\*"; done
grep -cE "#(548|577|591)-[a-z0-9-]*--open\)" docs/open-followups.md
```

Expected: three `0` lines, then `0`.

- [ ] **Step 6: Gates (each unpiped; read EXIT; 1 = drift, 2 = the gate could not scan, which demands the opposite response)**

```bash
npm run followups:workitems:check; echo "EXIT=$?"
npm run followups:index:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: every `EXIT=0`. If `docs:symbols:check` flags a name, the name is wrong in the doc (grep `src` for the real one) — never widen its allowlist.

- [ ] **Step 7: Commit (Global section C)**

Subject: `docs: §548 §591 §577 — the load hold and target-key merging; close the three`
Body: `docs/AGENTS/platform.md documents loadPending (and why it is not workspaceLoaded), the render hold and the background-writer gates; activity-log.md documents same-target merging. Closes §548, §591 and §577 in the register (Work item lines deleted, index rows and links re-pointed).`
Paths: `docs/AGENTS/platform.md docs/AGENTS/activity-log.md AGENTS.md docs/open-followups.md` plus `docs/AGENTS/insights.md` / `docs/AGENTS/dashboard.md` only if Step 3 changed one.

---

### Task 7: §573 — refresh the Open Points visual baseline (LAST)

**Files:**
- Modify: `e2e/visual.spec.ts-snapshots/open-points-visual-win32.png`
- Modify: `docs/open-followups.md` (close §573)

**Interfaces:**
- Consumes: Tasks 3 and 4 merged on this branch (the skeleton hold changes what shows before the load; the spec waits for the loaded app).
- Produces: nothing code-facing.

- [ ] **Step 1: Precondition**

`git log --oneline -8` must show the Task 3 and Task 4 commits. Stop any dev server you started (`npm run stop`). Do not chain Playwright invocations.

- [ ] **Step 2: Run the spec WITHOUT updating, to capture the actual screenshot**

`npx playwright test e2e/visual.spec.ts --project=visual -g "Open Points" --workers=1 > "$SCRATCH/t7-before.log" 2>&1; echo "EXIT=$?"`
Expected: `EXIT=1` (the baseline is stale). Always go through the spec: it seeds `tourSeen` and masks the version label. Find the images with `find test-results -name "open-points*"` (expected, actual and diff PNGs).

- [ ] **Step 3: Eye check — done by the CONTROLLER, not the implementer**

The implementer STOPS here and reports the three PNG paths and the diff pixel count from the log. The CONTROLLER opens the actual and diff images (the Read tool renders PNGs) and decides whether every difference is intended (the loaded Open Points view, no tour overlay, no skeleton, no error banner). Only on the controller's explicit go-ahead does the implementer continue. If the controller rejects it, stop the task and report; do not update.

- [ ] **Step 4: Update the baseline and re-run clean**

`npx playwright test e2e/visual.spec.ts --project=visual -g "Open Points" --update-snapshots --workers=1 > "$SCRATCH/t7-update.log" 2>&1; echo "EXIT=$?"` gives `EXIT=0`.
Then, as a separate invocation: `npx playwright test e2e/visual.spec.ts --project=visual -g "Open Points" --workers=1 > "$SCRATCH/t7-after.log" 2>&1; echo "EXIT=$?"` gives `EXIT=0`.
`git status --short e2e/` must show ONLY `e2e/visual.spec.ts-snapshots/open-points-visual-win32.png` modified. If any other snapshot changed, do not stage it: the commit below uses `--only` with the one path, so it stays out. Report it to the controller.

- [ ] **Step 5: Close §573**

`$SCRATCH/status-573.txt`:
```
**Status:** CLOSED 2026-09-19 by `fix/storage-hold-batch`: `e2e/visual.spec.ts-snapshots/open-points-visual-win32.png` regenerated through the spec (`npx playwright test e2e/visual.spec.ts --project=visual -g "Open Points" --update-snapshots`) after an eye check of the actual capture, and re-run clean; no CI job runs the visual project, so this has no pipeline effect.
```

Run `node "$SCRATCH/close-followup.cjs" 573 2026-09-19 "$SCRATCH/status-573.txt"; echo "EXIT=$?"` (the script from Task 6; recreate it from Task 6 Step 5 if the scratch directory was cleared). Expected anchor: `#573-the-open-points-visual-baseline-is-stale--closed-2026-09-19`. Then:

```bash
s=$(grep -n "^## 573\. " docs/open-followups.md | cut -d: -f1); e=$(awk -v s="$s" 'NR>s && /^## [0-9]+\. /{print NR; exit}' docs/open-followups.md); sed -n "${s},${e}p" docs/open-followups.md | grep -c "^\*\*Work item:\*\*"
grep -cE "#573-[a-z0-9-]*--open\)" docs/open-followups.md
```

Expected: `0` and `0`.

- [ ] **Step 6: Gates**

```bash
npm run followups:workitems:check; echo "EXIT=$?"
npm run followups:index:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: every `EXIT=0`.

- [ ] **Step 7: Commit (Global section C)**

Subject: `test(e2e): §573 — refresh the Open Points visual baseline; close §573`
Body: `Regenerated through visual.spec.ts (tourSeen seeded, version label masked) after an eye check of the actual capture, and re-run clean. The visual project runs in no CI job.`
Paths: `e2e/visual.spec.ts-snapshots/open-points-visual-win32.png docs/open-followups.md`.

---

## After the last task (controller, not a task)

- Whole-branch review (subagent-driven-development's final reviewer).
- CHANGELOG entry and version bump at release time only (spec). The MR description carries `Closes #336`, `Closes #375`, `Closes #362`, `Closes #358`, ONE PER LINE, and the §577 reproduction output from Task 5 Step 5. After merge, verify each issue's state and close any the automation missed by hand.

## Self-review (done while writing)

- **Spec coverage.** §1a signal → Task 2. §1b render hold → Task 3. §1c background writers: reconcile + undo hotkey → Task 3; recommendations + calendar push/pull → Task 4 (re-verified in the tree: `applyInsightRecommendation` is the single store for `useInsightRecommend` and `useInsightRecommendRunner`; `use-calendar-integrations.ts` has four `useCalendarAutoSync({` calls, four `background: true` pulls and one `useCalendarAutoPull({`). The nine swap ops were re-verified as functions in `use-storage-file-ops.ts` / `use-storage-turso-ops.ts` plus `reloadCurrentProject` in `use-storage-backend.ts`. §1 tests: hook (Task 2), render/popout/reproduction (Task 3), e2e (Task 3 Step 7). §2 → Task 1 with all four spec tests plus (e). §3 → Task 5 with the regression, the future-only test, and the existing four kept. §4 → Task 7. Docs/register → Tasks 2, 3, 6, 7.
- **Placeholder scan.** The only conditional instructions are Task 5 Step 1 (field spelling, if tsc objects), Task 5 Step 5 (import path fallback), Task 3 Step 4 (comment wrap), and Task 6 Step 3 (docs that may not mention the detector). Each names the exact fallback.
- **Type consistency.** `loadPending: boolean` everywhere; `storageTargetKey(input: StorageTargetInput): string`; `scopeTargetKeyRef` / `targetKey` / `settledBackend` / `swapsInFlight` / `holdDuring` / `loadPendingRef` / `ownBudgetHoursToDate` are spelled identically in every task and in the docs text.
- **Review Focus.** Five lines, each with a named test in its owning task.
