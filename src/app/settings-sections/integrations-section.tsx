"use client";

import { useId, useState, type FocusEvent, type MouseEvent } from "react";
import { logDiag } from "../diagnostics";
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
import { testTursoConnection } from "../turso-pipeline";
import { tursoErrorKind } from "../storage-error";
import { INTERACTIVE } from "../interaction-styles";
import { writeSettings } from "../use-settings";
import { loadRegistry } from "../projects-registry";
import { defaultStorageConfig } from "../workspace";
import { saveSecretValue, setSecretPassphrase } from "../use-secrets";
import { isPassphraseLocked, loadSealed, removeSealed } from "../secrets-store";
import { useIntegrationDisclaimer } from "../integration-disclaimer";
import { Button } from "../button";
import { Checkbox, HintedLabel, Input, Select } from "../form-controls";
import { TimelogSettings } from "../timelog-settings";
import { JiraSettingsSection } from "../jira-settings";
import { defaultTimelogConfig, type TimelogLinks } from "../timelog-types";
import { calendarSyncFor } from "../calendar-sync-config";
import { useToastContext } from "../toast-context";
import { reportSilentFailure } from "../guard-feedback";
import { useConfirm } from "../confirm-dialog";

/** Turso probe failure reason → the i18n key its message is rendered from.
 *  ★ Keys, not strings: the verdict outlives the probe, so it must be
 *  translated at RENDER time or it freezes the language it was obtained in. */
const TURSO_TEST_FAIL_KEYS = {
  auth: "integrationsTursoTestAuth",
  unreachable: "integrationsTursoTestUnreachable",
  generic: "integrationsTursoTestFailGeneric",
} as const;

// ★★ §548 — IN-FLIGHT TURSO TOKEN SEALS, tracked at MODULE scope on purpose. A blur commit on
// Turso storage rebuilds the backend and the load hold remounts this section, so a per-instance
// ref would forget a seal started by the instance that just went away. "Save & switch" reloads
// the page, and a reload before the seal settles loses the token (`writeSettings` blanks it), so
// `confirmPortfolioModeSwitch` waits on `pendingTokenSeals` first. A failed seal is logged, never
// rethrown: the switch must still happen, exactly as it did before this wait existed.
const inFlightTokenSeals = new Set<Promise<void>>();

function trackTokenSeal(seal: Promise<unknown>): void {
  const settled = seal.then(
    () => undefined,
    (err: unknown) => {
      logDiag("error", "settings.tursoTokenSealFailed", {
        message: err instanceof Error ? err.message : String(err),
      });
    },
  );
  inFlightTokenSeals.add(settled);
  void settled.then(() => inFlightTokenSeals.delete(settled));
}

/** ★★ §548 — for a button that acts on the Turso DRAFTS. Preventing the mousedown default keeps
 *  focus in the field, so no blur commit fires: on Turso storage that commit rebuilds the backend
 *  and the load hold remounts this section BEFORE the click lands, swallowing it. The group-level
 *  commit alone does not cover this — WebKit does not focus a button on click, so there the blur
 *  carries a null `relatedTarget` and reads as "focus left the group". Same idiom as
 *  `ResourcePicker`'s clear button. Keyboard activation never fires a mousedown. */
function keepFocusOnMouseDown(e: MouseEvent<HTMLButtonElement>): void {
  e.preventDefault();
}

/** A promise over every seal still in flight, or `null` when none is — so the caller can stay
 *  synchronous in the common case. */
