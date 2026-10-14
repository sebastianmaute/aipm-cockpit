// §500 — the forecast import modal: source → preview → apply over the hook
// (`use-forecast-import.test.ts` pins the state machine). This pins what the
// user SEES and can operate: row-unique pickers, a blocker that disables
// Apply, the partial-period warning, the AI-off reason, and one commit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultSettings, type Settings } from "./settings-types";
import type { BudgetBucket, Resource, ResourcePlan, Role } from "./types";
import { t, tPlural } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { ForecastImportModal, type ForecastImportModalProps } from "./forecast-import-modal";
import { buildZip } from "./zip";

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
    // Ann is already on the line: no membership change to show.
    expect(screen.queryByRole("region", { name: t(L, "forecastImportMembership") })).toBeNull();
  });

  it("shows a new line and the people joining it as changes", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    const section = screen.getByRole("region", { name: t(L, "forecastImportMembership") });
    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      t(L, "forecastImportNewAllocation", "Engineering Senior"),
      t(L, "forecastImportAddResources", "Engineering Senior", "Ann Lee"),
    ]);
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

  // Claude sets the mapping (owner decision 2026-10-13): its mapping opens the
  // mapping step with its notes, and Apply waits for the press on any layout.
  it("opens Claude's mapping on the mapping step with its notes; Apply waits for the press, not for an edit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: "tool_use",
        content: [{
          type: "tool_use",
          name: "propose_forecast_mapping",
          input: { layout: "wide", headerRow: 1, person: "A", periodCols: ["B", "C"], notes: "Mar is a total." },
        }],
      }),
    } as unknown as Response);
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    expect(await screen.findByText(t(L, "forecastImportClaudeProposed", "Mar is a total"))).toBeInTheDocument();
    expect(screen.getByText(t(L, "forecastImportPeriodColsFound", "B: Jan 2026, C: Feb 2026"))).toBeInTheDocument();
    const apply = () => screen.getByRole("button", { name: t(L, "forecastImportApply") });
    expect(apply()).toBeDisabled();
    expect(apply()).toHaveAccessibleDescription(t(L, "forecastImportConfirmClaudeFirst"));
    // An edit is no press.
    fireEvent.change(screen.getByLabelText(t(L, "forecastImportYear")), { target: { value: "2027" } });
    expect(screen.getByLabelText(t(L, "forecastImportYear"))).toHaveValue(2027);
    expect(screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(apply()).toBeDisabled();
    fireEvent.click(apply());
    expect(props.onChangeBuckets).not.toHaveBeenCalled();
    // The press, on the mapping step, enables Apply.
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportEditColumns") }));
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") }));
    expect(screen.queryByText(t(L, "forecastImportClaudeProposed", "Mar is a total"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(apply()).toBeEnabled();
    fireEvent.click(apply());
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(1);
  });

  it("shows a mapping it cannot use as an error and keeps the hand route", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "propose_forecast_mapping", input: { layout: "wide", headerRow: 1, person: "A", periodCols: ["Q"] } }],
      }),
    } as unknown as Response);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    expect(await screen.findByText(t(L, "forecastImportErrorBadMapping"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportDetect") }));
    expect(screen.queryByText(t(L, "forecastImportErrorBadMapping"))).toBeNull();
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

  it("offers the first 200 columns, plus a chosen column past them, and says so", async () => {
    // A long sheet whose hours column is the 231st.
    const header = ["Name", "Month", ...Array.from({ length: 228 }, () => ""), "Hours"].join(",");
    const row = ["Ann Lee", "2026-01", ...Array.from({ length: 228 }, () => ""), "5"].join(",");
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${header}\r\n${row}\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportEditColumns") }));
    const hours = screen.getByRole("combobox", { name: t(L, "forecastImportColHours") });
    expect(hours).toHaveValue("230");
    expect(within(hours).getAllByRole("option")).toHaveLength(201);
    expect(within(screen.getByRole("combobox", { name: t(L, "forecastImportColPerson") })).getAllByRole("option")).toHaveLength(201);
    expect(screen.getByText(t(L, "forecastImportColumnsCapped", "200"))).toBeInTheDocument();
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

describe("ForecastImportModal — the long layout's year column", () => {
  it("offers a Year column select that the long sheet's year is read from", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile("Name,Jahr,Monat,Stunden\r\nAnn Lee,2027,Jan,8\r\n");
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportEditColumns") }));
    const yearCol = screen.getByRole("combobox", { name: t(L, "forecastImportColYear") });
    expect(yearCol).toHaveValue("1");
    expect(screen.getByText("Ann Lee · 2027-01 · 8 h (forecast!D2)")).toBeInTheDocument();
    fireEvent.change(yearCol, { target: { value: "" } });
    expect(screen.getByText("Ann Lee · 2026-01 · 8 h (forecast!D2)")).toBeInTheDocument();
  });
});

// §500 fix wave 2 (CR C1): summed rows are not "not imported", and a same-row
// collision blocks Apply with the cells named and a way back to the mapping.
describe("ForecastImportModal — combined rows and same-row collisions", () => {
  it("lists rows summed from different sheet rows under Combined rows, not Not imported", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\nAnn Lee,1,2,3\r\n`);
    const combined = screen.getByRole("region", { name: t(L, "forecastImportCombined") });
    expect(within(combined).getByText(new RegExp(t(L, "forecastImportDuplicate", "Ann Lee", "2026-01", "2")))).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t(L, "forecastImportNotImported") })).toBeNull();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeEnabled();
  });

  it("blocks Apply on two cells of one row in the same period, names the cells and offers the mapping", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile("Name,Jan 2026,Jan 2026,Feb 2026\r\nAnn Lee,10,20,5\r\n");
    expect(screen.getByText(t(L, "forecastImportBlockerSameRow"))).toBeInTheDocument();
    const section = screen.getByRole("region", { name: t(L, "forecastImportCollisions") });
    expect(within(section).getByText(t(L, "forecastImportCollision", "Ann Lee", "2026-01", "forecast!B2, forecast!C2"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeDisabled();
    fireEvent.click(within(section).getByRole("button", { name: t(L, "forecastImportChangeMapping") }));
    expect(screen.getByRole("combobox", { name: t(L, "forecastImportColPerson") })).toBeInTheDocument();
  });
});

// §500 fix wave 2 (CR I2): a detected layout goes straight to the preview, so
// the preview says which year headers without one were read in.
describe("ForecastImportModal — the assumed year", () => {
  it("says headers without a year were read in the bucket's start year, with a way to the year field", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile("Name,Jan,Feb,Mar\r\nAnn Lee,1,2,3\r\n");
    expect(screen.getByText(t(L, "forecastImportAssumedYear", "2026"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportChangeYear") }));
    expect(screen.getByRole("spinbutton", { name: t(L, "forecastImportYear") })).toHaveValue(2026);
  });

  it("says from which year when the headers ran into the next one", async () => {
    render(<ForecastImportModal {...propsOf({ bucket: { ...BUCKET, endDate: "2027-12-31" }, buckets: [{ ...BUCKET, endDate: "2027-12-31" }] })} />);
    await chooseFile("Name,Nov,Dez,Jan\r\nAnn Lee,1,2,3\r\n");
    expect(screen.getByText(t(L, "forecastImportAssumedYearFrom", "2026"))).toBeInTheDocument();
  });

  it("says nothing when every header names its year", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,1,2,3\r\n`);
    expect(screen.queryByRole("button", { name: t(L, "forecastImportChangeYear") })).toBeNull();
  });
});

describe("ForecastImportModal — archived resources", () => {
  it("does not offer an archived resource in the person picker", async () => {
    const archived: Resource = { ...ANN, id: 3, firstName: "Old", lastName: "Timer", active: false };
    render(<ForecastImportModal {...propsOf({ resources: [ANN, archived] })} />);
    await chooseFile(`${WIDE}Zed,1,1,1\r\n`);
    const picker = screen.getByRole("combobox", { name: `${t(L, "forecastImportMatchPerson")} – Zed` });
    expect(within(picker).getByRole("option", { name: "Ann Lee" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Old Timer" })).toBeNull();
  });
});

describe("ForecastImportModal — a line shared with people not in the sheet", () => {
  it("notes that a changed cell also covers them", async () => {
    const BOB: Resource = { ...ANN, id: 2, firstName: "Bob", lastName: "Ray" };
    const shared: BudgetBucket = { ...BUCKET, allocations: [{ roleId: ROLE.id, resourceIds: [ANN.id, BOB.id], budgetHours: {}, actualHours: {} }] };
    render(<ForecastImportModal {...propsOf({ resources: [ANN, BOB], bucket: shared, buckets: [shared] })} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    const diff = screen.getByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getAllByText(t(L, "forecastImportOthersOnLine", "Bob Ray"))).toHaveLength(3);
  });
});

describe("ForecastImportModal — date columns finer than the period (round 3)", () => {
  it("sums sprint-date columns into their month and says so, with Apply enabled", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile("Name,05.01.2026,19.01.2026,02.02.2026,16.02.2026\r\nAnn Lee,40,40,40,40\r\n");
    const combined = screen.getByRole("region", { name: t(L, "forecastImportCombined") });
    expect(within(combined).getByText(new RegExp(t(L, "forecastImportSubPeriod", "Ann Lee", "2026-01", "2")))).toBeInTheDocument();
    expect(screen.queryByText(t(L, "forecastImportBlockerSameRow"))).toBeNull();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeEnabled();
  });
});

describe("ForecastImportModal — rows above the header row (round 3)", () => {
  it("says how many rows above the header row were not read", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    // Round 5: the repeated header row asks first; confirmed, the preview says so.
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    fireEvent.change(input, { target: { files: [new File([["Name,Jan 2026,Feb 2026,Mar 2026", "Ann Lee,10,20,30", "", "Name,Jan 2027,Feb 2027,Mar 2027", "Ann Lee,40,50,60", ""].join("\r\n")], "forecast.csv", { type: "text/csv" })] } });
    fireEvent.click(await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") }));
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(t(L, "forecastImportRowsAboveHeaderOne", 1))).toBeInTheDocument();
  });
});

// Fix 7 (owner decision 2026-10-13): an ambiguous sheet opens on the mapping
// step with a notice per field, and Apply stays disabled, saying why, until the
// columns are confirmed.
describe("ForecastImportModal — ambiguous columns (fix 7)", () => {
  const PLAN_IST = "Name,Monat,Plan,Ist\r\nAnn Lee,Jan 2026,40,35\r\nAnn Lee,Feb 2026,30,25\r\n";
  const applyButton = () => screen.getByRole("button", { name: t(L, "forecastImportApply") });

  async function chooseAmbiguous(text: string): Promise<void> {
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    fireEvent.change(input, { target: { files: [new File([text], "forecast.csv", { type: "text/csv" })] } });
    await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") });
  }

  it("names the hours candidates by header and keeps Apply disabled with the reason", async () => {
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    await chooseAmbiguous(PLAN_IST);
    expect(screen.getByText(t(L, "forecastImportAmbiguousHours", "C: Plan, D: Ist"))).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t(L, "forecastImportColHours") })).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveAccessibleDescription(t(L, "forecastImportConfirmFirst"));
    fireEvent.click(applyButton());
    expect(props.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("the confirm button is keyboard operable and enables Apply", async () => {
    const user = userEvent.setup();
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    await chooseAmbiguous(PLAN_IST);
    const confirm = screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHours", "C: Plan, D: Ist"))).toBeNull();
    expect(screen.queryByRole("button", { name: t(L, "forecastImportConfirmColumns") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(applyButton()).toBeEnabled();
    expect(applyButton()).not.toHaveAccessibleDescription(t(L, "forecastImportConfirmFirst"));
    fireEvent.click(applyButton());
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(1);
  });

  it("choosing the hours column confirms it, and the preview shows that column's hours", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous(PLAN_IST);
    fireEvent.change(screen.getByRole("combobox", { name: t(L, "forecastImportColHours") }), { target: { value: "3" } });
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHours", "C: Plan, D: Ist"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    const diff = await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getByText("— → 35")).toBeInTheDocument();
    expect(applyButton()).toBeEnabled();
  });

  // rr7 I2: the layout control's Wide → Long round-trip once cleared the
  // notice and enabled Apply on the questioned preselection.
  it("keeps the notice and the disabled Apply through a Wide → Long round-trip", async () => {
    const user = userEvent.setup();
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    await chooseAmbiguous(PLAN_IST);
    await user.click(screen.getByRole("radio", { name: t(L, "forecastImportLayoutWide") }));
    await user.click(screen.getByRole("radio", { name: t(L, "forecastImportLayoutLong") }));
    expect(screen.getByText(t(L, "forecastImportAmbiguousHours", "C: Plan, D: Ist"))).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: t(L, "forecastImportColHours") })).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(props.onChangeBuckets).not.toHaveBeenCalled();
  });

  it("names the period candidates of Name | Datum | Eintritt", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous("Name,Datum,Eintritt,Stunden\r\nAnn Lee,01.01.2026,03/2026,40\r\nAnn Lee,01.02.2026,03/2026,30\r\n");
    expect(screen.getByText(t(L, "forecastImportAmbiguousPeriod", "B: Datum, C: Eintritt"))).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveAccessibleDescription(t(L, "forecastImportConfirmFirst"));
  });

  // Round 2: a wide sheet whose rows hold their own period column (a Start date)
  // asks for the period; the Wide notice and the confirm button carry it.
  it("asks about a wide sheet with a Start date column, and confirming it enables Apply", async () => {
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    await chooseAmbiguous("Name,Start,Jan 2026,Feb 2026\r\nAnn Lee,01.03.2026,40,50\r\n");
    expect(screen.getByRole("radio", { name: t(L, "forecastImportLayoutWide") })).toBeChecked();
    // Round 7: the Wide notice names the candidate columns by header.
    expect(t(L, "forecastImportAmbiguousWide", "B: Start, C: Jan 2026, D: Feb 2026")).toContain("B: Start, C: Jan 2026, D: Feb 2026");
    expect(screen.getByText(t(L, "forecastImportAmbiguousWide", "B: Start, C: Jan 2026, D: Feb 2026"))).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveAccessibleDescription(t(L, "forecastImportConfirmFirst"));
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") }));
    expect(screen.queryByText(t(L, "forecastImportAmbiguousWide", "B: Start, C: Jan 2026, D: Feb 2026"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    const diff = await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getByText("— → 40")).toBeInTheDocument();
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(1);
  });

  // Fix 9 OOS-c: the notice names the candidate header rows; the header-row select clears it.
  it("names the candidate header rows of stacked blocks, and choosing one clears the notice", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous("Name,Monat,Forecast\r\nAnn Lee,Jan 2026,40\r\nBob Kay,Feb 2026,30\r\nName,Monat,Ist\r\nAnn Lee,Jan 2026,35\r\nBob Kay,Feb 2026,25\r\n");
    expect(screen.getByText(t(L, "forecastImportAmbiguousHeader", "1, 4"))).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: t(L, "forecastImportHeaderRow") }), { target: { value: "0" } });
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHeader", "1, 4"))).toBeNull();
  });

  it("names the candidate header rows in the Wide layout too, beside nothing else", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous("Name,Jan 2026,Feb 2026\r\nAnn Lee,10,20\r\nBob Kay,11,21\r\nName,Jan 2027,Feb 2027\r\nAnn Lee,30,40\r\nBob Kay,31,41\r\n");
    expect(screen.getByText(t(L, "forecastImportAmbiguousHeader", "1, 4"))).toBeInTheDocument();
    const widePrefix = t(L, "forecastImportAmbiguousWide", "\u0000").split("\u0000")[0];
    expect(screen.queryByText((text) => text.startsWith(widePrefix))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") }));
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHeader", "1, 4"))).toBeNull();
  });

  // Round 5: header row 1 of stacked blocks reads its own block; the preview
  // says how many rows below the repeated header row were not read.
  it("lists the rows below a repeated header row as not read", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous("Name,Monat,Forecast\r\nAnn Lee,Jan 2026,40\r\nBob Kay,Feb 2026,30\r\nName,Monat,Ist\r\nAnn Lee,Jan 2026,35\r\nBob Kay,Feb 2026,25\r\n");
    fireEvent.change(screen.getByRole("combobox", { name: t(L, "forecastImportHeaderRow") }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(t(L, "forecastImportRowsBelowRepeatedHeader", 2))).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: t(L, "forecastImportChanges") })).getByText("— → 40")).toBeInTheDocument();
  });

  // rr8 m2: the Wide layout has no hours select to choose from.
  it("asks to check the mapping, not to choose a column, in the Wide layout", async () => {
    const user = userEvent.setup();
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous(PLAN_IST);
    await user.click(screen.getByRole("radio", { name: t(L, "forecastImportLayoutWide") }));
    expect(screen.getByText(t(L, "forecastImportAmbiguousWide", "C: Plan, D: Ist"))).toBeInTheDocument();
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHours", "C: Plan, D: Ist"))).toBeNull();
    expect(screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: t(L, "forecastImportLayoutLong") }));
    expect(screen.queryByText(t(L, "forecastImportAmbiguousWide", "C: Plan, D: Ist"))).toBeNull();
    expect(screen.getByText(t(L, "forecastImportAmbiguousHours", "C: Plan, D: Ist"))).toBeInTheDocument();
  });
});


