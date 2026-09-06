"use client";

import { useId, useState } from "react";
import { ArrowPathIcon, CalendarDaysIcon } from "../icons";
import { ToggleButton } from "../toggle-button";
import { type Lang, t } from "../i18n";
import { FieldNotice } from "../field-feedback";
import { Banner } from "../banner";
import { FieldHint } from "../field-hint";
import {
  type M365IntegrationsSettings,
  type TursoIntegrationsSettings,
  type Settings,
  type SnapshotSettings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
  defaultSnapshotSettings,
  type CalendarEntityType,
} from "../settings-types";
import type { SnapshotCadence } from "../snapshot";
import { useMsAuth } from "../use-ms-auth";
import { InfoTooltip } from "../info-tooltip";
import { loadPortfolioMode, savePortfolioMode, type PortfolioMode } from "../portfolio-mode";
import { getTursoConfig, isUsableTursoUrl } from "../turso-config";
import { writeSettings } from "../use-settings";
import { loadRegistry } from "../projects-registry";
import { defaultStorageConfig } from "../workspace";
import { saveSecretValue, setSecretPassphrase } from "../use-secrets";
import { isPassphraseLocked, loadSealed, removeSealed } from "../secrets-store";
import { useIntegrationDisclaimer } from "../integration-disclaimer";
import { Button } from "../button";
import { Checkbox, Input, Select } from "../form-controls";
import { TimelogSettings } from "../timelog-settings";
import { JiraSettingsSection } from "../jira-settings";
import { defaultTimelogConfig, type TimelogLinks } from "../timelog-types";
import { calendarSyncFor } from "../calendar-sync-config";
import { useToastContext } from "../toast-context";
import { reportSilentFailure } from "../guard-feedback";
import { useConfirm } from "../confirm-dialog";

interface IntegrationsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Migrate the current project into Turso + switch the portfolio. Provided
   *  only where a current project exists (the settings views) — when present and
   *  the portfolio is still on File with Turso configured, a "Move to Turso"
   *  button is shown. Omitted in the create-flow modal (no project to move). */
  onMigrateToTurso?: () => void;
  /** Hide the portfolio-mode switch (the "Save & switch" control that reloads
   *  the page). Set by the setup wizard, where a full reload would discard an
   *  in-progress create-project draft and switching app-wide storage mid-setup
   *  is out of scope — that stays an advanced action in the flat Settings panel. */
  hidePortfolioSwitch?: boolean;
  /** Use the "Switch portfolio" label instead of "Save & switch portfolio" on
   *  the confirm button — set when this section is reached from a pre-project
   *  surface (empty state, create-project flow), where "Save" would otherwise
   *  read as saving a project that does not exist. Cosmetic only: it changes
   *  no behavior, just which i18n key the confirm button renders. */
  noCurrentProject?: boolean;
  /** Hide the Jira block. Set by the setup wizard, which has a dedicated Jira
   *  step — without this Jira would render twice (storage step + jira step). */
  hideJira?: boolean;
  /** The workspace `timelogLinks` blob, which carries the TimeLog guardrail
   *  policy. Optional for the same reason `onMigrateToTurso` is: the pre-project
   *  surfaces (setup wizard, backend-config modal, flat settings menu) have no
   *  workspace to write one to. Omitted ⇒ `TimelogSettings` renders no
   *  guardrails section at all. */
  timelogLinks?: TimelogLinks;
  onTimelogLinksChange?: (next: TimelogLinks) => void;
}

/** One calendar write-back entity row (label + an Enable and an Auto-sync toggle
 *  button). Reused per entity type so every row renders identical markup/a11y. */
