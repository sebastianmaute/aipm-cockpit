"use client";

import { type Lang, type TranslationKey, t } from "../i18n";
import type { ChannelConfig, Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface NotificationsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function NotificationsSection({ lang, settings, onChange }: NotificationsSectionProps) {
  const { notifications } = settings;

  function patchNotif(patch: Partial<typeof notifications>) {
    onChange({ ...settings, notifications: { ...notifications, ...patch } });
  }

  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "notifications")}
        <InfoTooltip text={t(lang, "notificationsTooltip")} />
      </span>
      <p className="mb-2 text-xs text-muted-foreground">
        {t(lang, "notificationsHint")}
      </p>

      {/* Global lead-time toggle */}
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={notifications.useGlobalLeadDays}
            onChange={(e) => patchNotif({ useGlobalLeadDays: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          {t(lang, "notifUseGlobalLeadDays")}
        </label>
      </div>
      <p className="mb-2 ml-6 text-xs text-muted-foreground">
        {t(lang, "notifGlobalLeadDaysHint")}
      </p>

      {/* Global lead days numeric input */}
      <label className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
        <span className="inline-flex items-center gap-1">
          {t(lang, "reminderLeadDays")}
          <InfoTooltip text={t(lang, "reminderLeadDaysTooltip")} />
        </span>
        <input
          type="number"
          min={0}
          max={365}
          aria-label={t(lang, "reminderLeadDays")}
          value={notifications.reminderLeadDays}
          onChange={(e) =>
            patchNotif({
              reminderLeadDays: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))),
            })
          }
          className="w-20 rounded-md border border-line px-2 py-1 text-right tabular-nums"
        />
      </label>

      {/* Banner */}
      <NotificationRow
        labelKey="notifBanner"
        lang={lang}
        config={notifications.banner}
        useGlobalLeadDays={notifications.useGlobalLeadDays}
        perReminderLabel={t(lang, "notifLeadDaysPerReminder")}
        onChange={(c) => patchNotif({ banner: c })}
      />

      {/* Toast */}
      <NotificationRow
        labelKey="notifToast"
        lang={lang}
        config={notifications.toast}
        useGlobalLeadDays={notifications.useGlobalLeadDays}
        perReminderLabel={t(lang, "notifLeadDaysPerReminder")}
        onChange={(c) => patchNotif({ toast: c })}
      />

      {/* Popup */}
      <NotificationRow
        labelKey="notifPopup"
        lang={lang}
        config={notifications.popup}
        useGlobalLeadDays={notifications.useGlobalLeadDays}
        perReminderLabel={t(lang, "notifLeadDaysPerReminder")}
        onChange={(c) => patchNotif({ popup: c })}
      />

      {/* Birthday */}
      <NotificationRow
        labelKey="notifBirthday"
        lang={lang}
        config={notifications.birthday}
        useGlobalLeadDays={notifications.useGlobalLeadDays}
        perReminderLabel={t(lang, "notifLeadDaysPerReminder")}
        tooltipKey="notifBirthdayTooltip"
        onChange={(c) => patchNotif({ birthday: c })}
      />

      {/* RAID review — uses raidReviewIntervalDays, not a per-reminder lead-days */}
      <NotificationRow
        labelKey="notifRaidReview"
        lang={lang}
        config={notifications.raidReview}
        useGlobalLeadDays={notifications.useGlobalLeadDays}
        perReminderLabel={t(lang, "notifLeadDaysPerReminder")}
        tooltipKey="notifRaidReviewTooltip"
        showLeadDays={false}
        onChange={(c) => patchNotif({ raidReview: c })}
      />

      {/* RAID review interval — NOT governed by the global lead-time toggle */}
      <label className="mt-2 flex items-center justify-between gap-2 text-sm text-foreground">
        <span className="inline-flex items-center gap-1">
          {t(lang, "raidReviewIntervalDays")}
          <InfoTooltip text={t(lang, "raidReviewIntervalDaysTooltip")} />
        </span>
        <input
          type="number"
          min={1}
          max={365}
          aria-label={t(lang, "raidReviewIntervalDays")}
          value={notifications.raidReviewIntervalDays}
          onChange={(e) =>
            patchNotif({
              raidReviewIntervalDays: Math.max(
                1,
                Math.min(365, Math.round(Number(e.target.value) || 14)),
              ),
            })
          }
          className="w-20 rounded-md border border-line px-2 py-1 text-right tabular-nums"
        />
      </label>

      {/* Stakeholder comms — uses hardcoded per-quadrant policy (14/7/7/3 days), not a per-reminder lead-days */}
      <NotificationRow
        labelKey="notifStakeholderComms"
        lang={lang}
        config={notifications.stakeholderComms}
        useGlobalLeadDays={notifications.useGlobalLeadDays}
        perReminderLabel={t(lang, "notifLeadDaysPerReminder")}
        tooltipKey="notifStakeholderCommsTooltip"
        showLeadDays={false}
        onChange={(c) => patchNotif({ stakeholderComms: c })}
      />

      {/* Jira token error banner toggle */}
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={notifications.jiraTokenError.enabled}
            onChange={(e) =>
              patchNotif({ jiraTokenError: { ...notifications.jiraTokenError, enabled: e.target.checked } })
            }
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          {t(lang, "notifJiraTokenError")}
        </label>
      </div>
    </div>
  );
}

interface NotificationRowProps {
  labelKey: TranslationKey;
  lang: Lang;
  config: ChannelConfig;
  useGlobalLeadDays: boolean;
  perReminderLabel: string;
  tooltipKey?: TranslationKey;
  /** Whether to render the per-reminder lead-days numeric input. Defaults to true.
   *  Set to false for channels that don't use lead-days (raidReview, stakeholderComms). */
  showLeadDays?: boolean;
  onChange: (c: ChannelConfig) => void;
}

function NotificationRow({
  labelKey,
  lang,
  config,
  useGlobalLeadDays,
  perReminderLabel,
  tooltipKey,
  showLeadDays = true,
  onChange,
}: NotificationRowProps) {
  const label = t(lang, labelKey);

  function handleLeadDaysChange(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange({ ...config, leadDays: undefined });
      return;
    }
    const n = Math.max(0, Math.min(365, Math.round(Number(trimmed) || 0)));
    onChange({ ...config, leadDays: n });
  }

  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          <span className="text-foreground">{label}</span>
        </label>
        {tooltipKey && <InfoTooltip text={t(lang, tooltipKey)} />}
      </div>
      {showLeadDays && (
        <input
          type="number"
          min={0}
          max={365}
          aria-label={perReminderLabel}
          disabled={useGlobalLeadDays}
          value={config.leadDays ?? ""}
          placeholder={useGlobalLeadDays ? "—" : ""}
          onChange={(e) => handleLeadDaysChange(e.target.value)}
          className="w-16 rounded-md border border-line px-2 py-1 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-40"
        />
      )}
    </div>
  );
}
