"use client";

import { useRef, useState } from "react";
import type { AriaRole, ReactNode } from "react";
import { type Lang, t, tPlural } from "./i18n";
import { useConfirm } from "./confirm-dialog";
import { FOCUS_RING } from "./interaction-styles";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import type { UpcomingBirthday } from "./birthdays";
import { resourceDisplayName } from "./resource-foundation";
import { formatExpiryDate, formatFetchedAt } from "./date-format";
import type { OtherJournal } from "./use-other-journals";
import type { JiraTokenAlert } from "./jira-token-status";
import type { StorageErrorKind } from "./storage-error";
import { isKeptProjectKey, journalKeyProject } from "./unload-journal";
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
// `"alert"`: see `SavingPausedBanner`.
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
  return tPlural(lang, "birthdayToast", items.length, items.length);
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
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{tPlural(lang, "birthdayBannerTitle", items.length, items.length)}</p>
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
    : tPlural(lang, "jiraTokenExpiringBanner", alert.daysLeft, alert.daysLeft, formatExpiryDate(alert.date, lang));
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
      : kind === "auth-env"
        ? t(lang, "storageAuthEnvBanner")
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

/** §650 — the saved Anthropic API key was rejected (401), is not allowed (403), or cannot be read
 *  on this device. Mirrors `StorageBanner`: one action into Settings → AI, and a dismiss that
 *  holds for this page only (the verdict is re-derived on the next load). */
export function AiKeyBanner({
  status, lang, onOpenSettings, onDismiss,
}: { status: "rejected" | "forbidden" | "unreadable"; lang: Lang; onOpenSettings: () => void; onDismiss: () => void }) {
  const msg =
    status === "rejected"
      ? t(lang, "aiKeyRejected")
      : status === "forbidden"
        ? t(lang, "aiKeyForbidden")
        : t(lang, "aiKeyUnreadable");
  return (
    <AlertBanner severity="error" ariaLabel={t(lang, "aiKeyBannerAria")} icon="⚠"
      actions={<>
        <Button variant="primary" size="xs" onClick={onOpenSettings}>
          {t(lang, "aiKeyOpenSettings")}
        </Button>
        <DismissButton lang={lang} onClick={onDismiss} />
      </>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{msg}</p>
    </AlertBanner>
  );
}

/** §629 — the unload journal's conflict notice: the last session's unsaved changes were kept
 *  but not applied, because the project changed elsewhere since. No dismiss: it stays until the
 *  user decides, since the journal it describes stays in storage until then. */
export function UnloadJournalConflictBanner({
  lang, onRestoreAnyway, onDiscard,
}: { lang: Lang; onRestoreAnyway: () => void; onDiscard: () => void }) {
  return (
    <AlertBanner severity="warn" ariaLabel={t(lang, "unloadJournalConflict")} icon="⚠"
      actions={<>
        <Button variant="primary" size="xs" onClick={onRestoreAnyway}>
          {t(lang, "unloadJournalRestoreAnyway")}
        </Button>
        <Button variant="secondary" size="xs" onClick={onDiscard}>
          {t(lang, "unloadJournalDiscard")}
        </Button>
      </>}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "unloadJournalConflict")}</p>
    </AlertBanner>
  );
}

/** §632 — the name a journal entry is shown under: its registry project's name, else its key, with
 *  the `browser` and `turso` fallback keys translated. */
function journalName(lang: Lang, entry: OtherJournal): string {
  if (entry.label !== null) return entry.label;
  const key = journalKeyProject(entry.journal.projectKey); // §4 — a kept slot is named after its project
  if (key === "browser") return t(lang, "unloadJournalKeyBrowser");
  if (key === "turso") return t(lang, "unloadJournalKeyTurso");
  return key;
}

/** §632 — one line per journal (name, date, size) with Download and, when `onDiscard` is given,
 *  Discard; the buttons carry the entry's name. A refused download is named in an alert. */
