"use client";

// One-shot Anthropic call for the "Use AI" project-creation fast-path. Forces a
// single propose_project tool call and returns the parsed ProjectProposal. No
// agentic loop. Reuses the live in-memory API key (never logged).

import { useCallback, useState } from "react";
import { parseProposal, PROPOSAL_TOOL, buildProposalSystemPrompt, type ProjectProposal } from "./ai-project-proposal";

const ANTHROPIC_VERSION = "2023-06-01";

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
    async (description: string): Promise<ProjectProposal | null> => {
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
            messages: [{ role: "user", content: description }],
            tools: [PROPOSAL_TOOL],
            tool_choice: { type: "tool", name: "propose_project" },
          }),
        });
        if (!res.ok) {
          // Surface only the status code — never echo the key or response body.
          throw new Error(String(res.status));
        }
        const json = (await res.json()) as { content?: ToolUseBlock[] };
        const toolUse = (json.content ?? []).find(
          (b) => b.type === "tool_use" && b.name === "propose_project",
        );
        const parsed = toolUse ? parseProposal(toolUse.input) : null;
        if (!parsed) throw new Error("parse");
        return parsed;
      } catch (e) {
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
