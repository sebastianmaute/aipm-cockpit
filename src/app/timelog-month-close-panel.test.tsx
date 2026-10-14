import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("./timelog-actuals-store", async (importActual) => ({
  ...(await importActual<object>()),
  loadActualsCache: vi.fn(),
}));
import { loadActualsCache, type ActualsCacheEntry } from "./timelog-actuals-store";
import { TimelogMonthClosePanel } from "./timelog-month-close-panel";
import type { MonthCloseRefusal } from "./timelog-month-close";
import type { TimelogLinks } from "./timelog-types";
import { t } from "./i18n";

const cell = (hours: number) => ({ hours, maxEntryHours: hours, entryCount: 1 });
const TODAY = "2026-10-14";
const LINKS: TimelogLinks = {
  userLinks: [{ timelogUserId: 7, resourceId: 1, manual: false }],
  projectLinks: [],
};
const FULL: ActualsCacheEntry = {
  fetchedAt: "2026-10-14T00:00:00Z",
  daily: { "7|2026-08-03": cell(8) },
  dailyWindow: { from: "2026-08-01", to: "2026-10-14" },
  partial: false,
  // §699 revision — shaped like the panel's only fetch: project scope, nobody in dailyUsers.
  dailyUsers: [],
  dailyProjects: [9],
};
const mockCache = (entry: ActualsCacheEntry | undefined) =>
  vi.mocked(loadActualsCache).mockReturnValue(entry);

function renderPanel(links: TimelogLinks = LINKS) {
  const onLinksChange = vi.fn();
  render(
    <TimelogMonthClosePanel
      lang="en-US"
      links={links}
      onLinksChange={onLinksChange}
      cacheProjectId="p1"
      today={TODAY}
    />,
  );
  return onLinksChange;
}
const CLOSE_SEP: TimelogLinks = {
  ...LINKS,
  close: { through: "2026-09", projectIds: [9], saved: { "2026-08": { "7": {} }, "2026-09": { "7": {} } } },
};
const CLOSE_AUG_ONLY: TimelogLinks = {
  ...LINKS,
  close: { through: "2026-08", projectIds: [9], saved: { "2026-08": { "7": {} } } },
};

