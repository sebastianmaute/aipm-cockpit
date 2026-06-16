import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";
import { loadI18n } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Milestone, Task } from "./types";

beforeAll(async () => { await loadI18n("de"); });

const milestones: Milestone[] = [{ id: 7, name: "Go-Live", date: "2026-06-01", linkedTaskIds: [1] }];
const tasks: Task[] = [{ id: 1, title: "T", status: "todo", dueDate: "2026-08-15", linkedTaskIds: [] } as unknown as Task];

function milestoneAction(): SuggestedAction {
  return {
    id: "milestone:7:at-risk", source: "milestone", moduleId: "milestones",
    title: { key: "actionMilestoneTitle", params: ["Go-Live"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 30, tier: "now", cta: { kind: "open", view: "milestones", id: 7 },
  };
}
function scheduleAction(): SuggestedAction {
  return {
    id: "schedule:0:slipping", source: "schedule", moduleId: "trends",
    title: { key: "actionScheduleTitle" }, why: { key: "actionScheduleWhySlipping" },
    score: 30, tier: "now", cta: { kind: "open", view: "dashboard", id: 0 },
  };
}
function bundle(over: Partial<RebaselineBundle> = {}): RebaselineBundle {
  return {
    milestones, tasks,
    onRebaselineMilestone: vi.fn(),
    snapshotActive: true,
    onRebaselineSnapshot: vi.fn(),
    ...over,
  };
}

describe("RebaselinePopover milestone variant", () => {
  it("prefills the forecast date and fires onRebaselineMilestone on confirm", () => {
    const b = bundle();
    render(<RebaselinePopover lang="en-US" action={milestoneAction()} bundle={b} />);
    fireEvent.click(screen.getByRole("button", { name: /^Re-baseline$/ }));
    const input = screen.getByLabelText("New target date") as HTMLInputElement;
    expect(input.value).toBe("2026-08-15"); // forecast from linked task
    fireEvent.click(screen.getByRole("button", { name: /Re-baseline now/ }));
    expect(b.onRebaselineMilestone).toHaveBeenCalledWith(7, "2026-08-15");
  });
  it("disables confirm when the date is cleared", () => {
    render(<RebaselinePopover lang="en-US" action={milestoneAction()} bundle={bundle()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Re-baseline$/ }));
    fireEvent.change(screen.getByLabelText("New target date"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: /Re-baseline now/ })).toBeDisabled();
  });
});

describe("RebaselinePopover snapshot variant", () => {
  it("fires onRebaselineSnapshot on confirm", () => {
    const b = bundle();
    render(<RebaselinePopover lang="en-US" action={scheduleAction()} bundle={b} />);
    fireEvent.click(screen.getByRole("button", { name: /^Re-baseline$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Re-baseline now/ }));
    expect(b.onRebaselineSnapshot).toHaveBeenCalledTimes(1);
  });
});
