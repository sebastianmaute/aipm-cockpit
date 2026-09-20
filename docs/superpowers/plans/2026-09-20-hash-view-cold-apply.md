# Hash-view cold apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hash-view cold apply run once, after settings hydration, against the user's real
settings, and stop the passive URL write from clobbering a deep link before the routing commits.

**Architecture:** Two independent changes. (1) `task-manager.tsx` folds `hydrated` into the `enabled`
argument it already computes, so the hook is inert until settings are real — this alone fixes §536 and
§595 without touching the hook's cold logic. (2) `use-hash-view.ts` gains a one-shot `pendingApplyRef`,
in the same idiom as the existing `reentryRepairRef`, so the passive view→hash effect skips exactly one
run while an apply's `setActiveTab` is still in flight — this fixes §535. A third, unrelated change
guards a repeated resource deep link in `use-resource-directory.ts` (§540).

**Tech Stack:** TypeScript, React 19, vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-hash-view-cold-apply-design.md`

## Design change since the spec — read this first

The spec prescribes snapshotting the incoming hash at mount, and describes the hydration gate as a new
third parameter. Reading `use-hash-view.ts` in full showed both are wrong, and the plan supersedes the
spec on these two points:

- **No snapshot.** The spec argued the snapshot was load-bearing because a deferred cold apply would read
  a hash the passive effect had already overwritten. That cannot happen once the gate is applied: the
  `enabled` early-return at `use-hash-view.ts:86` guards the apply effect and the identical check at
  `:173` guards the passive effect, so while ungated **neither effect writes anything**. The live hash is
  therefore still pristine when the cold apply finally runs. A snapshot would be strictly worse: a user
  who edits the URL fragment during the load window would have that edit ignored, where a live read
  honours it.
- **No new parameter.** Pass `hydrated && settings.layout === "modern"` as the existing `enabled`
  argument. The hook's disabled branch already clears `windowActiveRef` without touching
  `pageColdDoneRef`, so pre-hydration reads as "disabled" and the first post-hydration run is the page's
  first *executed* run — which the existing code already treats as cold, against the now-real `features`.

**This retires a deletion the spec ordered.** The spec marked
`is cold on the first enabled window even when the page loaded disabled and the cold target is not the
default tab` for DELETE as pinning an impossible scenario. Under the gate that scenario becomes the
**real and only** startup sequence for every user. The test is kept and its justification rewritten.
Do not delete it.

## Global Constraints

- `src/app/*.ts` and `src/app/*.tsx` are **CRLF**. `e2e/*.ts`, `docs/**`, `CONTRIBUTING.md` and
  `docs/open-followups.md` are **LF**. Check `git ls-files --eol <file>` before and after every edit.
  Use Edit, never Write, over an existing file.
- Never `git add -A` or `git add .`. Commit with `git commit --only <paths> -F <msgfile>`, msgfile in the
  scratchpad. Never `--amend`, never a bare `git stash`, never `npm ci`.
- Commit messages cite **§N only** — no `#NN` anywhere in a commit message, and no `Closes`. Every commit
  message ends with `Claude-Session: https://[session link removed]`.
- Never read a gate's exit code through a pipe. Run `cmd > <log> 2>&1; echo EXIT=$?`, then read the log.
- vitest: `--maxWorkers=1 --reporter=dot`. **Never two vitest processes at once** — another session
  shares this machine. Announce "starting vitest" / "vitest done" to the controller, which relays.
- No full suite. Run only the files a task touches. CI runs the rest.
- A mutant is a temporary source edit, reverted byte-for-byte, then proved with
  `git diff --stat -- <file>` empty. `git checkout --` and `git restore` are deny-blocked.
- Do not dispatch subagents. Do not push. No GitLab commands.
- `react-hooks/set-state-in-effect` is fatal, and `eslint --max-warnings=0` makes every warning fatal.
  No task here needs a local `setState` inside an effect; if you reach for one, stop and report.
- Run `npx tsc --noEmit` after editing **any** test file — vitest never typechecks.

## Review Focus

Five conditions the spec implies that no task below would otherwise exercise. Each has its test assigned
to the task that owns the code.

1. **An MSAL auth-response fragment arriving before hydration.** The hook is now inert during the window
   in which MSAL's `handleRedirectPromise` reads the fragment. Expected: the fragment is untouched
   before hydration and still untouched after, because both effects bail on `isAuthResponseHash`. Pinned
   in Task 2.
2. **The `#safe` escape hatch.** `safe-mode.ts:18` reads `window.location.hash` at module load to detect
   `#safe`. The cold apply now runs later than before, so it must not rewrite the fragment in a way that
   breaks a subsequent reload's detection. Pinned in Task 2.
3. **A `hashchange` fired before hydration** — a user editing the URL while the app loads. Expected: the
   cold apply honours the edited hash, because it reads live. Pinned in Task 2.
4. **A popout window.** `isPopout` and `hydrated` are independent; a popout must stay inert regardless of
   hydration, and must never be given a cold apply. Pinned in Task 2.
5. **A repeated resource deep link while an ADD draft is open.** The §540 guard must skip only a repeat
   of the *same saved resource*; an open `isNew: true` draft must not swallow a deep link to a different
   resource. Pinned in Task 3.

---

## File Structure

- `src/app/use-hash-view.ts` — add `pendingApplyRef`, set it where an apply routes, consume it in the
  passive effect. No other behaviour changes. (Task 1)
- `src/app/use-hash-view.test.tsx` — new §535 tests, new hydration-gate tests, rewritten justification on
  the kept "loaded disabled" test. (Tasks 1, 2)
- `src/app/task-manager.tsx` — one-line change to the `useHashView` call. (Task 2)
- `src/app/use-resource-directory.ts` — functional-setState guard in `handleEditResource`. (Task 3)
- `src/app/resource-directory.test.tsx` — invert the KNOWN RESIDUAL test. (Task 3)
- `src/app/resource-edit-modal.tsx` — correct the stale header comment. (Task 3)
- `e2e/hash-deep-link.spec.ts` — new Playwright spec, three cases. (Task 4)
- `docs/open-followups.md`, `docs/superpowers/specs/...`, `AGENTS.md` — register closures and prose sweep.
  (Task 5)

---

### Task 1: Stop the passive write clobbering an in-flight apply (§535)

**Files:**
- Modify: `src/app/use-hash-view.ts`
- Test: `src/app/use-hash-view.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `pendingApplyRef` semantics relied on by Task 2's tests — a `useRef<boolean>` set to `true` by
  `apply()` on any path that calls `setActiveTab`, and consumed (read-then-cleared) by the passive
  view→hash effect, which returns without writing on the one run where it was set.

**Background the implementer needs.** The apply effect is a `useLayoutEffect` (`:85`) and the view→hash
effect is a passive `useEffect` (`:172`). On the first commit the layout effect runs first, so the cold
apply does see the original `#raid/123` and calls `setActiveTab("raid")`. React has not committed that
state yet, so the passive effect runs in the same commit with `activeTab` still `"dashboard"`, finds
`parseHash(hash).view !== activeTab` at `:186`, and rewrites the URL to `#dashboard` — destroying the
deep link. The tab change then commits, the passive effect runs again, and writes the bare `#raid`, so
the item id is gone. Under StrictMode the remount's warm apply reads the already-clobbered `#dashboard`
and lands the user on the Dashboard.

The fix is the same idiom the file already uses for `reentryRepairRef`: a one-shot flag the layout effect
sets and the passive effect consumes. One-shot, not "suppress until `activeTab` matches" — if the user
clicks a nav item in the same tick, a match-based suppression would never release.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/use-hash-view.test.tsx`. Follow the file's existing harness for mounting the hook and for
capturing `replaceState` calls; read a neighbouring test first and reuse its setup rather than inventing
one.

```tsx
it("keeps the item id in the URL when a cold deep link routes to another view", () => {
  window.location.hash = "#raid/123";
  const calls = captureReplaceState();

  renderHashView({ enabled: true });

  expect(setActiveTab).toHaveBeenCalledWith("raid");
  expect(requestOpen).toHaveBeenCalledWith("raid", 123);
  // The bug wrote "#dashboard" here, then "#raid", losing /123.
  expect(calls.map((c) => c.url)).not.toContain("#dashboard");
  expect(window.location.hash).toBe("#raid/123");
});

it("does not treat StrictMode's double invoke as a reason to drop a cold deep link", () => {
  window.location.hash = "#raid/123";

  renderHashView({ enabled: true, strict: true });

  expect(setActiveTab).toHaveBeenLastCalledWith("raid");
  expect(window.location.hash).toBe("#raid/123");
});

it("still rewrites the hash on a normal view change after the cold apply", () => {
  window.location.hash = "#raid/123";
  const { setTab } = renderHashView({ enabled: true });

  setTab("budget");

  expect(window.location.hash).toBe("#budget");
});
```

The StrictMode test **must** mount via `wrapper: StrictMode` or RTL's `reactStrictMode: true`. A composed
wrapper (`({children}) => <StrictMode>{children}</StrictMode>`) makes the test vacuous-but-green — see
AGENTS.md, and `src/app/strictmode.meta.test.tsx` for the rule in full.

The third test is the anti-vacuity guard: without it, a fix that suppressed the passive write forever
would pass the first two.

- [ ] **Step 2: Run the tests to verify they fail**

Announce "starting vitest" first.

```
npx vitest run src/app/use-hash-view.test.tsx --maxWorkers=1 --reporter=dot > <scratchpad>/t1-red.log 2>&1; echo EXIT=$?
```

Expected: EXIT=1, with the first two tests failing on the clobbered hash. The third should already pass.
Announce "vitest done".

- [ ] **Step 3: Add the ref**

In `src/app/use-hash-view.ts`, beside the existing refs (after `reentryRepairRef` at `:82`):

```ts
  // ★★ Set by an apply that ROUTES; consumed by the view→hash effect below.
  //    setActiveTab does not commit until the next render, so the passive effect
  //    runs once with the OLD activeTab — it would then see the deep link's view
  //    as a mismatch and rewrite the URL to the old view, destroying `/123`
  //    (§535). One-shot, NOT "suppress until activeTab matches": a user click in
  //    the same tick would make a match-based suppression permanent.
  const pendingApplyRef = useRef(false);
```

- [ ] **Step 4: Set it where the apply routes**

In `apply`, at the two lines that currently read (`:124-125`):

```ts
    setActiveTab(view);
    if (itemId != null) requestOpen(view, itemId);
```

change to:

```ts
    pendingApplyRef.current = true;
    setActiveTab(view);
    if (itemId != null) requestOpen(view, itemId);
```

It must go **after** the `isAuthResponseHash` bail at `:105` and after the disabled-target bail at `:123`
— both of those return without routing, and must not arm the flag.

Also clear it in the disabled branch, beside the two refs already cleared at `:97-98`:

```ts
      windowActiveRef.current = false;
      reentryRepairRef.current = false;
      pendingApplyRef.current = false;
```

- [ ] **Step 5: Consume it in the passive effect**

In the view→hash effect, immediately after the existing re-entry consumption at `:174-175`:

```ts
    const reentry = reentryRepairRef.current;
    reentryRepairRef.current = false;
```

add:

```ts
    const pending = pendingApplyRef.current;
    pendingApplyRef.current = false;
```

and then, after the MSAL guard at `:176` and **before** the re-entry branch at `:180`:

```ts
    // An apply routed in this commit; activeTab has not caught up. Writing now
    // would rewrite the URL to the view we are leaving (§535). The apply's own
    // requestOpen has already written `#<view>/<id>` for an item-bearing hash,
    // and the next run — with activeTab committed — finds the hash correct and
    // writes nothing.
    if (pending) return;
```

Order matters: the MSAL guard must still win, so `pending` is consumed above it but acted on below it.

- [ ] **Step 6: Run the tests to verify they pass**

Announce "starting vitest".

```
npx vitest run src/app/use-hash-view.test.tsx --maxWorkers=1 --reporter=dot > <scratchpad>/t1-green.log 2>&1; echo EXIT=$?
```

Expected: EXIT=0, and the §478 tests (both re-entry tests, back/forward, the StrictMode re-entry test,
`requestOpen during classic`, MSAL, disabled, popout) all still green **unchanged**. If any of them went
red, the fix is wrong — do not edit those tests. Announce "vitest done".

- [ ] **Step 7: Mutation-prove the new guard**

One mutant at a time, each reverted byte-for-byte before the next, each ending with
`git diff --stat -- src/app/use-hash-view.ts` empty.

| Mutant | Expected red test |
|---|---|
| Delete the `if (pending) return;` line | "keeps the item id in the URL…" |
| Never set `pendingApplyRef.current = true` in `apply` | "keeps the item id in the URL…" |
| Change the consume to `const pending = pendingApplyRef.current;` without clearing it | "still rewrites the hash on a normal view change after the cold apply" |
| Arm the flag before the `isAuthResponseHash` bail instead of after | the existing MSAL test |

Record each mutant, the test that caught it, and the revert proof in the task report. A mutant that
survives is a question, not a pass — find the missing input or say why it is equivalent.

- [ ] **Step 8: Gates**

```
npx tsc --noEmit > <scratchpad>/t1-tsc.log 2>&1; echo EXIT=$?
npx eslint --max-warnings=0 src/app/use-hash-view.ts src/app/use-hash-view.test.tsx > <scratchpad>/t1-lint.log 2>&1; echo EXIT=$?
```

tsc must report **0 errors in total**, not "0 in src" — a syntax error under `.next` disables all
semantic checks. Confirm EOL is unchanged: `git ls-files --eol src/app/use-hash-view.ts` must still read
`i/lf w/crlf`.

- [ ] **Step 9: Commit**

```bash
git commit --only src/app/use-hash-view.ts src/app/use-hash-view.test.tsx -F <scratchpad>/t1-msg.txt
```

Message subject: `fix(shell): keep a cold deep link's item id when the apply routes (§535)`.

---

### Task 2: Gate the hook on settings hydration (§536, §595)

**Files:**
- Modify: `src/app/task-manager.tsx:247`
- Modify: `src/app/use-hash-view.ts` (doc comment only)
- Test: `src/app/use-hash-view.test.tsx`

**Interfaces:**
- Consumes: Task 1's `pendingApplyRef` behaviour (the §535 tests must stay green).
- Produces: the call-site contract `useHashView(hydrated && settings.layout === "modern",
  settings.features)`. No signature change — the hook still takes
  `(enabled?: boolean, features?: readonly FeatureModuleId[])`.

**Background the implementer needs.** `use-settings.ts:171` seeds state with a plain
`useState<Settings>(defaultSettings)` — no lazy initializer — and the persisted settings arrive in an
async effect. `settings-types.ts:731` sets `defaultSettings.layout` to `"modern"`. So today
`task-manager.tsx:247`'s `useHashView(settings.layout === "modern", settings.features)` is `enabled ===
true` on the first executed run **for every user**, and the cold apply fires against default settings: a
classic user is routed before the layout flips to classic (§536), and the cold rule judges the hash
against `defaultSettings.features`, never revisiting it, so a user who disabled the dashboard module is
still landed on it (§595).

`useSettings` already returns `hydrated` and `task-manager.tsx:202` already destructures it. It flips only
after the secret merge resolves (`use-settings.ts:425-427`) and always flips, including the
no-persisted-settings path (`:453`).

- [ ] **Step 1: Write the failing tests**

```tsx
it("applies nothing until settings have hydrated", () => {
  window.location.hash = "#raid/123";
  const calls = captureReplaceState();

  const { rerender } = renderHashView({ enabled: false }); // pre-hydration

  expect(setActiveTab).not.toHaveBeenCalled();
  expect(requestOpen).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
  expect(window.location.hash).toBe("#raid/123");

  rerender({ enabled: true }); // hydration resolves: modern

  // The positive observable: exactly ONE cold apply, not zero.
  expect(setActiveTab).toHaveBeenCalledTimes(1);
  expect(requestOpen).toHaveBeenCalledWith("raid", 123);
});

it("never applies for a user whose stored layout is classic", () => {
  window.location.hash = "#raid";
  const calls = captureReplaceState();

  const { rerender } = renderHashView({ enabled: false });
  rerender({ enabled: false }); // hydration resolves: classic → still disabled

  expect(setActiveTab).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

it("judges the cold rule against the hydrated features, not the defaults", () => {
  window.location.hash = "";
  const withoutDashboard = FEATURES_WITHOUT_DASHBOARD;

  const { rerender } = renderHashView({ enabled: false, features: DEFAULT_FEATURES });
  rerender({ enabled: true, features: withoutDashboard });

  expect(setActiveTab).toHaveBeenCalledTimes(1);
  expect(setActiveTab).toHaveBeenCalledWith("open-points");
});

it("honours a hash the user edited before hydration", () => {
  window.location.hash = "#raid/123";
  const { rerender } = renderHashView({ enabled: false });

  window.location.hash = "#budget/7"; // user edits the URL during load
  rerender({ enabled: true });

  expect(setActiveTab).toHaveBeenCalledWith("budget");
  expect(requestOpen).toHaveBeenCalledWith("budget", 7);
});

it("leaves an MSAL auth-response fragment untouched across hydration", () => {
  window.location.hash = "#code=abc&state=xyz";
  const calls = captureReplaceState();

  const { rerender } = renderHashView({ enabled: false });
  rerender({ enabled: true });

  expect(setActiveTab).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
  expect(window.location.hash).toBe("#code=abc&state=xyz");
});

it("stays inert in a popout regardless of hydration", () => {
  window.location.hash = "#raid/123";
  const calls = captureReplaceState();

  const { rerender } = renderHashView({ enabled: false, isPopout: true });
  rerender({ enabled: true, isPopout: true });

  expect(setActiveTab).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

it("does not rewrite a #safe fragment before safe mode can read it", () => {
  window.location.hash = "#safe";
  const calls = captureReplaceState();

  const { rerender } = renderHashView({ enabled: false });
  expect(calls).toHaveLength(0); // nothing written during the load window

  rerender({ enabled: true });
  // After hydration the hook may normalise it, but safe-mode.ts read it at
  // module load, before any effect ran. Assert only that the load window is clean.
  expect(window.location.hash).not.toBe("");
});
```

`FEATURES_WITHOUT_DASHBOARD` and `DEFAULT_FEATURES`: build these from `feature-modules.ts` the way the
existing `lands on open-points on a cold load when the dashboard module is disabled` test in this file
already does. Read that test and reuse its fixture rather than inventing a second spelling.

- [ ] **Step 2: Run the tests to verify they fail**

Announce "starting vitest".

```
npx vitest run src/app/use-hash-view.test.tsx --maxWorkers=1 --reporter=dot > <scratchpad>/t2-red.log 2>&1; echo EXIT=$?
```

Expected: EXIT=1. Several of these will already pass — the hook's disabled branch is real, so the
pre-hydration half is mostly already true. The one that must fail is
`judges the cold rule against the hydrated features, not the defaults` **at the call site**, which these
hook-level tests cannot see. That is the point of Step 4. Announce "vitest done".

- [ ] **Step 3: Change the call site**

`src/app/task-manager.tsx:247`, currently:

```tsx
  useHashView(settings.layout === "modern", settings.features);
```

becomes:

```tsx
  // ★★ `hydrated` is load-bearing, not defensive. use-settings.ts seeds
  //    `defaultSettings` synchronously (layout "modern"), so without this gate
  //    the hook is enabled on render 1 for EVERY user: a classic user is routed
  //    before the layout flips (§536), and the cold rule judges the hash against
  //    defaultSettings.features and never revisits it (§595).
  useHashView(hydrated && settings.layout === "modern", settings.features);
```

`hydrated` is already in scope from `task-manager.tsx:202`.

- [ ] **Step 4: Add the call-site test**

The hook tests cannot see the call site. Add one to `src/app/task-manager.characterization.test.tsx` — or
whichever task-manager test file already mounts the component with a controllable `useSettings` mock;
find it with `grep -rln "useSettings" src/app/*.test.tsx` and read it before choosing.

```tsx
it("does not route from the hash until settings have hydrated", async () => {
  window.location.hash = "#raid/123";
  mockUseSettings({ hydrated: false, settings: { ...defaultSettings, layout: "classic" } });

  renderTaskManager();

  // Pre-hydration the stored layout is not yet known; nothing may be routed.
  expect(window.location.hash).toBe("#raid/123");
});
```

- [ ] **Step 5: Rewrite the justification on the kept test**

`is cold on the first enabled window even when the page loaded disabled and the cold target is not the
default tab` was introduced by `9f9bdfa71` as a defensive case with no traced real scenario, and
`356a483aa` called the `enabled: false` initial-props shape "a defensive addition". Under this task's
gate it becomes the **real and only** startup sequence. Do not change the test body; replace its comment
with why it now matters:

```tsx
  // ★★ This is no longer a defensive case. Since §536, task-manager.tsx passes
  //    `hydrated && layout === "modern"`, so EVERY page load starts this hook
  //    disabled and enables it once settings resolve. This test pins the whole
  //    app's startup path, not an edge case.
```

- [ ] **Step 6: Run the tests to verify they pass**

Announce "starting vitest".

```
npx vitest run src/app/use-hash-view.test.tsx <the task-manager test file> --maxWorkers=1 --reporter=dot > <scratchpad>/t2-green.log 2>&1; echo EXIT=$?
```

Expected: EXIT=0, Task 1's §535 tests still green, the §478 set still green unchanged. Announce
"vitest done".

- [ ] **Step 7: Mutation-prove the gate**

| Mutant | Expected red test |
|---|---|
| Revert the call site to `settings.layout === "modern"` | the task-manager call-site test |
| Pass `hydrated \|\| settings.layout === "modern"` | the task-manager call-site test |
| In the hook, take the cold branch when `!windowActiveRef.current` regardless of `pageColdDoneRef` | a §478 re-entry test |

Each reverted byte-for-byte, each ending with `git diff --stat` empty for the touched file.

- [ ] **Step 8: Update the hook's doc comment**

`use-hash-view.ts:41-46` currently says `enabled` gates the sync and "pass false in Classic mode". Extend
it — this is the contract, and the next reader will otherwise re-derive §536 from scratch:

```
 * `enabled` gates the whole sync. The call site passes
 * `hydrated && layout === "modern"`: FALSE in Classic mode, and ALSO false
 * before settings hydrate. That second half is load-bearing — use-settings.ts
 * seeds defaultSettings (layout "modern") synchronously, so without it the cold
 * apply would fire on render 1 for every user, against default `features`
 * (§536, §595). Turning it back on is a LAYOUT RE-ENTRY, not a navigation: …
```

- [ ] **Step 9: Gates and commit**

```
npx tsc --noEmit > <scratchpad>/t2-tsc.log 2>&1; echo EXIT=$?
npx eslint --max-warnings=0 src/app/task-manager.tsx src/app/use-hash-view.ts src/app/use-hash-view.test.tsx > <scratchpad>/t2-lint.log 2>&1; echo EXIT=$?
```

```bash
git commit --only src/app/task-manager.tsx src/app/use-hash-view.ts src/app/use-hash-view.test.tsx <the task-manager test file> -F <scratchpad>/t2-msg.txt
```

Message subject: `fix(shell): run the cold hash apply only after settings hydrate (§536, §595)`.

---

### Task 3: Guard a repeated resource deep link (§540)

**Files:**
- Modify: `src/app/use-resource-directory.ts:166-168`
- Modify: `src/app/resource-edit-modal.tsx` (header comment only)
- Test: `src/app/resource-directory.test.tsx:634`

**Interfaces:**
- Consumes: nothing from Tasks 1-2. This task is independent and may be reviewed on its own.
- Produces: no new exports. `handleEditResource` keeps its signature `(resource: Resource) => void` and
  its empty dependency array.

**Background the implementer needs.** `ResourceDirectory` is conditionally mounted
(`workspace-section.tsx:525`, `{activeTab === "directory" && (…)}`), so it remounts on the tab switch the
deep-link request itself causes — no per-mount ref inside it can recognise a repeat. `pendingOpen` is a
request object (`workspace-tab-context.tsx:20`) set by `requestOpen` and cleared by the directory effect
that consumes it. The editor state lives above both, at `use-resource-directory.ts:144`. **§540's entry
names `task-manager.tsx` as the guard site; that is wrong** — task-manager only threads the value
through. Task 5 corrects the entry.

`resource-edit-modal.tsx:65-74` resets its draft by **reference** equality in a render-time reconcile, so
a same-object repeat is already harmless; the draft is lost only when a concurrent writer replaced the
stored row and the link is then repeated.

- [ ] **Step 1: Invert the residual test and add the ADD-draft case**

`src/app/resource-directory.test.tsx:634`. The test is named
`KNOWN RESIDUAL: re-fires the edit handler for a repeated deep-link to the resource whose editor is
already open` and asserts `expect(onEdit).toHaveBeenCalledTimes(2)`.

Rename it and invert the assertion:

```tsx
it("does not re-fire the edit handler for a repeated deep-link to the resource whose editor is already open", () => {
  // … existing setup unchanged: WorkspaceTabProvider + DeepLinkTrigger + ActiveTabHarness,
  // exercising the real resources → directory hop. Keep that harness — the remount is
  // the reason the guard cannot live in the panel (§540).
  expect(onEdit).toHaveBeenCalledTimes(1);
});
```

Add, in the same file, the Review Focus case:

```tsx
it("still honours a deep link to another resource while an unsaved ADD draft is open", () => {
  // handleOpenAddResource sets { isNew: true }; the guard must not swallow a
  // deep link to a DIFFERENT, already-saved resource.
  openAddResource();
  deepLinkTo(2);

  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2 }));
});
```

- [ ] **Step 2: Run to verify they fail**

Announce "starting vitest".

```
npx vitest run src/app/resource-directory.test.tsx --maxWorkers=1 --reporter=dot > <scratchpad>/t3-red.log 2>&1; echo EXIT=$?
```

Expected: EXIT=1, the inverted test failing with `2` received where `1` was expected. Announce
"vitest done".

- [ ] **Step 3: Add the guard**

`src/app/use-resource-directory.ts:166-168`, currently:

```ts
  const handleEditResource = useCallback((resource: Resource) => {
    setEditingResource({ resource, isNew: false });
  }, []);
```

becomes:

```ts
  const handleEditResource = useCallback((resource: Resource) => {
    // ★★ A repeated deep link (guardrail insight, global search, Recents,
    //    #resources/<id>) re-runs the open, and ResourceDirectory remounts on the
    //    tab switch the request causes, so the guard has to live here (§540).
    //    Returning `prev` UNCHANGED does two things: React bails the re-render,
    //    and the modal keeps the SAME `resource` object — resource-edit-modal.tsx
    //    resets its draft on reference inequality, so an unsaved draft survives.
    //    COST, deliberate: when a concurrent writer replaced that row while the
    //    editor was open, the editor now shows the stale copy rather than wiping
    //    the draft. Preserving the draft is what §540 asks for.
    setEditingResource((prev) =>
      prev && !prev.isNew && prev.resource.id === resource.id ? prev : { resource, isNew: false },
    );
  }, []);
```

The functional setter keeps the dependency array empty — do **not** add `editingResource` to the deps.

- [ ] **Step 4: Run to verify they pass**

Announce "starting vitest".

```
npx vitest run src/app/resource-directory.test.tsx --maxWorkers=1 --reporter=dot > <scratchpad>/t3-green.log 2>&1; echo EXIT=$?
```

Expected: EXIT=0. Announce "vitest done".

- [ ] **Step 5: Mutation-prove the guard**

| Mutant | Expected red test |
|---|---|
| Drop the `!prev.isNew` conjunct | "still honours a deep link to another resource while an unsaved ADD draft is open" |
| Compare `prev.resource !== resource` instead of by `id` | the inverted repeat test |
| Return `{ ...prev }` instead of `prev` | needs a draft-survival test — if none exists, add one asserting the modal's `resource` prop is the same object across a repeat |

The third row is the important one: returning a shallow copy passes a call-count assertion while
destroying the very draft this guard exists to protect. If no test catches it, the guard is unpinned.

- [ ] **Step 6: Fix the stale comment**

`src/app/resource-edit-modal.tsx` header comment claims the draft is "synced via useEffect". It is a
render-time reconcile (`:65-74`), not an effect. Correct the wording. This is the kind of prose that
sends the next reader looking for an effect that does not exist.

- [ ] **Step 7: Gates and commit**

```
npx tsc --noEmit > <scratchpad>/t3-tsc.log 2>&1; echo EXIT=$?
npx eslint --max-warnings=0 src/app/use-resource-directory.ts src/app/resource-directory.test.tsx src/app/resource-edit-modal.tsx > <scratchpad>/t3-lint.log 2>&1; echo EXIT=$?
```

```bash
git commit --only src/app/use-resource-directory.ts src/app/resource-directory.test.tsx src/app/resource-edit-modal.tsx -F <scratchpad>/t3-msg.txt
```

Message subject: `fix(resources): skip a repeated deep link to the open resource editor (§540)`.

---

### Task 4: Playwright spec (§535, §536, §540)

**Files:**
- Create: `e2e/hash-deep-link.spec.ts` (**LF**, like every file in `e2e/`)

**Interfaces:**
- Consumes: the fixed behaviour from Tasks 1-3.
- Produces: nothing other tasks read.

**Background the implementer needs.** The chromium project has no `testMatch`
(`playwright.config.ts:26-38`), and `testDir` is `./e2e`, so a new spec is picked up automatically and
gates the MR in the CI `e2e` job. The `webServer` is `npm run dev` (`:80`), so the **dev app router is
live and so is StrictMode** — §535's headline symptom is directly observable here, not reasoned.

`e2e/seed.ts` already seeds settings: `page.addInitScript` writing `localStorage.setItem("aipm-cockpit:settings", …)`
at `:573-575`, and settings are a shallow merge over defaults (`:569`). That is how the classic-layout
case is set up. Use the existing `test`/`expect` exports from `./seed` (`:450`, `:464`) and the
`gotoApp` helper (`:678`); read `e2e/app.spec.ts` for the house style before writing.

`getByRole` in Playwright defaults to `exact: false` — a bare name is a case-insensitive **substring**.
Pass `{ exact: true }` on every role query in this spec.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, gotoApp } from "./seed";

test("a cold item deep link lands on the item's view and keeps the id in the URL", async ({ page }) => {
  await page.goto("/#raid/1");
  await expect(page.getByRole("tab", { name: "RAID", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(page.url()).toContain("#raid/1");
});

test("a page loaded in the classic layout is not routed by a stale hash", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ layout: "classic" }));
  });
  await page.goto("/#budget");

  // The classic shell has no hash routing at all; the user must land where
  // classic puts them, not on the Dashboard or on Budget.
  await expect(page.getByRole("tab", { name: "Budget", exact: true })).toHaveCount(0);
});

test("repeating a resource deep link keeps an in-progress draft", async ({ page }) => {
  await gotoApp(page);
  await page.goto("/#resources/1");

  const firstName = page.getByRole("textbox", { name: "First name", exact: true });
  await firstName.fill("Draft-Only-Text");

  await page.goto("/#resources/1"); // repeat the same deep link

  await expect(firstName).toHaveValue("Draft-Only-Text");
});
```

Resource id `1` and the RAID item id must exist in the seeded workspace — check
`e2e/__fixtures__`/`sample-workspace-small.json` via the seed helper and use real ids. If the accessible
names above do not match the app, fix the **query**, never the app, and record what the real name is.

- [ ] **Step 2: Run the spec**

```
npx playwright test e2e/hash-deep-link.spec.ts --project=chromium --workers=1 > <scratchpad>/t4-e2e.log 2>&1; echo EXIT=$?
```

`--workers=1`: local contention makes axe/e2e failures surface as timeouts rather than real failures.

Expected: EXIT=0. If a test is red, decide whether it caught a real gap in Tasks 1-3 (fix the code,
report it) or a wrong query (fix the query).

- [ ] **Step 3: Confirm the spec actually witnesses the bug**

Re-run the first test against a reverted Task 1 (remove `if (pending) return;`), confirm it goes RED,
then restore byte-for-byte and prove `git diff --stat -- src/app/use-hash-view.ts` empty. A green e2e
test that would also pass against the unfixed code is worth nothing, and this is the only step that can
tell the difference.

- [ ] **Step 4: Gates and commit**

```
npx tsc --noEmit > <scratchpad>/t4-tsc.log 2>&1; echo EXIT=$?
npx eslint --max-warnings=0 e2e/hash-deep-link.spec.ts > <scratchpad>/t4-lint.log 2>&1; echo EXIT=$?
```

Confirm `git ls-files --eol e2e/hash-deep-link.spec.ts` reports `i/lf w/lf`.

```bash
git commit --only e2e/hash-deep-link.spec.ts -F <scratchpad>/t4-msg.txt
```

Message subject: `test(e2e): witness the cold deep link, classic load and repeat resource link (§535, §536, §540)`.

---

### Task 5: Register closures and prose sweep

**Files:**
- Modify: `docs/open-followups.md` (**LF**)
- Modify: `docs/superpowers/specs/2026-09-20-hash-view-cold-apply-design.md` (**LF**)
- Modify: `AGENTS.md` (**LF**) — only if the check below says so

**Interfaces:**
- Consumes: the commit SHAs and test names from Tasks 1-4.
- Produces: nothing code reads.

- [ ] **Step 1: Re-check the next free section number**

```
grep -oE "^## [0-9]+\." docs/open-followups.md | grep -oE "[0-9]+" | sort -n | tail -1
```

It was 594 when this plan was written, making the new entry **§595**. A § is reserved only once it is on
`origin/main`, and another session is filing entries. Run `git fetch origin` and re-run the grep against
`origin/main` before writing the number, and again immediately before push.

- [ ] **Step 2: Close §535**

Heading becomes `— CLOSED 2026-09-20`. Add a Status line naming the fix (`pendingApplyRef`, one-shot,
consumed by the view→hash effect), the tests that pin it, and the mutants from Task 1 Step 7. Preserve the
original body under the register's `_Original finding, as filed …_` convention. **Remove the
`**Work item:**` line** — a closed entry must not carry one; that gate has failed a pipeline three times.
Flip its index row to `**CLOSED** 2026-09-20`.

- [ ] **Step 3: Close §536, recording the refutation**

Same mechanics, plus the correction, which is the load-bearing part of this entry:

> The mechanism this entry describes is REFUTED. It assumes the first classic→modern switch is the page's
> first enabled window (`false → true`). It is not: `use-settings.ts:171` seeds `defaultSettings`
> synchronously and `settings-types.ts:731` sets `layout: "modern"`, so `task-manager.tsx:247` passed
> `enabled === true` on render 1 for every user and a real classic load ran `true → false`. The symptom
> filed was real; the cause was the cold apply running before hydration. Fixed by gating the call site on
> `hydrated`.

Do not rewrite the preserved original body — a future reader needs to see what was believed and why it
was wrong.

- [ ] **Step 4: Close §540 with its site correction**

Include: "This entry names `task-manager.tsx` as the guard site. The state is in
`use-resource-directory.ts:144` and the guard landed there." Record the deliberate stale-row trade from
Task 3 Step 3 in the closure — it is a behaviour change and must not be discovered later.

- [ ] **Step 5: File and close §595**

New entry for the default-`features` cold landing: the cold rule judged the hash against
`defaultSettings.features` and never revisited the decision (`pageColdDoneRef` is already set when the
real `features` identity arrives), so a user who disabled the dashboard module was still landed on it and
a hash naming a disabled module was still honoured. Filed and closed on this branch by Task 2. Give it an
index row reading `**CLOSED** 2026-09-20` and **no** `**Work item:**` line.

- [ ] **Step 6: Correct §478's closure**

Add a dated note: its "an async settings load starts the hook disabled" rationale is refuted by the same
evidence as §536, and the `enabled: false` initial-props test it introduced is, since §536, the real
startup path rather than a defensive case.

- [ ] **Step 7: Annotate the spec**

Add a dated `As shipped (2026-09-20)` section to
`docs/superpowers/specs/2026-09-20-hash-view-cold-apply-design.md` recording the two design changes this
plan made: no hash snapshot, and the gate folded into `enabled` rather than added as a parameter. Do not
rewrite the original spec text.

- [ ] **Step 8: Decide the AGENTS.md question**

AGENTS.md's remount-swallow bullet is about a child seeding its last-seen ref from a live prop. The
`hydrated` gate is a different shape — an effect that must not act on defaults. Read the bullet and
decide whether it earns a line. **If it does not, add nothing** and say so in the report. AGENTS.md
regrew 111% in fifteen days; a true sentence that is not worth every session's context is still a
regression.

- [ ] **Step 9: Run the register and docs gates**

```
npm run followups:index:check > <scratchpad>/t5-idx.log 2>&1; echo EXIT=$?
npm run followups:status:check > <scratchpad>/t5-status.log 2>&1; echo EXIT=$?
npm run followups:workitems:check > <scratchpad>/t5-wi.log 2>&1; echo EXIT=$?
npm run docs:claims:check > <scratchpad>/t5-claims.log 2>&1; echo EXIT=$?
npm run docs:symbols:check > <scratchpad>/t5-symbols.log 2>&1; echo EXIT=$?
npm run docs:scripts:check > <scratchpad>/t5-scripts.log 2>&1; echo EXIT=$?
```

`followups:index:check` splits exit **1 = drift** from exit **2 = could not scan**; a 2 demands the
opposite response to a 1 — the gate read nothing and passed everything. `docs:claims:check` fails on any
**new** `path:LINE` citation, so prefer symbol names to line numbers in everything written above.

- [ ] **Step 10: Commit**

```bash
git commit --only docs/open-followups.md docs/superpowers/specs/2026-09-20-hash-view-cold-apply-design.md -F <scratchpad>/t5-msg.txt
```

Message subject: `docs(register): close §535, §536, §540 and file §595`. Body cites §N only — **no `#NN`
and no `Closes`**; the issue numbers (#325, #326, #330) belong in the MR description alone.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: the hydration gate → Task 2; the passive-write fix
→ Task 1; §540's guard → Task 3; the Playwright bar → Task 4; register, §478 note, `resource-edit-modal`
comment and the AGENTS.md question → Tasks 3 and 5. Two spec prescriptions are deliberately superseded
and flagged at the top of this plan: the hash snapshot (dropped — the gate makes it unnecessary and it
would ignore a hash edited during load) and the third parameter (folded into `enabled`). The spec's
DELETE order on the "loaded disabled" test is retired for the same reason, and Task 2 Step 5 rewrites its
justification instead.

**Type consistency.** `handleEditResource` keeps `(resource: Resource) => void` and empty deps in Task 3.
`useHashView` keeps `(enabled?: boolean, features?: readonly FeatureModuleId[]) => void` — Task 2 changes
only the argument expression. `pendingApplyRef` is `useRef<boolean>` throughout.

**Open risk.** Task 4's accessible names and seeded ids are written from the fixture's expected shape, not
from a run. If they do not match, the implementer fixes the query and records the real name — that is the
one place this plan expects to be corrected in flight.
