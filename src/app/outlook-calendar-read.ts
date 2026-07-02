import { GRAPH, MAX_PAGES, graphGet } from "./outlook-graph";
import { categoryFor } from "./outlook-calendar-write";
import type { PulledEvent } from "./calendar-pull";

interface RawEvent {
  id: string;
  start: { dateTime?: string } | null;
  isCancelled?: boolean;
}

function toDate(raw: RawEvent): string | null {
  const dt = raw.start?.dateTime;
  if (typeof dt !== "string" || dt.length < 10) return null;
  const d = dt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Fetch the current date + cancel state of every event tagged with the project's
 *  bare category. Milestones share this category with committee events; the caller
 *  matches by stored outlookEventId, so non-milestone events simply don't match. */
export async function fetchProjectEventDates(token: string, projectId: string): Promise<PulledEvent[]> {
  const cat = categoryFor(projectId).replace(/'/g, "''");
  let url: string | null =
    `${GRAPH}/me/events?$filter=${encodeURIComponent(`categories/any(c:c eq '${cat}')`)}&$select=id,start,isCancelled&$top=100`;
  const out: PulledEvent[] = [];
  for (let i = 0; i < MAX_PAGES && url; i++) {
    const json: { value?: RawEvent[]; "@odata.nextLink"?: string } = await graphGet(token, url);
    for (const e of json.value ?? []) out.push({ id: e.id, date: toDate(e), isCancelled: e.isCancelled === true });
    url = json["@odata.nextLink"] ?? null;
  }
  return out;
}
