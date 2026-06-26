"use client";

// Three-step project-creation wizard, the create entry point at both the
// portfolio panel and the empty-state modal.
//
//   Step 1 — Details:   reuses CreateProjectForm (the shared ProjectForm field
//                        group + file-format selector). Its onCreate is
//                        repurposed to CAPTURE (meta, format) and advance, not
//                        to create.
//   Step 2 — Template:  pick a built-in/user template or "Blank". Selecting a
//                        template seeds the Step-3 feature set from its
//                        `features` (Blank → every module).
//   Step 3 — Functions: the mode presets + per-module checkboxes (the same UI
//                        shape as settings' ModeSection) plus an optional
//                        "include starter content" toggle (only when the chosen
//                        template carries seed content).
//
// The assembled opts ({ template?, features, includeSeed }) are handed to the
// host's onCreate, which threads them to buildNewProjectWorkspace.

import { useMemo, useRef, useState } from "react";
import { type Contact } from "./contacts";
import { CreateProjectForm } from "./create-project-form";
import { suggestTemplate } from "./template-suggest";
import {
  ALL_MODULE_IDS,
  FEATURE_MODULES,
  type FeatureModuleId,
  deriveMode,
} from "./feature-modules";
import { t, type Lang } from "./i18n";
import { type NewProjectOpts } from "./new-project-workspace";
import { type Settings } from "./settings-types";
import { type ProjectTemplate } from "./templates";
import { type ProjectMeta, type Resource } from "./types";
import { useTemplates } from "./use-templates";
import { useProjectProposal, type ProposalContent } from "./use-project-proposal";
import { proposalToDraftPatch, proposalToSeed, seedHasContent } from "./ai-project-proposal";
import { Step0ImportPanel } from "./step0-import-panel";
import type { ProjectFormDraft } from "./project-form-fields";
import type { TemplateSeed } from "./templates";
import { BackendSetupWizard } from "./backend-setup-wizard";
import { INTERACTIVE } from "./interaction-styles";
import { WizardStepIndicator } from "./wizard-step-indicator";

type CreateFormat = "json" | "csv" | "md";

const MODE_LABEL_KEY = {
  simple: "modeSimple",
  modular: "modeModular",
  advanced: "modeAdvanced",
} as const;

const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted";

export interface CreateProjectWizardProps {
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  resources: readonly Resource[];
  /** Current settings (for the backend-config modal opened from the selector). */
  settings: Settings;
  /** Persist edited settings (IntegrationsSection emits a full next value). */
  onChangeSettings: (s: Settings) => void;
  /** Extended over CreateProjectForm: also carries the assembled NewProjectOpts. */
  onCreate: (
    meta: ProjectMeta,
    format: CreateFormat,
    opts: NewProjectOpts,
  ) => void;
  onCancel?: () => void;
  /** Turso mode: hide the file-format selector (the Turso path fixes "json"). */
  hideFormat?: boolean;
}

type Step = 0 | 1 | 2 | 3;

/** True when a template carries any seed content worth offering to stamp. */
function hasSeedContent(tpl: ProjectTemplate | null): boolean {
  if (!tpl?.seed) return false;
  return Object.values(tpl.seed).some((v) => Array.isArray(v) && v.length > 0);
}

// Steps 1-3 of the create wizard (step 0 is the optional AI "Describe" panel and
// is excluded from the rail). Rendered via the shared WizardStepIndicator.
const CREATE_WIZARD_STEPS = [
  { titleKey: "wizardStepDetails" },
  { titleKey: "wizardStepTemplate" },
  { titleKey: "wizardStepFunctions" },
] as const;

