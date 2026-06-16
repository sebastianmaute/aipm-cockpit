// src/app/outlook-calendar-write.ts — Microsoft Graph calendar write (events). Pure
// given an access token: no MSAL, no React. graph.microsoft.com is already CSP-allowlisted.
import type { Milestone } from "./types";
import type { ExistingEvent } from "./calendar-reconcile";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_PAGES = 100;

export const CALENDAR_READWRITE_SCOPE = ["Calendars.ReadWrite"] as const;

export const categoryFor = (projectId: string): string => `AIPM:${projectId}`;

export interface GraphEvent {
  subject: string;
  isAllDay: true;
  start: { dateTime: string; timeZone: "UTC" };
  end: { dateTime: string; timeZone: "UTC" };
  categories: string[];
  body: { contentType: "Text"; content: string };
}

export class GraphCalendarError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GraphCalendarError";
  }
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new GraphCalendarError(-1, `Invalid milestone date: ${isoDate}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function milestoneToGraphEvent(m: Milestone, projectId: string): GraphEvent {
  return {
    subject: m.name,
    isAllDay: true,
    start: { dateTime: `${m.date}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(m.date)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId)],
    body: { contentType: "Text", content: "Managed by the AIPM PM Tracker." },
  };
}

async function graph(token: string, method: string, path: string, payload?: unknown): Promise<Response> {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 404) throw new GraphCalendarError(res.status, `Graph ${method} ${path} failed (${res.status})`);
  return res;
}

/** GET an absolute Graph URL, returning the parsed JSON or throwing on non-ok.
 *  Mirrors graph() but for GET (no body), against a full URL (for pagination). */
async function graphGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GraphCalendarError(res.status, `Graph GET failed (${res.status})`);
  return (await res.json()) as T;
}

/** All project-tagged events (id only), paginated. */
export async function listProjectEvents(token: string, projectId: string): Promise<ExistingEvent[]> {
  const cat = categoryFor(projectId).replace(/'/g, "''"); // OData single-quote escape
  let url: string | null = `${GRAPH}/me/events?$filter=${encodeURIComponent(`categories/any(c:c eq '${cat}')`)}&$select=id&$top=100`;
  const out: ExistingEvent[] = [];
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const json: { value?: { id: string }[]; "@odata.nextLink"?: string } = await graphGet(token, url);
    for (const e of json.value ?? []) out.push({ id: e.id });
    url = json["@odata.nextLink"] ?? null;
  }
  return out;
}

export async function createEvent(token: string, event: GraphEvent): Promise<string> {
  const res = await graph(token, "POST", "/me/events", event);
  const json: { id: string } = await res.json();
  return json.id;
}

export async function updateEvent(token: string, eventId: string, event: GraphEvent): Promise<void> {
  await graph(token, "PATCH", `/me/events/${eventId}`, event);
}

export async function deleteEvent(token: string, eventId: string): Promise<void> {
  await graph(token, "DELETE", `/me/events/${eventId}`); // 404 treated as success (already gone)
}
