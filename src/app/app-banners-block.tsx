// src/app/app-banners-block.tsx
//
// Builds `bannersEl`, the banner stack the classic, popout and modern trees
// render above the workspace: the reminder banners, the storage error, the AI
// key verdict, the three unload-journal banners and the three saving-paused
// causes (incomplete load, load or conflict pause, refused destructive save),
// and the no-project notice for a Turso portfolio (§753).
// Extracted from task-manager (move-only, §491); it calls no hook, so it is a
// plain `build*` function, not a `use*` hook (extraction convention 1), and
// returns a fresh fragment each render, as the inline JSX was.
// ★ The popout gates moved WITH the JSX: the storage, AI key and three
// saving-paused banners render only outside a popout; the reminder and journal
// banners carry no gate of their own.
// ★ Every deps key is REQUIRED, so a dropped one is a tsc error at the call site.
import type { ReactNode } from "react";
import type { Lang } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageErrorKind } from "./storage-error";
import { isAiKeyStatusBad, type AiKeyStatus } from "./ai-key-status";
import { AiKeyBanner, StorageBanner, SavingPausedBanner, UnloadJournalConflictBanner, OtherJournalsBanner, ExpiredJournalsBanner } from "./notifications";
import { NoTursoProjectBanner } from "./no-turso-project-banner";
import type { useStorageBackend } from "./use-storage-backend";

type StorageBackend = ReturnType<typeof useStorageBackend>;
type StorageDismissed = { backend: boolean; list: boolean };

/** Live render-scope values the banner stack reads each render, under task-manager's own names. */
export type AppBannersBlockDeps = Pick<
  StorageBackend,
  | "unloadJournalConflict" | "restoreUnloadJournalAnyway" | "discardUnloadJournal" | "otherJournals" | "restoreKeptJournal"
  | "loadWasIncomplete" | "truncation" | "decodeFailureCount" | "malformedQuoteCount" | "allowIncompleteSave"
  | "loadPause" | "resolveConflictReload" | "reloadCurrentProject" | "canOverwriteConflict" | "resolveConflictOverwrite" | "downloadConflictVersion"
  | "destructiveRefusal" | "allowDestructiveSaveAnyway" | "tursoPortfolioWithoutProject"
> & {
  lang: Lang;
  isPopout: boolean;
  settings: Settings;
  reminderBannersEl: ReactNode;
  shownStorageError: { kind: StorageErrorKind } | null;
  shownStorageSource: keyof StorageDismissed | null;
  storageDismissed: StorageDismissed;
  setStorageDismissed: (next: StorageDismissed) => void;
  onOpenSettings: () => void;
  onOpenSettingsSection: (section: "ai") => void;
  aiKeyStatus: AiKeyStatus;
  aiKeyBannerDismissed: boolean;
  setAiKeyBannerDismissed: (next: boolean) => void;
  truncationBannerDismissed: boolean;
  setTruncationBannerDismissed: (next: boolean) => void;
  loadPauseBannerDismissed: boolean;
  setLoadPauseBannerDismissed: (next: boolean) => void;
  destructiveBannerDismissed: boolean;
  setDestructiveBannerDismissed: (next: boolean) => void;
};

