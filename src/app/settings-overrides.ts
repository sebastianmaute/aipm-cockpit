// src/app/settings-overrides.ts
//
// Pure validator for per-project POLICY overrides (Workspace.settingsOverrides).
// Each sub-key is a PARTIAL of the matching global config, carrying ONLY the
// fields a project overrides; an absent sub-key/field means "inherit". The
// sanitizer keeps only valid, provided fields, drops junk, and NEVER throws.
//
// Runtime reuse: nextActions clamping routes through the SINGLE source of truth
// NEXT_ACTIONS_FIELD_COERCE (settings-types); timezone strings are validated via
// isValidTimeZone (timezone.ts). Cross-refs are function-local (call-time), so
// the settings-types <-> workspace import cycle stays init-safe.

import {
  NEXT_ACTIONS_FIELD_COERCE,
  defaultNextActionsConfig,
  defaultNotificationsConfig,
  type ChannelConfig,
  type NextActionsConfig,
  type NotificationsConfig,
  type SettingsOverrides,
} from "./settings-types";
import { isValidTimeZone } from "./timezone";

/** Max additional timezones an override may carry (bounds a hostile import). */
const MAX_ADDITIONAL_TZ = 10;
/** Upper bound for any day-count field (mirrors the global sanitizers). */
const MAX_DAYS = 365;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Finite day count >= min, rounded and capped at MAX_DAYS; else undefined (drop). */
function numDay(v: unknown, min: number): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.min(MAX_DAYS, Math.round(n)) : undefined;
}

/** A channel override is kept only when `enabled` is an explicit boolean (its
 *  core field); an optional valid `leadDays` rides alongside. */
function channelOverride(v: unknown): ChannelConfig | undefined {
  if (!isObject(v) || typeof v.enabled !== "boolean") return undefined;
  const out: ChannelConfig = { enabled: v.enabled };
  const leadDays = numDay(v.leadDays, 0);
  if (leadDays !== undefined) out.leadDays = leadDays;
  return out;
}

type Quadrant = keyof NotificationsConfig["stakeholderCommsLeadDays"];

/** The nested per-quadrant lead-days record is a FULL record in the type, so it
 *  is emitted only when every quadrant is provided and valid; otherwise dropped
 *  (nested-partial overrides are out of scope for this phase). The quadrant keys
 *  are derived from the default config at CALL time (never module top-level) so
 *  the settings-types <-> workspace import cycle stays init-safe. */
function commsLeadDaysOverride(
  v: unknown,
): NotificationsConfig["stakeholderCommsLeadDays"] | undefined {
  if (!isObject(v)) return undefined;
  const quadrants = Object.keys(
    defaultNotificationsConfig.stakeholderCommsLeadDays,
  ) as Quadrant[];
  const out = {} as Record<Quadrant, number>;
  for (const q of quadrants) {
    const n = numDay(v[q], 0);
    if (n === undefined) return undefined;
    out[q] = n;
  }
  return out;
}

/** Keep only PROVIDED nextActions keys, each coerced via the shared per-field
 *  validator (an out-of-bounds value falls back to the field default). */
function sanitizeNextActionsOverride(raw: unknown): Partial<NextActionsConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const out: Partial<NextActionsConfig> = {};
  for (const key of Object.keys(NEXT_ACTIONS_FIELD_COERCE) as (keyof NextActionsConfig)[]) {
    if (!(key in raw)) continue;
    out[key] = NEXT_ACTIONS_FIELD_COERCE[key](raw[key], defaultNextActionsConfig[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Keep only valid, provided notification fields (scalars, channels, and the
 *  full per-quadrant lead-days record). */
function sanitizeNotificationsOverride(raw: unknown): Partial<NotificationsConfig> | undefined {
  if (!isObject(raw)) return undefined;
  const out: Partial<NotificationsConfig> = {};

  const reminderLeadDays = numDay(raw.reminderLeadDays, 0);
  if (reminderLeadDays !== undefined) out.reminderLeadDays = reminderLeadDays;
  if (typeof raw.useGlobalLeadDays === "boolean") out.useGlobalLeadDays = raw.useGlobalLeadDays;
  const raidReviewIntervalDays = numDay(raw.raidReviewIntervalDays, 1);
  if (raidReviewIntervalDays !== undefined) out.raidReviewIntervalDays = raidReviewIntervalDays;
  const dueSoonWorkdays = numDay(raw.dueSoonWorkdays, 1);
  if (dueSoonWorkdays !== undefined) out.dueSoonWorkdays = dueSoonWorkdays;

  const birthday = channelOverride(raw.birthday);
  if (birthday) out.birthday = birthday;
  const raidReview = channelOverride(raw.raidReview);
  if (raidReview) out.raidReview = raidReview;
  const stakeholderComms = channelOverride(raw.stakeholderComms);
  if (stakeholderComms) out.stakeholderComms = stakeholderComms;
  const jiraTokenError = channelOverride(raw.jiraTokenError);
  if (jiraTokenError) out.jiraTokenError = jiraTokenError;
  const desktopUrgent = channelOverride(raw.desktopUrgent);
  if (desktopUrgent) out.desktopUrgent = desktopUrgent;

  const stakeholderCommsLeadDays = commsLeadDaysOverride(raw.stakeholderCommsLeadDays);
  if (stakeholderCommsLeadDays) out.stakeholderCommsLeadDays = stakeholderCommsLeadDays;

  return Object.keys(out).length ? out : undefined;
}

/** Keep a valid override timezone + a deduped, validated, capped additional list. */
function sanitizeTimezoneOverride(
  raw: unknown,
): { timezone?: string; additionalTimezones?: string[] } | undefined {
  if (!isObject(raw)) return undefined;
  const out: { timezone?: string; additionalTimezones?: string[] } = {};
  if (typeof raw.timezone === "string" && isValidTimeZone(raw.timezone)) {
    out.timezone = raw.timezone;
  }
  if (Array.isArray(raw.additionalTimezones)) {
    const seen = new Set<string>();
    // Cap the SCANNED length (not just the kept set) so a hostile array of many
    // invalid strings can't force an unbounded number of Intl constructions.
    const scan = raw.additionalTimezones.slice(0, MAX_ADDITIONAL_TZ * 20);
    for (const v of scan) {
      if (seen.size >= MAX_ADDITIONAL_TZ) break;
      if (typeof v === "string" && isValidTimeZone(v)) seen.add(v);
    }
    if (seen.size) out.additionalTimezones = [...seen];
  }
  return out.timezone !== undefined || out.additionalTimezones !== undefined ? out : undefined;
}

/** Validate untrusted per-project overrides. Emits a sub-key ONLY when it holds
 *  >= 1 valid field; returns {} when nothing valid. Never throws. */
export function sanitizeSettingsOverrides(raw: unknown): SettingsOverrides {
  if (!isObject(raw)) return {};
  const out: SettingsOverrides = {};
  const nextActions = sanitizeNextActionsOverride(raw.nextActions);
  if (nextActions) out.nextActions = nextActions;
  const notifications = sanitizeNotificationsOverride(raw.notifications);
  if (notifications) out.notifications = notifications;
  const timezone = sanitizeTimezoneOverride(raw.timezone);
  if (timezone) out.timezone = timezone;
  return out;
}

/** True iff any override sub-key is present. */
export function hasAnyOverride(o?: SettingsOverrides): boolean {
  return (
    !!o &&
    (o.nextActions !== undefined || o.notifications !== undefined || o.timezone !== undefined)
  );
}
