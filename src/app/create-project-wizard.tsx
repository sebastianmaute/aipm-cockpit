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
import {
  classifyAttachment,
  checkAttachmentSize,
  buildAttachmentBlock,
  type AttachmentKind,
} from "./chat-attachments";
import { isSharePointEnabled, fetchSharePointFileContent } from "./m365-sharepoint";
import { fetchConfluencePage } from "./confluence-api";
import { SharePointPickerModal } from "./sharepoint-picker-modal";
import { useMsAuth } from "./use-ms-auth";
import type { DocumentLink } from "./document-link";
import type { ProjectFormDraft } from "./project-form-fields";
import type { TemplateSeed } from "./templates";

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

/** Step-0 source picker: describe (default), file upload, SharePoint, Confluence. */
type ImportMethod = "describe" | "file" | "sharepoint" | "confluence";

/** True when a template carries any seed content worth offering to stamp. */
function hasSeedContent(tpl: ProjectTemplate | null): boolean {
  if (!tpl?.seed) return false;
  return Object.values(tpl.seed).some((v) => Array.isArray(v) && v.length > 0);
}

/** Fallback MIME when a picked file/blob reports an empty content type. */
function mimeForKind(kind: AttachmentKind): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") return "image/png";
  return "text/plain";
}

/** Read a File into the shape buildAttachmentBlock expects: base64 (no data:
 *  prefix) for pdf/image, decoded UTF-8 string for text. */
function readFileData(file: File, kind: AttachmentKind): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    if (kind === "text") {
      reader.onload = () => {
        if (typeof reader.result !== "string") return reject(new Error("read"));
        resolve(reader.result);
      };
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        if (typeof reader.result !== "string") return reject(new Error("read"));
        resolve(reader.result.split(",")[1] ?? "");
      };
      reader.readAsDataURL(file);
    }
  });
}

