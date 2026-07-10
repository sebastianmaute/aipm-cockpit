// src/app/timelog-api.ts
// Browser wire layer over the /api/timelog proxy. i18n-free.
import type { TimelogUser, TimelogTimeItem, TimelogFinancialDay } from "./timelog-types";
import type { TimelogProjectRef } from "./timelog-match";

export type TimelogCreds = { host: string; tenant: string; token: string };

export class TimelogError extends Error {
  status: number;
  constructor(status: number) { super(`timelog-http-${status}`); this.name = "TimelogError"; this.status = status; }
}

/** Unwrap the TimeLog API Format envelope to a flat array of Properties objects. */
export function unwrapTaf(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const r = json as Record<string, unknown>;
  if (Array.isArray(r.Entities)) {
    return (r.Entities as unknown[])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((o) => (o.Properties && typeof o.Properties === "object" ? o.Properties : o) as Record<string, unknown>);
  }
  if (r.Properties && typeof r.Properties === "object") return [r.Properties as Record<string, unknown>];
  return [];
}

// 429 backoff: the proxy limiter (60 req/min/IP) and TimeLog itself both throttle
// with HTTP 429. A paged or org-scope (per-employee) fetch bursts many requests,
// so transparently retry a 429 — honour the `Retry-After` header (seconds), else
// exponential backoff — instead of surfacing a hard error. Bounded so a persistent
// throttle still fails fast rather than hanging.
const MAX_429_RETRIES = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 60_000;

// Abortable so a Cancel during a 429 backoff wait returns promptly (the loop's
// next fetch then rejects with AbortError) instead of blocking for up to 60s.
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function retryDelayMs(res: Response, attempt: number): number {
  const ra = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_BACKOFF_MS);
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

async function callRaw(creds: TimelogCreds, path: string, query: Record<string, string> = {}, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/timelog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...creds, path, query }),
      signal,
    });
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      await sleep(retryDelayMs(res, attempt), signal);
      continue;
    }
    if (!res.ok) throw new TimelogError(res.status);
    return res.json();
  }
}

async function call(creds: TimelogCreds, path: string, query: Record<string, string> = {}, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  return unwrapTaf(await callRaw(creds, path, query, signal));
}

// TimeLog list endpoints page at 10 rows by default and expose the OData-style
// `$page` / `$pagesize` query options (max pagesize 100). Without a paging loop
// the app silently ingests ONLY the first 10 rows of a list — e.g. 10 of 77
// bookings. The envelope's top-level `Properties.TotalPage` drives the loop.
// 500/page (the endpoints honour large pagesizes — verified up to 1000; default
// is only 10). Bigger pages mean far fewer round trips: a ~6000-row closed
// project history is ~12 requests, not ~60, keeping well under the proxy rate
// limit. 500 balances request count against single-response payload size.
const PAGE_SIZE = 500;
// Safety cap so a malformed/looping TotalPage can't fetch unbounded pages.
// 100 × 500 = 50 000 rows — covers any real dataset while bounding a runaway loop.
const MAX_PAGES = 100;

