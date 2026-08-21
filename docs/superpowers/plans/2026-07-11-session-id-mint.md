# Session-scoped monotonic id minting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One task per commit. `npx tsc --noEmit` + `npm run test:run` (or targeted) after each. Branch `feat/session-id-mint` (already created off main). HEAVY review (user request). NOT a release until the user says "release".

**Goal:** Never reuse a workspace-entity id *within a session*, so deleting the max-id row can't free that id for the next create. This makes every undo re-mint bug (L2 edit-clobber, delete-clobber, composite FK-remap, redo-clobber) structurally impossible.

**Why session scope:** the undo stack is in-memory (dies on reload), so preventing reuse *within a session* is sufficient. A reload may safely recycle ids (no undo entries survive it).

**Architecture:** a module-level per-entity-kind high-water map. `mintId(kind, list) = max(highWater[kind], max(list.id)) + 1`, updating the high-water. Seeded from the loaded workspace on load. Keep the existing re-mint machinery (`applyUndoRestore` re-mint, `resolveEntitySave`) as a backstop.

**Undoable entity KINDS (keys):** `task, raid, change, stakeholder, milestone, resource, role, discipline, grade, absence, shift, budgetBucket`. (Per-device/ephemeral minters — saved-views, panel-views, reports-views, color-schemes, scheduled-jobs, outlook-calendar/contacts, document-link, steering sub-rows, comm-templates — are LEFT ALONE.)

---

## Task 1 — Core minter module

**Files:** create `src/app/id-mint-session.ts`, `src/app/id-mint-session.test.ts`.

- [ ] Define `export type MintKind = "task"|"raid"|"change"|"stakeholder"|"milestone"|"resource"|"role"|"discipline"|"grade"|"absence"|"shift"|"budgetBucket";`
- [ ] Module-level `const highWater = new Map<MintKind, number>();`
- [ ] `export function mintId(kind: MintKind, list: readonly { id: number }[]): number` — `const listMax = list.reduce((m, i) => Math.max(m, i.id), 0); const next = Math.max(highWater.get(kind) ?? 0, listMax) + 1; highWater.set(kind, next); return next;`
- [ ] `export function mintIds(kind: MintKind, list: readonly { id: number }[], count: number): number[]` — returns `count` sequential ids, each above the high-water, updating it once (for the jira-import loop + template seed). `const start = Math.max(highWater.get(kind) ?? 0, list.reduce(max,0)) + 1; highWater.set(kind, start + count - 1); return Array.from({length: count}, (_, i) => start + i);` (count<=0 → `[]`, no high-water change).
- [ ] `export function seedMintKind(kind, list, mode: "reset" | "raise"): void` — `reset`: `highWater.set(kind, list.reduce(max, 0))`; `raise`: `highWater.set(kind, Math.max(highWater.get(kind) ?? 0, list.reduce(max, 0)))`. (`reset` used on a fresh workspace load / project switch; `raise` used on a same-project reload/restore so the mark is never LOWERED — lowering could reuse.)
- [ ] `export function seedMintFromWorkspace(ws: Pick<Workspace, entity arrays>, mode): void` — call `seedMintKind` for each of the 11 entity arrays + `budgetBucket` (flatMap all `ws.budgets[*].buckets`). Import `Workspace`/entity types from `./types`. Guard `?? []`.
- [ ] `export function __resetMintStateForTests(): void` — `highWater.clear();` (test isolation).
- [ ] **Tests:** mintId monotonic; deleting the max then minting does NOT reuse (pass a shrunk list, assert id > deleted); `mintIds` returns N sequential + advances the mark; `seedMintKind("reset")` sets to list max; `"raise"` never lowers; `seedMintFromWorkspace` seeds every kind incl. nested buckets; `__resetMintStateForTests` clears. Use `beforeEach(__resetMintStateForTests)`.
- [ ] Commit.

## Task 2 — Redirect the per-kind helpers (auto-migrates their callers)

**Files:** `raid.ts`, `change-log.ts`, `stakeholders.ts`, `budget-panel.tsx`, their tests.

The generic `nextId` (resource-foundation) can't be redirected (it doesn't know the kind), but the per-kind helpers can — redirecting them migrates all their callers with no call-site edits.

