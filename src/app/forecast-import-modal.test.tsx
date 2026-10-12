// §500 — the forecast import modal: source → preview → apply over the hook
// (`use-forecast-import.test.ts` pins the state machine). This pins what the
// user SEES and can operate: row-unique pickers, a blocker that disables
// Apply, the partial-period warning, the AI-off reason, and one commit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { defaultSettings, type Settings } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { ForecastImportModal, type ForecastImportModalProps } from "./forecast-import-modal";

vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));
import { useSettings } from "./use-settings";
const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

const AI_ON: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: true, apiKey: "sk-ant-test", model: "claude-x" } };
const AI_OFF: Settings = { ...defaultSettings, ai: { ...defaultSettings.ai, enabled: false, apiKey: "" } };

function stubSettings(settings: Settings): void {
  mockUseSettings.mockReturnValue({ settings, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" });
}

const L = "en-US" as const;
const ROLE: Role = { id: 10, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 };
const ANN: Resource = { id: 1, firstName: "Ann", lastName: "Lee", roleId: ROLE.id, utilizationMode: "percent", utilization: {} };
const PLAN: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const BUCKET: BudgetBucket = {
  id: 1, name: "Build", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-03-31",
  status: "open", allocations: [],
};

function propsOf(over: Partial<ForecastImportModalProps> = {}): ForecastImportModalProps {
  return {
    lang: L,
    open: true,
    onClose: vi.fn(),
    bucket: BUCKET,
    buckets: [BUCKET],
    resources: [ANN],
    roles: [ROLE],
    disciplines: [{ id: 1, name: "Engineering" }],
    grades: [{ id: 1, name: "Senior" }],
    plan: PLAN,
    holidaySet: new Set<string>(),
    onChangeBuckets: vi.fn(),
    ...over,
  };
}

async function chooseFile(text: string, name = "forecast.csv"): Promise<void> {
  const input = screen.getByLabelText(t(L, "forecastImportFile"));
  fireEvent.change(input, { target: { files: [new File([text], name, { type: "text/csv" })] } });
  // The hand-route preview always offers "Edit columns"; the "Changes" heading
  // only renders when something would change.
  await screen.findByRole("button", { name: t(L, "forecastImportEditColumns") });
}

const WIDE = "Name,Jan 2026,Feb 2026,Mar 2026\r\n";

beforeEach(() => stubSettings(AI_ON));
afterEach(() => vi.restoreAllMocks());

describe("ForecastImportModal", () => {
  it("renders nothing while closed", () => {
    render(<ForecastImportModal {...propsOf({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the file picker for spreadsheets only", () => {
    render(<ForecastImportModal {...propsOf()} />);
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".xlsx,.xlsm,.csv");
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeDisabled();
  });

  it("gives each unresolved person a picker with a distinct accessible name", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    // Two sheet people sharing a name prefix, neither a resource.
    await chooseFile(`${WIDE}Dan,1,1,1\r\nDan Brown,2,2,2\r\n`);
    const section = screen.getByRole("region", { name: t(L, "forecastImportUnresolved") });
    const pickers = within(section).getAllByRole("combobox");
    expect(pickers).toHaveLength(2);
    // ★ No collision seed is possible here: the plan keys unresolved people by
    // `normalisePerson`, which folds everything `buildRowTokens` folds, so two
    // rows a screen reader would hear alike are one unresolved entry already.
    expectRowUniqueNames({ minControls: 2, scope: section, roles: ["combobox"] });
    const names = pickers.map((p) => p.getAttribute("aria-label"));
    expect(names).toEqual([
      `${t(L, "forecastImportMatchPerson")} – Dan`,
      `${t(L, "forecastImportMatchPerson")} – Dan Brown`,
    ]);
    // Skip is the default and the resource is offered.
    expect(pickers[0]).toHaveValue("skip");
    expect(within(pickers[0]).getByRole("option", { name: "Ann Lee" })).toBeInTheDocument();
  });

  it("picking a resource for an unmatched person adds their hours to the preview", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Annie,4,4,4\r\n`);
    expect(screen.getByText(t(L, "forecastImportBlockerNothing"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t(L, "forecastImportChanges") })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: `${t(L, "forecastImportMatchPerson")} – Annie` }), {
      target: { value: String(ANN.id) },
    });
    expect(screen.queryByText(t(L, "forecastImportBlockerNothing"))).toBeNull();
    expect(screen.getByRole("heading", { name: t(L, "forecastImportChanges") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeEnabled();
  });

  it("explains a bucket removed while the preview is open, and Apply stays disabled", async () => {
    const props = propsOf();
    const { rerender } = render(<ForecastImportModal {...props} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    const apply = screen.getByRole("button", { name: t(L, "forecastImportApply") });
    expect(apply).toBeEnabled();
    rerender(<ForecastImportModal {...props} buckets={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(t(L, "forecastImportBucketGone"));
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(0);
  });

  it("a bucket closed after opening shows its blocker, and Apply writes nothing", async () => {
    const props = propsOf();
    const { rerender } = render(<ForecastImportModal {...props} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    rerender(<ForecastImportModal {...props} buckets={[{ ...BUCKET, status: "closed" }]} />);
    expect(screen.getByText(t(L, "forecastImportBlockerClosed"))).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: t(L, "forecastImportApply") });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(0);
    expect(props.onClose).toHaveBeenCalledTimes(0);
  });

  it("a blocker notice disables Apply", async () => {
    render(<ForecastImportModal {...propsOf({ plan: { ...PLAN, budgetFollowsPlan: true } })} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    expect(screen.getByText(t(L, "forecastImportBlockerFollowsPlan"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeDisabled();
  });

  it("shows the diff old → new and the total delta, then applies once and closes", async () => {
    const props = propsOf({
      buckets: [{ ...BUCKET, allocations: [{ roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 4 }, actualHours: {} }] }],
    });
    render(<ForecastImportModal {...props} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    const diff = screen.getByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getByText("Engineering Senior")).toBeInTheDocument();
    expect(within(diff).getByText("4 → 10")).toBeInTheDocument();
    expect(within(diff).getByText("— → 20")).toBeInTheDocument();
    expect(screen.getByText(t(L, "forecastImportTotalDelta", "+56"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportApply") }));
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("warns on a cell the sheet covers only partly", async () => {
    // A month sheet into a weekly plan: 2026-W01 starts on Mon 29 Dec 2025, so
    // the sheet's January covers only part of it.
    render(<ForecastImportModal {...propsOf({ plan: { ...PLAN, granularity: "week" } })} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    const diff = screen.getByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getAllByText(t(L, "forecastImportPartial")).length).toBeGreaterThan(0);
  });

  it("lists rejected and dropped rows with their reasons", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,x,30\r\nTotal,10,0,30\r\nAnn Lee,800,5,5\r\n`);
    expect(screen.getByText(t(L, "forecastImportRowRef", "3", t(L, "forecastImportDropTotal")))).toBeInTheDocument();
    expect(screen.getByText(t(L, "forecastImportRowRef", "2", t(L, "forecastImportDropBadNumber")))).toBeInTheDocument();
    // The 744 cap comes from MAX_IMPORT_HOURS_PER_CELL, interpolated: the
    // string carries a placeholder, not the number.
    expect(t(L, "forecastImportRejectHours", "999")).toContain("999");
    expect(screen.getByText(/forecast!B4/)).toHaveTextContent(t(L, "forecastImportRejectHours", "744"));
  });

  it("says why Claude's row was not imported: the person is not on the cited row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          name: "propose_forecast_rows",
          input: { rows: [{ person: "Bob Ray", period: "Jan 2026", hours: 10, source: "forecast!B2" }] },
        }],
      }),
    } as unknown as Response);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(/forecast!B2/)).toHaveTextContent(t(L, "forecastImportRejectSourcePerson"));
  });

  it("disables Ask Claude with a reason when AI is off", async () => {
    stubSettings(AI_OFF);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    const ask = screen.getByRole("button", { name: t(L, "forecastImportAskClaude") });
    expect(ask).toBeDisabled();
    expect(screen.getByText(t(L, "forecastImportAiOff"))).toBeInTheDocument();
    // The reason is tied to the control, not just placed beside it.
    expect(ask).toHaveAccessibleDescription(t(L, "forecastImportAiOff"));
  });

  it("names a file it cannot read in the source step", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    fireEvent.change(input, { target: { files: [new File(["x"], "old.xls")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t(L, "forecastImportErrorUnsupported")));
  });

  it("opens the mapping step when no layout is found, and its columns can be set", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    // 60 rows: the header-row choice reaches past the first 10, capped at 50.
    const text = Array.from({ length: 60 }, () => "just,some").join("\r\n");
    fireEvent.change(input, { target: { files: [new File([text], "f.csv")] } });
    await screen.findByText(t(L, "forecastImportNoLayout"));
    expect(screen.getByRole("radiogroup", { name: t(L, "forecastImportLayout") })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t(L, "forecastImportColPerson") })).toBeInTheDocument();
    expect(within(screen.getByRole("combobox", { name: t(L, "forecastImportHeaderRow") })).getAllByRole("option")).toHaveLength(50);
  });

  it("the mapping sample reads what the selects show from the start", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    fireEvent.change(input, { target: { files: [new File(["Name,Jan 2026,Notes\r\nAnn Lee,5,x\r\n"], "f.csv")] } });
    await screen.findByText(t(L, "forecastImportNoLayout"));
    expect(screen.getByRole("combobox", { name: t(L, "forecastImportColPerson") })).toHaveValue("0");
    expect(screen.getByText("Ann Lee · 2026-01 · 5 h (f!B2)")).toBeInTheDocument();
    expect(screen.queryByText(t(L, "forecastImportSampleEmpty"))).toBeNull();
  });

  it("sets the year for headers without one, defaulting to the bucket's start year", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile("Name,Jan,Feb,Mar\r\nAnn Lee,1,2,3\r\n");
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportEditColumns") }));
    const year = screen.getByRole("spinbutton", { name: t(L, "forecastImportYear") });
    expect(year).toHaveValue(2026);
    expect(screen.getByText("Ann Lee · 2026-01 · 1 h (forecast!B2)")).toBeInTheDocument();
    fireEvent.change(year, { target: { value: "2027" } });
    expect(screen.getByText("Ann Lee · 2027-01 · 1 h (forecast!B2)")).toBeInTheDocument();
  });

  it("lists a numeric column whose header is not a period under Not imported", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile("Name,Jan 2026,Foo,Feb 2026,Mar 2026\r\nAnn Lee,1,2,3,4\r\n");
    const section = screen.getByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(t(L, "forecastImportIgnoredColumn", "C", "Foo"))).toBeInTheDocument();
  });
});
