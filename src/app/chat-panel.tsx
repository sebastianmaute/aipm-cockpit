"use client";

import { memo, useEffect, useRef, useState } from "react";
import { PaperClipIcon } from "@heroicons/react/24/outline";
import { type ToolDispatcher, runTool } from "./chat-tools";
import { type Lang, type TranslationKey, t } from "./i18n";
import { type OperatingGuide } from "./operating-guide";
import { CHAT_ONLY_PROMPTS, FOUNDATIONAL_PROMPTS, type PromptDef } from "./ask-claude-prompts";

// A starter chip: a prompt plus whether clicking it sends immediately
// (foundational prompts) or just fills the input (the legacy chips).
type PromptChip = PromptDef & { autoSend: boolean };

const PROMPT_CHIPS: PromptChip[] = [
  { labelKey: "chatPromptUpdate", bodyKey: "chatPromptUpdateBody", autoSend: false },
  { labelKey: "chatPromptOverdue", bodyKey: "chatPromptOverdue", autoSend: false },
  { labelKey: "chatPromptAtRisk", bodyKey: "chatPromptAtRisk", autoSend: false },
  { labelKey: "chatPromptStatusUpdate", bodyKey: "chatPromptStatusUpdate", autoSend: false },
  ...[...FOUNDATIONAL_PROMPTS, ...CHAT_ONLY_PROMPTS].map((p) => ({ ...p, autoSend: true })),
];
import { Markdown } from "./markdown";
import { CHAT_MESSAGE_MAX } from "./sanitize";
import type { AiConfig, Settings } from "./settings-types";
import { clampMaxChatTurns } from "./settings-types";
import type { ChatConversation } from "./workspace-tab-context";
import { useAiUsageContext } from "./ai-usage-context";
import { useResizable } from "./use-resizable";
import { ResetSizeButton } from "./task-manager-ui";
import { useChatModels } from "./use-chat-models";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE, FOCUS_RING, TRANSITION, PRESS } from "./interaction-styles";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Checkbox, Input, Select } from "./form-controls";
import { Banner } from "./banner";
import { FieldError } from "./field-feedback";
import { unlockSecret } from "./use-secrets";
import { useConfirm } from "./confirm-dialog";
import { isPassphraseLocked } from "./secrets-store";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import {
  type AttachmentBlock,
  type AttachmentError,
  classifyAttachment,
  checkAttachmentSize,
  buildAttachmentBlock,
} from "./chat-attachments";
import {
  buildSystemPrompt,
  callClaude,
  closeDanglingToolUses,
  CONTINUE_NUDGE,
  INTERRUPTED_TOOL_RESULT,
  readAttachmentData,
  stringifyResult,
  type TextBlock,
  type ContentBlock,
  type ToolResultBlock,
  type ApiMessage,
  type DisplayItem,
} from "./chat-api";
import { AiHttpError, classifyAiError } from "./ai-errors";

/** A staged upload: the Anthropic content block plus display metadata. */
type StagedAttachment = { id: string; name: string; block: AttachmentBlock };

// Full-width, drag-to-resize pane (same chrome as the primary views).
const CHAT_PANE_CLASS = VIEW_PANE_RESIZABLE_CLASS;

function ChatPanelImpl({
  lang,
  ai,
  dictation,
  dispatcher,
  onAcceptConsent,
  onChangeModel,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onAcceptConsent: () => void;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
} & ChatConversationStoreProps) {
  if (!ai.consentAccepted) {
    return <ConsentScreen lang={lang} onAccept={onAcceptConsent} />;
  }
  return (
    <ChatPanelInner
      lang={lang}
      ai={ai}
      dictation={dictation}
      dispatcher={dispatcher}
      onChangeModel={onChangeModel}
      guides={guides}
      guidesReady={guidesReady}
      chatSeed={chatSeed}
      onChatSeedConsumed={onChatSeedConsumed}
      onConfigureAi={onConfigureAi}
      projectId={projectId}
      getChatConversation={getChatConversation}
      saveChatConversation={saveChatConversation}
    />
  );
}