- [ ] `raid.ts:126` `nextRaidId(items)` → `return mintId("raid", items);` (import from `./id-mint-session`).
- [ ] `change-log.ts:28` `nextChangeId(items)` → `mintId("change", items)`.
- [ ] `stakeholders.ts:9` `nextStakeholderId(items)` → `mintId("stakeholder", items)`.
- [ ] `budget-panel.tsx:174` `nextBucketId(buckets)` → `mintId("budgetBucket", buckets)`.
- [ ] Update/keep each helper's existing unit tests; add `beforeEach(__resetMintStateForTests)` where they assert exact ids (the high-water now persists across calls — reset per test). ★ These helpers were pure `max+1`; now they carry session state, so any test asserting a specific returned id must reset first.
- [ ] Commit.

## Task 3 — `use-resource-planner.ts` mint sites

**Files:** `use-resource-planner.ts`, its test.

Migrate each generic-`nextId`/inline mint to `mintId(kind, list)`:
- [ ] `:407` `nextId(resources)` → `mintId("resource", resources)`.
- [ ] `:442` `resources.some(...) ? nextId(resources) : next.id` → `... ? mintId("resource", resources) : next.id`.
- [ ] `:597` `nextId(roles)` → `mintId("role", roles)`.
- [ ] `:698` `nextId(disciplines)` → `mintId("discipline", disciplines)`.
- [ ] `:724` `nextId(grades)` → `mintId("grade", grades)`.
- [ ] `:268-269` absence inline `Math.max(...absences.id)+1` → `mintId("absence", absences)`.
- [ ] `:352-353` shift inline → `mintId("shift", shifts)`.
- [ ] `:821-822` task-from-RAID inline → `mintId("task", list)`.
- [ ] RAID save `:175` already uses `nextRaidId` (auto-migrated via Task 2) — leave. `:200` `nextRaidId(baseList)` also auto — leave.
- [ ] Verify tests; add `__resetMintStateForTests` in the suite's `beforeEach` if it asserts exact ids.
- [ ] Commit.

## Task 4 — `use-chat-dispatcher.ts` (AI create tools)

**Files:** `use-chat-dispatcher.ts`, its test.

- [ ] `:210-212` inline task mint → `mintId("task", list)` (the `*Ref.current` list).
- [ ] `:390` `nextEntityId(raidRef.current)` → `mintId("raid", raidRef.current)`.
- [ ] `:437` change → `mintId("change", changesRef.current)`.
- [ ] `:482` milestone → `mintId("milestone", milestonesRef.current)`.
- [ ] `:521` stakeholder → `mintId("stakeholder", stakeholdersRef.current)`.
- [ ] `:557` resource → `mintId("resource", resourcesRef.current)`.
- [ ] Keep the private `nextEntityId` only if still used elsewhere; else remove (lint: no unused).
- [ ] ★ The AI tools mutate `*Ref.current` in place for back-to-back calls — `mintId` reads the same ref list, so sequential AI creates stay monotonic (high-water advances each call). Verify a back-to-back double-create test yields distinct ids.
- [ ] Commit.

## Task 5 — task/milestone form + jira sites

**Files:** `task-manager.tsx`, `milestones-panel.tsx`, `use-task-submit.ts`, `use-jira-sync.ts`, tests.

- [ ] `task-manager.tsx:568` `computeNextId(tasks)` → `mintId("task", tasks)`; `:1160` `computeNextId(tasksRef.current)` → `mintId("task", tasksRef.current)`; `:932` `computeNextId(resources)` → `mintId("resource", resources)`. (Drop the `computeNextId` alias import if now unused.)
- [ ] `milestones-panel.tsx:213` `nextId(milestones)` → `mintId("milestone", milestones)`; `:254` `resolveEntitySave(milestones, next.id, isNewIntent, () => nextId(milestones))` → `() => mintId("milestone", milestones)`.
- [ ] `use-task-submit.ts:200` `nextId(tasks)` → `mintId("task", tasks)`.
- [ ] `use-jira-sync.ts:107-108` `let nextId = ...max+1` used as `id: nextId++` in the import loop → replace with `const mintedIds = mintIds("task", list, <rowCount>)` and index it, OR call `mintId("task", accumulatingList)` per row. Ensure monotonic across the loop and that imported rows get distinct, non-reused ids. Verify the exact loop shape at `:255`.
- [ ] Add `__resetMintStateForTests` to affected suites' `beforeEach` where exact ids are asserted (task-manager characterization, milestones-panel, use-jira-sync).
- [ ] ★ `task-manager.tsx` is size-ratcheted — run `size:check`; rebaseline if it grows.
- [ ] Commit.

