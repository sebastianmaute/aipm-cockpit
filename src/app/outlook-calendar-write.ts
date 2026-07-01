// src/app/outlook-calendar-write.ts — Microsoft Graph calendar write (events). Pure
// given an access token: no MSAL, no React. graph.microsoft.com is already CSP-allowlisted.
import type { Milestone, CommitteeMeeting, Task, RaidItem } from "./types";
import type { ExistingEvent } from "./calendar-reconcile";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_PAGES = 100;

export const CALENDAR_READWRITE_SCOPE = ["Calendars.ReadWrite"] as const;

export const categoryFor = (projectId: string, entityType?: string): string =>
  entityType ? `AIPM:${projectId}:${entityType}` : `AIPM:${projectId}`;

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

/**
 * A TASK as an all-day Graph event on its due date, tagged with the
 * TYPE-SCOPED category so its list-based reconcile can't touch milestone/
 * committee events. Callers filter to tasks WITH a dueDate before calling.
 */
export function taskToGraphEvent(task: Task, projectId: string): GraphEvent {
  return {
    subject: task.taskName,
    isAllDay: true,
    start: { dateTime: `${task.dueDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(task.dueDate)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "task")],
    body: {
      contentType: "Text",
      content: [
        task.assignee ? `Owner: ${task.assignee}` : "",
        task.status ? `Status: ${task.status}` : "",
        "Managed by the AIPM PM Tracker.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };
}

/**
 * A RAID item as an all-day Graph event on its review date (`targetDate`),
 * tagged with the TYPE-SCOPED "raid" category so its list-based reconcile
 * can't touch task/milestone/committee events. Callers filter to active
 * items WITH a targetDate before calling.
 */
export function raidToGraphEvent(raid: RaidItem, projectId: string): GraphEvent {
  return {
    subject: raid.title,
    isAllDay: true,
    start: { dateTime: `${raid.targetDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(raid.targetDate!)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId, "raid")],
    body: {
      contentType: "Text",
      content: [
        raid.owner ? `Owner: ${raid.owner}` : "",
        raid.severity ? `Severity: ${raid.severity}` : "",
        raid.status ? `Status: ${raid.status}` : "",
        "Managed by the AIPM PM Tracker.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };
}

/**
 * A steering-committee MEETING as an all-day Graph event. The model has NO
 * time-of-day field (only a date), so — like milestones — the event is all-day.
 * Tagged with the project category so it reconciles alongside milestones.
 */
export function committeeMeetingToGraphEvent(
  meeting: CommitteeMeeting,
  committeeName: string,
  projectId: string,
): GraphEvent {
  const subject = committeeName ? `${committeeName}: ${meeting.title}` : meeting.title;
  return {
    subject,
    isAllDay: true,
    start: { dateTime: `${meeting.date}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(meeting.date)}T00:00:00`, timeZone: "UTC" },
    categories: [categoryFor(projectId)],
    body: {
      contentType: "Text",
      content: [meeting.location ? `Location: ${meeting.location}` : "", meeting.agenda ?? "", "Managed by the AIPM PM Tracker."]
        .filter(Boolean)
        .join("\n\n"),
    },
  };
}

/**
 * An INFO-PACK reminder instance as an all-day Graph event on its due date.
 * `meetingTitle` is woven into the subject so the reminder is self-describing.
 */
export function committeeInfoToGraphEvent(
  item: { label: string; dueDate: string; meetingTitle: string },
  projectId: string,
): GraphEvent {
  return {
    subject: `${item.label} — ${item.meetingTitle}`,
    isAllDay: true,
    start: { dateTime: `${item.dueDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${nextDay(item.dueDate)}T00:00:00`, timeZone: "UTC" },
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
  // Tolerate 404 ONLY for DELETE (deleting an already-gone event is success).
  // A 404 on PATCH means the event was deleted in Outlook — that MUST throw so
  // the caller can clear the stale id and re-create on the next push (otherwise
  // the update silently no-ops and the event never reappears).
  const tolerate404 = method === "DELETE";
  if (!res.ok && !(tolerate404 && res.status === 404)) {
    throw new GraphCalendarError(res.status, `Graph ${method} ${path} failed (${res.status})`);
  }
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

/** All events tagged with a TYPE-SCOPED category (id only), paginated. */
export async function listEntityEvents(token: string, projectId: string, entityType: string): Promise<ExistingEvent[]> {
  const cat = categoryFor(projectId, entityType).replace(/'/g, "''"); // OData single-quote escape
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