/** Base64-encode an ArrayBuffer in chunks (avoids String.fromCharCode call-stack
 *  limits on large buffers). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function StepIndicator({ lang, step }: { lang: Lang; step: 1 | 2 | 3 }) {
  const labels: { n: Step; key: "wizardStepDetails" | "wizardStepTemplate" | "wizardStepFunctions" }[] = [
    { n: 1, key: "wizardStepDetails" },
    { n: 2, key: "wizardStepTemplate" },
    { n: 3, key: "wizardStepFunctions" },
  ];
  return (
    <ol className="mb-5 flex items-center gap-2 text-sm" aria-label={t(lang, "wizardStepsLabel")}>
      {labels.map(({ n, key }, i) => (
        <li key={n} className="flex items-center gap-2">
          <span
            aria-current={step === n ? "step" : undefined}
            className={
              step === n
                ? "rounded-full bg-AIPM-green/15 px-3 py-1 font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
                : "px-3 py-1 text-muted-foreground"
            }
          >
            {n}. {t(lang, key)}
          </span>
          {i < labels.length - 1 && <span aria-hidden className="text-muted-foreground">›</span>}
        </li>
      ))}
    </ol>
  );
}

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
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<ImportMethod>("describe");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [spPickerOpen, setSpPickerOpen] = useState(false);
  // True while a SOURCE step (file read / SP fetch / Confluence fetch) is in
  // flight — gives read-phase feedback and blocks a second concurrent ingest.
  const [reading, setReading] = useState(false);

  // SharePoint import reuses the M365 delegated session, gated on the integration.
  const spEnabled = isSharePointEnabled(settings.integrations);
  const { acquireToken } = useMsAuth(spEnabled);

  const jira = settings.jira;
  const confluenceReady = !!(jira?.enabled && jira?.siteUrl && jira?.apiToken && jira?.email);
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

  const handleGenerate = () => runIngest(description);

  // File upload → classify, size-gate, read bytes (SOURCE step in try/catch),
  // then ingest OUTSIDE the catch so a generate failure surfaces via aiError,
  // not the generic source-import error. Never logs the bytes.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (checkAttachmentSize(file.size)) {
      setImportError(t(lang, "wizardImportErrorTooLarge"));
      return;
    }
    const kind = classifyAttachment(file.type, file.name);
    if (!kind) {
      setImportError(t(lang, "wizardImportErrorUnsupported"));
      return;
    }
    setImportError(null);
    let content: ProposalContent;
    setReading(true);
    try {
      const data = await readFileData(file, kind);
      const block = buildAttachmentBlock(kind, file.type || mimeForKind(kind), data);
      content = [{ type: "text", text: t(lang, "wizardImportFilePrompt") }, block];
    } catch {
      setImportError(t(lang, "wizardImportErrorSource"));
      return;
    } finally {
      setReading(false);
    }
    await runIngest(content);
  };

  // SharePoint picker yielded a file link → fetch its bytes via Graph + classify
  // (SOURCE step in try/catch), then ingest OUTSIDE the catch. Errors surface a
  // sanitized message only.
  const onSharePointPick = async (link: DocumentLink) => {
    setSpPickerOpen(false);
    setImportError(null);
    let content: ProposalContent;
    setReading(true);
    try {
      const { name, mime, bytes } = await fetchSharePointFileContent(
        link.url,
        link.name,
        acquireToken,
      );
      if (checkAttachmentSize(bytes.byteLength)) {
        setImportError(t(lang, "wizardImportErrorTooLarge"));
        return;
      }
      const kind = classifyAttachment(mime, name);
      if (!kind) {
        setImportError(t(lang, "wizardImportErrorUnsupported"));
        return;
      }
      const data = kind === "text" ? new TextDecoder().decode(bytes) : arrayBufferToBase64(bytes);
      content = [
        { type: "text", text: t(lang, "wizardImportFilePrompt") },
        buildAttachmentBlock(kind, mime, data),
      ];
    } catch {
      setImportError(t(lang, "wizardImportErrorSource"));
      return;
    } finally {
      setReading(false);
    }
    await runIngest(content);
  };

  // Confluence URL → fetch capped page text via the same-origin proxy (SOURCE
  // step in try/catch), then ingest OUTSIDE the catch. Never logs the token or
  // body.
  const onConfluenceFetch = async () => {
    if (!jira) return;
    setImportError(null);
    let content: ProposalContent;
    setReading(true);
    try {
      const { title, text } = await fetchConfluencePage(confluenceUrl, {
        siteUrl: jira.siteUrl,
        email: jira.email,
        apiToken: jira.apiToken,
      });
      content = `${t(lang, "wizardImportConfluencePrompt")}\n\n${title}\n\n${text}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setImportError(
        msg === "page-id"
          ? t(lang, "wizardImportErrorConfluenceUrl")
          : t(lang, "wizardImportErrorSource"),
      );
      return;
    } finally {
      setReading(false);
    }
    // Clear the URL so a later Back + re-open does not pre-fill/re-fetch a stale
    // page once the fetch has succeeded.
    setConfluenceUrl("");
    await runIngest(content);
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
      <div className="flex shrink-0 items-start pb-4">
        {step >= 1 ? (
          <StepIndicator lang={lang} step={step as 1 | 2 | 3} />
        ) : (
          <h2 className="text-base font-semibold text-foreground">{t(lang, "aiCreateHeading")}</h2>
        )}
      </div>

      {/* Body — the modal panel scrolls, so this just stacks. */}
      <div className="min-h-0 flex-1">

        {/* Step 0 — Describe / import (AI fast-path; only when an API key is set). */}
        {step === 0 && (
          <div className="flex flex-col gap-4 pb-2">
            {/* Source method picker. */}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "describe", key: "wizardImportMethodDescribe", show: true },
                  { id: "file", key: "wizardImportMethodFile", show: true },
                  { id: "sharepoint", key: "wizardImportMethodSharePoint", show: spEnabled },
                  { id: "confluence", key: "wizardImportMethodConfluence", show: confluenceReady },
                ] as const
              )
                .filter((m) => m.show)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={method === m.id}
                    onClick={() => {
                      setMethod(m.id);
                      setImportError(null);
                      resetAi();
                    }}
                    className={`rounded-md border px-3 py-1.5 text-sm hover:bg-surface-muted ${
                      method === m.id
                        ? "border-AIPM-green bg-AIPM-green/10 font-medium text-foreground"
                        : "border-line bg-surface text-muted-foreground"
                    }`}
                  >
                    {t(lang, m.key)}
                  </button>
                ))}
            </div>

            {method === "describe" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">{t(lang, "aiCreateDescribeLabel")}</span>
                <textarea
                  aria-label={t(lang, "aiCreateDescribeLabel")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder={t(lang, "aiCreateDescribePlaceholder")}
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
                />
              </label>
            )}

            {method === "file" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-foreground">{t(lang, "wizardImportFileLabel")}</span>
                <input
                  type="file"
                  aria-label={t(lang, "wizardImportFileLabel")}
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv"
                  disabled={reading || aiBusy}
                  onChange={onFile}
                  className="text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-surface-muted disabled:opacity-50"
                />
              </label>
            )}

            {method === "sharepoint" && (
              <div className="flex flex-col gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setSpPickerOpen(true)}
                  disabled={reading || aiBusy}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  {t(lang, "wizardImportSharePointBrowse")}
                </button>
              </div>
            )}

            {method === "confluence" && (
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-foreground">{t(lang, "wizardImportConfluenceUrl")}</span>
                  <input
                    type="url"
                    aria-label={t(lang, "wizardImportConfluenceUrl")}
                    value={confluenceUrl}
                    onChange={(e) => setConfluenceUrl(e.target.value)}
                    placeholder="https://acme.atlassian.net/wiki/spaces/…"
                    className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
                  />
                </label>
                <div>
                  <button
                    type="button"
                    onClick={onConfluenceFetch}
                    disabled={reading || aiBusy || !confluenceUrl.trim()}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {reading || aiBusy ? t(lang, "aiCreateBusy") : t(lang, "wizardImportFetch")}
                  </button>
                </div>
              </div>
            )}

            {(aiError || importError) && (
              <p role="alert" className="text-sm text-AIPM-red">
                {importError ?? t(lang, aiError === "no-key" ? "aiCreateNeedsKey" : "aiCreateError")}
              </p>
            )}

            {spPickerOpen && (
              <SharePointPickerModal
                mode="link"
                lang={lang}
                acquireToken={acquireToken}
                onSelect={onSharePointPick}
                onClose={() => setSpPickerOpen(false)}
              />
            )}
          </div>
        )}

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

      {/* Pinned footer: navigation buttons for steps 0, 2 and 3 */}
      {step === 0 && (
        <div className="flex shrink-0 justify-between gap-2 border-t border-line pt-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => { resetAi(); setStep(1); }} className={SECONDARY_BUTTON_CLASS}>
              {t(lang, "aiCreateSkip")}
            </button>
          </div>
          <div className="flex gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
                {t(lang, "cancel")}
              </button>
            )}
            {method === "describe" && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={reading || aiBusy || !description.trim()}
                className={PRIMARY_BUTTON_CLASS}
              >
                {reading || aiBusy ? t(lang, "aiCreateBusy") : t(lang, "aiCreateGenerate")}
              </button>
            )}
          </div>
        </div>
      )}

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
    </div>
  );
}
