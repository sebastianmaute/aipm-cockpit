# Popout Read-Only Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop popout windows from triggering destructive file writes, and turn popouts into true read-only mirrors that cannot silently lose edits.

**Architecture:** (1) Make cross-window sync one-way — popouts receive but never send — so a popout's load never induces a save in the main window. (2) Harden `writeHandle` so a blocked write aborts the temp file instead of leaving the original deleted. (3) A lightweight read-only lockdown: a guard helper wraps the commit handlers funneled into `WorkspaceSection`, a banner marks popout windows, and the chat dispatcher refuses mutating tools in a popout.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-26-popout-readonly-mirror-design.md`

---

## File Structure

- `src/app/broadcast-sync.ts` — replace the unused `enabled` param with `canSend`; gate only the send effect (Task 1).
- `src/app/use-storage-backend.ts` — pass `canSend={!isPopout}` to all 9 `useBroadcastSync` calls (Task 2).
- `src/app/storage.ts` — export `writeHandle`; guard `write`/`close`, abort temp on failure (Task 3).
- `src/app/read-only-guard.ts` (new) — `makeEditGuard` helper (Task 4).
- `src/app/i18n.ts`, `src/app/i18n.de.ts` — `popoutReadOnly`, `popoutReadOnlyBanner` keys (Task 5).
- `src/app/read-only-mirror-banner.tsx` (new) — small banner component (Task 6).
- `src/app/task-manager.tsx` — build the guard, wrap commit handlers passed to `WorkspaceSection`, render the banner, pass `isReadOnly` to the chat dispatcher (Tasks 7, 8).
- `src/app/use-chat-dispatcher.ts` — `isReadOnly` arg; refuse mutating tools (Task 8).

Test files: `broadcast-sync.test.ts`, `use-storage-backend.test.tsx`, `storage.test.ts` (new), `read-only-guard.test.ts` (new), `read-only-mirror-banner.test.tsx` (new), `use-chat-dispatcher.test.tsx` (existing, extended).

**Verification commands** (this project uses Vitest + `tsc`):
- Single test file: `npx vitest run src/app/<file>.test.ts`
- Whole suite: `npx vitest run`
- Typecheck: `npx tsc --noEmit`

---

## Task 1: One-way sync — `canSend` gate in `useBroadcastSync`

**Files:**
- Modify: `src/app/broadcast-sync.ts:33-95`
- Test: `src/app/broadcast-sync.test.ts`

Context: `useBroadcastSync` has an `enabled` param (4th, default `true`) that today gates BOTH the receive listener and the send effect. No caller ever passes it as non-default. We replace it with `canSend` (default `true`) that gates ONLY the send effect, so a popout can keep receiving while never broadcasting.

- [ ] **Step 1: Write the failing test**

Add to `src/app/broadcast-sync.test.ts`, inside the existing `describe("useBroadcastSync", …)` block (after the "broadcasts a value change" test):

```ts
  it("does NOT broadcast a post-mount change when canSend is false", () => {
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) =>
        useBroadcastSync("tasks", v, () => {}, /* canSend */ false),
      { initialProps: { v: [] as number[] } },
    );
    rerender({ v: [1] });
    expect(posted).toHaveLength(0);
  });

  it("still broadcasts post-mount changes when canSend defaults to true", () => {
    const { rerender } = renderHook(
      ({ v }: { v: number[] }) => useBroadcastSync("tasks", v, () => {}),
      { initialProps: { v: [] as number[] } },
    );
    rerender({ v: [2] });
    expect(posted).toHaveLength(1);
  });
```

- [ ] **Step 2: Run test to verify behavior before the change**

Run: `npx vitest run src/app/broadcast-sync.test.ts`
Expected: the `canSend defaults to true` test PASSES; the `canSend is false` test passes only by coincidence today (the 4th arg is currently named `enabled` and also stops broadcasting). The rename in Step 3 makes the intent correct and keeps both green. Proceed.

- [ ] **Step 3: Rename `enabled` → `canSend`, move the gate to the send effect only**

In `src/app/broadcast-sync.ts`, change the signature and both effects:

```ts
export function useBroadcastSync<T>(
  kind: string,
  value: T,
  applyIncoming: (next: T) => void,
  canSend: boolean = true,
): void {
```

