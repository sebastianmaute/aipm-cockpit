import { beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DashboardHiddenBadge } from "./dashboard-hidden-badge";
import { DASHBOARD_SHELF_TRAY_ID, DashboardShelf } from "./dashboard-shelf";
import { ResetSizeButton } from "./task-manager-ui";
import { loadI18n, t, tPlural } from "./i18n";
import type { DashboardTileId } from "./dashboard-tiles";

/**
 * Moved from `dashboard-grid.test.tsx`'s `DashboardShelf` block (spec C split
 * the shelf's toggle from its tray). The harness wires the badge and the tray
 * exactly as `dashboard-panel.tsx` does: ONE open state, the badge in the
 * control stack, the tray elsewhere.
 */
const HIDDEN: { id: DashboardTileId; title: string }[] = [
  { id: "raid", title: "RAID register" },
  { id: "burn", title: "Budget burn" },
];

function Harness({
  hidden = HIDDEN, isDragging = false, onRestore = () => {},
}: {
  hidden?: { id: DashboardTileId; title: string }[];
  isDragging?: boolean;
  onRestore?: (id: DashboardTileId) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open && (hidden.length > 0 || isDragging);
  return (
    <>
      <ResetSizeButton onClick={() => {}} lang="en-US" />
      <DashboardHiddenBadge lang="en-US" count={hidden.length} open={shown} onOpenChange={setOpen}
        isDragging={isDragging} dropProps={{}} trayId={DASHBOARD_SHELF_TRAY_ID} />
      <DashboardShelf lang="en-US" hidden={hidden} onRestore={onRestore} dropProps={{}} open={shown} />
    </>
  );
}

const badge = (n: number) => screen.getByRole("button", { name: tPlural("en-US", "dashboardHiddenTilesBadge", n, n) });
const restoreButtons = () => screen.getAllByRole("button", { name: /restore/i });

beforeAll(async () => {
  await loadI18n("de");
});

describe("DashboardHiddenBadge — what it shows (spec C decision 2)", () => {
  it("shows the count and no words, and names the count in words", () => {
    render(<Harness />);
    expect(badge(2)).toHaveTextContent(/^2$/);
    expect(badge(2)).toHaveAccessibleName("2 hidden tiles");
  });

  // ★ Fix round 1: the separate "contains its visible text in its accessible
  // name (WCAG 2.5.3)" test was removed here. It duplicated the assertion just
  // above (`toHaveAccessibleName("2 hidden tiles")` already proves the name
  // contains the digit "2"), and its `b.textContent ?? " "` fallback had been
  // typed as a literal NUL byte rather than a space, which made this whole file
  // register as binary to git (`git ls-files --eol` → `-text`) and hid every
  // subsequent diff to it. Removed rather than fixed in place, per review.

  it("uses the singular for one hidden tile", () => {
    render(<Harness hidden={[HIDDEN[0]]} />);
    expect(screen.getByRole("button", { name: t("en-US", "dashboardHiddenTilesBadgeOne") })).toHaveTextContent(/^1$/);
  });

  it("reads German plural and singular with real stems", () => {
    const { unmount } = render(<DashboardHiddenBadge lang="de" count={3} open={false} onOpenChange={() => {}} isDragging={false} dropProps={{}} trayId="x" />);
    expect(screen.getByRole("button", { name: "3 ausgeblendete Kacheln" })).toBeInTheDocument();
    unmount();
    render(<DashboardHiddenBadge lang="de" count={1} open={false} onOpenChange={() => {}} isDragging={false} dropProps={{}} trayId="x" />);
    expect(screen.getByRole("button", { name: "1 ausgeblendete Kachel" })).toBeInTheDocument();
  });

  it("is the same box as Reset size — the same primitive, variant and size", () => {
    render(<Harness />);
    const resetSize = screen.getByRole("button", { name: t("en-US", "tableResetSizeHint") });
    expect(badge(2).className).toBe(resetSize.className);
  });

  it("is not rendered at a count of 0 — unless a tile is being dragged", () => {
    const { unmount } = render(<Harness hidden={[]} />);
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
    unmount();
    render(<Harness hidden={[]} isDragging />);
    fireEvent.click(badge(0));
    expect(screen.getByText("Nothing hidden")).toBeVisible();
  });
});

describe("DashboardHiddenBadge + tray — the disclosure", () => {
  it("toggles the tray on click", () => {
    render(<Harness />);
    expect(badge(2)).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(badge(2));
    expect(badge(2)).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(DASHBOARD_SHELF_TRAY_ID)).not.toHaveAttribute("hidden");
  });

  it("opens the tray when a drag enters the collapsed badge", () => {
    render(<Harness isDragging />);
    fireEvent.dragEnter(badge(2));
    expect(badge(2)).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves the tray shut when a pointer wanders in with nothing being dragged", () => {
    // ★★ Pins the `isDragging` guard; the test above passes either way alone.
    render(<Harness isDragging={false} />);
    fireEvent.dragEnter(badge(2));
    expect(badge(2)).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the aria-controls target mounted while collapsed", () => {
    render(<Harness />);
    const target = document.getElementById(badge(2).getAttribute("aria-controls")!);
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("hidden");
  });

  it("gives every Restore button a tile-unique accessible name", () => {
    render(<Harness />);
    fireEvent.click(badge(2));
    const names = restoreButtons().map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("restores a tile from the tray through a keyboard-reachable button", () => {
    const onRestore = vi.fn();
    render(<Harness onRestore={onRestore} />);
    fireEvent.click(badge(2));
    fireEvent.click(restoreButtons()[0]);
    expect(onRestore).toHaveBeenCalledWith("raid");
  });

  it("spreads the dropProps it is given onto the badge button (the panel hands both the badge and the tray the same object)", () => {
    const onDrop = vi.fn();
    const onDragOver = vi.fn();
    render(<DashboardHiddenBadge lang="en-US" count={0} open={false} onOpenChange={() => {}} isDragging dropProps={{ onDrop, onDragOver }} trayId="x" />);
    fireEvent.dragOver(badge(0));
    fireEvent.drop(badge(0));
    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
