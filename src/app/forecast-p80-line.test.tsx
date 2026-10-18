import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForecastP80Line } from "./forecast-p80-line";
import type { ForecastHistoryEntry } from "./forecast-history";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { localeFor } from "./date-format";

const LOCALE = localeFor("en-US");
const dm = (iso: string) => formatDayMonth(iso, LOCALE);

const entry = (date: string, p80: string | null): ForecastHistoryEntry => ({ date, p50: p80, p80, p95: p80, chanceOnTime: 0.5 });

describe("ForecastP80Line (§502 part 4)", () => {
  it("renders nothing for an empty history", () => {
    const { container } = render(<ForecastP80Line lang="en-US" history={[]} planEnd="2026-12-31" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when every recorded P80 ran past the horizon", () => {
    const { container } = render(<ForecastP80Line lang="en-US" history={[entry("2026-10-01", null)]} planEnd="2026-12-31" />);
    expect(container.innerHTML).toBe("");
  });

  it("draws one point per entry with a P80 and the plan end as a reference line", () => {
    const history = [entry("2026-10-01", "2026-12-20"), entry("2026-10-02", null), entry("2026-10-05", "2027-01-10")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="2026-12-31" compact />);
    const chart = screen.getByRole("img", { name: "Safe to commit (P80) over time" });
    expect(chart.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(2);
    expect(screen.getByTestId("trend-reference").textContent).toBe(`Plan end ${formatDayMonthYear("2026-12-31", LOCALE)}`);
  });

  it("formats the y ticks back to the dates they stand for", () => {
    const history = [entry("2026-10-01", "2026-10-11"), entry("2026-10-02", "2026-10-21")];
    render(<ForecastP80Line lang="en-US" history={history} planEnd="not-a-date" />);
    const ticks = [...document.querySelectorAll("text")].map((n) => n.textContent);
    // y runs 0 (1 Oct, the first entry) to 20 days later (21 Oct); no plan end, so no reference line.
    expect(ticks).toEqual(expect.arrayContaining([dm("2026-10-01"), dm("2026-10-11"), dm("2026-10-21")]));
    expect(screen.queryByTestId("trend-reference")).toBeNull();
  });

  it("says the line is still building with a single recorded day", () => {
    render(<ForecastP80Line lang="en-US" history={[entry("2026-10-01", "2026-12-20")]} planEnd="2026-12-31" />);
    expect(screen.getByText("The line appears once two days have been recorded.")).toBeTruthy();
  });
});