Receive listener effect — remove the `if (!enabled) return;` guard (the listener must always register so popouts receive). Its body keeps the `typeof window` / `typeof BroadcastChannel` guards. Change its dependency array from `[kind, enabled, applyIncoming]` to `[kind, applyIncoming]`.

Send effect — replace the guard and deps:

```ts
  useEffect(() => {
    if (!canSend) return;
    const channel = channelRef.current;
    if (!channel) return;
    if (Object.is(lastSeenRef.current, value)) return;
    lastSeenRef.current = value;
    const msg: SyncMessage<T> = {
      clientId: clientIdRef.current,
      kind,
      value,
    };
    channel.postMessage(msg);
  }, [kind, value, canSend]);
```

Also update the doc comment on the function to describe `canSend` ("when false, this instance receives but never broadcasts — used by popout/mirror windows").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/broadcast-sync.test.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/app/broadcast-sync.ts src/app/broadcast-sync.test.ts
git commit -m "fix(sync): popout receives but never broadcasts (canSend gate)"
```

---

## Task 2: Wire `canSend={!isPopout}` in `useStorageBackend`

**Files:**
- Modify: `src/app/use-storage-backend.ts:146-154`
- Test: `src/app/use-storage-backend.test.tsx`

Context: The 9 `useBroadcastSync` calls currently pass 3 args. We pass `!args.isPopout` as the 4th (`canSend`) so popouts never broadcast. The test file already mocks `useBroadcastSync` as `vi.fn()`.

- [ ] **Step 1: Write the failing test**

In `src/app/use-storage-backend.test.tsx`, add an import near the other imports:

```ts
import { useBroadcastSync } from "./broadcast-sync";
```

Add a new describe block after the "handlers" block:

```ts
describe("useStorageBackend — broadcast send gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("passes canSend=true to every useBroadcastSync call in the main window", () => {
    renderBackend(makeArgs({ isPopout: false }));
    const calls = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) {
      expect(call[3]).toBe(true);
    }
  });

  it("passes canSend=false to every useBroadcastSync call in a popout", () => {
    renderBackend(makeArgs({ isPopout: true }));
    const calls = (useBroadcastSync as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const call of calls) {
      expect(call[3]).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`
Expected: FAIL — `call[3]` is `undefined` (no 4th arg passed yet).

- [ ] **Step 3: Pass `canSend` to all 9 calls**

In `src/app/use-storage-backend.ts`, replace the block at lines 146-154 with:

```ts
  const canSend = !args.isPopout;
  useBroadcastSync("tasks", tasks, setTasks, canSend);
  useBroadcastSync("raid", raid, setRaid, canSend);
  useBroadcastSync("absences", absences, setAbsences, canSend);
  useBroadcastSync("shifts", shifts, setShifts, canSend);
  useBroadcastSync("resources", resources, setResources, canSend);
  useBroadcastSync("roles", roles, setRoles, canSend);
  useBroadcastSync("disciplines", disciplines, setDisciplines, canSend);
  useBroadcastSync("grades", grades, setGrades, canSend);
  useBroadcastSync("activityLog", args.activityLog, args.setActivityLog, canSend);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx
git commit -m "fix(storage): popout windows never broadcast (canSend=!isPopout)"
```

---

## Task 3: Harden `writeHandle` against a blocked write

**Files:**
- Modify: `src/app/storage.ts:1816-1829`
- Test: `src/app/storage.test.ts` (new)

Context: `createWritable()` writes a `.crswap` temp and atomically renames it over the original on `close()`. Today `write()`/`close()` are unguarded — a Chrome-blocked write around the atomic replace can leave the original deleted. We guard them, abort the temp on failure, and surface the existing `local-file-write-blocked` hint. `writeHandle` is currently module-internal; export it so it can be unit-tested.

- [ ] **Step 1: Write the failing test**

Create `src/app/storage.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { writeHandle, StorageNotReadyError } from "./storage";
import type { FsHandle } from "./storage";

function makeHandle(writable: {
  write: () => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
}): FsHandle {
  return {
    createWritable: vi.fn().mockResolvedValue(writable),
  } as unknown as FsHandle;
}

describe("writeHandle", () => {
  it("writes then closes on the happy path", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    await writeHandle(makeHandle({ write, close }), "content");
    expect(write).toHaveBeenCalledWith("content");
    expect(close).toHaveBeenCalled();
  });

  it("aborts the temp and throws local-file-write-blocked when write rejects", async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const writable = {
      write: vi.fn().mockRejectedValue(new DOMException("blocked", "AbortError")),
      close: vi.fn().mockResolvedValue(undefined),
      abort,
    };
    await expect(writeHandle(makeHandle(writable), "x")).rejects.toMatchObject({
      hint: "local-file-write-blocked",
    });
    expect(abort).toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
  });

  it("throws local-file-write-blocked when close rejects (no abort method present)", async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new DOMException("blocked", "AbortError")),
    };
    const err = await writeHandle(makeHandle(writable), "x").catch((e) => e);
    expect(err).toBeInstanceOf(StorageNotReadyError);
    expect((err as StorageNotReadyError).hint).toBe("local-file-write-blocked");
  });
});
```

If `FsHandle` is not currently exported from `storage.ts`, add `export` to its declaration (search for `FsHandle` near the top of the file). If it is a `type`, export the type.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/storage.test.ts`
Expected: FAIL — `writeHandle` is not exported (import error), and the abort/blocked behavior does not exist yet.

