// src/app/timelog-api.ts
// Browser wire layer over the /api/timelog proxy. i18n-free.
import type { TimelogUser, TimelogTimeItem, TimelogFinancialDay } from "./timelog-types";

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

async function call(creds: TimelogCreds, path: string, query: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  const res = await fetch("/api/timelog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, path, query }),
  });
  if (!res.ok) throw new TimelogError(res.status);
  return unwrapTaf(await res.json());
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const dateOnly = (v: unknown): string => s(v).slice(0, 10);

export async function listUsers(creds: TimelogCreds): Promise<TimelogUser[]> {
  return (await call(creds, "/v1/user")).map((p) => ({
    userId: num(p.UserID), firstName: s(p.FirstName), lastName: s(p.LastName),
    // Default-true: a user row without an explicit flag is treated as active.
    initials: s(p.Initials), email: s(p.Email), isActive: p.IsActive !== false,
  }));
}

// /v1/user-setting returns Properties.Privileges (a plain sub-object). Defaulting
// registrationAllTasks to false is the SAFE degradation: a wrong/absent nesting
// makes scope fall back to self-only, never over-fetching org-wide data.
export async function getPrivileges(creds: TimelogCreds): Promise<{ registrationAllTasks: boolean }> {
  const rows = await call(creds, "/v1/user-setting");
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

export async function listTimeItemsSelf(creds: TimelogCreds, startDate: string, endDate: string): Promise<TimelogTimeItem[]> {
  return (await call(creds, "/v1/time-tracking-item/get-by-date", { startDate, endDate })).map(mapTimeItem);
}

export async function listEmployeeTimeItems(creds: TimelogCreds, employeeUserId: number, startDate: string, endDate: string): Promise<TimelogTimeItem[]> {
  return (await call(creds, "/v1/approval/timesheets/get-status-by-period-with-rejected-time-tracking-items",
    { employeeUserId: String(employeeUserId), startDate, endDate })).map(mapTimeItem);
}

export async function getFinancialDataSelf(creds: TimelogCreds, startDate: string, endDate: string): Promise<TimelogFinancialDay[]> {
  return (await call(creds, "/v1/time-registration-financial-data/get-by-date-range", { startDate, endDate })).map((p) => ({
    userId: num(p.UserID), date: dateOnly(p.Date), totalActualHour: num(p.TotalActualHour),
    totalBillableHour: num(p.TotalBillableHour), totalBillableAmount: num(p.TotalBillableAmount),
    billableCurrency: s(p.BillableCurrencyABB),
  }));
}
