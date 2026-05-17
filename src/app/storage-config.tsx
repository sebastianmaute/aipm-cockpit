"use client";

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import {
  type StorageConfig,
  type StorageKind,
  isFileSystemAccessSupported,
} from "./storage";

type Props = {
  lang: Lang;
  config: StorageConfig;
  onChange: (config: StorageConfig) => void;
  description: string | null;
  ready: boolean;
  onPickFile: () => Promise<void>;
  onOpenFile: () => Promise<void>;
  onGrantWrite: () => Promise<void>;
};

const STORAGE_OPTIONS: Array<{
  kind: StorageKind;
  labelKey: TranslationKey;
  comingSoon?: boolean;
}> = [
  { kind: "browser", labelKey: "storageBrowser" },
  { kind: "local-json", labelKey: "storageLocalJson" },
  { kind: "local-csv", labelKey: "storageLocalCsv" },
  { kind: "local-md", labelKey: "storageLocalMd" },
  { kind: "sp-json", labelKey: "storageSpJson", comingSoon: true },
  { kind: "sp-csv", labelKey: "storageSpCsv", comingSoon: true },
];

export function StorageConfigSection({
  lang,
  config,
  onChange,
  description,
  ready,
  onPickFile,
  onOpenFile,
  onGrantWrite,
}: Props) {
  const [picking, setPicking] = useState<"save" | "open" | "grant" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const fsaSupported = isFileSystemAccessSupported();

  function handleKindChange(newKind: StorageKind) {
    setError(null);
    onChange({ kind: newKind } as StorageConfig);
  }

  async function runPicker(mode: "save" | "open" | "grant") {
    setError(null);
    setPicking(mode);
    try {
      if (mode === "save") await onPickFile();
      else if (mode === "open") await onOpenFile();
      else await onGrantWrite();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // user-cancelled the picker is the most common case
      if (!/abort/i.test(msg) && !/user activation/i.test(msg)) {
        setError(msg);
      }
    } finally {
      setPicking(null);
    }
  }

  const isLocal =
    config.kind === "local-json" ||
    config.kind === "local-csv" ||
    config.kind === "local-md";
  const isSp = config.kind === "sp-json" || config.kind === "sp-csv";

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {t(lang, "storage")}
      </span>
      <select
        value={config.kind}
        onChange={(e) => handleKindChange(e.target.value as StorageKind)}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {STORAGE_OPTIONS.map((o) => (
          <option key={o.kind} value={o.kind} disabled={o.comingSoon}>
            {t(lang, o.labelKey)}
            {o.comingSoon ? ` (${t(lang, "comingSoon")})` : ""}
          </option>
        ))}
      </select>

      {config.kind === "browser" && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {t(lang, "storageBrowserHint")}
        </p>
      )}

      {isLocal && (
        <div className="mt-2 space-y-2">
          {!fsaSupported ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t(lang, "storageFsaUnsupported")}
            </p>
          ) : (
            <>
              {description ? (
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  ✓ {description}
                  {!ready && (
                    <span className="ml-1 text-amber-700 dark:text-amber-400">
                      ({t(lang, "storagePermissionNeeded")})
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t(lang, "storagePickFilePrompt")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runPicker("save")}
                  disabled={picking !== null}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {description
                    ? t(lang, "storageChangeFile")
                    : t(lang, "storagePickFile")}
                </button>
                <button
                  type="button"
                  onClick={() => runPicker("open")}
                  disabled={picking !== null}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {t(lang, "storageOpenFile")}
                </button>
                {description && !ready && (
                  <button
                    type="button"
                    onClick={() => runPicker("grant")}
                    disabled={picking !== null}
                    className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t(lang, "storageGrantWrite")}
                  </button>
                )}
              </div>
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {isSp && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {t(lang, "storageSpComingSoon")}
        </p>
      )}
    </div>
  );
}
