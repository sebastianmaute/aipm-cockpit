import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { DashboardPanel } from "./dashboard-panel";
import { DASHBOARD_SHELF_TRAY_ID } from "./dashboard-shelf";
import { groupNextActions } from "./next-actions/group";
import { rowLabel } from "./row-tokens";
import { t, tPlural } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { useMeasuredHeights } from "./use-measured-heights";
import { H_CLASS } from "./arrangement-grid";
import { rowsForHeight } from "./arrangement-measure";
import { tileById } from "./dashboard-tiles";

// A pass-through spy: the real hook runs, and its arguments are observable.
vi.mock("./use-measured-heights", async (orig) => {
  const m = await orig<typeof import("./use-measured-heights")>();
  return { ...m, useMeasuredHeights: vi.fn(m.useMeasuredHeights) };
});

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
    // §584(b) — the assertions above compare ARIA labels only, which the
    // disambiguating token always keeps distinct by construction; they cannot
    // see a regression on the VISIBLE side (a button silently losing its
    // visible text, or the tile/hero controls collapsing into one DOM node).
    // Query on visible text instead (getByText resolves against rendered
    // content, not aria-label) and pin one occurrence in EACH container.
    expect(within(screen.getByTestId("tile-topActions")).getByText(t(EN, "actionOpen"))).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: HERO })).getByText(t(EN, "actionOpen"))).toBeInTheDocument();
    expect(screen.getAllByText(t(EN, "actionOpen"))).toHaveLength(2);
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
    await hideFromMenu(user, "Upcoming & overdue");
    expect(screen.getByRole("button", { name: badgeName(1) })).toHaveTextContent(/^1$/);
  });

  it("shows the badge while a tile is being dragged, even at a count of 0", () => {
    render(<DashboardPanel {...baseProps} projectId="p-row1-drag" />, { wrapper });
    fireEvent.dragStart(screen.getByRole("button", { name: grip("Upcoming & overdue") }));
    expect(screen.getByRole("button", { name: badgeName(0) })).toBeInTheDocument();
  });

  it("never renders the badge in a popout", async () => {
    // A tile hidden in the editable view, then the same project read-only.
    const user = userEvent.setup();
    const { unmount } = render(<DashboardPanel {...baseProps} projectId="p-row1-popout" />, { wrapper });
    await hideFromMenu(user, "Upcoming & overdue");
    unmount();                                                        // flushes the write
    render(<DashboardPanel {...baseProps} projectId="p-row1-popout" isPopout />, { wrapper });
    expect(screen.queryByTestId("tile-upcoming")).toBeNull();         // the hide was persisted
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();
    // ★ Fix round 1: the tray itself (not just the badge) must be absent in a
    // popout — it was guarded by the same `!arrangement.readOnly`, but nothing
    // pinned that the guard actually removes the tray node from the DOM.
    expect(document.getElementById(DASHBOARD_SHELF_TRAY_ID)).toBeNull();
  });

  it("returns focus to the badge after a Restore that leaves tiles hidden", async () => {
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-restore" />, { wrapper });
    await hideFromMenu(user, "Upcoming & overdue");
    await hideFromMenu(user, "At a glance");
    await user.click(screen.getByRole("button", { name: badgeName(2) }));
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Upcoming & overdue` }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: badgeName(1) }));
  });

  it("closes the tray when the last hidden tile is restored, so a later hide does not re-open it unasked", async () => {
    // ★ Fix round 1: `trayOpen` used to survive a Restore that emptied the
    // tray, so the NEXT hide immediately re-opened it (the badge remounting
    // with `aria-expanded="true"` although nobody asked for the tray open).
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-tray-restale" />, { wrapper });
    await hideFromMenu(user, "Upcoming & overdue");
    await user.click(screen.getByRole("button", { name: badgeName(1) }));         // open the tray
    await user.click(screen.getByRole("button", { name: `${t(EN, "arrangementTileRestore")} – Upcoming & overdue` }));
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull();  // badge unmounted at 0

    await hideFromMenu(user, "At a glance");
    const badge = screen.getByRole("button", { name: badgeName(1) });
    expect(badge).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(DASHBOARD_SHELF_TRAY_ID)).toHaveAttribute("hidden");
  });

  it("closes the tray after a drag that opened it at hidden-count 0 ends without a drop, so a later hide does not re-open it unasked", async () => {
    // ★ Fix round 2: a drag entering the badge at count 0 sets `trayOpen`
    // true; ending the drag WITHOUT a drop (no hide happens) leaves
    // `trayOpen` stale, so the very next Hide via the tile menu re-opened the
    // tray unasked — the same shape as the restore case above, reached via
    // drag instead of restore.
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId="p-row1-drag-empty-close" />, { wrapper });
    const gripButton = screen.getByRole("button", { name: grip("Upcoming & overdue") });
    fireEvent.dragStart(gripButton);
    const dragBadge = screen.getByRole("button", { name: badgeName(0) });
    fireEvent.dragEnter(dragBadge);
    expect(dragBadge).toHaveAttribute("aria-expanded", "true");         // tray opened by the drag
    fireEvent.dragEnd(gripButton);                                      // ends WITHOUT a drop
    expect(screen.queryByRole("button", { name: /hidden tiles?$/ })).toBeNull(); // badge unmounted at 0

    await hideFromMenu(user, "Upcoming & overdue");
    const badge = screen.getByRole("button", { name: badgeName(1) });
    expect(badge).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(DASHBOARD_SHELF_TRAY_ID)).toHaveAttribute("hidden");
  });
});

describe("DashboardPanel Reset layout re-measures (adaptive heights)", () => {
  // ★★ jsdom has no layout, so the hook measures nothing here; what is pinned is the WIRING. A board
  // that differs from the default only in widths or order leaves every other key input unchanged,
  // so without a fresh nonce on each Reset the hook would never run again.
  it("hands the measure hook a new reset nonce on every Reset layout, and not on a plain re-render", async () => {
    const user = userEvent.setup();
    const spy = vi.mocked(useMeasuredHeights);
    const lastNonce = () => spy.mock.calls[spy.mock.calls.length - 1][0].resetNonce;
    const { rerender } = render(<DashboardPanel {...baseProps} projectId="p-reset-nonce" />, { wrapper });
    const initial = lastNonce();
    rerender(<DashboardPanel {...baseProps} projectId="p-reset-nonce" />);
    expect(lastNonce()).toBe(initial);

    const reset = screen.getByRole("button", { name: t(EN, "arrangementResetLayout") });
    await user.click(reset);
    const afterFirst = lastNonce();
    expect(afterFirst).not.toBe(initial);
    await user.click(reset);
    expect(lastNonce()).not.toBe(afterFirst);
  });
});

// ★★ m3: the panel's height WIRING, pinned with the layout stubbed the way
//   use-measured-heights.test.tsx stubs it. jsdom returns 0 for every rect, so without the stub the
//   hook measures nothing and every tile renders at its stored height — which is why these three
//   wiring faults used to survive the unit suite: `renderedH` ignoring the measurement, the ⋮ menu
//   reading the stored `h`, and the panel reporting no tile as flagged.
describe("DashboardPanel renders measured heights (adaptive heights)", () => {
  const SECTION = 176;
  const BODY = 137;
  const CONTENT = 400;
  afterEach(() => vi.restoreAllMocks());

  function stubBoard() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const r = (h: number) => ({ top: 0, bottom: h, height: h, left: 0, right: 10, width: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      if (this.hasAttribute("data-arrangement-section")) return r(SECTION);
      if (this.parentElement?.hasAttribute("data-arrangement-body")) return r(CONTENT);
      return r(0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-arrangement-body") ? BODY : 0;
    });
  }

  /** jsdom computes no Tailwind, so the grid's row unit and gap are given inline, BEFORE the
   *  mount frame reads them; the frame is then flushed. */
  async function mountMeasured(projectId: string) {
    stubBoard();
    const user = userEvent.setup();
    render(<DashboardPanel {...baseProps} projectId={projectId} />, { wrapper });
    const grid = screen.getByTestId("dashboard-grid");
    grid.style.gridAutoRows = "80px";
    grid.style.rowGap = "16px";
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    return user;
  }

  const UPCOMING = "Upcoming & overdue";
  const spec = tileById("upcoming")!;
  // Body padding reads 0 here: jsdom computes no `p-2`.
  const measuredH = rowsForHeight(CONTENT, 80, 16, SECTION - BODY, spec.minH, spec.maxH);

  const heightGroup = () => within(screen.getByRole("dialog", { name: kebab(UPCOMING) }))
    .getByRole("radiogroup", { name: /height/i });
  const checkedIn = (group: HTMLElement) =>
    within(group).getAllByRole("radio").filter((b) => b.getAttribute("aria-checked") === "true");

  it("renders an unflagged tile, its ⋮ menu and the resize announcement at the MEASURED height", async () => {
    // Non-vacuity: the fixture measures to something other than the stored default.
    expect(measuredH).not.toBe(spec.h);
    const user = await mountMeasured("p-measured-render");
    const tile = screen.getByTestId("tile-upcoming");
    expect(tile.className.split(" ")).toContain(H_CLASS[measuredH]);
    expect(tile.className.split(" ")).not.toContain(H_CLASS[spec.h]);

    await user.click(screen.getByRole("button", { name: kebab(UPCOMING) }));
    const checked = checkedIn(heightGroup());
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent(String(measuredH));

    // A WIDTH pick announces the height too, and it must be the height on screen.
    const widthGroup = within(screen.getByRole("dialog", { name: kebab(UPCOMING) }))
      .getByRole("radiogroup", { name: /width/i });
    const otherW = within(widthGroup).getAllByRole("radio").find((b) => b.getAttribute("aria-checked") !== "true")!;
    await user.click(otherW);
    expect(screen.getByText(
      t(EN, "arrangementTileResized", UPCOMING, otherW.textContent ?? "", String(measuredH)),
    )).toBeInTheDocument();
  });

  it("keeps a height the user picked over the measurement, and reports that tile as flagged", async () => {
    const user = await mountMeasured("p-measured-flagged");
    await user.click(screen.getByRole("button", { name: kebab(UPCOMING) }));
    const pick = within(heightGroup()).getAllByRole("radio")
      .find((b) => b.textContent !== String(measuredH) && b.textContent !== String(spec.h))!;
    const picked = Number(pick.textContent) as keyof typeof H_CLASS;
    await user.click(pick);
    // At once, before any re-measure frame: the stale map still holds this tile's reading, so only
    // `renderedH` putting the flag first can show the pick here.
    expect(screen.getByTestId("tile-upcoming").className.split(" ")).toContain(H_CLASS[picked]);
    // The pick flips the flag, which is a re-measure trigger: let that pass run too.
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    const cls = screen.getByTestId("tile-upcoming").className.split(" ");
    expect(cls).toContain(H_CLASS[picked]);
    expect(cls).not.toContain(H_CLASS[measuredH]);
    const calls = vi.mocked(useMeasuredHeights).mock.calls;
    const tiles = calls[calls.length - 1][0].tiles;
    expect(tiles.find((x) => x.id === "upcoming")?.flagged).toBe(true);
    // …and only that one: every other tile is still handed over for measuring.
    expect(tiles.filter((x) => x.flagged).map((x) => x.id)).toEqual(["upcoming"]);
  });
});
