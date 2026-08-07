"use client";

import type { AriaRole, ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { useConfirm } from "./confirm-dialog";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import type { UpcomingBirthday } from "./birthdays";
import { resourceDisplayName } from "./resource-foundation";
import { formatExpiryDate } from "./date-format";
import type { JiraTokenAlert } from "./jira-token-status";
import type { StorageErrorKind } from "./storage-error";
import { Banner, type BannerSeverity } from "./banner";
import { Button } from "./button";

function DismissButton({ lang, onClick }: { lang: Lang; onClick: () => void }) {
  return (
    <Button variant="secondary" size="xs" onClick={onClick} aria-label={t(lang, "alertBannerDismiss")}>
      {t(lang, "alertBannerDismiss")}
    </Button>
  );
}

// ★★ `role` defaults to the labelled-landmark `"region"` these banners have
// always used — right for the snoozeable, informational ones, which sit there
// waiting to be found. It is a PER-CALLER override, not a change to `Banner`'s
// own severity-driven default (`banner.tsx`), because one caller genuinely needs
// `"alert"`: see `TruncatedLoadBanner`.
function AlertBanner({
  severity, role = "region", ariaLabel, icon, children, actions,
}: { severity: BannerSeverity; role?: AriaRole; ariaLabel: string; icon: string; children: ReactNode; actions: ReactNode }) {
  return (
    <Banner severity={severity} role={role} aria-label={ariaLabel}
      className="mb-6 flex flex-wrap items-center gap-3">
      <span aria-hidden className="text-lg">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex gap-2">{actions}</div>
    </Banner>
  );
}

function SnoozeMenu({ lang, onSnooze }: { lang: Lang; onSnooze: (ms: number) => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-ui-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted dark:border-line">
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
    <AlertBanner severity="info" ariaLabel={t(lang, "birthdayBannerAria")} icon="🎂"
      actions={<><SnoozeMenu lang={lang} onSnooze={onSnooze} /><DismissButton lang={lang} onClick={onDismiss} /></>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "birthdayBannerTitle", items.length)}</p>
      <p className="text-xs text-ui-dark-blue dark:text-ui-light-grey">{summary}</p>
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
    <AlertBanner severity="warn" ariaLabel={t(lang, "jiraTokenBannerAria")} icon="⚠"
      actions={<><SnoozeMenu lang={lang} onSnooze={onSnooze} /><DismissButton lang={lang} onClick={onDismiss} /></>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{msg}</p>
    </AlertBanner>
  );
}

export function StorageBanner({
  kind, lang, onOpenSettings, onDismiss,
}: { kind: StorageErrorKind; lang: Lang; onOpenSettings: () => void; onDismiss: () => void }) {
  const msg =
    kind === "auth"
      ? t(lang, "storageAuthBanner")
      : kind === "generic"
        ? t(lang, "storageSaveFailedBanner")
        : t(lang, "storageUnreachableBanner");
  return (
    <AlertBanner severity="error" ariaLabel={t(lang, "storageBannerAria")} icon="⚠"
      actions={<>
        <Button variant="primary" size="xs" onClick={onOpenSettings}>
          {t(lang, "storageBannerOpenSettings")}
        </Button>
        <DismissButton lang={lang} onClick={onDismiss} />
      </>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{msg}</p>
    </AlertBanner>
  );
}

/** §102 — a load that truncated the documents array pauses autosave (see
 *  `use-load-truncation.ts`). This banner is the ONLY route out: the user cannot
 *  get under the cap by editing, because the excess entries were never loaded.
 *  ★★ Dismissing hides the banner but must NOT clear `loadWasTruncated` — the
 *  save guard stays armed. Only "Save anyway" resolves it.
 *
 *  ★★ `role="alert"`, NOT the `"region"` its siblings use. The other three sit
 *  and wait to be found; this one arrives asynchronously AFTER a load, reports
 *  an ongoing blocking state, and is the sole exit from a save lockout — a
 *  landmark nobody navigates to announces none of that.
 *
 *  ★★★ THE PRIMARY ACTION IS DESTRUCTIVE AND GATED. "Save anyway" permanently
 *  discards whatever could not be opened, and it is the FIRST tabbable control
 *  inside `<main>`, so a stray Enter would have destroyed data on a `variant=
 *  "primary"` button that looked exactly like `StorageBanner`'s benign "Open
 *  settings". It now routes through `ConfirmDialog` — the LIGHTER tier, not
 *  `TypeToConfirmDialog`: type-a-phrase friction on a user's only exit from a
 *  lockout is punitive, and unlike "clear all tasks" they did not choose to be
 *  here. Deleting ONE document already costs a `ConfirmDialog`
 *  (`documents-panel.tsx`); discarding N of them cannot cost less.
 *
 *  ★ `truncation` may be `null` (counts unknown) — the decision is then made on
 *  a screen showing no magnitude, so pass them whenever the guard has them. */
export function TruncatedLoadBanner({
  lang, truncation, dismissed, hasFooterIndicator, onSaveAnyway, onDismiss, onReopen,
}: {
  lang: Lang;
  truncation: { entries: number; blocks: number } | null;
  /** Hidden by the user. The save guard stays armed either way. */
  dismissed: boolean;
  /** The layout shows a persistent "saving paused" control elsewhere (the modern
   *  shell's sidebar footer). FALSE in the classic layout, which has none. */
  hasFooterIndicator: boolean;
  onSaveAnyway: () => void;
  onDismiss: () => void;
  onReopen: () => void;
}) {
  const confirm = useConfirm();
  // ★ Entries dominate when both are present, mirroring `useLoadTruncation`'s own
  // `truncationText` — losing whole documents is the larger loss, and the banner
  // must not disagree with the toast the same load already fired.
  const countText =
    truncation == null
      ? null
      : truncation.entries > 0
        ? t(lang, "documentsTruncatedEntriesCount", truncation.entries)
        : truncation.blocks > 0
          ? t(lang, "documentsTruncatedBlocksCount", truncation.blocks)
          : null;
  const askThenSave = async () => {
    const body = t(lang, "documentsTruncatedConfirmBody");
    const ok = await confirm({
      title: t(lang, "documentsTruncatedConfirmTitle"),
      // The dialog renders `whitespace-pre-line`, so the count leads its own line.
      message: countText ? `${countText}\n\n${body}` : body,
      confirmLabel: t(lang, "documentsTruncatedSaveAnyway"),
    });
    if (ok) onSaveAnyway();
  };
  // ★★★ THE CLASSIC LAYOUT HAS NO SIDEBAR FOOTER, so dismissal there used to be
  // the very lockout this banner exists to prevent: `SidebarFooter` has ONE mount
  // in the app and it is inside `modernTree`, so a classic user who clicked ✕ lost
  // the only "Save anyway" surface for the session while saving stayed paused and
  // nothing on screen said so. Leaving a compact re-open chip is the minimum that
  // keeps dismissal honest — "stop shouting", never "stop telling me".
  // ★ NOT solved by refusing to dismiss in classic: a banner whose only exit is
  // the irreversible button makes destroying data the fastest way to clear your
  // screen. The chip keeps the escape reachable without the coercion.
  if (dismissed) {
    if (hasFooterIndicator) return null;
    return (
      <AlertBanner severity="warn" role="status" ariaLabel={t(lang, "storageSavingPaused")} icon="⏸"
        actions={
          <Button variant="secondary" size="xs" onClick={onReopen}>
            {t(lang, "storageSavingPausedAction")}
          </Button>
        }>
        <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "storageSavingPaused")}
        </p>
      </AlertBanner>
    );
  }
  return (
    <AlertBanner severity="error" role="alert" ariaLabel={t(lang, "documentsTruncatedBannerAria")} icon="⚠"
      actions={<>
        <Button variant="destructive" size="xs" onClick={() => { void askThenSave(); }}>
          {t(lang, "documentsTruncatedSaveAnyway")}
        </Button>
        <DismissButton lang={lang} onClick={onDismiss} />
      </>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "documentsTruncatedBanner")}
      </p>
      {countText && (
        <p className="text-xs text-ui-dark-blue dark:text-ui-light-grey">{countText}</p>
      )}
    </AlertBanner>
  );
}
