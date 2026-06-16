import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ActionRow } from "./action-row";
import type { SuggestedAction } from "./next-actions/types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";

const action: SuggestedAction = {
  id: "raid:1:severity", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "Server down"] },
  why: { key: "actionRaidWhySeverity", params: ["Critical"] },
  score: 30, tier: "soon", cta: { kind: "open", view: "raid", id: 1 },
};

describe("ActionRow", () => {
  it("clicking the row body fires onOpen with the action", () => {
    const onOpen = vi.fn();
    // The row is a plain onClick div (no role=button — avoids nested-interactive
    // a11y with the inner Open button). Click the title text; it bubbles to the row.
    const { getByText } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} />);
    fireEvent.click(getByText(/Server down/));
    expect(onOpen).toHaveBeenCalledWith(action);
  });
  it("clicking the Open button fires onOpen exactly once (stopPropagation)", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} />);
    fireEvent.click(getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("ActionRow snooze", () => {
  it("opens the snooze menu and fires onSnooze with 1h / 1d", () => {
    const onSnooze = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={() => {}} onSnooze={onSnooze} />);
    fireEvent.click(getByRole("button", { name: /Snooze/i }));
    fireEvent.click(getByRole("button", { name: "1 hour" }));
    expect(onSnooze).toHaveBeenCalledWith(action, SNOOZE_1H);
    fireEvent.click(getByRole("button", { name: /Snooze/i }));
    fireEvent.click(getByRole("button", { name: "1 day" }));
    expect(onSnooze).toHaveBeenCalledWith(action, SNOOZE_1D);
  });
  it("snooze menu clicks do not fire onOpen (stopPropagation)", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} onSnooze={() => {}} />);
    fireEvent.click(getByRole("button", { name: /Snooze/i }));
    fireEvent.click(getByRole("button", { name: "1 hour" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("renders no Snooze control when onSnooze is omitted", () => {
    const { queryByRole } = render(<ActionRow lang="en-US" action={action} onOpen={() => {}} />);
    expect(queryByRole("button", { name: /Snooze/i })).toBeNull();
  });
});

describe("ActionRow create task", () => {
  it("renders Create task for a non-task-due action and calls onCreateTask without opening", () => {
    const onOpen = vi.fn();
    const onCreateTask = vi.fn();
    const action = {
      id: "raid:1:severity", source: "raid",
      title: { key: "actionRaidTitle", params: [1, "X"] },
      why: { key: "actionRaidWhyNoOwner", params: ["High"] },
      score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 1 },
    } as never;
    render(<ActionRow lang="en-US" action={action} onOpen={onOpen} onCreateTask={onCreateTask} />);
    const btn = screen.getByRole("button", { name: /create task/i });
    fireEvent.click(btn);
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hides Create task for a task-due action", () => {
    const action = {
      id: "task-due:1:overdue", source: "task-due",
      title: { key: "actionTaskTitle", params: ["X"] },
      why: { key: "actionTaskWhyOverdue", params: [2] },
      score: 40, tier: "now", cta: { kind: "open", view: "open-points", id: 1 },
    } as never;
    render(<ActionRow lang="en-US" action={action} onOpen={() => {}} onCreateTask={() => {}} />);
    expect(screen.queryByRole("button", { name: /create task/i })).toBeNull();
  });

  it("hides Create task when onCreateTask is not provided", () => {
    const action = {
      id: "raid:1:severity", source: "raid",
      title: { key: "actionRaidTitle", params: [1, "X"] },
      why: { key: "actionRaidWhyNoOwner", params: ["High"] },
      score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 1 },
    } as never;
    render(<ActionRow lang="en-US" action={action} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: /create task/i })).toBeNull();
  });
});

