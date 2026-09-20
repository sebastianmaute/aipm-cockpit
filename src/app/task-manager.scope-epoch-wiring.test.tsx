// §548 — pins that `task-manager.tsx` hands the REAL scope-epoch reader to every consumer.
//
// ★★★ WHY A TEST AT ALL, WHEN THE PROP IS REQUIRED AND TYPED. `ScopeEpochReader` is `() => number`,
//   so tsc proves that SOME function is passed and nothing about WHICH. A `() => 0` would typecheck
//   everywhere, and it is not a silly mutant: it is exactly what a reviewer reaches for when a test
//   harness needs a reader, and exactly what the epoch guard reads as "the scope never changed" —
//   i.e. every stale write would be kept, silently, with the whole feature still appearing wired.
// ★★ AND NOTHING ELSE COVERS IT. `task-manager.characterization.test.tsx` mocks `workspace-section`
//   and mounts the DEFAULT (dashboard) view, so `tasksSectionEl` is only ever CONSTRUCTED as JSX
//   there, never rendered — its prop bag is not among the props that suite captures. That gap is
//   what this file closes, and it closes it without mounting the pane: a React element carries its
//   props whether or not it is ever rendered, so mocking the SHELL that receives the element is
//   enough to read them.
// ★ The three readers are compared BY IDENTITY, against the one `useStorageBackend` actually
//   returned (it is a `useCallback(…, [])`, so a single stable function per mount). Identity is the
//   only property that separates the real reader from any other `() => number`.
//
// Mutations (each named, each turns one assertion red on its own):
//   MS1 — `getScopeEpoch={getScopeEpoch}` on `<TasksSection>` → `getScopeEpoch={() => 0}`:
//         "the tasks pane gets the same reader" is red, the calendar one stays green.
//   MS2 — drop `getScopeEpoch,` from the `useCalendarIntegrations({…})` deps object:
//         "the calendar deps bag gets the same reader" is red, the tasks one stays green.
//   MS3 — `getScopeEpoch,` in `workspaceProps` → `getScopeEpoch: () => 0`:
//         "the workspace pane gets both real readers" is red, MS1/MS2's assertions stay green.
//   MS4 — `isSwapInFlight,` in `workspaceProps` → `isSwapInFlight: () => false`:
//         the same test is red on the OTHER reader — which is the §596 near-miss worth naming:
//         a constant of the right type disarms the chat panel's §548 unmount cancel outright
//         (nothing would ever be cancelled) while tsc, eslint and every rendered assertion stay
//         green. Required props prove a function is PASSED, never WHICH ONE.
import type { ReactElement } from "react";
import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const captured = vi.hoisted(() => ({
  storageReader: undefined as unknown,
  swapReader: undefined as unknown,
  calendarReader: undefined as unknown,
  shellProps: null as Record<string, unknown> | null,
}));

// Both hooks are WRAPPED, not stubbed: the real implementation still runs (task-manager needs its
// whole return), the wrapper only records the one value under test. Named `use*` so the
// rules-of-hooks lint treats them as the hooks they are.
vi.mock("./use-storage-backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-storage-backend")>();
  function useStorageBackend(args: Parameters<typeof actual.useStorageBackend>[0]) {
    const result = actual.useStorageBackend(args);
    captured.storageReader = result.getScopeEpoch;
    captured.swapReader = result.isSwapInFlight;
    return result;
  }
  return { ...actual, useStorageBackend };
});

vi.mock("./use-calendar-integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-calendar-integrations")>();
  function useCalendarIntegrations(deps: Parameters<typeof actual.useCalendarIntegrations>[0]) {
    captured.calendarReader = deps.getScopeEpoch;
    return actual.useCalendarIntegrations(deps);
  }
  return { ...actual, useCalendarIntegrations };
});

// The shell IS stubbed: it receives `tasksSection` as a ready-made element, and not rendering it is
// the point — the pane's own mount is heavy and irrelevant to the wiring under test.
vi.mock("./modern-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./modern-shell")>()),
  ModernShell: (props: Record<string, unknown>) => {
    captured.shellProps = props;
    return <div data-testid="modern-shell-mock" />;
  },
}));

import TaskManager from "./task-manager";

function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

describe("§548 task-manager threads the real scope-epoch reader", () => {
  beforeAll(async () => {
    window.localStorage.clear();
    seedRegistry();
    render(<TaskManager />);
    await screen.findByTestId("modern-shell-mock");
  }, 45000); // heavy TaskManager mount — headroom over the 20s hookTimeout under coverage load

  function tasksSectionProps(): Record<string, unknown> {
    const el = captured.shellProps?.tasksSection as ReactElement<Record<string, unknown>> | undefined;
    expect(el, "the shell never received a tasksSection element").toBeTruthy();
    return el!.props;
  }

  // Anti-vacuity: every identity assertion below would pass trivially if both sides were
  // `undefined`, so prove first that a real reader exists and answers with a number.
  it("useStorageBackend really returned a reader, and it reads a number", () => {
    expect(typeof captured.storageReader).toBe("function");
    expect(typeof (captured.storageReader as () => number)()).toBe("number");
  });

  it("the tasks pane gets the same reader instance useStorageBackend returned (MS1)", () => {
    expect(tasksSectionProps().getScopeEpoch).toBe(captured.storageReader);
  });

  it("the calendar-integrations deps bag gets the same reader instance (MS2)", () => {
    expect(captured.calendarReader).toBe(captured.storageReader);
  });

  // §596 — the second hop (WorkspaceSection → ChatPanel) is pinned by
  // `workspace-section.test.tsx`'s "the very readers it was handed" case; together
  // the two cover useStorageBackend → … → ChatPanel by identity at every hop.
  it("useStorageBackend really returned a swap reader, and it answers with a boolean", () => {
    // Anti-vacuity for the identity assertion below, same reason as above.
    expect(typeof captured.swapReader).toBe("function");
    expect(typeof (captured.swapReader as () => boolean)()).toBe("boolean");
  });

  it("the workspace pane element gets both real readers (MS3, MS4)", () => {
    const el = captured.shellProps?.workspace as ReactElement<Record<string, unknown>> | undefined;
    expect(el, "the shell never received a workspace element").toBeTruthy();
    expect(el!.props.getScopeEpoch).toBe(captured.storageReader);
    expect(el!.props.isSwapInFlight).toBe(captured.swapReader);
  });
});
