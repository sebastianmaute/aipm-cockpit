import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook } from "@testing-library/react";
import { server } from "../test/msw-server";
import { useOutlookCalendar } from "./use-outlook-calendar";

const WINDOW = { startDateTime: "2026-05-01T00:00:00Z", endDateTime: "2026-11-01T00:00:00Z" };
const CALENDAR_VIEW = "https://graph.microsoft.com/v1.0/me/calendarView";

describe("useOutlookCalendar", () => {
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
    const requests: Request[] = [];
    // One handler serves both pages: the initial query, then the $skip nextLink.
    server.use(
      http.get(CALENDAR_VIEW, ({ request }) => {
        requests.push(request);
        if (new URL(request.url).searchParams.has("$skip")) return HttpResponse.json({ value: [] });
        return HttpResponse.json({
          value: [allDay, meeting],
          "@odata.nextLink": `${CALENDAR_VIEW}?$skip=100`,
        });
      }),
    );

    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    const events = await result.current.fetchEvents(WINDOW);

    expect(events).toHaveLength(1); // meeting (busy) filtered out, only the all-day OOF kept
    expect(events[0].startDate).toBe("2026-06-01");
    expect(acquireToken).toHaveBeenCalledWith(["Calendars.Read"], { interactive: true });

    expect(requests).toHaveLength(2);
    const first = requests[0].url;
    expect(first).toContain("/me/calendarView");
    expect(first).toContain("startDateTime=");
    expect(first).toContain("endDateTime=");
    expect(first).toContain("%24select=");
    expect(first).toContain("%24orderby=");
    expect(requests[0].headers.get("Authorization")).toBe("Bearer tok");
    expect(requests[0].headers.get("Prefer")).toBe('outlook.timezone="UTC"');
    expect(requests[1].url).toBe(`${CALENDAR_VIEW}?$skip=100`);
  });

  it("throws outlookSignInRequired when token is null", async () => {
    const acquireToken = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookSignInRequired");
  });

  it("maps HTTP errors to keys", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    for (const [status, key] of [
      [401, "outlookSignInExpired"],
      [403, "outlookCalendarPermissionDenied"],
      [500, "outlookCalendarFetchFailed"],
    ] as const) {
      server.use(http.get(CALENDAR_VIEW, () => HttpResponse.json({}, { status })));
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
    server.use(
      http.get(CALENDAR_VIEW, () =>
        HttpResponse.json({ value: [], "@odata.nextLink": "https://evil.example.com/x" }),
      ),
    );
    const { result } = renderHook(() => useOutlookCalendar(acquireToken));
    await expect(result.current.fetchEvents(WINDOW)).rejects.toThrow("outlookCalendarFetchFailed");
  });
});
