// src/app/use-outlook-calendar.ts
"use client";

import { useCallback } from "react";
import { mapGraphEvent, type GraphEvent, type OutlookEvent } from "./outlook-calendar";
import { isSafeGraphLink } from "./sharepoint-graph";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "id,subject,start,end,isAllDay,showAs";
const MAX_PAGES = 100;

export interface CalendarWindow {
  startDateTime: string; // ISO 8601
  endDateTime: string;   // ISO 8601
}

interface GraphPage {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
}

export interface UseOutlookCalendarResult {
  /** Fetch + normalize time-away events in `range`. Throws an Error whose
   *  message is an i18n key for the caller to translate. */
  fetchEvents: (range: CalendarWindow) => Promise<OutlookEvent[]>;
}

export function useOutlookCalendar(
  acquireToken: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>,
): UseOutlookCalendarResult {
  const fetchEvents = useCallback(async (range: CalendarWindow): Promise<OutlookEvent[]> => {
    let token: string | null;
    try {
      // Interactive: importing is an explicit user action, so first-time
      // consent for Calendars.Read may surface an interactive popup.
      token = await acquireToken(["Calendars.Read"], { interactive: true });
    } catch {
      throw new Error("outlookSignInExpired");
    }
    if (!token) throw new Error("outlookSignInRequired");

    const params = new URLSearchParams({
      startDateTime: range.startDateTime,
      endDateTime: range.endDateTime,
      $select: SELECT,
      $top: "100",
      $orderby: "start/dateTime",
    });
    let url: string | undefined = `${GRAPH}/me/calendarView?${params.toString()}`;

    const out: OutlookEvent[] = [];
    let index = 0;
    let pages = 0;
    while (url) {
      if (++pages > MAX_PAGES) throw new Error("outlookCalendarFetchFailed");
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
        });
      } catch {
        throw new Error("outlookCalendarFetchFailed");
      }
      if (res.status === 401) throw new Error("outlookSignInExpired");
      if (res.status === 403) throw new Error("outlookCalendarPermissionDenied");
      if (!res.ok) throw new Error("outlookCalendarFetchFailed");
      let page: GraphPage;
      try {
        page = (await res.json()) as GraphPage;
      } catch {
        throw new Error("outlookCalendarFetchFailed");
      }
      for (const raw of page.value ?? []) {
        const mapped = mapGraphEvent(raw, index++);
        if (mapped) out.push(mapped);
      }
      const next = page["@odata.nextLink"];
      if (next && !isSafeGraphLink(next)) {
        throw new Error("outlookCalendarFetchFailed");
      }
      url = next;
    }
    return out;
  }, [acquireToken]);

  return { fetchEvents };
}