function totalPagesOf(json: unknown): number {
  if (!json || typeof json !== "object") return 1;
  const props = (json as { Properties?: unknown }).Properties;
  if (!props || typeof props !== "object") return 1;
  const n = Number((props as { TotalPage?: unknown }).TotalPage);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Fetch every page of a TimeLog list endpoint and concatenate the rows. */
async function callPaged(creds: TimelogCreds, path: string, query: Record<string, string> = {}, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await callRaw(creds, path, { ...query, $page: String(page), $pagesize: String(PAGE_SIZE) }, signal);
    out.push(...unwrapTaf(json));
    if (page >= totalPagesOf(json)) break;
  }
  return out;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const dateOnly = (v: unknown): string => s(v).slice(0, 10);

export async function listUsers(creds: TimelogCreds, signal?: AbortSignal): Promise<TimelogUser[]> {
  return (await callPaged(creds, "/v1/user", {}, signal)).map((p) => ({
    userId: num(p.UserID), firstName: s(p.FirstName), lastName: s(p.LastName),
    // Default-true: a user row without an explicit flag is treated as active.
    initials: s(p.Initials), email: s(p.Email), isActive: p.IsActive !== false,
  }));
}

// /v1/user-setting returns Properties.Privileges (a plain sub-object). Defaulting
// registrationAllTasks to false is the SAFE degradation: a wrong/absent nesting
// makes scope fall back to self-only, never over-fetching org-wide data.
export async function getPrivileges(creds: TimelogCreds, signal?: AbortSignal): Promise<{ registrationAllTasks: boolean }> {
  const rows = await call(creds, "/v1/user-setting", {}, signal);
  const privs = (rows[0]?.Privileges ?? {}) as Record<string, unknown>;
  return { registrationAllTasks: privs.RegistrationAllTasks === true };
}

function mapTimeItem(p: Record<string, unknown>): TimelogTimeItem {
  return {
    timeRegistrationId: num(p.TimeRegistrationID), userId: num(p.UserID),
    projectId: num(p.ProjectID), projectName: s(p.ProjectName), projectNo: s(p.ProjectNo),
    taskId: num(p.TaskID), date: dateOnly(p.Date), hours: num(p.Hours),
    // Default-false: a registration without an explicit flag is non-billable,
    // so we never over-count billable hours.
    billableHours: num(p.BillableHours), isBillable: p.IsBillable === true,
  };
}

/**
 * Map a row from the v2 per-project time-registrations endpoint. v2 uses a
 * DIFFERENT shape from the v1 `TimeTrackingItemApiReadModel` `mapTimeItem`
 * reads — verified live against app2.timelog.com:
 *   v1 `Hours`→ v2 `ActualHours`; v1 `IsBillable`→ v2 `NonBillable` (inverted);
 *   v1 `TimeRegistrationID`→ v2 `TimeRegistrationId` (lowercase d).
 * v2 carries NO `ProjectID`/`TaskID`/`UserID` — only names/initials. The project
 * id is known from the request path (injected); the user id is resolved from
 * `EmployeeInitials` against the loaded directory (`initialsToUserId`), falling
 * back to 0 (→ aggregated as unattributed, never dropped) when unmatched.
 */
function mapV2TimeItem(
  p: Record<string, unknown>,
  projectId: number,
  initialsToUserId?: ReadonlyMap<string, number>,
): TimelogTimeItem {
  const initials = s(p.EmployeeInitials).trim().toLowerCase();
  const nonBillable = p.NonBillable === true;
  const hours = num(p.ActualHours);
  return {
    timeRegistrationId: num(p.TimeRegistrationId),
    userId: (initials && initialsToUserId?.get(initials)) || 0,
    projectId,
    projectName: s(p.ProjectName),
    projectNo: "",
    taskId: 0,
    date: dateOnly(p.Date),
    hours,
    billableHours: nonBillable ? 0 : hours,
    isBillable: !nonBillable,
  };
}

/** The token owner (GET /v1/user/me → UserApiReadModel). */
export async function getMe(creds: TimelogCreds, signal?: AbortSignal): Promise<{ userId: number }> {
  const rows = await call(creds, "/v1/user/me", {}, signal);
  return { userId: num(rows[0]?.UserID) };
}

/** Projects where `managerUserId` is the Project Manager (filtered from the
 *  paged /v1/project/get-all list — REST exposes ProjectManagerID per project).
 *  `Project_GetAll` defaults `isActive=true` (active/open only); pass
 *  `includeClosed` to ALSO pull `isActive=false` and merge, so finished projects
 *  are matchable too. Closed history can be thousands of rows (many pages). */
export async function listManagedProjects(
  creds: TimelogCreds,
  managerUserId: number,
  signal?: AbortSignal,
  includeClosed = false,
): Promise<TimelogProjectRef[]> {
  // No valid manager id → return nothing. Guards against a malformed /v1/user/me
  // (userId 0) spuriously matching every project that has a null/absent PM.
  if (managerUserId <= 0) return [];
  const fetchSet = (active: boolean) =>
    callPaged(creds, "/v1/project/get-all", { isActive: String(active) }, signal);
  const rows = includeClosed ? [...(await fetchSet(true)), ...(await fetchSet(false))] : await fetchSet(true);
  const seen = new Set<number>();
  const out: TimelogProjectRef[] = [];
  for (const p of rows) {
    if (num(p.ProjectManagerID) !== managerUserId) continue;
    const id = num(p.ProjectID);
    if (seen.has(id)) continue; // active + closed sets can't truly overlap, but dedupe defensively
    seen.add(id);
    out.push({ id, name: s(p.Name), no: s(p.No) });
  }
  return out;
}

export type TimelogCustomer = { id: number; name: string };

/** Customer directory (GET /v1/customer) — id + name for the project-scope picker. */
export async function listCustomers(creds: TimelogCreds, signal?: AbortSignal): Promise<TimelogCustomer[]> {
  return (await callPaged(creds, "/v1/customer", {}, signal))
    .map((c) => ({ id: num(c.CustomerID), name: s(c.Name) }))
    .filter((c) => c.id > 0 && c.name);
}

/** All projects for one customer (server-side `customerID` filter — NOT PM-scoped).
 *  Lets a non-PM load a specific client's projects to link to budgets. */
export async function listProjectsForCustomer(
  creds: TimelogCreds,
  customerId: number,
  signal?: AbortSignal,
  includeClosed = false,
): Promise<TimelogProjectRef[]> {
  if (customerId <= 0) return [];
  const fetchSet = (active: boolean) =>
    callPaged(creds, "/v1/project/get-all", { customerID: String(customerId), isActive: String(active) }, signal);
  const rows = includeClosed ? [...(await fetchSet(true)), ...(await fetchSet(false))] : await fetchSet(true);
  const seen = new Set<number>();
  const out: TimelogProjectRef[] = [];
  for (const p of rows) {
    const id = num(p.ProjectID);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: s(p.Name), no: s(p.No) });
  }
  return out;
}

