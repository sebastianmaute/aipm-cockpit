"use client";
// One-shot Anthropic call for the Action Center "Analyze with AI" feature. Forces
// a single report_analysis tool call and returns the parsed ActionAnalysis. No
// agentic loop. Reuses the live in-memory API key (never logged). Mirrors
// use-project-proposal.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { type ActionAnalysis } from "./action-ai";
import { runJobAnalysis } from "./scheduled-job-analysis";
import { AiHttpError, classifyAiError } from "./ai-errors";
import { isAbortError } from "./abort-error";

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
        if (isAbortError(e)) return null;
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
        // ★ DEFENCE IN DEPTH — this guard fixes no live bug today, and saying so
        //   is the point: the ONLY trigger is the Action Center's
        //   `AiTriggerButton`, which swaps its click from `onRun` to `onCancel`
        //   the moment `busy` is true, so a second `analyze` cannot overlap the
        //   first (verified: `use-ai-orchestration.ts` exposes `analyze` solely
        //   through `aiAnalysisBundle.onAnalyze` → `actions-panel.tsx`, and
        //   nothing else calls it). It becomes reachable the moment a second
        //   trigger, a hotkey or a retry is added — a superseded run unwinds
        //   AFTER its successor armed the new controller, so an unguarded
        //   `abortRef.current = null` would make `cancel()` a silent no-op while
        //   the successor is still billed, and an unguarded `setBusy(false)`
        //   would report idle during it. Matches `use-abortable-ai.ts`'s `run`
        //   and `use-timelog-sync.ts`'s `runGuarded`, both of which guard BOTH
        //   statements the same way — copy either. (Reproduce the census with
        //   `grep -rn "=== controller" src --include=*.ts --include=*.tsx`,
        //   dropping `.test.` hits. It prints COMMENT lines as well as guards,
        //   so read the sites it names, never the line count — and no count is
        //   quoted here on purpose, because every one written into this comment
        //   has been falsified by the next branch to add a guard.)
        // ★★ `use-timelog-sync.ts` USED to be the outlier: it closed the guard
        //   before the busy write (`if (abortRef.current === controller)
        //   abortRef.current = null;` then an UNCONDITIONAL `setBusy(false)`),
        //   so a superseded run there reported idle while its successor was
        //   still in flight. That was `docs/open-followups.md` §128 and it is
        //   fixed — both statements now sit inside the identity test. Do NOT
        //   restore the split shape, and do not read this paragraph as a live
        //   description of that file.
        if (abortRef.current === controller) {
          setBusy(false);
          abortRef.current = null;
        }
      }
    },
    [ai.apiKey, ai.model],
  );

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);
  // ★ A billed call must never outlive the surface that started it. This hook is
  //   mounted at task-manager lifetime, so an unmount here is effectively app
  //   teardown and the window is small — but it is one cleanup-only line, it
  //   costs nothing, and it removes the need for every future reader to re-derive
  //   that lifetime before trusting the hook. Sets no state (the
  //   `react-hooks/set-state-in-effect` ban).
  useEffect(() => () => abortRef.current?.abort(), []);
  const clear = useCallback(() => { setResult(null); setError(null); }, []);

  return { analyze, busy, error, result, clear, cancel };
}
