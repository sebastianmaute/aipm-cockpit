"use client";

import { memo, useEffect, useRef, useState } from "react";
import { TOOL_DEFS, type ToolDispatcher, runTool } from "./chat-tools";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Markdown } from "./markdown";
import { CHAT_MESSAGE_MAX } from "./sanitize";
import type { AiConfig } from "./settings-menu";

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
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

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

function buildSystemPrompt(
  lang: Lang,
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>,
): string {
  const groups = (snapshot.knownGroups ?? []).join(", ") || "(none)";
  const labels = (snapshot.knownLabels ?? []).join(", ") || "(none)";
  return [
    "You are an assistant embedded in the List of Open Points Tracker app, a list-of-open-points task manager.",
    "The user is a project lead tracking open tasks. Each task has: id, taskName, assignee, assigneeEmail, dueDate (YYYY-MM-DD), lastUpdateDate, priority (Low/Medium/High/Urgent), blockers, notes, group (single optional category), labels (zero or more tags).",
    "Use the provided tools to read and modify the app's state. Prefer calling tools over guessing. After modifying state, briefly confirm what changed.",
    "Before deleting tasks (delete_task or delete_all_tasks) confirm with the user in chat unless they were already explicit.",
    `Today is ${snapshot.today}. UI language is ${snapshot.language}. Respond in the user's language. Storage backend: ${snapshot.storageKind}. Current task count: ${snapshot.taskCount}.`,
    `Known groups: ${groups}. Known labels: ${labels}. When the user mentions a category, prefer reusing an existing group or label rather than creating near-duplicates.`,
    "When the user references a task by name or fragment, call list_tasks to find its ID first.",
    `Active language code: ${lang}.`,
  ].join("\n");
}

async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  messages: ApiMessage[],
): Promise<{
  content: ContentBlock[];
  stop_reason: string;
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
      system,
      messages,
      tools: TOOL_DEFS,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return await res.json();
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ChatPanelImpl({
  lang,
  ai,
  dispatcher,
  onAcceptConsent,
}: {
  lang: Lang;
  ai: AiConfig;
  dispatcher: ToolDispatcher;
  onAcceptConsent: () => void;
}) {
  if (!ai.consentAccepted) {
    return <ConsentScreen lang={lang} onAccept={onAcceptConsent} />;
  }
  return (
    <ChatPanelInner lang={lang} ai={ai} dispatcher={dispatcher} />
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
}: {
  lang: Lang;
  ai: AiConfig;
  dispatcher: ToolDispatcher;
}) {
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [display, setDisplay] = useState<DisplayItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [display, busy]);

  async function sendMessage() {
    const text = input.trim().slice(0, CHAT_MESSAGE_MAX);
    if (!text || busy) return;
    if (!ai.apiKey.trim()) {
      setError(t(lang, "chatNoApiKey"));
      return;
    }
    setError(null);
    setInput("");
    setBusy(true);

    const newHistory: ApiMessage[] = [
      ...history,
      { role: "user", content: text },
    ];
    setHistory(newHistory);
    setDisplay((prev) => [...prev, { kind: "user", text }]);

    const system = buildSystemPrompt(lang, dispatcher.getSnapshot());
    const messages = newHistory.slice();

    try {
      // Tool-use loop: keep round-tripping until Claude stops calling tools.
      // Capped to avoid runaway loops.
      for (let turn = 0; turn < 8; turn++) {
        const response = await callClaude(ai.apiKey, ai.model, system, messages);
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

      setHistory(messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t(lang, "chatError", msg));
    } finally {
      setBusy(false);
      // Refocus the input after the round-trip resolves.
      inputRef.current?.focus();
    }
  }

  function clearChat() {
    setHistory([]);
    setDisplay([]);
    setError(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const apiKeyMissing = !ai.apiKey.trim();

  return (
    // Fills the height made available by the parent (the workspace section,
    // which is the actual resizable surface). `min-h-[300px]` keeps the chat
    // usable if the section is shrunk; otherwise the chat tracks the
    // section's current height.
    <div className="flex h-full min-h-[300px] flex-col">
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto rounded-md border border-line bg-surface-muted p-3"
      >
        {display.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {apiKeyMissing ? t(lang, "chatNoApiKey") : t(lang, "chatGreeting")}
          </p>
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
          className="mt-2 rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={2}
          maxLength={CHAT_MESSAGE_MAX}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(lang, "chatPlaceholder")}
          disabled={busy || apiKeyMissing}
          className="min-w-0 flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={sendMessage}
            disabled={busy || !input.trim() || apiKeyMissing}
            className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "chatSend")}
          </button>
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
            ? "border-AIPM-pink/40 bg-AIPM-pink/10 text-AIPM-pink dark:border-AIPM-pink/50 dark:bg-AIPM-pink/15"
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