describe("ActionRow assign owner", () => {
  function noOwnerRaid(): never {
    return {
      id: "raid:12:severity", source: "raid",
      title: { key: "actionRaidTitle", params: [12, "DB outage"] },
      why: { key: "actionRaidWhyNoOwner", params: ["High"] },
      score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 12 },
    } as never;
  }
  const bundle = { resources: [], onCreateResource: () => 1, onAssign: () => {} };

  it("shows Assign owner for a no-owner raid action and opens the picker", () => {
    const onOpen = vi.fn();
    render(<ActionRow lang="en-US" action={noOwnerRaid()} onOpen={onOpen} assignOwner={{ ...bundle, onAssign: vi.fn() }} />);
    const btn = screen.getByRole("button", { name: /assign owner/i });
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();       // stopPropagation
    expect(screen.getByRole("combobox")).toBeInTheDocument(); // ResourcePicker input present (role="combobox")
  });

  it("hides Assign owner for an owned raid action (severity why)", () => {
    const owned = { ...(noOwnerRaid() as SuggestedAction), why: { key: "actionRaidWhySeverity", params: ["High"] } } as never;
    render(<ActionRow lang="en-US" action={owned} onOpen={() => {}} assignOwner={bundle} />);
    expect(screen.queryByRole("button", { name: /assign owner/i })).toBeNull();
  });

  it("hides Assign owner when no assignOwner bundle is provided", () => {
    render(<ActionRow lang="en-US" action={noOwnerRaid()} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: /assign owner/i })).toBeNull();
  });

  it("calls onAssign and closes when a resource is picked", () => {
    const onAssign = vi.fn();
    const resources = [{ id: 1, firstName: "Mara", lastName: "Vega", email: "mara@x.io" }] as never;
    render(
      <ActionRow
        lang="en-US"
        action={noOwnerRaid() as never}
        onOpen={() => {}}
        assignOwner={{ resources, onCreateResource: () => 1, onAssign }}
      />,
    );
    // Open the assign-owner popover.
    fireEvent.click(screen.getByRole("button", { name: /assign owner/i }));
    // The ResourcePicker combobox is now rendered; focus it so the listbox opens.
    const combobox = screen.getByRole("combobox");
    fireEvent.focus(combobox);
    // Select "Mara Vega" via onMouseDown (ResourcePicker uses onMouseDown on option buttons
    // so it runs before the blur that would otherwise close the listbox).
    // Target the option <li> by role to get a unique element, then fire on the button inside.
    const optionLi = screen.getByRole("option");
    fireEvent.mouseDown(optionLi.querySelector("button")!);
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0][1]).toMatchObject({ resourceId: 1 });
    expect(screen.queryByRole("combobox")).toBeNull(); // popover closed
  });
});

describe("ActionRow draft message", () => {
  function draftableAction(source: string): never {
    return {
      id: `${source}:1:x`, source,
      title: { key: "actionTaskTitle", params: ["X"] },
      why: { key: "actionTaskWhyOverdue", params: [2] },
      score: 40, tier: "now", cta: { kind: "open", view: "open-points", id: 1 },
    } as never;
  }

  it("shows Draft message for task-due and calls onDraftMessage without opening", () => {
    const onOpen = vi.fn();
    const onDraftMessage = vi.fn();
    const action = draftableAction("task-due");
    render(<ActionRow lang="en-US" action={action} onOpen={onOpen} onDraftMessage={onDraftMessage} />);
    const btn = screen.getByRole("button", { name: /draft message/i });
    fireEvent.click(btn);
    expect(onDraftMessage).toHaveBeenCalledTimes(1);
    expect(onDraftMessage).toHaveBeenCalledWith(action);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows Draft message for stakeholder-comms and calls onDraftMessage", () => {
    const onDraftMessage = vi.fn();
    const action = draftableAction("stakeholder-comms");
    render(<ActionRow lang="en-US" action={action} onOpen={() => {}} onDraftMessage={onDraftMessage} />);
    const btn = screen.getByRole("button", { name: /draft message/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onDraftMessage).toHaveBeenCalledTimes(1);
    expect(onDraftMessage).toHaveBeenCalledWith(action);
  });

  it("hides Draft message for other sources and when onDraftMessage absent", () => {
    const { unmount } = render(<ActionRow lang="en-US" action={draftableAction("budget")} onOpen={() => {}} onDraftMessage={() => {}} />);
    expect(screen.queryByRole("button", { name: /draft message/i })).toBeNull();
    unmount();
    render(<ActionRow lang="en-US" action={draftableAction("task-due")} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: /draft message/i })).toBeNull();
  });
});

