"use client";
// src/app/ai-privacy-context.tsx — the AI privacy of the OPEN project (AI people protection, spec R3).
//
// The provider wraps `TaskManagerInner` in task-manager's default export, ABOVE its body, so a hook
// task-manager calls in its own body reads it as well as every panel below. Task-manager registers the
// source with `useAiPrivacySource`: the open project's storage identity (`portfolioCurrentId ??
// "default"`, the key every per-project device store uses) and a reader of its live workspace.
// `useOpenProjectAiPrivacy` returns a STABLE getter, asked right before each request, so the privacy
// always follows the workspace and setting as they are at send time.
//
// ★★ Only for requests built from the OPEN project. A request about another project (a scheduled job
// on a stored project) builds its privacy from THAT project's workspace (`scheduled-job-run.ts`).
// ★ FAIL CLOSED: outside the provider, or before task-manager has registered its source, the getter
// THROWS. Sending unprotected because a source was missing is the bypass the spec forbids.
import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { aiPrivacyFor, type AiPrivacy } from "./ai-privacy";
import type { Workspace } from "./workspace";

interface PrivacySource {
  key: string;
  read: () => Workspace;
}

interface SourceStore {
  set(source: PrivacySource): void;
  get(): PrivacySource | null;
}

function createSourceStore(): SourceStore {
  let current: PrivacySource | null = null;
  return {
    set: (source) => { current = source; },
    get: () => current,
  };
}

const SourceContext = createContext<SourceStore | null>(null);

/** Thrown by the getter when no open project has registered its privacy source. */
export class AiPrivacyUnavailableError extends Error {
  constructor() {
    super("ai-privacy-unavailable");
    this.name = "AiPrivacyUnavailableError";
  }
}

export function AiPrivacyProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSourceStore);
  return <SourceContext.Provider value={store}>{children}</SourceContext.Provider>;
}

/** Task-manager registers the open project here. A layout effect, so every commit's source is in
 *  place before any passive effect (an unattended run) or event handler can ask for it. */
export function useAiPrivacySource(key: string, read: () => Workspace): void {
  const store = useContext(SourceContext);
  useLayoutEffect(() => {
    store?.set({ key, read });
  });
}

/** A stable getter for the open project's privacy; it throws `AiPrivacyUnavailableError` when no
 *  source is registered. */
export function useOpenProjectAiPrivacy(): () => AiPrivacy {
  const store = useContext(SourceContext);
  return useCallback((): AiPrivacy => {
    const source = store?.get() ?? null;
    if (source === null) throw new AiPrivacyUnavailableError();
    return aiPrivacyFor([{ key: source.key, ws: source.read() }]);
  }, [store]);
}