// Round 9 I-W: one person's rows that differ in a text column are named, with
// sample values, in either layout; only the confirm button accepts the sum.
describe("ForecastImportModal — one person, rows that differ in a text column (round 9 I-W)", () => {
  const applyButton = () => screen.getByRole("button", { name: t(L, "forecastImportApply") });
  it.each([
    ["Wide", "Name,Art,Jan 2026,Feb 2026\r\nAnn Lee,Plan,50,40\r\nAnn Lee,Ist,43,30\r\n", "B: Art"],
    ["Long", "Name,Typ,Monat,Stunden\r\nAnn Lee,Plan,Jan 2026,50\r\nAnn Lee,Ist,Jan 2026,43\r\n", "B: Typ"],
  ])("%s: names the column and its values, Apply waits, confirming shows the sum", async (_layout, csv, column) => {
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    fireEvent.change(input, { target: { files: [new File([csv], "forecast.csv", { type: "text/csv" })] } });
    await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") });
    const notice = t(L, "forecastImportAmbiguousRows", column, "Plan, Ist");
    expect(notice).toContain(`${column} (Plan, Ist)`);
    expect(screen.getByText(notice)).toBeInTheDocument();
    const widePrefix = t(L, "forecastImportAmbiguousWide", "\u0000").split("\u0000")[0];
    expect(screen.queryByText((text) => text.startsWith(widePrefix))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(applyButton()).toBeDisabled();
    fireEvent.click(applyButton());
    expect(props.onChangeBuckets).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportEditColumns") }));
    fireEvent.click(await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") }));
    expect(screen.queryByText(notice)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    const diff = await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getByText("— → 93")).toBeInTheDocument();
    expect(applyButton()).toBeEnabled();
    fireEvent.click(applyButton());
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(1);
  });
});

// Final review 2 (M1, M2): a Plan/Ist sheet repeats its month headers over a
// sub-header row. Claude's choice of one block is named by column letter and
// asked about, the other block says why it is not read, and an unrelated edit
// keeps Claude's period columns.
describe("ForecastImportModal — Claude's choice of one block of a Plan/Ist sheet (final review 2)", () => {
  const PLAN_IST = "Name;E-Mail;Satz;Jan 2026;Feb 2026;Jan 2026;Feb 2026\r\n;;;Plan;Plan;Ist;Ist\r\nAnn Lee;ann@x.de;90;10;20;9;18\r\n";
  const claudeMaps = (input: Record<string, unknown>) => vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "propose_forecast_mapping", input }] }),
  } as unknown as Response);
  async function askOn(csv: string) {
    render(<ForecastImportModal {...propsOf()} />);
    // Waits for the trigger, not the preview: this sheet may open on the mapping step.
    fireEvent.change(screen.getByLabelText(t(L, "forecastImportFile")), { target: { files: [new File([csv], "forecast.csv", { type: "text/csv" })] } });
    fireEvent.click(await screen.findByRole("button", { name: t(L, "forecastImportAskClaude") }));
    await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") });
  }
  const select = (key: Parameters<typeof t>[1]) => screen.getByRole("combobox", { name: t(L, key) });

  it("names the period columns by letter and asks about the left-out block", async () => {
    claudeMaps({ layout: "wide", headerRow: 1, person: "A", periodCols: ["F", "G"] });
    await askOn(PLAN_IST);
    expect(screen.getByText(t(L, "forecastImportPeriodColsFound", "F: Jan 2026, G: Feb 2026"))).toBeInTheDocument();
    expect(screen.getByText(t(L, "forecastImportAmbiguousWide", "D: Jan 2026, E: Feb 2026, F: Jan 2026, G: Feb 2026"))).toBeInTheDocument();
  });

  it("says a left-out period-headed column is left out by the mapping, never that its header is no period", async () => {
    claudeMaps({ layout: "wide", headerRow: 1, person: "A", periodCols: ["F", "G"] });
    await askOn(PLAN_IST);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(t(L, "forecastImportIgnoredPeriodColumn", "D", "Jan 2026"))).toBeInTheDocument();
    expect(within(section).queryByText(t(L, "forecastImportIgnoredColumn", "D", "Jan 2026"))).toBeNull();
  });

  it("keeps Claude's period columns through an email or rate edit; a layout change rebuilds them", async () => {
    claudeMaps({ layout: "wide", headerRow: 1, person: "A", periodCols: ["D", "E"] });
    await askOn(PLAN_IST);
    const found = (labels: string) => screen.getByText(t(L, "forecastImportPeriodColsFound", labels));
    expect(found("D: Jan 2026, E: Feb 2026")).toBeInTheDocument();
    fireEvent.change(select("forecastImportColEmail"), { target: { value: "1" } });
    expect(found("D: Jan 2026, E: Feb 2026")).toBeInTheDocument();
    fireEvent.change(select("forecastImportColRate"), { target: { value: "2" } });
    expect(found("D: Jan 2026, E: Feb 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: t(L, "forecastImportLayoutLong") }));
    fireEvent.click(screen.getByRole("radio", { name: t(L, "forecastImportLayoutWide") }));
    expect(found("D: Jan 2026, E: Feb 2026, F: Jan 2026, G: Feb 2026")).toBeInTheDocument();
  });
});

