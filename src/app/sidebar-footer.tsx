"use client";

// Footer for the modern dark-blue sidebar: storage status and (when M365 is
// connected) the signed-in account with a sign-out button. The theme control
// lives in Settings → General → Appearance, not here. The version line stays in
// Sidebar — it is intentionally NOT rendered here.

import { type Lang, t } from "./i18n";

interface SidebarFooterProps {
  lang: Lang;
  collapsed: boolean;
  storageDescription: string | null;
  storageReady: boolean;
  /** Saving is paused by a lockout — a truncated load
   *  (`use-load-truncation.ts`) or a withheld mass deletion
   *  (`use-destructive-save-guard.ts`). The two cannot hold at once: the save
   *  effect returns on the truncation lockout ABOVE the destructive guard. */
  savingPaused?: boolean;
  /** Re-show whichever saving-paused banner is standing; it carries the only
   *  "save anyway" for that cause. */
  onRestoreSavingNotice?: () => void;
  isSignedIn: boolean;
  accountName: string | null;
  onSignOut: () => void;
}

/**
 * ★★★ THE INDICATOR IS THE DOOR BACK, so it is a BUTTON, not a dot.
 * `SavingPausedBanner` is dismissable (it must be — a banner you cannot clear
 * makes the fastest way to tidy your screen the irreversible button), and it is
 * the only surface carrying "Save anyway". Without a control that re-shows it,
 * one ✕ leaves the user watching every later edit vanish on tab close with a
 * status line that still reads healthy. Clicking this brings the banner back.
 *
 * ★ It renders in the COLLAPSED rail too, unlike everything else in this footer
 * — a lockout whose only exit disappears when you narrow the sidebar is the same
 * defect with an extra step.
 *
 * ★ The paused state is not colour-only: the expanded form says "Saving paused"
 * in text, and the collapsed form exists only while paused (there is no
 * same-shape "running" control it could be confused with).
 */
function SavingPausedButton({ lang, collapsed, onClick }: { lang: Lang; collapsed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(lang, "storageSavingPausedAction")}
      title={t(lang, "storageSavingPausedAction")}
      className="flex items-center rounded-md px-2 py-1 text-left text-ui-light-grey hover:bg-ui-white/10 hover:text-ui-white focus:outline-none focus:ring-2 focus:ring-ui-green"
    >
      {/* ★★ COLLAPSED, THE DOT WAS THE ONLY CUE, and colour alone is not one:
          `title` is hover-only (no keyboard focus, unreachable on touch) — this
          repo already records that as not closing WCAG 1.4.1 for ResourcePicker
          — and `--rag-amber` on the dark sidebar is a ~3:1 non-text contrast
          question jsdom cannot answer either way. The ⏸ glyph is a SHAPE, so it
          survives both. Expanded, the dot stays as the colour channel beside the
          text and the glyph would be redundant. */}
      {collapsed
        ? <span aria-hidden className="text-xs leading-none">⏸</span>
        : <>
            <span aria-hidden className="mr-1 inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--rag-amber)]" />
            {t(lang, "storageSavingPaused")}
          </>}
    </button>
  );
}

export function SidebarFooter({
  lang,
  collapsed,
  storageDescription,
  storageReady,
  savingPaused = false,
  onRestoreSavingNotice,
  isSignedIn,
  accountName,
  onSignOut,
}: SidebarFooterProps) {
  const pausedControl =
    savingPaused && onRestoreSavingNotice ? (
      <SavingPausedButton lang={lang} collapsed={collapsed} onClick={onRestoreSavingNotice} />
    ) : null;

  // Collapsed rail otherwise has nothing to show here (theme moved to Settings;
  // storage + account only render in the expanded footer).
  if (collapsed) return pausedControl;

  return (
    <div className="flex flex-col gap-3">
      {pausedControl}
      {storageDescription && (
        <p className={storageReady ? "text-ui-light-grey" : "text-ui-light-grey"}>
          <span
            aria-hidden
            className={
              "mr-1 inline-block h-2 w-2 rounded-full " +
              (storageReady ? "bg-ui-green" : "bg-ui-medium-grey")
            }
          />
          {storageDescription}
        </p>
      )}

      {isSignedIn && accountName && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-ui-light-grey">{accountName}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md px-2 py-1 text-ui-light-grey hover:bg-ui-white/10 hover:text-ui-white focus:outline-none focus:ring-2 focus:ring-ui-green"
          >
            {t(lang, "sidebarSignOut")}
          </button>
        </div>
      )}
    </div>
  );
}
