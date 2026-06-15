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
    expect(screen.getByRole("textbox")).toBeInTheDocument(); // ResourcePicker input present
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
});