// Final review 3: "These columns are right" unmounted itself on press and the
// focus fell to the document (M5); the new questions name their rows (I2).
describe("ForecastImportModal — the confirmation's focus and the merged-person notice (final review 3)", () => {
  const PLAN_IST = "Name,Monat,Plan,Ist\r\nAnn Lee,Jan 2026,40,35\r\nAnn Lee,Feb 2026,30,25\r\n";
  const confirmButton = () => screen.getByRole("button", { name: t(L, "forecastImportConfirmColumns") });

  async function choose(text: string): Promise<void> {
    const input = screen.getByLabelText(t(L, "forecastImportFile"));
    fireEvent.change(input, { target: { files: [new File([text], "forecast.csv", { type: "text/csv" })] } });
    await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") });
  }

  it("moves the focus to Show preview once the press removes the notice, by click and by keyboard", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ForecastImportModal {...propsOf()} />);
    await choose(PLAN_IST);
    await user.click(confirmButton());
    expect(screen.queryByRole("button", { name: t(L, "forecastImportConfirmColumns") })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    unmount();
    render(<ForecastImportModal {...propsOf()} />);
    await choose(PLAN_IST);
    confirmButton().focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
  });

  it("names the rows with no person and their text, and keeps Apply waiting", async () => {
    const rows = ["Name;Art;Jan 2026;Feb 2026;Mär 2026", "Ann Lee;Ist;10;20;30", ";Plan;100;110;120", "Bob Ray;Ist;1;2;3", ";Plan;4;5;6"];
    render(<ForecastImportModal {...propsOf()} />);
    await choose(`${rows.join("\r\n")}\r\n`);
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousContinuation", 2, "3, 5", "Ist, Plan"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportShowPreview") }));
    await screen.findByRole("region", { name: t(L, "forecastImportChanges") });
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeDisabled();
  });

  it("an unlabelled total row reads the plain notice", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await choose("Name;Jan 2026;Feb 2026;Mar 2026\r\nAnn Lee;10;20;30\r\n;10;20;30\r\n");
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousContinuationPlain", 1, "3"))).toBeInTheDocument();
  });
});

