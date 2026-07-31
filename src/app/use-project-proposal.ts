"use client";

// One-shot Anthropic call for the "Use AI" project-creation fast-path. Forces a
// single propose_project tool call and returns the parsed ProjectProposal. No
// agentic loop. Reuses the live in-memory API key (never logged).

import { useCallback, useState } from "react";
import { parseProposal, PROPOSAL_TOOL, buildProposalSystemPrompt, type ProjectProposal } from "./ai-project-proposal";
import { type AttachmentBlock } from "./chat-attachments";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { runForcedToolCall } from "./ai-forced-call";
import { isAbortError } from "./abort-error";

/** The user-message content the proposal call accepts: a plain string (SP3) or
 *  a multimodal block array (text + PDF/image/text attachments) for SP-D. */
export type ProposalContent = string | Array<{ type: "text"; text: string } | AttachmentBlock>;

interface AiCreds {
  apiKey: string;
  model: string;
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
        // Shared one-shot forced-tool envelope: never logs/echoes the key or body.
        const toolInput = await runForcedToolCall({
          apiKey: key,
          model: ai.model,
          system: buildProposalSystemPrompt(),
          tools: [PROPOSAL_TOOL],
          toolName: "propose_project",
          messages: [{ role: "user", content: input }],
          maxTokens: 4096,
          signal,
        });
        const parsed = parseProposal(toolInput);
        if (!parsed) throw new Error("parse");
        return parsed;
      } catch (e) {
        if (signal?.aborted || isAbortError(e)) return null;
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
