// §500 — the forecast import modal: source → preview → apply over the hook
// (`use-forecast-import.test.ts` pins the state machine). This pins what the
// user SEES and can operate: row-unique pickers, a blocker that disables
// Apply, the partial-period warning, the AI-off reason, and one commit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("ForecastImportModal — cells Claude did not read", () => {
  function replyWith(rows: unknown[]) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "propose_forecast_rows", input: { rows } }] }),
    } as unknown as Response);
  }

  it("lists a skipped cell under Not imported, as information", async () => {
    replyWith([
      { person: "Ann Lee", period: "Jan 2026", hours: 10, source: "forecast!B2" },
      { person: "Ann Lee", period: "Feb 2026", hours: 20, source: "forecast!C2" },
    ]);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(t(L, "forecastImportUnreadCellsOne", 1, "forecast!D2"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t(L, "forecastImportApply") })).toBeEnabled();
  });

  it("lists the first 20 cells and counts the rest", async () => {
    const header = ["Name", ...Array.from({ length: 24 }, (_, i) => `KW${String(i + 1).padStart(2, "0")} 2026`)].join(",");
    const line = ["Ann Lee", ...Array.from({ length: 24 }, () => "1")].join(",");
    replyWith([{ person: "Ann Lee", period: "KW01 2026", hours: 1, source: "forecast!B2" }]);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${header}\r\n${line}\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    const refs = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V"].map((c) => `forecast!${c}2`);
    const list = `${refs.join(", ")} ${t(L, "forecastImportUnreadMore", "3")}`;
    expect(within(section).getByText(t(L, "forecastImportUnreadCells", 23, list))).toBeInTheDocument();
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

describe("ForecastImportModal — a person Claude skipped (round 3)", () => {
  it("names the skipped row and its person under Not imported", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "propose_forecast_rows", input: { rows: [
          { person: "Ann Lee", period: "Jan 2026", hours: 10, source: "forecast!B2" },
          { person: "Ann Lee", period: "Feb 2026", hours: 20, source: "forecast!C2" },
          { person: "Ann Lee", period: "Mar 2026", hours: 30, source: "forecast!D2" },
        ] } }],
      }),
    } as unknown as Response);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(`${WIDE}Ann Lee,10,20,30\r\nBob Kay,1,2,3\r\n`);
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(t(L, "forecastImportUnreadRowsOne", 1, "3 (Bob Kay)"))).toBeInTheDocument();
  });
});

describe("ForecastImportModal — rows above the header row (round 3)", () => {
  it("says how many rows above the header row were not read", async () => {
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(["Name,Jan 2026,Feb 2026,Mar 2026", "Ann Lee,10,20,30", "", "Name,Jan 2027,Feb 2027,Mar 2027", "Ann Lee,40,50,60", ""].join("\r\n"));
    const section = screen.getByRole("region", { name: t(L, "forecastImportNotImported") });
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
    expect(screen.getByText(t(L, "forecastImportAmbiguousHours", "Plan, Ist"))).toBeInTheDocument();
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
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHours", "Plan, Ist"))).toBeNull();
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
    expect(screen.queryByText(t(L, "forecastImportAmbiguousHours", "Plan, Ist"))).toBeNull();
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
    expect(screen.getByText(t(L, "forecastImportAmbiguousHours", "Plan, Ist"))).toBeInTheDocument();
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
    expect(screen.getByText(t(L, "forecastImportAmbiguousPeriod", "Datum, Eintritt"))).toBeInTheDocument();
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveAccessibleDescription(t(L, "forecastImportConfirmFirst"));
  });

  const claudeSays = (rows: unknown[]) => vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "propose_forecast_rows", input: { rows } }],
    }),
  } as unknown as Response);

  it("says why Claude's row was refused when the detected columns read its cell in another period", async () => {
    claudeSays([{ person: "Ann Lee", period: "Mar 2026", hours: 10, source: "forecast!C3" }]);
    render(<ForecastImportModal {...propsOf()} />);
    const people = ["Bob Kay", "Cem Ott", "Dora Li", "Eve Wu"].map((p) => `${p},,1,2,3`);
    await chooseFile([",,Jan 2026,Feb 2026,Mar 2026", "Name,Eintritt,Std,Std,Std", "Ann Lee,01.03.2026,10,20,30", ...people, ""].join("\r\n"));
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(/forecast!C3/)).toHaveTextContent(t(L, "forecastImportRejectSourceSheet", "Jan 2026"));
  });

  it("names a week by its label, not its key", async () => {
    claudeSays([{ person: "Ann Lee", period: "2026-W05", hours: 10, source: "forecast!B2" }]);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseFile(["Name,2026-01-05,2026-01-12,2026-01-19", "Ann Lee,10,20,30", ""].join("\r\n"));
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(/forecast!B2/)).toHaveTextContent(t(L, "forecastImportRejectSourceSheet", t(L, "forecastImportWeekLabel", "02", "2026")));
    expect(t(L, "forecastImportWeekLabel", "02", "2026")).toBe("W02 2026");
  });
  it("says why Claude's row was refused when the row and the column header disagree", async () => {
    claudeSays([{ person: "Ann Lee", period: "Jan 2026", hours: 40, source: "forecast!C4" }]);
    render(<ForecastImportModal {...propsOf()} />);
    await chooseAmbiguous(["Zeitraum,01.01.2026,31.03.2026", "", "Name,Monat,Plan,Ist", "Ann Lee,Jan 2026,40,35", "Ann Lee,Feb 2026,30,25", ""].join("\r\n"));
    fireEvent.click(screen.getByRole("button", { name: t(L, "forecastImportAskClaude") }));
    const section = await screen.findByRole("region", { name: t(L, "forecastImportNotImported") });
    expect(within(section).getByText(/forecast!C4/)).toHaveTextContent(t(L, "forecastImportRejectSourceConflict", "Jan 2026", "Mar 2026"));
    // Read after the row and a dash, like its sibling reasons: lower case.
    expect(t(L, "forecastImportRejectSourceConflict", "a", "b")).toMatch(/^the row says a/);
  });
});
