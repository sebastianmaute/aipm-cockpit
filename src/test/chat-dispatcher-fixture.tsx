// src/test/chat-dispatcher-fixture.tsx — a minimal `ChatDispatcherArgs`
// plus the provider wrapper `useChatDispatcher` cannot run without.
//
// ★★ THE TASK LIST IS **NOT** AN ARG. `useChatDispatcher` reads `tasks` /
// `setTasks` from `useWorkspace()`, and the form + filter contexts from
// `useTaskForm()` / `useFilters()` — so a test seeds tasks through
// `dispatcherWrapper(tasks)` (which threads them to `TestProviders`), never
// through `makeDispatcherArgs`. There is no `initialTasks` option and there
// cannot be one without changing the hook's contract.

import { type ReactNode } from "react";
import { vi } from "vitest";
import { type AllocationsSnapshot } from "../app/alloc-plan/alloc-plan";
import { type DashboardModel } from "../app/dashboard";
import { defaultSettings } from "../app/settings-types";
import { TestProviders, type TestSeed } from "../app/test-providers";
import { asTimeZoneForTests, createProjectClock } from "../app/timezone";
import { type Task } from "../app/types";
import type { ChatDispatcherArgs } from "../app/use-chat-dispatcher";

/** Fixed project day for every dispatcher fixture, so a `lastUpdateDate` or a
 *  `completedDate` stamped by a write path is assertable. Midday UTC, so the
 *  UTC zone below cannot roll to a neighbouring day. */
const FIXTURE_DAY = "2026-05-19";

/** Mirrors `use-chat-dispatcher.test.tsx`'s convention: a stub that THROWS a
 *  named error rather than yielding a fake, so a test that reaches it without
 *  overriding it fails legibly instead of crashing deep inside the consumer. */
function stubGetDashboardModel(): DashboardModel {
  throw new Error("getDashboardModel not stubbed for this test");
}

/** Same convention — `AllocationsSnapshot` has no cheap null fallback the way
 *  `ProjectReport` does. */
function stubGetAllocationsSnapshot(): AllocationsSnapshot {
  throw new Error("getAllocationsSnapshot not stubbed for this test");
}

/** A minimal `ChatDispatcherArgs` for unit tests. Override only what the test
 *  asserts on; every other dependency is a no-op or a loudly-throwing stub so
 *  a test cannot accidentally depend on a field it did not set. */
export function makeDispatcherArgs(
  over: Partial<ChatDispatcherArgs> = {},
): ChatDispatcherArgs {
  return {
    settings: defaultSettings,
    clock: createProjectClock(
      asTimeZoneForTests("UTC"),
      new Date(`${FIXTURE_DAY}T12:00:00.000Z`),
    ),
    setSelectedIds: vi.fn(),
    setSettings: vi.fn(),
    isReadOnly: false,
    currentView: "open-points",
    settingsProjectId: "default",
    holidaySet: new Set<string>(),
    getDashboardModel: stubGetDashboardModel,
    getBudgetRollup: () => null,
    getAllocationsSnapshot: stubGetAllocationsSnapshot,
    logActivityAs: vi.fn(),
    /** ★★ REQUIRED on `ChatDispatcherArgs` (deliberately — see the field's own
     *  note there), so the default lives here rather than in every caller: a
     *  test that does not assert on undo capture stays untouched, and the type
     *  still catches the one production call site dropping the prop.
     *  ★ A FRESH `vi.fn()` per call, never a module-level one — a shared mock
     *  would accumulate calls across tests and turn a
     *  `toHaveBeenCalledTimes(1)` into an order-dependent assertion. It is
     *  inert either way: nothing here pushes onto a real stack. */
    undo: { captureComposite: vi.fn() },
    ...over,
  };
}

/** The `renderHook` wrapper `useChatDispatcher` requires, and the ONLY way to
 *  seed the task list (see the header note).
 *
 *  ★ JSX, hence a `.tsx` module — the two gates rule out both `createElement`
 *  spellings. `TestProviders` declares `children` as a REQUIRED prop, and
 *  `createElement`'s trailing-children overload type-checks the props object on
 *  its own, so passing children variadically fails tsc; moving them into the
 *  props bag then fails `react/no-children-prop` (fatal under
 *  `--max-warnings=0`). JSX satisfies both. */
export function dispatcherWrapper(tasks: Task[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestProviders tasks={tasks}>{children}</TestProviders>;
  };
}

/** The same wrapper for the NON-task slices — RAID, changes, milestones,
 *  stakeholders and resources — which the register and resource tool writers
 *  read from `useWorkspace()` exactly as the task writers read `tasks`.
 *
 *  ★ A separate export rather than a widened `dispatcherWrapper` signature:
 *  every existing caller passes a bare `Task[]` positionally, and the two
 *  shapes (`Task[]` vs a slice bag) cannot be told apart by a default
 *  parameter without a runtime `Array.isArray` sniff in a test helper.
 *  ★★ `TestProviders` seeds ONCE on mount and ignores later prop changes, so
 *  the bag must be complete at `renderHook` time — a slice added afterwards
 *  never lands, and the write under test then returns null from its own
 *  `!existing` guard while the capture assertion reads as a missing capture. */
export function dispatcherWrapperWith(seed: TestSeed) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestProviders seed={seed}>{children}</TestProviders>;
  };
}
