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
  dailyUsers: [7],
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
  close: { through: "2026-09", saved: { "2026-08": { "7": {} }, "2026-09": { "7": {} } } },
};
const CLOSE_AUG_ONLY: TimelogLinks = {
  ...LINKS,
  close: { through: "2026-08", saved: { "2026-08": { "7": {} } } },
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
    ["person-missing", { ...FULL, dailyUsers: [9] }, "The last fetch did not include every linked person."],
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

  it("warns about a person linked after the close, by name, and not when everyone is saved", () => {
    mockCache({ ...FULL, users: [{ userId: 9, firstName: "Ann", lastName: "Lee", initials: "AL", email: "", isActive: true }] });
    const later: TimelogLinks = {
      ...CLOSE_AUG_ONLY,
      userLinks: [...LINKS.userLinks, { timelogUserId: 9, resourceId: 2, manual: false }],
    };
    const { unmount } = render(
      <TimelogMonthClosePanel lang="en-US" links={later} onLinksChange={vi.fn()} cacheProjectId="p1" today={TODAY} />,
    );
    expect(screen.getByText(/Linked after the close.*Ann Lee/)).toBeTruthy();
    unmount();
    renderPanel(CLOSE_AUG_ONLY);
    expect(screen.queryByText(/Linked after the close/)).toBeNull();
  });

  it("keeps every button name unique", () => {
    renderPanel(CLOSE_SEP);
    fireEvent.click(screen.getByRole("button", { name: "Reopen September 2026" }));
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});
