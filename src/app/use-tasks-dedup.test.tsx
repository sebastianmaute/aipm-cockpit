import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useTasksDedup } from "./use-tasks-dedup";
import { ToastProvider } from "./toast-context";
import { defaultSettings, type Settings } from "./settings-types";
import { type Task } from "./types";
import * as call from "./task-dedup-call";

vi.mock("./task-dedup-call");

const AI_ON: Settings = {
  ...defaultSettings,
  ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" },
};

function mkTask(id: number, name: string): Task {
  return {
    id, taskName: name, assignee: "", assigneeEmail: "", dueDate: "2026-08-01",
    lastUpdateDate: "2026-07-01", priority: "Medium", status: "To Do", blockers: "", description: "",
  };
}

interface HarnessProps {
  captureSpy?: ReturnType<typeof vi.fn>;
  onTasks?: (t: readonly Task[]) => void;
  triggerQualifier?: string;
}

function Harness({ captureSpy, onTasks, triggerQualifier }: HarnessProps) {
  const [tasks, setTasks] = useState<readonly Task[]>([
    mkTask(1, "Write API docs"),
    mkTask(2, "Write the API documentation"),
    mkTask(3, "Deploy"),
  ]);
  const dedup = useTasksDedup({
    settings: AI_ON,
    isPopout: false,
    lang: "en-US",
    tasks,
    setTasks: (u) => setTasks((prev) => { const next = typeof u === "function" ? u(prev) : u; onTasks?.(next); return next; }),
    capture: captureSpy as never,
    triggerQualifier,
  });
  return (
    <div>
      {dedup.button}
      {dedup.modal}
      <output data-testid="ids">{tasks.map((t) => t.id).join(",")}</output>
    </div>
  );
}

const showToast = vi.fn();
function renderHarness(props: HarnessProps = {}) {
  return render(
    <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>
      <Harness {...props} />
    </ToastProvider>,
  );
}

describe("useTasksDedup trigger accessible name", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("qualifies the trigger's accessible name with the view when triggerQualifier is set", () => {
    renderHarness({ triggerQualifier: "Gantt" });
    const button = screen.getByRole("button", { name: "Deduplicate & unify tasks – Gantt" });
    expect(button.getAttribute("aria-label")).toBe("Deduplicate & unify tasks – Gantt");
    expect(button.getAttribute("title")).toBe("Deduplicate & unify tasks – Gantt");
  });

  it("leaves the trigger's accessible name unqualified when triggerQualifier is absent", () => {
    renderHarness();
    const button = screen.getByRole("button", { name: "Deduplicate & unify tasks" });
    expect(button.getAttribute("aria-label")).toBe("Deduplicate & unify tasks");
    expect(button.getAttribute("title")).toBe("Deduplicate & unify tasks");
  });
});

describe("useTasksDedup (plan-then-apply)", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("shows the proposed groups in a preview and mutates NOTHING before confirm", async () => {
    vi.mocked(call.runDedupProposal).mockResolvedValue([
      { keepId: 1, mergeIds: [2], rationale: "same deliverable" },
    ]);
    const onTasks = vi.fn();
    renderHarness({ onTasks });

    fireEvent.click(screen.getByRole("button", { name: /deduplicate & unify tasks/i }));

    await waitFor(() => expect(screen.getByText(/same deliverable/i)).toBeTruthy());
    // Preview is open — but no task mutation has happened yet.
    expect(onTasks).not.toHaveBeenCalled();
    expect(screen.getByTestId("ids").textContent).toBe("1,2,3");
  });

  it("on confirm, removes the duplicate and records ONE undo entry", async () => {
    vi.mocked(call.runDedupProposal).mockResolvedValue([
      { keepId: 1, mergeIds: [2], rationale: "dup", unifiedFields: { taskName: "API documentation" } },
    ]);
    const captureSpy = vi.fn();
    renderHarness({ captureSpy });

    fireEvent.click(screen.getByRole("button", { name: /deduplicate & unify tasks/i }));
    await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /merge selected/i }));

    await waitFor(() => expect(screen.getByTestId("ids").textContent).toBe("1,3"));
    expect(captureSpy).toHaveBeenCalledTimes(1);
    const arg = captureSpy.mock.calls[0][0];
    expect(arg.removed.map((t: Task) => t.id)).toEqual([2]);
    expect(arg.edited.map((t: Task) => t.id)).toEqual([1]);
    expect(showToast).toHaveBeenCalledWith("info", expect.stringContaining("1"));
  });

  it("shows a 'no duplicates' toast and no modal when the model returns no groups", async () => {
    vi.mocked(call.runDedupProposal).mockResolvedValue([]);
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /deduplicate & unify tasks/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/no duplicate/i)));
    expect(screen.queryByText(/merge selected/i)).toBeNull();
  });

  it("drops a hallucinated id end-to-end (never reaches a real task)", async () => {
    // Model proposes keepId 1 merging a NON-EXISTENT task 999 → group has no
    // real duplicate → dropped → treated as 'no duplicates found', no mutation.
    vi.mocked(call.runDedupProposal).mockResolvedValue([
      { keepId: 1, mergeIds: [999], rationale: "bogus" },
    ]);
    const onTasks = vi.fn();
    renderHarness({ onTasks });
    fireEvent.click(screen.getByRole("button", { name: /deduplicate & unify tasks/i }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/no duplicate/i)));
    expect(onTasks).not.toHaveBeenCalled();
    expect(screen.queryByText(/merge selected/i)).toBeNull();
  });

  // ★ A PLAIN OBJECT, not a DOMException — the cross-boundary shape. With an
  //   `instanceof DOMException` gate this falls through to the generic arm and
  //   the user sees an ERROR TOAST for a cancel they asked for.
  it("shows no error toast when the proposal rejects with a plain AbortError shape", async () => {
    vi.mocked(call.runDedupProposal).mockRejectedValue({ name: "AbortError" });
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Deduplicate & unify tasks" }));
    await waitFor(() => expect(call.runDedupProposal).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
    // The hook returns at `isAbortError(e)` — BEFORE the `setPhase("idle")`
    // further down — so the preview must never open on this path.
    expect(screen.queryByRole("button", { name: /merge selected/i })).toBeNull();
  });
});
