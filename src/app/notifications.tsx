"use client";

import { useState } from "react";
import type { AriaRole, ReactNode } from "react";
import { type Lang, t } from "./i18n";
import { useConfirm } from "./confirm-dialog";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
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
      ? t(lang, "documentsTruncatedEntriesCount", truncation.entries)
      : truncation != null && truncation.blocks > 0
        ? t(lang, "documentsTruncatedBlocksCount", truncation.blocks)
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
    decodeFailureCount > 0 ? t(lang, "documentsUnreadableCount", decodeFailureCount) : null,
    malformedQuoteCount > 0 ? t(lang, "importMalformedQuotesCount", malformedQuoteCount) : null,
  ].filter((part): part is string => part !== null);
  const countText = countParts.length > 0 ? countParts.join(" ") : null;
  // ★★★ THE HEADLINE FOLLOWS THE CAUSE, because "document data" was true of only
  // one of the two. Truncation IS about documents — the cap cuts document
  // entries and blocks — but the decode cause reaches ELEVEN meta slices
  // (`reportUnreadableSlice`), so a corrupt `steering_committee` blob in a
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
 *  ★ `TypeToConfirmDialog` holds `TITLE_ID` as a MODULE constant, so only one
 *  may be open at a time. That is why the recourse lives on this banner and not
 *  ALSO on the toast — two triggers would need two instances. */
export function SavingPausedBanner({
  lang, cause, dismissed, hasFooterIndicator, onSaveAnyway, onDismiss, onReopen,
}: {
  lang: Lang;
  cause: SavingPausedCause;
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
  // ★ Unconditional, above every early return — the `dismissed` branch below
  // returns before the dialog can render, and a hook behind it would break the
  // rules of hooks the first time a banner was dismissed.
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const { countText, bannerKey, bannerAriaKey } =
    cause.kind === "destructive" ? destructiveCopy(lang, cause) : truncationCopy(lang, cause);
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
          <Button variant="destructive" size="xs" onClick={() => {
            if (cause.kind === "destructive" && cause.fullWipe) { setWipeConfirmOpen(true); return; }
            void askThenSave();
          }}>
            {saveLabel}
          </Button>
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