- [ ] **Step 3: Export and guard `writeHandle`**

In `src/app/storage.ts`, replace lines 1816-1829 with:

```ts
export async function writeHandle(handle: FsHandle, content: string): Promise<void> {
  let writable: {
    write(data: BlobPart): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  };
  try {
    writable = await handle.createWritable();
  } catch {
    // createWritable() throws AbortError / SecurityError when Chrome's security
    // policy blocks the path (corporate policy, externally-modified file, certain
    // NTFS zones). queryPermission() reports "granted" but the actual write is
    // still blocked — surface a targeted message instead of the raw DOMException.
    throw new StorageNotReadyError("local-file-write-blocked");
  }
  try {
    await writable.write(content);
    await writable.close();
  } catch {
    // The write/close failed AFTER the writable opened — e.g. the browser
    // blocked the atomic swap. Abort so the .crswap temp is discarded and the
    // rename over the original never runs, leaving the original file intact.
    // Without this, a blocked close can delete the original (data loss).
    try {
      await writable.abort?.();
    } catch {
      // abort is best-effort; ignore secondary failures.
    }
    throw new StorageNotReadyError("local-file-write-blocked");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage.test.ts
git commit -m "fix(storage): abort temp on blocked write so the original file survives"
```

---

## Task 4: `makeEditGuard` helper

**Files:**
- Create: `src/app/read-only-guard.ts`
- Test: `src/app/read-only-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/read-only-guard.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { makeEditGuard } from "./read-only-guard";

describe("makeEditGuard", () => {
  it("calls through to the handler when not read-only", () => {
    const notify = vi.fn();
    const fn = vi.fn();
    const guarded = makeEditGuard(false, notify)(fn);
    guarded("a", 1);
    expect(fn).toHaveBeenCalledWith("a", 1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies and no-ops the handler when read-only", () => {
    const notify = vi.fn();
    const fn = vi.fn();
    const guarded = makeEditGuard(true, notify)(fn);
    guarded("a", 1);
    expect(fn).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/read-only-guard.test.ts`
Expected: FAIL — `./read-only-guard` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/app/read-only-guard.ts`:

```ts
// Wraps an action so it becomes a no-op (with a notification) when read-only.
// Used to lock down edit affordances in popout/mirror windows: the affordance
// stays visible but committing is intercepted with a toast.
export function makeEditGuard(isReadOnly: boolean, notify: () => void) {
  return <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (isReadOnly) {
        notify();
        return;
      }
      fn(...args);
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/read-only-guard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/read-only-guard.ts src/app/read-only-guard.test.ts
git commit -m "feat(popout): add makeEditGuard read-only handler wrapper"
```

---

## Task 5: i18n keys for the read-only toast and banner

**Files:**
- Modify: `src/app/i18n.ts:753-754` (inside the `enUS` object, before the closing `} as const;`)
- Modify: `src/app/i18n.de.ts` (the `de` dictionary object)

Context: `enUS` is the source of truth; `TranslationKey = keyof typeof enUS`; `enGB` spreads `enUS` (auto-inherits, no edit needed); `de` is typed `Record<TranslationKey, string>`, so `tsc` fails until `de` has the new keys.

- [ ] **Step 1: Add the keys to `enUS`**

In `src/app/i18n.ts`, add these two lines just before the line `} as const;` (after `clickToEdit: "click to edit",`):

```ts
  popoutReadOnly: "Editing is disabled in the pop-out view — make changes in the main window.",
  popoutReadOnlyBanner: "Read-only mirror — make changes in the main window.",
