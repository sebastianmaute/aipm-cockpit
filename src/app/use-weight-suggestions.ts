"use client";
// One-shot Anthropic call for the SP-C "Suggest weights" feature. Forces a single
// suggest_weights tool call and returns the parsed SuggestionResult. No agentic loop.
// Reuses the live in-memory API key (never logged). Mirrors use-action-analysis.ts.
import { useCallback, useState } from "react";
import { type NextActionsConfig } from "./settings-types";
import { type SuggestionScope } from "./next-actions-tuning";
import { runWeightSuggestion } from "./weight-suggestion-call";
import { type SuggestionResult } from "./weight-suggestion-ai";
import { AiHttpError, classifyAiError } from "./ai-errors";

interface AiCreds { apiKey: string; model: string }

export function useWeightSuggestions(ai: AiCreds) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestionResult | null>(null);

  const run = useCallback(
    async (context: string, current: NextActionsConfig, scope: SuggestionScope): Promise<SuggestionResult | null> => {
      const key = ai.apiKey.trim();
      if (!key) { setError("no-key"); return null; }
      setBusy(true);
      setError(null);
      try {
        const parsed = await runWeightSuggestion(context, { apiKey: key, model: ai.model }, current, scope);
        setResult(parsed);
        return parsed;
      } catch (e) {
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
      }
    },
    [ai.apiKey, ai.model],
  );

  const clear = useCallback(() => { setResult(null); setError(null); }, []);

  return { run, busy, error, result, clear };
}