describe("TimelogMonthClosePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCache(FULL);
  });

  it("shows the empty state and the first-month select when nothing is closed", () => {
    renderPanel();
    expect(screen.getByText(t("en-US", "timelogCloseNone"))).toBeTruthy();
    const select = screen.getByLabelText(t("en-US", "timelogCloseFirstMonth")) as HTMLSelectElement;
    expect(select.options).toHaveLength(12);
    expect(select.value).toBe("2026-09");
  });

  const REFUSALS: Array<[MonthCloseRefusal, ActualsCacheEntry | undefined, string]> = [
    ["no-roll", undefined, "Fetch TimeLog bookings first."],
    ["window-start", { ...FULL, dailyWindow: { from: "2026-09-05", to: "2026-10-14" } }, "The last fetch starts after the 1st of September 2026. Fetch the whole month."],
    ["window-end", { ...FULL, dailyWindow: { from: "2026-08-01", to: "2026-09-20" } }, "The last fetch ends before the end of September 2026. Fetch the whole month."],
    ["partial", { ...FULL, partial: true }, "The last fetch was incomplete. Fetch again."],
    ["no-projects", { ...FULL, dailyProjects: undefined }, "Fetch TimeLog bookings for the project's TimeLog projects first."],
  ];
  it.each(REFUSALS)("explains the %s refusal and disables Close", (_reason, entry, text) => {
    mockCache(entry);
    renderPanel();
    expect(screen.getByText(text)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Close September 2026" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains a month that has not ended", () => {
    render(
      <TimelogMonthClosePanel lang="en-US" links={CLOSE_AUG_ONLY} onLinksChange={vi.fn()} cacheProjectId="p1" today="2026-09-20" />,
    );
    expect(screen.getByText("September 2026 has not ended yet.")).toBeTruthy();
  });

  it("explains a fetch over different TimeLog projects and disables Close", () => {
    mockCache({ ...FULL, dailyProjects: [9, 12] });
    renderPanel(CLOSE_AUG_ONLY);
    expect(
      screen.getByText(
        "The last fetch covers different TimeLog projects than the closed months. Fetch the same projects, or reopen the closed months.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Close September 2026" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("records the fetched project set on the first close", () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close September 2026" }));
    expect((onChange.mock.calls[0][0] as TimelogLinks).close?.projectIds).toEqual([9]);
  });

  // §699 section 10 — the close saves every booker, linked or not.
  it("saves an unlinked booker at close", () => {
    mockCache({ ...FULL, daily: { ...FULL.daily, "13|2026-09-04": cell(2) } });
    const onChange = renderPanel({ userLinks: [], projectLinks: [] });
    fireEvent.click(screen.getByRole("button", { name: "Close September 2026" }));
    expect((onChange.mock.calls[0][0] as TimelogLinks).close?.saved["2026-09"]).toEqual({ "13": { "2026-09-04": 2 } });
  });

  // §699 M5 — the close's TimeLog projects, by name from the cached refs.
  it("lists the close's TimeLog projects by name, falling back to the id", () => {
    mockCache({ ...FULL, projectRefs: [{ id: 9, name: "Alpha", no: "P-9" }] });
    renderPanel({ ...CLOSE_SEP, close: { ...CLOSE_SEP.close!, projectIds: [9, 12] } });
    expect(screen.getByText("TimeLog projects of the closed months: Alpha · P-9, 12")).toBeTruthy();
  });

  it("names no projects while nothing is closed", () => {
    renderPanel();
    expect(screen.queryByText(/TimeLog projects of the closed months/)).toBeNull();
  });

  // §699 M9 — a cached window older than 12 months is reachable.
  it("offers first months back to the start of an older cached window", () => {
    mockCache({ ...FULL, dailyWindow: { from: "2025-03-15", to: "2026-10-14" } });
    renderPanel();
    const select = screen.getByLabelText(t("en-US", "timelogCloseFirstMonth")) as HTMLSelectElement;
    expect(select.options).toHaveLength(19);
    expect(select.options[0].value).toBe("2026-09");
    expect(select.options[18].value).toBe("2025-03");
  });

  it("closes the selected month from a covering cache", () => {
    const onChange = renderPanel();
    fireEvent.change(screen.getByLabelText(t("en-US", "timelogCloseFirstMonth")), { target: { value: "2026-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Close August 2026" }));
    const arg = onChange.mock.calls[0][0] as TimelogLinks;
    expect(arg.close?.through).toBe("2026-08");
    expect(arg.close?.saved["2026-08"]["7"]).toEqual({ "2026-08-03": 8 });
  });

  it("asks before reopening, and Cancel writes nothing", () => {
    const onChange = renderPanel(CLOSE_SEP);
    expect(screen.getByText("Closed through September 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen September 2026" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Reopen September 2026? Its saved hours are deleted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/saved hours are deleted/)).toBeNull();
  });

  it("Confirm reopens the last month", () => {
    const onChange = renderPanel(CLOSE_SEP);
    fireEvent.click(screen.getByRole("button", { name: "Reopen September 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onChange.mock.calls[0][0].close.through).toBe("2026-08");
  });

  it("reopening the only month writes links with no close key", () => {
    const onChange = renderPanel(CLOSE_AUG_ONLY);
    fireEvent.click(screen.getByRole("button", { name: "Reopen August 2026" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const arg = onChange.mock.calls[0][0] as object;
    expect("close" in arg).toBe(false);
  });

  // §699 I4 — accepting a reviewed change re-saves one closed month.
  describe("accepting a closed month", () => {
    const pickMonth = (month: string) =>
      fireEvent.change(screen.getByLabelText(t("en-US", "timelogAcceptMonth")), { target: { value: month } });

    it("offers the closed months, newest first, and none while nothing is closed", () => {
      renderPanel(CLOSE_SEP);
      const select = screen.getByLabelText(t("en-US", "timelogAcceptMonth")) as HTMLSelectElement;
      expect([...select.options].map((o) => o.value)).toEqual(["2026-09", "2026-08"]);
      expect(select.value).toBe("2026-09");
    });

    it("is absent while nothing is closed", () => {
      renderPanel();
      expect(screen.queryByLabelText(t("en-US", "timelogAcceptMonth"))).toBeNull();
      expect(screen.queryByRole("button", { name: /Accept current hours/ })).toBeNull();
    });

    it("asks before accepting, and Cancel writes nothing", () => {
      const onChange = renderPanel(CLOSE_SEP);
      pickMonth("2026-08");
      fireEvent.click(screen.getByRole("button", { name: "Accept current hours for August 2026" }));
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByText("Accept August 2026's current hours? Later changes are compared against them.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByText(/Later changes are compared/)).toBeNull();
    });

    it("Confirm re-saves only that month and keeps through", () => {
      const onChange = renderPanel(CLOSE_SEP);
      pickMonth("2026-08");
      fireEvent.click(screen.getByRole("button", { name: "Accept current hours for August 2026" }));
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
      const arg = onChange.mock.calls[0][0] as TimelogLinks;
      expect(arg.close).toEqual({
        through: "2026-09",
        projectIds: [9],
        saved: { "2026-08": { "7": { "2026-08-03": 8 } }, "2026-09": { "7": {} } },
      });
    });

    it("explains a refusal for the chosen month and disables Accept", () => {
      mockCache({ ...FULL, dailyWindow: { from: "2026-08-05", to: "2026-10-14" } });
      renderPanel(CLOSE_SEP);
      pickMonth("2026-08");
      expect(screen.getByText("The last fetch starts after the 1st of August 2026. Fetch the whole month.")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Accept current hours for August 2026" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("states a shared refusal once", () => {
      mockCache({ ...FULL, partial: true });
      renderPanel(CLOSE_AUG_ONLY);
      expect(screen.getAllByText("The last fetch was incomplete. Fetch again.")).toHaveLength(1);
      expect((screen.getByRole("button", { name: "Accept current hours for August 2026" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("opens one confirmation at a time, with unique button names", () => {
      renderPanel(CLOSE_SEP);
      fireEvent.click(screen.getByRole("button", { name: "Accept current hours for September 2026" }));
      expect(screen.queryByRole("button", { name: "Reopen September 2026" })).toBeNull();
      const names = screen.getAllByRole("button").map((b) => b.textContent);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  it("keeps every button name unique", () => {
    renderPanel(CLOSE_SEP);
    fireEvent.click(screen.getByRole("button", { name: "Reopen September 2026" }));
    expect(screen.queryByRole("button", { name: /Accept current hours/ })).toBeNull();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});
