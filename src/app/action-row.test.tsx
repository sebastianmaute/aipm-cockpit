import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
