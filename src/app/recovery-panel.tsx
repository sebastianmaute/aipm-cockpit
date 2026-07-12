// src/app/recovery-panel.tsx
"use client";

import { useState } from "react";
import { t } from "./i18n";
import {
  exportConfig,
  listBackups,
  quarantineConfig,
  readPersistedLang,
  restoreConfig,
} from "./recovery-config";
import { SETTINGS_KEY } from "./use-settings";
import { MODE_KEY } from "./portfolio-mode";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { logDiag } from "./diagnostics";

interface ConfigSummary {
  backendKind: string;
  portfolioMode: string;
  tursoConfigured: boolean;
}

function readSummary(): ConfigSummary {
  let backendKind = "browser";
  let tursoConfigured = false;
  let portfolioMode = "file";
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as {
        storageConfig?: { kind?: string };
        integrations?: { turso?: { databaseUrl?: string; authToken?: string } };
      };
      backendKind = s.storageConfig?.kind ?? "browser";
      tursoConfigured = !!(s.integrations?.turso?.databaseUrl && s.integrations.turso.authToken);
    }
    portfolioMode = window.localStorage.getItem(MODE_KEY) === "turso" ? "turso" : "file";
  } catch {
    /* defaults */
  }
  return { backendKind, portfolioMode, tursoConfigured };
}

function downloadJson(filename: string, json: string): boolean {
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export function RecoveryPanel() {
  const lang = readPersistedLang();
  const [storageOk] = useState<boolean>(() => {
    try {
      const k = "__lop_recovery_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  });
  const [summary] = useState<ConfigSummary>(() => readSummary());
  const [message, setMessage] = useState<string | null>(null);
  const backups = listBackups();

  const reopen = () => {
    try {
      window.location.assign("/");
    } catch {
      /* noop */
    }
  };

  const onReset = () => {
    const r = quarantineConfig();
    if (!r.ok) {
      logDiag("error", "recovery.resetFailed", {});
      setMessage(t(lang, "guardRecoveryResetFailed"));
      return;
    }
    setMessage(t(lang, "recoveryResetDone"));
    reopen();
  };

  const onRestore = () => {
    const latest = backups[0];
    if (!latest) {
      setMessage(t(lang, "recoveryNoBackups"));
      return;
    }
    if (!restoreConfig(latest.id)) {
      logDiag("error", "recovery.restoreFailed", {});
      setMessage(t(lang, "guardRecoveryRestoreFailed"));
      return;
    }
    setMessage(t(lang, "recoveryRestoreDone"));
    reopen();
  };

  const onDownload = () => {
    if (!downloadJson("aipm-cockpit-config.json", exportConfig())) {
      logDiag("error", "recovery.backupDownloadFailed", {});
      setMessage(t(lang, "guardRecoveryBackupDownloadFailed"));
    }
  };

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {t(lang, "recoveryPageTitle")}
      </h1>
      <p className="text-sm text-muted-foreground">{t(lang, "recoveryPageIntro")}</p>
      {!storageOk && <p className="text-sm text-AIPM-pink-strong">{t(lang, "recoveryError")}</p>}

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "recoveryCurrentConfig")}
        </h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t(lang, "recoveryBackendKind")}</dt>
          <dd className="text-foreground">{summary.backendKind}</dd>
          <dt className="text-muted-foreground">{t(lang, "recoveryPortfolioMode")}</dt>
          <dd className="text-foreground">{summary.portfolioMode}</dd>
          <dt className="text-muted-foreground">{t(lang, "recoveryTursoConfigured")}</dt>
          <dd className="text-foreground">
            {t(lang, summary.tursoConfigured ? "recoveryYes" : "recoveryNo")}
          </dd>
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "diagnosticsTitle")}
        </h2>
        <DiagnosticsPanel lang={lang} />
      </section>

      {message && <p className="text-sm text-AIPM-green-strong">{message}</p>}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onDownload}
          disabled={!storageOk}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
        >
          {t(lang, "recoveryDownload")}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!storageOk}
          className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t(lang, "recoveryReset")}
        </button>
        <button
          type="button"
          onClick={onRestore}
          disabled={backups.length === 0 || !storageOk}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
        >
          {t(lang, "recoveryRestore")}
        </button>
        {/* Plain anchor (not next/link) on purpose: the recovery page is
            provider-light and must do a full document navigation so it works
            even when the main app tree is bricked. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mt-2 text-center text-xs text-muted-foreground underline">
          {t(lang, "recoveryBackToApp")}
        </a>
      </div>
    </main>
  );
}