describe("ForecastImportModal — two detectable sheets (final review 3, M1)", () => {
  it("names both sheets, keeps Apply waiting, and choosing a sheet in the Sheet select confirms it", async () => {
    const str = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
    const sheetXml = (h: string) => `<worksheet><sheetData><row r="1">${str("A1", "Name")}${str("B1", "Jan 2026")}${str("C1", "Feb 2026")}${str("D1", "Mar 2026")}</row>`
      + `<row r="2">${str("A2", "Ann Lee")}<c r="B2"><v>${h}</v></c><c r="C2"><v>${h}</v></c><c r="D2"><v>${h}</v></c></row></sheetData></worksheet>`;
    const blob = buildZip([
      { path: "xl/workbook.xml", data: `<workbook><sheets><sheet name="Ist" sheetId="1" r:id="rId1"/><sheet name="Forecast" sheetId="2" r:id="rId2"/></sheets></workbook>` },
      { path: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>` },
      { path: "xl/worksheets/sheet1.xml", data: sheetXml("9") },
      { path: "xl/worksheets/sheet2.xml", data: sheetXml("12") },
    ]);
    const props = propsOf();
    render(<ForecastImportModal {...props} />);
    fireEvent.change(screen.getByLabelText(t(L, "forecastImportFile")), { target: { files: [new File([await blob.arrayBuffer()], "forecast.xlsx")] } });
    expect(await screen.findByText(t(L, "forecastImportAmbiguousSheet", "Ist, Forecast"))).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: t(L, "forecastImportSheet") }), { target: { value: "1" } });
    const apply = await screen.findByRole("button", { name: t(L, "forecastImportApply") });
    await waitFor(() => expect(apply).toBeEnabled());
    expect(screen.queryByText(t(L, "forecastImportAmbiguousSheet", "Ist, Forecast"))).toBeNull();
    fireEvent.click(apply);
    expect(props.onChangeBuckets).toHaveBeenCalledTimes(1);
  });
});

describe("ForecastImportModal — a person on two lines of the bucket (final review 3, M3)", () => {
  it("lists them as not matched with a reason of its own, and writes nothing for them", async () => {
    const SENIOR: Role = { ...ROLE, id: 11 };
    const twoLines: BudgetBucket = {
      ...BUCKET,
      allocations: [
        { roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: {}, actualHours: {} },
        { roleId: SENIOR.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 100 }, actualHours: {} },
      ],
    };
    render(<ForecastImportModal {...propsOf({ roles: [ROLE, SENIOR], bucket: twoLines, buckets: [twoLines] })} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    expect(screen.getByText(t(L, "forecastImportWhySeveralLines"))).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t(L, "forecastImportChanges") })).toBeNull();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeDisabled();
  });

  // Final review 4, M1: a pick for an unmatched person that lands on a resource
  // on several lines stays unresolved; the row once kept "no resource with this
  // name or email", as if the pick had taken.
  it("a pick that lands on a resource on two lines says the pick did not take", async () => {
    const SENIOR: Role = { ...ROLE, id: 11 };
    const CAROL: Resource = { ...ANN, id: 3, firstName: "Carol", lastName: "Ito" };
    const twoLines: BudgetBucket = {
      ...BUCKET,
      allocations: [
        { roleId: ROLE.id, resourceIds: [ANN.id, CAROL.id], budgetHours: { "2026-01": 100 }, actualHours: {} },
        { roleId: SENIOR.id, resourceIds: [ANN.id], budgetHours: { "2026-01": 50 }, actualHours: {} },
      ],
    };
    render(<ForecastImportModal {...propsOf({ resources: [ANN, CAROL], roles: [ROLE, SENIOR], bucket: twoLines, buckets: [twoLines] })} />);
    await chooseFile(`${WIDE}A. Lee,10,20,30\r\nCarol Ito,80,80,80\r\n`);
    expect(screen.getByText(t(L, "forecastImportWhyNoMatch"))).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: `${t(L, "forecastImportMatchPerson")} – A. Lee` }), { target: { value: String(ANN.id) } });
    expect(await screen.findByText(t(L, "forecastImportPickSeveralLines"))).toBeInTheDocument();
    expect(screen.queryByText(t(L, "forecastImportWhyNoMatch"))).toBeNull();
  });
});

// rr14 N1: the merged-month (I1) and past-12 (M4) questions once confirmed
// through the generic Wide notice, which never said what the press would read.
// rr14 N4: one row with no person is named in the singular.
describe("ForecastImportModal — notices that say what confirming reads (rr14 N1, N4)", () => {
  const PEOPLE = ["Ann Lee", "Bob Ray", "Cem Oz", "Dana Fox", "Eli Roe", "Fay Wu"];
  const csv = (rows: readonly (readonly string[])[]) => `${rows.map((r) => r.join(";")).join("\r\n")}\r\n`;
  const widePrefix = () => t(L, "forecastImportAmbiguousWide", "\u0000").split("\u0000")[0];
  const genericWide = () => screen.queryByText((text) => text.startsWith(widePrefix()));

  async function choose(text: string): Promise<void> {
    fireEvent.change(screen.getByLabelText(t(L, "forecastImportFile")), { target: { files: [new File([text], "forecast.csv", { type: "text/csv" })] } });
    await screen.findByRole("button", { name: t(L, "forecastImportConfirmColumns") });
  }

  it("a month header merged over Ist | Plan names the unread columns and the columns read, not the generic notice", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await choose(csv([
      ["Name", "Jan 2026", "", "Feb 2026", "", "Mär 2026", ""],
      ["", "Ist", "Plan", "Ist", "Plan", "Ist", "Plan"],
      ...PEOPLE.map((p) => [p, "10", "100", "20", "110", "30", "120"]),
    ]));
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousBlankHeaded", 3, "C, E, G", "B: Jan 2026, D: Feb 2026, F: Mär 2026"))).toBeInTheDocument();
    expect(genericWide()).toBeNull();
  });

  it("one blank-headed number column after the months reads the singular", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await choose(csv([["Name", "Jan 2026", "Feb 2026", "Mär 2026", ""], ...PEOPLE.map((p) => [p, "10", "20", "30", "60"])]));
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousBlankHeaded", 1, "E", "B: Jan 2026, C: Feb 2026, D: Mär 2026"))).toBeInTheDocument();
    expect(genericWide()).toBeNull();
  });

  it("an N/YYYY run past 12 names its first and last header and says 01–12 read as months, not the generic notice", async () => {
    const headers = Array.from({ length: 14 }, (_, i) => `${String(i + 1).padStart(2, "0")}/2026`);
    render(<ForecastImportModal {...propsOf()} />);
    await choose(csv([["Name", ...headers], ...PEOPLE.map((p) => [p, ...headers.map(() => "40")])]));
    expect(screen.getByText(t(L, "forecastImportAmbiguousPastTwelve", "B: 01/2026", "O: 14/2026"))).toBeInTheDocument();
    expect(genericWide()).toBeNull();
  });

  it("beside another reason to ask, the generic notice shows too", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await choose(csv([
      ["Name", "Start", "Jan 2026", "", "Feb 2026", "", "Mär 2026", ""],
      ...PEOPLE.map((p) => [p, "01.03.2026", "10", "100", "20", "110", "30", "120"]),
    ]));
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousBlankHeaded", 3, "D, F, H", "C: Jan 2026, E: Feb 2026, G: Mär 2026"))).toBeInTheDocument();
    expect(genericWide()).not.toBeNull();
  });

  it("names one row with no person in the singular, and two in the plural", async () => {
    const { unmount } = render(<ForecastImportModal {...propsOf()} />);
    await choose("Name;Jan 2026;Feb 2026;Mar 2026\r\nAnn Lee;10;20;30\r\n;10;20;30\r\n");
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousContinuationPlain", 1, "3"))).toBeInTheDocument();
    expect(tPlural(L, "forecastImportAmbiguousContinuationPlain", 1, "3")).toMatch(/^Row 3 holds/);
    unmount();
    render(<ForecastImportModal {...propsOf()} />);
    await choose("Name;Art;Jan 2026;Feb 2026\r\nAnn Lee;Ist;10;20\r\n;Plan;1;2\r\nBob Ray;Ist;5;5\r\n;Plan;3;3\r\n");
    expect(screen.getByText(tPlural(L, "forecastImportAmbiguousContinuation", 2, "3, 5", "Ist, Plan"))).toBeInTheDocument();
  });
});

describe("ForecastImportModal — a shared line's member who is in the sheet but unresolved (rr14 M3a)", () => {
  it("says she is in the sheet and not matched, not that she is missing from it", async () => {
    const SENIOR: Role = { ...ROLE, id: 11 };
    const CAROL: Resource = { ...ANN, id: 3, firstName: "Carol", lastName: "Ito", roleId: SENIOR.id };
    const bucket: BudgetBucket = {
      ...BUCKET,
      allocations: [
        { roleId: SENIOR.id, resourceIds: [ANN.id, CAROL.id], budgetHours: { "2026-01": 100 }, actualHours: {} },
        { roleId: ROLE.id, resourceIds: [ANN.id], budgetHours: {}, actualHours: {} },
      ],
    };
    render(<ForecastImportModal {...propsOf({ resources: [ANN, CAROL], roles: [ROLE, SENIOR], bucket, buckets: [bucket] })} />);
    await chooseFile(`${WIDE}Ann Lee,120,,\r\nCarol Ito,80,,\r\n`);
    const diff = screen.getByRole("region", { name: t(L, "forecastImportChanges") });
    expect(within(diff).getByText(t(L, "forecastImportUnmatchedOnLine", "Ann Lee"))).toBeInTheDocument();
    expect(within(diff).queryByText(t(L, "forecastImportOthersOnLine", "Ann Lee"))).toBeNull();
  });
});
