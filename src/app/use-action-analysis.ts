"use client";
// One-shot Anthropic call for the Action Center "Analyze with AI" feature. Forces
// a single report_analysis tool call and returns the parsed ActionAnalysis. No
// agentic loop. Reuses the live in-memory API key (never logged). Mirrors
// use-project-proposal.ts.
import { useCallback, useState } from "react";
import { parseAnalysis, ANALYZE_TOOL, buildAnalysisSystemPrompt, type ActionAnalysis } from "./action-ai";

const ANTHROPIC_VERSION = "2023-06-01";

interface AiCreds { apiKey: string; model: string }
interface ToolUseBlock { type: string; name?: string; input?: unknown }

export function useActionAnalysis(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionAnalysis | null>(null);

  const analyze = useCallback(
    async (context: string): Promise<ActionAnalysis | null> => {
      const key = ai.apiKey.trim();
      if (!key) { setError("no-key"); return null; }
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
            max_tokens: 2048,
            system: buildAnalysisSystemPrompt(),
            messages: [{ role: "user", content: context }],
            tools: [ANALYZE_TOOL],
            tool_choice: { type: "tool", name: "report_analysis" },
          }),
        });
        if (!res.ok) throw new Error(String(res.status)); // status only — never echo key/body
        const json = (await res.json()) as { content?: ToolUseBlock[] };
        const toolUse = (json.content ?? []).find((b) => b.type === "tool_use" && b.name === "report_analysis");
        const parsed = toolUse ? parseAnalysis(toolUse.input) : null;
        if (!parsed) throw new Error("parse");
        setResult(parsed);
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

  const clear = useCallback(() => { setResult(null); setError(null); }, []);

  return { analyze, busy, error, result, clear };
}
