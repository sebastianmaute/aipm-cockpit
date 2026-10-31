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
import { createContext, useCallback, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { isPeopleProtected } from "./ai-people-protection";
import { aiPrivacyFor, type AiPrivacy } from "./ai-privacy";
import type { ScopeEpochReader } from "./scope-epoch";
import type { Workspace } from "./workspace";

interface PrivacySource {
  key: string;
  read: () => Workspace;
  /** `useStorageBackend`'s scope-epoch reader, for a privacy WRITE that awaits (the protection switch's
   *  confirm dialog): a swap during the await must not change the next project's setting. */
  epoch: ScopeEpochReader;
}

interface SourceStore {
  set(source: PrivacySource): void;
  get(): PrivacySource | null;
  /** For `usePeopleProtected`: told after every `set`, so a render-reactive reader follows the setting. */
  subscribe(listener: () => void): () => void;
}

function createSourceStore(): SourceStore {
  let current: PrivacySource | null = null;
  const listeners = new Set<() => void>();
  return {
    set: (source) => {
      current = source;
      for (const l of listeners) l();
    },
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The people protection of the store's open project; true (protected) when no source is registered. */
function protectedNow(store: SourceStore | null): boolean {
  const source = store?.get() ?? null;
  return source === null || isPeopleProtected(source.read().settingsOverrides);
}

const NO_SUBSCRIPTION = () => () => undefined;

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
export function useAiPrivacySource(key: string, read: () => Workspace, epoch: ScopeEpochReader): void {
  const store = useContext(SourceContext);
  useLayoutEffect(() => {
    store?.set({ key, read, epoch });
  });
}

/** Read when no source is registered: two reads both outside a provider compare equal (never stale); a
 *  source that appears or goes between two reads makes them differ, so the write is dropped. */
const NO_SOURCE_EPOCH = -1;

/** A stable scope-epoch reader for the open project, for a setting write that awaits first: capture it
 *  before the await, drop the write when it moved (`dropStaleScopeWrite`). */
export function useOpenProjectScopeEpoch(): ScopeEpochReader {
  const store = useContext(SourceContext);
  return useCallback(() => store?.get()?.epoch() ?? NO_SOURCE_EPOCH, [store]);
}

/** AI people protection, layer 1: a stable getter for whether the open project protects its people, asked
 *  at SEND time (the chat's `ToolFlags.peopleProtected`, the executor gate, the context builders). It reads
 *  the SAME source as `useOpenProjectAiPrivacy`, so the tool list and the redaction cannot disagree about
 *  the setting. FAIL CLOSED: true when no source is registered. */
export function useOpenProjectPeopleProtected(): () => boolean {
  const store = useContext(SourceContext);
  return useCallback(() => protectedNow(store), [store]);
}

/** The same answer, render-reactive: for UI that hides a people feature (Plan with AI, RACI suggestions,
 *  the dictation mic). A boolean subscription, so a consumer re-renders only when the answer flips — safe
 *  inside the `memo()`'d panels, unlike `useWorkspace()`. FAIL CLOSED: true outside the provider and
 *  before task-manager has registered its source. */
export function usePeopleProtected(): boolean {
  const store = useContext(SourceContext);
  const getSnapshot = () => protectedNow(store);
  return useSyncExternalStore(store ? store.subscribe : NO_SUBSCRIPTION, getSnapshot, getSnapshot);
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
