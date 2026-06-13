// src/app/recovery-panel.tsx
"use client";

import Link from "next/link";
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

function downloadJson(filename: string, json: string): void {
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    /* download unavailable — ignore */
  }
}

export function RecoveryPanel() {
  const lang = readPersistedLang();
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
    quarantineConfig();
    setMessage(t(lang, "recoveryResetDone"));
    reopen();
  };

  const onRestore = () => {
    const latest = backups[0];
    if (!latest) {
      setMessage(t(lang, "recoveryNoBackups"));
      return;
    }
    restoreConfig(latest.id);
    setMessage(t(lang, "recoveryRestoreDone"));
    reopen();
  };

  const onDownload = () => downloadJson("lop-config.json", exportConfig());

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
        {t(lang, "recoveryPageTitle")}
      </h1>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "recoveryCurrentConfig")}
        </h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t(lang, "recoveryBackendKind")}</dt>
          <dd className="text-foreground">{summary.backendKind}</dd>
          <dt className="text-muted-foreground">{t(lang, "recoveryPortfolioMode")}</dt>
          <dd className="text-foreground">{summary.portfolioMode}</dd>
        </dl>
      </section>

      {message && <p className="text-sm text-AIPM-green">{message}</p>}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onDownload}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          {t(lang, "recoveryDownload")}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {t(lang, "recoveryReset")}
        </button>
        <button
          type="button"
          onClick={onRestore}
          disabled={backups.length === 0}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
        >
          {t(lang, "recoveryRestore")}
        </button>
        <Link href="/" className="mt-2 text-center text-xs text-muted-foreground underline">
          {t(lang, "recoveryBackToApp")}
        </Link>
      </div>
    </main>
  );
}
