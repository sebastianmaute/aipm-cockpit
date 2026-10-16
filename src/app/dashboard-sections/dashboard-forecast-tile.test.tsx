import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardForecastTile } from "./dashboard-forecast-tile";
import type { AppForecast } from "../forecast/app-forecast";
import type { ForecastHistoryEntry } from "../forecast-history";
import type { Milestone } from "../types";
import { milestonesAtRisk } from "../forecast-tile-model";
import { loadI18n, t } from "../i18n";

const EN = "en-US" as const;
const TODAY = "2026-10-16"; // a Friday
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

const FORECAST: Extract<AppForecast, { kind: "forecast" }> = {
  kind: "forecast", p50: "2027-01-28", p80: "2027-02-12", p95: "2027-03-03", chanceOnTime: 0.31,
  estimateCoverage: 0.5, windowDays: 60, distribution: Int32Array.from([60, 80, 95]), trialDays: Int32Array.from([60, 80, 95]), windowDates: [], trials: 10000,
  markers: { p50: 60, p80: 80, p95: 95 },
  milestones: [],
};

const entry = (date: string, p80: string | null): ForecastHistoryEntry => ({ date, p50: p80, p80, p95: p80, chanceOnTime: null });

function renderTile(over: Partial<Parameters<typeof DashboardForecastTile>[0]> = {}) {
  return render(
    <DashboardForecastTile
      lang={EN}
      forecast={FORECAST}
      history={[]}
      atRisk={[]}
      planEnd="2027-02-01"
      today={TODAY}
      holidaySet={NO_HOLIDAYS}
      openTaskCount={12}
      {...over}
    />,
  );
}