/** Optional in-memory per-project conversation store (from WorkspaceTabProvider)
 *  so the chat survives view-navigation remounts. Absent in tests/popout →
 *  ChatPanel behaves as a fresh, non-persisted conversation. */
interface ChatConversationStoreProps {
  projectId?: string;
  getChatConversation?: (projectId: string) => ChatConversation | undefined;
  saveChatConversation?: (projectId: string, conv: ChatConversation) => void;
}

// Memoized export: with the dispatcher's stable identity (slice 5) and an
// upstream useCallback for onAcceptConsent, all four props are reference-
// stable across parent renders that don't touch lang/ai. ChatPanel now
// skips re-renders triggered by, e.g., task-form keystrokes.
export const ChatPanel = memo(ChatPanelImpl);

function ChatPanelInner({
  lang,
  ai,
  dictation,
  dispatcher,
  onChangeModel,
  guides = [],
  guidesReady = true,
  chatSeed = null,
  onChatSeedConsumed,
  onConfigureAi,
  projectId = "default",
  getChatConversation,
  saveChatConversation,
}: {
  lang: Lang;
  ai: AiConfig;
  dictation?: Settings["dictation"];
  dispatcher: ToolDispatcher;
  onChangeModel?: (model: string) => void;
  guides?: readonly OperatingGuide[];
  guidesReady?: boolean;
  chatSeed?: { prompt: string; autoSend: boolean } | null;
  onChatSeedConsumed?: () => void;
  /** Deep-link to Settings → AI; rendered as a "Configure AI" button in the
   *  empty state when AI is off / no key. Omitted in pop-outs (can't navigate). */
  onConfigureAi?: () => void;
} & ChatConversationStoreProps) {
  const confirm = useConfirm();
  // Restore this project's in-memory conversation on (re)mount — the modern
  // shell remounts the chat view on every visit, so local state alone is lost.
  const [history, setHistory] = useState<ApiMessage[]>(
    () => getChatConversation?.(projectId)?.history ?? [],
  );
  const [display, setDisplay] = useState<DisplayItem[]>(
    () => getChatConversation?.(projectId)?.display ?? [],
  );
  // Project switch WHILE the panel stays mounted: swap to that project's
  // conversation. Render-time reconcile (guarded by seenProjectId), NOT an
  // effect — the set-state-in-effect ban. Seeding from the live projectId is
  // correct here (steady-state prop, not a request/nonce — no remount-swallow).
  const [seenProjectId, setSeenProjectId] = useState(projectId);
  if (projectId !== seenProjectId) {
    setSeenProjectId(projectId);
    const next = getChatConversation?.(projectId);
    setHistory(next?.history ?? []);
    setDisplay(next?.display ?? []);
  }
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
  // Latest committed projectId, read by the in-flight send to detect a mid-send
  // project switch (so its trailing writes can't land on the new project).
  const projectIdRef = useRef(projectId);
  const { ref: chatRef, reset: resetChatSize } = useResizable("aipm-cockpit:chat-size-v2");
  const { record: recordUsage } = useAiUsageContext();
  // Model picker options (live /v1/models when the key is valid, else registry).
  // Uses the session-unlocked key when the saved key is passphrase-wrapped.
  const { options: modelOptions } = useChatModels((unlockedKey ?? ai.apiKey) || "", ai.enabled === true, ai.model);
  const { mic, status, registration } = useDictationMic({
    lang,
    dictation,
    enabled: true,
    label: t(lang, "chatPlaceholder"),
    onAppendFinal: (txt) => setInput((prev) => appendDictation(prev, txt)),
  });

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [display, busy]);

  // Persist the conversation to the above-the-view store on every change, so it
  // survives the next remount. Writes a ref (a side effect, not setState) — clear
  // of the set-state-in-effect ban and cannot loop.
  useEffect(() => {
    saveChatConversation?.(projectId, { history, display });
  }, [history, display, projectId, saveChatConversation]);

  // Track the latest projectId and, on a switch WHILE a send is in flight, abort
  // that send (bound to the old project) and mark it cancelled. Its trailing
  // state writes are additionally project-guarded in submitPrompt, so a reply
  // for the old project can never land on — or persist into — the new one. Runs
  // only on an actual change (seed === live on mount → no spurious abort).
  useEffect(() => {
    const prev = projectIdRef.current;
    projectIdRef.current = projectId;
    if (prev !== projectId) {
      cancelledRef.current = true;
      abortRef.current?.abort();
    }
  }, [projectId]);

  // Keyboard interrupt: Escape stops an in-flight response (the textarea is
  // disabled while busy, so this document listener is the keyboard path). Mirrors
  // stopChat's two ref writes; refs are stable so [busy] is the only dep.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Don't steal Escape from an open modal/dialog (Settings, a task editor,
      // a confirm) — its own handler should own the key — or from a focused
      // control elsewhere (e.g. the top-bar search). Only interrupt when the
      // focus is inside the chat panel (or nowhere in particular).
      if (document.querySelector('[aria-modal="true"]')) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !chatRef.current?.contains(active)) return;
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, chatRef]);

  const guidesPending = ai.groundInGuides && !guidesReady;
  // Master switch: when AI is disabled in Settings, the assistant is fully off
  // regardless of any stored key — force the no-key path so send is blocked.
  const masterOn = ai.enabled === true;
  // The key actually used for calls/gating: a plaintext settings key wins,
  // else the inline-unlocked passphrase key (if any).
  const effectiveApiKey = masterOn ? (ai.apiKey.trim() ? ai.apiKey : (unlockedKey ?? "")) : "";
  const apiKeyMissing = !effectiveApiKey.trim();
  // Cheap synchronous localStorage read — fine in the render body (pure read).
  const apiKeyLocked =
    masterOn && !ai.apiKey.trim() && unlockedKey === null && isPassphraseLocked("anthropicApiKey");

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
    // Bind this send to the project it started on. If the user switches project
    // mid-send, `stale()` becomes true and every subsequent state write is
    // skipped — the reply can't corrupt the new project's conversation.
    const sendProjectId = projectId;
    const stale = () => cancelledRef.current || projectIdRef.current !== sendProjectId;

    // With attachments the user turn is a multimodal content array (text first,
    // then each document/image block); otherwise a plain string.
    const content: string | ContentBlock[] =
      atts.length > 0
        ? [
            ...(text ? [{ type: "text", text } as TextBlock] : []),
            ...atts.map((a) => a.block),
          ]
        : text;
    // Heal any dangling tool_use left by a prior truncated/stopped turn before
    // appending this turn — else the API 400s on the unmatched tool_use and the
    // chat wedges (every subsequent send re-posts the corrupt history).
    const newHistory: ApiMessage[] = [
      ...closeDanglingToolUses(history),
      { role: "user", content },
    ];
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
      // When the previous turn was a max_tokens continuation, the next turn's
      // text is appended to the SAME bubble (a split mid code-fence/table would
      // otherwise render as two broken blocks). `completed` distinguishes a clean
      // end_turn from exhausting the round-trip cap (so we can flag a partial).
      let continueBubble = false;
      let completed = false;

      // Round-trip loop: keep going until the model finishes (end_turn). Two
      // reasons to continue — a tool call to run, or a length-cap truncation to
      // resume — both share the turn budget (a runaway guard).
      // Clamp at the read site too (defence in depth): a directly-typed
      // out-of-range value that bypassed the input clamp can never drive an
      // unbounded number of billed API calls.
      const maxTurns = clampMaxChatTurns(ai.maxChatTurns);
      for (let turn = 0; turn < maxTurns; turn++) {
        if (stale()) break;
        const response = await callClaude(
          effectiveApiKey,
          ai.model,
          system,
          messages,
          controller.signal,
        );
        // A cancel or a project switch may have landed while awaiting — bail
        // before writing this turn onto (possibly) another project's state.
        if (stale()) break;
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;

        const assistantMsg: ApiMessage = {
          role: "assistant",
          content: response.content,
        };
        messages.push(assistantMsg);

        const turnText = response.content
          .filter((b): b is TextBlock => b.type === "text" && b.text.trim() !== "")
          .map((b) => b.text)
          .join("");
        if (turnText) {
          const stitch = continueBubble;
          setDisplay((prev) => {
            if (stitch) {
              const last = prev[prev.length - 1];
              if (last && last.kind === "assistant") {
                return [...prev.slice(0, -1), { ...last, text: last.text + turnText }];
              }
            }
            return [...prev, { kind: "assistant", text: turnText }];
          });
        }

        if (stale()) break;

        // Complete tool call: run each tool, feed the results back, loop so the
        // model can use them.
        if (response.stop_reason === "tool_use") {
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
          continueBubble = false; // tool output breaks the text flow — new bubble
          continue;
        }

        // Truncated at the length cap: resume transparently instead of dumping a
        // cut-off message and waiting for the user to prod. Any tool_use blocks
        // in a truncated turn may be partial — DON'T execute them; answer them
        // with interrupted results (so the protocol stays valid and the model
        // re-issues them cleanly), then nudge it to continue where it left off.
        if (response.stop_reason === "max_tokens") {
          const parts: ContentBlock[] = [];
          for (const block of response.content) {
            if (block.type === "tool_use") {
              parts.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: INTERRUPTED_TOOL_RESULT,
                is_error: true,
              });
            }
          }
          parts.push({ type: "text", text: CONTINUE_NUDGE });
          messages.push({ role: "user", content: parts });
          continueBubble = true; // stitch the resumed text onto the same bubble
          continue;
        }

        // end_turn / stop_sequence — the model is done.
        completed = true;
        break;
      }

      // If the user switched project mid-send, this run belongs to another
      // project now showing a different conversation — don't write its notes or
      // history onto the current one (billing is still recorded).
      const switchedAway = projectIdRef.current !== sendProjectId;
      if (!switchedAway) {
        if (cancelledRef.current) {
          // Stopped by the user — append a neutral note, no error state.
          setDisplay((prev) => [
            ...prev,
            { kind: "assistant", text: t(lang, "chatStopped") },
          ]);
        } else if (!completed) {
          // Hit the round-trip cap while still continuing (never reached
          // end_turn): surface that the answer is partial, not a silent stop.
          setDisplay((prev) => [
            ...prev,
            { kind: "assistant", text: t(lang, "chatTruncatedNote") },
          ]);
        }
      }
      if (!cancelledRef.current) {
        // Record summed token usage for the entire send (all turns combined).
        // Skipped on cancel — no complete turn to bill.
        recordUsage({ input: totalInput, output: totalOutput });
      }

      // Persist a valid history: a max_tokens truncation or a mid-turn Stop can
      // leave the last assistant message with tool_use blocks and no results.
      // Skip when switched away, so the old project's tail can't clobber the new.
      if (!switchedAway) {
        setHistory(closeDanglingToolUses(messages));
      }
    } catch (err) {
      // AbortError is raised by fetch when the controller fires — treat as
      // a user-initiated stop, not a real error. Check .name directly because
      // DOMException may not be instanceof Error across jsdom/Node boundaries.
      const errName = err instanceof Error ? err.name : (err as { name?: string }).name;
      // Suppress when the user switched project mid-send (the abort/error belongs
      // to the old project's conversation, not the one now on screen).
      if (projectIdRef.current === sendProjectId) {
        if (errName === "AbortError") {
          setDisplay((prev) => [
            ...prev,
            { kind: "assistant", text: t(lang, "chatStopped") },
          ]);
        } else if (
          err instanceof AiHttpError &&
          classifyAiError(err.status, err.errorType) === "limit"
        ) {
          // Anthropic's own rate/usage limit. ADVISORY — APPEND a notice to the
          // transcript (do NOT setError-replace or clear prior messages).
          setDisplay((prev) => [
            ...prev,
            { kind: "notice", text: t(lang, "aiUsageLimitReached") },
          ]);
        } else {
          // AiHttpError.message is status-only ("400"); its `safeMessage` (the
          // sanitized RESPONSE error.message, e.g. "prompt is too long: N > M")
          // is appended so a 400 isn't just a bare status digit. Never logged.
          const msg = err instanceof Error ? err.message : String(err);
          const base = t(lang, "chatError", msg);
          const safeMessage = err instanceof AiHttpError ? err.safeMessage : undefined;
          setError(safeMessage ? `${base} — ${safeMessage}` : base);
        }
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
    // Collect every file's failure — a multi-file pick previously overwrote the
    // error state per file, so only the LAST failure was ever shown.
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      const sizeErr = checkAttachmentSize(file.size);
      if (sizeErr) {
        errors.push(attachmentErrorText(sizeErr, file.name));
        continue;
      }
      const kind = classifyAttachment(file.type, file.name);
      if (!kind) {
        errors.push(t(lang, "chatAttachmentUnsupported", file.name));
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
        errors.push(t(lang, "chatAttachmentReadFailed", file.name));
      }
    }
    if (staged.length > 0) setAttachments((prev) => [...prev, ...staged]);
    if (errors.length > 0) setError(errors.join("\n"));
    // Reset the input so re-selecting the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  }

  return (
    // Centered half-size card, top-anchored. The corner drags to a custom size
    // (persisted via useResizable); ResetSizeButton restores the default.
    <div ref={chatRef} className={CHAT_PANE_CLASS}>
      <div className="mb-2 flex shrink-0 items-center justify-end gap-2">
        <Select
          size="xs"
          aria-label={t(lang, "aiModel")}
          value={ai.model}
          onChange={(e) => onChangeModel?.(e.target.value)}
          disabled={!onChangeModel}
          className="min-w-0 max-w-[18rem]"
        >
          {modelOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        <ResetSizeButton onClick={resetChatSize} lang={lang} />
      </div>
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
                  <Input
                    type="password"
                    aria-label={t(lang, "secretPassphrasePlaceholder")}
                    placeholder={t(lang, "secretPassphrasePlaceholder")}
                    value={unlockPass}
                    onChange={(e) => {
                      setUnlockPass(e.target.value);
                      setUnlockError(false);
                    }}
                    className="min-w-0 flex-1"
                  />
                  <Button onClick={unlockApiKey}>
                    {t(lang, "secretUnlock")}
                  </Button>
                </div>
                {unlockError && (
                  <FieldError>{t(lang, "secretUnlockFailed")}</FieldError>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {apiKeyMissing ? t(lang, "chatNoApiKey") : t(lang, "chatGreeting")}
                </p>
                {apiKeyMissing && onConfigureAi && (
                  <Button onClick={onConfigureAi}>{t(lang, "chatConfigureAi")}</Button>
                )}
              </div>
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
                      className={`rounded-full border border-ui-dark-blue/40 bg-surface px-3 py-1 text-xs font-medium text-ui-dark-blue hover:bg-ui-dark-blue/10 focus:outline-none focus:ring-2 focus:ring-ui-dark-blue/50 dark:border-ui-dark-blue/60 dark:text-ui-dark-blue dark:hover:bg-ui-dark-blue/20 ${TRANSITION} ${PRESS}`}
                    >
                      {t(lang, chip.labelKey)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul
            className="space-y-3"
            role="log"
            aria-relevant="additions"
          >
            {display.map((item, idx) => (
              <li key={idx}>
                {item.kind === "user" && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-ui-dark-blue px-3 py-2 text-sm text-white">
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
                {item.kind === "notice" && (
                  <Banner severity="info" role="status">
                    {item.text}
                  </Banner>
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
              <li className="flex items-center justify-start gap-2">
                <div className="rounded-lg bg-surface px-3 py-2 text-sm italic text-muted-foreground">
                  {t(lang, "chatThinking")}
                </div>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={stopChat}
                  aria-label={t(lang, "chatStopGenerating")}
                  title={t(lang, "chatStopGenerating")}
                >
                  {t(lang, "chatStop")}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <Banner severity="error" role="alert" className="mt-2 flex items-start justify-between gap-2">
          <p className="min-w-0 whitespace-pre-line">{error}</p>
          <IconButton
            onClick={() => setError(null)}
            label={t(lang, "dismiss")}
            title={t(lang, "dismiss")}
            className="shrink-0 font-semibold"
          >
            ×
          </IconButton>
        </Banner>
      )}

      {attachments.length > 0 && (
        <ul className="mt-2 flex list-none flex-col gap-1 p-0">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-ui-dark-blue/40 bg-surface px-2 py-1 text-xs text-foreground"
            >
              <span className="flex min-w-0 items-center gap-1">
                <span aria-hidden>📎</span>
                <span className="truncate">{a.name}</span>
              </span>
              <IconButton
                variant="danger"
                onClick={() => removeAttachment(a.id)}
                label={t(lang, "chatAttachmentRemove", a.name)}
                title={t(lang, "chatAttachmentRemove", a.name)}
                className="shrink-0 font-semibold"
              >
                ×
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {status && <div className="mt-2">{status}</div>}

      <div className="mt-3 flex items-stretch gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.csv,.html,.htm,.vtt,.docx,.xlsx,.xlsm,.pptx,application/pdf,image/*,text/plain,text/markdown,text/csv,text/html,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
        <textarea
          ref={inputRef}
          rows={2}
          maxLength={CHAT_MESSAGE_MAX}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={registration.onFocus}
          onBlur={registration.onBlur}
          placeholder={guidesPending ? t(lang, "chatGuidesLoading") : t(lang, "chatPlaceholder")}
          disabled={busy || apiKeyMissing || guidesPending}
          className={`min-w-0 flex-1 self-stretch resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${TRANSITION}`}
        />
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || apiKeyMissing || guidesPending}
            aria-label={t(lang, "chatAttach")}
            title={t(lang, "chatAttach")}
          >
            <PaperClipIcon aria-hidden="true" className="h-4 w-4" />
          </Button>
          {mic}
          {busy ? (
            <button
              type="button"
              onClick={stopChat}
              aria-label={t(lang, "chatStop")}
              className={`rounded-md bg-ui-pink px-4 py-2 text-sm font-medium text-white hover:opacity-90 ${INTERACTIVE}`}
            >
              {t(lang, "chatStop")}
            </button>
          ) : (
            <Button
              onClick={() => submitPrompt()}
              disabled={(!input.trim() && attachments.length === 0) || apiKeyMissing || guidesPending}
            >
              {t(lang, "chatSend")}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={async () => {
              if (await confirm({ message: t(lang, "chatClearConfirm") }))
                clearChat();
            }}
            disabled={busy || display.length === 0}
          >
            {t(lang, "chatClear")}
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t(lang, "chatAttachmentHint")}</p>
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
    <div className="rounded-lg border border-ui-purple/40 bg-ui-purple/10 p-5 dark:border-ui-purple/50 dark:bg-ui-purple/15">
      <h3 className="text-base font-semibold text-ui-purple-strong">
        {t(lang, "aiConsentTitle")}
      </h3>
      <p className="mt-2 text-sm text-ui-purple-strong">
        {t(lang, "aiConsentNotAccepted")}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-ui-purple-strong">
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
          className="font-medium text-ui-purple-strong underline underline-offset-2 hover:text-ui-purple-strong/80"
        >
          {t(lang, "aiConsentPolicyLink")} ↗
        </a>
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-ui-purple-strong">
        <Checkbox
          checked={policyAccepted}
          onChange={(e) => setPolicyAccepted(e.target.checked)}
          className="mt-0.5 cursor-pointer"
        />
        <span>{t(lang, "aiConsentPolicyCheckbox")}</span>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={!policyAccepted}
          className={`rounded-md bg-ui-purple px-4 py-2 text-sm font-medium text-white hover:bg-ui-purple/90 focus:outline-none focus:ring-2 focus:ring-ui-purple focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${TRANSITION} ${PRESS}`}
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
            ? "border-ui-pink/40 bg-ui-pink/10 text-ui-dark-blue dark:border-ui-pink/50 dark:bg-ui-pink/15 dark:text-ui-light-grey"
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
