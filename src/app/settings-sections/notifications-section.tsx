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
  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "notifications")}
        <InfoTooltip text={t(lang, "notificationsTooltip")} />
      </span>
      <p className="mb-2 text-xs text-muted-foreground">
        {t(lang, "notificationsHint")}
      </p>
      <label className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
        <span className="inline-flex items-center gap-1">
          {t(lang, "reminderLeadDays")}
          <InfoTooltip text={t(lang, "reminderLeadDaysTooltip")} />
        </span>
        <input type="number" min={0} max={365}
          value={settings.notifications.reminderLeadDays}
          onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, reminderLeadDays: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) } })}
          className="w-20 rounded-md border border-line px-2 py-1 text-right tabular-nums" />
      </label>
      <NotificationRow
        labelKey="notifBanner"
        lang={lang}
        config={settings.notifications.banner}
        onChange={(c) =>
          onChange({
            ...settings,
            notifications: { ...settings.notifications, banner: c },
          })
        }
      />
      <NotificationRow
        labelKey="notifToast"
        lang={lang}
        config={settings.notifications.toast}
        onChange={(c) =>
          onChange({
            ...settings,
            notifications: { ...settings.notifications, toast: c },
          })
        }
      />
      <NotificationRow
        labelKey="notifPopup"
        lang={lang}
        config={settings.notifications.popup}
        onChange={(c) =>
          onChange({
            ...settings,
            notifications: { ...settings.notifications, popup: c },
          })
        }
      />
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.notifications.birthday.enabled}
            onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, birthday: { enabled: e.target.checked } } })} />
          {t(lang, "notifBirthday")}
        </label>
        <InfoTooltip text={t(lang, "notifBirthdayTooltip")} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.notifications.raidReview.enabled}
            onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, raidReview: { enabled: e.target.checked } } })}
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          {t(lang, "notifRaidReview")}
        </label>
        <InfoTooltip text={t(lang, "notifRaidReviewTooltip")} />
      </div>
      <label className="mt-2 flex items-center justify-between gap-2 text-sm text-foreground">
        <span className="inline-flex items-center gap-1">
          {t(lang, "raidReviewIntervalDays")}
          <InfoTooltip text={t(lang, "raidReviewIntervalDaysTooltip")} />
        </span>
        <input
          type="number" min={1} max={365}
          aria-label={t(lang, "raidReviewIntervalDays")}
          value={settings.notifications.raidReviewIntervalDays}
          onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, raidReviewIntervalDays: Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 14))) } })}
          className="w-20 rounded-md border border-line px-2 py-1 text-right tabular-nums"
        />
      </label>
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.notifications.stakeholderComms.enabled}
            onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, stakeholderComms: { enabled: e.target.checked } } })}
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          {t(lang, "notifStakeholderComms")}
        </label>
        <InfoTooltip text={t(lang, "notifStakeholderCommsTooltip")} />
      </div>
    </div>
  );
}

function NotificationRow({
  labelKey,
  lang,
  config,
  onChange,
}: {
  labelKey: TranslationKey;
  lang: Lang;
  config: ChannelConfig;
  onChange: (c: ChannelConfig) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
        />
        <span className="text-foreground">
          {t(lang, labelKey)}
        </span>
      </label>
    </div>
  );
}
