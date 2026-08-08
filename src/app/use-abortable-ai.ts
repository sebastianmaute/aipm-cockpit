"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "./abort-error";

/**
 * The `busy` + `AbortController` + `cancel` triple that every stoppable AI
 * trigger needs, for the ONE site that did not already have it.
 *
 * ★ The five paths that already own a controller are deliberately NOT
 *   refactored onto this. They are working, tested code with divergent
 *   surrounding logic, and parameterising divergent-but-correct chains into one
 *   factory is the move AGENTS.md's shared-SSRF-core rule exists to prevent.
 *
 * ★ An AbortError is a USER-INITIATED STOP, not a failure: `run` resolves to
 *   null, `error` stays null and nothing is toasted.
 */
export function useAbortableAi() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const run = useCallback(async <T,>(call: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    abortRef.current?.abort();           // a new run supersedes the billed one in flight
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const value = await call(controller.signal);
      // ★ DEFENCE IN DEPTH — this recheck fixes no live bug today. `ai-forced-call.ts`
      //   has no retry, no backoff and no streaming, so nothing can interleave between
      //   the response resolving and this return: a Stop click cannot land in that
      //   window. It becomes reachable the moment any caller adds a retry, and the
      //   consumer would then apply a result the user had already cancelled. The five
      //   pre-existing controllers all guard their success path the same way.
      return controller.signal.aborted ? null : value;
    } catch (e) {
      if (isAbortError(e)) return null;
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      // ★★ BOTH statements are guarded on "this is still the current run". A
      //    superseded run unwinds AFTER its successor armed the new controller, so
      //    an unguarded `setBusy(false)` reports idle while the successor is still
      //    in flight — the same class of bug the ref guard already prevents for
      //    `cancel`. `run` has no in-flight guard, so superseding is a normal path.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }, []);

  return { busy, error, run, cancel };
}
