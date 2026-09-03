// PER-SITE COVER for the mark-done CTA's status transition
// (`statusActivityKind` in `use-action-center-handlers.ts`).
//
// ★★ WHY THIS FILE EXISTS AT ALL. `use-action-center-handlers.ts` had NO test
//   file before this one, so its adoption of the transition log was the only
//   one of the six adopted surfaces with zero coverage of any kind. The
//   file-granular census in `status-activity-census.test.ts` cannot substitute,
//   and not because of how many sites the file has: it matches on the PRESENCE
//   of `applyStatusChange(` and `statusActivityKind(` anywhere in the file, so
//   deleting the `logActivity(transition, …)` line alone leaves both anchors
//   standing and the census green. Only a test that drives the handler and
//   reads the spy can see that.
//
// ★ The file is listed in `vitest.config.ts`'s `coverage.exclude` as
//   render-scope UI glue. That governs the coverage FLOORS, not testability —
//   the hook takes a fully explicit deps bag, so it drives from a plain object
//   of spies with no React tree beyond `renderHook`.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useActionCenterHandlers, type ActionCenterHandlerDeps } from "./use-action-center-handlers";
import type { SuggestedAction } from "./next-actions";
import type { Task } from "./types";

const TODAY = "2026-08-30";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Ship the thing",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-08-01",
    status: "In Progress",
    priority: "Medium",
    blockers: "",
    description: "",
    inquiriesSent: 0,
    ...overrides,
  } as Task;
}

/** A "mark done" CTA must be `kind: "open"` on the `open-points` view — the
 *  handler returns early for anything else, so a fixture that gets this wrong
 *  passes an absence assertion for the wrong reason. */
function markDoneAction(id: number): SuggestedAction {
  return {
    id: `task-due:${id}:overdue`,
    source: "task-due",
    title: { key: "actionRaidTitle", params: [id, "Ship the thing"] },
    why: { key: "actionRaidWhySeverity", params: ["Critical"] },
    score: 40,
    tier: "now",
    cta: { kind: "open", view: "open-points", id },
  };
}

function makeDeps(overrides: Partial<ActionCenterHandlerDeps> = {}): ActionCenterHandlerDeps {
  return {
    isPopout: false,
    lang: "en-US",
    today: TODAY,
    resources: [],
    tasks: [makeTask()],
    stakeholders: [],
    raid: [],
    milestones: [],
    project: undefined,
    trendsActive: false,
    snapshots: { rebaselineNow: vi.fn(), busy: false },
    commSend: { send: vi.fn() },
    onSendInquiry: vi.fn(),
    resolveCommBody: vi.fn(() => null),
    handleCreateResource: vi.fn(() => 1),
    handleCancelEdit: vi.fn(),
    setForm: vi.fn(),
    setTaskModalOpen: vi.fn(),
    setTasks: vi.fn(),
    setRaid: vi.fn(),
    setMilestones: vi.fn(),
    pendingLinkRaidIdRef: { current: null },
    recordLearning: vi.fn(async () => {}),
    showToast: vi.fn(),
    logActivity: vi.fn(),
    ...overrides,
  } as ActionCenterHandlerDeps;
}

