"use client";

// Footer for the modern dark-blue sidebar: theme toggle, storage status, and
// (when M365 is connected) the signed-in account with a sign-out button. The
// version line stays in Sidebar — it is intentionally NOT rendered here.

import { type Lang, t } from "./i18n";
import { useTheme } from "./use-theme";
import { type Theme } from "./theme";
import { SegmentedControl } from "./segmented-control";

interface SidebarFooterProps {
  lang: Lang;
  collapsed: boolean;
  storageDescription: string | null;
  storageReady: boolean;
  isSignedIn: boolean;
  accountName: string | null;
  onSignOut: () => void;
}

function ThemeControl({ lang }: { lang: Lang }) {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl<Theme>
      value={theme}
      ariaLabel={t(lang, "theme")}
      title={t(lang, "themeHint")}
      className="w-full"
      options={[
        { value: "light", label: t(lang, "themeLight") },
        { value: "dark", label: t(lang, "themeDark") },
        { value: "system", label: t(lang, "themeSystem") },
      ]}
      onChange={setTheme}
    />
  );
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
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <ThemeControl lang={lang} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-AIPM-medium-grey">
          {t(lang, "theme")}
        </span>
        <ThemeControl lang={lang} />
      </div>

      {storageDescription && (
        <p className={storageReady ? "text-AIPM-light-grey" : "text-AIPM-medium-grey"}>
          <span
            aria-hidden
            className={
              "mr-1 inline-block h-2 w-2 rounded-full " +
              (storageReady ? "bg-AIPM-green" : "bg-AIPM-medium-grey")
            }
          />
          {storageDescription}
        </p>
      )}

      {isSignedIn && accountName && (
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-AIPM-light-grey">{accountName}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md px-2 py-1 text-AIPM-medium-grey hover:bg-AIPM-white/10 hover:text-AIPM-white focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "sidebarSignOut")}
          </button>
        </div>
      )}
    </div>
  );
}
