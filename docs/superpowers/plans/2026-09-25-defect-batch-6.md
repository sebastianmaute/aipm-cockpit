# Defect Batch 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six verified user-facing defects (#359, #360, #328, #243, #297, #308) in one PR, one commit per issue.

**Architecture:** Each fix lands at the narrowest existing seam: an error-hint mapping (#359), a wire-only history transform (#360), one more `meta` row in the single-tenant Turso builder (#328), a per-device "env token rejected" flag that flips credential precedence (#243), a frame-name + title-signal protocol between renderer and Electron main (#297), and an opt-out field honoured by the two pure calendar planners (#308).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest 4 + Testing Library, `node:sqlite` statement harness, Electron (desktop shell), Microsoft Graph calendar.

**Spec:** `docs/superpowers/specs/2026-09-25-defect-batch-6-design.md`

## Global Constraints

- Do NOT touch (peer session `cockpit-main` owns them): `package*.json`, `desktop/package*.json`, `.github/*`, `src/app/icons.ts`, `src/app/icons.test.ts`, `src/app/error-boundary.tsx`, `src/app/recovery-banner.tsx`, `src/app/recovery-panel.tsx`, `vitest.config.ts`, `vitest.setup.ts`, `src/test/*`, `AGENTS.md`, `scripts/release-publish-lib*`, `desktop/src/updater*`.
- **CPU lock.** Before ANY `vitest`, `playwright`, `npm run test:*`, `npm run e2e*` or `npm run gate:local`: send `LOCK vitest` to session `cockpit-main` and wait until it has sent `UNLOCK vitest` for its own run. Send `UNLOCK vitest` when your process exits. Never two vitest processes on this machine at once. `tsc` and `eslint` need no lock.
- No `APP_VERSION` / `CHANGELOG.md` change.
- Commits: conventional type prefix, cite `§NNN` only (never `Closes #NN` in a commit), **no `Claude-Session:` trailer**. Use `git commit --only <paths>`; never `--amend`.
- `src/app/*.ts(x)` are CRLF in the working tree. Never `sed -i`. After editing, `git ls-files --eol <file>` must show `w/crlf`.
- `src/app/i18n.de.ts`: never the Edit tool (it corrupts umlauts and quotes). Patch with a node utf8 script that matches `\r\n`, then re-read the bytes. German strings use real umlauts.
- EN and DE i18n keys must be identical (`npx tsc --noEmit` enforces it).
- Read a gate's exit code unpiped: `cmd > $SCRATCH/x.log 2>&1; echo "EXIT=$?"`.
- Lint with `npx eslint --max-warnings=0 src` (every warning is fatal). No `Date.now()`/`new Date()` in a render body; no `setState` in an effect.
- Every new interactive control gets an accessible name that is unique per row, and a real `<label>`. Use the shared `Checkbox` from `form-controls.tsx`.

## Corrections to the spec (found while reading the code for this plan)

1. **#360 location.** `fitHistoryToBudget` goes in `chat-threads.ts`, not `chat-attachments.ts`. `attachmentPlaceholder` is private there, and `chat-threads.ts` already imports the `chat-api` types. Putting it in `chat-attachments.ts` would duplicate the placeholder.
2. **#328 mode flag not needed.** `workspaceToStatements` is already single-tenant-only: `TursoBackend.save` calls `tenantWorkspaceToStatements` whenever `projectId` is set. So `project_meta` is written unconditionally inside `workspaceToStatements`, and no mode parameter is threaded.
3. **#243 status.** A 401 already maps to `StorageErrorKind` `"auth"` → `storageAuthBanner`. The fix adds 403 to that path, a distinct `"auth-env"` kind when the rejected token is the env token, and the precedence flag.
4. **#297 signal.** There is no preload, so the renderer cannot call main. The page announces "ready" by setting `document.title` to `aipm-pdf-ready:<filename>`, which main observes via `page-title-updated`.
5. **#308 scope = five entities, not six.** `CommitteeMeeting` has no prune path (`grep -rn "outlookEventId: undefined" src/app --include=*.ts --include=*.tsx | grep -v test` lists prune only in `use-entity-calendar-pull.ts` and `use-milestone-calendar-pull.ts`). The five are Task, RaidItem, ChangeItem, Absence and Milestone.
6. **#308 untick keeps the link.** `planEntityReconcile` / `planCalendarReconcile` DELETE every listed Outlook event whose id no item keeps. So "untick clears the link" would make the next push delete the event, which contradicts "never deleted by the app". Instead, an opted-out item that still holds an `outlookEventId` keeps that id in `keptIds` (no delete) but is never updated. Prune clears the id AND sets the flag, as specced.

## Review Focus

1. **Under-budget chat thread.** A thread under 30 MB must send a byte-identical request, or prompt caching breaks silently. Task 2 pins this with deep equality and identity per block.
2. **An opted-out linked item must not be deleted from Outlook.** Task 6 pins `delete` excluding its id in both planners.
3. **An env token rejected, then fixed in the env.** Once a later pipeline call with the env token succeeds, the flag must clear, so a stale Settings token does not win forever. Task 4 pins the clearing.
4. **Project meta on an older single-DB database with no `project_meta` row.** It loads with `ws.project` undefined and no diag entry. Task 3 pins it.
5. **PDF export in the browser (not the desktop shell).** It must keep `_blank` plus the auto-print script. Task 5 pins both variants.

---

### Task 1: #359: browser-unsupported load reports the browser, not Settings

**Files:**
- Create: `src/app/use-fsa-supported.ts`
- Modify: `src/app/use-storage-backend.ts` (`reportProjectError`)
- Modify: `src/app/project-empty-state.tsx` (Load button near the `projectsEmptyLoad` label)
- Modify: `src/app/project-switcher.tsx` (the `projectSwitcherLoadFile` menuitem)
- Modify: `src/app/projects-panel.tsx` (the `projectSwitcherLoadFile` Button)
- Modify: `docs/open-followups.md` (§574 → closed)
- Test: `src/app/use-storage-backend.report-error.test.ts` (new), plus a case in each of `project-empty-state.test.tsx`, `project-switcher.test.tsx` and `projects-panel.test.tsx` (these exist; `ls` to confirm)

**Interfaces:**
- Produces: `useFsaSupported(): boolean` (true on the server, so SSR renders the control enabled with no hydration flash); `projectErrorKey(err: unknown): TranslationKey | null`, a pure helper exported from `use-storage-backend.ts` and used by `reportProjectError`.

- [ ] **Step 1: Extract the key decision so it is testable, and write the failing test**

Create `src/app/use-storage-backend.report-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { StorageNotReadyError } from "./workspace";
import { projectErrorKey } from "./use-storage-backend";

describe("projectErrorKey", () => {
  it("names the browser, not Settings, when file access is unsupported", () => {
    expect(projectErrorKey(new StorageNotReadyError("file-system-access-unsupported"))).toBe("storageFsaUnsupported");
  });
  it("keeps the permission-gesture key", () => {
    expect(projectErrorKey(new StorageNotReadyError("local-file-permission-needed"))).toBe("storagePermissionGestureNeeded");
  });
  it("falls back to storageNotReady for any other hint", () => {
    expect(projectErrorKey(new StorageNotReadyError("something-else"))).toBe("storageNotReady");
  });
  it("returns null for a non-storage error", () => {
    expect(projectErrorKey(new Error("x"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it (under the lock) and confirm it fails**

Run: `npx vitest run src/app/use-storage-backend.report-error.test.ts`
Expected: FAIL, `projectErrorKey` is not exported.

- [ ] **Step 3: Implement**

In `use-storage-backend.ts`, at module scope (outside the hook), add:

```ts
/** The toast key for a project-level storage error, or null when the error is
 *  not a StorageNotReadyError (the caller toasts those differently). §574: the
 *  browser-unsupported hint must name the BROWSER — the generic key tells the
 *  user to "pick a file in Settings", which cannot help in Firefox/Safari. */
export function projectErrorKey(err: unknown): TranslationKey | null {
  if (!(err instanceof StorageNotReadyError)) return null;
  if (err.hint === "local-file-permission-needed") return "storagePermissionGestureNeeded";
  if (err.hint === "file-system-access-unsupported") return "storageFsaUnsupported";
  return "storageNotReady";
}
```

Replace the `if (err instanceof StorageNotReadyError) { … }` branch of `reportProjectError` with:

```ts
    const key = projectErrorKey(err);
    if (key) {
      emitToast("error", t(langRef.current, key));
    } else if (!(err instanceof StorageNotImplementedError)) {
      emitToast("error", t(langRef.current, "storageLoadFailed", msg));
    }
```

Import `TranslationKey` from `./i18n` if it is not already imported.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/app/use-storage-backend.report-error.test.ts`. Expected: 4 passed.

- [ ] **Step 5: Add the support hook**

Create `src/app/use-fsa-supported.ts`:

```ts
// Hydration-safe "does this browser have the File System Access open picker?"
// The server snapshot is TRUE so SSR renders the load controls enabled; the
// client snapshot then disables them in Firefox/Safari (§574). Module-level
// functions keep the snapshot identities stable (an unstable getSnapshot
// makes useSyncExternalStore loop). Same pattern as task-manager-ui.tsx.
import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};
function getClient(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}
function getServer(): boolean {
  return true;
}

export function useFsaSupported(): boolean {
  return useSyncExternalStore(subscribeNoop, getClient, getServer);
}
```

It checks `showOpenFilePicker` because that is what `pickOpenFileAny` requires. `isFileSystemAccessSupported` checks the save picker instead.

- [ ] **Step 6: Failing tests for the three controls**

In each of the three component test files, add a case that deletes `showOpenFilePicker` for the test and restores it after:

```ts
it("disables Load from file and explains why when the browser lacks file access (§574)", () => {
  const had = "showOpenFilePicker" in window;
  const saved = (window as unknown as Record<string, unknown>).showOpenFilePicker;
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  try {
    // render the component exactly as this file's existing Load-from-file test does
    const btn = screen.getByRole("button", { name: /load/i }); // project-switcher: getByRole("menuitem", …)
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription("This browser doesn't support direct file access. Use Chrome, Edge, or Opera.");
  } finally {
    if (had) (window as unknown as Record<string, unknown>).showOpenFilePicker = saved;
  }
});
```

Reuse each file's own render helper and its existing name matcher for the Load control. jsdom has no `showOpenFilePicker`, so check whether existing tests define it. If they do not, the default already exercises the unsupported path, and an existing "calls onLoadFromFile" test must now set `window.showOpenFilePicker = () => {}` first. Grep each test file for `showOpenFilePicker` and `onLoadFromFile` and label every hit you must MIGRATE.

- [ ] **Step 7: Run and confirm they fail**, then implement in each component:

```tsx
const fsaSupported = useFsaSupported();
const fsaHintId = useId();
// …
<Button
  variant="secondary"
  onClick={onLoadFromFile}
  disabled={!fsaSupported}
  aria-describedby={fsaSupported ? undefined : fsaHintId}
>
  {t(lang, "projectsEmptyLoad")}
</Button>
{!fsaSupported && (
  <span id={fsaHintId} className="text-xs text-muted-foreground">{t(lang, "storageFsaUnsupported")}</span>
)}
```

For `project-switcher.tsx`, set `disabled={!fsaSupported}` and `aria-disabled` on the `menuitem` `<button>`, add `aria-describedby` the same way, and put the hint `<span>` inside the menu under the item. Keep `setOpen(false)` in `onClick`: a disabled button fires no click.

- [ ] **Step 8: Run the three tests plus the helper test.** Expected: all pass. Then `npx tsc --noEmit` and `npx eslint --max-warnings=0 src`. Expected: exit 0.

- [ ] **Step 9: Mutation check.** Revert the `file-system-access-unsupported` line in `projectErrorKey`, run the helper test, and expect the first case RED. Restore it, then `git diff --stat` must show only intended files.

- [ ] **Step 10: Register + commit**

In `docs/open-followups.md`, mark §574 closed the way other closed entries are marked (read two closed entries first and copy their shape), and update its index row. Run `npm run followups:index:check` and expect exit 0.

```bash
git add src/app/use-fsa-supported.ts src/app/use-storage-backend.report-error.test.ts
git commit --only src/app/use-fsa-supported.ts src/app/use-storage-backend.ts src/app/use-storage-backend.report-error.test.ts src/app/project-empty-state.tsx src/app/project-empty-state.test.tsx src/app/project-switcher.tsx src/app/project-switcher.test.tsx src/app/projects-panel.tsx src/app/projects-panel.test.tsx docs/open-followups.md -m "fix: name the browser, not Settings, when file access is unsupported (§574)"
```

---

### Task 2: #360: fit chat history under the request budget, oldest attachments first

**Files:**
- Modify: `src/app/chat-threads.ts` (add `fitHistoryToBudget` beside `stripAttachmentsForPersistence`)
- Modify: `src/app/chat-attachments.ts` (update the `MAX_STAGED_PAYLOAD_BYTES` doc comment only)
- Modify: `src/app/chat-panel.tsx` (`submitPrompt`: the `const messages = newHistory.slice();` line)
- Modify: `docs/open-followups.md` (§575 → closed)
- Test: `src/app/chat-threads.test.ts` (exists; add a `describe`)

**Interfaces:**
- Consumes: `MAX_STAGED_PAYLOAD_BYTES` from `./chat-attachments`; `ApiMessage`, `ContentBlock` from `./chat-api`.
- Produces: `fitHistoryToBudget(history: readonly ApiMessage[], maxBytes: number): ApiMessage[]`.

- [ ] **Step 1: Write the failing tests** (append to `chat-threads.test.ts`):

```ts
import { fitHistoryToBudget } from "./chat-threads";
import type { ApiMessage } from "./chat-api";

const doc = (n: number) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "x".repeat(n) } }) as const;
const user = (...content: unknown[]): ApiMessage => ({ role: "user", content: content as never });
const asst = (text: string): ApiMessage => ({ role: "assistant", content: [{ type: "text", text }] });

describe("fitHistoryToBudget (§575)", () => {
  it("returns the history unchanged, block for block, when under budget", () => {
    const h = [user(doc(10)), asst("ok"), user({ type: "text", text: "q" }, doc(10))];
    const out = fitHistoryToBudget(h, 100);
    expect(out).toEqual(h);
    out.forEach((m, i) => expect(m).toBe(h[i]));
  });
  it("strips the OLDEST earlier-turn attachment first and stops once it fits", () => {
    const h = [user(doc(40)), asst("a"), user(doc(40)), asst("b"), user(doc(30))];
    const out = fitHistoryToBudget(h, 80);
    expect(out[0].content).toEqual([{ type: "text", text: "[attachment: document]" }]);
    expect(out[2]).toBe(h[2]);
    expect(out[4]).toBe(h[4]);
  });
  it("never strips the current (last) turn, even when it alone is over budget", () => {
    const h = [user(doc(10)), asst("a"), user(doc(200))];
    const out = fitHistoryToBudget(h, 50);
    expect(out[2]).toBe(h[2]);
    expect(out[0].content).toEqual([{ type: "text", text: "[attachment: document]" }]);
  });
  it("does not mutate its input", () => {
    const h = [user(doc(60)), asst("a"), user(doc(60))];
    const snapshot = JSON.stringify(h);
    fitHistoryToBudget(h, 80);
    expect(JSON.stringify(h)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run and confirm it fails** (under the lock): `npx vitest run src/app/chat-threads.test.ts`. Expected: FAIL, not exported.

- [ ] **Step 3: Implement** in `chat-threads.ts` below `stripAttachmentsForPersistence`:

```ts
function attachmentBytes(block: ContentBlock): number {
  return block.type === "image" || block.type === "document" ? block.source.data.length : 0;
}

/** Wire-only: keep the outgoing request under `maxBytes` of attachment payload
 *  by replacing the OLDEST earlier-turn attachments with placeholders (§575).
 *  The LAST message (the current turn) is never touched — the staging cap
 *  already bounds it. Under budget the input array's own messages are returned
 *  unchanged, so an ordinary thread's request is byte-identical and the prompt
 *  cache prefix survives. Never mutates its input. */
export function fitHistoryToBudget(history: readonly ApiMessage[], maxBytes: number): ApiMessage[] {
  let total = 0;
  for (const m of history) {
    if (typeof m.content !== "string") for (const b of m.content) total += attachmentBytes(b);
  }
  if (total <= maxBytes) return history.slice();
  const out = history.slice();
  for (let i = 0; i < out.length - 1 && total > maxBytes; i++) {
    const msg = out[i];
    if (typeof msg.content === "string") continue;
    let changed = false;
    const content = msg.content.map((block) => {
      if (total <= maxBytes) return block;
      const placeholder = attachmentPlaceholder(block);
      if (!placeholder) return block;
      total -= attachmentBytes(block);
      changed = true;
      return placeholder;
    });
    if (changed) out[i] = { ...msg, content } as ApiMessage;
  }
  return out;
}
```

- [ ] **Step 4: Run and confirm it passes.** Expected: 4 new tests pass.

- [ ] **Step 5: Wire it in `chat-panel.tsx`**

Replace `const messages = newHistory.slice();` with:

```ts
    const messages = fitHistoryToBudget(newHistory, MAX_STAGED_PAYLOAD_BYTES);
```

and extend the ★★★ WIRE-ONLY comment above it with one line: `// §575: earlier turns' attachments are budgeted here too — the stored history keeps them.` Import `fitHistoryToBudget` from `./chat-threads` and `MAX_STAGED_PAYLOAD_BYTES` from `./chat-attachments`, checking for existing imports first.

In `chat-attachments.ts`, change the last sentence of the `MAX_STAGED_PAYLOAD_BYTES` doc comment from "Earlier turns' attachments re-sent in history are NOT counted here." to "Earlier turns' attachments are budgeted at send time by `fitHistoryToBudget` (chat-threads.ts)."

- [ ] **Step 6: Wiring test.** Find the existing `chat-panel` test that asserts the body sent to `callClaude` or `fetch` (`grep -ln "callClaude\|messages" src/app/chat-panel*.test.tsx`). Add a case: seed history with two earlier turns carrying `doc(20 * 1024 * 1024)` each, then send. Assert that the sent `messages[0]` content is the placeholder, and that component state still holds the original block (for example, the next send's history still contains it before budgeting). If no harness exists that can see the outgoing body, say so in the task report rather than writing a vacuous test.

- [ ] **Step 7: Verify.** Run the chat-threads and chat-panel tests, `npx tsc --noEmit` and `npx eslint --max-warnings=0 src`. All must exit 0.

- [ ] **Step 8: Mutation check.** Change the loop to run newest-first (`for (let i = out.length - 2; i >= 0 …; i--)`). Expect the "OLDEST first" test RED. Restore it.

- [ ] **Step 9: Register + commit**

```bash
git commit --only src/app/chat-threads.ts src/app/chat-threads.test.ts src/app/chat-attachments.ts src/app/chat-panel.tsx <chat-panel test file> docs/open-followups.md -m "fix: budget earlier-turn chat attachments at send time (§575)"
```

---

### Task 3: #328: single-DB Turso persists project meta

**Files:**
- Modify: `src/app/turso-schema.ts` (`workspaceToStatements` meta block; `rowsToWorkspace` meta reads; `dirtyWorkspaceTables` and its docstring)
- Modify: `src/app/turso-backend.ts` (the NOTE comment above `loadTenant` only)
- Modify: `src/app/use-turso-projects.ts` (`handleUpdateCurrentProjectByMode`)
- Modify: `docs/open-followups.md` (§538 → closed)
- Test: `src/app/turso-schema.execute.test.ts` (exists: real SQL on `node:sqlite`), `src/app/turso-schema.test.ts`, `src/app/use-turso-projects.test.tsx` (`ls` to confirm names)

**Interfaces:**
- Consumes: `sanitizeProjectMeta(input: unknown): ProjectMeta | null` (from `./sanitize`, re-exported from `sanitize-records.ts`; confirm the barrel exports it with grep).
- Produces: meta key `"project_meta"`, a JSON-stringified `ProjectMeta`.

- [ ] **Step 1: Failing tests**

In `turso-schema.execute.test.ts`, follow the file's existing round-trip helper (read how it executes `workspaceToStatements` and reads back through `selectStatements` + `rowsToWorkspace`) and add:

```ts
it("round-trips ws.project through the single-tenant meta table (§538)", () => {
  const ws = { ...emptyWorkspace(), project: { id: "p1", name: "Apollo", description: "d" } as ProjectMeta };
  const back = roundTrip(ws); // the file's own helper
  expect(back.project).toEqual(sanitizeProjectMeta(ws.project));
});
it("loads an older DB with no project_meta row as project undefined, with no diag entry (§538)", () => {
  const diag: DocTruncationDiag = {};
  const back = roundTrip({ ...emptyWorkspace(), project: undefined }, diag);
  expect(back.project).toBeUndefined();
  expect(diag.decodeFailedSlices ?? []).not.toContain("project_meta");
});
```

Build `ProjectMeta` with the REQUIRED fields of `types.ts` `ProjectMeta` (read it; the literal above is illustrative, and tsc will say what is missing).

In `turso-schema.test.ts` add:

```ts
it("marks meta dirty when only ws.project changed (§538)", () => {
  const prev = emptyWorkspace();
  const next = { ...prev, project: { ...(prev.project ?? {}), name: "Renamed" } as ProjectMeta };
  expect(dirtyWorkspaceTables(prev, next).has("meta")).toBe(true);
});
it("reports an unreadable project_meta row and still loads (§538)", () => {
  // Use the file's existing unreadable-slice pattern (grep "project_status" in this file) with key "project_meta" and value "{not json".
  // Expect diag.decodeFailedSlices to contain "project_meta" and ws.project to be undefined.
});
```

Write the second one out fully by copying the file's existing `project_status` unreadable-row test and changing the key.

- [ ] **Step 2: Run and confirm they fail** (under the lock).

- [ ] **Step 3: Implement save.** In `workspaceToStatements`, inside `if (isDirty("meta")) {`, directly after the `project_status` push:

```ts
    // §538 — single-tenant is the ONLY Turso layout with no projects row, so
    // project meta rides the meta table here. This builder is single-tenant-only
    // (TursoBackend.save calls tenantWorkspaceToStatements whenever a projectId
    // is set), so no mode flag is needed.
    if (ws.project) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "project_meta" },
          { type: "text", value: JSON.stringify(ws.project) },
        ],
      });
    }
```

- [ ] **Step 4: Implement load.** In `rowsToWorkspace`, after the `project_status` block:

```ts
  const pmRow = rowObjects(byTable.get("meta")).find((r) => r.key === "project_meta");
  if (pmRow?.value) {
    try {
      const pm = sanitizeProjectMeta(JSON.parse(pmRow.value));
      if (pm) ws.project = pm;
    } catch (err) {
      reportUnreadableSlice("project_meta", err);
    }
  }
```

`loadTenant` overwrites `project` from the projects row afterwards, and the tenant builder never writes `project_meta`, so tenant behaviour is unchanged. Update the NOTE comment above `loadTenant` to say `rowsToWorkspace` reads `project_meta` for single-tenant DBs only.

- [ ] **Step 5: Implement dirty.** In `dirtyWorkspaceTables` add `if (prev.project !== next.project) dirty.add("meta");`. Replace the "DELIBERATELY excluded" docstring paragraph with: "`ws.project` dirties `meta`: single-tenant saves it as the `project_meta` row (§538). The tenant builder ignores it (the projects row is written via turso-portfolio.ts), so there the flag costs one meta rewrite and nothing else."

- [ ] **Step 6: Fix the silent no-op.** In `use-turso-projects.ts` `handleUpdateCurrentProjectByMode`, change the turso branch so that no `tursoProjectId` means a single-DB backend:

```ts
      if (portfolioMode === "turso") {
        const cfg = getTursoConfig(tursoDatabaseUrl, tursoAuthToken);
        if (!tursoProjectId) {
          // §538 — no tenant id means the single-DB backend, whose save now
          // persists ws.project; the in-memory update is the whole write.
          updateCurrentFileProject(meta);
          return;
        }
        if (!cfg) {
          showToast("error", t(lang, "projectUpdateFailed", t(lang, "storageNotReady")));
          return;
        }
        void (async () => { /* unchanged tenant path */ })();
      } else {
```

Add or extend a test in the hook's test file for the `tursoProjectId` empty case: `updateCurrentFileProject` is called with `meta`.

- [ ] **Step 7: Verify.** Run the three test files, `npx tsc --noEmit` and `npx eslint --max-warnings=0 src`. All exit 0.

- [ ] **Step 8: Mutation check.** Delete the `pmRow` block. Expect the round-trip test RED. Restore it.

- [ ] **Step 9: Register + commit**: `fix: persist project meta on single-DB Turso (§538)`, using `--only` with the touched paths.

---

### Task 4: #243: a rejected deployment token is reported, and Settings can override it

**Files:**
- Modify: `src/app/turso-config.ts` (flag helpers + `getTursoConfig` precedence)
- Modify: `src/app/turso-pipeline.ts` (401 **and 403** → rejection; record/clear the flag)
- Modify: `src/app/storage-error.ts` (`StorageErrorKind` gains `"auth-env"`)
- Modify: `src/app/notifications.tsx` (`StorageBanner` message for `"auth-env"`)
- Modify: `src/app/settings-sections/integrations-section.tsx` (token field visibility)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (two keys)
- Modify: `docs/open-followups.md` (§337: record the URL half as shipped in `28b517b77`, then close)
- Test: `src/app/turso-config.test.ts`, `src/app/turso-pipeline.test.ts`, `src/app/storage-error.test.ts`, `src/app/settings-sections/integrations-section.test.tsx` (`ls` each)

**Interfaces:**
- Produces (in `turso-config.ts`): `ENV_TOKEN_REJECTED_KEY = "aipm-cockpit:turso-env-token-rejected"`, `isEnvTokenRejected(): boolean`, `markEnvTokenRejected(): void`, `clearEnvTokenRejected(): void`. All wrap `localStorage` in try/catch, and SSR returns false. The key sits under the `aipm-cockpit:` prefix, so `clearAppConfig` already wipes it. It is not a secret and is not workspace data.
- Produces (in `turso-pipeline.ts`): the rejection throws `new StorageNotReadyError("turso-token-rejected")` (a stable hint like `"storage-unreachable"`).
- Produces: `StorageErrorKind = "unreachable" | "auth" | "auth-env" | "generic"`.

- [ ] **Step 1: Failing tests, config precedence** (`turso-config.test.ts`; use `vi.stubEnv` as the file already does for the URL half):

```ts
describe("env token rejection (§337)", () => {
  beforeEach(() => { localStorage.clear(); vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "libsql://db-org.turso.io"); vi.stubEnv("NEXT_PUBLIC_TURSO_AUTH_TOKEN", "ENV"); });
  afterEach(() => { vi.unstubAllEnvs(); localStorage.clear(); });
  it("env token wins while not rejected", () => { expect(getTursoConfig(undefined, "SET")?.authToken).toBe("ENV"); });
  it("a non-empty Settings token wins once the env token was rejected", () => { markEnvTokenRejected(); expect(getTursoConfig(undefined, "SET")?.authToken).toBe("SET"); });
  it("the env token is still used after rejection when Settings has none", () => { markEnvTokenRejected(); expect(getTursoConfig(undefined, "")?.authToken).toBe("ENV"); });
  it("clearEnvTokenRejected restores env precedence", () => { markEnvTokenRejected(); clearEnvTokenRejected(); expect(getTursoConfig(undefined, "SET")?.authToken).toBe("ENV"); });
});
```

- [ ] **Step 2: Failing tests, pipeline** (`turso-pipeline.test.ts`, using its existing fetch mock):

```ts
it.each([401, 403])("a %i marks the env token rejected when the env token was used, and throws turso-token-rejected", async (status) => {
  vi.stubEnv("NEXT_PUBLIC_TURSO_AUTH_TOKEN", "ENV");
  mockFetchStatus(status); // the file's own helper
  await expect(runTursoPipeline({ httpUrl: "https://x", authToken: "ENV" }, [{ sql: "SELECT 1" }])).rejects.toMatchObject({ hint: "turso-token-rejected" });
  expect(isEnvTokenRejected()).toBe(true);
});
it("a rejection of a NON-env token does not set the flag", async () => { /* authToken "SET", env "ENV" → isEnvTokenRejected() false */ });
it("a success using the env token clears the flag", async () => { markEnvTokenRejected(); /* 200 with results, authToken "ENV" */ expect(isEnvTokenRejected()).toBe(false); });
```

Write the two commented cases out fully, following the first.

- [ ] **Step 3: Failing tests, classifier** (`storage-error.test.ts`):

```ts
it("classifies turso-token-rejected as auth-env when the env token is flagged, else auth", () => {
  markEnvTokenRejected();
  expect(tursoErrorKind(new StorageNotReadyError("turso-token-rejected"))).toBe("auth-env");
  clearEnvTokenRejected();
  expect(tursoErrorKind(new StorageNotReadyError("turso-token-rejected"))).toBe("auth");
});
```

Grep the test for the old `"Turso auth token rejected"` message and MIGRATE those assertions to the new hint.

- [ ] **Step 4: Run all three and confirm they fail** (under the lock).

- [ ] **Step 5: Implement `turso-config.ts`**

```ts
/** §337 — per-device record that Turso REJECTED the deployment (env) token.
 *  While set, a non-empty Settings token outranks the env token and the
 *  Settings field is shown. Cleared by the next success that used the env
 *  token, so a fixed deployment wins again. Lives under the app-config prefix,
 *  so clearAppConfig wipes it. Not a secret, not workspace data. */
export const ENV_TOKEN_REJECTED_KEY = "aipm-cockpit:turso-env-token-rejected";
export function isEnvTokenRejected(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(ENV_TOKEN_REJECTED_KEY) === "1"; } catch { return false; }
}
export function markEnvTokenRejected(): void {
  try { localStorage.setItem(ENV_TOKEN_REJECTED_KEY, "1"); } catch { /* storage unavailable: precedence stays env-first */ }
}
export function clearEnvTokenRejected(): void {
  try { localStorage.removeItem(ENV_TOKEN_REJECTED_KEY); } catch { /* same */ }
}
```

In `getTursoConfig`, replace the `authToken` line with:

```ts
  const envTokenSet = !!envToken && envToken !== "";
  const settingsTokenSet = !!settingsToken && settingsToken !== "";
  const preferSettings = settingsTokenSet && isEnvTokenRejected();
  const authToken = (envTokenSet && !preferSettings ? envToken : settingsTokenSet ? settingsToken : envToken) ?? "";
```

- [ ] **Step 6: Implement `turso-pipeline.ts`**

```ts
  if (res.status === 401 || res.status === 403) {
    if (config.authToken !== "" && config.authToken === process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN) markEnvTokenRejected();
    throw new StorageNotReadyError("turso-token-rejected");
  }
```

After the response has parsed successfully (just before the function returns results), add `if (config.authToken !== "" && config.authToken === process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN) clearEnvTokenRejected();`. Import both helpers from `./turso-config`. `turso-pipeline.ts` already imports `TursoConfig` as a type from there; grep for a cycle before adding a value import.

- [ ] **Step 7: Implement classifier + banner**

`storage-error.ts`:

```ts
export type StorageErrorKind = "unreachable" | "auth" | "auth-env" | "generic";
// …
    if (err.hint === "turso-token-rejected") return isEnvTokenRejected() ? "auth-env" : "auth";
```

Remove the `/auth token rejected/i` regex line; its only thrower changed. `grep -rn "auth token rejected" src` must return no hits outside the register afterwards.

`notifications.tsx` `StorageBanner`:

```ts
  const msg =
    kind === "auth" ? t(lang, "storageAuthBanner")
    : kind === "auth-env" ? t(lang, "storageAuthEnvBanner")
    : kind === "generic" ? t(lang, "storageSaveFailedBanner")
    : t(lang, "storageUnreachableBanner");
```

Grep for every other exhaustive switch or `Record<StorageErrorKind, …>` (`grep -rn "StorageErrorKind" src/app`) and extend each one.

- [ ] **Step 8: i18n.** EN (`i18n.ts`, next to `storageAuthBanner`):

```ts
  storageAuthEnvBanner: "The deployment's Turso token was rejected — check NEXT_PUBLIC_TURSO_AUTH_TOKEN, or enter a token in Settings.",
  integrationsTursoTokenEnvRejected: "The deployment token was rejected. A token entered here is used instead.",
```

DE (`i18n.de.ts`, via a node utf8 script matching `\r\n`):

```
  storageAuthEnvBanner: "Das Turso-Token der Bereitstellung wurde abgelehnt – prüfen Sie NEXT_PUBLIC_TURSO_AUTH_TOKEN oder geben Sie in den Einstellungen ein Token ein.",
  integrationsTursoTokenEnvRejected: "Das Token der Bereitstellung wurde abgelehnt. Ein hier eingegebenes Token wird stattdessen verwendet.",
```

- [ ] **Step 9: Settings field.** In `integrations-section.tsx`, next to `envTursoTokenSet`:

```ts
  // §337 — lazy initial read, not a render-body side effect; the flag only
  // changes on a pipeline response, and the section remounts on reopen.
  const [envTokenRejected] = useState(() => isEnvTokenRejected());
  const hideTokenField = envTursoTokenSet && !envTokenRejected;
```

Replace the three `envTursoTokenSet &&` / `!envTursoTokenSet &&` guards on the token read-only block, the token input block and the passphrase block with `hideTokenField &&` / `!hideTokenField &&`. Leave the `tursoIsLive && !(envTursoUrlUsable && envTursoTokenSet)` guard at about line 1098 unchanged, and read what it gates before deciding. When `envTokenRejected`, render `<FieldNotice>{t(lang, "integrationsTursoTokenEnvRejected")}</FieldNotice>` under the input. Update the stale comment block above `envTursoTokenSet` (lines ~250–259) to describe the new behaviour.

Add a test: env token stubbed plus flag set → the token `Input` is present (`getByLabelText` on the existing label) and the notice is shown. Flag unset → absent.

- [ ] **Step 10: Verify.** Run the four test files, `npx tsc --noEmit` and `npx eslint --max-warnings=0 src`.

- [ ] **Step 11: Mutation check.** Set `preferSettings = false`. Expect the "Settings token wins once rejected" test RED. Restore it.

- [ ] **Step 12: Register + commit.** Rewrite §337 to say the URL half shipped in `28b517b77` and the token half in this commit, then close it and update its index row. Commit message: `fix: report a rejected deployment Turso token and let Settings override it (§337)`.

---

### Task 5: #297: desktop PDF export → save-as dialog

**Files:**
- Create: `desktop/src/lib/pdf-export.ts`, `desktop/src/lib/pdf-export.test.ts`
- Create: `src/app/pdf-export-protocol.ts`, `src/app/pdf-export-protocol.test.ts`
- Modify: `src/app/export.ts` (`buildPdfHtml` script + `exportPdf` window name)
- Modify: `src/app/document-download.ts` (`AUTO_PRINT_SCRIPT` / `withAutoPrint` + the `window.open` in `downloadDocument`)
- Modify: `desktop/src/main.ts` (window-open handler + `did-create-window`)
- Modify: `desktop/src/lib/menu-model.ts` (the §468 deferral comment only)
- Modify: `docs/open-followups.md` (§468 → closed)

**Interfaces:**
- Produces (both sides, declared twice because `desktop/` cannot import `src/app/`, the `DESKTOP_VERSION_REQUEST_EVENT` precedent): `PDF_EXPORT_FRAME_NAME = "aipm-pdf-export"`, `PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:"`.
- Produces (renderer): `pdfReadyScript(filename: string): string`.
- Produces (desktop): `isPdfExportFrame(frameName: string): boolean`; `pdfFilenameFromTitle(title: string): string | null`.

- [ ] **Step 1: Desktop pure lib, test first** (`desktop/src/lib/pdf-export.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDF_EXPORT_FRAME_NAME, PDF_READY_TITLE_PREFIX, isPdfExportFrame, pdfFilenameFromTitle } from "./pdf-export";

describe("pdf-export protocol (§468)", () => {
  it("recognises only its own frame name", () => {
    expect(isPdfExportFrame("aipm-pdf-export")).toBe(true);
    expect(isPdfExportFrame("_blank")).toBe(false);
    expect(isPdfExportFrame("")).toBe(false);
  });
  it("reads the filename from a ready title and rejects anything else", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:Apollo.pdf")).toBe("Apollo.pdf");
    expect(pdfFilenameFromTitle("Apollo")).toBeNull();
    expect(pdfFilenameFromTitle("aipm-pdf-ready:")).toBeNull();
  });
  it("strips path separators and control characters from the suggested name", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:../../x/evil.pdf")).toBe("evil.pdf");
    expect(pdfFilenameFromTitle("aipm-pdf-ready:a\u0000b.pdf")).toBe("ab.pdf");
  });
  it("forces a .pdf extension", () => {
    expect(pdfFilenameFromTitle("aipm-pdf-ready:report.html")).toBe("report.html.pdf");
  });
  it("matches the renderer's copy of both constants", () => {
    const src = readFileSync(join(__dirname, "../../../src/app/pdf-export-protocol.ts"), "utf8");
    expect(src).toContain(`"${PDF_EXPORT_FRAME_NAME}"`);
    expect(src).toContain(`"${PDF_READY_TITLE_PREFIX}"`);
  });
});
```

Check how `menu-model.test.ts` resolves the path to `src/app/desktop-shell.ts` and copy that exact path expression. Do not guess the `__dirname` depth.

- [ ] **Step 2: Implement `desktop/src/lib/pdf-export.ts`**

```ts
// §468 — PDF export in the desktop shell. Electron refuses a renderer
// window.print(), and the shell has no preload, so the renderer and main
// talk through two plain values: the window NAME passed to window.open,
// and the document TITLE the page sets once it has rendered. Declared on
// both sides of the boundary (desktop/ cannot import src/app/); the test
// pins the two copies equal. Electron-free so the root typecheck covers it.
export const PDF_EXPORT_FRAME_NAME = "aipm-pdf-export";
export const PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:";

export function isPdfExportFrame(frameName: string): boolean {
  return frameName === PDF_EXPORT_FRAME_NAME;
}

/** The suggested save name from a ready title, or null when the title is not
 *  a ready signal. The page is app content, but the name still reaches a
 *  native save dialog, so path separators and control characters are
 *  removed and the extension is forced to .pdf. */
export function pdfFilenameFromTitle(title: string): string | null {
  if (!title.startsWith(PDF_READY_TITLE_PREFIX)) return null;
  const raw = title.slice(PDF_READY_TITLE_PREFIX.length);
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (clean === "") return null;
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}
```

Check whether `desktop/` tests run under the root vitest (`grep -n "desktop" vitest.config.ts`, read-only). If they do not, run them the way `menu-model.test.ts` is run (see `desktop/package.json` scripts, read-only).

- [ ] **Step 3: Renderer protocol, test first** (`src/app/pdf-export-protocol.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { PDF_EXPORT_FRAME_NAME, PDF_READY_TITLE_PREFIX, pdfReadyScript, pdfWindowName } from "./pdf-export-protocol";

describe("pdf export protocol, renderer side (§468)", () => {
  it("uses _blank in a browser and the named frame in the desktop shell", () => {
    expect(pdfWindowName("Mozilla/5.0 Chrome/140")).toBe("_blank");
    expect(pdfWindowName("Mozilla/5.0 Electron/44.0.0")).toBe(PDF_EXPORT_FRAME_NAME);
  });
  it("the ready script sets the title with a JSON-escaped filename and never calls print", () => {
    const s = pdfReadyScript('a"b</script>.pdf');
    expect(s).toContain(PDF_READY_TITLE_PREFIX);
    expect(s).not.toContain("window.print");
    expect(s).not.toContain("</script>.pdf");
  });
});
```

- [ ] **Step 4: Implement `src/app/pdf-export-protocol.ts`**

```ts
// §468 — renderer half of the desktop PDF protocol; the main-process half is
// desktop/src/lib/pdf-export.ts, whose test pins these two literals equal.
import { isDesktopShellUserAgent } from "./desktop-shell";

export const PDF_EXPORT_FRAME_NAME = "aipm-pdf-export";
export const PDF_READY_TITLE_PREFIX = "aipm-pdf-ready:";

/** window.open target: the named frame main renders to PDF, or _blank. */
export function pdfWindowName(userAgent: string): string {
  return isDesktopShellUserAgent(userAgent) ? PDF_EXPORT_FRAME_NAME : "_blank";
}

/** Injected in place of the auto-print script in the desktop shell: signals
 *  "rendered" by setting the title, one tick after load (the same wait the
 *  print script uses so layout has happened). The filename is JSON-encoded
 *  and "<" escaped so it cannot close the script element. */
export function pdfReadyScript(filename: string): string {
  const literal = JSON.stringify(PDF_READY_TITLE_PREFIX + filename).replace(/</g, "\\u003c");
  return `<script>
  window.addEventListener("load", function () {
    setTimeout(function () { document.title = ${literal}; }, 80);
  });
</script>`;
}
```

- [ ] **Step 5: Wire `export.ts`.** `buildPdfHtml` currently inlines the auto-print `<script>`. Add a parameter `closingScript: string` and move the existing script text into a module const `EXPORT_AUTO_PRINT_SCRIPT` (byte-identical to today's inline script, so the browser output does not change). In `exportPdf`:

```ts
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const name = pdfWindowName(ua);
  const script = name === "_blank" ? EXPORT_AUTO_PRINT_SCRIPT : pdfReadyScript(defaultFilename("pdf"));
  const html = buildPdfHtml(ws, cfg, lang, footer, script);
  const w = window.open("", name);
```

Grep every `buildPdfHtml(` caller and test (`grep -rn "buildPdfHtml" src`) and label each MIGRATE, passing `EXPORT_AUTO_PRINT_SCRIPT`. If the golden or export tests pin the PDF HTML bytes, they must stay green unchanged. That is the proof the browser path is untouched.

- [ ] **Step 6: Wire `document-download.ts`.** In `downloadDocument`'s pdf branch, `window.open("", pdfWindowName(ua))`, and where `withAutoPrint(html)` is applied, use it only when the name is `_blank`. Otherwise insert `pdfReadyScript(documentFilename(doc, "pdf", today))` before `</body>` with the same `BODY_CLOSE` logic. Refactor `withAutoPrint` into `withClosingScript(html, script)` only if that keeps `withAutoPrint`'s existing tests green unchanged. Otherwise add a sibling `withPdfReady`.

Add a test per file: stub `navigator.userAgent` to an Electron UA (`vi.spyOn(navigator, "userAgent", "get")`), stub `window.open` to return a fake window with `document.open/write/close` spies, and assert the name argument and that the written HTML contains `aipm-pdf-ready:` and not `window.print`. Add the browser twin: `_blank` and `window.print` present.

- [ ] **Step 7: Wire `main.ts`.** In the `setWindowOpenHandler` `allow-in-app` case:

```ts
          case "allow-in-app":
            return isPdfExportFrame(details.frameName)
              ? { action: "allow", overrideBrowserWindowOptions: { show: false } }
              : { action: "allow" };
```

Then, in the same `web-contents-created` listener, register (next to the existing `did-create-window` latch; read it first and reuse its try/catch discipline):

```ts
    contents.on("did-create-window", (child, details) => {
      if (!isPdfExportFrame(details.frameName)) return;
      let done = false;
      child.webContents.on("page-title-updated", (_e, title) => {
        const filename = pdfFilenameFromTitle(title);
        if (!filename || done) return;
        done = true;
        void (async () => {
          try {
            const data = await child.webContents.printToPDF({ printBackground: true });
            const parent = BrowserWindow.fromWebContents(contents) ?? undefined;
            const { canceled, filePath } = await dialog.showSaveDialog(parent!, {
              defaultPath: filename,
              filters: [{ name: "PDF", extensions: ["pdf"] }],
            });
            if (!canceled && filePath) writeFileSync(filePath, data);
          } catch (e: unknown) {
            log(`pdf export: ${String(e)}`);
          } finally {
            if (!child.isDestroyed()) child.close();
          }
        })();
      });
    });
```

Import `isPdfExportFrame`, `pdfFilenameFromTitle` from `./lib/pdf-export` and `writeFileSync` from `node:fs`. If `parent` is undefined, call the `showSaveDialog(options)` overload instead of passing `undefined!`. Check the `details.frameName` field name against `desktop/node_modules/electron/electron.d.ts` (`grep -n "frameName" …`) before relying on it, for both `HandlerDetails` and `DidCreateWindowDetails`.

- [ ] **Step 8: Update the §468 deferral comment** in `menu-model.ts` and the `desktop-shell.ts` header's "two renderer print paths remain inert" sentence, which becomes false.

- [ ] **Step 9: Verify.** Run the renderer and desktop pure tests plus the export and document-download tests, `npx tsc --noEmit` and `npx eslint --max-warnings=0 src`. `main.ts` is outside the root typecheck, so also typecheck the desktop project with its own tsconfig (`npx tsc --noEmit -p desktop`, read `desktop/tsconfig.json` first).

- [ ] **Step 10: Manual desktop check (owed, record the result).** Build the desktop package with its manual script and export a project PDF and a document PDF. Expected: a save dialog opens with the suggested name, and the saved file opens as a PDF. Cancel writes nothing. If the owner cannot run it in this session, record "OWED: manual desktop PDF check" in the PR body.

- [ ] **Step 11: Mutation check.** Make `isPdfExportFrame` always return false. Expect the frame test RED. Restore it.

- [ ] **Step 12: Register + commit**: `fix: save desktop PDF exports through a main-process save dialog (§468)`.

---

### Task 6: #308: "Sync to Outlook" opt-out

**Files:**
- Modify: `src/app/types.ts` (`calendarOptOut?: boolean` on `Task`, `RaidItem`, `ChangeItem`, `Absence`, `Milestone`)
- Modify: `src/app/calendar-reconcile.ts` (`HasEventLink` + both planners)
- Modify: `src/app/use-entity-calendar-pull.ts` (`prune`), `src/app/use-milestone-calendar-pull.ts` (line ~97)
- Modify: `src/app/csv-codecs-core.ts` (the five `*_CSV_COLUMNS` lists holding `outlookEventId`, plus each entity's field-to-string / build-from-object)
- Modify: `src/app/markdown-codecs-core.ts` (column lists + the two header-alias maps near lines 565/595)
- Modify: the five sanitizers (`sanitize-records.ts` / `sanitize-entities.ts`, at the lines that sanitize `outlookEventId` for these five types)
- Modify: `src/app/sample-workspace-small.json` (one milestone with `"calendarOptOut": true`), then regenerate `-big` / `-huge` and `__fixtures__/golden-*`
- Create: `src/app/calendar-opt-out-checkbox.tsx` (+ `.test.tsx`)
- Modify: `task-form-modal.tsx`, `raid-edit-modal.tsx`, `change-edit-modal.tsx`, `absence-edit-modal.tsx`, `milestone-edit-modal.tsx` and the panes that render them (to pass the sync-enabled flag)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `docs/open-followups.md` (§486 → closed)
- Test: `calendar-reconcile.test.ts`, the pull-hook tests, `entity-persistence-registry.test.ts`, each sanitizer test, each modal test

**Interfaces:**
- Produces: `HasEventLink { id: number; outlookEventId?: string; calendarOptOut?: boolean }`.
- Produces: `<CalendarOptOutCheckbox lang checked onChange itemTitle />`, where `checked` = "syncs" (i.e. `!calendarOptOut`).
- CSV encoding: `"true"` / `""`, the `budgetFollowsPlan` precedent in `turso-schema.ts`.

- [ ] **Step 1: Planner tests first** (`calendar-reconcile.test.ts`):

```ts
describe("calendarOptOut (§486)", () => {
  const ev = (id: string) => ({ id });
  it("planEntityReconcile never creates an opted-out unlinked item", () => {
    const p = planEntityReconcile([{ id: 1, calendarOptOut: true }, { id: 2 }], []);
    expect(p.create.map((i) => i.id)).toEqual([2]);
  });
  it("planEntityReconcile neither updates nor deletes an opted-out LINKED item's event", () => {
    const p = planEntityReconcile([{ id: 1, outlookEventId: "E1", calendarOptOut: true }], [ev("E1")]);
    expect(p.update).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("planCalendarReconcile applies the same rules to milestones", () => {
    const m = (x: Partial<Milestone>) => ({ id: 1, name: "M", date: "2026-01-01", ...x }) as Milestone;
    const p = planCalendarReconcile([m({ calendarOptOut: true }), m({ id: 2, outlookEventId: "E2", calendarOptOut: true })], [ev("E2")]);
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.delete).toEqual([]);
  });
  it("an item that opts back in is created again", () => {
    expect(planEntityReconcile([{ id: 1, calendarOptOut: false }], []).create).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and confirm it fails.** Then implement, in both planners, at the top of the loop body:

```ts
    // §486 — the user opted this item out (by pruning its event, or by
    // unticking "Sync to Outlook"). Never create or update it; a still-linked
    // event is KEPT (not deleted) — the app never deletes an event the user
    // chose to leave in Outlook.
    if (it.calendarOptOut) {        // `m.` in planCalendarReconcile
      if (it.outlookEventId) keptIds.add(it.outlookEventId);
      continue;
    }
```

Add `calendarOptOut?: boolean` to `HasEventLink` and, with a one-line doc comment, to the five types in `types.ts`.

- [ ] **Step 3: Prune tests + implementation.** In the tests of `use-entity-calendar-pull` and `use-milestone-calendar-pull` (find with `ls src/app/use-*calendar-pull*.test.ts*`), add: after a prune, the item has `outlookEventId` undefined AND `calendarOptOut === true`. Then change `use-entity-calendar-pull.ts:72` to `{ ...i, outlookEventId: undefined, calendarOptOut: true }` and the milestone twin at `:97` the same way. Leave the push hooks' 404 `staleIds` path unchanged: a 404 during a push is not a user prune, and its re-create is documented behaviour.

- [ ] **Step 4: Six write paths, tests first.** In `entity-persistence-registry.test.ts`, add one case per backend family that the file already drives (read its matrix first), with a fixture item per entity type carrying `calendarOptOut: true`. Assert it survives CSV, Markdown, Turso single, Turso tenant (the file's DDL/insert and the `node:sqlite` execute test in `turso-schema.execute.test.ts`), JSON (`workspaceToJson` → `jsonToWorkspace`) and IndexedDB (follow the existing IDB round trip, `grep -rln "fake-indexeddb" src/app/*.test.ts`). Count to six before moving on and list them in the task report.

- [ ] **Step 5: Implement the codecs.**
  - `csv-codecs-core.ts`: add `"calendarOptOut"` right after `"outlookEventId"` in the Task (~94), RAID (~131), Absence (~150), Milestone (~210) and Changes (~422) column lists. Do NOT add it to `EVENTS_CSV_COLUMNS` (~170; pulled meetings, not pushed). In each entity's field-to-string: `c === "calendarOptOut" ? (x.calendarOptOut ? "true" : "") : …`. In each build-from-object: `if (obj.calendarOptOut === "true") item.calendarOptOut = true;`, following the file's local idiom for that entity (some build an object literal, some assign; match each).
  - `markdown-codecs-core.ts`: add the column to each of the same five column lists, and `calendaroptout: "calendarOptOut"` to both header-alias maps.
  - Sanitizers, beside each `outlookEventId` line for these five types: `if (o.calendarOptOut === true) item.calendarOptOut = true;`. Only a literal `true` survives. Use the local variable name at each site. Add one sanitizer test per type: `true` kept, `"yes"` and `1` dropped.
  - Turso: DDL and inserts derive from `*_CSV_COLUMNS`, and `turso-migrate.ts` adds the column to existing databases. Confirm by reading how `turso-migrate.ts` computes missing columns, then run the execute test.

- [ ] **Step 6: Sample + fixtures.** Add `"calendarOptOut": true` to one milestone in `src/app/sample-workspace-small.json`. Regenerate: `npx vite-node scripts/generate-sample-workspace.ts`, then regenerate the golden fixtures with the command the golden test's header names (`grep -n "regenerate\|UPDATE" src/app/golden-workspace.test.ts`). Inspect the fixture diff and make sure it is ONLY the new column plus that one value. Grep `e2e/` for anything counting milestone fields (`grep -rn "outlookEventId" e2e`) and MIGRATE if needed.

- [ ] **Step 7: Checkbox component, test first** (`calendar-opt-out-checkbox.test.tsx`):

```tsx
it("is a labelled checkbox named with the item title, and reports the new sync state", async () => {
  const onChange = vi.fn();
  render(<CalendarOptOutCheckbox lang="en-US" checked itemTitle="Kickoff" onChange={onChange} />);
  const box = screen.getByRole("checkbox", { name: "Sync to Outlook – Kickoff" });
  expect(box).toBeChecked();
  await userEvent.click(box);
  expect(onChange).toHaveBeenCalledWith(false);
});
```

Implement:

```tsx
// §486 — per-item Outlook sync switch. `checked` means "syncs"; unticking sets
// the item's calendarOptOut, ticking clears it. The name carries the item title
// so two open modals or rows never share an accessible name.
import { useId } from "react";
import { Checkbox } from "./form-controls";
import { type Lang, t } from "./i18n";

export function CalendarOptOutCheckbox({ lang, checked, itemTitle, onChange }: {
  lang: Lang; checked: boolean; itemTitle: string; onChange: (syncs: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div className="text-xs">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={t(lang, "calendarOptOutLabel", itemTitle)}
          aria-describedby={hintId}
        />
        <span>{t(lang, "calendarOptOutCaption")}</span>
      </label>
      <p id={hintId} className="mt-1 text-muted-foreground">{t(lang, "calendarOptOutHint")}</p>
    </div>
  );
}
```

Check the `Checkbox` props in `form-controls.tsx` (it may take `onCheckedChange` rather than `onChange`) and adapt. The visible caption "Sync to Outlook" must be contained in the accessible name (WCAG 2.5.3), which "Sync to Outlook – ‹title›" satisfies.

i18n EN:

```ts
  calendarOptOutCaption: "Sync to Outlook",
  calendarOptOutLabel: "Sync to Outlook – {0}",
  calendarOptOutHint: "Unticked items are never created or updated in Outlook. An existing event is left as it is.",
```

DE (node utf8 write):

```
  calendarOptOutCaption: "Mit Outlook synchronisieren",
  calendarOptOutLabel: "Mit Outlook synchronisieren – {0}",
  calendarOptOutHint: "Nicht angehakte Einträge werden in Outlook weder angelegt noch aktualisiert. Ein bestehender Termin bleibt unverändert.",
```

- [ ] **Step 8: Mount in the five modals.** For each modal: add an optional prop `calendarSyncEnabled?: boolean`. When true, render `<CalendarOptOutCheckbox checked={!draft.calendarOptOut} itemTitle={draft.title /* or .name */} onChange={(syncs) => setDraft((d) => ({ ...d, calendarOptOut: syncs ? undefined : true }))} />` near the modal's other scheduling fields. The draft state name differs per modal, so read each one. Check that the modal's save path carries the whole draft, so the flag reaches the saved item. The task modal's `use-task-submit.ts` builds an explicit payload, so add the field there. In each pane that renders the modal, pass `calendarSyncEnabled={calendar?.enabled}` from its `EntityCalendarProps` bag (`grep -n "EntityCalendarProps\|calendar\?\.enabled" src/app/*.tsx`). Milestones get it from wherever `milestones-panel.tsx` reads its sync-enabled flag.

Add one test per modal: with `calendarSyncEnabled`, the checkbox renders; unticking and saving calls `onSave` with `calendarOptOut: true`. Without it, `queryByRole("checkbox", { name: /Sync to Outlook/ })` is null.

- [ ] **Step 9: Verify.** Run all touched tests, `npx tsc --noEmit`, `npx eslint --max-warnings=0 src`, `npm run size:check` and `npm run dup:check`. Then axe on the views hosting these modals, `npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Open Points|RAID|Changes|Milestones|Resources"`, all under the lock.

- [ ] **Step 10: Mutation checks** (one at a time, restore each): drop the planner `continue` → the create test RED; drop `keptIds.add` in the opt-out branch → the "neither updates nor deletes" test RED; drop `calendarOptOut: true` from prune → the prune test RED; drop the CSV build line → the CSV round trip RED.

- [ ] **Step 11: Register + commit**: `fix: let an item opt out of Outlook sync so a pruned event stays gone (§486)`.

---

### Task 7: Whole-branch verification and PR

- [ ] **Step 1:** Under the lock: `npm run test:shuffle > $SCRATCH/shuffle.log 2>&1; echo "EXIT=$?"`, then `npm run gate:local > $SCRATCH/gate.log 2>&1; echo "EXIT=$?"`. Both must print EXIT=0. Read the "Test Files N" line and confirm N rose by the new test files.
- [ ] **Step 2:** `npm run docs:claims:check`, `npm run followups:index:check`, `npm run docs:symbols:check` → exit 0 each.
- [ ] **Step 3:** Line endings: `git diff --name-only origin/main...HEAD -- src/app | xargs git ls-files --eol`. Every line must show `w/crlf` except files git lists as LF on `origin/main`.
- [ ] **Step 4:** Fresh cold review of the whole branch (a subagent, `superpowers:requesting-code-review`). Fix every CRITICAL or HIGH finding in its own commit.
- [ ] **Step 5:** Only on the owner's explicit say: `git push -u origin fix/defect-batch-6` and `gh pr create`. The PR body lists the six issues with `Closes #359`, `Closes #360`, `Closes #328`, `Closes #243`, `Closes #297`, `Closes #308`, the six spec corrections above, the test plan, and "OWED: manual desktop PDF check" if Task 5 Step 10 did not run. No session URL.