function pendingTokenSeals(): Promise<unknown> | null {
  return inFlightTokenSeals.size > 0 ? Promise.all([...inFlightTokenSeals]) : null;
}

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
  // so there is nothing to test locally. UI and resolver therefore both gate
  // the token on PRESENCE and so AGREE — that agreement is the property §337
  // restored for the URL, not an unfinished half of it.
  // ★★ BUT THE RECOURSE IS NOT SYMMETRIC, and an earlier version of this
  // comment claimed the "Test connection" button was the remedy. It DETECTS a
  // wrong env token; it gives no way to FIX one, because a present env token
  // hides the token field and wins unconditionally. So the §337 shape is only
  // half closed: with a typo'd env URL and a present env token, a user can now
  // type a working URL and still be stuck with a token they cannot see or
  // override — a mixed-credential pair that could not arise before this fix,
  // since the unusable URL used to null the whole config. The only recourse is
  // changing the deployment env; §337 (still open) is the nearest tracker.
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;

  function updateTurso(patch: Partial<TursoIntegrationsSettings>) {
    onChange({
      ...settings,
      integrations: { ...integrations, turso: { ...turso, ...patch } },
    });
  }

  // ★★★ §548 — THE URL AND TOKEN ARE DRAFTS, COMMITTED ON BLUR (the SharePoint URL field in
  //   `storage-config.tsx` is the precedent: blur only, no Enter). On Turso storage both values feed
  //   the backend memo in `useStorageBackend`, so committing per keystroke built a new backend per
  //   keystroke — and each rebuild re-arms the load hold, which replaces the whole main-window tree,
  //   this section included, with the skeleton. The field unmounted after the first character.
  // ★ Every read in THIS section goes through the drafts (the probe, its fingerprint, the configured
  //   check, the passphrase seal), so what the user sees is what those act on. Resynced from settings
  //   by the render-time reconcile below whenever the stored value changes from outside (reload,
  //   "remove stored secret"); `set-state-in-effect` is fatal here.
  // ★★ The reconcile resyncs a CLEAN draft only (draft === the last stored value it saw). A
  //   draft the user is editing is kept when the stored value moves underneath it — the edit
  //   is the newer intent, and the blur commit then writes it. Without the guard an outside
  //   write (another settings surface, a hydration) silently replaced what was being typed.
  const [tursoUrl, setTursoUrl] = useState(turso.databaseUrl);
  const [tursoToken, setTursoToken] = useState(turso.authToken);
  const [prevStoredTursoUrl, setPrevStoredTursoUrl] = useState(turso.databaseUrl);
  const [prevStoredTursoToken, setPrevStoredTursoToken] = useState(turso.authToken);
  if (prevStoredTursoUrl !== turso.databaseUrl) {
    setPrevStoredTursoUrl(turso.databaseUrl);
    if (tursoUrl === prevStoredTursoUrl) setTursoUrl(turso.databaseUrl);
  }
  if (prevStoredTursoToken !== turso.authToken) {
    setPrevStoredTursoToken(turso.authToken);
    if (tursoToken === prevStoredTursoToken) setTursoToken(turso.authToken);
  }

  // ★★★ §548 — ONE COMMIT POINT FOR THE WHOLE CREDENTIALS GROUP, not one per field. On Turso
  //   storage a commit rebuilds the backend and the load hold REMOUNTS this section, so a
  //   per-field blur commit fired on the way to the next control in the group (the token field,
  //   the lock toggle, the passphrase inputs, "Test connection") and the remount swallowed that
  //   control's click and reset this section's state. `handleCredentialsBlur` commits only when
  //   focus leaves the group (or goes nowhere — Escape in a `Modal` host blurs first, see
  //   `modal.tsx`). ★ ONE `onChange`: two `updateTurso` calls in one tick would each spread the
  //   same stale `turso`, and the second would drop the first's field.
  function commitTursoDrafts() {
    const urlChanged = tursoUrl !== turso.databaseUrl;
    const tokenChanged = tursoToken !== turso.authToken;
    if (!urlChanged && !tokenChanged) return;
    const tokenValue = tursoToken ?? "";
    updateTurso({
      ...(urlChanged ? { databaseUrl: tursoUrl } : {}),
      ...(tokenChanged ? { authToken: tokenValue } : {}),
    });
    // ★ The device-seal rides the COMMIT, not the keystroke: the sealed value is the one settings hold.
    if (tokenChanged && tokenWrap === "device") {
      trackTokenSeal(saveSecretValue("tursoAuthToken", tokenValue, "device").then(() => setTokenStored(true)));
    }
  }

  function handleCredentialsBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    commitTursoDrafts();
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
  // ★ The env-unusable notice is a DESCRIPTION, not part of the field's name —
  // see the render site for why it sits outside the <label>.
  const tursoUrlEnvNoticeId = `${useId()}-turso-url-env`;
  const tursoTokenNoteId = `${useId()}-turso-token-note`;
  // ★★ TWO ids, because the two states have DIFFERENT descriptions and each
  // must be announced exactly once — see the render site. `tursoMoveHintId`
  // labels the VISIBLE hint, which is reachable on its own; the sr-only node
  // exists ONLY for the gated state, where the control is not focusable.
  const tursoMoveHintId = `${useId()}-turso-move`;
  const tursoMoveNeedsTestId = `${useId()}-turso-move-needs-test`;
  const [tursoTesting, setTursoTesting] = useState(false);
  // ★★ FINGERPRINTED, and the fingerprint is the whole point. This holds the
  // URL and token the verdict was obtained FOR, so "is the test still valid?"
  // is DERIVED below rather than written by an invalidation handler. A written
  // invalidation has to be remembered at every edit path, including ones added
  // later; a derived one cannot be forgotten, and the stale-confirmed state is
  // simply unrepresentable.
  // ★ TRANSIENT BY DESIGN — resets on reload, exactly like the Jira and
  // Timelog test results. Persisting it would be a new Settings field and
  // therefore the six-write-paths case (open-followups §408).
  // ★ The URL and token are already in component state; holding a copy here
  // adds no exposure. Neither is ever rendered, logged or thrown.
  // ★ `url`/`token` are `string | undefined` because the SETTINGS fields are,
  // and they are stored RAW — the very expressions handed to `getTursoConfig`.
  // Normalising them (`?? ""`) here would put a second transformation between
  // the write and the comparison below, which is exactly the kind of drift the
  // derived shape exists to rule out. They are also NON-OPTIONAL on both arms:
  // a third write site added later that forgets the fingerprint is then a
  // COMPILE error rather than a silently stale "still confirmed".
  // ★★ A KEY, NEVER A RENDERED STRING. An earlier cut stored `t(lang, …)` at
  // probe time, which froze the verdict's language: this section and
  // `LocalizationSection` mount in the same panel, so switching to Deutsch left
  // an English "Connected." inside a German panel. That is the very defect the
  // CLASSIFY-NEVER-INTERPOLATE block on `runTursoTest` exists to prevent, one
  // layer up. `reason` lives on the fail arm ALONE because a success has none —
  // which is also what makes `kind` load-bearing at the render site rather than
  // written-and-never-read.
  const [tursoTest, setTursoTest] = useState<
    | { kind: "ok"; url: string | undefined; token: string | undefined }
    | {
        kind: "fail";
        reason: "auth" | "unreachable" | "generic";
        url: string | undefined;
        token: string | undefined;
      }
    | null
  >(null);

  // ★★ DERIVED, never written. An edit to either field moves the comparison,
  // so no edit path — including one added later — has to remember to clear a
  // flag.
  const tursoTestFresh =
    tursoTest !== null &&
    tursoTest.url === tursoUrl &&
    tursoTest.token === tursoToken;
  // ★ No `?.` — `tursoTestFresh` opens with `tursoTest !== null` and TS narrows
  // through the aliased const, so an optional chain would only paper over a
  // broken invariant: it would render the gate CLOSED (safe-looking) instead of
  // failing, hiding the bug. Same reasoning as the verdict's render site below.
  const tursoTestConfirmed = tursoTestFresh && tursoTest.kind === "ok";

  async function runTursoTest() {
    // ★★★ CLASSIFY, NEVER INTERPOLATE THE THROWN MESSAGE. The first cut of this
    //     rendered `t(lang, "…TestFail", e.message)`. Every message reachable
    //     here is untranslated English, and `StorageNotReadyError` prefixes its
    //     own hint (`Storage not ready: ${hint}`, workspace.ts), so a German
    //     user was shown "Verbindung fehlgeschlagen: Storage not ready:
    //     storage-unreachable" — an internal prefix plus an internal code, in a
    //     control that is otherwise fully localised. `tursoErrorKind`
    //     (storage-error.ts) already discriminates exactly these cases and is
    //     what the storage banner uses; reusing it keeps one classifier rather
    //     than a second, drifting copy that matches English sentences by hand.
    // ★ NO null-config branch here, and adding one back would be DEAD CODE:
    // the button is `disabled={tursoTesting || !tursoConfigured}` and
    // `tursoConfigured` is `!!getTursoConfig(...)` over these same two fields,
    // so a null config means the control is disabled — and a disabled button
    // dispatches no click at all. Measured: a test that clicked it and awaited
    // a message timed out at 15 s rather than failing an assertion.
    setTursoTesting(true);
    setTursoTest(null);
    try {
      await testTursoConnection(getTursoConfig(tursoUrl, tursoToken));
      setTursoTest({ kind: "ok", url: tursoUrl, token: tursoToken });
    } catch (e) {
      // ★ A kind, never the config and never a raw message — nothing thrown
      // here may carry the URL or token into the DOM.
      const kind = tursoErrorKind(e);
      setTursoTest({
        kind: "fail",
        // ★★ `?? "generic"` RATHER THAN A TERNARY CHAIN, and the difference is
        // a compile error. `reason` mirrors `StorageErrorKind` exactly, so the
        // two are equivalent TODAY — but a chain ending in a `:` fallback
        // absorbs any FUTURE member of that union into "generic" with no
        // diagnostic, so a new storage kind with its own banner would leave
        // this probe quietly reporting "Connection failed." The nullish
        // coalesce only fills in `tursoErrorKind`'s `null` (unrecognised), and
        // widening the union makes it TS2322 — the author has to decide.
        reason: kind ?? "generic",
        url: tursoUrl,
        token: tursoToken,
      });
    } finally {
      setTursoTesting(false);
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
    trackTokenSeal((async () => {
      if ((tursoToken ?? "").trim()) {
        await saveSecretValue("tursoAuthToken", tursoToken ?? "", "device");
        setTokenStored(true);
      } else if (isPassphraseLocked("tursoAuthToken")) {
        removeSealed("tursoAuthToken");
        setTokenStored(false);
      }
      setTokenWrap("device");
      setTokenPassphrase("");
      setTokenConfirm("");
    })());
  }

  function handleTokenLockConfirm() {
    trackTokenSeal((async () => {
      await setSecretPassphrase("tursoAuthToken", tursoToken ?? "", tokenPassphrase);
      setTokenStored(true);
      setTokenPassphrase("");
      setTokenConfirm("");
    })());
  }

  async function handleRemoveToken() {
    if (!(await confirm({ message: t(lang, "secretPassphraseRemoveConfirm") }))) return;
    removeSealed("tursoAuthToken");
    updateTurso({ authToken: "" });
    // ★ Also clear the draft: when the stored token is already "" the reconcile sees no change.
    setTursoToken("");
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
  const tursoConfigured = !!getTursoConfig(tursoUrl, tursoToken);
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
    // ★★ §548 — THE SWITCH ACTS ON WHAT THE FIELDS SHOW. The button's mousedown is
    // prevented (below), so an uncommitted Turso draft is still a draft here; fold it
    // in and seal it, or the reload would discard it.
    const tokenDirty = tursoToken !== turso.authToken;
    if (tokenDirty && tokenWrap === "device") {
      trackTokenSeal(saveSecretValue("tursoAuthToken", tursoToken ?? "", "device"));
    }
    const base: Settings =
      tokenDirty || tursoUrl !== turso.databaseUrl
        ? {
            ...settings,
            integrations: {
              ...integrations,
              turso: { ...turso, databaseUrl: tursoUrl, authToken: tursoToken ?? "" },
            },
          }
        : settings;
    // ★★★ A RELOAD BEFORE THE SEAL SETTLES LOSES THE TOKEN: `writeSettings` blanks it, so the
    // device-sealed copy is the only one that survives. Wait for every in-flight seal (this
    // switch's, a blur commit's — possibly from an instance a hold already remounted away).
    // Synchronous when nothing is in flight.
    const seals = pendingTokenSeals();
    if (seals) {
      void seals.then(() => finishPortfolioModeSwitch(base));
      return;
    }
    finishPortfolioModeSwitch(base);
  }

  function finishPortfolioModeSwitch(base: Settings) {
    savePortfolioMode(pendingMode);
    // Keep the workspace storage backend aligned with the portfolio: switching TO
    // Turso must also persist storageConfig.kind "turso" (synchronously, so it
    // survives the reload), or the backend memo rebuilds a file/browser backend
    // and the workspace keeps loading the local file while the project list +
    // snapshots talk to Turso. (portfolioMode === "turso" ⟺ storageConfig "turso".)
    if (pendingMode === "turso") {
      writeSettings({ ...base, storageConfig: { kind: "turso" } });
    } else if (settings.storageConfig?.kind === "turso") {
      // Leaving Turso for the File portfolio: a leftover "turso" storageConfig
      // would keep the backend memo pointed at Turso after reload (no file-mode
      // bootstrap reconciles it), stranding the user. Restore the File portfolio's
      // current-project backend config (registry is its source of truth), or the
      // browser default if none.
      const reg = loadRegistry();
      const current = reg.projects.find((p) => p.id === reg.currentProjectId);
      writeSettings({ ...base, storageConfig: current?.storageConfig ?? defaultStorageConfig });
    } else if (base !== settings) {
      writeSettings(base);
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
          {/* ★★ Hinted fields render through `HintedLabel`: the hint sits
              OUTSIDE the naming <label> (open-followups §386). Its row gap
              replaces the input's former `mt-1`. */}
          {!envClientIdSet && (
            <HintedLabel
              className="text-xs"
              hint={<InfoTooltip text={t(lang, "integrationsM365ClientIdTooltip")} />}
              caption={<span className="inline-flex items-center gap-1 text-muted-foreground">{t(lang, "integrationsM365ClientId")}</span>}
            >
              <Input
                size="xs"
                type="text"
                value={m365.clientId ?? ""}
                onChange={(e) => updateM365({ clientId: e.target.value })}
                placeholder={t(lang, "integrationsM365ClientIdPlaceholder")}
                className="w-full"
              />
            </HintedLabel>
          )}
          {!envTenantIdSet && (
            <HintedLabel
              className="text-xs"
              hint={<InfoTooltip text={t(lang, "integrationsM365TenantIdTooltip")} />}
              caption={<span className="inline-flex items-center gap-1 text-muted-foreground">{t(lang, "integrationsM365TenantId")}</span>}
            >
              <Input
                size="xs"
                type="text"
                value={m365.tenantId ?? ""}
                onChange={(e) => updateM365({ tenantId: e.target.value })}
                placeholder={t(lang, "integrationsM365TenantIdPlaceholder")}
                className="w-full"
              />
            </HintedLabel>
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
          {/* ★★ §548 — the credentials GROUP: its drafts commit once, when focus leaves it
              (`handleCredentialsBlur`). Everything that acts on the drafts lives inside it. */}
          <div className="space-y-2" onBlur={handleCredentialsBlur}>
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
            // ★★ THE NOTICE SITS OUTSIDE THE <label> ON PURPOSE. An implicit
            // label (no `for`/`id`) contributes its WHOLE SUBTREE to the
            // control's accessible name, so a FieldNotice nested inside it made
            // the field announce as "Database URL, <tooltip>,
            // NEXT_PUBLIC_TURSO_DATABASE_URL is set but is not a usable Turso
            // URL, …" — a paragraph as a name. Outside the label plus
            // `aria-describedby` makes it a DESCRIPTION, which is what it is,
            // and it is also what makes FieldNotice's own `role="status"`
            // meaningful rather than decorative here.
            // ★ axe cannot see any of this (no rule covers a bloated accessible
            // name), so nothing but this comment and a unit test guards it.
            <div className="text-xs">
              {/* ★★ The tooltip is outside the label too (open-followups §386),
                  for the same reason as the notice above. */}
              <HintedLabel
                hint={<InfoTooltip text={t(lang, "integrationsTursoUrlTooltip")} />}
                caption={<span className="inline-flex items-center gap-1 text-muted-foreground">{t(lang, "integrationsTursoUrl")}</span>}
              >
                <Input
                  size="xs"
                  type="text"
                  value={tursoUrl ?? ""}
                  onChange={(e) => setTursoUrl(e.target.value)}
                  placeholder={t(lang, "integrationsTursoUrlPlaceholder")}
                  className="w-full"
                  aria-describedby={envTursoUrlSet ? tursoUrlEnvNoticeId : undefined}
                />
              </HintedLabel>
              {envTursoUrlSet && (
                <FieldNotice id={tursoUrlEnvNoticeId}>
                  {t(lang, "integrationsTursoUrlEnvUnusable")}
                </FieldNotice>
              )}
            </div>
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
            // ★★ Tooltip AND storage notice sit outside the naming <label>
            // (open-followups §386; the notice for the same reason as the URL
            // notice above). The notice is now the field's description.
            <div className="text-xs">
              <HintedLabel
                hint={<InfoTooltip text={t(lang, "integrationsTursoTokenTooltip")} />}
                caption={<span className="inline-flex items-center gap-1 text-muted-foreground">{t(lang, "integrationsTursoToken")}</span>}
              >
                <Input
                  size="xs"
                  type="password"
                  value={tursoToken ?? ""}
                  onChange={(e) => setTursoToken(e.target.value)}
                  placeholder={t(lang, "integrationsTursoTokenPlaceholder")}
                  className="w-full"
                  aria-describedby={tursoTokenNoteId}
                />
              </HintedLabel>
              <FieldNotice id={tursoTokenNoteId}>{t(lang, "credentialStorageNote")}</FieldNotice>
            </div>
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
                    disabled={!(tursoToken ?? "").trim() || !tokenPassphrase || tokenPassphrase !== tokenConfirm}
                    onMouseDown={keepFocusOnMouseDown}
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
          <button
            type="button"
            onMouseDown={keepFocusOnMouseDown}
            onClick={() => void runTursoTest()}
            disabled={tursoTesting || !tursoConfigured}
            aria-label={t(lang, "integrationsTursoTestLabel")}
            className={`self-start rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-ui-dark-blue disabled:cursor-not-allowed disabled:opacity-50 dark:text-ui-light-grey ${INTERACTIVE}`}
          >
            {t(lang, "integrationsTursoTest")}
          </button>
          <p role="status" className="text-xs text-muted-foreground">
            {/* ★ No `?.` — `tursoTestFresh` opens with `tursoTest !== null`, and
                TS narrows through the aliased const, so the optional chain would
                only paper over a broken invariant by rendering nothing. */}
            {tursoTestFresh
              ? t(
                  lang,
                  tursoTest.kind === "ok"
                    ? "integrationsTursoTestOk"
                    : TURSO_TEST_FAIL_KEYS[tursoTest.reason],
                )
              : null}
          </p>
          </div>
          {/* Primary action: carry the current project into Turso.
              ★ `canMoveToTurso` stays a RENDER gate — with the portfolio already
              on Turso, or no project to move, there is nothing to migrate and a
              permanently disabled control is noise. The CONFIRMED-connection
              condition rides `disabled` instead, because it is a state the user
              can act on.
              ★★★ `disabled` HERE IS THE AFFORDANCE, NOT THE GATE. The gate is
              the probe inside `migrateCurrentProjectToTurso`
              (`use-storage-turso-ops.ts`), because `projects-panel.tsx` binds a
              SECOND button to this same handler and this surface cannot see it.
              Do not read the `disabled` attribute as making a handler-level
              guard redundant. */}
          {canMoveToTurso && (
            <div className="mt-2 border-t border-line pt-2">
              {/* ★★ Same wrapper contract as `projects-panel.tsx`'s disabled
                  Turso buttons — read the block comment there. The short of it:
                  a disabled control is NOT focusable, so `title` is unreachable
                  by keyboard and on touch, while `aria-describedby` IS exposed
                  on a disabled control AND OUTRANKS `title` as the accessible
                  description. WHILE DISABLED the sr-only node is what actually
                  reaches AT; the `title` stays for the sighted mouse user, and
                  it only lands reliably because `disabled:pointer-events-none`
                  drops the button out of hit-testing so the pointer falls
                  through to this span. `button.tsx`'s BASE_CLASS does set
                  `disabled:cursor-not-allowed`, but a subtree with no pointer
                  events cannot style a cursor either, so that rule goes INERT
                  here and the wrapper must carry the cursor itself — the change
                  belongs HERE, never in the shared primitive that every other
                  disabled button rides.
                  ★★★ THE `title` IS GATED-STATE ONLY, and NOT because the
                  enabled button stops the pointer reaching the span. `title` is
                  INHERITED for tooltip purposes (HTML Living Standard: an
                  element with no `title` of its own takes the nearest
                  ancestor's), so a `title` left on this span would still fire a
                  tooltip on the ENABLED button — reading out the very sentence
                  the visible `FieldHint` renders directly below it. That is the
                  double announcement fixed on the describedby channel, one
                  channel over. `undefined` when confirmed is what closes it.
                  ★ Spec-derived, NOT measured: jsdom renders no native
                  tooltips, so `integrations-section.test.tsx` can only pin the
                  ATTRIBUTE's presence and absence, never the tooltip itself.
                  ★★★ The hint cannot be gated on interacting with the button:
                  a disabled element dispatches no events, so "click it and find
                  out why" is an unreachable path.
                  ★★ THE sr-only NODE IS FOR THE GATED STATE ALONE, and that is
                  what keeps each state to ONE description. The invented node is
                  only needed while the button is unfocusable; once it is
                  ENABLED the VISIBLE hint below is reachable on its own, so
                  `aria-describedby` points THERE and the sr-only node is not
                  rendered at all. Pointing at the sr-only node in both states —
                  the shape this replaced — made a confirmed user hear
                  `projectMigrateToTursoHint` twice, once from the hidden node
                  and once from the visible one. */}
              <span
                className={`inline-flex${tursoTestConfirmed ? "" : " cursor-not-allowed"}`}
                title={tursoTestConfirmed ? undefined : t(lang, "integrationsTursoMoveNeedsTest")}
              >
                <Button
                  size="sm"
                  disabled={!tursoTestConfirmed}
                  onClick={onMigrateToTurso}
                  aria-describedby={tursoTestConfirmed ? tursoMoveHintId : tursoMoveNeedsTestId}
                  className="disabled:pointer-events-none"
                >
                  {t(lang, "projectMigrateToTurso")}
                </Button>
                {!tursoTestConfirmed && (
                  <span id={tursoMoveNeedsTestId} className="sr-only">
                    {t(lang, "integrationsTursoMoveNeedsTest")}
                  </span>
                )}
              </span>
              <FieldHint id={tursoMoveHintId} className="mt-1">
                {t(lang, "projectMigrateToTursoHint")}
              </FieldHint>
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
                  onMouseDown={keepFocusOnMouseDown}
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
