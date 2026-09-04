// src/app/settings-view.tsx
"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { type Lang, type TranslationKey, t, localeFor } from "./i18n";
import { isBranchActive, type RailEntry } from "./settings-rail";
import type { Settings, NextActionsLearningConfig } from "./settings-types";
import type { StorageKind } from "./storage";
import { Card } from "./card";
import { APP_LICENSE, APP_LICENSE_URL, APP_VERSION_LABEL } from "./version";
import { VersionInfoModal } from "./version-info";
import { InfoTooltip } from "./info-tooltip";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { Button } from "./button";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { GeneralSection } from "./settings-sections/general-section";
import { TimezoneSettingsSection } from "./settings-sections/timezone-settings-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { NextActionsSection } from "./settings-sections/next-actions-section";
import { ProjectOverridesSection } from "./settings-sections/project-overrides-section";
import { type SuggestionScope } from "./next-actions-tuning";
import { AiSection } from "./settings-sections/ai-section";
import { AiGuidesSection } from "./settings-sections/ai-guides-section";
import { AiViewsSection } from "./settings-sections/ai-views-section";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { ModeSection } from "./settings-sections/mode-section";
import { TemplatesSection } from "./settings-sections/templates-section";
import { InformationFlowsSection } from "./settings-sections/information-flows-section";
import { DiagnosticsSection } from "./settings-sections/diagnostics-section";
import { DictationSection } from "./settings-sections/dictation-section";
import { ExportSection } from "./settings-sections/export-section";
import { IntegrationDisclaimerProvider } from "./integration-disclaimer";
import { StorageConfigSection } from "./storage-config";
import { CommTemplatesSection } from "./settings-sections/comm-templates-section";
import { ScheduledJobsSection } from "./settings-sections/scheduled-jobs-section";
import type { UseCommTemplatesResult } from "./use-comm-templates";
import type { TursoConfig } from "./turso-config";
import type { FeatureModuleId } from "./feature-modules";
import { BackendSetupWizard } from "./backend-setup-wizard";

interface SettingsViewProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  onCommitFeatures: (features: FeatureModuleId[]) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
  onRequestStorageSwitch: (kind: StorageKind) => void;
  /** Reload the current project's data from its backend (recovery). Omitted in popouts. */
  onReloadProject?: () => void;
  onMigrateToTurso?: () => void;
  commTemplatesEnabled?: boolean;
  commTemplates?: UseCommTemplatesResult;
  commTemplatesConfig?: TursoConfig | null;
  /** Turso config for the scheduled-jobs library (null = localStorage backend). */
  scheduledJobsConfig?: TursoConfig | null;
  operatingGuides?: import("./use-operating-guides").UseOperatingGuidesResult;
  learningConfig?: NextActionsLearningConfig;
  onChangeLearningConfig?: (c: NextActionsLearningConfig) => void;
  onResetLearning?: () => void;
  onOpenInsights?: () => void;
  /** SP-C: builds the AI weight-suggestion context for the requested scope.
   *  Omitted (e.g. in popouts) hides the "Suggest with AI" control. */
  buildWeightSuggestionContext?: (scope: SuggestionScope) => string;
  /** Deep-link target: when this changes, the view navigates to the named
   *  section. The `nonce` lets a repeated request (same section) re-navigate
   *  after the user has clicked elsewhere. */
  requestSection?: { id: SectionId; nonce: number };
  /** Called once after a `requestSection` deep-link has been applied, so the
   *  parent can clear the pending request. Without this, a request lingers in
   *  parent state and re-fires every time this view remounts (e.g. the user
   *  re-opens Settings normally), wrongly jumping to the deep-linked section. */
  onSectionConsumed?: () => void;
  /** When true (popout window) the "Run setup wizard" launch button is hidden. */
  isPopout?: boolean;
  /** Active project id — for the "Overrides" per-project overrides section
   *  (its appearance overrides are stored per-device-per-project). */
  projectId?: string;
  /** Resource directory for the Appearance "I am this resource" picker. */
  resources?: readonly import("./types").Resource[];
  /** The workspace `timelogLinks` blob + its setter, forwarded to the TimeLog
   *  guardrails section. Optional (like `onMigrateToTurso`) because the popout
   *  and pre-project surfaces have no workspace blob; omitted ⇒ no guardrails. */
  timelogLinks?: import("./timelog-types").TimelogLinks;
  onTimelogLinksChange?: (next: import("./timelog-types").TimelogLinks) => void;
}

