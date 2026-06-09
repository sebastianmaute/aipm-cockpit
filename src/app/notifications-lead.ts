// src/app/notifications-lead.ts
import type { NotificationsConfig } from "./settings-types";

type LeadChannel = "banner" | "toast" | "popup" | "birthday";

export function effectiveLeadDays(
  cfg: NotificationsConfig,
  channel: LeadChannel,
): number {
  if (cfg.useGlobalLeadDays) return cfg.reminderLeadDays;
  return cfg[channel].leadDays ?? cfg.reminderLeadDays;
}