```

- [ ] **Step 2: Add the matching German keys to `de`**

In `src/app/i18n.de.ts`, add these two lines to the `de` object (anywhere inside it — key order is irrelevant; put them near the other recently-added keys for tidiness):

```ts
  popoutReadOnly: "Bearbeiten ist in der abgedockten Ansicht deaktiviert – Änderungen bitte im Hauptfenster vornehmen.",
  popoutReadOnlyBanner: "Schreibgeschützte Ansicht – Änderungen bitte im Hauptfenster vornehmen.",
```

- [ ] **Step 3: Typecheck to verify parity**

Run: `npx tsc --noEmit`
Expected: PASS — no "Property 'popoutReadOnly' is missing in type" error for the `de` dictionary. (If `de` is missing a key, `tsc` fails here — add it.)

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add popout read-only toast and banner strings (EN + DE)"
```

---

## Task 6: `ReadOnlyMirrorBanner` component

**Files:**
- Create: `src/app/read-only-mirror-banner.tsx`
- Test: `src/app/read-only-mirror-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/read-only-mirror-banner.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";

describe("ReadOnlyMirrorBanner", () => {
  it("renders the read-only mirror message in English", () => {
    render(<ReadOnlyMirrorBanner lang="en-US" />);
    expect(screen.getByText(/read-only mirror/i)).toBeInTheDocument();
  });

  it("exposes a status role for assistive tech", () => {
    render(<ReadOnlyMirrorBanner lang="en-US" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/read-only-mirror-banner.test.tsx`
Expected: FAIL — `./read-only-mirror-banner` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/app/read-only-mirror-banner.tsx`. Match the Tailwind idiom used by the other banners in this app (a thin, muted info strip), using an amber palette consistent with `DueBanner`/`BirthdayBanner`:

```tsx
import { type Lang, t } from "./i18n";

interface ReadOnlyMirrorBannerProps {
  lang: Lang;
}

