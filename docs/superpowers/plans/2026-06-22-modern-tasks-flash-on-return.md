# Modern Tasks Flash-on-Return (#12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make a modern-layout task deep-link flash (scroll + outline) the task's row/card AFTER the full-page editor closes and the list re-mounts.

**Architecture:** A flash-only `pendingFlash` channel on `WorkspaceTabContext` (no activeTab/hash side-effects). `useDeepLinkRowFlash` consumes it (parallel render-reconcile, self-clears). `task-manager` captures the deep-link task id when opening the modern full-page editor and calls `requestFlash` on editor return.

**Tech Stack:** Next.js 16 (forked) / React 19 / TS / vitest + RTL.

Full design: `docs/superpowers/specs/2026-06-22-modern-tasks-flash-on-return-design.md`.

---

### Task 1: `pendingFlash` channel + hook consumption (TDD)

**Files:**
- Modify: `src/app/workspace-tab-context.tsx`
- Modify: `src/app/use-deeplink-row-flash.ts`
- Test: `src/app/use-deeplink-row-flash.test.tsx`

- [ ] **Step 1: Failing tests first.** In `use-deeplink-row-flash.test.tsx` add cases (the probe already wraps `WorkspaceTabProvider` and exposes hook state; add a `requestFlash` button reading `requestFlash` from `useWorkspaceTab()`):
  - `requestFlash("changes", 5)` (NO `requestOpen`) → `flashId` becomes `"5"` and `scrollIntoView` called once `{block:"center",behavior:"auto"}`.
  - After the above, `pendingFlash` is cleared by the hook: assert it does not re-fire on a later unrelated re-render (e.g. spy on `clearPendingFlash` via the provider, or assert `flashId` returns to null after the timer and a forced re-render doesn't reset it to 5).
  - Wrong-view: probe `useDeepLinkRowFlash("raid")` + `requestFlash("changes",5)` → `flashId` stays null.
  - Sentinel: `requestFlash("changes", -1)` → `flashId` stays null.
  - `requestFlash` does NOT change `activeTab` and does NOT write `window.location.hash` (capture `window.location.hash` before/after; assert unchanged — contrast with `requestOpen` which sets the hash).
  Run `npm run test:run -- use-deeplink-row-flash` → FAIL (no `requestFlash` on context).

- [ ] **Step 2: Extend the context.** In `workspace-tab-context.tsx`:
  - Add to `WorkspaceTabContextValue`: `pendingFlash: { view: AppView; id: number } | null;` `requestFlash: (view: AppView, id: number) => void;` `clearPendingFlash: () => void;`
  - Add state: `const [pendingFlash, setPendingFlash] = useState<{ view: AppView; id: number } | null>(null);`
  - `const requestFlash = useCallback((view: AppView, id: number) => { setPendingFlash({ view, id }); }, []);` — NO `setActiveTab`, NO hash write.
  - `const clearPendingFlash = useCallback(() => { setPendingFlash(null); }, []);`
  - Add `pendingFlash, requestFlash, clearPendingFlash` to the provider `value={{...}}` object.

- [ ] **Step 3: Consume in the hook.** In `use-deeplink-row-flash.ts`:
  - Pull `clearPendingFlash` and `pendingFlash` from `useWorkspaceTab()` (alongside existing `pendingOpen`).
  - Add `const [handledFlash, setHandledFlash] = useState<{ view: AppView; id: number } | null | undefined>(undefined);`
  - After the existing `pendingOpen` reconcile block, add a parallel one:
    ```ts
    if (pendingFlash !== handledFlash) {
      setHandledFlash(pendingFlash);
      const flashTarget = targetIdFor(pendingFlash, view);
      if (flashTarget !== null) {
        setFlashId(flashTarget);
        setFlashSeq((s) => s + 1);
        clearPendingFlash();
      }
    }
    ```
  - Reuse the existing `targetIdFor` helper. The `[flashId, flashSeq]` side-effect is unchanged (scroll + auto-clear fires for either source).

- [ ] **Step 4: Green.** `npm run test:run -- use-deeplink-row-flash` → PASS. Then `npx tsc --noEmit` (clean) and `npm run lint` (0 warnings — watch for unused, and confirm exhaustive-deps is fine; the reconcile is render-time, not an effect).

- [ ] **Step 5: Commit.**
```bash
git add src/app/workspace-tab-context.tsx src/app/use-deeplink-row-flash.ts src/app/use-deeplink-row-flash.test.tsx
git commit -m "feat: add pendingFlash channel (flash a row without opening an editor)"
```

---

### Task 2: task-manager wiring — flash on editor return

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Pull `requestFlash`.** In the `useWorkspaceTab()` destructure (~line 193) add `requestFlash`.

- [ ] **Step 2: Origin ref.** Near the other refs, add `const flashOnEditReturnRef = useRef<number | null>(null);`

- [ ] **Step 3: Capture on open.** In the deep-link effect (~line 1231):
  ```ts
  useEffect(() => {
    if (pendingOpen?.view !== "open-points") return;
    const task = tasks.find((t) => t.id === pendingOpen.id);
    if (task) {
      if (useEditView) flashOnEditReturnRef.current = task.id;
      openEditModal(task);
    }
    clearPendingOpen();
  }, [pendingOpen, tasks, openEditModal, clearPendingOpen, useEditView]);
  ```
  (Add `useEditView` to deps.)

- [ ] **Step 4: Fire on return.** In the view-switch effect (~lines 299-307) close branch:
  ```ts
  } else if (!taskModalOpen && activeTab === "edit") {
    const back = editorReturnRef.current;
    setActiveTab(back);
    if (flashOnEditReturnRef.current !== null) {
      const flashTaskId = flashOnEditReturnRef.current;
      flashOnEditReturnRef.current = null;
      if (back === "open-points") requestFlash("open-points", flashTaskId);
    }
  }
  ```
  Add `requestFlash` to this effect's dep array. (Reset the ref whenever it is set, even if `back !== "open-points"`, to avoid a stale later fire.)

- [ ] **Step 5: Verify.** `npx tsc --noEmit`, `npm run lint`, `npm run test:run` (full suite green — the existing task-manager / use-storage-backend tests must still pass; the new deps shouldn't break them). If a focused open→close modern-layout test is tractable, add one asserting `requestFlash` is called with the task id on return; otherwise note manual verification in the commit body.

- [ ] **Step 6: Commit.**
```bash
git add src/app/task-manager.tsx
git commit -m "feat: flash the task row/card on modern full-page editor return (deep-link origin)"
```

---

### Task 3: Release 0.127.0 "Sawyer" + docs

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`

- [ ] **Step 1: version.ts** — `APP_VERSION="0.127.0"`, `APP_MILESTONE="Sawyer"` (Robert J. Sawyer), `APP_BUILD_DATE="2026-06-22"`, update the milestone doc comment. NO new `APP_HIGHLIGHT_KEYS` entry.

- [ ] **Step 2: CHANGELOG** — new top entry:
```
## [0.127.0] - 2026-06-22 "Sawyer"

### Changed
- In the default modern layout, a Dashboard/Action Center deep-link to a task now scrolls to and briefly highlights the task in the list/board when you close the full-page editor (previously the highlight was hidden behind the editor and never seen). Classic/popout and the other panels were already highlighting on deep-link.
```

- [ ] **Step 3: README badge** → `v0.127.0_%22Sawyer%22`. **package.json** → `"0.127.0"`.

- [ ] **Step 4: AGENTS.md** — in the deep-link-flash bullet, FLIP the MED-2 limitation: modern full-page task deep-links now flash on editor RETURN via a `pendingFlash` channel (`requestFlash`/`clearPendingFlash` on `WorkspaceTabContext` — flash-only, no `activeTab`/hash side-effects; the hook consumes + self-clears it; `task-manager` `flashOnEditReturnRef` set on modern-full-page task deep-links, fired in the view-switch close branch when returning to `open-points`). Keep the view-toggle-within-window best-effort note.

- [ ] **Step 5: Verify** — `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run build`. If `npm run build` leaves a CRLF-only diff on `src/app/operating-guide-builtin.generated.ts`, `git checkout --` it.

- [ ] **Step 6: Commit.**
```bash
git add src/app/version.ts CHANGELOG.md README.md package.json AGENTS.md
git commit -m "release: 0.127.0 \"Sawyer\" — modern tasks flash on editor return"
```

---

## Self-review

- Spec coverage: context channel + hook (Task 1), task-manager wiring (Task 2), release+docs (Task 3). ✓
- Type consistency: `pendingFlash: {view,id}|null`, `requestFlash(view,id)`, `handledFlash` seeded `undefined`, `flashOnEditReturnRef: useRef<number|null>`. ✓
- No placeholders; every step has concrete code. ✓
