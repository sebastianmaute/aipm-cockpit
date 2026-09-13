import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsightLoggedRaid } from "./insight-logged-raid";
import { expectSecondaryButton } from "../../test/button-variant";

describe("InsightLoggedRaid (§515)", () => {
  it("names the linked RAID item and deep-links to it with a row-qualified name", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<InsightLoggedRaid raidId={31} nameToken="Milestone at risk" lang="en-US" onOpen={onOpen} />);
    expect(screen.getByText("Logged as RAID #31")).toBeTruthy();
    const open = screen.getByRole("button", { name: "Open RAID #31 – Milestone at risk" });
    expectSecondaryButton(open);
    // Label-in-name (WCAG 2.5.3): the accessible name starts with the visible text.
    expect(open.textContent).toBe("Open RAID #31");
    await user.click(open);
    expect(onOpen).toHaveBeenCalledWith({ view: "raid", id: 31 });
  });

  it("shows the link text but no Open button without a deep-link handler", () => {
    render(<InsightLoggedRaid raidId={31} nameToken="Milestone at risk" lang="en-US" />);
    expect(screen.getByText("Logged as RAID #31")).toBeTruthy(); // positive control
    expect(screen.queryByRole("button")).toBeNull();
  });
});