export function buildAppBanners(d: AppBannersBlockDeps): ReactNode {
  const { lang, isPopout, settings, otherJournals, loadPause, destructiveRefusal } = d;
  return (
    <>
      {d.reminderBannersEl}
      {/* §753 — sticky, no Dismiss: every save is skipped until a project is chosen (§751), and an edit made meanwhile is lost. */}
      {!isPopout && d.tursoPortfolioWithoutProject && <NoTursoProjectBanner lang={lang} />}
      {!isPopout && d.shownStorageError && d.shownStorageSource && !d.storageDismissed[d.shownStorageSource] && (
        <StorageBanner kind={d.shownStorageError.kind} lang={lang} onOpenSettings={d.onOpenSettings} onDismiss={() => d.setStorageDismissed({ backend: true, list: true })} />
      )}
      {/* §650 — gated on the AI switch too: a verdict about a key the user has turned off is not news. */}
      {!isPopout && settings.ai?.enabled === true && isAiKeyStatusBad(d.aiKeyStatus) && !d.aiKeyBannerDismissed && (
        <AiKeyBanner status={d.aiKeyStatus} lang={lang} onOpenSettings={() => d.onOpenSettingsSection("ai")} onDismiss={() => d.setAiKeyBannerDismissed(true)} />
      )}
      {d.unloadJournalConflict && (
        <UnloadJournalConflictBanner lang={lang} onRestoreAnyway={d.restoreUnloadJournalAnyway} onDiscard={d.discardUnloadJournal} />
      )}
      {otherJournals.expired.length > 0 && <ExpiredJournalsBanner lang={lang} expired={otherJournals.expired} onDownload={otherJournals.download} onDismiss={otherJournals.dismissExpired} />}
      {otherJournals.others.length > 0 && (
        <OtherJournalsBanner lang={lang} others={otherJournals.others} onDownload={otherJournals.download} onDiscard={otherJournals.discard} onDismiss={otherJournals.dismiss} canRestore={otherJournals.isRestorable} onRestore={d.restoreKeptJournal} />
      )}
      {!isPopout && d.loadWasIncomplete && (
        <SavingPausedBanner lang={lang} cause={{ kind: "truncation", truncation: d.truncation, decodeFailureCount: d.decodeFailureCount, malformedQuoteCount: d.malformedQuoteCount }} dismissed={d.truncationBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={d.allowIncompleteSave} onDismiss={() => d.setTruncationBannerDismissed(true)} onReopen={() => d.setTruncationBannerDismissed(false)} />
      )}
      {/* ★ A SIBLING of the truncation mount, never an `else` on it: the two causes
          are mutually exclusive UPSTREAM, by TWO mechanisms — the save effect returns
          on truncation ABOVE the destructive guard (no NEW refusal while truncation
          stands), and its suppress-after-load branch clears a standing refusal (no OLD
          refusal outlives its workspace). An `else` would ENCODE that exclusivity here
          and hide where it is actually enforced.
          ★★ So these siblings are UNGUARDED against each other on purpose, and the cost
          is visible: were the combined state ever reachable again, BOTH would render —
          two `role="alert"` regions, two identically-named Dismiss buttons, and two
          "save anyway" buttons authorising different things. That consequence is
          characterized in `task-manager.truncation-banner.test.tsx`; the exclusivity
          itself is pinned in `use-storage-backend.test.tsx`, which is where it lives. */}
      {/* §586/§587 — the save gate is shut for the active backend (its load failed, or came back empty over
          a populated project). STICKY for as long as the pause holds: the refused-edit toast times out. */}
      {!isPopout && loadPause !== null && ( // §4 — a conflict pause shares this mount and its dismissed state, and gets the hook's three resolve handlers (Reload, Overwrite, Download my version); Overwrite only while the refusal named the version it may replace
        <SavingPausedBanner lang={lang} cause={loadPause === "conflict" ? { kind: "conflict" } : { kind: "load", reason: loadPause }} dismissed={d.loadPauseBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={() => { void (loadPause === "conflict" ? d.resolveConflictReload() : d.reloadCurrentProject()); }} onOverwrite={d.canOverwriteConflict ? d.resolveConflictOverwrite : undefined} onDownload={loadPause === "conflict" ? d.downloadConflictVersion : undefined} onDismiss={() => d.setLoadPauseBannerDismissed(true)} onReopen={() => d.setLoadPauseBannerDismissed(false)} />
      )}
      {!isPopout && destructiveRefusal !== null && (
        <SavingPausedBanner lang={lang} cause={{ kind: "destructive", prevRecords: destructiveRefusal.prevRecords, curRecords: destructiveRefusal.curRecords, fullWipe: destructiveRefusal.fullWipe }} dismissed={d.destructiveBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={d.allowDestructiveSaveAnyway} onDiscard={() => { void d.reloadCurrentProject(); }} onDismiss={() => d.setDestructiveBannerDismissed(true)} onReopen={() => d.setDestructiveBannerDismissed(false)} />
      )}
    </>
  );
}
