"use client";

// Step-0 "Describe / import" surface of the create-project wizard (the AI
// fast-path, shown only when an Anthropic key is configured). Owns all the
// source-method state and the SOURCE handlers (file read / SharePoint fetch /
// Confluence fetch / Describe submit), each of which builds a ProposalContent
// and hands it to `onIngest` — the wizard's runIngest, which runs the proposal
// model call and pre-fills Step 1.
//
// Error boundary (preserved verbatim from the wizard): a SOURCE failure (read /
// fetch) surfaces via the local `importError`; an `onIngest`/generate failure
// surfaces via the wizard-owned `aiError`. `setReading(false)` always runs in
// `finally`.

import { useRef, useState } from "react";
import { t, type Lang } from "./i18n";
import { FieldError } from "./field-feedback";
import { type Settings } from "./settings-types";
import { type ProposalContent } from "./use-project-proposal";
import { classifyAttachment, ATTACHMENT_ACCEPT, type AttachmentBlock } from "./chat-attachments";
import { flattenIngestBlocks, ingestBytes, ingestFile } from "./attachment-ingest";
import { officeKindOf } from "./office-extract";
import { isSharePointEnabled, fetchSharePointFileContent } from "./m365-sharepoint";
import { fetchConfluencePage } from "./confluence-api";
import { SharePointPickerModal } from "./sharepoint-picker-modal";
import { useMsAuth } from "./use-ms-auth";
import type { KnowledgeLink } from "./document-link";
import { Modal } from "./modal";
import { INTERACTIVE } from "./interaction-styles";
import { Button } from "./button";
import { Input, Textarea } from "./form-controls";
import { Spinner } from "./spinner";
import { Card } from "./card";

/** Cap on files accepted in a single multi-upload (extras → "too-many" skip). */
const MAX_IMPORT_FILES = 10;

/** Step-0 source picker: describe (default), file upload, SharePoint, Confluence. */
type ImportMethod = "describe" | "file" | "sharepoint" | "confluence";

export interface Step0ImportPanelProps {
  lang: Lang;
  settings: Settings;
  /** Wizard's proposal-call busy flag (drives disabled/busy labels). */
  aiBusy: boolean;
  /** Wizard's proposal-call error (surfaced alongside the local importError). */
  aiError: string | null;
  /** = the wizard's runIngest: runs the model call and pre-fills Step 1. The
   *  optional signal aborts the in-flight proposal call (loading-modal Cancel). */
  onIngest: (content: ProposalContent, signal?: AbortSignal) => Promise<void>;
  /** Clear the proposal error state (mirrors the wizard's resetAi). */
  onResetAi: () => void;
  /** Skip the fast-path and jump to manual Step 1. */
  onSkip: () => void;
  onCancel?: () => void;
}