## Task 6 — `template-apply.ts`

**Files:** `template-apply.ts`, its test.

- [ ] `:14-25` `idMap()` uses `nextId(existing)` + `next += 1` per seed row to remap a whole seed. Migrate so each seeded entity kind draws from `mintIds(kind, existingOfThatKind, countOfThatKind)` (or `mintId` per row over the growing target). ★ A template seeds MULTIPLE kinds (tasks, resources, roles, milestones, raid, changes, stakeholders) — mint per-kind, not one shared counter, so each kind's high-water advances correctly. Verify the seed→apply id remap stays collision-free and monotonic.
- [ ] Test: applying a template into a non-empty workspace mints ids above each kind's max, no reuse after a prior delete.
- [ ] Commit.

## Task 7 — Seed the high-water on workspace load

**Files:** `use-storage-backend.ts`, `task-manager.tsx` (applyRestoredWorkspace), tests.

- [ ] `use-storage-backend.ts` `applyWorkspace(ws)` (~:152): after fanning the setters, call `seedMintFromWorkspace(ws, "reset")`. This runs on initial load AND project switch/create/load-file → RESET to the new workspace's maxes (a different project has its own id space; reset avoids cross-project inflation while never reusing within the loaded set).
- [ ] `use-storage-backend.ts` `reloadCurrentProject` (~:406): same-project refresh → `seedMintFromWorkspace(ws, "raise")` (NEVER lower — this tab may have deleted the max-id row locally; a reload reflecting that must not free the id).
- [ ] `task-manager.tsx` `applyRestoredWorkspace` (~:855): version restore of the same project → `seedMintFromWorkspace(restored, "raise")`.
- [ ] ★★ CRITICAL: EVERY workspace-load path must seed, or an unseeded kind's first post-delete mint reuses. Grep every `applyWorkspace`/`applyRestoredWorkspace`/`reloadCurrentProject` caller and confirm coverage.
- [ ] Test: load a workspace (max task id 100) → delete task 100 → mint → id is 101 (not 100). Reload the same project (now max 99) with `"raise"` → mint → still ≥ 101.
- [ ] Commit.

## Task 8 — End-to-end verification + backstop confirmation

- [ ] Integration-style tests per entity: seed → delete max → create → new id > deleted (no reuse). Cover all 11 kinds + budgetBucket.
- [ ] Confirm the undo re-mint machinery still PASSES its tests (kept as a backstop; it should now rarely trigger, but must not regress).
- [ ] Confirm the L2 scenario is now impossible: edit an entity → delete it → create (id NOT reused) → undo the edit → no clobber (the reused-id row never exists). Add a test.
- [ ] `npx tsc --noEmit`; `npm run test:run`; `npm run build`; `npm run size:check`; `npm run dup:check`; `npm run lint`.
- [ ] Version bump (patch or minor — user-facing behavior is subtle but it's a correctness fix; likely 0.179.0), CHANGELOG, memory. (Do at release prep, not here.)

## Risks / constraints
- **Module state:** `id-mint-session.ts` holds mutable module state → tests MUST reset via `__resetMintStateForTests` in `beforeEach`. SSR: mint happens client-side; module state is per-client-session (fine). Do not read module state during render in a way that breaks react-hooks purity — `mintId` is called from event handlers/save paths, not render bodies (verify each migrated site).
- **Backstop:** keep `applyUndoRestore`'s re-mint + `resolveEntitySave` — defense-in-depth if a mint path was missed.
- **Cross-project id inflation:** avoided by `"reset"` on `applyWorkspace`; `"raise"` only on same-project reload/restore.
- **No new persisted field / no golden regen:** the high-water is in-memory only; ids are still plain numbers persisted as before. Existing data unaffected (seeded from its max on load).
- **Lint:** dropping now-unused helper internals / the `computeNextId`/`nextEntityId` aliases must not leave unused imports (`--max-warnings=0`).
- **DE i18n:** none expected (no user-facing strings), except a release highlight at prep.