export function ReadOnlyMirrorBanner({ lang }: ReadOnlyMirrorBannerProps) {
  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      {t(lang, "popoutReadOnlyBanner")}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/read-only-mirror-banner.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/read-only-mirror-banner.tsx src/app/read-only-mirror-banner.test.tsx
git commit -m "feat(popout): add ReadOnlyMirrorBanner component"
```

---

## Task 7: Wire the guard + banner into `TaskManagerInner`

**Files:**
- Modify: `src/app/task-manager.tsx` (imports; the render body around lines 408-480)

Context (integration task — logic is unit-tested in Tasks 4 & 6). All committing handlers funnel into `<WorkspaceSection>` (lines 449-480). `<TasksSection>` is already `{!isPopout}`-gated, so `WorkspaceSection` is the popout's only editable surface (besides chat, handled in Task 8). We wrap the committing handlers with `makeEditGuard` and render the banner in popout windows. View/navigation handlers are NOT wrapped.

- [ ] **Step 1: Add imports**

Near the other `./` imports in `src/app/task-manager.tsx`:

```ts
import { makeEditGuard } from "./read-only-guard";
import { ReadOnlyMirrorBanner } from "./read-only-mirror-banner";
```

- [ ] **Step 2: Build the guard**

Immediately before the `if (!i18nReady) return null;` line (around line 408), add:

```ts
  const guardEdit = makeEditGuard(isPopout, () =>
    showToast("info", t(lang, "popoutReadOnly")),
  );
```

- [ ] **Step 3: Wrap the committing handlers passed to `<WorkspaceSection>`**

In the `<WorkspaceSection .../>` element (lines 449-480), wrap each COMMITTING handler prop with `guardEdit(...)`. Replace these specific props (leave all other props unchanged):

```tsx
        handleGanttBarUpdate={guardEdit(handleGanttBarUpdate)}
        handleSaveRaidItem={guardEdit(handleSaveRaidItem)}
        handleDeleteRaidItem={guardEdit(handleDeleteRaidItem)}
        handleCreateMitigationTaskFromRaid={guardEdit(handleCreateMitigationTaskFromRaid)}
        handleClearActivityLog={guardEdit(handleClearActivityLog)}
        handleOpenAddAbsence={guardEdit(handleOpenAddAbsence)}
        handleEditAbsence={guardEdit(handleEditAbsence)}
        handleOpenShiftEditor={guardEdit(handleOpenShiftEditor)}
        onManageRoles={guardEdit(handleOpenRolesModal)}
        onAssignRole={guardEdit(handleAssignResourceRole)}
        onSetUtilization={guardEdit(handleSetUtilization)}
        onSetUtilizationMode={guardEdit(handleSetUtilizationMode)}
        onSetAbsenceOverride={guardEdit(handleSetAbsenceOverride)}
        onSetPlanWindow={guardEdit(handleSetPlanWindow)}
        onSetPlanGranularity={guardEdit(handleSetPlanGranularity)}
        onEditResource={guardEdit(handleEditResource)}
        onAddResource={guardEdit(handleOpenAddResource)}
```

Do NOT wrap these (they are view/navigation, harmless in a mirror): `handleClearRaidTaskFilter`, `handleJumpToTaskFromRaid`, `handleCancelEdit`, `setTaskModalOpen`, `dispatcher`, `handleAcceptAiConsent`, and all layout/`workspaceRef`/`today`/`holidaySet` props.

Note on typing: `makeEditGuard` is generic over the handler's argument tuple, so `guardEdit(handleSetUtilization)` preserves each handler's signature. If TypeScript complains that a handler's return type is not `void` (e.g. a handler that returns a value the child ignores), wrap an arrow that discards the result: `onAssignRole={guardEdit((...a) => { handleAssignResourceRole(...a); })}`. Most of these handlers already return `void`.

- [ ] **Step 4: Render the banner in popout windows**

In the returned JSX, immediately inside the root `<div …>` (right after the opening tag at line ~417, before the `{!isPopout && (<AppHeader … />)}` block), add:

```tsx
      {isPopout && <ReadOnlyMirrorBanner lang={lang} />}
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — no existing tests regress. (There is no isolated render test for `TaskManagerInner`; its providers and `i18nReady` gating make whole-component rendering impractical. The guard and banner logic are covered by Tasks 4 and 6; this step verifies the wiring typechecks and breaks nothing.)

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat(popout): lock edit affordances and show read-only banner in mirror windows"
```

---

## Task 8: Refuse mutating chat tools in a popout

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (args interface; `sendInquiry`; the dispatcher `useMemo`)
- Modify: `src/app/task-manager.tsx` (the `useChatDispatcher({...})` call, ~line 387)
- Test: `src/app/use-chat-dispatcher.test.tsx` (extend)

Context: the chat dispatcher mutates workspace state directly via `setTasks`/`setSelectedIds`, NOT through the `WorkspaceSection` handlers, so Task 7 does not cover it. We refuse the five data-mutating tools when `isReadOnly`. Read/view tools (`listTasks`, `getTask`, `getSnapshot`, `setFilters`, `setLanguage`) stay enabled so a popout can still answer questions.

- [ ] **Step 1: Write the failing test**

Open `src/app/use-chat-dispatcher.test.tsx`, read its existing render harness (how it calls `renderHook(useChatDispatcher, …)` with providers and what args object it builds). Add a describe block that reuses that harness, passing `isReadOnly: true` (and `false`) in the args object. Concrete assertions:

```tsx
  it("refuses createTask in read-only (popout) mode and does not mutate", () => {
    const { result, tasksAfter } = renderReadOnlyDispatcher(); // harness with isReadOnly: true
    expect(() =>
      result.current.createTask({ taskName: "X", assignee: "Y", dueDate: "2026-06-01" }),
    ).toThrow(/pop-out|read-only|main window/i);
    expect(tasksAfter()).toHaveLength(0);
  });

  it("still answers read-only tools (listTasks) in read-only mode", () => {
    const { result } = renderReadOnlyDispatcher();
    expect(Array.isArray(result.current.listTasks())).toBe(true);
  });

  it("allows createTask when not read-only", () => {
    const { result } = renderEditableDispatcher(); // harness with isReadOnly: false
    const created = result.current.createTask({
      taskName: "X", assignee: "Y", dueDate: "2026-06-01",
    });
    expect(created.taskName).toBe("X");
  });
```

Implementation note for the test author: reuse the existing harness in this file — find where the existing tests build the `ChatDispatcherArgs` object and add `isReadOnly: true`/`false` to it; the two helpers (`renderReadOnlyDispatcher` / `renderEditableDispatcher`) wrap that. `tasksAfter()` reads workspace `tasks` from the same `useWorkspace()` probe the existing tests already use. Do NOT invent a new provider setup — match the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-chat-dispatcher.test.tsx`
Expected: FAIL — `isReadOnly` is not part of `ChatDispatcherArgs`; `createTask` does not throw.

- [ ] **Step 3: Add `isReadOnly` to the args interface**

In `src/app/use-chat-dispatcher.ts`, extend the interface:

```ts
export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
  /** True in a popout/mirror window — mutating tools are refused so chat edits
   *  can't be silently lost (popouts neither persist nor broadcast). */
  isReadOnly: boolean;
}
```

- [ ] **Step 4: Refuse the five mutating tools**

In `use-chat-dispatcher.ts`, add a guard at the top of each mutating tool. The dispatcher already throws for validation errors, and the chat tool-use loop surfaces thrown errors to the user, so throwing the localized message is consistent.

In `createTask`, `updateTask`, `deleteTask`, and `deleteAllTasks` (inside the `useMemo` dispatcher object), add as the FIRST statement of each:

```ts
        if (args.isReadOnly) throw new Error(t(settingsRef.current.language, "popoutReadOnly"));
```

In the `sendInquiry` `useCallback` (around line 75), add as the FIRST statement of the body:

```ts
      if (args.isReadOnly) return { sent: false, reason: "read-only" };
```

and add `args.isReadOnly` to `sendInquiry`'s dependency array.

Add `args.isReadOnly` to the dispatcher `useMemo` dependency array (it is constant per window, so this does not cause rebuilds). `t` is already imported in this file; `settingsRef` already exists. `args` is already closed over by the dispatcher (it references `args.setSelectedIds`/`args.setSettings`).

- [ ] **Step 5: Pass `isReadOnly` from `TaskManagerInner`**

In `src/app/task-manager.tsx`, update the `useChatDispatcher` call (~line 387):

```ts
  const dispatcher = useChatDispatcher({
    settings,
    today,
    setSelectedIds,
    setSettings,
    isReadOnly: isPopout,
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/task-manager.tsx src/app/use-chat-dispatcher.test.tsx
git commit -m "feat(popout): chat dispatcher refuses mutating tools in read-only mirror"
```

---

## Final verification

- [ ] **Run the whole suite and typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Manual smoke (the original repro — not unit-testable; Chrome File System Access)**

1. Run the app, switch storage to a local file (Settings → Storage), confirm it saves.
2. Go to Resources → pop the tab out.
3. Close the popout window.
4. Confirm: the local file still exists on disk and was NOT deleted, and the main window did not throw a security-policy write.
5. In the popout (before closing), confirm edit affordances are inert (toast appears) and the read-only banner shows; confirm the main window still saves its own edits normally.

---

## Self-Review

**Spec coverage:**
- Change 1 (popout receives, never sends) → Tasks 1 + 2.
- Change 2 (`writeHandle` guard + abort) → Task 3.
- Change 3 lockdown: guard helper → Task 4; banner → Task 6; wiring (gantt/raid/resources/activity/address-book) → Task 7; chat → Task 8; i18n keys → Task 5.
- Testing strategy (4 unit suites + manual smoke) → Tasks 1-8 tests + Final verification. The spec's "broadcast-sync send-gating" maps to Task 1; "use-storage-backend canSend" to Task 2; "makeEditGuard" to Task 4; "writeHandle" to Task 3. Chat gating, banner, and i18n are concrete tasks under Change 3.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 8's test references the existing file's harness by instruction (the harness already exists and must be matched, not reinvented) and provides concrete assertions and implementation.

**Type consistency:** `canSend` (Tasks 1, 2) is the 4th positional arg consistently. `makeEditGuard(isReadOnly, notify)(fn)` signature is identical in Tasks 4 and 7. `isReadOnly` arg name on `ChatDispatcherArgs` is consistent (Task 8). i18n keys `popoutReadOnly` / `popoutReadOnlyBanner` are spelled identically in Tasks 5, 6, 7, 8.