type SectionId =
  | "mode" | "templates" | "appearance" | "localization" | "general" | "notifications"
  | "nextActions" | "ai" | "aiGuides" | "aiViews" | "jira" | "storage" | "integrations"
  | "export" | "informationFlows" | "commTemplates" | "scheduledJobs" | "diagnostics"
  | "dictation" | "projectOverrides";

// `labelKey` is narrowed to `TranslationKey` on top of the generic `string` the
// pure helper declares — that narrowing is what stops a typo'd key compiling.
const RAIL: (RailEntry<SectionId> & { labelKey: TranslationKey })[] = [
  { id: "mode", labelKey: "settingsSectionMode" },
  { id: "templates", labelKey: "settingsSectionTemplates" },
  { id: "appearance", labelKey: "settingsSectionAppearance" },
  { id: "localization", labelKey: "settingsSectionLocalization" },
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "notifications", labelKey: "settingsSectionNotifications" },
  { id: "ai", labelKey: "settingsSectionAi" },
  // Children of `ai` — rendered indented, and only while the AI branch is
  // active. Declaration order, NOT alphabetical: alpha would order these
  // differently in EN and DE for no gain.
  { id: "aiGuides", labelKey: "aiGuidesHeading", parent: "ai" },
  { id: "aiViews", labelKey: "aiViewsTitle", parent: "ai" },
  { id: "scheduledJobs", labelKey: "scheduledJobsTitle", parent: "ai" },
  { id: "storage", labelKey: "settingsSectionStorage" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
  { id: "export", labelKey: "settingsSectionExport" },
  { id: "nextActions", labelKey: "settingsSectionNextActions" },
  { id: "projectOverrides", labelKey: "settingsProjectOverrides" },
  { id: "informationFlows", labelKey: "settingsSectionInformationFlows" },
  { id: "commTemplates", labelKey: "settingsSectionCommTemplates" },
  { id: "diagnostics", labelKey: "diagnosticsTitle" },
  { id: "dictation", labelKey: "dictationEngine" },
];

// Advanced sections revealed only in expert mode.
const EXPERT_IDS: readonly SectionId[] = ["nextActions", "notifications", "templates", "mode", "export", "commTemplates"];
// Connectivity sections grouped together above Information flows (own divider).
// `scheduledJobs` is NOT here any more — it is a child of `ai` and renders
// inside that branch, not as a peer.
const INTEGRATION_IDS: readonly SectionId[] = ["ai", "integrations"];
// Storage gets its own divider group between connectivity and information flows.
const STORAGE_ID: SectionId = "storage";
const FLOWS_ID: SectionId = "informationFlows";
// Diagnostics gets its own divider group at the very bottom of the rail,
// below Information flows — the most technical/system-facing entry.
const DIAGNOSTICS_ID: SectionId = "diagnostics";

