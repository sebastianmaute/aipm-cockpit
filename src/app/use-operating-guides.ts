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
  BUILTIN_GUIDE_ID, BUILTIN_GUIDE_NAME, BUILTIN_GUIDE_CONTENT, BUILTIN_FEATURE_GUIDES,
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

/** All built-in guides: the leadership guide (priority 1) followed by the
 *  view-scoped feature guides. These are seeded into an empty store and kept
 *  fresh (content/name/scope) on every load via reconcileBuiltins. */
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
  ];
}

const BUILTIN_IDS = new Set(builtinSeeds().map((g) => g.id));

/** For each built-in: seed it if absent; if present, refresh content/name/scope
 *  but PRESERVE the user's enabled + priority. Returns only the rows that need
 *  saving (idempotent — an unchanged store yields an empty list). */
export function reconcileBuiltins(existing: OperatingGuide[]): OperatingGuide[] {
  const byId = new Map(existing.map((g) => [g.id, g]));
  const out: OperatingGuide[] = [];
  for (const seed of builtinSeeds()) {
    const cur = byId.get(seed.id);
    if (!cur) {
      out.push(seed);
      continue;
    }
    if (
      cur.content !== seed.content ||
      cur.name !== seed.name ||
      JSON.stringify(cur.scope) !== JSON.stringify(seed.scope)
    ) {
      out.push({ ...seed, enabled: cur.enabled, priority: cur.priority });
    }
  }
  return out;
}

export function useOperatingGuides({ config }: UseOperatingGuidesArgs): UseOperatingGuidesResult {
  const [guides, setGuides] = useState<OperatingGuide[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
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
  //    for a child mounted under a StrictMode that has any fiber above it on
  //    the same branch. With `wrapper: StrictMode` it double-invokes; see
  //    strictmode.meta.test.tsx for the shape rule and its edges. (§76)
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const startSeq = opSeqRef.current;
    try {
      let list = await loadGuides(cfgRef.current);
      const toSave = reconcileBuiltins(list);
      if (toSave.length > 0) {
        for (const g of toSave) await saveGuide(cfgRef.current, g);
        list = await loadGuides(cfgRef.current);
      }
      if (opSeqRef.current !== startSeq || !mountedRef.current) return;
      setGuides(list);
    } catch {
      // optional feature — leave guides as-is
    } finally {
      if (mountedRef.current) setReady(true);
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
