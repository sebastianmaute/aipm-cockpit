import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { groupNextActions } from "./next-actions/group";
import { rowLabel } from "./row-tokens";
import { t, tPlural } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";

/**
 * Spec C: the Dashboard's fixed rows, exercised through the real panel.
 * ★ Every test uses its own `projectId` — `useDashboardLayout` persists per
 * project, and RTL cleanup flushes pending writes, so a shared id leaks.
 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

const EN = "en-US" as const;
const plan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const };
const baseProps = {
  lang: EN, tasks: [], raid: [], budgets: [], plan, roles: [], resources: [], absences: [],
  holidaySet: new Set<string>(), workdayHours: 8, today: "2026-06-02",
};
const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

const nowAction: SuggestedAction = {
  id: "raid:1:severity", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "Vendor slip"] },
  why: { key: "actionRaidWhySeverity", params: ["High"] },
  score: 60, tier: "now",
  cta: { kind: "open", view: "raid", id: 1 },
};
const heroGroup = groupNextActions([nowAction])[0];
const TITLE = t(EN, "actionRaidTitle", 1, "Vendor slip");
const HERO = t(EN, "actionHeroEyebrow");
const HERO_TOKEN = rowLabel(HERO, TITLE);

describe("DashboardPanel row 2 — the hero beside Overall status (spec C)", () => {
  it("mounts the Next-Actions hero in row 2, before Overall status, filling its cell", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row2-hero" heroGroup={heroGroup} onOpenAction={vi.fn()} />, { wrapper });
    const row = screen.getByTestId("dashboard-row-status");
    const hero = within(row).getByRole("region", { name: HERO });
    const overall = within(row).getByText(t(EN, "dashboardAdjustHealth"));
    expect(hero.compareDocumentPosition(overall) & FOLLOWING).toBeTruthy();
    expect(hero.className).toContain("h-full");
    expect(hero.className).not.toContain("mb-4");
  });

  it("gives Overall status the whole row when there is no Now/Soon hero", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row2-none" />, { wrapper });
    const row = screen.getByTestId("dashboard-row-status");
    expect(within(row).queryByRole("region", { name: HERO })).toBeNull();
    expect(row.children).toHaveLength(1);
    expect(within(row).getByText(t(EN, "dashboardAdjustHealth"))).toBeInTheDocument();
  });

  it("renders row 2 before the coaching card, and the coaching card before the grid", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row2-order" />, { wrapper });
    const row = screen.getByTestId("dashboard-row-status");
    const coaching = screen.getByText(t(EN, "coachingTitle"));
    const grid = screen.getByTestId("dashboard-grid");
    expect(row.compareDocumentPosition(coaching) & FOLLOWING).toBeTruthy();
    expect(coaching.compareDocumentPosition(grid) & FOLLOWING).toBeTruthy();
  });

  it("keeps the hero's action in the Top actions tile too, with names that never collide", () => {
    render(
      <DashboardPanel {...baseProps} projectId="p-row2-dupe" heroGroup={heroGroup} topActions={[nowAction]} onOpenAction={vi.fn()} />,
      { wrapper },
    );
    // Decision 5: no de-duplication — both surfaces show the action.
    expect(within(screen.getByTestId("tile-topActions")).getByText(TITLE)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: HERO })).getByText(TITLE)).toBeInTheDocument();
    // WCAG 2.4.6, which axe cannot see: every control naming this action is unique.
    const names = screen.getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((n) => n.includes(TITLE));
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(rowLabel(t(EN, "actionOpen"), TITLE));        // the tile row, unchanged
    expect(names).toContain(rowLabel(t(EN, "actionOpen"), HERO_TOKEN));   // the hero, section-qualified
  });

  it("threads the CTA bundle to the hero", async () => {
    const user = userEvent.setup();
    const onSnooze = vi.fn();
    render(
      <DashboardPanel {...baseProps} projectId="p-row2-cta" heroGroup={heroGroup} onOpenAction={vi.fn()} actionHandlers={{ onSnooze }} />,
      { wrapper },
    );
    await user.click(screen.getByRole("button", { name: rowLabel(t(EN, "actionMoreActions"), HERO_TOKEN) }));
    await user.click(screen.getByRole("button", { name: t(EN, "actionSnooze1h") }));
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onSnooze.mock.calls[0][0]).toBe(nowAction);
  });

  it("renders the hero without its handlers in a popout", () => {
    render(
      <DashboardPanel {...baseProps} projectId="p-row2-popout" isPopout heroGroup={heroGroup} onOpenAction={vi.fn()} actionHandlers={{ onSnooze: vi.fn() }} />,
      { wrapper },
    );
    expect(screen.getByRole("region", { name: HERO })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: rowLabel(t(EN, "actionMoreActions"), HERO_TOKEN) })).toBeNull();
  });
});

const kebab = (title: string) => `${t(EN, "actionMoreActions")} – ${title}`;
const grip = (title: string) => `${t(EN, "reorderHandleDragOnly")} – ${title}`;
const badgeName = (n: number) => tPlural(EN, "dashboardHiddenTilesBadge", n, n);

async function hideFromMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole("button", { name: kebab(title) }));
  const menu = screen.getByRole("dialog", { name: kebab(title) });
  await user.click(within(menu).getByRole("button", { name: t(EN, "arrangementTileHide") }));
}

describe("DashboardPanel row 1, the badge and the tray (spec C)", () => {
  it("holds the delta strip, the digest slot and the control stack in row 1", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1" />, { wrapper });
    const row = screen.getByTestId("dashboard-row-top");
    expect(within(row).getByTestId("dashboard-row-top-digest")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t(EN, "printHint") })).toBeInTheDocument();
    expect(within(row).getByText(/Welcome/i)).toBeInTheDocument();
  });

  it("renders the tray under row 1 and above row 2", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1-tray" />, { wrapper });
    const tray = document.getElementById("dashboard-shelf-tray")!;
    expect(tray).not.toBeNull();
    expect(screen.getByTestId("dashboard-row-top").compareDocumentPosition(tray) & FOLLOWING).toBeTruthy();
    expect(tray.compareDocumentPosition(screen.getByTestId("dashboard-row-status")) & FOLLOWING).toBeTruthy();
  });

  it("shows no badge with nothing hidden, and a count badge once a tile is hidden", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-badge" />, { wrapper });
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
    await hideFromMenu(user, "Progress");
    expect(screen.getByRole("button", { name: badgeName(1) })).toHaveTextContent(/^1$/);
  });

  it("shows the badge while a tile is being dragged, even at a count of 0", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1-drag" />, { wrapper });
    fireEvent.dragStart(screen.getByRole("button", { name: grip("Progress") }));
    expect(screen.getByRole("button", { name: badgeName(0) })).toBeInTheDocument();
  });

  it("never renders the badge in a popout", async () => {
    // A tile hidden in the editable view, then the same project read-only.
    const user = userEvent.setup();
    const { unmount } = render(<DashboardPanel {...baseProps} projectId="p-row1-popout" />, { wrapper });
    await hideFromMenu(user, "Progress");
    unmount();                                                        // flushes the write
    render(<DashboardPanel {...baseProps} projectId="p-row1-popout" isPopout />, { wrapper });
    expect(screen.queryByTestId("tile-progress")).toBeNull();         // the hide was persisted
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
  });

  it("returns focus to the badge after a Restore that leaves tiles hidden", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-restore" />, { wrapper });
    await hideFromMenu(user, "Progress");
    await hideFromMenu(user, "Upcoming & overdue");
    await user.click(screen.getByRole("button", { name: badgeName(2) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Progress` }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: badgeName(1) }));
  });
});