describe("useActionCenterHandlers — mark-done reaches the activity log", () => {
  it("logs a completion when the mark-done CTA closes an open task", () => {
    const logActivity = vi.fn();
    const { result } = renderHook(() =>
      useActionCenterHandlers(makeDeps({ logActivity })),
    );
    act(() => result.current.handleMarkDoneFromAction(markDoneAction(1)));
    expect(logActivity).toHaveBeenCalledWith("task.completed", 1, "Ship the thing");
  });

  it("logs nothing when the target task was already delivered", () => {
    // Control for the block above. The handler still runs its setter — the CTA
    // is valid and the row exists — but delivered-ness does not move, so
    // `statusActivityKind` returns null. Without this block, a handler that
    // logged a completion unconditionally would satisfy the first one.
    const logActivity = vi.fn();
    const { result } = renderHook(() =>
      useActionCenterHandlers(
        makeDeps({
          logActivity,
          tasks: [makeTask({ status: "Done", completedDate: "2026-08-01" })],
        }),
      ),
    );
    act(() => result.current.handleMarkDoneFromAction(markDoneAction(1)));
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("writes nothing at all for a CTA pointing at another view", () => {
    // Second control, on the handler's early return rather than on the helper:
    // it distinguishes "the transition decided null" from "the handler declined
    // to act", which the block above cannot.
    const logActivity = vi.fn();
    const setTasks = vi.fn();
    const action: SuggestedAction = {
      ...markDoneAction(1),
      cta: { kind: "open", view: "raid", id: 1 },
    };
    const { result } = renderHook(() =>
      useActionCenterHandlers(makeDeps({ logActivity, setTasks })),
    );
    act(() => result.current.handleMarkDoneFromAction(action));
    expect(setTasks).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});

/** A stakeholder-comms "Draft" CTA — the only branch of
 *  `handleDraftMessageFromAction` that renders a comm template itself (the
 *  `task-due` branch delegates to `onSendInquiry`). */
function draftAction(id: number): SuggestedAction {
  return {
    id: `stakeholder-comms:${id}`,
    source: "stakeholder-comms",
    title: { key: "actionRaidTitle", params: [id, "Dana"] },
    why: { key: "actionRaidWhySeverity", params: ["Critical"] },
    score: 30,
    tier: "soon",
    cta: { kind: "open", view: "stakeholders", id },
  } as SuggestedAction;
}

const DANA = { id: 1, name: "Dana", email: "dana@example.com" } as ActionCenterHandlerDeps["stakeholders"][number];

describe("useActionCenterHandlers — an empty default template never drafts an empty body", () => {
  // ★★★ THE SECOND SITE OF THE SAME DEFECT. The task status-inquiry carries
  //   the same guard (pinned in `use-task-row-handlers.test.ts`); this file
  //   covers the stakeholder-update half, because a shared helper's own unit
  //   test proves the HELPER and not that this call site reaches it.
  //   `createTemplate` starts every template at `""` and the first in a
  //   category becomes its default, so this is the first-use path, not a
  //   corner case.
  it.each([
    ["an empty string", ""],
    ["an empty rich-text paragraph", "<p></p>"],
    ["an empty rich-text paragraph with a break", "<p><br></p>"],
  ])("falls back to the i18n body when the default template renders to nothing (%s)", (_label, tplBody) => {
    const send = vi.fn();
    const { result } = renderHook(() =>
      useActionCenterHandlers(
        makeDeps({
          stakeholders: [DANA],
          commSend: { send },
          resolveCommBody: vi.fn(() => tplBody),
        }),
      ),
    );
    act(() => result.current.handleDraftMessageFromAction(draftAction(1)));
    expect(send).toHaveBeenCalledTimes(1);
    const req = send.mock.calls[0][0] as { plain: string; html: string };
    expect(req.plain).not.toBe("");
    // The i18n fallback greets the stakeholder by name; an empty template that
    // slipped through would carry neither this nor anything else.
    expect(req.plain).toContain("Dana");
    expect(req.html).not.toBe("");
  });

  it("still uses a template that has real content", () => {
    // Control: without it, a fix that ignored templates outright would satisfy
    // every assertion above.
    const send = vi.fn();
    const { result } = renderHook(() =>
      useActionCenterHandlers(
        makeDeps({
          stakeholders: [DANA],
          commSend: { send },
          resolveCommBody: vi.fn(() => "<p>Update for {{stakeholderName}}</p>"),
        }),
      ),
    );
    act(() => result.current.handleDraftMessageFromAction(draftAction(1)));
    const req = send.mock.calls[0][0] as { plain: string };
    expect(req.plain).toBe("Update for Dana");
  });
});
