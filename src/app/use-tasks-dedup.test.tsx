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

// The trigger's IDLE accessible name, matched EXACTLY. It was a
// `/deduplicate & unify tasks/i` regex until the trigger became the shared
// AiTriggerButton; a regex is the wrong tool here now, because the control
// RENAMES to "Stop" while a call is in flight and a loose matcher tuned to
// accept both states would stop distinguishing them.
const DEDUP_TRIGGER = "Deduplicate & unify";

describe("useTasksDedup trigger accessible name", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // ★★ THE NAMES BELOW LOST THE TRAILING WORD "tasks", AND AN EARLIER REVISION
  //    OF THIS COMMENT JUSTIFIED THAT WITH A FALSEHOOD — that the old name failed
  //    WCAG 2.5.3 and AiTriggerButton's name-follows-label rule fixed it. It did
  //    not. The old IDLE name was `taskDedupTitle` ("Deduplicate & unify tasks"),
  //    which CONTAINS the visible label ("Deduplicate & unify"), so idle was
  //    already 2.5.3-conformant. Only the old BUSY state failed it (visible
  //    "Thinking…" against a name that never mentioned stopping). The shortening
  //    is a CONSEQUENCE of adopting the shared primitive, not a fix — and it cuts
  //    label descriptiveness, the WCAG 2.4.6 direction.
  // ★ So the longer sentence is restored where it belongs: as `description` →
  //   `title`, the accessible DESCRIPTION, the same split use-alloc-plan uses for
  //   allocPlanTitle. Hence `title` below is the LONG string while `aria-label`
  //   is the short one — asserting them apart is what proves the disclosure
  //   actually landed rather than falling back to the name.
  // ★ The QUALIFIER half was never in question and is the half that matters:
  //   this hook mounts twice and the classic layout renders both triggers in one
  //   DOM. It rides the NAME (uniqueness is a naming property), not the title.
  it("qualifies the trigger's accessible name with the view when triggerQualifier is set", () => {
    renderHarness({ triggerQualifier: "Gantt" });
    const button = screen.getByRole("button", { name: "Deduplicate & unify – Gantt" });
    expect(button.getAttribute("aria-label")).toBe("Deduplicate & unify – Gantt");
    expect(button.getAttribute("title")).toBe("Deduplicate & unify tasks");
  });

  it("leaves the trigger's accessible name unqualified when triggerQualifier is absent", () => {
    renderHarness();
    const button = screen.getByRole("button", { name: "Deduplicate & unify" });
    expect(button.getAttribute("aria-label")).toBe("Deduplicate & unify");
    // The two must DIFFER: equal strings is exactly the broken case where
    // `description` was dropped and `title` fell back to the name.
    expect(button.getAttribute("title")).toBe("Deduplicate & unify tasks");
    expect(button.getAttribute("title")).not.toBe(button.getAttribute("aria-label"));
  });
});

