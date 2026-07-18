"use client";

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Banner } from "./banner";
import {
  type StorageConfig,
  type StorageKind,
  isFileSystemAccessSupported,
} from "./storage";
import { useMsAuth } from "./use-ms-auth";
import { InfoTooltip } from "./info-tooltip";
import { parseSharePointFileUrl } from "./sharepoint-backend";
import { SharePointPickerModal } from "./sharepoint-picker-modal";
import { useToastContext } from "./toast-context";
import { reportSilentFailure } from "./guard-feedback";
import { Button } from "./button";

type Props = {
  lang: Lang;
  config: StorageConfig;
  onChange: (config: StorageConfig) => void;
  onRequestSwitch: (kind: StorageKind) => void;
  description: string | null;
  ready: boolean;
  onPickFile: () => Promise<void>;
  onOpenFile: () => Promise<void>;
  onGrantWrite: () => Promise<void>;
  m365Enabled: boolean;
  sharepointEnabled: boolean;
  tursoEnabled: boolean;
  /** Reload the current project's data from its backend (recovery affordance).
   *  Omitted in popouts, where reloading isn't meaningful. */
  onReloadProject?: () => void;
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
  { kind: "sp-json", labelKey: "storageSpJson" },
  { kind: "sp-csv", labelKey: "storageSpCsv" },
  { kind: "turso", labelKey: "storageTurso" },
];

