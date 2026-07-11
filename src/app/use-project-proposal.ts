"use client";

// One-shot Anthropic call for the "Use AI" project-creation fast-path. Forces a
// single propose_project tool call and returns the parsed ProjectProposal. No
// agentic loop. Reuses the live in-memory API key (never logged).

import { useCallback, useState } from "react";
import { parseProposal, PROPOSAL_TOOL, buildProposalSystemPrompt, type ProjectProposal } from "./ai-project-proposal";
import { type AttachmentBlock } from "./chat-attachments";
import { AiHttpError, classifyAiError, safeAiErrorType } from "./ai-errors";

const ANTHROPIC_VERSION = "2023-06-01";

/** The user-message content the proposal call accepts: a plain string (SP3) or
 *  a multimodal block array (text + PDF/image/text attachments) for SP-D. */
export type ProposalContent = string | Array<{ type: "text"; text: string } | AttachmentBlock>;

interface AiCreds {
  apiKey: string;
  model: string;
}

interface ToolUseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

export function useProjectProposal(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (input: ProposalContent, signal?: AbortSignal): Promise<ProjectProposal | null> => {
      const key = ai.apiKey.trim();
      if (!key) {
        setError("no-key");
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal,
          headers: {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: ai.model,
            max_tokens: 4096,
            system: buildProposalSystemPrompt(),
            messages: [{ role: "user", content: input }],
            tools: [PROPOSAL_TOOL],
            tool_choice: { type: "tool", name: "propose_project" },
          }),
        });
        if (!res.ok) {
          // Surface only the status + safe error.type token — never echo the key
          // or the response body's message text.
          let errorType: string | undefined;
          try { errorType = safeAiErrorType(await res.json()); } catch { /* non-JSON body */ }
          throw new AiHttpError(res.status, errorType);
        }
        const json = (await res.json()) as { content?: ToolUseBlock[] };
        const toolUse = (json.content ?? []).find(
          (b) => b.type === "tool_use" && b.name === "propose_project",
        );
        const parsed = toolUse ? parseProposal(toolUse.input) : null;
        if (!parsed) throw new Error("parse");
        return parsed;
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return null;
        if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
          setError("limit");
          return null;
        }
        setError(e instanceof Error ? e.message : "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [ai.apiKey, ai.model],
  );

  const reset = useCallback(() => setError(null), []);

  return { generate, busy, error, reset };
}
