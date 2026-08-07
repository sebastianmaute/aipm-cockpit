"use client";

// src/app/chat-tool-block.tsx — the chat transcript's tool-call bubble.
// Extracted from chat-panel.tsx (which is file-size-ratchet baselined) to make
// room for the document-tool file card without growing that file. Pure
// presentational component, no state beyond its own open/closed disclosure.

import { useState } from "react";
import { type Lang, t } from "./i18n";

export function ToolBlock({
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
