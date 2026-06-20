"use client";

import { memo, useEffect, useRef, useState } from "react";
import { TOOL_DEFS, type ToolDispatcher, runTool } from "./chat-tools";
import { type Lang, type TranslationKey, t } from "./i18n";
import { selectActiveGuides, assembleGuideBlock, type OperatingGuide } from "./operating-guide";
import { FOUNDATIONAL_PROMPTS, type PromptDef } from "./ask-claude-prompts";

// A starter chip: a prompt plus whether clicking it sends immediately
// (foundational prompts) or just fills the input (the legacy chips).
type PromptChip = PromptDef & { autoSend: boolean };

const PROMPT_CHIPS: PromptChip[] = [
  { labelKey: "chatPromptUpdate", bodyKey: "chatPromptUpdateBody", autoSend: false },
  { labelKey: "chatPromptOverdue", bodyKey: "chatPromptOverdue", autoSend: false },
  { labelKey: "chatPromptAtRisk", bodyKey: "chatPromptAtRisk", autoSend: false },
  { labelKey: "chatPromptStatusUpdate", bodyKey: "chatPromptStatusUpdate", autoSend: false },
  ...FOUNDATIONAL_PROMPTS.map((p) => ({ ...p, autoSend: true })),
];
import { Markdown } from "./markdown";
import { CHAT_MESSAGE_MAX } from "./sanitize";
import type { AiConfig } from "./settings-types";
import { useAiUsageContext } from "./ai-usage-context";
import { useResizable } from "./use-resizable";
import { ResetSizeButton } from "./task-manager-ui";
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
import { unlockSecret } from "./use-secrets";
import { isPassphraseLocked } from "./secrets-store";
import {
  type AttachmentBlock,
  type AttachmentError,
  classifyAttachment,
  checkAttachmentSize,
  buildAttachmentBlock,
} from "./chat-attachments";

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | AttachmentBlock;

/** A staged upload: the Anthropic content block plus display metadata. */
type StagedAttachment = { id: string; name: string; block: AttachmentBlock };

/** Read a File into the data shape `buildAttachmentBlock` expects: base64 (no
 *  data: prefix) for pdf/image, decoded UTF-8 text for text. */
function readAttachmentData(
  file: File,
  kind: "pdf" | "image" | "text",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    if (kind === "text") {
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        // readAsDataURL → "data:<mime>;base64,<DATA>"; keep only <DATA>.
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(file);
    }
  });
}

type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

type ApiMessage =
  | { role: "user"; content: string | ContentBlock[] }
  | { role: "assistant"; content: ContentBlock[] };

type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      name: string;
      input: unknown;
      result: string;
      error: boolean;
    };

const ANTHROPIC_VERSION = "2023-06-01";

