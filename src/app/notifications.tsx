"use client";

import type { ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import type { UpcomingBirthday } from "./birthdays";
import { resourceDisplayName } from "./resource-foundation";
import { formatExpiryDate } from "./date-format";
import type { JiraTokenAlert } from "./jira-token-status";

function DismissButton({ lang, onClick }: { lang: Lang; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={t(lang, "alertBannerDismiss")}
      className="rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
      {t(lang, "alertBannerDismiss")}
    </button>
  );
}

function AlertBanner({
  ariaLabel, icon, children, actions,
}: { ariaLabel: string; icon: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div role="region" aria-label={ariaLabel}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-pink/40 bg-AIPM-pink/10 px-4 py-3 dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15">
      <span aria-hidden className="text-lg">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

function SnoozeMenu({ lang, onSnooze }: { lang: Lang; onSnooze: (ms: number) => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted dark:border-line">
        {t(lang, "reminderSnooze")} ▾
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex flex-col rounded-md border border-line bg-surface py-1">
        <button type="button" onClick={() => onSnooze(SNOOZE_1H)}
          className="whitespace-nowrap px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted">
          {t(lang, "reminderSnooze1h")}
        </button>
        <button type="button" onClick={() => onSnooze(SNOOZE_1D)}
          className="whitespace-nowrap px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted">
          {t(lang, "reminderSnooze1d")}
        </button>
      </div>
    </details>
  );
}

export function birthdayToastText(items: UpcomingBirthday[], lang: Lang): string {
  return t(lang, "birthdayToast", items.length);
}

export function BirthdayBanner({
  items, lang, onDismiss, onSnooze,
}: { items: UpcomingBirthday[]; lang: Lang; onDismiss: () => void; onSnooze: (ms: number) => void }) {
  if (items.length === 0) return null;
  const summary = items
    .map((b) => `${resourceDisplayName(b.resource)} (${b.daysUntil === 0 ? t(lang, "birthdayToday") : t(lang, "birthdayInDays", b.daysUntil)})`)
    .join(", ");
  return (
    <AlertBanner ariaLabel={t(lang, "birthdayBannerAria")} icon="🎂"
      actions={<><SnoozeMenu lang={lang} onSnooze={onSnooze} /><DismissButton lang={lang} onClick={onDismiss} /></>}>
      <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "birthdayBannerTitle", items.length)}</p>
      <p className="text-xs text-AIPM-dark-blue dark:text-AIPM-light-grey">{summary}</p>
    </AlertBanner>
  );
}

export function JiraTokenBanner({
  alert, lang, onSnooze, onDismiss,
}: { alert: NonNullable<JiraTokenAlert>; lang: Lang; onSnooze: (ms: number) => void; onDismiss: () => void }) {
  const msg =
    alert.state === "invalid" ? t(lang, "jiraTokenInvalidBanner")
    : alert.state === "expired" ? t(lang, "jiraTokenExpiredBanner", formatExpiryDate(alert.date, lang))
    : t(lang, "jiraTokenExpiringBanner", alert.daysLeft, formatExpiryDate(alert.date, lang));
  return (
    <AlertBanner ariaLabel={t(lang, "jiraTokenBannerAria")} icon="⚠"
      actions={<><SnoozeMenu lang={lang} onSnooze={onSnooze} /><DismissButton lang={lang} onClick={onDismiss} /></>}>
      <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{msg}</p>
    </AlertBanner>
  );
}

export function StorageBanner({
  kind, lang, onOpenSettings, onDismiss,
}: { kind: "unreachable" | "auth"; lang: Lang; onOpenSettings: () => void; onDismiss: () => void }) {
  const msg = kind === "auth" ? t(lang, "storageAuthBanner") : t(lang, "storageUnreachableBanner");
  return (
    <AlertBanner ariaLabel={t(lang, "storageBannerAria")} icon="⚠"
      actions={<>
        <button type="button" onClick={onOpenSettings}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90">
          {t(lang, "storageBannerOpenSettings")}
        </button>
        <DismissButton lang={lang} onClick={onDismiss} />
      </>}>
      <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{msg}</p>
    </AlertBanner>
  );
}
