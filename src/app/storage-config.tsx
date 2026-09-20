"use client";

import { useId, useState, type KeyboardEvent } from "react";
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
import { FieldError } from "./field-feedback";
import { Input, Select } from "./form-controls";

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

  // ★★★ §548 — THE SHAREPOINT FILE URL IS A PURE DRAFT, COMMITTED ONLY BY AN EXPLICIT APPLY.
  //   It feeds `useStorageBackend`'s backend memo (this is the LIVE storage target), so any commit
  //   rebuilds the backend, which re-arms the load hold, which replaces the whole main-window tree —
  //   Settings included — with `PanelSkeleton`. It used to commit on BLUR, which made the worst
  //   version of that: the mousedown on any neighbouring control blurred the field, the commit
  //   unmounted the section, and the click never landed on its target. Same failure the Turso
  //   credentials had, closed the same way (`integrations-section.tsx` `applyTursoDrafts`).
  //   So: nothing commits on a keystroke, blur, Tab or Escape. Apply (or Enter in the field) is the
  //   only commit, and it is disabled while the draft equals the stored value — so an ENABLED Apply
  //   IS the "unapplied change" signal. An unapplied draft is discarded when the section unmounts.
  // ★ The Browse picker (`onSelect` below) still commits directly, deliberately: choosing a file in
  //   a modal IS the explicit action, there is nothing left for the user to confirm, and it cannot
  //   swallow a click the way a blur can.
  const [prevConfig, setPrevConfig] = useState(config);
  const [spUrl, setSpUrl] = useState(spUrlForConfig());
  const [spUrlError, setSpUrlError] = useState<string | null>(null);
  const [spPickerOpen, setSpPickerOpen] = useState(false);
  const spUrlErrorId = `${useId()}-sp-url-error`;

  if (prevConfig !== config) {
    setPrevConfig(config);
    setSpUrl(spUrlForConfig());
    setSpUrlError(null);
  }

  const spCommittedUrl = spUrlForConfig();
  // Empty is excluded rather than treated as a value: the field's only committable content is a
  // parseable file URL, and an "Apply" that silently reverted the field would be a different verb.
  const canApplySpUrl = spUrl.trim() !== "" && spUrl.trim() !== spCommittedUrl;

  function applySpUrl() {
    setSpUrlError(null);
    const parsed = parseSharePointFileUrl(spUrl.trim());
    if (!parsed) {
      setSpUrlError(t(lang, "spStorageInvalidUrl"));
      return;
    }
    if (config.kind === "sp-json" || config.kind === "sp-csv") {
      onChange({ kind: config.kind, ...parsed });
    }
  }

  // The keyboard path to Apply, exactly when Apply is enabled.
  // ★ `isComposing`: an IME commits its composition with Enter — that Enter is not an Apply.
  function handleSpUrlKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || !canApplySpUrl) return;
    e.preventDefault();
    applySpUrl();
  }

  return (
    <div>
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "storage")}
        <InfoTooltip text={t(lang, "storageTooltip")} />
      </span>
      <Select
        value={config.kind}
        onChange={(e) => handleKindChange(e.target.value as StorageKind)}
        aria-label={t(lang, "storage")}
        className="w-full"
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
      </Select>

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
            <Input
              size="xs"
              type="text"
              value={spUrl}
              onChange={(e) => setSpUrl(e.target.value)}
              onKeyDown={handleSpUrlKeyDown}
              placeholder={t(lang, "spStorageUrlPlaceholder")}
              invalid={!!spUrlError}
              aria-describedby={spUrlError ? spUrlErrorId : undefined}
              className="mt-1 w-full"
            />
          </label>
          <p className="text-xs text-muted-foreground">{t(lang, "spStorageHint")}</p>
          {spUrlError && (
            <FieldError id={spUrlErrorId}>{spUrlError}</FieldError>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {/* ★ The visible label deliberately REUSES `integrationsTursoApply` ("Apply"): the word
                is the same action and a second key would be a second thing to keep translated. The
                ACCESSIBLE name must still name the target (two Apply buttons can be on screen at
                once in Settings), and it contains the visible "Apply" — WCAG 2.5.3 label-in-name. */}
            <Button
              variant="primary"
              size="sm"
              disabled={!canApplySpUrl}
              onClick={applySpUrl}
              aria-label={t(lang, "spStorageApplyLabel")}
              aria-describedby={spUrlError ? spUrlErrorId : undefined}
            >
              {t(lang, "integrationsTursoApply")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSpPickerOpen(true)}
            >
              {t(lang, "spStorageBrowse")}
            </Button>
          </div>
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