export function buildSystemPrompt(
  lang: Lang,
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>,
  guides: readonly OperatingGuide[],
  groundInGuides: boolean,
): SystemBlock[] {
  const groups = (snapshot.knownGroups ?? []).join(", ") || "(none)";
  const labels = (snapshot.knownLabels ?? []).join(", ") || "(none)";
  // STABLE prefix (cached): fixed instructions that never interpolate per-call
  // state, plus the (large) guide text. Anthropic prompt-cache is prefix-based,
  // so this must come FIRST and contain only call-invariant content.
  const stableInstructions = [
    "You are an assistant embedded in the List of Open Points Tracker app, a list-of-open-points task manager.",
    "The user is a project lead tracking open tasks. Each task has: id, taskName, assignee, assigneeEmail, dueDate (YYYY-MM-DD), lastUpdateDate, priority (Low/Medium/High/Urgent), status (To Do/In Progress/On Hold/In Review/Cancelled/Done), blockers, notes, group (single optional category), labels (zero or more tags).",
    "Use the provided tools to read and modify the app's state. Prefer calling tools over guessing. After modifying state, briefly confirm what changed.",
    "Beyond tasks you can also read and write RAID items (Risks/Assumptions/Issues/Dependencies), change-control items, milestones, and stakeholders via their list_/create_/update_/delete_ tools. RAID category is R/A/I/D; status must match the category. Dates are YYYY-MM-DD.",
    "When the user attaches a document, read it and, when they ask, extract the relevant items (tasks, risks, milestones, stakeholders) and create them with the matching create_ tool. Summarise what you created and ask before bulk-creating many records.",
    "Before deleting anything (delete_task, delete_all_tasks, delete_raid_item, delete_change, delete_milestone, delete_stakeholder) confirm with the user in chat unless they were already explicit.",
    "When the user references a record by name or fragment, call the matching list_ tool to find its ID first.",
    `Active language code: ${lang}.`,
  ].join("\n");
  const guideBlock = groundInGuides
    ? assembleGuideBlock(selectActiveGuides(guides, {
        mode: snapshot.mode, modules: snapshot.enabledModules, view: snapshot.currentView,
      }))
    : "";
  const stableText = [stableInstructions, guideBlock].filter(Boolean).join("\n\n");

  // VOLATILE suffix (uncached): per-call state + the APP CONTEXT block. Placed
  // AFTER the cached prefix so it never invalidates the cache.
  const appContext = [
    "APP CONTEXT — adapt your behavior to this.",
    `Mode: ${snapshot.mode}. Enabled modules: ${snapshot.enabledModules.join(", ") || "(none)"}.`,
    `Current view: ${snapshot.currentView}.`,
    "In simple mode keep actions minimal and never reference disabled modules.",
    "You are acting as a senior project & program manager.",
  ].join("\n");
  const volatileText = [
    `Today is ${snapshot.today}. UI language is ${snapshot.language}. Respond in the user's language. Storage backend: ${snapshot.storageKind}. Current task count: ${snapshot.taskCount}.`,
    `Known groups: ${groups}. Known labels: ${labels}. When the user mentions a category, prefer reusing an existing group or label rather than creating near-duplicates.`,
    appContext,
  ].join("\n");

  return [
    { type: "text", text: stableText, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatileText },
  ];
}

