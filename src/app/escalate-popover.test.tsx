import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
import type { SuggestedAction } from "./next-actions/types";
import type { RaidItem } from "./types";

function action(id: number): SuggestedAction {
  return {
    id: `raid:${id}:severity`, source: "raid", moduleId: "raid",
    title: { key: "actionRaidTitle", params: [id, "X"] },
    why: { key: "actionRaidWhySeverity", params: ["High"] },
    score: 5, tier: "now", cta: { kind: "open", view: "raid", id },
  };
}
function bundle(raid: RaidItem[], onEscalate = vi.fn()): EscalateBundle {
  return { resources: [], onCreateResource: vi.fn(() => 1), raid, onEscalate };
}
const issue = (over: Partial<RaidItem> = {}): RaidItem =>
  ({ id: 1, category: "I", title: "X", status: "Open", severity: "High", ...over } as RaidItem);

describe("EscalatePopover", () => {
  it("shows the raise-severity preview and a disabled confirm until a valid email", () => {
    render(<EscalatePopover lang="en-US" action={action(1)} bundle={bundle([issue()])} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Raise severity: High → Critical")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Escalate now" })).toHaveProperty("disabled", true);
  });

  it("shows the notify-only note for a Risk", () => {
    render(<EscalatePopover lang="en-US" action={action(1)} bundle={bundle([issue({ category: "R" })])} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    expect(within(screen.getByRole("dialog")).getByText(/notify only/)).toBeTruthy();
  });

  // The picker's ✕ now clears the WHOLE field (name + email + FK). This popover
  // resolves its send target as `recipient.email || emailInput`, and adopted the
  // address into emailInput only when truthy — so clearing left the previous
  // address armed and the escalation still went to the person just cleared,
  // under an empty name.
  it("disarms the send target when the recipient picker is cleared", () => {
    const onEscalate = vi.fn();
    const resources = [
      { id: 1, firstName: "Sample", lastName: "Dummy", email: "Sample@x.com", roleId: null, utilizationMode: "percent" as const, utilization: {} },
    ];
    render(
      <EscalatePopover lang="en-US" action={action(1)}
        bundle={{ ...bundle([issue()], onEscalate), resources }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    const dialog = screen.getByRole("dialog");

    // Adopt Sample's address via the picker.
    const picker = within(dialog).getByRole("combobox");
    fireEvent.focus(picker);
    fireEvent.mouseDown(within(dialog).getByText("Alex Example"));
    expect(within(dialog).getByRole("button", { name: "Escalate now" })).toHaveProperty("disabled", false);

    // Clearing must disarm it, not fall back to the stale address.
    fireEvent.click(within(dialog).getByRole("button", { name: /^clear$/i }));
    expect(within(dialog).getByRole("button", { name: "Escalate now" })).toHaveProperty("disabled", true);
  });

  it("fires onEscalate with the chosen recipient and closes", () => {
    const onEscalate = vi.fn();
    render(<EscalatePopover lang="en-US" action={action(1)} bundle={bundle([issue()], onEscalate)} />);
    fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
    const dialog = screen.getByRole("dialog");
    const email = within(dialog).getByPlaceholderText(/email/i);
    fireEvent.change(email, { target: { value: "boss@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Escalate now" }));
    expect(onEscalate).toHaveBeenCalledWith(action(1), expect.objectContaining({ email: "boss@example.com" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