describe("DashboardForecastTile", () => {
  it("headline names P80, then P50 and P95, marked simulated", () => {
    const { container } = renderTile();
    const group = screen.getByRole("group", { name: /^8 in 10 runs finish by .*, simulated$/ });
    expect(group).toHaveTextContent("8 in 10 simulated runs finish by Feb 12, 2027.");
    expect(group).toHaveTextContent("Half by Jan 28, 2027 · almost all (19 in 20) by Mar 3, 2027.");
    expect(group.textContent!.indexOf("Feb 12, 2027")).toBeLessThan(group.textContent!.indexOf("Jan 28, 2027"));
    // One explainer serves the headline.
    expect(within(group).getByRole("button", { name: "How to read this: Forecast" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-sim] button")).toHaveLength(1);
  });

  it("P95 beyond the horizon reads 'only beyond the forecast horizon'", () => {
    renderTile({ forecast: { ...FORECAST, p95: null } });
    expect(screen.getByRole("group", { name: /^8 in 10 runs finish by .*, simulated$/ }))
      .toHaveTextContent("Half by Jan 28, 2027 · almost all (19 in 20) only beyond the forecast horizon.");
  });

  describe("change line forms", () => {
    const changeLine = (container: HTMLElement) => container.querySelector("[data-forecast-change]");

    it("later by 9 working days, the glyph hidden from assistive tech", () => {
      // 2027-01-29 (Fri) + 9 working days = 2027-02-11 (Thu); today's P80 is 2027-02-11.
      const { container } = renderTile({
        forecast: { ...FORECAST, p80: "2027-02-11" },
        history: [entry("2026-10-09", "2027-01-29")],
      });
      expect(changeLine(container)).toHaveTextContent("▲ 9 working days later than last week");
      // A comparison of two simulated dates: it wears the sim marking.
      expect(screen.getByText("9 working days later than last week").closest("[data-sim]")).not.toBeNull();
      expect(screen.getByRole("group", { name: "Change since last week, simulated" })).toBeInTheDocument();
      expect(within(changeLine(container) as HTMLElement).getByText("▲")).toHaveAttribute("aria-hidden", "true");
    });

    it("the glyph sits inside the sim outline, and the group's name is unchanged (§502)", () => {
      const { container } = renderTile({ history: [entry("2026-10-09", "2027-02-16")] });
      const group = screen.getByRole("group", { name: "Change since last week, simulated" });
      const glyph = within(changeLine(container) as HTMLElement).getByText("▼");
      expect(glyph.closest("[data-sim]")).toBe(group);
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      expect(group).toHaveTextContent("▼ 2 working days earlier than last week");
    });

    it("one working day reads singular", () => {
      const { container } = renderTile({ history: [entry("2026-10-09", "2027-02-11")] });
      expect(changeLine(container)).toHaveTextContent("▲ 1 working day later than last week");
    });

    it("earlier", () => {
      const { container } = renderTile({ history: [entry("2026-10-09", "2027-02-16")] });
      expect(changeLine(container)).toHaveTextContent("▼ 2 working days earlier than last week");
    });

    it("same", () => {
      const { container } = renderTile({ history: [entry("2026-10-09", "2027-02-12")] });
      expect(changeLine(container)).toHaveTextContent("No change since last week");
    });

    it("pending names the first date a change can be shown", () => {
      const { container } = renderTile({ history: [entry("2026-10-14", "2027-02-12")] });
      expect(changeLine(container)).toHaveTextContent("Change shown from Oct 21, 2026");
      // No comparison yet: a statement about the data, plain like the gap line.
      expect(screen.getByText("Change shown from Oct 21, 2026").closest("[data-sim]")).toBeNull();
    });

    it("beyond", () => {
      const { container } = renderTile({ history: [entry("2026-10-09", null)] });
      expect(changeLine(container)).toHaveTextContent("Change unavailable: beyond the forecast horizon");
      expect(screen.getByText("Change unavailable: beyond the forecast horizon").closest("[data-sim]")).toBeNull();
    });
  });

  it("insufficient history shows only the gap line, not marked sim", () => {
    const { container } = renderTile({
      forecast: { kind: "insufficient", finished: 4, neededFinished: 10, days: 30, neededDays: 10 },
    });
    expect(screen.getByText("Not enough history to simulate yet: 4 finished, needs 10.")).toBeInTheDocument();
    expect(container.querySelector("[data-sim]")).toBeNull();
    expect(screen.queryByText("12 open tasks")).toBeNull();
    expect(screen.queryByText("Milestones at risk")).toBeNull();
  });

  it("P80 beyond the horizon: the gap line replaces headline and bar; open work and at-risk still render", () => {
    const { container } = renderTile({ forecast: { ...FORECAST, p80: null, p95: null } });
    expect(screen.getByText("The simulated finish is beyond the 1,300-working-day horizon.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("[data-forecast-change]")).toHaveTextContent("Change unavailable: beyond the forecast horizon");
    expect(screen.getByText("12 open tasks")).toBeInTheDocument();
    expect(screen.getByText("Milestones at risk")).toBeInTheDocument();
  });

  it("a P80 without a P50 (cannot happen: P50 <= P80) renders no headline and no empty line (§502)", () => {
    // Unreachable by percentile order (P50 <= P80), but the type allows it: the guard renders nothing.
    const { container } = renderTile({ forecast: { ...FORECAST, p50: null } });
    expect(screen.queryByRole("group", { name: /^8 in 10 runs finish by/ })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    const empty = [...container.querySelectorAll("p")].filter((n) => n.textContent === "");
    expect(empty).toHaveLength(0);
  });

  it("the headline wraps: its outline is a full-width flex row, the change line's is inline (§502)", () => {
    renderTile({ history: [entry("2026-10-09", "2027-02-16")] });
    const headline = screen.getByRole("group", { name: /^8 in 10 runs finish by/ });
    expect(headline.className).toMatch(/(^| )flex flex-wrap( |$)/);
    expect(headline.className).not.toContain("inline-flex");
    const change = screen.getByRole("group", { name: "Change since last week, simulated" });
    expect(change.className).toContain("inline-flex");
    expect(change.className).not.toContain("flex-wrap");
  });

  it("open tasks are not marked sim", () => {
    renderTile({ openTaskCount: 1 });
    const open = screen.getByText("1 open task");
    expect(open.closest("[data-sim]")).toBeNull();
    renderTile({ openTaskCount: 3 });
    expect(screen.getByText("3 open tasks")).toBeInTheDocument();
  });

  describe("milestones at risk", () => {
    const milestones = [
      { id: 1, name: "Go-live", date: "2027-01-10", linkedTaskIds: [] },
      { id: 2, name: "Go-live", date: "2027-02-10", linkedTaskIds: [] },
      { id: 3, name: "Pilot", date: "2026-12-01", linkedTaskIds: [] },
      { id: 4, name: "Wrap-up", date: "2027-03-01", linkedTaskIds: [] },
      { id: 5, name: "Certain", date: "2027-03-02", linkedTaskIds: [] },
    ] as Milestone[];
    const chances: AppForecast & { kind: "forecast" } = {
      ...FORECAST,
      milestones: [
        { id: 1, state: "chance", chance: 0.31, chancePrioritised: 0.31 },
        { id: 2, state: "chance", chance: 0.2, chancePrioritised: 0.2 },
        { id: 3, state: "chance", chance: 0.6, chancePrioritised: 0.6 },
        { id: 4, state: "chance", chance: 0.9, chancePrioritised: 0.9 },
        { id: 5, state: "chance", chance: 1, chancePrioritised: 1 },
      ],
    };

    it("top 3 at risk, worst first, row-unique names", async () => {
      const onOpenMilestone = vi.fn();
      renderTile({ forecast: chances, atRisk: milestonesAtRisk(chances.milestones, milestones), onOpenMilestone });
      const list = screen.getByRole("list", { name: "Milestones at risk" });
      const rows = within(list).getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      const names = rows.map((r) => within(r).getByRole("button").getAttribute("aria-label"));
      // Tokens number in the order the rows are read: worst first.
      expect(names).toEqual(["Go-live (1)", "Go-live (2)", "Pilot"]);
      expect(new Set(names).size).toBe(3);
      expect(within(rows[0]).getByRole("group", { name: "20% chance on time – Go-live (1), simulated" }))
        .toHaveTextContent("20% chance on time");
      expect(rows[0]).toHaveTextContent("Feb 10, 2027");
      await userEvent.setup().click(within(rows[1]).getByRole("button"));
      expect(onOpenMilestone).toHaveBeenCalledWith(1);
    });

    it("names are plain text without a navigator", () => {
      renderTile({ forecast: chances, atRisk: milestonesAtRisk(chances.milestones, milestones) });
      const list = screen.getByRole("list", { name: "Milestones at risk" });
      expect(within(list).queryByRole("button")).toBeNull();
      expect(within(list).getByText("Pilot")).toBeInTheDocument();
    });

    it("none at risk", () => {
      renderTile({ forecast: chances, atRisk: [] });
      expect(screen.getByText("No milestones at risk")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Milestones at risk" })).toBeNull();
    });
  });

  it("Open Forecast only when a navigator is given", async () => {
    const { unmount } = renderTile();
    expect(screen.queryByRole("button", { name: /Open Forecast/ })).toBeNull();
    unmount();
    const onOpenForecast = vi.fn();
    renderTile({ onOpenForecast });
    await userEvent.setup().click(screen.getByRole("button", { name: "Open Forecast" }));
    expect(onOpenForecast).toHaveBeenCalledTimes(1);
  });

  describe("German (§502 part 2 keys)", () => {
    beforeAll(() => loadI18n("de"));

    it("renders the new tile strings in German, with real umlauts", () => {
      renderTile({ lang: "de", history: [entry("2026-10-09", "2027-02-12")], onOpenForecast: () => {} });
      expect(screen.getByText("Keine Änderung seit letzter Woche")).toBeInTheDocument();
      expect(screen.getByText("Gefährdete Meilensteine")).toBeInTheDocument();
      expect(screen.getByText("Keine gefährdeten Meilensteine")).toBeInTheDocument();
      expect(screen.getByText("12 offene Aufgaben")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Prognose öffnen" })).toBeInTheDocument();
    });

    it("words the beyond-horizon change and the switch note in German", () => {
      const { container } = renderTile({ lang: "de", forecast: { ...FORECAST, p80: null, p95: null } });
      expect(container.querySelector("[data-forecast-change]")).toHaveTextContent("Änderung nicht verfügbar: jenseits des Prognosehorizonts");
      expect(t("de", "helpSimulationIntroNeedsSwitch")).toBe(
        "Die Einführung erscheint im Dashboard, sobald „Monte-Carlo-Prognose verwenden“ für dieses Projekt eingeschaltet ist.",
      );
    });
  });

  it("placeholder while forecast is null", () => {
    const { container } = renderTile({ forecast: null });
    expect(container.querySelectorAll("[data-sim-placeholder]")).toHaveLength(3);
    expect(container.querySelector("[data-sim]")).toBeNull();
    expect(container.querySelector("[data-forecast-change]")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("12 open tasks")).toBeInTheDocument();
  });
});
