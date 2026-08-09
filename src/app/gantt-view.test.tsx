// Proves GanttView's ONE reason to exist: it mounts the "Deduplicate & unify"
// dedup hook with a Gantt-qualified trigger name AND wires the call site's
// undo-capture callback through to it (the dependency GanttPanel itself never
// sees). Renders through real WorkspaceProvider/WorkspaceTabProvider so the
// context reads (tasks/setTasks/isPopout/requestHelpConcept) are exercised for
// real; only ./use-settings and ./task-dedup-call are mocked (mirrors
// use-tasks-dedup.test.tsx + knowledge-panel.test.tsx conventions).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { GanttView } from "./gantt-view";
import { defaultSettings, type Settings } from "./settings-types";
import type { Task } from "./types";
import * as call from "./task-dedup-call";

vi.mock("./task-dedup-call");
// useResizable reads/writes localStorage and measures layout — mock it so
// GanttPanel (mounted underneath GanttView) renders cleanly in jsdom, mirroring
// gantt.test.tsx.
vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null }, size: 400 }),
}));
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));

import { useSettings } from "./use-settings";
const mockUseSettings = useSettings as ReturnType<typeof vi.fn>;

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" },
};

function stubSettings(settings: Settings) {
  mockUseSettings.mockReturnValue({
    settings,
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  });
}

function mkTask(id: number, name: string): Task {
  return {
    id, taskName: name, assignee: "", assigneeEmail: "", dueDate: "2026-08-01",
    lastUpdateDate: "2026-07-01", priority: "Medium", status: "To Do", blockers: "", description: "",
  };
}

function SeedTasks({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  useEffect(() => { setTasks(tasks); }, [setTasks, tasks]);
  return null;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderGanttView(
  tasks: Task[],
  props: Partial<React.ComponentProps<typeof GanttView>> = {},
) {
  return render(
    <>
      <SeedTasks tasks={tasks} />
      <GanttView milestonesEnabled={false} {...props} />
    </>,
    { wrapper: Wrapper },
  );
}

describe("GanttView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSettings(AI_ON);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows a Gantt-qualified dedup trigger when AI is enabled with >=2 tasks", () => {
    // ★★ The name lost the word "tasks" when this trigger became the shared
    //    AiTriggerButton, which pins the accessible name to the VISIBLE label —
    //    but do NOT read that as "the old name failed WCAG 2.5.3". An earlier
    //    revision of this comment (and its twin in use-tasks-dedup.test.tsx) said
    //    so and it is false: the old idle name `taskDedupTitle` ("Deduplicate &
    //    unify tasks") CONTAINS the visible label, so idle was already conformant.
    //    Only the old BUSY state failed. The shortening is a consequence of
    //    adopting the primitive, not a fix, and the longer sentence is restored as
    //    the accessible DESCRIPTION (`title`) — asserted in use-tasks-dedup.test.tsx.
    // ★ The `– Gantt` qualifier is the load-bearing half and is UNCHANGED —
    //   this hook mounts twice and the classic layout renders both at once.
    renderGanttView([mkTask(1, "Write API docs"), mkTask(2, "Write the API documentation")]);
    const button = screen.getByRole("button", { name: "Deduplicate & unify – Gantt" });
    expect(button.getAttribute("aria-label")).toBe("Deduplicate & unify – Gantt");
  });

  it("renders no dedup trigger when AI is disabled", () => {
    stubSettings(defaultSettings); // ai.enabled defaults to false
    renderGanttView([mkTask(1, "Write API docs"), mkTask(2, "Write the API documentation")]);
    expect(screen.queryByRole("button", { name: /deduplicate & unify/i })).toBeNull();
  });

  it("wires the onCaptureUndo prop through to the dedup hook's undo capture", async () => {
    vi.mocked(call.runDedupProposal).mockResolvedValue([
      { keepId: 1, mergeIds: [2], rationale: "same deliverable" },
    ]);
    const captureSpy = vi.fn();
    renderGanttView(
      [mkTask(1, "Write API docs"), mkTask(2, "Write the API documentation")],
      { onCaptureUndo: captureSpy as never },
    );

    fireEvent.click(screen.getByRole("button", { name: "Deduplicate & unify – Gantt" }));
    await waitFor(() => expect(screen.getByText(/same deliverable/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /merge selected/i }));

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const arg = captureSpy.mock.calls[0][0];
    expect(arg.removed.map((t: Task) => t.id)).toEqual([2]);
  });
});