export function systemBlocksText(blocks: SystemBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

type ApiUsage = { input_tokens: number; output_tokens: number };

async function callClaude(
  apiKey: string,
  model: string,
  system: SystemBlock[],
  messages: ApiMessage[],
  signal?: AbortSignal,
): Promise<{
  content: ContentBlock[];
  stop_reason: string;
  usage: ApiUsage;
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: system,
      messages,
      tools: TOOL_DEFS,
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json() as { content: ContentBlock[]; stop_reason: string; usage?: ApiUsage };
  return {
    content: json.content,
    stop_reason: json.stop_reason,
    usage: json.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Centered half-size, drag-to-resize. Shared with Manage Roles via view-styles.
const CHAT_PANE_CLASS = CENTERED_HALF_PANE_CLASS;

function ChatPanelImpl({
  lang,
  ai,
  dispatcher,
  onAcceptConsent,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
}: {
  lang: Lang;
  ai: AiConfig;
  dispatcher: ToolDispatcher;
  onAcceptConsent: () => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
}) {
  if (!ai.consentAccepted) {
    return <ConsentScreen lang={lang} onAccept={onAcceptConsent} />;
  }
  return (
    <ChatPanelInner
      lang={lang}
      ai={ai}
      dispatcher={dispatcher}
      guides={guides}
      guidesReady={guidesReady}
      chatSeed={chatSeed}
      onChatSeedConsumed={onChatSeedConsumed}
    />
  );
}

// Memoized export: with the dispatcher's stable identity (slice 5) and an
// upstream useCallback for onAcceptConsent, all four props are reference-
// stable across parent renders that don't touch lang/ai. ChatPanel now
// skips re-renders triggered by, e.g., task-form keystrokes.
export const ChatPanel = memo(ChatPanelImpl);

function ChatPanelInner({
  lang,
  ai,
  dispatcher,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
}: {
  lang: Lang;
  ai: AiConfig;
  dispatcher: ToolDispatcher;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
}) {
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [display, setDisplay] = useState<DisplayItem[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Passphrase-unlock state: when the saved Anthropic key is passphrase-wrapped
  // (no plaintext key in settings) the user unlocks it inline here; the
  // decrypted value lives in `unlockedKey` for the rest of the session.
  const [unlockedKey, setUnlockedKey] = useState<string | null>(null);
  const [unlockPass, setUnlockPass] = useState("");
  const [unlockError, setUnlockError] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const { ref: chatRef, reset: resetChatSize } = useResizable("lop-app:chat-size");
  const { record: recordUsage } = useAiUsageContext();

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [display, busy]);

  const guidesPending = ai.groundInGuides && !guidesReady;
  // The key actually used for calls/gating: a plaintext settings key wins,
  // else the inline-unlocked passphrase key (if any).
  const effectiveApiKey = ai.apiKey.trim() ? ai.apiKey : (unlockedKey ?? "");
  const apiKeyMissing = !effectiveApiKey.trim();
  // Cheap synchronous localStorage read — fine in the render body (pure read).
  const apiKeyLocked =
    !ai.apiKey.trim() && unlockedKey === null && isPassphraseLocked("anthropicApiKey");

  async function submitPrompt(textArg?: string) {
    const text = (textArg ?? input).trim().slice(0, CHAT_MESSAGE_MAX);
    const atts = attachments;
    if ((!text && atts.length === 0) || busy || guidesPending) return;
    if (!effectiveApiKey.trim()) {
      setError(t(lang, "chatNoApiKey"));
      return;
    }
    setError(null);
    setInput("");
    setAttachments([]);
    setBusy(true);
    cancelledRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;

    // With attachments the user turn is a multimodal content array (text first,
    // then each document/image block); otherwise a plain string.
    const content: string | ContentBlock[] =
      atts.length > 0
        ? [
            ...(text ? [{ type: "text", text } as TextBlock] : []),
            ...atts.map((a) => a.block),
          ]
        : text;
    const newHistory: ApiMessage[] = [...history, { role: "user", content }];
    setHistory(newHistory);
    const displayText =
      atts.length > 0
        ? [text, ...atts.map((a) => `📎 ${a.name}`)].filter(Boolean).join("\n")
        : text;
    setDisplay((prev) => [...prev, { kind: "user", text: displayText }]);

    const system = buildSystemPrompt(lang, dispatcher.getSnapshot(), guides, ai.groundInGuides);
    const messages = newHistory.slice();

    try {
      // Accumulate token usage across all turns for this send.
      let totalInput = 0;
      let totalOutput = 0;

      // Tool-use loop: keep round-tripping until Claude stops calling tools.
      // Capped to avoid runaway loops.
      for (let turn = 0; turn < 8; turn++) {
        if (cancelledRef.current) break;
        const response = await callClaude(
          effectiveApiKey,
          ai.model,
          system,
          messages,
          controller.signal,
        );
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;

        const assistantMsg: ApiMessage = {
          role: "assistant",
          content: response.content,
        };
        messages.push(assistantMsg);

        for (const block of response.content) {
          if (block.type === "text" && block.text.trim()) {
            const text = block.text;
            setDisplay((prev) => [...prev, { kind: "assistant", text }]);
          }
        }

        if (response.stop_reason !== "tool_use") break;

        if (cancelledRef.current) break;

        const results: ToolResultBlock[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          let resultStr: string;
          let isError = false;
          try {
            const r = await runTool(dispatcher, block.name, block.input);
            resultStr = stringifyResult(r);
          } catch (err) {
            isError = true;
            resultStr = err instanceof Error ? err.message : String(err);
          }
          setDisplay((prev) => [
            ...prev,
            {
              kind: "tool",
              name: block.name,
              input: block.input,
              result: resultStr,
              error: isError,
            },
          ]);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultStr,
            is_error: isError ? true : undefined,
          });
        }

        messages.push({ role: "user", content: results });
      }

      if (cancelledRef.current) {
        // Stopped by the user — append a neutral note, no error state.
        setDisplay((prev) => [
          ...prev,
          { kind: "assistant", text: t(lang, "chatStopped") },
        ]);
      } else {
        // Record summed token usage for the entire send (all turns combined).
        // Skipped on cancel — no complete turn to bill.
        recordUsage({ input: totalInput, output: totalOutput });
      }

      setHistory(messages);
    } catch (err) {
      // AbortError is raised by fetch when the controller fires — treat as
      // a user-initiated stop, not a real error. Check .name directly because
      // DOMException may not be instanceof Error across jsdom/Node boundaries.
      const errName = err instanceof Error ? err.name : (err as { name?: string }).name;
      if (errName === "AbortError") {
        setDisplay((prev) => [
          ...prev,
          { kind: "assistant", text: t(lang, "chatStopped") },
        ]);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(t(lang, "chatError", msg));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      // Refocus the input after the round-trip resolves.
      inputRef.current?.focus();
    }
  }

  // Mirror the latest send-gate, submit handler, and consume callback into a
  // ref so the seed effect can read current values while depending only on
  // `chatSeed`. Refs are written in an effect — never during render. React
  // fires effects in declaration order within the same commit, so when
  // `chatSeed` changes this gate-mirror (declared first) refreshes the ref
  // before the seed effect below reads it.
  const sendGateRef = useRef<{ blocked: boolean; submit: (text?: string) => void; consume: () => void }>({
    blocked: true,
    submit: () => {},
    consume: () => {},
  });
  useEffect(() => {
    sendGateRef.current = {
      blocked: guidesPending || apiKeyMissing || busy,
      submit: submitPrompt,
      consume: () => onChatSeedConsumed?.(),
    };
  });

  useEffect(() => {
    if (!chatSeed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(chatSeed.prompt);
    if (chatSeed.autoSend && !sendGateRef.current.blocked) {
      sendGateRef.current.submit(chatSeed.prompt);
    }
    sendGateRef.current.consume();
  }, [chatSeed]);

  async function unlockApiKey() {
    const v = await unlockSecret("anthropicApiKey", unlockPass);
    if (v) {
      setUnlockedKey(v);
      setUnlockPass("");
      setUnlockError(false);
    } else {
      setUnlockError(true);
    }
  }

  function stopChat() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  function clearChat() {
    setHistory([]);
    setDisplay([]);
    setError(null);
    setAttachments([]);
  }

  function attachmentErrorText(err: AttachmentError, name: string): string {
    return t(
      lang,
      err === "too-large" ? "chatAttachmentTooLarge" : "chatAttachmentUnsupported",
      name,
    );
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const staged: StagedAttachment[] = [];
    for (const file of Array.from(files)) {
      const sizeErr = checkAttachmentSize(file.size);
      if (sizeErr) {
        setError(attachmentErrorText(sizeErr, file.name));
        continue;
      }
      const kind = classifyAttachment(file.type, file.name);
      if (!kind) {
        setError(t(lang, "chatAttachmentUnsupported", file.name));
        continue;
      }
      try {
        const data = await readAttachmentData(file, kind);
        staged.push({
          id: `att-${(attachSeqRef.current += 1)}`,
          name: file.name,
          block: buildAttachmentBlock(kind, file.type, data),
        });
      } catch {
        setError(t(lang, "chatAttachmentReadFailed", file.name));
      }
    }
    if (staged.length > 0) setAttachments((prev) => [...prev, ...staged]);
    // Reset the input so re-selecting the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  }

  return (
    // Centered half-size card, top-anchored. The corner drags to a custom size
    // (persisted via useResizable); ResetSizeButton restores the default.
    <div ref={chatRef} className={CHAT_PANE_CLASS}>
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto rounded-md border border-line bg-surface-muted p-3"
      >
        {display.length === 0 ? (
          <div className="space-y-3">
            {apiKeyLocked ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(lang, "secretUnlockApiKey")}
                </p>
                <div className="flex items-stretch gap-2">
                  <input
                    type="password"
                    aria-label={t(lang, "secretPassphrasePlaceholder")}
                    placeholder={t(lang, "secretPassphrasePlaceholder")}
                    value={unlockPass}
                    onChange={(e) => {
                      setUnlockPass(e.target.value);
                      setUnlockError(false);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
                  />
                  <button
                    type="button"
                    onClick={unlockApiKey}
                    className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    {t(lang, "secretUnlock")}
                  </button>
                </div>
                {unlockError && (
                  <p role="alert" className="text-sm text-AIPM-pink-strong">
                    {t(lang, "secretUnlockFailed")}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {apiKeyMissing ? t(lang, "chatNoApiKey") : t(lang, "chatGreeting")}
              </p>
            )}
            {!apiKeyMissing && (
              <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-label="Suggested prompts">
                {PROMPT_CHIPS.map((chip) => (
                  <li key={chip.labelKey}>
                    <button
                      type="button"
                      onClick={() =>
                        chip.autoSend
                          ? submitPrompt(t(lang, chip.bodyKey))
                          : setInput(t(lang, chip.bodyKey))
                      }
                      className="rounded-full border border-AIPM-dark-blue/40 bg-surface px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-AIPM-dark-blue/10 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue/50 dark:border-AIPM-dark-blue/60 dark:text-AIPM-dark-blue dark:hover:bg-AIPM-dark-blue/20"
                    >
                      {t(lang, chip.labelKey)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {display.map((item, idx) => (
              <li key={idx}>
                {item.kind === "user" && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-AIPM-dark-blue px-3 py-2 text-sm text-white">
                      {item.text}
                    </div>
                  </div>
                )}
                {item.kind === "assistant" && (
                  <div className="flex justify-start">
                    {/*
                      Assistant text is rendered through the Markdown
                      component so that the common formatting Claude emits
                      (**bold**, bullet/numbered lists, `code`, links, ###
                      headings) renders as styled HTML rather than raw
                      asterisks. User messages stay as plain text — they're
                      verbatim user input. The Markdown renderer never uses
                      dangerouslySetInnerHTML; everything goes through React
                      text nodes so HTML in a reply is escaped automatically.
                    */}
                    <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm text-foreground">
                      <Markdown text={item.text} />
                    </div>
                  </div>
                )}
                {item.kind === "tool" && (
                  <ToolBlock
                    name={item.name}
                    input={item.input}
                    result={item.result}
                    error={item.error}
                    lang={lang}
                  />
                )}
              </li>
            ))}
            {busy && (
              <li className="flex justify-start">
                <div className="rounded-lg bg-surface px-3 py-2 text-sm italic text-muted-foreground">
                  {t(lang, "chatThinking")}
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink-strong dark:bg-AIPM-pink/15"
        >
          {error}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="mt-2 flex list-none flex-col gap-1 p-0">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-AIPM-dark-blue/40 bg-surface px-2 py-1 text-xs text-foreground"
            >
              <span className="flex min-w-0 items-center gap-1">
                <span aria-hidden>📎</span>
                <span className="truncate">{a.name}</span>
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label={t(lang, "chatAttachmentRemove", a.name)}
                title={t(lang, "chatAttachmentRemove", a.name)}
                className="shrink-0 rounded px-1 font-semibold text-muted-foreground hover:text-AIPM-pink-strong"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-stretch gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.csv,application/pdf,image/*,text/plain,text/markdown,text/csv"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
        <ResetSizeButton
          onClick={resetChatSize}
          lang={lang}
          className="self-center"
        />
        <textarea
          ref={inputRef}
          rows={2}
          maxLength={CHAT_MESSAGE_MAX}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={guidesPending ? t(lang, "chatGuidesLoading") : t(lang, "chatPlaceholder")}
          disabled={busy || apiKeyMissing || guidesPending}
          className="min-w-0 flex-1 self-stretch resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || apiKeyMissing || guidesPending}
            aria-label={t(lang, "chatAttach")}
            title={t(lang, "chatAttach")}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            📎
          </button>
          {busy ? (
            <button
              type="button"
              onClick={stopChat}
              aria-label={t(lang, "chatStop")}
              className="rounded-md bg-AIPM-pink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {t(lang, "chatStop")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submitPrompt()}
              disabled={(!input.trim() && attachments.length === 0) || apiKeyMissing || guidesPending}
              className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(lang, "chatSend")}
            </button>
          )}
          <button
            type="button"
            onClick={clearChat}
            disabled={busy || display.length === 0}
            className="rounded-md border border-line bg-surface px-4 py-2 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "chatClear")}
          </button>
        </div>
      </div>
    </div>
  );
}

const POLICY_URL = "https://wiki.example.com/wiki/x/ewB2bwE";

function ConsentScreen({
  lang,
  onAccept,
}: {
  lang: Lang;
  onAccept: () => void;
}) {
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const bullets: TranslationKey[] = [
    "aiConsentBullet1",
    "aiConsentBullet2",
    "aiConsentBullet3",
    "aiConsentBullet4",
    "aiConsentBullet5",
    "aiConsentBullet6",
  ];
  return (
    <div className="rounded-lg border border-AIPM-purple/40 bg-AIPM-purple/10 p-5 dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15">
      <h3 className="text-base font-semibold text-AIPM-purple">
        {t(lang, "aiConsentTitle")}
      </h3>
      <p className="mt-2 text-sm text-AIPM-purple/80">
        {t(lang, "aiConsentNotAccepted")}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-AIPM-purple">
        {bullets.map((k) => (
          <li key={k} className="flex gap-2">
            <span aria-hidden className="mt-0.5">
              •
            </span>
            <span>{t(lang, k)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <a
          href={POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-AIPM-purple underline underline-offset-2 hover:text-AIPM-purple/80"
        >
          {t(lang, "aiConsentPolicyLink")} ↗
        </a>
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-AIPM-purple">
        <input
          type="checkbox"
          checked={policyAccepted}
          onChange={(e) => setPolicyAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-AIPM-purple/40 text-AIPM-purple focus:ring-AIPM-purple dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15"
        />
        <span>{t(lang, "aiConsentPolicyCheckbox")}</span>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={!policyAccepted}
          className="rounded-md bg-AIPM-purple px-4 py-2 text-sm font-medium text-white hover:bg-AIPM-purple/90 focus:outline-none focus:ring-2 focus:ring-AIPM-purple focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(lang, "aiConsentAccept")}
        </button>
      </div>
    </div>
  );
}

function ToolBlock({
  name,
  input,
  result,
  error,
  lang,
}: {
  name: string;
  input: unknown;
  result: string;
  error: boolean;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-start">
      <details
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className={`max-w-[85%] rounded-lg border px-3 py-2 text-xs ${
          error
            ? "border-AIPM-pink/40 bg-AIPM-pink/10 text-AIPM-dark-blue dark:border-AIPM-pink/50 dark:bg-AIPM-pink/15 dark:text-AIPM-light-grey"
            : "border-line bg-surface text-foreground"
        }`}
      >
        <summary className="cursor-pointer select-none font-mono">
          {error ? `⚠ ${t(lang, "chatToolError")}: ` : "▸ "}
          {t(lang, "chatToolCall", name)}
        </summary>
        <div className="mt-2 space-y-1">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 font-mono text-[11px]">
            {JSON.stringify(input, null, 2)}
          </pre>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 font-mono text-[11px]">
            {result}
          </pre>
        </div>
      </details>
    </div>
  );
}
