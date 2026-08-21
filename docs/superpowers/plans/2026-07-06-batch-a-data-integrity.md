# Batch A — Data Integrity & Error Transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, this session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close silent data-loss + swallowed-failure paths: corrupt JSON throws instead of masquerading as empty; every actionable persistence/integration failure is surfaced (toast/banner) and inspectable (`logDiag`).

**Architecture:** Wire existing bail-outs into `guard-feedback.ts` (`reportSilentFailure`) / `diagnostics.ts` (`logDiag`). One codec contract change (#1, additive `strict` param), one banner generalization (#2), one guard tightening (#4). No new backends, no new persisted fields.

**Tech Stack:** TS/React, vitest, existing `logDiag`/`reportSilentFailure`, i18n EN+DE parity (tsc-enforced).

**Global verify per task:** `npx tsc --noEmit` + `npm run lint` + `npm run test:run` (FULL suite — moved literals break source-scan guards) before each commit.

---

### Task A1: Corrupt JSON throws (strict codec) + SharePoint validates *(#1, #10)*

**Files:**
- Modify: `src/app/workspace.ts` (add `WorkspaceParseError`, add `opts` param to `jsonToWorkspace`)
- Modify: `src/app/local-file-backend.ts:118`
- Modify: `src/app/sharepoint-backend.ts:108`
- Test: `src/app/workspace.test.ts`, `src/app/local-file-backend.test.ts` (create if absent)

- [ ] **Step 1: Failing tests** (`workspace.test.ts`)

```ts
import { jsonToWorkspace, workspaceToJson, emptyWorkspace, WorkspaceParseError } from "./workspace";

describe("jsonToWorkspace strict mode", () => {
  it("throws WorkspaceParseError on truncated JSON in strict mode", () => {
    expect(() => jsonToWorkspace('{"tasks":[', { strict: true })).toThrow(WorkspaceParseError);
  });
  it("throws on wrong shape (missing tasks/raid) in strict mode", () => {
    expect(() => jsonToWorkspace('{"foo":1}', { strict: true })).toThrow(WorkspaceParseError);
  });
  it("forgiving default still returns empty on garbage (back-compat)", () => {
    expect(jsonToWorkspace('{"tasks":[').tasks).toEqual([]);
    expect(jsonToWorkspace('{"foo":1}').tasks).toEqual([]);
  });
  it("valid workspace round-trips identically in strict mode", () => {
    const json = workspaceToJson({ ...emptyWorkspace(), tasks: [] });
    expect(jsonToWorkspace(json, { strict: true }).tasks).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/app/workspace.test.ts` → FAIL (`WorkspaceParseError` not exported).

- [ ] **Step 3: Implement** in `workspace.ts`. Add near the top-level exports (before `jsonToWorkspace`):

```ts
/** Thrown by `jsonToWorkspace(text, { strict: true })` when the input is
 *  present-but-corrupt (parse failure) or structurally not a workspace
 *  (non-object / missing tasks|raid). The strict load paths let this
 *  propagate so a corrupt file surfaces as a load error instead of silently
 *  becoming an empty workspace that the next autosave overwrites. */
export class WorkspaceParseError extends Error {
  constructor(public readonly reason: "parse" | "shape") {
    super(`workspace parse failed: ${reason}`);
    this.name = "WorkspaceParseError";
  }
}
```

Change the signature + the three early-return sites:

```ts
export function jsonToWorkspace(text: string, opts?: { strict?: boolean }): Workspace {
  const strict = opts?.strict === true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (strict) throw new WorkspaceParseError("parse");
    return emptyWorkspace();
  }
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      if (strict) throw new WorkspaceParseError("shape");
      return emptyWorkspace();
    }
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.tasks) || !Array.isArray(p.raid)) {
      if (strict) throw new WorkspaceParseError("shape");
      return emptyWorkspace();
    }
    const raw: Workspace = { /* …unchanged body… */ };
    /* …unchanged additive blocks… */
    return migrateWorkspaceV9(raw);
  } catch (err) {
    if (err instanceof WorkspaceParseError) throw err;
    if (strict) throw new WorkspaceParseError("shape");
    return emptyWorkspace();
  }
}
```

(Keep the existing `raw`/additive-block body verbatim; only the wrapper changes. The `err instanceof WorkspaceParseError` re-throw prevents the outer catch from swallowing a strict throw raised inside.)

- [ ] **Step 4:** `local-file-backend.ts:118` → `if (this.format === "json") return jsonToWorkspace(text, { strict: true });` (the `!text.trim()` empty guard at line 117 stays — strict only sees non-blank content).

- [ ] **Step 5:** `sharepoint-backend.ts:108` → replace `return (await res.json()) as Workspace;` with:
```ts
return jsonToWorkspace(await res.text(), { strict: true });
```
Add `jsonToWorkspace` to the `./workspace` import in that file; drop the now-unused raw-cast.

- [ ] **Step 6:** Run `npx vitest run src/app/workspace.test.ts` → PASS. Then full `test:run` + `tsc` + `lint`.

- [ ] **Step 7: Commit**
```bash
git add src/app/workspace.ts src/app/local-file-backend.ts src/app/sharepoint-backend.ts src/app/workspace.test.ts
git commit -m "fix(storage): corrupt JSON throws instead of loading as empty; SharePoint backend validates"
```

---

### Task A2: Non-Turso save failures → persistent banner + toast *(#2)*

**Files:**
- Modify: `src/app/storage-error.ts` (add `"generic"` kind)
- Modify: `src/app/task-manager.tsx` (`reportStorageOutcome` ~333, banner gate ~1960, first-failure toast)
- Modify: the storage banner component (kind-aware copy)
- i18n: `i18n.ts` + `i18n.de.ts` — `storageSaveFailedBanner`
- Test: `src/app/task-manager` storage-outcome behavior (or a focused unit on the classify+state logic)

- [ ] **Step 1:** Widen `StorageErrorKind`: `export type StorageErrorKind = "unreachable" | "auth" | "generic";`. Add a helper `classifyStorageError(err): StorageErrorKind` = `tursoErrorKind(err) ?? "generic"`.

- [ ] **Step 2:** `reportStorageOutcome(err)` (task-manager): on non-null err set `setStorageError({ kind: classifyStorageError(err) })`; on the null→error transition (track prior with a ref) fire ONE toast `reportSilentFailure(showToast, lang, "storage.autosaveFailed", err, "storageSaveFailed")`. `null` clears storageError + resets `storageErrorDismissed` (existing).

- [ ] **Step 3:** Banner gate line ~1960: change `storageError && settings.storageConfig.kind === "turso" && !storageErrorDismissed` → `storageError && !storageErrorDismissed`. Banner component maps `kind`: `unreachable`/`auth` keep current copy; `generic` → `t(lang,"storageSaveFailedBanner")`.

- [ ] **Step 4:** Remove the now-redundant `if (!tursoErrorKind(err)) showToast(...storageSaveFailed...)` double-toast at task-manager :445/:836 IF the reportStorageOutcome transition-toast now covers them (verify no double toast; keep manual-save immediate toast only if it fires on a path reportStorageOutcome doesn't).

- [ ] **Step 5:** i18n `storageSaveFailedBanner` EN: `"Your changes could not be saved to the current storage. Fix the issue and they will be retried."` DE (real umlauts, node utf8 write).

- [ ] **Step 6:** Test: `classifyStorageError(new Error("disk full"))==="generic"`; `classifyStorageError` of a Turso auth error === `"auth"`. Full verify. Commit:
```bash
git commit -am "fix(storage): surface non-Turso save failures via persistent banner + toast"
```

---

### Task A3: Turso switch/create/migrate flush-failure surfaced *(#3)*

**Files:** `src/app/use-storage-turso-ops.ts:58,81,121`; thread `showToast`+`lang` via `deps` if absent; i18n `storageSwitchFlushFailed`.

- [ ] **Step 1:** Confirm `deps` (the `useTursoProjectOps` deps object) carries `showToast` + `lang`; if not, add them (populated in task-manager where the hook is composed).

- [ ] **Step 2:** Replace each `catch { /* best-effort flush */ }` with:
```ts
catch (err) {
  logDiag("warn", "storage.switchFlushFailed", { message: err instanceof Error ? err.message : String(err) });
  deps.showToast("error", t(deps.lang, "storageSwitchFlushFailed"));
}
```
(import `logDiag` from `./diagnostics`, `t` from `./i18n`.) Switch/create/migrate still proceeds after.

- [ ] **Step 3:** i18n `storageSwitchFlushFailed` EN: `"Recent changes may not have been saved before switching projects."` DE via node utf8.

- [ ] **Step 4:** Test: mock `deps.backend.save` reject in one op → assert `logDiag` warn + `showToast` called AND the op still returns/switches. Verify + commit:
```bash
git commit -am "fix(storage): surface failed outgoing-project flush on Turso switch/create/migrate"
```

---

### Task A4: Settings-write failure surfaced *(#5)*

**Files:** `src/app/use-settings.ts` (`writeSettings` + persist effect ~432); i18n `settingsWriteFailed`; listener in `task-manager.tsx` if `useSettings` has no toast.

- [ ] **Step 1:** `writeSettings` returns `boolean`; catch does `logDiag("error","settings.writeFailed",{message})` + `return false`; success `return true`. (Import `logDiag`.) Keep it the SOLE `setItem` writer.

- [ ] **Step 2:** Persist effect: capture the boolean. On `false`, de-dupe via a `useRef(false)` (only act on the true→false edge) and dispatch `window.dispatchEvent(new CustomEvent("lop-settings-write-failed"))`. (Decoupled because `useSettings` lacks ToastProvider.)

- [ ] **Step 3:** `task-manager.tsx`: `useEffect` adds a `"lop-settings-write-failed"` window listener → `showToast("error", t(lang,"settingsWriteFailed"))`, cleanup on unmount. (De-dupe already done at source.)

- [ ] **Step 4:** i18n `settingsWriteFailed` EN: `"Your settings could not be saved and may reset when you reload."` DE via node utf8.

- [ ] **Step 5:** Test: stub `localStorage.setItem` to throw → `writeSettings()` returns false + `logDiag` error; success returns true. Verify + commit:
```bash
git commit -am "fix(settings): surface persistence failure (quota/private-mode) via toast + diagnostics"
```

---

### Task A5: Bulk-edit per-field Jira guard *(#4)*

**Files:** `src/app/use-bulk-operations.ts` (assignee guard ~138, apply loop ~150); i18n `jiraBulkManagedFieldsSkipped`.

- [ ] **Step 1:** Add `const JIRA_MANAGED_BULK_FIELDS = ["status","dueDate","priority","assignee"] as const;` (align with `issueToTaskFields`).

- [ ] **Step 2:** In `applyBulkEdit`, replace the assignee-only block: compute `skippedSynced` = count of selected `jiraKey` rows when the enabled-field set intersects `JIRA_MANAGED_BULK_FIELDS`. In the apply map, for a `jiraKey` row, apply only enabled fields NOT in `JIRA_MANAGED_BULK_FIELDS`; non-synced rows apply all enabled fields.

- [ ] **Step 3:** If `skippedSynced > 0` show the notice `window.alert(t(lang,"jiraBulkManagedFieldsSkipped", skippedSynced))` (or the existing toast surface). Keep functional setter `setTasks(prev => …)` (bulk N-in-one-tick landmine).

- [ ] **Step 4:** i18n `jiraBulkManagedFieldsSkipped` EN: `"{0} Jira-synced task(s): status, dates, priority and assignee are managed by Jira and were not changed."` DE via node utf8. (Keep or remove `jiraBulkAssigneeBlocked`; remove only if no other caller — grep.)

- [ ] **Step 5:** Test: bulk status+group over mixed synced/unsynced → synced get group only, unsynced get both; `skippedSynced` counts synced rows. Verify + commit:
```bash
git commit -am "fix(tasks): bulk-edit skips only Jira-managed fields on synced rows (was silently reverting)"
```

---

### Task A6: Sealed-secret decrypt failure ≠ not-configured *(#9)*

**Files:** `src/app/secrets-store.ts` (`readDeviceSecret` ~59, add `probeDeviceSecretReadable`); `src/app/use-settings.ts` (`hydrateSecretsInto` collects unreadable ids); surface in the settings load-effect; i18n `secretUnreadable`.

- [ ] **Step 1:** In `readDeviceSecret`, on the aesDecrypt catch when a sealed record EXISTED, `logDiag("warn","secrets.decryptFailed",{ id })` before `return null` (never log the value).

- [ ] **Step 2:** Add `export async function probeDeviceSecretReadable(id: SecretId): Promise<"ok"|"empty"|"unreadable">` — `empty` when no sealed device record, `ok` when decrypt succeeds, `unreadable` when a sealed record throws.

- [ ] **Step 3:** Wherever the settings mount-load hydrates secrets, probe each device secret id; collect `unreadable` ids and, per id, `reportSilentFailure`/info-toast `t(lang,"secretUnreadable", <label>)` once. (Reuse the existing load-effect that runs `hydrateSecretsInto`.)

- [ ] **Step 4:** i18n `secretUnreadable` EN: `"A saved credential ({0}) could not be read on this device and was cleared — please re-enter it."` DE via node utf8.

- [ ] **Step 5:** Test: seal a device secret, corrupt its ciphertext → `readDeviceSecret` returns null + `logDiag("warn","secrets.decryptFailed")` (fields carry only `id`); `probeDeviceSecretReadable` returns `"unreadable"`; never-sealed → `"empty"`. Verify + commit:
```bash
git commit -am "fix(secrets): distinguish unreadable device secret from not-configured (notify + logDiag)"
```

---

### Task A7: Outlook per-item push failures → logDiag *(#29)*

**Files:** `src/app/use-entity-calendar-push.ts:69,78,84`, `use-outlook-calendar-push.ts:40,49,55`, `use-committee-outlook-push.ts:56,62,67,73,78`.

- [ ] **Step 1:** Replace each `console.warn(...)` per-item failure with `logDiag("warn","calendar.pushItemFailed",{ entityType, id, message })` (entityType literal per hook; keep the aggregate `failed` counter + toast). No token/body in fields.

- [ ] **Step 2:** Test (one hook): mock one item push reject → `logDiag("warn","calendar.pushItemFailed",{entityType,id})` called; aggregate count unchanged. Verify + commit:
```bash
git commit -am "fix(calendar): route per-item Outlook push failures to diagnostics (logDiag)"
```

---

### Task A8: Version-restore resets UI only on success *(#30)*

**Files:** `src/app/use-version-history.ts` (`restore` ~163), `history-panel.tsx` (`restoreRecord`/`restoreWholeVersion` ~127).

- [ ] **Step 1:** `restore(...)` returns `Promise<boolean>` — `true` on applied, `false` when it hit `onError` (keep the `onError` toast).

- [ ] **Step 2:** `restoreRecord`/`restoreWholeVersion`: `const ok = await restore(...); if (ok) { setSelection({}); setDiff(null); setCompareFrom(null); setRestoreFrom(null); }` — leave state intact on false.

- [ ] **Step 3:** Test: mock apply to fail → `restore` resolves false, `onError` fired, selection/compare PRESERVED; success → true + cleared. Verify + commit:
```bash
git commit -am "fix(history): keep compare state when a version restore fails (was clearing regardless)"
```

---

### Task A9: Storage status-check exception logged *(#43)*

**Files:** `src/app/use-storage-backend.ts:175-184` (`refreshBackendStatus`).

- [ ] **Step 1:** Add to the catch: `logDiag("warn","storage.statusCheckFailed",{ message: err instanceof Error ? err.message : String(err) });` (bind the catch param). Behavior unchanged.

- [ ] **Step 2:** Test: stub `isReady` throw → still not-ready AND `logDiag` warn. Verify + commit:
```bash
git commit -am "chore(storage): logDiag on backend status-check exception (distinct from clean not-ready)"
```

---

### Task A10: Remove dead auto-sync `.catch`; log background failures *(#42)*

**Files:** `src/app/use-calendar-auto-sync.ts:26`; failure site inside `use-entity-calendar-push.ts` background mode.

- [ ] **Step 1:** Remove the dead `void push().catch((err)=>console.warn(...))` → `void push();`.

- [ ] **Step 2:** In `useEntityCalendarPush` background/non-interactive failure branch, `logDiag("warn","calendar.autoSyncFailed",{ entityType, message })` (no toast — user-silent per AGENTS.md, now inspectable).

- [ ] **Step 3:** Test: background push failure → `logDiag("warn","calendar.autoSyncFailed")`, NO toast; assert dead `.catch` gone. Verify + commit:
```bash
git commit -am "fix(calendar): log background auto-sync failures; drop dead unreachable .catch"
```

---

## Self-review

- **Spec coverage:** A1–A10 map 1:1 to spec A1–A10 (#1,#10,#2,#3,#5,#4,#9,#29,#30,#43,#42). #39 parked (documented). ✔
- **Types consistent:** `WorkspaceParseError(reason)`, `jsonToWorkspace(text, {strict})`, `StorageErrorKind` adds `"generic"`, `classifyStorageError`, `probeDeviceSecretReadable → "ok"|"empty"|"unreadable"`, `JIRA_MANAGED_BULK_FIELDS`, `restore → Promise<boolean>` — used consistently. ✔
- **New i18n (EN/DE):** `storageSaveFailedBanner`, `storageSwitchFlushFailed`, `settingsWriteFailed`, `jiraBulkManagedFieldsSkipped`, `secretUnreadable`. ✔
- **New logDiag codes:** `storage.autosaveFailed`, `storage.switchFlushFailed`, `settings.writeFailed`, `secrets.decryptFailed`, `calendar.pushItemFailed`, `storage.statusCheckFailed`, `calendar.autoSyncFailed`. ✔
- **Risk notes:** A2 verify no double-toast after removing :445/:836 fallback; A4 CustomEvent bridge because `useSettings` has no toast; A6 keep `readDeviceSecret` return shape (`string|null`) for existing callers.
