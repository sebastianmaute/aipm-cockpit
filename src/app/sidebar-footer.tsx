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
  isSignedIn: boolean;
  accountName: string | null;
  onSignOut: () => void;
}

export function SidebarFooter({
  lang,
  collapsed,
  storageDescription,
  storageReady,
  isSignedIn,
  accountName,
  onSignOut,
}: SidebarFooterProps) {
  // Collapsed rail has nothing to show here (theme moved to Settings; storage +
  // account only render in the expanded footer).
  if (collapsed) return null;

  return (
    <div className="flex flex-col gap-3">
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