export function CreateProjectWizard({
  lang,
  stakeholderNames,
  addressBook,
  resources,
  settings,
  onChangeSettings,
  onCreate,
  onCancel,
  hideFormat = false,
}: CreateProjectWizardProps) {
  const { templates } = useTemplates();

  const aiKey = settings.ai?.apiKey?.trim() ?? "";
  const aiEnabled = aiKey.length > 0;
  const { generate, busy: aiBusy, error: aiError, reset: resetAi } = useProjectProposal({
    apiKey: aiKey,
    model: settings.ai?.model ?? "claude-sonnet-4-6",
  });
  const [step, setStep] = useState<Step>(aiEnabled ? 0 : 1);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draftPatch, setDraftPatch] = useState<Partial<ProjectFormDraft> | undefined>(undefined);
  const [aiSeed, setAiSeed] = useState<TemplateSeed | undefined>(undefined);
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [format, setFormat] = useState<CreateFormat>("json");
  const [storage, setStorage] = useState<"file" | "turso">("file");
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [features, setFeatures] = useState<FeatureModuleId[]>([...ALL_MODULE_IDS]);
  const [includeSeed, setIncludeSeed] = useState(false);

  // Suggestion derived from the captured Step-1 meta. Drives the badge + reason
  // line and is preselected ONCE when Step 1 is submitted (see handleDetails),
  // unless the user has already touched the list.
  const userTouchedTemplateRef = useRef(false);
  const suggestion = useMemo(
    () => (meta ? suggestTemplate(meta, templates) : null),
    [meta, templates],
  );

  // Apply a template's effects WITHOUT marking the list as user-touched (used by
  // the preselect path). `chooseTemplate` wraps this to flag a real user pick.
  const applyTemplateChoice = (tpl: ProjectTemplate | null) => {
    setSelectedTemplate(tpl);
    setFeatures(tpl ? ALL_MODULE_IDS.filter((id) => tpl.features.includes(id)) : [...ALL_MODULE_IDS]);
    setIncludeSeed(hasSeedContent(tpl));
  };

  // Step 1 → capture details and advance (does NOT create yet). On this single
  // transition into Step 2, preselect the suggested template — but only while
  // the user has not touched the list, so a manual pick (incl. Blank) made on a
  // prior visit is never overwritten. Computed from the fresh meta `m` so it
  // does not lag the memoized `suggestion` by a render.
  // Shared post-proposal pre-fill: every Step-0 source (Describe, file,
  // SharePoint, Confluence) funnels its content through this. The model output
  // populates the Step-1 form draft + feature set + starter seed and advances.
  const runIngest = async (content: ProposalContent) => {
    const p = await generate(content);
    if (!p) return; // error surfaced via aiError
    const today = new Date().toISOString().slice(0, 10); // callback context — lint-safe
    // Clear any meta captured from a prior manual Step-1 visit so the fresh AI
    // draftPatch wins on the next Step-1 mount (initialMeta would otherwise shadow it).
    setMeta(null);
    setDraftPatch(proposalToDraftPatch(p));
    setFeatures(p.features.length ? p.features : [...ALL_MODULE_IDS]);
    const seed = proposalToSeed(p, today);
    setAiSeed(seed);
    setIncludeSeed(seedHasContent(seed));
    setStep(1);
  };

  const handleDetails = (
    m: ProjectMeta,
    fmt: CreateFormat,
    sto: "file" | "turso",
  ) => {
    setMeta(m);
    setFormat(fmt);
    setStorage(sto);
    if (!userTouchedTemplateRef.current) {
      const { templateId } = suggestTemplate(m, templates);
      const tpl = templates.find((tp) => tp.id === templateId) ?? null;
      if (tpl) applyTemplateChoice(tpl);
    }
    setStep(2);
  };

  const chooseTemplate = (tpl: ProjectTemplate | null) => {
    userTouchedTemplateRef.current = true;
    applyTemplateChoice(tpl);
  };

  const toggleModule = (id: FeatureModuleId) =>
    setFeatures((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const handleCreate = () => {
    if (!meta) return;
    onCreate(meta, format, {
      template: selectedTemplate ?? undefined,
      features,
      includeSeed,
      aiSeed: selectedTemplate === null ? aiSeed : undefined,
      storage,
    });
  };

  const mode = deriveMode(features);
  const aiSeedActive = selectedTemplate === null && seedHasContent(aiSeed);
  const offerSeed = hasSeedContent(selectedTemplate) || aiSeedActive;

  // Step-1 footer left slot: a Back-to-Describe button (only on the AI fast-path,
  // before details are captured). Without it, an AI user who lands on Step 1 has
  // no way back to re-describe — only Cancel.
  const step1FooterLeft =
    aiEnabled && !meta ? (
      <button type="button" onClick={() => setStep(0)} className={SECONDARY_BUTTON_CLASS}>
        {t(lang, "wizardBack")}
      </button>
    ) : undefined;

  return (
    <div className="flex min-h-0 flex-col">
      {/* Fixed header: step indicator (the modal panel owns resize/reset). */}
      <div className="flex shrink-0 items-start justify-between gap-3 pb-4">
        {step >= 1 ? (
          <WizardStepIndicator lang={lang} current={step - 1} steps={CREATE_WIZARD_STEPS} />
        ) : (
          <h2 className="text-base font-semibold text-foreground">{t(lang, "aiCreateHeading")}</h2>
        )}
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className={`shrink-0 rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "setupWizardRun")}
        </button>
      </div>

      {/* Step 0 — Describe / import (AI fast-path; only when an API key is set).
          The panel owns its own pinned footer (Skip / Cancel / Generate). */}
      {step === 0 && (
        <Step0ImportPanel
          lang={lang}
          settings={settings}
          aiBusy={aiBusy}
          aiError={aiError}
          onIngest={runIngest}
          onResetAi={resetAi}
          onSkip={() => setStep(1)}
          onCancel={onCancel}
        />
      )}

      {/* Body — the modal panel scrolls, so this just stacks. */}
      {step >= 1 && (
      <div className="min-h-0 flex-1">

        {/* Step 1 — Details: reuse the shared create form (its submit advances). */}
        {step === 1 && (
          <CreateProjectForm
            lang={lang}
            stakeholderNames={stakeholderNames}
            addressBook={addressBook}
            resources={resources}
            settings={settings}
            onChangeSettings={onChangeSettings}
            onCreate={handleDetails}
            onCancel={onCancel}
            hideFormat={hideFormat}
            footerLeft={step1FooterLeft}
            submitLabel={t(lang, "wizardNext")}
            initialMeta={meta ?? undefined}
            initialDraftPatch={meta ? undefined : draftPatch}
            initialFormat={format}
          />
        )}

        {/* Step 2 — Template. */}
        {step === 2 && (
          <div className="flex flex-col gap-4 pb-2">
            {suggestion && (
              <p className="mb-2 text-xs text-muted-foreground">
                {t(lang, "suggestBasedOn")}{" "}
                {suggestion.reasons
                  .map((r) => t(lang, r.key, ...(r.args ?? [])))
                  .join(" · ")}
                {" → "}
                {t(lang, MODE_LABEL_KEY[suggestion.tier])}
              </p>
            )}
            <fieldset className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => chooseTemplate(null)}
                aria-pressed={selectedTemplate === null}
                className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-surface-muted ${
                  selectedTemplate === null
                    ? "border-AIPM-green bg-AIPM-green/10"
                    : "border-line bg-surface"
                }`}
              >
                <span className="font-medium text-foreground">
                  {t(lang, "wizardBlankTemplate")}
                </span>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(lang, "wizardIncludeContent")}: {t(lang, "none")}
                </p>
              </button>

              {templates.map((tpl) => {
                const selected = selectedTemplate?.id === tpl.id;
                const tplMode = deriveMode(tpl.features);
                const seedCount = tpl.seed
                  ? Object.values(tpl.seed).reduce(
                      (sum, v) => sum + (Array.isArray(v) ? v.length : 0),
                      0,
                    )
                  : 0;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => chooseTemplate(tpl)}
                    aria-pressed={selected}
                    className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-surface-muted ${
                      selected ? "border-AIPM-green bg-AIPM-green/10" : "border-line bg-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{tpl.name}</span>
                      <span className="flex items-center gap-1">
                        {suggestion?.templateId === tpl.id && (
                          <span className="rounded-full bg-AIPM-dark-blue px-2 py-0.5 text-xs font-semibold text-white">
                            {t(lang, "templateSuggested")}
                          </span>
                        )}
                        <span className="rounded-full bg-AIPM-green/15 px-2 py-0.5 text-xs font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                          {t(lang, MODE_LABEL_KEY[tplMode])}
                        </span>
                      </span>
                    </div>
                    {tpl.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{tpl.description}</p>
                    )}
                    {seedCount > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(lang, "wizardIncludeContent")}: {seedCount}
                      </p>
                    )}
                  </button>
                );
              })}
            </fieldset>
            {seedHasContent(aiSeed) && selectedTemplate !== null && (
              <p role="status" className="text-xs text-AIPM-red">
                {t(lang, "aiCreateTemplateReplacesSeed")}
              </p>
            )}
          </div>
        )}

        {/* Step 3 — Functions. */}
        {step === 3 && (
          <div className="flex flex-col gap-5 pb-2">
            <p className="text-sm text-muted-foreground">{t(lang, "wizardFunctionsIntro")}</p>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t(lang, "modeBadgeLabel")}:</span>
              <span className="rounded-full bg-AIPM-green/15 px-3 py-1 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
                {t(lang, MODE_LABEL_KEY[mode])}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label="Apply Simple preset"
                onClick={() => setFeatures([])}
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                {t(lang, "modePresetSimple")}
              </button>
              <button
                type="button"
                aria-label="Apply Advanced preset"
                onClick={() => setFeatures([...ALL_MODULE_IDS])}
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                {t(lang, "modePresetAdvanced")}
              </button>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-foreground">
                {t(lang, "modeModulesHeading")}
              </legend>
              {FEATURE_MODULES.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={features.includes(m.id)}
                    onChange={() => toggleModule(m.id)}
                    className="h-4 w-4 accent-AIPM-green"
                  />
                  <span>{t(lang, m.labelKey)}</span>
                </label>
              ))}
            </fieldset>

            {offerSeed && (
              <label className="flex items-center gap-2 border-t border-line pt-4 text-sm">
                <input
                  type="checkbox"
                  checked={includeSeed}
                  onChange={(e) => setIncludeSeed(e.target.checked)}
                  className="h-4 w-4 accent-AIPM-green"
                />
                <span>{t(lang, aiSeedActive ? "aiCreateIncludeContent" : "wizardIncludeContent")}</span>
              </label>
            )}
          </div>
        )}

      </div>
      )}

      {/* Pinned footer: navigation buttons for steps 2 and 3 (step 0 owns its own). */}
      {step === 2 && (
        <div className="flex shrink-0 justify-between gap-2 border-t border-line pt-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className={SECONDARY_BUTTON_CLASS}>
              {t(lang, "wizardBack")}
            </button>
          </div>
          <div className="flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
                {t(lang, "cancel")}
              </button>
            )}
            <button type="button" onClick={() => setStep(3)} className={PRIMARY_BUTTON_CLASS}>
              {t(lang, "wizardNext")}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex shrink-0 justify-between gap-2 border-t border-line pt-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className={SECONDARY_BUTTON_CLASS}>
              {t(lang, "wizardBack")}
            </button>
          </div>
          <div className="flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
                {t(lang, "cancel")}
              </button>
            )}
            <button type="button" onClick={handleCreate} className={PRIMARY_BUTTON_CLASS}>
              {t(lang, "wizardCreate")}
            </button>
          </div>
        </div>
      )}
      {wizardOpen && (
        <BackendSetupWizard
          lang={lang}
          open
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
