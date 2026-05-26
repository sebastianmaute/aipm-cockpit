"use client";
import { useCallback, useState } from "react";
import { sanitizeFxRates } from "./sanitize";
import type { FxRates } from "./types";

/**
 * Fetches ECB rates from /api/ecb on demand. `onLoaded` receives the sanitized
 * table so the caller can cache it into the workspace (workspace.fxRates).
 */
export function useFxRates(onLoaded: (fx: FxRates) => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ecb");
      const body = await res.json();
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
      const fx = sanitizeFxRates(body);
      if (!fx) throw new Error("Invalid rate table");
      onLoaded(fx);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onLoaded]);

  return { loading, error, refresh };
}