export function StorageConfigSection({
  lang,
  config,
  onChange,
  onRequestSwitch,
  description,
  ready,
  onPickFile,
  onOpenFile,
  onGrantWrite,
  m365Enabled,
  sharepointEnabled,
  tursoEnabled,
  onReloadProject,
}: Props) {
  const [picking, setPicking] = useState<"save" | "open" | "grant" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const fsaSupported = isFileSystemAccessSupported();

  function handleKindChange(newKind: StorageKind) {
    setError(null);
    onRequestSwitch(newKind);
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
  const isTurso = config.kind === "turso";

  const auth = useMsAuth(m365Enabled);
  const showToast = useToastContext();
  const spGateOk = m365Enabled && sharepointEnabled;

  function spUrlForConfig(): string {
    if (config.kind === "sp-json" || config.kind === "sp-csv") {
      return `https://${config.hostname}${config.sitePath}/${config.itemPath}`;
    }
    return "";
  }

  const [prevConfig, setPrevConfig] = useState(config);
  const [spUrl, setSpUrl] = useState(spUrlForConfig());
  const [spUrlError, setSpUrlError] = useState<string | null>(null);
  const [spPickerOpen, setSpPickerOpen] = useState(false);

  if (prevConfig !== config) {
    setPrevConfig(config);
    setSpUrl(spUrlForConfig());
    setSpUrlError(null);
  }

  function handleSpUrlBlur() {
    setSpUrlError(null);
    if (!spUrl.trim()) {
      setSpUrl(spUrlForConfig());
      return;
    }
    const parsed = parseSharePointFileUrl(spUrl.trim());
    if (!parsed) {
      setSpUrlError(t(lang, "spStorageInvalidUrl"));
      return;
    }
    if (config.kind === "sp-json" || config.kind === "sp-csv") {
      onChange({ kind: config.kind, ...parsed });
    }
  }

  return (
    <div>
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "storage")}
        <InfoTooltip text={t(lang, "storageTooltip")} />
      </span>
      <select
        value={config.kind}
        onChange={(e) => handleKindChange(e.target.value as StorageKind)}
        aria-label={t(lang, "storage")}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-2 focus:ring-ui-green"
      >
        {STORAGE_OPTIONS.map((o) => {
          const isSpKind = o.kind === "sp-json" || o.kind === "sp-csv";
          const isTursoKind = o.kind === "turso";
          const disabled =
            o.comingSoon ||
            (isSpKind && !(m365Enabled && sharepointEnabled)) ||
            (isTursoKind && !tursoEnabled);
          return (
            <option key={o.kind} value={o.kind} disabled={disabled}>
              {t(lang, o.labelKey)}
              {o.comingSoon ? ` (${t(lang, "comingSoon")})` : ""}
            </option>
          );
        })}
      </select>

      {config.kind === "browser" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(lang, "storageBrowserHint")}
        </p>
      )}

      {isLocal && (
        <div className="mt-2 space-y-2">
          {!fsaSupported ? (
            <p className="text-xs text-ui-purple">
              {t(lang, "storageFsaUnsupported")}
            </p>
          ) : (
            <>
              {description ? (
                <p className="text-xs text-muted-foreground">
                  ✓ {description}
                  {!ready && (
                    <span className="ml-1 text-ui-purple">
                      ({t(lang, "storagePermissionNeeded")})
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-ui-purple">
                  {t(lang, "storagePickFilePrompt")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => runPicker("save")}
                  disabled={picking !== null}
                >
                  {description
                    ? t(lang, "storageChangeFile")
                    : t(lang, "storagePickFile")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => runPicker("open")}
                  disabled={picking !== null}
                >
                  {t(lang, "storageOpenFile")}
                </Button>
                {description && !ready && (
                  <Button
                    size="sm"
                    onClick={() => runPicker("grant")}
                    disabled={picking !== null}
                  >
                    {t(lang, "storageGrantWrite")}
                  </Button>
                )}
              </div>
              {error && (
                <Banner severity="error">
                  {error}
                </Banner>
              )}
            </>
          )}
        </div>
      )}

      {isSp && !spGateOk && (
        <Banner severity="error" className="mt-2">
          {!m365Enabled
            ? t(lang, "spStorageNeedsM365")
            : t(lang, "spStorageNeedsToggle")}
        </Banner>
      )}

      {isSp && spGateOk && !auth.account && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            {t(lang, "spStorageNeedsSignIn")}
          </p>
          <Button
            size="sm"
            onClick={() => { void auth.signIn().catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed")); }}
          >
            {t(lang, "integrationsM365SignIn")}
          </Button>
        </div>
      )}

      {isSp && spGateOk && auth.account && (
        <div className="mt-2 space-y-1">
          <label className="block text-xs">
            <span className="text-muted-foreground">{t(lang, "spStorageUrlLabel")}</span>
            <input
              type="text"
              value={spUrl}
              onChange={(e) => setSpUrl(e.target.value)}
              onBlur={handleSpUrlBlur}
              placeholder={t(lang, "spStorageUrlPlaceholder")}
              className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
            />
          </label>
          <p className="text-xs text-muted-foreground">{t(lang, "spStorageHint")}</p>
          {spUrlError && (
            <Banner severity="error">{spUrlError}</Banner>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-1"
            onClick={() => setSpPickerOpen(true)}
          >
            {t(lang, "spStorageBrowse")}
          </Button>
          {spPickerOpen && (config.kind === "sp-json" || config.kind === "sp-csv") && (
            <SharePointPickerModal
              mode="location"
              lang={lang}
              acquireToken={auth.acquireToken}
              onSelect={(link) => {
                const parsed = parseSharePointFileUrl(link.url);
                if (parsed && (config.kind === "sp-json" || config.kind === "sp-csv")) {
                  onChange({ kind: config.kind, ...parsed });
                  setSpUrl(`https://${parsed.hostname}${parsed.sitePath}/${parsed.itemPath}`);
                } else {
                  // selection wasn't a recognizable site file URL — surface for manual fix
                  setSpUrl(link.url);
                  setSpUrlError(t(lang, "spStorageInvalidUrl"));
                }
                setSpPickerOpen(false);
              }}
              onClose={() => setSpPickerOpen(false)}
            />
          )}
        </div>
      )}

      {isTurso && !tursoEnabled && (
        <Banner severity="error" className="mt-2">{t(lang, "storageTursoNeedsToggle")}</Banner>
      )}
      {isTurso && tursoEnabled && !ready && (
        <Banner severity="error" className="mt-2">{t(lang, "storageTursoNeedsConfig")}</Banner>
      )}
      {isTurso && tursoEnabled && ready && description && (
        <p className="mt-2 text-xs text-muted-foreground">✓ {description}</p>
      )}

      {onReloadProject && (
        <div className="mt-3 border-t border-line pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onReloadProject}
          >
            {t(lang, "reloadProject")}
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">{t(lang, "reloadProjectHint")}</p>
        </div>
      )}
    </div>
  );
}
