import type { SteeringCommittee } from "./types";

export type ReminderTier = "now" | "soon" | "upcoming";

export interface InfoReminder {
  meetingId: number;
  scheduleId: number;
  label: string;
  meetingTitle: string;
  meetingDate: string;
  dueDate: string;
  daysLeft: number;
  tier: ReminderTier;
}

const SOON_DAYS = 5;
const MS_PER_DAY = 86_400_000;

/** Step `n` working days BACKWARD from an ISO date (skip Sat/Sun). Pure, UTC-based to avoid TZ drift. */
function subtractWorkingDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * For each FUTURE meeting x infoSchedule, compute the info due-date (leadDays
 * working days before the meeting) and a tier. `today` is always passed in so
 * the engine stays test-pure. Never throws: undefined/empty -> [].
 */
export function dueInfoReminders(
  committee: SteeringCommittee | undefined,
  today: string,
): InfoReminder[] {
  if (!committee) return [];
  const out: InfoReminder[] = [];
  for (const m of committee.meetings) {
    if (daysBetween(today, m.date) < 0) continue; // past meeting
    for (const s of committee.infoSchedules) {
      const dueDate = subtractWorkingDays(m.date, s.leadDays);
      const daysLeft = daysBetween(today, dueDate);
      const tier: ReminderTier =
        daysLeft <= 0 ? "now" : daysLeft <= SOON_DAYS ? "soon" : "upcoming";
      out.push({
        meetingId: m.id,
        scheduleId: s.id,
        label: s.label,
        meetingTitle: m.title,
        meetingDate: m.date,
        dueDate,
        daysLeft,
        tier,
      });
    }
  }
  return out;
}