export function Step0ImportPanel({
  lang,
  settings,
  aiBusy,
  aiError,
  onIngest,
  onResetAi,
  onSkip,
  onCancel,
}: Step0ImportPanelProps) {
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<ImportMethod>("describe");
  const [confluenceUrl, setConfluenceUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [spPickerOpen, setSpPickerOpen] = useState(false);
  // True while a SOURCE step (file read / SP fetch / Confluence fetch) is in
  // flight — gives read-phase feedback and blocks a second concurrent ingest.
  const [reading, setReading] = useState(false);
  // Files dropped from a multi-upload (invalid type / too large / over the cap)
  // — surfaced as a muted "skipped" notice while the valid ones still import.
  const [skipped, setSkipped] = useState<
    { name: string; reason: "too-large" | "unsupported" | "too-many" }[]
  >([]);
  // Aborts the in-flight proposal call when the loading modal's Cancel is hit.
  const abortRef = useRef<AbortController | null>(null);

  // SharePoint import reuses the M365 delegated session, gated on the integration.
  const spEnabled = isSharePointEnabled(settings.integrations);
  const { acquireToken } = useMsAuth(spEnabled);

  const jira = settings.jira;
  const confluenceReady = !!(jira?.enabled && jira?.siteUrl && jira?.apiToken && jira?.email);

  const handleGenerate = () => onIngest(description);

  // Multi-file upload → classify + size-gate each (capped at MAX_IMPORT_FILES),
  // read the valid ones' bytes (SOURCE step in try/catch), then ingest the
  // combined blocks in ONE proposal call OUTSIDE the catch so a generate failure
  // surfaces via aiError, not the generic source-import error. Invalid/over-cap
  // files are collected into `skipped` (a muted notice) rather than aborting the
  // whole import. Never logs the bytes.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file(s) later
    if (files.length === 0) return;
    setImportError(null);
    setSkipped([]);
    onResetAi();
    const dropped: { name: string; reason: "too-large" | "unsupported" | "too-many" }[] = [];
    const blocks: AttachmentBlock[] = [];
    setReading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (i >= MAX_IMPORT_FILES) {
          dropped.push({ name: file.name, reason: "too-many" });
          continue;
        }
        const result = await ingestFile(file);
        if (!result.ok) {
          if (result.error === "too-large") {
            dropped.push({ name: file.name, reason: "too-large" });
            continue;
          }
          if (result.error === "unsupported-type") {
            dropped.push({ name: file.name, reason: "unsupported" });
            continue;
          }
          // A genuine read error abandons the batch: any `dropped` entries
          // collected before this throw are not surfaced (the source error is
          // shown instead).
          //
          // ★★ THE ANNOTATION IS THE EXHAUSTIVENESS CHECK, and it is here
          // because abandoning the batch is the SEVERE branch — a sixth
          // IngestResult error variant would otherwise join it silently and
          // discard valid files already collected, with nothing to review.
          // Spelling the three literals out (rather than deriving them with
          // Exclude<>) is what makes a new variant a compile error: a derived
          // type would simply widen to admit it. chat-panel.tsx gets the same
          // property for free, since attachmentErrorText names the full union.
          const fatal: "read-failed" | "encrypted" | "budget-exhausted" = result.error;
          throw new Error(fatal);
        }
        // The whole walked tree, not just the mail envelope — see
        // flattenIngestBlocks. One dropped .eml can contribute several blocks.
        blocks.push(...flattenIngestBlocks(result.node));
      }
    } catch {
      setImportError(t(lang, "wizardImportErrorSource"));
      setReading(false);
      return;
    }
    setReading(false);
    if (dropped.length > 0) setSkipped(dropped);
    if (blocks.length === 0) {
      setImportError(t(lang, "wizardImportErrorUnsupported"));
      return;
    }
    const content: ProposalContent = [
      { type: "text", text: t(lang, "wizardImportFilePrompt") },
      ...blocks,
    ];
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await onIngest(content, ctrl.signal);
    } finally {
      abortRef.current = null;
    }
  };

  // SharePoint picker yielded a file link → fetch its bytes via Graph + classify
  // (SOURCE step in try/catch), then ingest OUTSIDE the catch. Errors surface a
  // sanitized message only.
  const onSharePointPick = async (link: KnowledgeLink) => {
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
      const result = await ingestBytes(new Uint8Array(bytes), mime, name);
      if (!result.ok) {
        // classifyAttachment returning "office" implies officeKindOf is
        // non-null, so this is provably unreachable — kept as a defensive
        // restatement of the pre-orchestrator check so a genuinely
        // unresolvable office format still reports "unsupported", not the
        // generic source-failure message a corrupt/unreadable file gets.
        const unresolvableOffice =
          result.error === "read-failed" &&
          classifyAttachment(mime, name) === "office" &&
          !officeKindOf(mime, name);
        setImportError(
          t(
            lang,
            result.error === "too-large"
              ? "wizardImportErrorTooLarge"
              : result.error === "unsupported-type" || unresolvableOffice
                ? "wizardImportErrorUnsupported"
                : "wizardImportErrorSource",
          ),
        );
        return;
      }
      content = [
        { type: "text", text: t(lang, "wizardImportFilePrompt") },
        // A SharePoint-picked .eml is a tree exactly like a dropped one.
        ...flattenIngestBlocks(result.node),
      ];
    } catch {
      setImportError(t(lang, "wizardImportErrorSource"));
      return;
    } finally {
      setReading(false);
    }
    await onIngest(content);
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
    await onIngest(content);
  };

  return (
    <>
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
                  setSkipped([]);
                  onResetAi();
                }}
                className={`rounded-md border px-3 py-1.5 text-sm hover:bg-surface-muted ${
                  method === m.id
                    ? "border-ui-green bg-ui-green/10 font-medium text-foreground"
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
            <Textarea
              aria-label={t(lang, "aiCreateDescribeLabel")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder={t(lang, "aiCreateDescribePlaceholder")}
            />
          </label>
        )}

        {method === "file" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t(lang, "wizardImportFileLabel")}</span>
            <input
              type="file"
              multiple
              aria-label={t(lang, "wizardImportFileLabel")}
              accept={ATTACHMENT_ACCEPT}
              disabled={reading || aiBusy}
              onChange={onFile}
              className="text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-surface-muted disabled:opacity-50"
            />
          </label>
        )}

        {method === "sharepoint" && (
          <div className="flex flex-col gap-2 text-sm">
            <Button
              variant="secondary"
              onClick={() => setSpPickerOpen(true)}
              disabled={reading || aiBusy}
            >
              {t(lang, "wizardImportSharePointBrowse")}
            </Button>
          </div>
        )}

        {method === "confluence" && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{t(lang, "wizardImportConfluenceUrl")}</span>
              <Input
                type="url"
                aria-label={t(lang, "wizardImportConfluenceUrl")}
                value={confluenceUrl}
                onChange={(e) => setConfluenceUrl(e.target.value)}
                placeholder="https://acme.atlassian.net/wiki/spaces/…"
              />
            </label>
            <div>
              <Button
                variant="primary"
                onClick={onConfluenceFetch}
                disabled={reading || aiBusy || !confluenceUrl.trim()}
              >
                {reading || aiBusy ? t(lang, "aiCreateBusy") : t(lang, "wizardImportFetch")}
              </Button>
            </div>
          </div>
        )}

        {(aiError || importError) && (
          <FieldError>
            {importError ??
              t(
                lang,
                aiError === "no-key"
                  ? "aiCreateNeedsKey"
                  : aiError === "limit"
                    ? "aiUsageLimitReached"
                    : "aiCreateError",
              )}
          </FieldError>
        )}

        {skipped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t(lang, "wizardImportSkippedFiles", skipped.length, skipped.map((s) => s.name).join(", "))}
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

      {/* Pinned footer: Skip / Cancel / Generate. */}
      <div className="flex shrink-0 justify-between gap-2 border-t border-line pt-4">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { onResetAi(); onSkip(); }}>
            {t(lang, "aiCreateSkip")}
          </Button>
        </div>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              {t(lang, "cancel")}
            </Button>
          )}
          {method === "describe" && (
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={reading || aiBusy || !description.trim()}
            >
              {reading || aiBusy ? t(lang, "aiCreateBusy") : t(lang, "aiCreateGenerate")}
            </Button>
          )}
        </div>
      </div>

      {/* Blocking loading modal during the read + proposal call. Cancel aborts
          the in-flight AI call via the shared AbortController. */}
      {(reading || aiBusy) && (
        <Modal
          open
          onClose={() => abortRef.current?.abort()}
          ariaLabel={t(lang, reading ? "wizardImportReadingFiles" : "wizardImportAnalyzing")}
          align="center"
          zIndex={70}
        >
          <Card
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 px-8 py-6 text-foreground"
          >
            <Spinner />
            <span className="text-sm font-medium">
              {t(lang, reading ? "wizardImportReadingFiles" : "wizardImportAnalyzing")}
            </span>
            {/* Cancel aborts the AI call; during the (fast, local) read phase abortRef is null so this is a no-op. */}
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground ${INTERACTIVE}`}
            >
              {t(lang, "cancel")}
            </button>
          </Card>
        </Modal>
      )}
    </>
  );
}
