// The Reports "forecast" block (§502 part 4): on the board and the shelf only while the simulation is active,
// exactly as the Dashboard's Forecast tile. The section's own behaviour is `forecast-report-section.test.tsx`'s;
// here its input is null (the holiday-calendar placeholder), so no engine runs.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPanel } from "./reports";
import type { ForecastReportProps } from "./forecast-report-section";
import { t } from "./i18n";
import type { Task } from "./types";

const TODAY = "2026-05-28";
const TASKS = [{ id: 1, taskName: "T1", assignee: "Ann", assigneeEmail: "", status: "To Do", group: "", labels: [], dependencies: [] } as unknown as Task];
const FORECAST: ForecastReportProps = {
  input: null, scenarios: [], history: [], currency: "EUR", readOnly: false,
  settings: { target: 80, proposalId: null, setTarget: vi.fn(), setProposal: vi.fn() },
};
const TITLE = t("en-US", "dashboardForecast");

function Panel({ simulationActive }: { simulationActive: boolean }) {
  return <ReportsPanel tasks={TASKS} lang="en-US" today={TODAY} holidaySet={new Set()} projectId="p-forecast" simulationActive={simulationActive} forecast={FORECAST} />;
}

describe("ReportsPanel — the Forecast block", () => {
  it("is on the board while the simulation is active", () => {
    render(<Panel simulationActive />);
    expect(screen.getByTestId("report-block-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-report-section")).toBeInTheDocument();
  });

  it("is absent from the board while the simulation is off, whatever props it is given", () => {
    render(<Panel simulationActive={false} />);
    expect(screen.queryByTestId("report-block-forecast")).toBeNull();
    expect(screen.queryByTestId("forecast-report-section")).toBeNull();
    // Positive control: the board itself rendered.
    expect(screen.getByTestId("report-block-byPriority")).toBeInTheDocument();
  });

  it("is not offered on the shelf while the simulation is off, and comes back when it is on", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Panel simulationActive />);
    await user.click(screen.getByRole("button", { name: `${t("en-US", "actionMoreActions")} – ${TITLE}` }));
    await user.click(screen.getByRole("button", { name: t("en-US", "arrangementTileHide") }));
    const restore = { name: `${t("en-US", "arrangementTileRestore")} – ${TITLE}` };
    await user.click(screen.getByRole("button", { name: /hidden/i }));
    expect(screen.getByRole("button", restore)).toBeInTheDocument();

    rerender(<Panel simulationActive={false} />);
    expect(screen.queryByRole("button", restore)).toBeNull();
    rerender(<Panel simulationActive />);
    expect(screen.getByRole("button", restore)).toBeInTheDocument();
  });
});
