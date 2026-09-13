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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActionCenterHandlers, type ActionCenterHandlerDeps } from "./use-action-center-handlers";
import type { SuggestedAction } from "./next-actions";
import type { RaidItem, Task } from "./types";

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
    selfResourceId: null,
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

describe("useActionCenterHandlers — Escalate records on the item (§515)", () => {
  const item: RaidItem = {
    id: 5, category: "I", title: "Vendor down", status: "Open", severity: "High",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-08-01",
  };
  const escalateAction: SuggestedAction = {
    id: "raid:5:severity",
    source: "raid",
    title: { key: "actionRaidTitle", params: [5, "Vendor down"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 30,
    tier: "now",
    cta: { kind: "open", view: "raid", id: 5 },
  };
  const recipient = { name: "Jane Doe", email: "jane@example.com", resourceId: 4 };

  let hrefValue = "";
  let originalLocation: Location;
  beforeEach(() => {
    hrefValue = "";
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, set href(v: string) { hrefValue = v; }, get href() { return hrefValue; } },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("writes through ONE functional updater that composes with a same-tick concurrent write", () => {
    const setRaid = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, recipient); });
    expect(setRaid).toHaveBeenCalledTimes(1);
    const updater = setRaid.mock.calls[0][0] as unknown;
    expect(typeof updater).toBe("function");
    // A concurrent writer renamed the item and added a row after this render.
    const concurrent: RaidItem[] = [{ ...item, title: "Vendor down (renamed)" }, { ...item, id: 6, title: "Other" }];
    const next = (updater as (prev: readonly RaidItem[]) => readonly RaidItem[])(concurrent);
    expect(next).toHaveLength(2);
    expect(next[0].title).toBe("Vendor down (renamed)");
    expect(next[0].severity).toBe("Critical");
    expect(next[0].escalations).toEqual([
      { at: expect.any(String), toName: "Jane Doe", toEmail: "jane@example.com", toResourceId: 4, fromSeverity: "High", toSeverity: "Critical" },
    ]);
    expect(next[0].noteLog).toHaveLength(1);
    expect(next[1]).toBe(concurrent[1]);
    // buildMailtoUrl percent-encodes the address (mailto.ts) — controller
    // ruling P1: assert the encoded form, not the raw address.
    expect(hrefValue.startsWith(`mailto:${encodeURIComponent("jane@example.com")}?`)).toBe(true);
  });

  it("logs raid.escalated with the severity step only — never the address — and the log agrees with the record", () => {
    const logActivity = vi.fn();
    const setRaid = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], logActivity, setRaid })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, recipient); });
    expect(logActivity).toHaveBeenCalledWith("raid.escalated", 5, "High", "Critical");
    expect(JSON.stringify(logActivity.mock.calls)).not.toContain("jane@example.com");
    // ONE plan feeds record, log and mail — even when the updater sees a concurrent
    // severity write (deviation 15: that write is overwritten, but nothing disagrees).
    const updater = setRaid.mock.calls[0][0] as (prev: readonly RaidItem[]) => readonly RaidItem[];
    const [recorded] = updater([{ ...item, severity: "Medium" }]);
    const entry = recorded.escalations?.[0];
    expect([entry?.fromSeverity, entry?.toSeverity]).toEqual([logActivity.mock.calls[0][2], logActivity.mock.calls[0][3]]);
    expect(recorded.severity).toBe(entry?.toSeverity);
  });

  it("attributes the note echo to the user's own resource from selfResourceId", () => {
    const pat = { id: 3, firstName: "Pat", lastName: "Lee", email: "pat@example.com", roleId: null, utilizationMode: "percent", utilization: {} } as never;
    const noteOf = (selfResourceId: number | null) => {
      const setRaid = vi.fn();
      const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid, resources: [pat], selfResourceId })));
      act(() => { result.current.escalateBundle!.onEscalate(escalateAction, recipient); });
      const updater = setRaid.mock.calls[0][0] as (prev: readonly RaidItem[]) => readonly RaidItem[];
      return updater([item])[0].noteLog?.[0];
    };
    expect(noteOf(3)).toMatchObject({ authorResourceId: 3, authorName: "Pat Lee" });
    // Positive control: without a self id the same escalation writes a note with NO author.
    const anonymous = noteOf(null);
    expect(anonymous?.text).toContain("Jane Doe");
    expect(anonymous).not.toHaveProperty("authorResourceId");
    expect(anonymous).not.toHaveProperty("authorName");
  });

  // REGRESSION PIN — passes before this task's change too (the address guard predates §515);
  // kept so the rewrite cannot move the write ahead of the check.
  it("writes nothing for an invalid address (positive control: the toast fires)", () => {
    const setRaid = vi.fn();
    const showToast = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid, showToast, logActivity })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, { ...recipient, email: "nope" }); });
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(setRaid).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  // fix-all-1: isEscalationEmail rejects "<"/">" too — an address that would
  // otherwise pass isValidEmail must still be refused here.
  it("writes nothing for a <br>-bearing address that would otherwise pass isValidEmail", () => {
    const setRaid = vi.fn();
    const showToast = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() => useActionCenterHandlers(makeDeps({ raid: [item], setRaid, showToast, logActivity })));
    act(() => { result.current.escalateBundle!.onEscalate(escalateAction, { ...recipient, email: "a<br>@b.co" }); });
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(setRaid).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });
});