describe("useTasksDedup (plan-then-apply)", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  // §51 failure capture — read-only, failure path only.
  // ★★★ NOT `onTestFailed`: measured in this repo, it runs after RTL's `cleanup()`
  // in vitest.setup.ts (and after any mock-clearing afterEach), so every DOM field
  // reads null and every mock counter reads zero. This afterEach is registered LAST
  // and therefore runs FIRST (LIFO), while the DOM and the mocks are still live.
  // ★ Still failure-path only: it returns immediately unless the test failed, and it
  //   neither awaits nor flushes — nothing left to perturb once the body has returned.
  let captureOnFailure: (() => void) | undefined;
  afterEach((ctx) => {
    const capture = captureOnFailure;
    captureOnFailure = undefined;
    if (ctx.task.result?.state === "fail") capture?.();
  });

  it("shows the proposed groups in a preview and mutates NOTHING before confirm", async () => {
    vi.mocked(call.runDedupProposal).mockResolvedValue([
      { keepId: 1, mergeIds: [2], rationale: "same deliverable" },
    ]);
    const onTasks = vi.fn();
    renderHarness({ onTasks });

    fireEvent.click(screen.getByRole("button", { name: DEDUP_TRIGGER }));

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
    // No root cause was ever established for §51, so this is the primary
    // instrument: it says whether the proposal resolved, whether the preview was
    // still open, and how far the merge got.
    captureOnFailure = () => {
      console.error(
        "[§51 capture]",
        JSON.stringify({
          proposalCalls: vi.mocked(call.runDedupProposal).mock.calls.length,
          triggerDisabled:
            screen
              .queryByRole("button", { name: DEDUP_TRIGGER })
              ?.hasAttribute("disabled") ?? null,
          // ★ The trigger RENAMES to "Stop" while the billed call is in flight
          //   (shared AiTriggerButton), so a null above means "busy" just as
          //   often as it means "absent". Capture the two apart — a diagnostic
          //   that conflates them is the §73 trap in a different costume.
          triggerShowingStop: !!screen.queryByRole("button", { name: "Stop" }),
          mergeButtonPresent: !!screen.queryByRole("button", { name: /merge selected/i }),
          captureSpyCalls: captureSpy.mock.calls.length,
          ids: screen.queryByTestId("ids")?.textContent ?? null,
        }),
      );
    };

    fireEvent.click(screen.getByRole("button", { name: DEDUP_TRIGGER }));
    // The wait and the assertion must be the SAME condition. The old gate was
    // getByText(/dup/i), which matched the trigger's own TEXT — not its
    // accessible name; getByText never consults one — so it resolved while the
    // preview modal was still closed, leaving the next line's un-waited
    // getByRole to fail immediately (open-followups §51).
    fireEvent.click(await screen.findByRole("button", { name: /merge selected/i }));

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
    fireEvent.click(screen.getByRole("button", { name: DEDUP_TRIGGER }));
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
    fireEvent.click(screen.getByRole("button", { name: DEDUP_TRIGGER }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", expect.stringMatching(/no duplicate/i)));
    expect(onTasks).not.toHaveBeenCalled();
    expect(screen.queryByText(/merge selected/i)).toBeNull();
  });

  // ★★ REGRESSION (open-followups §115): this hook had NO unmount cleanup while
  //    both its siblings (use-alloc-plan, use-raci-suggest) have always carried
  //    one — and it is the one mounted TWICE (tasks-section + gantt-view). The
  //    modern shell renders only the active view, so starting a dedup in Open
  //    Points and switching to Gantt unmounted the running instance: the billed
  //    call kept going while the Gantt trigger showed the IDLE label, leaving a
  //    live call with no Stop anywhere.
  // ★ The signal must be captured from the CALL, not from the hook — the
  //   controller is private. `mockImplementation` returning a never-settling
  //   promise keeps the call in flight across the unmount.
  it("aborts the in-flight proposal when the pane unmounts", async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(call.runDedupProposal).mockImplementation((_context, _ai, signal) => {
      if (signal) signals.push(signal);
      // `Promise<never>` (not a bare `new Promise`) so the never-settling stub
      // is assignable to the real `Promise<RawMergeGroup[]>` return type — vitest
      // never typechecks, so a mock's type error would surface only in CI.
      return new Promise<never>(() => {});
    });
    const { unmount } = renderHarness();
    fireEvent.click(screen.getByRole("button", { name: DEDUP_TRIGGER }));
    await waitFor(() => expect(signals).toHaveLength(1));
    // Guard against a vacuous pass: an already-aborted signal would satisfy the
    // post-unmount assertion without the cleanup ever running.
    expect(signals[0].aborted).toBe(false);
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  // ★ A PLAIN OBJECT, not a DOMException — the cross-boundary shape. With an
  //   `instanceof DOMException` gate this falls through to the generic arm and
  //   the user sees an ERROR TOAST for a cancel they asked for.
  it("shows no error toast when the proposal rejects with a plain AbortError shape", async () => {
    vi.mocked(call.runDedupProposal).mockRejectedValue({ name: "AbortError" });
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "Deduplicate & unify" }));
    await waitFor(() => expect(call.runDedupProposal).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
    // The hook returns at `isAbortError(e)` — BEFORE the `setPhase("idle")`
    // further down — so the preview must never open on this path.
    expect(screen.queryByRole("button", { name: /merge selected/i })).toBeNull();
  });
});
