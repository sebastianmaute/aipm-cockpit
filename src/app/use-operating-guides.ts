// src/app/use-operating-guides.ts — global operating-guide library hook.
// Dual-backend via the store: config=null -> localStorage, else Turso (gated).
// Seeds the built-in guide exactly once when the store is empty. Optional
// feature: load/mutation failures are swallowed so chat still works ungrounded.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuides, saveGuide, removeGuide } from "./operating-guide-store";
import type { OperatingGuide } from "./operating-guide";
import type { TursoConfig } from "./turso-config";
import {
  BUILTIN_GUIDE_ID, BUILTIN_GUIDE_NAME, BUILTIN_GUIDE_CONTENT,
} from "./operating-guide-builtin.generated";

export interface UseOperatingGuidesArgs {
  config: TursoConfig | null; // null = localStorage backend
}
export interface UseOperatingGuidesResult {
  guides: OperatingGuide[];
  busy: boolean;
  create: (name: string, content: string) => Promise<void>;
  update: (g: OperatingGuide) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function builtinGuide(): OperatingGuide {
  return {
    id: BUILTIN_GUIDE_ID, name: BUILTIN_GUIDE_NAME, content: BUILTIN_GUIDE_CONTENT,
    enabled: true, priority: 1, scope: {}, builtIn: true,
  };
}

export function useOperatingGuides({ config }: UseOperatingGuidesArgs): UseOperatingGuidesResult {
  const [guides, setGuides] = useState<OperatingGuide[]>([]);
  const [busy, setBusy] = useState(false);
  const cfgRef = useRef(config);
  const opSeqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { cfgRef.current = config; }, [config]);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    const startSeq = opSeqRef.current;
    try {
      let list = await loadGuides(cfgRef.current);
      if (list.length === 0) {
        await saveGuide(cfgRef.current, builtinGuide());
        list = await loadGuides(cfgRef.current);
      }
      if (opSeqRef.current !== startSeq || !mountedRef.current) return;
      setGuides(list);
    } catch {
      // optional feature — leave guides as-is
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, config]);

  const create = useCallback(async (name: string, content: string) => {
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
        priority: maxP + 1, scope: {}, builtIn: false,
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
    if (id === BUILTIN_GUIDE_ID) return; // built-in is undeletable
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await removeGuide(cfgRef.current, id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { guides, busy, create, update, remove, refresh };
}