function JournalList({
  lang, entries, onDownload, onDiscard, canRestore, onRestore, onRestored,
}: {
  lang: Lang;
  entries: readonly OtherJournal[];
  onDownload: (entry: OtherJournal) => boolean;
  onDiscard?: (entry: OtherJournal) => void;
  /** §655 — which entries offer Restore (a kept version of the project in scope). */
  canRestore?: (entry: OtherJournal) => boolean;
  /** False when the restore was refused (its row then stays, and so does focus). */
  onRestore?: (entry: OtherJournal) => boolean | void;
  /** Called after a Restore that happened: the row the focus was on is gone, so the banner takes it. */
  onRestored?: () => void;
}) {
  const [downloadFailed, setDownloadFailed] = useState<string | null>(null);
  const confirm = useConfirm();
  const askThenRestore = async (entry: OtherJournal) => {
    if (!onRestore) return;
    const ok = await confirm({
      title: t(lang, "unloadJournalKeptRestoreConfirmTitle"),
      message: t(lang, "unloadJournalKeptRestoreConfirmBody"),
      // Distinct from the row's own label, which stays on screen behind the dialog.
      confirmLabel: t(lang, "unloadJournalKeptRestoreConfirmAction"),
      tone: "default",
    });
    if (!ok) return;
    if (onRestore(entry) !== false) onRestored?.();
  };
  const names = entries.map((entry) => journalName(lang, entry));
  const dates = entries.map((entry) => formatFetchedAt(new Date(entry.journal.savedAt).toISOString(), lang));
  // §4 — two kept versions of one project share a name: the buttons then add the date, so each is row-unique.
  const dated = names.map((shown, i) => (names.indexOf(shown) === names.lastIndexOf(shown) ? shown : `${shown} (${dates[i]})`));
  // ...and the date is shown to the minute, so two written within one minute still collide: an ordinal separates them.
  const labels = dated.map((label, i) => (dated.indexOf(label) === dated.lastIndexOf(label) ? label : `${label} (${dated.slice(0, i + 1).filter((d) => d === label).length})`));
  return (
    <>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map((entry, i) => {
          const shown = names[i];
          const date = dates[i];
          const name = labels[i];
          return (
            <li key={`${entry.journal.projectKey}:${entry.journal.tabId}:${entry.journal.savedAt}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 break-all">
                {t(lang, entry.unreadable ? "unloadJournalUnreadableEntry" : isKeptProjectKey(entry.journal.projectKey) ? "unloadJournalKeptEntry" : "unloadJournalOthersEntry", shown, date, // §4 — a kept version was refused, and no reload restores it
                  Math.max(1, Math.ceil(entry.journal.workspace.length / 1024)))}
              </span>
              <Button variant="secondary" size="xs" aria-label={`${t(lang, "unloadJournalDownload")}: ${name}`}
                onClick={() => setDownloadFailed(onDownload(entry) ? null : name)}>
                {t(lang, "unloadJournalDownload")}
              </Button>
              {onRestore && canRestore?.(entry) && (
                <Button variant="secondary" size="xs" aria-label={`${t(lang, "unloadJournalRestore")}: ${name}`} onClick={() => { void askThenRestore(entry); }}>
                  {t(lang, "unloadJournalRestore")}
                </Button>
              )}
              {onDiscard && (
                <Button variant="secondary" size="xs" aria-label={`${t(lang, "unloadJournalDiscard")}: ${name}`} onClick={() => onDiscard(entry)}>
                  {t(lang, "unloadJournalDiscard")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {downloadFailed !== null && <p role="alert" className="mt-1 text-sm">{t(lang, "unloadJournalDownloadFailed", downloadFailed)}</p>}
    </>
  );
}

/** §632 — unload journals kept under OTHER keys (use-other-journals.ts), each with Download and
 *  Discard. Dismiss hides the notice for this page only; the records stay. */
export function OtherJournalsBanner({
  lang, others, onDownload, onDiscard, onDismiss, canRestore, onRestore,
}: {
  lang: Lang;
  others: readonly OtherJournal[];
  onDownload: (entry: OtherJournal) => boolean;
  onDiscard: (entry: OtherJournal) => void;
  onDismiss: () => void;
  canRestore?: (entry: OtherJournal) => boolean;
  onRestore?: (entry: OtherJournal) => boolean | void;
}) {
  // §668 — an unreadable draft cannot be restored by reloading: when it is all the notice holds, its heading
  // must not say "other projects … reload to restore". It names no project, since the mark outlives a
  // switch to another project on the same page.
  const heading = t(lang, others.length > 0 && others.every((entry) => entry.unreadable) ? "unloadJournalUnreadableOnly" : "unloadJournalOthers");
  // a11y — a confirmed Restore removes the row whose button had focus; the heading takes it, so focus
  // does not fall to <body>.
  const headingRef = useRef<HTMLParagraphElement>(null);
  return (
    <AlertBanner severity="info" ariaLabel={heading} icon="ℹ"
      actions={<DismissButton lang={lang} onClick={onDismiss} />}>
      <p ref={headingRef} tabIndex={-1} className={`text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey ${FOCUS_RING}`}>{heading}</p>
      {others.some((entry) => isKeptProjectKey(entry.journal.projectKey)) && (
        <p className="mt-1 text-sm">{t(lang, onRestore && canRestore && others.some(canRestore) ? "unloadJournalKeptHintRestore" : "unloadJournalKeptHint")}</p>
      )}
      {others.some((entry) => entry.unreadable) && <p className="mt-1 text-sm">{t(lang, "unloadJournalUnreadableHint")}</p>}
      <JournalList lang={lang} entries={others} onDownload={onDownload} onDiscard={onDiscard} canRestore={canRestore} onRestore={onRestore} onRestored={() => headingRef.current?.focus()} />
    </AlertBanner>
  );
}

/** §632 — the journals older than 30 days the load removed, so none goes silently: each is named, and
 *  its in-memory copy can still be downloaded until the notice is dismissed. */
export function ExpiredJournalsBanner({
  lang, expired, onDownload, onDismiss,
}: {
  lang: Lang;
  expired: readonly OtherJournal[];
  onDownload: (entry: OtherJournal) => boolean;
  onDismiss: () => void;
}) {
  const msg = tPlural(lang, "unloadJournalExpired", expired.length, expired.length);
  return (
    <AlertBanner severity="info" ariaLabel={msg} icon="ℹ" actions={<DismissButton lang={lang} onClick={onDismiss} />}>
      <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{msg}</p>
      <JournalList lang={lang} entries={expired} onDownload={onDownload} />
    </AlertBanner>
  );
}

/** WHY saving is paused. The two causes cannot be active at once, and it takes
 *  TWO mechanisms.
 *  See `use-destructive-save-guard.ts`'s header. */
export type SavingPausedCause =
  | {
      kind: "truncation";
      /** ★ May be `null` (counts unknown) — the decision is then made on a
       *  screen showing no magnitude, so pass them whenever the guard has them. */
      truncation: { entries: number; blocks: number } | null;
      /** How many stored slices the load could not DECODE — the guard's second
       *  cause, `null` truncation and all. ★ Without it the count line and the
       *  confirm dialog name no magnitude at all on that path, and the dialog is the
       *  last thing the user sees before permanently discarding the data. */
      decodeFailureCount: number;
      /** How many CSV quoting violations the imported file carried — the guard's
       *  THIRD cause. ★★★ Threaded for the same reason `decodeFailureCount` is, and
       *  omitted for a release for want of asking: this cause commonly arrives with
       *  `truncation` null AND `decodeFailureCount` 0 (a file backend has no meta
       *  blob to fail decoding), so without it the banner rendered a headline with
       *  NO magnitude line and `askThenSave` fell through to `message: body` — the
       *  permanent-discard confirm naming nothing at all, which is precisely what
       *  the note on `decodeFailureCount` says the count is threaded to prevent. */
      malformedQuoteCount: number;
    }
  | {
      kind: "destructive";
      prevRecords: number;
      curRecords: number;
      fullWipe: boolean;
    }
  | {
      /** §586/§587: the ACTIVE backend's save gate is shut because its load FAILED, or came back
       *  EMPTY over a populated project and was refused. ★ Unlike the other two causes there is
       *  NOTHING to "save anyway" — the live workspace is the empty boot one or the PREVIOUS
       *  target's project — so the primary action is a non-destructive "Reload project". */
      kind: "load";
      reason: "load-failed" | "empty-refused";
    }
  | {
      /** §4: a save was refused because another tab or device saved first. Three exits, and two of them
       *  throw a version away, so each asks: Reload (the stored version wins; `onSaveAnyway`), Overwrite
       *  (this one wins; `onOverwrite`), and Download my version (`onDownload`, discards nothing). */
      kind: "conflict";
    };

/** The headline, aria-label and count line for the TRUNCATION cause. Pure
 *  string selection — every landmine about WHY this banner exists, and why its
 *  primary action is gated the way it is, lives on `SavingPausedBanner` below. */
function truncationCopy(lang: Lang, c: Extract<SavingPausedCause, { kind: "truncation" }>): {
  countText: string | null;
  bannerKey: "documentsTruncatedBanner" | "documentsUnreadableBanner";
  bannerAriaKey: "documentsTruncatedBannerAria" | "documentsUnreadableBannerAria";
} {
  const { truncation, decodeFailureCount, malformedQuoteCount } = c;
  // ★ Entries dominate BLOCKS when both are present, mirroring
  // `useLoadTruncation`'s own `truncationText` — losing whole documents is the
  // larger loss, and the banner must not disagree with the toast the same load
  // already fired.
  const truncationCount =
    truncation != null && truncation.entries > 0
      ? tPlural(lang, "documentsTruncatedEntriesCount", truncation.entries, truncation.entries)
      : truncation != null && truncation.blocks > 0
        ? tPlural(lang, "documentsTruncatedBlocksCount", truncation.blocks, truncation.blocks)
        : null;
  // ★★★ A JOIN ACROSS THE TWO CAUSES, NEVER A THIRD TERNARY ARM. The decode
  // count used to sit below the two truncation arms under a comment calling the
  // causes "mutually exclusive in practice", and they are not: `rowsToWorkspace`
  // accumulates both into ONE `DocTruncationDiag`, so a load whose `documents`
  // blob overflowed the cap while an unrelated slice (`settings_overrides`,
  // `insights`, `activityLog`) threw reports both at once. The short-circuit then
  // dropped the decode magnitude on the floor — and unlike the toast, which is
  // single-slot and gone in 7s, this line and the confirm dialog it feeds are the
  // only PERSISTENT surface either magnitude has, so it reached the user nowhere
  // at all. `refuseWrite` (`use-load-truncation.ts`) already joins the same two
  // parts for the same reason; this follows it rather than inventing a second
  // rule. Both strings are complete sentences in EN and DE, so a single space is
  // the whole composition.
  // ★ Each single-cause case still renders EXACTLY one sentence, unchanged: the
  // join is only visible when both hold.
  // ★ The join now spans THREE causes for the same reason it spanned two: they
  // are not mutually exclusive, and each single-cause case still renders exactly
  // one sentence.
  const countParts = [
    truncationCount,
    decodeFailureCount > 0 ? tPlural(lang, "documentsUnreadableCount", decodeFailureCount, decodeFailureCount) : null,
    malformedQuoteCount > 0 ? tPlural(lang, "importMalformedQuotesCount", malformedQuoteCount, malformedQuoteCount) : null,
  ].filter((part): part is string => part !== null);
  const countText = countParts.length > 0 ? countParts.join(" ") : null;
  // ★★★ THE HEADLINE FOLLOWS THE CAUSE, because "document data" was true of only
  // one of the two. Truncation IS about documents — the cap cuts document
  // entries and blocks — but the decode cause reaches every `reportUnreadableSlice`
  // slice, not just documents (re-derive the list rather than trusting a count
  // here — it has rotted before: `grep -o 'reportUnreadableSlice("[a-zA-Z_]*"'
  // src/app/turso-schema.ts`), so a corrupt `steering_committee` blob in a
  // project with NO documents announced itself as document data, the user read
  // a headline that plainly did not apply to them, and clicked "Save anyway".
  // That button is a PERMANENT discard, and it was being pressed on a screen
  // that misnamed what was being discarded.
  // ★★ TRUNCATION-ONLY keeps the original, narrower wording — nothing about the
  // truncation copy regresses. Every other case takes the wider one, INCLUDING
  // the case where both causes hold: `rowsToWorkspace` accumulates them into one
  // diagnostic, so both really can arrive together, and the only headline
  // accurate for that pair is the one that names neither cause specifically.
  // ★ The count line below still names each magnitude in its own vocabulary
  // ("N document entries…", "N kinds of saved data…"), so the specificity the
  // wider headline gives up is not lost — it moves one line down.
  // ★★ ALL THREE causes gate the narrower headline, not two. "Document data" is
  // true of truncation alone; a malformed import is not about documents at all,
  // so a truncation+malformed load must take the wider wording for the same
  // reason the truncation+decode pair does.
  const truncationOnly = truncation != null && decodeFailureCount === 0 && malformedQuoteCount === 0;
  const bannerKey = truncationOnly ? "documentsTruncatedBanner" : "documentsUnreadableBanner";
  const bannerAriaKey = truncationOnly ? "documentsTruncatedBannerAria" : "documentsUnreadableBannerAria";
  return { countText, bannerKey, bannerAriaKey };
}

/** The headline, aria-label and count line for the DESTRUCTIVE cause. Pure
 *  string selection, mirroring `truncationCopy` — the tier decision this copy
 *  feeds lives on `SavingPausedBanner` below.
 *  ★ The full wipe names NO arithmetic: `prevRecords - curRecords` is a true but
 *  useless "900 of 900", and a reader scanning a number for proportion reads the
 *  worst case as just another large deletion. */
function destructiveCopy(lang: Lang, c: Extract<SavingPausedCause, { kind: "destructive" }>): {
  countText: string;
  bannerKey: "storageDestructiveBanner";
  bannerAriaKey: "storageDestructiveBannerAria";
} {
  return {
    countText: c.fullWipe
      ? t(lang, "storageDestructiveWipeCount")
      : t(lang, "storageDestructiveCount", c.prevRecords - c.curRecords, c.prevRecords),
    bannerKey: "storageDestructiveBanner",
    bannerAriaKey: "storageDestructiveBannerAria",
  };
}

/** The headline and aria-label for the LOAD cause (§586/§587). No count line: nothing was loaded,
 *  so there is no magnitude to name. ★ Two headlines, because "could not be loaded" is FALSE for the
 *  empty-load refusal — that load succeeded and came back empty (review I1). */
function loadCopy(c: Extract<SavingPausedCause, { kind: "load" }>): {
  countText: null;
  bannerKey: "storageSavePausedLoadFailed" | "storageSavePausedEmptyLoad";
  bannerAriaKey: "storageSavingPaused";
} {
  return {
    countText: null,
    bannerKey: c.reason === "empty-refused" ? "storageSavePausedEmptyLoad" : "storageSavePausedLoadFailed",
    bannerAriaKey: "storageSavingPaused",
  };
}

/** The CONFLICT cause's actions (§4). Reload and Overwrite each confirm first, with the exact question and a
 *  commit label of its own: the dialog opens over this banner, so the commit may not share the trigger's
 *  name. ★ Overwrite and Download render only when their handler is given — a banner that offered an
 *  action wired to nothing would be a promise with no one behind it. */
function ConflictActions({ lang, onReload, onOverwrite, onDownload }: {
  lang: Lang; onReload: () => void; onOverwrite?: () => void; onDownload?: () => void;
}) {
  const confirm = useConfirm();
  const askThen = async (message: "storageConflictReloadConfirm" | "storageConflictOverwriteConfirm",
    confirmLabel: "storageConflictReloadConfirmAction" | "storageConflictOverwriteConfirmAction", act: () => void) => {
    if (await confirm({ message: t(lang, message), confirmLabel: t(lang, confirmLabel) })) act();
  };
  return (
    <>
      <Button variant="destructive" size="xs" onClick={() => { void askThen("storageConflictReloadConfirm", "storageConflictReloadConfirmAction", onReload); }}>
        {t(lang, "storageConflictReload")}
      </Button>
      {onOverwrite && (
        <Button variant="destructive" size="xs" onClick={() => { void askThen("storageConflictOverwriteConfirm", "storageConflictOverwriteConfirmAction", onOverwrite); }}>
          {t(lang, "storageConflictOverwrite")}
        </Button>
      )}
      {onDownload && (
        <Button variant="secondary" size="xs" onClick={() => onDownload()}>
          {t(lang, "storageConflictDownload")}
        </Button>
      )}
    </>
  );
}

/** The ONE banner for "saving is paused", rendering whichever cause holds. It
 *  is the ONLY route out of either lockout, and dismissing it hides the banner
 *  but must NOT clear the underlying guard — only the confirmed primary action
 *  resolves one.
 *
 *  ★★ `role="alert"`, NOT the `"region"` its siblings use. The other three sit
 *  and wait to be found; this one arrives asynchronously AFTER a load or a
 *  refused save, reports an ongoing blocking state, and is the sole exit from
 *  that lockout — a landmark nobody navigates to announces none of that.
 *
 *  ★★★ THE PRIMARY ACTION IS DESTRUCTIVE AND GATED. It permanently discards
 *  data, and it is the FIRST tabbable control inside `<main>`, so a stray Enter
 *  would have destroyed data on a `variant="primary"` button that looked exactly
 *  like `StorageBanner`'s benign "Open settings".
 *
 *  ★★ THE TRUNCATION CAUSE (§103) TAKES THE LIGHTER TIER. A load that truncated
 *  the documents array pauses autosave (`use-load-truncation.ts`) and the user
 *  cannot get under the cap by editing, because the excess entries were never
 *  loaded. Its "Save anyway" routes through `ConfirmDialog`, NOT
 *  `TypeToConfirmDialog`: type-a-phrase friction on a user's only exit from a
 *  lockout they did not choose is punitive. Deleting ONE document already costs
 *  a `ConfirmDialog` (`documents-panel.tsx`); discarding N of them cannot cost
 *  less.
 *
 *  ★★ THE DESTRUCTIVE FULL-WIPE ARM TAKES THE HEAVIER TIER ANYWAY, and the
 *  anti-friction objection above lapses for one specific reason: the dismiss ✕
 *  and the re-open chip. "Save anyway" is NOT the only exit here — the user can
 *  quieten the banner and come back to it, or reload and lose nothing at all —
 *  so type-a-phrase friction is not coercive the way it would be on a lockout
 *  with a single door. IF A FUTURE CHANGE MAKES THIS BANNER NON-DISMISSIBLE,
 *  DROP THE HEAVY TIER WITH IT — the two are a pair, and keeping the friction
 *  after removing the escape converts it into exactly the punishment the
 *  truncation paragraph refuses.
 *
 *  ★★ A DESTRUCTIVE MASS DELETION KEEPS THE LIGHT TIER. It is recoverable by
 *  reload — the stored data is untouched until a save lands — and the magnitude
 *  line already names what would go, so the decision is made on a number either
 *  way. Only the wipe, where "what would go" is everything, buys the ceremony.
 *
 *  ★ The recourse lives on this banner and not ALSO on the toast — not
 *  because two mounted dialogs would collide (`TypeToConfirmDialog` ids are
 *  per-instance via `useId`, §326, so they no longer would), but because a
 *  toast auto-dismisses and is single-slot: a bad host for an irreversible
 *  button that needs to stay reachable until the user acts. */
export function SavingPausedBanner({
  lang, cause, dismissed, hasFooterIndicator, onSaveAnyway, onDiscard, onOverwrite, onDownload, onDismiss, onReopen,
}: {
  lang: Lang;
  cause: SavingPausedCause;
  /** Hidden by the user. The save guard stays armed either way. */
  dismissed: boolean;
  /** The layout shows a persistent "saving paused" control elsewhere (the modern
   *  shell's sidebar footer). FALSE in the classic layout, which has none. */
  hasFooterIndicator: boolean;
  /** The primary action: "save anyway" for truncation/destructive. For `load` it is "Reload
   *  project", rendered secondary and unconfirmed because it discards nothing. For `conflict` it is
   *  "Reload", confirmed, because it discards the unsaved edits. */
  onSaveAnyway: () => void;
  /** `destructive` only (§629): drop the withheld deletion by reloading the
   *  project from storage — the exit that also removes a restored unload
   *  journal, which a PAGE reload re-applies and the guard refuses again.
   *  Confirmed first, since it discards every unsaved change. Not rendered when
   *  absent. */
  onDiscard?: () => void;
  /** `conflict` only: save this version over the other one. Not rendered when absent. */
  onOverwrite?: () => void;
  /** `conflict` only: download this version. Not rendered when absent. */
  onDownload?: () => void;
  onDismiss: () => void;
  onReopen: () => void;
}) {
  const confirm = useConfirm();
  // ★ Unconditional, above every early return — the `dismissed` branch below
  // returns before the dialog can render, and a hook behind it would break the
  // rules of hooks the first time a banner was dismissed.
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const { countText, bannerKey, bannerAriaKey } =
    cause.kind === "destructive" ? destructiveCopy(lang, cause)
      : cause.kind === "load" ? loadCopy(cause)
        : cause.kind === "conflict" ? { countText: null, bannerKey: "storageSavePausedConflict" as const, bannerAriaKey: "storageSavingPaused" as const }
          : truncationCopy(lang, cause);
  // ★★ THREE trigger labels, not two.
  // ★ It stays distinct from `storageDestructiveWipeSaveAnyway`, the wipe
  // dialog's commit button: that dialog opens OVER this banner, so the two are
  // on screen together and sharing a name is the duplicate-name defect the whole
  // rest of this file is about.
  const saveLabel =
    cause.kind !== "destructive"
      ? t(lang, "documentsTruncatedSaveAnyway")
      : cause.fullWipe
        ? t(lang, "storageDestructiveWipeBannerSaveAnyway")
        : t(lang, "storageDestructiveSaveAnyway");
  const askThenSave = async () => {
    if (cause.kind === "destructive") {
      // ★★ RECOMPUTED inside the narrowed branch rather than reusing the
      // `countText` above. `cause.kind` narrows `cause`; it does NOT narrow a
      // separately-computed value, so the outer `countText` stays `string | null`
      // (the truncation arm may have no magnitude to name) and interpolating it
      // here would eventually render the literal text "null" into a dialog whose
      // confirm permanently discards data. `destructiveCopy` returns a
      // non-nullable `countText`, so this is impossible at the TYPE level — not
      // asserted away with a `!`, which would only hide the same union.
      const { countText: destructiveCountText } = destructiveCopy(lang, cause);
      const ok = await confirm({
        title: t(lang, "storageDestructiveConfirmTitle"),
        message: `${destructiveCountText}\n\n${t(lang, "storageDestructiveConfirmBody")}`,
        // ★★ NOT the trigger's own label. `ConfirmDialog` renders this as a
        // button while the banner stays mounted behind the open dialog, so
        // reusing `storageDestructiveSaveAnyway` would put two identically-named
        // buttons on screen — the SAME defect the wipe branch below avoids, one
        // tier down.
        confirmLabel: t(lang, "storageDestructiveConfirmSaveAnyway"),
      });
      if (ok) onSaveAnyway();
      return;
    }
    const body = t(lang, "documentsTruncatedConfirmBody");
    const ok = await confirm({
      title: t(lang, "documentsTruncatedConfirmTitle"),
      // The dialog renders `whitespace-pre-line`, so the count leads its own line.
      message: countText ? `${countText}\n\n${body}` : body,
      // ★★ FIXED HERE: this arm passed `documentsTruncatedSaveAnyway` — its own
      // trigger's string — so the banner's trigger and the dialog's commit button
      // carried the identical accessible name while both were on screen (WCAG
      // 2.4.6). The dialog comes from `ConfirmProvider`, so the banner never
      // unmounts behind it. The two labels must STAY distinct: the axe gate
      // provably cannot see a duplicate accessible name in any view at any seed
      // size, so only `notifications.test.tsx` guards this.
      confirmLabel: t(lang, "documentsTruncatedConfirmSaveAnyway"),
    });
    if (ok) onSaveAnyway();
  };
  const askThenDiscard = async () => {
    if (!onDiscard) return;
    const ok = await confirm({
      title: t(lang, "storageDestructiveDiscardConfirmTitle"),
      message: t(lang, "storageDestructiveDiscardConfirmBody"),
      // Distinct from the trigger's own label: the banner stays mounted behind
      // the dialog, so sharing it would put two same-named buttons on screen.
      confirmLabel: t(lang, "storageDestructiveDiscardConfirmAction"),
    });
    if (ok) onDiscard();
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
        {/* ★ The COUNT, not a second "Saving paused" — the region is already
            labelled that and the button says it again, so repeating it a third
            time spent the one line a classic user gets on nothing. Verified in a
            browser; the duplication is invisible to jsdom. Falls back to the
            status text only when the counts are unknown. */}
        <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {countText ?? t(lang, "storageSavingPaused")}
        </p>
      </AlertBanner>
    );
  }
  return (
    <>
      <AlertBanner severity="error" role="alert" ariaLabel={t(lang, bannerAriaKey)} icon="⚠"
        actions={<>
          {/* §629 — the SAFE exit leads, ahead of the destructive save. */}
          {cause.kind === "destructive" && onDiscard && (
            <Button variant="secondary" size="xs" onClick={() => { void askThenDiscard(); }}>
              {t(lang, "storageDestructiveDiscard")}
            </Button>
          )}
          {cause.kind === "load" ? (
            <Button variant="secondary" size="xs" onClick={onSaveAnyway}>
              {t(lang, "reloadProject")}
            </Button>
          ) : cause.kind === "conflict" ? (
            <ConflictActions lang={lang} onReload={onSaveAnyway} onOverwrite={onOverwrite} onDownload={onDownload} />
          ) : (
          <Button variant="destructive" size="xs" onClick={() => {
            if (cause.kind === "destructive" && cause.fullWipe) { setWipeConfirmOpen(true); return; }
            void askThenSave();
          }}>
            {saveLabel}
          </Button>
          )}
          <DismissButton lang={lang} onClick={onDismiss} />
        </>}>
        <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, bannerKey)}
        </p>
        {countText && (
          <p className="text-xs text-ui-dark-blue dark:text-ui-light-grey">{countText}</p>
        )}
      </AlertBanner>
      {wipeConfirmOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "storageDestructiveWipeConfirmTitle")}
          message={t(lang, "storageDestructiveWipeConfirmBody")}
          confirmValue={t(lang, "storageDestructiveWipeConfirmValue")}
          // ★★ A SEPARATE KEY from the banner trigger's `storageDestructiveWipeBannerSaveAnyway`,
          // deliberately. The trigger stays mounted behind the open dialog, so sharing
          // the string would put two buttons with the SAME accessible name on screen at
          // once — the duplicate-name defect the axe gate provably cannot catch, and the
          // reason `getByRole("button", { name })` would go ambiguous in a test.
          confirmLabel={t(lang, "storageDestructiveWipeSaveAnyway")}
          onConfirm={() => { setWipeConfirmOpen(false); onSaveAnyway(); }}
          onCancel={() => setWipeConfirmOpen(false)}
        />
      )}
    </>
  );
}
