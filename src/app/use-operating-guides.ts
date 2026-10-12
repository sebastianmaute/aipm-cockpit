// src/app/use-operating-guides.ts — global operating-guide library hook.
// Dual-backend via the store: config=null -> localStorage, else Turso (gated).
// Seeds the built-in guide exactly once when the store is empty. Optional
// feature: load/mutation failures are swallowed so chat still works ungrounded.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuides, saveGuide, removeGuide } from "./operating-guide-store";
import type { OperatingGuide, GuideScope } from "./operating-guide";
import type { TursoConfig } from "./turso-config";
import {
  BUILTIN_GUIDE_ID, BUILTIN_GUIDE_NAME, BUILTIN_GUIDE_CONTENT, BUILTIN_FEATURE_GUIDES, BUILTIN_ACTION_GUIDES,
} from "./operating-guide-builtin.generated";

export interface UseOperatingGuidesArgs {
  config: TursoConfig | null; // null = localStorage backend
}
export interface UseOperatingGuidesResult {
  guides: OperatingGuide[];
  busy: boolean;
  ready: boolean;
  create: (name: string, content: string, opts?: { priority?: number; scope?: GuideScope }) => Promise<void>;
  update: (g: OperatingGuide) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** All built-in guides: the leadership guide (priority 1), the view-scoped
 *  feature guides, then the AI action guides (§701), which reach only the
 *  actions they target. These are seeded into an empty store and kept fresh
 *  (content/name/scope) on every load via reconcileBuiltins. */
export function builtinSeeds(): OperatingGuide[] {
  return [
    {
      id: BUILTIN_GUIDE_ID, name: BUILTIN_GUIDE_NAME, content: BUILTIN_GUIDE_CONTENT,
      enabled: true, priority: 1, scope: {}, builtIn: true,
    },
    ...BUILTIN_FEATURE_GUIDES.map((g, i) => ({
      id: g.id, name: g.name, content: g.content, enabled: true,
      priority: 2 + i, scope: g.scope as GuideScope, builtIn: true,
    })),
    ...BUILTIN_ACTION_GUIDES.map((g, i) => ({
      id: g.id, name: g.name, content: g.content, enabled: true,
      priority: 2 + BUILTIN_FEATURE_GUIDES.length + i, scope: g.scope as GuideScope, builtIn: true,
    })),
  ];
}

const BUILTIN_IDS = new Set(builtinSeeds().map((g) => g.id));

/** For each built-in: seed it if absent; if present, refresh content/name/scope
 *  but PRESERVE the user's enabled + priority, and the user's `scope.targets`
 *  (§701 — the "Applies to" choice in Settings). Returns only the rows that need
 *  saving (idempotent — an unchanged store yields an empty list).
 *  ★ Stored targets win from then on, so a later release that changes a built-in
 *  guide's seeded targets does not reach a store that already holds them. The
 *  editor always stores explicit targets for a built-in (`draftToScope`), so a
 *  user who narrows one to the chat keeps that too. */
export function reconcileBuiltins(existing: OperatingGuide[]): OperatingGuide[] {
  const byId = new Map(existing.map((g) => [g.id, g]));
  const out: OperatingGuide[] = [];
  for (const seed of builtinSeeds()) {
    const cur = byId.get(seed.id);
    if (!cur) {
      out.push(seed);
      continue;
    }
    // `Array.isArray`, not truthiness: stored scope is unvalidated JSON, and a
    // malformed `targets` must fall back to the seed's, not be kept forever.
    const stored = cur.scope?.targets;
    const scope = Array.isArray(stored) ? { ...seed.scope, targets: stored } : seed.scope;
    if (
      cur.content !== seed.content ||
      cur.name !== seed.name ||
      JSON.stringify(cur.scope) !== JSON.stringify(scope)
    ) {
      out.push({ ...seed, scope, enabled: cur.enabled, priority: cur.priority });
    }
  }
  return out;
}

export function useOperatingGuides({ config }: UseOperatingGuidesArgs): UseOperatingGuidesResult {
  const [guides, setGuides] = useState<OperatingGuide[]>([]);
  const [busy, setBusy] = useState(false);
  // §701 — `ready` means "the library for the CURRENT source has loaded", not
  // "some load finished once". It is derived from the source whose load last
  // settled, so a change of source (a file-mode first load, then the Turso
  // config once its sealed token is unlocked) reads not-ready until that
  // source has loaded: an unattended digest or runner, and the chat composer
  // (§76), no longer go out with the previous source's guides in between.
  // Derived rather than reset, because setting state during render or in an
  // effect to mirror a prop is banned here.
  const [loadedFor, setLoadedFor] = useState<TursoConfig | null | undefined>(undefined);
  const ready = loadedFor === config;
  const cfgRef = useRef(config);
  const opSeqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { cfgRef.current = config; }, [config]);
  // ★★ Re-set on mount, not merely cleared on unmount — see the same guard in
  //    use-scheduled-jobs.ts. StrictMode's dev mount→unmount→remount would
  //    otherwise leave this permanently false, suppressing setGuides/setReady
  //    for the whole session.
  //    ★★ Unlike use-scheduled-jobs, this hook's `ready` IS consumed: it reaches
  //    `chat-panel.tsx` as `guidesPending = ai.groundInGuides && !guidesReady`,
  //    which blocks sending and disables the composer. So the symptom is the AI
  //    chat composer stuck disabled — and ONLY when "ground in guides" is on.
  //    An earlier version said "the panel never leaves its loading state", which
  //    named no real surface; see open-followups §76.
  //    Declared BEFORE the refresh effect so the flag is restored first.
  //    Pinned by "still applies the loaded guides after StrictMode's remount"
  //    in use-operating-guides.test.tsx. This previously read "Untestable here
  //    (StrictMode single-invokes effects in this suite)" — which holds only
  //    for a child mounted IN THE SAME COMMIT AS a StrictMode that has any
  //    fiber above it on its own branch (the rule turns on which fiber is
  //    flagged for PLACEMENT — see strictmode.meta.test.tsx for it and its
  //    edges). With `wrapper: StrictMode` it double-invokes. (§76)
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const startSeq = opSeqRef.current;
    // ONE source for the whole refresh. Re-reading `cfgRef.current` after an
    // await let a load of the previous source, settling late, seed and re-read
    // the NEW source — writing built-ins into it and racing its own refresh.
    const source = cfgRef.current;
    try {
      let list = await loadGuides(source);
      const toSave = reconcileBuiltins(list);
      if (toSave.length > 0) {
        for (const g of toSave) await saveGuide(source, g);
        list = await loadGuides(source);
      }
      // A refresh of a source that is no longer current is stale: it must not
      // replace the current source's library, nor mark it loaded.
      if (opSeqRef.current !== startSeq || !mountedRef.current || cfgRef.current !== source) return;
      setGuides(list);
    } catch {
      // optional feature — leave guides as-is
    } finally {
      if (mountedRef.current && cfgRef.current === source) setLoadedFor(source);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, config]);

  const create = useCallback(async (name: string, content: string, opts?: { priority?: number; scope?: GuideScope }) => {
    opSeqRef.current += 1;
    setBusy(true);
    try {
      // Read the current list from the store (not the possibly-stale `guides`
      // closure) so rapid back-to-back creates can't collide on priority.
      const existing = await loadGuides(cfgRef.current);
      const maxP = existing.reduce((m, g) => Math.max(m, g.priority), 0);
      const suffix = Math.random().toString(36).slice(2, 8);
      const g: OperatingGuide = {
        id: `guide-${suffix}`, name, content, enabled: true,
        priority: opts?.priority ?? maxP + 1, scope: opts?.scope ?? {}, builtIn: false,
      };
      await saveGuide(cfgRef.current, g);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const update = useCallback(async (g: OperatingGuide) => {
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await saveGuide(cfgRef.current, g);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    if (BUILTIN_IDS.has(id)) return; // built-ins are undeletable
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await removeGuide(cfgRef.current, id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { guides, busy, ready, create, update, remove, refresh };
}