function CalendarSyncEntityRow({
  lang,
  settings,
  onChange,
  entityType,
  labelKey,
}: {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  entityType: CalendarEntityType;
  labelKey: Parameters<typeof t>[1];
}) {
  const sync = calendarSyncFor(settings, entityType);
  const label = t(lang, labelKey);
  const autoHintId = `${useId()}-auto-hint`;
  const write = (enabled: boolean, auto: boolean) =>
    onChange({
      ...settings,
      outlookCalendar: { ...settings.outlookCalendar, [entityType]: { enabled, auto } },
    });
  return (
    <div className="mt-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 flex flex-col gap-1 pl-1">
        {/* ★ Label PINNED to what pressed=true enables; `aria-pressed` carries the
            state (WCAG 4.1.2). `ariaLabel` keeps the four entity rows distinguishable
            (WCAG 2.4.6). ★★ NOT because a gate would catch it — nothing automated sees
            this row at all, and that is CERTAIN, not likely, for two independent
            reasons: `settings-view.tsx` seeds `active` to "general" and the e2e seed
            only clicks the nav entry, never the rail; and the whole calendar block is
            gated on `m365.enabled`, which `e2e/seed.ts` never configures. Same applies
            to the toolbar copies via `CalendarSyncControls`' `m365Configured` guard —
            so RAID/Resources being in `A11Y_VIEWS` buys nothing here. */}
        <ToggleButton
          pressed={sync.enabled}
          // ★★ Always false, and deliberately so. This once read
          //    `!sync.enabled ? sync.auto : false` to "preserve" auto when
          //    re-enabling — dead code: `sync` comes from `calendarSyncFor`, which
          //    already masks auto to false whenever enabled is false, so the
          //    preserved branch could only ever yield false. Turning a row back on
          //    starts with background sync OFF, which is the safe direction and
          //    what the tests pin.
          // ★★ The four TOOLBAR enable-toggles (tasks-section, and raid/change/
          //    absence in use-calendar-integrations) are NOT equivalent — they read
          //    the RAW stored auto, not this masked one. What makes them safe is
          //    `sanitizeOutlookCalendar` masking at load; do not weaken that on the
          //    assumption the reader-side mask covers them, because it does not.
          onToggle={() => write(!sync.enabled, false)}
          ariaLabel={`${t(lang, "calendarSyncEnable")} – ${label}`}
          title={t(lang, "calendarSyncEnableHint")}
          lang={lang}
          icon={<CalendarDaysIcon aria-hidden="true" className="h-3.5 w-3.5" />}
          className="w-fit"
        >
          {t(lang, "calendarSyncEnable")}
        </ToggleButton>
        {/* ★ Both halves of this setting are ToggleButtons so the row reads as one
            control family. ★★ A real `disabled` (not `aria-disabled`) means the
            auto toggle LEAVES THE TAB ORDER — so a keyboard-only user never lands
            on it and it cannot explain itself. That is why the dependency is
            spelled out in a VISIBLE hint wired via `aria-describedby`, and why the
            primitive drops its "click to turn on" state suffix while disabled: an
            instruction the control cannot honour is worse than none.
            ★ CONSCIOUS TRADE: `aria-describedby` SUPERSEDES `title` as the accessible
            description, so while disabled AT hears "Available once Add to Outlook is
            on" and NOT the what-it-does sentence. Right way round — a user who cannot
            operate the control needs the precondition first — but it is a swap, not
            an addition. */}
        <ToggleButton
          pressed={sync.auto}
          onToggle={() => write(sync.enabled, !sync.auto)}
          ariaLabel={`${t(lang, "calendarSyncAuto")} – ${label}`}
          title={t(lang, "calendarSyncAutoHint")}
          lang={lang}
          ariaDescribedBy={sync.enabled ? undefined : autoHintId}
          disabled={!sync.enabled}
          icon={<ArrowPathIcon aria-hidden="true" className="h-3.5 w-3.5" />}
          className="w-fit"
        >
          {t(lang, "calendarSyncAuto")}
        </ToggleButton>
        {!sync.enabled && (
          <FieldHint id={autoHintId}>{t(lang, "calendarSyncAutoRequiresEnable")}</FieldHint>
        )}
      </div>
    </div>
  );
}