export async function listTimeItemsSelf(creds: TimelogCreds, startDate: string, endDate: string, signal?: AbortSignal): Promise<TimelogTimeItem[]> {
  return (await callPaged(creds, "/v1/time-tracking-item/get-by-date", { startDate, endDate }, signal)).map(mapTimeItem);
}

/** Time registrations for ONE project (v2 per-project endpoint). The
 *  customer-scoped booking fetch fans out over a customer's project ids,
 *  loading only that customer's registrations. `projectId` is validated as a
 *  positive int before it is interpolated into the path (path-injection guard,
 *  mirrors the Confluence pageId /^\d+$/ check). Rows are mapped by the v2
 *  mapper (its field names differ from v1); the project id is injected and the
 *  user id resolved from `EmployeeInitials` via `initialsToUserId`. The endpoint
 *  returns the project's WHOLE history unpaged and ignores the date params, so
 *  the caller (`fetchBookingsForCustomer`) clamps to the requested window. */
export async function listProjectTimeRegistrations(
  creds: TimelogCreds,
  projectId: number,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
  initialsToUserId?: ReadonlyMap<string, number>,
): Promise<TimelogTimeItem[]> {
  if (!Number.isInteger(projectId) || projectId <= 0) return [];
  return (await callPaged(creds, `/v2/projects/${projectId}/time-registrations`,
    { startDate, endDate }, signal)).map((p) => mapV2TimeItem(p, projectId, initialsToUserId));
}

export async function listEmployeeTimeItems(creds: TimelogCreds, employeeUserId: number, startDate: string, endDate: string, signal?: AbortSignal): Promise<TimelogTimeItem[]> {
  return (await callPaged(creds, "/v1/approval/timesheets/get-status-by-period-with-rejected-time-tracking-items",
    { employeeUserId: String(employeeUserId), startDate, endDate }, signal)).map(mapTimeItem);
}

export async function getFinancialDataSelf(creds: TimelogCreds, startDate: string, endDate: string, signal?: AbortSignal): Promise<TimelogFinancialDay[]> {
  return (await callPaged(creds, "/v1/time-registration-financial-data/get-by-date-range", { startDate, endDate }, signal)).map((p) => ({
    userId: num(p.UserID), date: dateOnly(p.Date), totalActualHour: num(p.TotalActualHour),
    totalBillableHour: num(p.TotalBillableHour), totalBillableAmount: num(p.TotalBillableAmount),
    billableCurrency: s(p.BillableCurrencyABB),
  }));
}
