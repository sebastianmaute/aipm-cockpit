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

import { useState } from "react";
import { t, type Lang } from "./i18n";
import { type Settings } from "./settings-types";
import { type ProposalContent } from "./use-project-proposal";
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

const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted";

/** Step-0 source picker: describe (default), file upload, SharePoint, Confluence. */
type ImportMethod = "describe" | "file" | "sharepoint" | "confluence";

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

export interface Step0ImportPanelProps {
  lang: Lang;
  settings: Settings;
  /** Wizard's proposal-call busy flag (drives disabled/busy labels). */
  aiBusy: boolean;
  /** Wizard's proposal-call error (surfaced alongside the local importError). */
  aiError: string | null;
  /** = the wizard's runIngest: runs the model call and pre-fills Step 1. */
  onIngest: (content: ProposalContent) => Promise<void>;
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

  // SharePoint import reuses the M365 delegated session, gated on the integration.
  const spEnabled = isSharePointEnabled(settings.integrations);
  const { acquireToken } = useMsAuth(spEnabled);

  const jira = settings.jira;
  const confluenceReady = !!(jira?.enabled && jira?.siteUrl && jira?.apiToken && jira?.email);

  const handleGenerate = () => onIngest(description);

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
    await onIngest(content);
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
                  onResetAi();
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

      {/* Pinned footer: Skip / Cancel / Generate. */}
      <div className="flex shrink-0 justify-between gap-2 border-t border-line pt-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => { onResetAi(); onSkip(); }} className={SECONDARY_BUTTON_CLASS}>
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
    </>
  );
}