export function IntegrationsSection({ lang, settings, onChange, onMigrateToTurso, hidePortfolioSwitch, hideJira, noCurrentProject, timelogLinks, onTimelogLinksChange }: IntegrationsSectionProps) {
  const { notifyEnable } = useIntegrationDisclaimer();
  const confirm = useConfirm();
  // Busy flags for the two genuinely-async buttons (M365 sign-in, portfolio
  // Save & switch) so a second click can't fire mid-await and SR users hear the
  // pending state.
  const [signInBusy, setSignInBusy] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  const integrations = settings.integrations ?? defaultIntegrations;
  const m365 = integrations.m365 ?? defaultM365Integrations;
  const turso = integrations.turso ?? defaultTursoIntegrations;
  const auth = useMsAuth(m365.enabled, { clientId: m365.clientId, tenantId: m365.tenantId });
  const showToast = useToastContext();
  const envClientIdSet = !!process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenantIdSet = !!process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  // ★★ PRESENCE AND USABILITY ARE DIFFERENT QUESTIONS, and asking only the
  // first is §337: a typo'd env var hid this field while `getTursoConfig`
  // rejected the value, so Turso could not be configured from the UI at all.
  // The predicate is imported rather than re-implemented so the two sites
  // cannot drift apart again.
  const envTursoUrlUsable =
    envTursoUrlSet && isUsableTursoUrl(process.env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? "");
  // ★ The TOKEN gets no equivalent: any non-empty string is a plausible token,
  // so there is nothing to test locally. The "Test connection" button below is
  // what tells a user an env token is wrong.
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;

  function updateTurso(patch: Partial<TursoIntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: { ...integrations, turso: { ...turso, ...patch } },
    });
  }

  // Turso auth-token at-rest wrap mode + passphrase entry. writeSettings blanks
  // turso.authToken from persisted settings, so this device-seal is what survives
  // a reload (mirrors the Anthropic API-key handling in ai-section.tsx).
  const [tokenWrap, setTokenWrap] = useState<"device" | "passphrase">(() =>
    isPassphraseLocked("tursoAuthToken") ? "passphrase" : "device",
  );
  const [tokenPassphrase, setTokenPassphrase] = useState("");
  const [tokenConfirm, setTokenConfirm] = useState("");
  const [tokenStored, setTokenStored] = useState(() => loadSealed("tursoAuthToken") != null);

  function handleAuthTokenChange(value: string) {
    updateTurso({ authToken: value });
    if (tokenWrap === "device") {
      void saveSecretValue("tursoAuthToken", value, "device").then(() => setTokenStored(true));
    }
  }

  function handleTokenLockToggle(checked: boolean) {
    if (checked) {
      // device → passphrase: reveal the passphrase + confirm fields + Save button.
      // Don't seal yet — we need the (confirmed) passphrase first.
      setTokenWrap("passphrase");
      return;
    }
    // Unset the passphrase requirement. Re-seal device-wrapped if the plaintext
    // is in memory (keeps the token); otherwise forget the locked-and-unknown
    // secret. Either way flip wrap to device so the checkbox actually toggles.
    void (async () => {
      if ((turso.authToken ?? "").trim()) {
        await saveSecretValue("tursoAuthToken", turso.authToken ?? "", "device");
        setTokenStored(true);
      } else if (isPassphraseLocked("tursoAuthToken")) {
        removeSealed("tursoAuthToken");
        setTokenStored(false);
      }
      setTokenWrap("device");
      setTokenPassphrase("");
      setTokenConfirm("");
    })();
  }

  function handleTokenLockConfirm() {
    void (async () => {
      await setSecretPassphrase("tursoAuthToken", turso.authToken ?? "", tokenPassphrase);
      setTokenStored(true);
      setTokenPassphrase("");
      setTokenConfirm("");
    })();
  }

  async function handleRemoveToken() {
    if (!(await confirm({ message: t(lang, "secretPassphraseRemoveConfirm") }))) return;
    removeSealed("tursoAuthToken");
    updateTurso({ authToken: "" });
    setTokenStored(false);
    setTokenWrap("device");
    setTokenPassphrase("");
    setTokenConfirm("");
  }

  const tokenPassphraseMismatch = tokenPassphrase !== "" && tokenConfirm !== "" && tokenPassphrase !== tokenConfirm;

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
    if (!portfolioModeDirty || switchBusy) return;
    if (pendingMode === "turso" && !tursoConfigured) return; // guard
    // Mark busy so a rapid second click can't re-enter before the reload tears
    // the component down (also announces the pending switch to SR users).
    setSwitchBusy(true);
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
          <Checkbox
            checked={m365.enabled}
            onChange={(e) => {
              if (e.target.checked) notifyEnable();
              updateM365({ enabled: e.target.checked });
            }}
          />
          <span>{t(lang, "integrationsM365")}</span>
        </label>
        <InfoTooltip text={t(lang, "integrationsM365Tooltip")} />
      </div>
      <FieldHint className="mt-1">
        {t(lang, "integrationsM365Hint")}
      </FieldHint>

      {m365.enabled && (
        <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
          {!envClientIdSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsM365ClientId")}
                <InfoTooltip text={t(lang, "integrationsM365ClientIdTooltip")} />
              </span>
              <Input
                size="xs"
                type="text"
                value={m365.clientId ?? ""}
                onChange={(e) => updateM365({ clientId: e.target.value })}
                placeholder={t(lang, "integrationsM365ClientIdPlaceholder")}
                className="mt-1 w-full"
              />
            </label>
          )}
          {!envTenantIdSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsM365TenantId")}
                <InfoTooltip text={t(lang, "integrationsM365TenantIdTooltip")} />
              </span>
              <Input
                size="xs"
                type="text"
                value={m365.tenantId ?? ""}
                onChange={(e) => updateM365({ tenantId: e.target.value })}
                placeholder={t(lang, "integrationsM365TenantIdPlaceholder")}
                className="mt-1 w-full"
              />
            </label>
          )}

          <div className="flex items-center gap-2">
            {auth.account ? (
              <>
                <span className="text-xs text-foreground">
                  {t(lang, "integrationsM365SignedInAs")} {auth.account.username}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => { void auth.signOut().catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed")); }}
                >
                  {t(lang, "integrationsM365SignOut")}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                size="xs"
                onClick={() => {
                  setSignInBusy(true);
                  void auth
                    .signIn()
                    .catch((e) => reportSilentFailure(showToast, lang, "msauth.signInFailed", e, "guardMsSignInFailed"))
                    .finally(() => setSignInBusy(false));
                }}
                disabled={signInBusy || (!envClientIdSet && !m365.clientId)}
                aria-busy={signInBusy}
                title={
                  !envClientIdSet && !m365.clientId
                    ? t(lang, "integrationsM365NeedsConfig")
                    : undefined
                }
              >
                {t(lang, "integrationsM365SignIn")}
              </Button>
            )}
          </div>

          <fieldset className="mt-3 border-t border-line pt-2">
            {(
              [
                ["integrationsSharepoint", "sharepoint", false, "integrationsSharepointTooltip"],
                ["integrationsOutlookContacts", "outlookContacts", false, "integrationsOutlookContactsTooltip"],
                ["integrationsOutlookCalendar", "outlookCalendar", false, "integrationsOutlookCalendarTooltip"],
                ["settingsOutlookCalendarPush", "outlookCalendarPush", false, "settingsOutlookCalendarPushHint"],
              ] as const
            ).map(([labelKey, key, comingSoon, tooltipKey]) => (
              <div key={labelKey} className="mt-1 flex items-center gap-1">
                <label
                  className={`flex items-center gap-2 text-sm ${comingSoon ? "text-muted-foreground" : "text-foreground"}`}
                  title={comingSoon ? t(lang, "integrationsComingSoon") : undefined}
                >
                  <Checkbox
                    disabled={comingSoon}
                    checked={comingSoon ? false : m365[key]}
                    onChange={
                      comingSoon
                        ? undefined
                        : (e) => updateM365({ [key]: e.target.checked })
                    }
                  />
                  <span>{t(lang, labelKey)}</span>
                </label>
                <InfoTooltip text={t(lang, tooltipKey)} />
              </div>
            ))}
          </fieldset>

          <div className="mt-3 border-t border-line pt-2">
            <h4 className="text-sm font-semibold text-foreground">{t(lang, "calendarSyncHeading")}</h4>
            <FieldHint className="mt-1">{t(lang, "calendarSyncDesc")}</FieldHint>
            <CalendarSyncEntityRow
              lang={lang}
              settings={settings}
              onChange={onChange}
              entityType="task"
              labelKey="calendarSyncEntityTask"
            />
            <CalendarSyncEntityRow
              lang={lang}
              settings={settings}
              onChange={onChange}
              entityType="raid"
              labelKey="calendarSyncEntityRaid"
            />
            <CalendarSyncEntityRow
              lang={lang}
              settings={settings}
              onChange={onChange}
              entityType="change"
              labelKey="calendarSyncEntityChange"
            />
            <CalendarSyncEntityRow
              lang={lang}
              settings={settings}
              onChange={onChange}
              entityType="absence"
              labelKey="calendarSyncEntityAbsence"
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={turso.enabled}
            onChange={(e) => {
              if (e.target.checked) notifyEnable();
              updateTurso({ enabled: e.target.checked });
            }}
          />
          <span>{t(lang, "integrationsTurso")}</span>
        </label>
        <InfoTooltip text={t(lang, "integrationsTursoTooltip")} />
      </div>
      <FieldHint className="mt-1">
        {t(lang, "integrationsTursoHint")}
      </FieldHint>
      <p className="mt-1 text-xs">
        <a
          href="https://turso.tech/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ui-dark-blue underline hover:opacity-80"
        >
          {t(lang, "integrationsTursoLearnMore")}
        </a>
      </p>

      {turso.enabled && (
        <div className="mt-2 space-y-2 border-l-2 border-line pl-3">
          {envTursoUrlUsable && (
            <div className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <FieldHint className="mt-1">{t(lang, "integrationsTursoUrlFromEnv")}</FieldHint>
            </div>
          )}
          {!envTursoUrlUsable && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoUrl")}
                <InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />
              </span>
              <Input
                size="xs"
                type="text"
                value={turso.databaseUrl ?? ""}
                onChange={(e) => updateTurso({ databaseUrl: e.target.value })}
                placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                className="mt-1 w-full"
              />
              {envTursoUrlSet && (
                <FieldNotice>{t(lang, "integrationsTursoUrlEnvUnusable")}</FieldNotice>
              )}
            </label>
          )}
          {envTursoTokenSet && (
            <div className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoToken")}
                <InfoTooltip text={t(lang, "integrationsTursoTokenTooltip")} />
              </span>
              <FieldHint className="mt-1">{t(lang, "integrationsTursoTokenFromEnv")}</FieldHint>
            </div>
          )}
          {!envTursoTokenSet && (
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "integrationsTursoToken")}
                <InfoTooltip text={t(lang, "integrationsTursoTokenTooltip")} />
              </span>
              <Input
                size="xs"
                type="password"
                value={turso.authToken ?? ""}
                onChange={(e) => handleAuthTokenChange(e.target.value)}
                placeholder={t(lang, "integrationsTursoTokenPlaceholder")}
                className="mt-1 w-full"
              />
              <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
            </label>
          )}
          {!envTursoTokenSet && (
            <div className="mt-1">
              <label className="flex items-center gap-2">
                <Checkbox
                  aria-label={t(lang, "secretLockPassphrase")}
                  checked={tokenWrap === "passphrase"}
                  onChange={(e) => handleTokenLockToggle(e.target.checked)}
                />
                <span className="text-xs text-foreground">{t(lang, "secretLockPassphrase")}</span>
              </label>
              {tokenWrap === "passphrase" && (
                <div className="mt-2 flex flex-col gap-2">
                  <Input
                    size="xs"
                    type="password"
                    autoComplete="off"
                    aria-label={t(lang, "secretPassphrasePlaceholder")}
                    placeholder={t(lang, "secretPassphrasePlaceholder")}
                    value={tokenPassphrase}
                    onChange={(e) => setTokenPassphrase(e.target.value)}
                    className="w-full"
                  />
                  <Input
                    size="xs"
                    type="password"
                    autoComplete="off"
                    aria-label={t(lang, "secretPassphraseConfirm")}
                    placeholder={t(lang, "secretPassphraseConfirm")}
                    value={tokenConfirm}
                    onChange={(e) => setTokenConfirm(e.target.value)}
                    className="w-full"
                  />
                  {tokenPassphraseMismatch && (
                    <Banner severity="error">{t(lang, "secretPassphraseMismatch")}</Banner>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    className="self-start whitespace-nowrap"
                    disabled={!(turso.authToken ?? "").trim() || !tokenPassphrase || tokenPassphrase !== tokenConfirm}
                    onClick={handleTokenLockConfirm}
                  >
                    {t(lang, "secretPassphraseSave")}
                  </Button>
                  <FieldHint>{t(lang, "secretLockWarning")}</FieldHint>
                </div>
              )}
              {tokenStored && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-2"
                  onClick={() => void handleRemoveToken()}
                  title={t(lang, "secretPassphraseRemoveHint")}
                >
                  {t(lang, "secretPassphraseRemove")}
                </Button>
              )}
            </div>
          )}
          {/* Primary action: carry the current project into Turso. */}
          {canMoveToTurso && (
            <div className="mt-2 border-t border-line pt-2">
              <Button size="sm" onClick={onMigrateToTurso}>
                {t(lang, "projectMigrateToTurso")}
              </Button>
              <FieldHint className="mt-1">{t(lang, "projectMigrateToTursoHint")}</FieldHint>
            </div>
          )}
          <div className="mt-2 border-t border-line pt-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={snapshots.enabled}
                disabled={!onTurso}
                onChange={(e) => updateSnapshots({ enabled: e.target.checked })}
              />
              <span className={onTurso ? undefined : "text-muted-foreground"}>
                {t(lang, "snapshotRecordingLabel")}
              </span>
            </label>
            <FieldHint className="mt-1">
              {t(lang, onTurso ? "snapshotNeedsTurso" : "snapshotNeedsTursoFirst")}
            </FieldHint>
            <label className="mt-2 block text-xs">
              <span className="text-muted-foreground">{t(lang, "snapshotCadenceLabel")}</span>
              <Select
                size="xs"
                aria-label={t(lang, "snapshotCadenceLabel")}
                value={snapshots.cadence}
                onChange={(e) => updateSnapshots({ cadence: e.target.value as SnapshotCadence })}
                className="mt-1 w-full"
              >
                <option value="weekly">{t(lang, "snapshotCadenceWeekly")}</option>
                <option value="daily">{t(lang, "snapshotCadenceDaily")}</option>
                <option value="monthly">{t(lang, "snapshotCadenceMonthly")}</option>
              </Select>
            </label>
            {snapshots.enabled && !(envTursoUrlSet || turso.databaseUrl) && (
              <Banner severity="error" className="mt-1">{t(lang, "snapshotConfigIncomplete")}</Banner>
            )}
          </div>
          {!hidePortfolioSwitch && (
          <div className="mt-2 border-t border-line pt-2">
            <label className="block text-xs">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {t(lang, "portfolioModeLabel")}
              </span>
              <Select
                size="xs"
                aria-label={t(lang, "portfolioModeLabel")}
                value={pendingMode}
                onChange={(e) => setPendingMode(e.target.value as PortfolioMode)}
                className="mt-1 w-full"
              >
                <option value="file">{t(lang, "portfolioModeFile")}</option>
                <option value="turso" disabled={!tursoConfigured}>
                  {t(lang, "portfolioModeTurso")}
                </option>
              </Select>
            </label>
            <FieldHint className="mt-1">{t(lang, "portfolioModeHelp")}</FieldHint>
            {tursoConfigured && (
              <FieldHint className="mt-1">{t(lang, "portfolioModeTursoLoadHint")}</FieldHint>
            )}
            {!tursoConfigured && (
              <Banner severity="error" className="mt-1">{t(lang, "portfolioModeTursoNeedsConfig")}</Banner>
            )}
            {portfolioModeDirty && (
              <div className="mt-2 rounded-md border border-ui-purple/40 bg-ui-purple/5 p-2">
                <p className="text-xs text-foreground">{t(lang, "portfolioModeSwitchNote")}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={confirmPortfolioModeSwitch}
                  disabled={switchBusy}
                  aria-busy={switchBusy}
                >
                  {t(lang, noCurrentProject ? "portfolioModeSwitchConfirmNoProject" : "portfolioModeSwitchConfirm")}
                </Button>
              </div>
            )}
          </div>
          )}
        </div>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={settings.digest?.enabled ?? false}
            onChange={(e) => {
              if (e.target.checked) notifyEnable();
              onChange({
                ...settings,
                digest: { enabled: e.target.checked, cadenceDays: settings.digest?.cadenceDays ?? 7 },
              });
            }}
          />
          <span>{t(lang, "digestEnableLabel")}</span>
        </label>
        <label className="mt-2 block text-xs">
          <span className="text-muted-foreground">{t(lang, "digestCadenceLabel")}</span>
          <Select
            size="xs"
            aria-label={t(lang, "digestCadenceLabel")}
            value={settings.digest?.cadenceDays ?? 7}
            onChange={(e) =>
              onChange({
                ...settings,
                digest: { enabled: settings.digest?.enabled ?? false, cadenceDays: Number(e.target.value) },
              })
            }
            className="mt-1 w-full"
          >
            <option value={7}>{t(lang, "digestCadenceWeekly")}</option>
            <option value={14}>{t(lang, "digestCadenceBiweekly")}</option>
            <option value={30}>{t(lang, "digestCadenceMonthly")}</option>
          </Select>
        </label>
      </div>
      <TimelogSettings
        lang={lang}
        config={settings.timelog ?? defaultTimelogConfig}
        onChange={(next) => onChange({ ...settings, timelog: next })}
        links={timelogLinks}
        onLinksChange={onTimelogLinksChange}
      />
      {!hideJira && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-1 text-sm font-medium text-foreground">{t(lang, "settingsSectionJira")}</h3>
          <JiraSettingsSection
            lang={lang}
            config={settings.jira}
            onChange={(jira) => onChange({ ...settings, jira })}
            alwaysOpen
          />
        </div>
      )}
    </div>
  );
}
