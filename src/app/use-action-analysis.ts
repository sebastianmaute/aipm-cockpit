"use client";
// One-shot Anthropic call for the Action Center "Analyze with AI" feature. Forces
// a single report_analysis tool call and returns the parsed ActionAnalysis. No
// agentic loop. Reuses the live in-memory API key (never logged). Mirrors
// use-project-proposal.ts.
import { useCallback, useRef, useState } from "react";
import { type ActionAnalysis } from "./action-ai";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { AiHttpError, classifyAiError } from "./ai-errors";

interface AiCreds { apiKey: string; model: string }

export function useActionAnalysis(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionAnalysis | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (context: string): Promise<ActionAnalysis | null> => {
      const key = ai.apiKey.trim();
      if (!key) { setError("no-key"); return null; }
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      try {
        // Single source of truth for the call (shared with the SP5 job runner).
        const parsed = await runJobAnalysis(context, { apiKey: key, model: ai.model }, controller.signal);
        setResult(parsed);
        return parsed;
      } catch (e) {
        // User cancelled the in-flight call via the loading modal — not an error.
        if (e instanceof DOMException && e.name === "AbortError") return null;
        // Anthropic's own rate/usage limit → a distinct "limit" token.
        if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
          setError("limit");
          return null;
        }
        const msg = e instanceof Error ? e.message : "error";
        // Only surface controlled tokens; anything else (e.g. a fetch TypeError) → "network".
        setError(/^\d+$/.test(msg) || msg === "parse" ? msg : "network");
        return null;
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [ai.apiKey, ai.model],
  );

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);
  const clear = useCallback(() => { setResult(null); setError(null); }, []);

  return { analyze, busy, error, result, clear, cancel };
}