export function SettingsView(props: SettingsViewProps) {
  const { lang, settings, onChange } = props;
  // Default to an always-visible section. Appearance + Storage are now folded
  // into General, so General is the landing section.
  const [activeRaw, setActive] = useState<SectionId>("general");
  const [showVersion, setShowVersion] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Deep-link: honor an external request to jump to a specific section (e.g. the
  // Action Center's "Learning is ON/OFF" pill jumps here to nextActions). We
  // reconcile during render (React's "adjusting state when a prop changes"
  // pattern) rather than in an effect — set-state-in-effect is lint-banned. The
  // nonce makes a repeated request (same section) re-navigate.
  const requestNonce = props.requestSection?.nonce;
  const requestId = props.requestSection?.id;
  // Start "unhandled" (undefined), NOT at the current nonce — this view unmounts
  // and remounts each time Settings is opened, so initialising to the live nonce
  // made a freshly-mounted view treat the pending request as already handled and
  // never navigate (the deep-link silently no-op'd). Reconcile during render
  // (set-state-in-effect is lint-banned).
  const [handledNonce, setHandledNonce] = useState<number | undefined>(undefined);
  if (requestNonce !== undefined && requestNonce !== handledNonce) {
    setHandledNonce(requestNonce);
    if (requestId) setActive(requestId);
  }
  // Tell the parent the request was consumed so it clears the pending state and
  // a later normal re-open does not re-jump. Calls a prop (not local setState),
  // so the set-state-in-effect rule does not apply.
  const consumedNonceRef = useRef<number | undefined>(undefined);
  const { onSectionConsumed } = props;
  useEffect(() => {
    if (requestNonce !== undefined && consumedNonceRef.current !== requestNonce) {
      consumedNonceRef.current = requestNonce;
      onSectionConsumed?.();
    }
  }, [requestNonce, onSectionConsumed]);

  const expert = settings.expertMode === true;
  // Comm templates is expert-gated AND requires the Turso-backed feature gate.
  const commTemplatesVisible =
    props.commTemplatesEnabled === true && expert && !!RAIL.find((r) => r.id === "templates");
  // Appearance + Storage are folded into General; Comm Templates can lose its
  // rail entry when its feature gate (or expert mode) flips off; Next-actions is
  // expert-only and loses its rail entry when expert mode is off. Coerce any
  // stale/now-hidden selection back to General so the pane never goes blank (no
  // ghost section with a body but no matching rail item).
  const active: SectionId =
    activeRaw === "storage" ||
    (activeRaw === "nextActions" && !expert) ||
    (activeRaw === "projectOverrides" && props.isPopout) ||
    (activeRaw === "commTemplates" && !commTemplatesVisible)
      ? "general"
      // Jira folded into Integrations — a stale/deep-linked "jira" lands there.
      : activeRaw === "jira"
        ? "integrations"
        : activeRaw;
  const byLabel = (a: { labelKey: TranslationKey }, b: { labelKey: TranslationKey }) =>
    t(lang, a.labelKey).localeCompare(t(lang, b.labelKey), localeFor(lang));

  // Main group: everything except storage (folded into General), integrations,
  // comm-templates, and flows, with expert-only sections shown only in expert
  // mode. Appearance is its own rail entry. Alphabetical by label.
  const mainEntriesSorted = RAIL.filter(
    (r) =>
      // Children never appear in a group filter — the parent's render path
      // owns them. The main group is defined by EXCLUSION, so omitting this
      // renders each child twice: once here, once under its parent.
      !r.parent &&
      r.id !== FLOWS_ID &&
      r.id !== STORAGE_ID &&
      r.id !== DIAGNOSTICS_ID &&
      r.id !== "commTemplates" &&
      !INTEGRATION_IDS.includes(r.id) &&
      !(r.id === "projectOverrides" && props.isPopout) &&
      (expert || !EXPERT_IDS.includes(r.id)),
  ).sort(byLabel);
  // When shown, Comm Templates sits directly below Templates (not in alpha order).
  const mainEntries = (() => {
    if (!commTemplatesVisible) return mainEntriesSorted;
    const commEntry = RAIL.find((r) => r.id === "commTemplates");
    const templatesIdx = mainEntriesSorted.findIndex((r) => r.id === "templates");
    if (!commEntry || templatesIdx < 0) return mainEntriesSorted;
    const next = [...mainEntriesSorted];
    next.splice(templatesIdx + 1, 0, commEntry);
    return next;
  })();
  const integrationEntries = RAIL.filter(
    (r) => !r.parent && INTEGRATION_IDS.includes(r.id),
  ).sort(byLabel);
  const flowsEntry = RAIL.find((r) => r.id === FLOWS_ID);
  const diagnosticsEntry = RAIL.find((r) => r.id === DIAGNOSTICS_ID);

  const toggleExpert = (next: boolean) => {
    onChange({ ...settings, expertMode: next });
    // Leaving expert mode while parked on an expert-only section would blank the
    // panel — fall back to an always-visible section.
    if (!next && EXPERT_IDS.includes(active)) setActive("general");
  };

  // ★ Never pass this straight to `.map` — `.map` supplies the INDEX as the
  //   second argument, which would land in `isChild` and indent every entry
  //   except the first. Call sites wrap it in an arrow.
  const renderRailButton = (
    { id, labelKey }: { id: SectionId; labelKey: TranslationKey },
    isChild = false,
  ) => {
    const isActive = active === id;
    const children = RAIL.filter((r) => r.parent === id);
    const branchOpen = children.length > 0 && isBranchActive(active, id, RAIL);
    return (
      <Fragment key={id}>
        <button
          type="button"
          // `aria-current` stays on whichever entry is genuinely active, parent
          // or child. There is deliberately NO `aria-expanded`: the branch is
          // opened by NAVIGATING to the parent, never collapsed by clicking it
          // again, so advertising a disclosure the button cannot perform was a
          // lie to AT. The children's grouping is carried by the `role="group"`
          // wrapper below instead.
          aria-current={isActive ? "page" : undefined}
          onClick={() => setActive(id)}
          className={`${
            isActive
              ? "rounded-md bg-ui-dark-blue px-3 py-2 text-left text-sm font-medium text-white"
              : "rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
          } ${isChild ? "pl-6" : ""} ${INTERACTIVE}`}
        >
          {t(lang, labelKey)}
        </button>
        {branchOpen && (
          // A REAL element, not a Fragment: without it the children are flat
          // siblings of every other rail button and `pl-6` is the only
          // hierarchy cue — invisible to a screen reader. The group is named
          // after the parent so AT announces which branch these belong to.
          // ★ It is a real flex box rather than `display: contents` — a
          //   contents box is dropped from the layout tree, and its exposure to
          //   the a11y tree has been browser-version-dependent. `flex-col
          //   gap-1` reproduces the nav's own column spacing exactly.
          // ★★ `max-md:` is LOAD-BEARING. Above the breakpoint the nav is
          //   `md:flex-col`, where `flex-basis` resolves against the MAIN axis —
          //   height — so a bare `basis-full` would set this group to 100% of the
          //   nav's height and break the desktop rail, which is correct today.
          //   Below `md` the nav is `flex-row flex-wrap` and the group is one
          //   flex ITEM, so without a full-width basis the active parent pill
          //   stretches to the group's height (measured 116px at 760px wide) and
          //   unrelated top-level entries share a visual row with a child.
          <div role="group" aria-label={t(lang, labelKey)} className="flex flex-col gap-1 max-md:basis-full">
            {children.map((c) => renderRailButton(c, true))}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <IntegrationDisclaimerProvider
      lang={lang}
      seen={settings.integrationDisclaimerSeen === true}
      onAcknowledge={() => onChange({ ...settings, integrationDisclaimerSeen: true })}
      isPopout={props.isPopout}
    >
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:flex-row">
      <nav
        aria-label={t(lang, "settings")}
        className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col"
      >
        <label className="mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={expert}
            aria-label={t(lang, "settingsExpertMode")}
            onChange={(e) => toggleExpert(e.target.checked)}
            className={`h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
          />
          <span className="inline-flex items-center gap-1">
            {t(lang, "settingsExpertMode")}
            <InfoTooltip text={t(lang, "settingsExpertModeHint")} />
          </span>
        </label>
        {mainEntries.map((r) => renderRailButton(r))}
        {integrationEntries.length > 0 && (
          <>
            <hr className="my-1 border-line" />
            {integrationEntries.map((r) => renderRailButton(r))}
          </>
        )}
        {flowsEntry && (
          <>
            <hr className="my-1 border-line" />
            {renderRailButton(flowsEntry)}
          </>
        )}
        {diagnosticsEntry && (
          <>
            <hr className="my-1 border-line" />
            {renderRailButton(diagnosticsEntry)}
          </>
        )}
      </nav>

      <Card as="section" className="min-w-0 flex-1 p-6">
        {/* Uniform section heading (the rail label) for every window. Mode,
            Templates and Comm-templates are excluded — they already render their
            own identical heading + an intro line. */}
        {active !== "mode" && active !== "templates" && active !== "commTemplates" && (
          <h2 className="mb-4 text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, RAIL.find((r) => r.id === active)?.labelKey ?? "settingsSectionGeneral")}
          </h2>
        )}
        {active === "mode" && (
          <ModeSection
            // Remount when the active project's functions change so the draft
            // re-seeds from the new set — prevents a stale draft (and thus
            // saving the old project's functions) after a project switch.
            key={(settings.features ?? []).join("|")}
            lang={lang}
            settings={settings}
            onCommitFeatures={props.onCommitFeatures}
            onChange={onChange}
          />
        )}
        {active === "templates" && <TemplatesSection lang={lang} />}
        {active === "localization" && (
          <LocalizationSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "appearance" && (
          <AppearanceSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "projectOverrides" && (
          <ProjectOverridesSection lang={lang} settings={settings} projectId={props.projectId ?? "default"} />
        )}
        {active === "general" && (
          <>
            <GeneralSection
              lang={lang}
              settings={settings}
              onChange={onChange}
              resources={props.resources}
            />
            <hr className="my-6 border-line" />
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t(lang, "tzSettingsTitle")}
            </h3>
            <TimezoneSettingsSection lang={lang} settings={settings} onChange={onChange} />
            <hr className="my-6 border-line" />
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {t(lang, "settingsSectionStorage")}
            </h3>
            <StorageConfigSection
              lang={lang}
              config={settings.storageConfig}
              onChange={(storageConfig) => onChange({ ...settings, storageConfig })}
              onRequestSwitch={props.onRequestStorageSwitch}
              description={props.storageDescription}
              ready={props.storageReady}
              onPickFile={props.onPickStorageFile}
              onOpenFile={props.onOpenStorageFile}
              onGrantWrite={props.onGrantStorageWrite}
              onReloadProject={props.onReloadProject}
              m365Enabled={settings.integrations?.m365?.enabled ?? false}
              sharepointEnabled={settings.integrations?.m365?.sharepoint ?? false}
              tursoEnabled={settings.integrations?.turso?.enabled ?? false}
            />
          </>
        )}
        {active === "notifications" && (
          <NotificationsSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "nextActions" && (
          <NextActionsSection
            lang={lang}
            settings={settings}
            onChange={onChange}
            learningConfig={props.learningConfig}
            onChangeLearningConfig={props.onChangeLearningConfig}
            onResetLearning={props.onResetLearning}
            onOpenInsights={props.onOpenInsights}
            buildWeightSuggestionContext={props.buildWeightSuggestionContext}
          />
        )}
        {active === "ai" && (
          <AiSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "aiGuides" && (
          <AiGuidesSection
            lang={lang}
            settings={settings}
            onChange={onChange}
            operatingGuides={props.operatingGuides}
          />
        )}
        {active === "aiViews" && <AiViewsSection lang={lang} settings={settings} />}
        {active === "scheduledJobs" && (
          <ScheduledJobsSection
            lang={lang}
            settings={settings}
            onChange={onChange}
            config={props.scheduledJobsConfig ?? null}
          />
        )}
        {active === "integrations" && (
          <div>
            {!props.isPopout && (
              <div className="mb-4">
                <Button variant="secondary" onClick={() => setWizardOpen(true)}>
                  {t(lang, "setupWizardRun")}
                </Button>
              </div>
            )}
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChange}
              onMigrateToTurso={props.onMigrateToTurso}
              timelogLinks={props.timelogLinks}
              onTimelogLinksChange={props.onTimelogLinksChange}
            />
          </div>
        )}
        {active === "export" && (
          <ExportSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "commTemplates" && props.commTemplates && (
          <CommTemplatesSection
            lang={lang}
            templates={props.commTemplates.templates}
            onCreate={props.commTemplates.create}
            onRename={props.commTemplates.rename}
            onSaveBody={props.commTemplates.saveBody}
            onRemove={props.commTemplates.remove}
            onSetDefault={props.commTemplates.setDefault}
            config={props.commTemplatesConfig ?? null}
            settings={settings}
            onChange={onChange}
          />
        )}
        {active === "informationFlows" && (
          <InformationFlowsSection lang={lang} />
        )}
        {active === "diagnostics" && <DiagnosticsSection lang={lang} />}
        {active === "dictation" && (
          <DictationSection lang={lang} settings={settings} onChange={onChange} />
        )}
      </Card>
    </div>

    <footer className="mx-auto mt-6 flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line pt-4 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setShowVersion(true)}
        title={t(lang, "versionHistory")}
        className="font-medium text-ui-dark-blue underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-ui-blue"
      >
        {t(lang, "versionVersion")} {APP_VERSION_LABEL}
      </button>
      <span aria-hidden>·</span>
      <a
        href={APP_LICENSE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-ui-dark-blue underline-offset-2 hover:underline dark:text-ui-blue"
      >
        {t(lang, "versionLicense")}: {APP_LICENSE} ↗
      </a>
    </footer>

    {wizardOpen && (
      <BackendSetupWizard
        lang={lang}
        open
        settings={settings}
        onChangeSettings={onChange}
        onClose={() => setWizardOpen(false)}
        onMigrateToTurso={props.onMigrateToTurso}
        hidePortfolioSwitch
      />
    )}
    <VersionInfoModal lang={lang} open={showVersion} onClose={() => setShowVersion(false)} />
    </IntegrationDisclaimerProvider>
  );
}