describe("ActionRow escalate", () => {
  // Has-owner severity action (why = actionRaidWhySeverity) — the escalate target.
  function severityRaid(): never {
    return {
      id: "raid:5:severity", source: "raid",
      title: { key: "actionRaidTitle", params: [5, "API outage"] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score: 30, tier: "now", cta: { kind: "open", view: "raid", id: 5 },
    } as never;
  }
  const raidItems = [
    { id: 5, category: "I", title: "API outage", status: "Open", severity: "High" },
  ] as never;
  const bundle = { resources: [], onCreateResource: () => 1, raid: raidItems, onEscalate: () => {} };
  // The trigger button is "Escalate"; the in-dialog confirm is "Escalate now" — anchor the
  // regex so the two never collide.
  const ESCALATE = /^Escalate$/;

  it("shows Escalate for a has-owner severity raid action", () => {
    render(<ActionRow lang="en-US" action={severityRaid()} onOpen={() => {}} escalate={bundle} />);
    expect(screen.getByRole("button", { name: ESCALATE })).toBeInTheDocument();
  });

  it("opens the confirm dialog without firing onOpen (stopPropagation)", () => {
    const onOpen = vi.fn();
    render(<ActionRow lang="en-US" action={severityRaid()} onOpen={onOpen} escalate={bundle} />);
    fireEvent.click(screen.getByRole("button", { name: ESCALATE }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hides Escalate for a no-owner raid action (assign-owner's row — non-overlap)", () => {
    const noOwner = { ...(severityRaid() as SuggestedAction), why: { key: "actionRaidWhyNoOwner", params: ["High"] } } as never;
    render(<ActionRow lang="en-US" action={noOwner} onOpen={() => {}} escalate={bundle} />);
    expect(screen.queryByRole("button", { name: ESCALATE })).toBeNull();
  });

  it("hides Escalate for a review-due raid action", () => {
    const reviewDue = { ...(severityRaid() as SuggestedAction), why: { key: "actionRaidWhyReviewOverdue", params: [3] } } as never;
    render(<ActionRow lang="en-US" action={reviewDue} onOpen={() => {}} escalate={bundle} />);
    expect(screen.queryByRole("button", { name: ESCALATE })).toBeNull();
  });

  it("hides Escalate when no escalate bundle is provided", () => {
    render(<ActionRow lang="en-US" action={severityRaid()} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: ESCALATE })).toBeNull();
  });
});

describe("ActionRow rebaseline", () => {
  const milestones = [{ id: 7, name: "Go-Live", date: "2026-06-01", linkedTaskIds: [] }] as never;
  const tasks = [] as never;
  const reb = (over = {}) => ({
    milestones, tasks,
    onRebaselineMilestone: () => {},
    snapshotActive: true,
    onRebaselineSnapshot: () => {},
    ...over,
  });
  function action(source: string, whyKey: string, id: number): SuggestedAction {
    return {
      id: `${source}:${id}:x`, source, moduleId: undefined,
      title: { key: "actionMilestoneTitle", params: ["X"] },
      why: { key: whyKey }, score: 30, tier: "now",
      cta: { kind: "open", view: "milestones", id },
    } as never;
  }
  const REB = /^Re-baseline$/;

  it("shows Re-baseline for a milestone at-risk row", () => {
    render(<ActionRow lang="en-US" action={action("milestone", "actionMilestoneWhyAtRisk", 7)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("shows Re-baseline for a milestone overdue row", () => {
    render(<ActionRow lang="en-US" action={action("milestone", "actionMilestoneWhyOverdue", 7)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("shows Re-baseline for a schedule-slipping row when snapshotActive", () => {
    render(<ActionRow lang="en-US" action={action("schedule", "actionScheduleWhySlipping", 0)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("shows Re-baseline for a budget-worsening row when snapshotActive", () => {
    render(<ActionRow lang="en-US" action={action("budget", "actionBudgetWhyWorsening", 0)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.getByRole("button", { name: REB })).toBeInTheDocument();
  });
  it("hides the snapshot CTA when snapshotActive is false", () => {
    render(<ActionRow lang="en-US" action={action("schedule", "actionScheduleWhySlipping", 0)} onOpen={() => {}} rebaseline={reb({ snapshotActive: false })} />);
    expect(screen.queryByRole("button", { name: REB })).toBeNull();
  });
  it("does not show Re-baseline for a raid row", () => {
    render(<ActionRow lang="en-US" action={action("raid", "actionRaidWhySeverity", 1)} onOpen={() => {}} rebaseline={reb()} />);
    expect(screen.queryByRole("button", { name: REB })).toBeNull();
  });
  it("does not show Re-baseline when the bundle is absent", () => {
    render(<ActionRow lang="en-US" action={action("milestone", "actionMilestoneWhyAtRisk", 7)} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: REB })).toBeNull();
  });
});
