// src/app/recovery-banner.tsx
"use client";

import { t } from "./i18n";
import { isSafeMode } from "./safe-mode";
import { quarantineConfig, readPersistedLang } from "./recovery-config";

/** Sticky banner shown only in safe mode (?safe=1). Self-hides otherwise. */
export function RecoveryBanner() {
  if (!isSafeMode()) return null;
  const lang = readPersistedLang();

  const onResetNow = () => {
    quarantineConfig();
    try {
      window.location.assign("/");
    } catch {
      /* noop */
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-AIPM-dark-blue px-4 py-2 text-sm text-white"
    >
      <span className="font-medium">{t(lang, "recoveryBannerTitle")}</span>
      <span className="flex items-center gap-3">
        {/* Plain anchor is intentional — the banner must do a full-document
            navigation even when the app tree is bricked, so Next's Link would
            not be appropriate here (mirrors the recovery panel approach). */}
        <a href="/recovery" className="underline hover:opacity-90">
          {t(lang, "recoveryOpen")}
        </a>
        <button
          type="button"
          onClick={onResetNow}
          className="rounded border border-white/40 px-2 py-1 hover:bg-white/10"
        >
          {t(lang, "recoveryResetNow")}
        </button>
      </span>
    </div>
  );
}
