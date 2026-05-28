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
      <span className="mb-1 block text-sm font-medium text-foreground">
        {t(lang, "storage")}
      </span>
      <select
        value={config.kind}
        onChange={(e) => handleKindChange(e.target.value as StorageKind)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      >
        {STORAGE_OPTIONS.map((o) => (
          <option key={o.kind} value={o.kind} disabled={o.comingSoon}>
            {t(lang, o.labelKey)}
            {o.comingSoon ? ` (${t(lang, "comingSoon")})` : ""}
          </option>
        ))}
      </select>

      {config.kind === "browser" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(lang, "storageBrowserHint")}
        </p>
      )}

      {isLocal && (
        <div className="mt-2 space-y-2">
          {!fsaSupported ? (
            <p className="text-xs text-AIPM-purple">
              {t(lang, "storageFsaUnsupported")}
            </p>
          ) : (
            <>
              {description ? (
                <p className="text-xs text-muted-foreground">
                  ✓ {description}
                  {!ready && (
                    <span className="ml-1 text-AIPM-purple">
                      ({t(lang, "storagePermissionNeeded")})
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-AIPM-purple">
                  {t(lang, "storagePickFilePrompt")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runPicker("save")}
                  disabled={picking !== null}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {description
                    ? t(lang, "storageChangeFile")
                    : t(lang, "storagePickFile")}
                </button>
                <button
                  type="button"
                  onClick={() => runPicker("open")}
                  disabled={picking !== null}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t(lang, "storageOpenFile")}
                </button>
                {description && !ready && (
                  <button
                    type="button"
                    onClick={() => runPicker("grant")}
                    disabled={picking !== null}
                    className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t(lang, "storageGrantWrite")}
                  </button>
                )}
              </div>
              {error && (
                <p className="text-xs text-AIPM-pink">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {isSp && (
        <p className="mt-2 text-xs text-AIPM-purple">
          {t(lang, "storageSpComingSoon")}
        </p>
      )}
    </div>
  );
}
