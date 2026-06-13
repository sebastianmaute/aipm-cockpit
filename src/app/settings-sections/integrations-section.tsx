"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { FieldNotice } from "../field-feedback";
import {
  type M365IntegrationsSettings,
  type TursoIntegrationsSettings,
  type Settings,
  type SnapshotSettings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
  defaultSnapshotSettings,
} from "../settings-types";
import type { SnapshotCadence } from "../snapshot";
import { useMsAuth } from "../use-ms-auth";
import { InfoTooltip } from "../info-tooltip";
import { loadPortfolioMode, savePortfolioMode, type PortfolioMode } from "../portfolio-mode";
import { getTursoConfig, isLikelyRegionQualifiedTursoUrl } from "../turso-config";
import { writeSettings } from "../use-settings";
import { loadRegistry } from "../projects-registry";
import { defaultStorageConfig } from "../workspace";

interface IntegrationsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Migrate the current project into Turso + switch the portfolio. Provided
   *  only where a current project exists (the settings views) — when present and
   *  the portfolio is still on File with Turso configured, a "Move to Turso"
   *  button is shown. Omitted in the create-flow modal (no project to move). */
  onMigrateToTurso?: () => void;
}

export function IntegrationsSection({ lang, settings, onChange, onMigrateToTurso }: IntegrationsSectionProps) {
  const integrations = settings.integrations ?? defaultIntegrations;
  const m365 = integrations.m365 ?? defaultM365Integrations;
  const turso = integrations.turso ?? defaultTursoIntegrations;
  const auth = useMsAuth(m365.enabled);
  const envClientIdSet = !!process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenantIdSet = !!process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;

  function updateTurso(patch: Partial<TursoIntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: { ...integrations, turso: { ...turso, ...patch } },
    });
  }

  const snapshots = settings.snapshots ?? defaultSnapshotSettings;
  function updateSnapshots(patch: Partial<SnapshotSettings>) {
    onChange({ ...settings, snapshots: { ...snapshots, ...patch } });
  }

  // Portfolio storage mode lives in localStorage (not Settings) — see
  // portfolio-mode.ts. Switching is DELIBERATE: picking a mode only stages it;
  // an explicit "Save & switch" button persists it and reloads. A bare dropdown
  // that reloaded on change kicked users out mid-config — and switching does NOT
  // migrate the current project (each portfolio is a separate store), so the
  // surprise reload landed them in the OTHER (often empty) portfolio.
  const portfolioMode = loadPortfolioMode();
  const [pendingMode, setPendingMode] = useState<PortfolioMode>(portfolioMode);
  // Turso portfolio mode is only safe once Turso resolves a config (URL + token,
  // or env vars). Disable it until then so a switch can't land in a dead portfolio.
  const tursoConfigured = !!getTursoConfig(turso.databaseUrl, turso.authToken);
  // "On Turso" = data lives in Turso: either the single-DB Turso storage backend
  // (Settings → Storage) OR turso portfolio mode (Move-to-Turso). Snapshot
  // recording is available in either.
  const onTurso = portfolioMode === "turso" || settings.storageConfig?.kind === "turso";
  // Show "Move to Turso" only where a current project exists (settings views),
  // Turso is configured, and the portfolio is still on File.
  const canMoveToTurso = !!onMigrateToTurso && !onTurso && tursoConfigured;
  const portfolioModeDirty = pendingMode !== portfolioMode;
  function confirmPortfolioModeSwitch() {
    if (!portfolioModeDirty) return;
    if (pendingMode === "turso" && !tursoConfigured) return; // guard
    savePortfolioMode(pendingMode);
    // Keep the workspace storage backend aligned with the portfolio: switching TO
    // Turso must also persist storageConfig.kind "turso" (synchronously, so it
    // survives the reload), or the backend memo rebuilds a file/browser backend
    // and the workspace keeps loading the local file while the project list +
    // snapshots talk to Turso. (portfolioMode === "turso" ⟺ storageConfig "turso".)
    if (pendingMode === "turso") {
      writeSettings({ ...settings, storageConfig: { kind: "turso" } });
    } else if (settings.storageConfig?.kind === "turso") {
      // Leaving Turso for the File portfolio: a leftover "turso" storageConfig
      // would keep the backend memo pointed at Turso after reload (no file-mode
      // bootstrap reconciles it), stranding the user. Restore the File portfolio's
      // current-project backend config (registry is its source of truth), or the
      // browser default if none.
      const reg = loadRegistry();
      const current = reg.projects.find((p) => p.id === reg.currentProjectId);
      writeSettings({ ...settings, storageConfig: current?.storageConfig ?? defaultStorageConfig });
    }
    window.location.reload();
  }

  function updateM365(patch: Partial<M365IntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: {
        ...integrations,
        m365: { ...m365, ...patch },
      },
    });
  }

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-foreground">{t(lang, "integrations")}</h3>
        <InfoTooltip text={t(lang, "integrationsTooltip")} />
      </div>

      <div className="flex items-center gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={m365.enabled}
            onChange={(e) => updateM365({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
          <span>{t(lang, "integrationsM365")}</span>
        </label>
        <InfoTooltip text={t(lang, "integrationsM365Tooltip")} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(lang, "integrationsM365Hint")}
      </p>

      {m365.enabled && (
        <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
          {!envClientIdSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsM365ClientId")}
                <InfoTooltip text={t(lang, "integrationsM365ClientIdTooltip")} />
              </span>
              <input
                type="text"
                value={m365.clientId ?? ""}
                onChange={(e) => updateM365({ clientId: e.target.value })}
                placeholder={t(lang, "integrationsM365ClientIdPlaceholder")}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              />
            </label>
          )}
          {!envTenantIdSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsM365TenantId")}
                <InfoTooltip text={t(lang, "integrationsM365TenantIdTooltip")} />
              </span>
              <input
                type="text"
                value={m365.tenantId ?? ""}
                onChange={(e) => updateM365({ tenantId: e.target.value })}
                placeholder={t(lang, "integrationsM365TenantIdPlaceholder")}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              />
            </label>
          )}

          <div className="flex items-center gap-2">
            {auth.account ? (
              <>
                <span className="text-xs text-foreground">
                  {t(lang, "integrationsM365SignedInAs")} {auth.account.username}
                </span>
                <button
                  type="button"
                  onClick={() => { void auth.signOut(); }}
                  className="rounded border border-line bg-surface px-2 py-1 text-xs hover:bg-surface-muted"
                >
                  {t(lang, "integrationsM365SignOut")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => { void auth.signIn(); }}
                disabled={!envClientIdSet && !m365.clientId}
                title={
                  !envClientIdSet && !m365.clientId
                    ? t(lang, "integrationsM365NeedsConfig")
                    : undefined
                }
                className="rounded border border-AIPM-dark-blue bg-AIPM-dark-blue px-2 py-1 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(lang, "integrationsM365SignIn")}
              </button>
            )}
          </div>

          <fieldset className="mt-3 border-t border-line pt-2">
            {(
              [
                ["integrationsSharepoint", "sharepoint", false, "integrationsSharepointTooltip"],
                ["integrationsOutlookContacts", "outlookContacts", false, "integrationsOutlookContactsTooltip"],
                ["integrationsOutlookCalendar", "outlookCalendar", false, "integrationsOutlookCalendarTooltip"],
              ] as const
            ).map(([labelKey, key, comingSoon, tooltipKey]) => (
              <div key={labelKey} className="mt-1 flex items-center gap-1">
                <label
                  className={`flex items-center gap-2 text-sm ${comingSoon ? "text-muted-foreground" : "text-foreground"}`}
                  title={comingSoon ? t(lang, "integrationsComingSoon") : undefined}
                >
                  <input
                    type="checkbox"
                    disabled={comingSoon}
                    checked={comingSoon ? false : m365[key]}
                    onChange={
                      comingSoon
                        ? undefined
                        : (e) => updateM365({ [key]: e.target.checked })
                    }
                    className={comingSoon ? "h-4 w-4 cursor-not-allowed" : "h-4 w-4"}
                  />
                  <span>{t(lang, labelKey)}</span>
                </label>
                <InfoTooltip text={t(lang, tooltipKey)} />
              </div>
            ))}
          </fieldset>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={turso.enabled}
            onChange={(e) => updateTurso({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
          <span>{t(lang, "integrationsTurso")}</span>
        </label>
        <InfoTooltip text={t(lang, "integrationsTursoTooltip")} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(lang, "integrationsTursoHint")}
      </p>
      <p className="mt-1 text-xs">
        <a
          href="https://turso.tech/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-AIPM-dark-blue underline hover:opacity-80"
        >
          {t(lang, "integrationsTursoLearnMore")}
        </a>
      </p>

      {turso.enabled && (
        <div className="mt-2 space-y-2 border-l-2 border-line pl-3">
          {!envTursoUrlSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <input
                type="text"
                value={turso.databaseUrl ?? ""}
                onChange={(e) => updateTurso({ databaseUrl: e.target.value })}
                placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              />
              {isLikelyRegionQualifiedTursoUrl(turso.databaseUrl ?? "") && (
                <p className="mt-1 text-xs text-AIPM-pink">
                  {t(lang, "tursoUrlRegionWarning")}
                </p>
              )}
            </label>
          )}
          {!envTursoTokenSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoToken")}
                <InfoTooltip text={t(lang, "integrationsTursoTokenTooltip")} />
              </span>
              <input
                type="password"
                value={turso.authToken ?? ""}
                onChange={(e) => updateTurso({ authToken: e.target.value })}
                placeholder={t(lang, "integrationsTursoTokenPlaceholder")}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              />
              <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
            </label>
          )}
          {/* Primary action: carry the current project into Turso. */}
          {canMoveToTurso && (
            <div className="mt-2 border-t border-line pt-2">
              <button
                type="button"
                onClick={onMigrateToTurso}
                className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                {t(lang, "projectMigrateToTurso")}
              </button>
              <p className="mt-1 text-xs text-muted-foreground">{t(lang, "projectMigrateToTursoHint")}</p>
            </div>
          )}
          <div className="mt-2 border-t border-line pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={snapshots.enabled}
                disabled={!onTurso}
                onChange={(e) => updateSnapshots({ enabled: e.target.checked })}
                className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className={onTurso ? undefined : "text-muted-foreground"}>
                {t(lang, "snapshotRecordingLabel")}
              </span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, onTurso ? "snapshotNeedsTurso" : "snapshotNeedsTursoFirst")}
            </p>
            <label className="mt-2 block text-xs">
              <span className="text-muted-foreground">{t(lang, "snapshotCadenceLabel")}</span>
              <select
                aria-label={t(lang, "snapshotCadenceLabel")}
                value={snapshots.cadence}
                onChange={(e) => updateSnapshots({ cadence: e.target.value as SnapshotCadence })}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              >
                <option value="weekly">{t(lang, "snapshotCadenceWeekly")}</option>
                <option value="daily">{t(lang, "snapshotCadenceDaily")}</option>
                <option value="monthly">{t(lang, "snapshotCadenceMonthly")}</option>
              </select>
            </label>
            {snapshots.enabled && !(envTursoUrlSet || turso.databaseUrl) && (
              <p className="mt-1 text-xs text-AIPM-pink">{t(lang, "snapshotConfigIncomplete")}</p>
            )}
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "portfolioModeLabel")}
              </span>
              <select
                aria-label={t(lang, "portfolioModeLabel")}
                value={pendingMode}
                onChange={(e) => setPendingMode(e.target.value as PortfolioMode)}
                className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 text-foreground"
              >
                <option value="file">{t(lang, "portfolioModeFile")}</option>
                <option value="turso" disabled={!tursoConfigured}>
                  {t(lang, "portfolioModeTurso")}
                </option>
              </select>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{t(lang, "portfolioModeHelp")}</p>
            {!tursoConfigured && (
              <p className="mt-1 text-xs text-AIPM-pink">{t(lang, "portfolioModeTursoNeedsConfig")}</p>
            )}
            {portfolioModeDirty && (
              <div className="mt-2 rounded-md border border-AIPM-purple/40 bg-AIPM-purple/5 p-2">
                <p className="text-xs text-foreground">{t(lang, "portfolioModeSwitchNote")}</p>
                <button
                  type="button"
                  onClick={confirmPortfolioModeSwitch}
                  className="mt-2 rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                >
                  {t(lang, "portfolioModeSwitchConfirm")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
