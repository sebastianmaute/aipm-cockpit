// src/app/test/chat-dispatcher-fixture.ts — a minimal `ChatDispatcherArgs`
// plus the provider wrapper `useChatDispatcher` cannot run without.
//
// ★★ THE TASK LIST IS **NOT** AN ARG. `useChatDispatcher` reads `tasks` /
// `setTasks` from `useWorkspace()`, and the form + filter contexts from
// `useTaskForm()` / `useFilters()` — so a test seeds tasks through
// `dispatcherWrapper(tasks)` (which threads them to `TestProviders`), never
// through `makeDispatcherArgs`. There is no `initialTasks` option and there
// cannot be one without changing the hook's contract.

import { createElement, type ReactNode } from "react";
import { vi } from "vitest";
import { type AllocationsSnapshot } from "../alloc-plan/alloc-plan";
import { type DashboardModel } from "../dashboard";
import { defaultSettings } from "../settings-types";
import { TestProviders } from "../test-providers";
import { asTimeZoneForTests, createProjectClock } from "../timezone";
import { type Task } from "../types";
import type { ChatDispatcherArgs } from "../use-chat-dispatcher";

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
    ...over,
  };
}

/** The `renderHook` wrapper `useChatDispatcher` requires, and the ONLY way to
 *  seed the task list (see the header note). `createElement` rather than JSX
 *  so this stays a `.ts` module beside the args factory. */
export function dispatcherWrapper(tasks: Task[] = []) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(TestProviders, { tasks }, children);
  };
}
