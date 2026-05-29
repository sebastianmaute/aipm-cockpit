import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOutlookCalendar } from "./use-outlook-calendar";

const WINDOW = { startDateTime: "2026-05-01T00:00:00Z", endDateTime: "2026-11-01T00:00:00Z" };

describe("useOutlookCalendar", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  function jsonRes(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }
  const allDay = {
    id: "1", subject: "Vac",
    start: { dateTime: "2026-06-01T00:00:00" }, end: { dateTime: "2026-06-02T00:00:00" },
    isAllDay: true, showAs: "oof",
  };
  const meeting = {
    id: "2", subject: "Standup",
    start: { dateTime: "2026-06-01T09:00:00" }, end: { dateTime: "2026-06-01T09:30:00" },
    isAllDay: false, showAs: "busy",
  };

  it("fetches with the right params/headers, follows nextLink, filters time-away", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy
      .mockResolvedValueOnce(jsonRes({ value: [allDay, meeting], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=100" }))
      .mockResolvedValueOnce(jsonRes({ value: [] }));
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    const events = await result.current.fetchEvents(WINDOW);

    expect(events).toHaveLength(1); // meeting filtered out
    expect(events[0].startDate).toBe("2026-06-01");
    expect(acquireToken).toHaveBeenCalledWith(["Calendars.Read"], { interactive: true });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/me/calendarView");
    expect(url).toContain("startDateTime=");
    expect(url).toContain("endDateTime=");
    expect(url).toContain("%24select=");
    expect(url).toContain("%24orderby=");
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      Prefer: 'outlook.timezone="UTC"',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/me/calendarView?$skip=100");
  });

  it("throws outlookSignInRequired when token is null", async () => {
    const acquireToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookSignInRequired");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps HTTP errors to keys", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    for (const [status, key] of [
      [401, "outlookSignInExpired"],
      [403, "outlookCalendarPermissionDenied"],
      [500, "outlookCalendarFetchFailed"],
    ] as const) {
      fetchSpy.mockResolvedValueOnce(jsonRes({}, status));
      const { result } = renderHook(() => useOutlookCalendar(acquireToken));
      await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow(key);
    }
  });

  it("maps a thrown acquireToken to outlookSignInExpired", async () => {
    const acquireToken = vi.fn().mockRejectedValue(new Error("popup closed"));
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookSignInExpired");
  });

  it("rejects an off-Graph nextLink", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    fetchSpy.mockResolvedValueOnce(jsonRes({ value: [], "@odata.nextLink": "https://evil.example.com/x" }));
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookCalendarFetchFailed");
  });
});
