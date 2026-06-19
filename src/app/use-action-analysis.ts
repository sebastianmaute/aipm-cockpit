"use client";
// One-shot Anthropic call for the Action Center "Analyze with AI" feature. Forces
// a single report_analysis tool call and returns the parsed ActionAnalysis. No
// agentic loop. Reuses the live in-memory API key (never logged). Mirrors
// use-project-proposal.ts.
import { useCallback, useState } from "react";
import { type ActionAnalysis } from "./action-ai";
import { runJobAnalysis } from "./scheduled-job-analysis";

interface AiCreds { apiKey: string; model: string }

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
        // Single source of truth for the call (shared with the SP5 job runner).
        const parsed = await runJobAnalysis(context, { apiKey: key, model: ai.model });
        setResult(parsed);
        return parsed;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        // Only surface controlled tokens; anything else (e.g. a fetch TypeError) → "network".
        setError(/^\d+$/.test(msg) || msg === "parse" ? msg : "network");
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
