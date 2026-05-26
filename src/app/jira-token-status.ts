import type { JiraConfig } from "./settings-menu";

export type JiraTokenAlert =
  | { state: "invalid" | "expired" | "expiring"; daysLeft: number; date: string }
  | null;

/** Whole-day difference (target - today). Both args are "YYYY-MM-DD". null if unparseable. */
export function daysUntil(targetIso: string, todayIso: string): number | null {
  const target = Date.parse(`${targetIso}T12:00:00Z`);
  const today = Date.parse(`${todayIso}T12:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(today)) return null;
  return Math.round((target - today) / 86_400_000);
}

/** Highest-priority token alert, or null. Priority: invalid > expired > expiring. `today` is "YYYY-MM-DD". */
export function getJiraTokenAlert(jira: JiraConfig, today: string, leadDays: number): JiraTokenAlert {
  if (!jira.enabled) return null;
  if (jira.tokenInvalidAt) return { state: "invalid", daysLeft: 0, date: "" };
  const exp = jira.tokenExpiresAt?.trim();
  if (!exp) return null;
  const daysLeft = daysUntil(exp, today);
  if (daysLeft === null) return null;
  if (daysLeft < 0) return { state: "expired", daysLeft, date: exp };
  if (daysLeft <= leadDays) return { state: "expiring", daysLeft, date: exp };
  return null;
}
