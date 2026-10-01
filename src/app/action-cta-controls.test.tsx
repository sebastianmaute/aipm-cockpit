import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionRow } from "./action-row";
import type { SuggestedAction } from "./next-actions/types";

// ---------------------------------------------------------------------------
// §328 — the single-open premise behind the UNQUALIFIED overflow-menu items
// ---------------------------------------------------------------------------
// `ActionOverflowMenu` leaves its menu items (`1 hour`, `1 day`, …) without a
// row token, on the premise that two rows' menus are never in the DOM at once,
// so an item's accessible name cannot repeat in one rendered list (WCAG 2.4.6).
// These tests measure that premise through REAL input: `user-event` dispatches
// the mousedown that `PopoverPanel`'s outside-click dismissal listens for, and
// a real Tab that its focus trap intercepts. `fireEvent.click` alone would
// skip the mousedown and open both menus, which no user can do.

const mkAction = (id: number, title: string): SuggestedAction => ({
  id: `raid:${id}:severity`, source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [id, title] },
  why: { key: "actionRaidWhySeverity", params: ["Critical"] },
  score: 30, tier: "soon", cta: { kind: "open", view: "raid", id },
});

function renderTwoRows() {
  return render(
    <div>
      <ActionRow rowToken="Row A" lang="en-US" action={mkAction(1, "Server down")} onOpen={() => {}} onSnooze={() => {}} />
      <ActionRow rowToken="Row B" lang="en-US" action={mkAction(2, "Disk full")} onOpen={() => {}} onSnooze={() => {}} />
    </div>,
  );
}

describe("ActionOverflowMenu single-open premise (§328)", () => {
  it("opening row B's menu by pointer closes row A's", async () => {
    const user = userEvent.setup();
    renderTwoRows();
    await user.click(screen.getByRole("button", { name: "More actions – Row A" }));
    // Witness that A's menu really opened, so "one" below is not "zero".
    expect(screen.getAllByRole("button", { name: "1 hour" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "More actions – Row A" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "More actions – Row B" }));
    expect(screen.getAllByRole("button", { name: "1 hour" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "More actions – Row A" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "More actions – Row B" })).toHaveAttribute("aria-expanded", "true");
  });

  it("an open menu keeps Tab inside itself, so row B's trigger is unreachable by keyboard", async () => {
    const user = userEvent.setup();
    renderTwoRows();
    screen.getByRole("button", { name: "More actions – Row A" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("button", { name: "1 hour" })).toHaveLength(1);

    const triggerB = screen.getByRole("button", { name: "More actions – Row B" });
    // More Tabs than the panel has controls, so a leak out of the trap would land somewhere.
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(document.activeElement).not.toBe(triggerB);
      expect(screen.getByRole("button", { name: "1 hour" }).parentElement?.contains(document.activeElement)).toBe(true);
    }
  });
});
