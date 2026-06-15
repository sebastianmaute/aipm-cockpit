// src/app/use-comm-template-versions.ts — Turso-gated hook for a single template's
// named versions. Mirrors use-comm-templates gating (cfgRef, opSeq staleness guard);
// load/mutation failures are swallowed (versions are an optional Turso feature).
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadVersions,
  saveVersion as storeSave,
  deleteVersion as storeDelete,
} from "./comm-template-versions-store";
import type { CommTemplateVersion } from "./comm-template-versions-schema";
import type { TursoConfig } from "./turso-config";

export interface UseCommTemplateVersionsArgs {
  active: boolean;
  config: TursoConfig | null;
  templateId: string | null;
}

export interface UseCommTemplateVersionsResult {
  versions: CommTemplateVersion[];
  busy: boolean;
  saveVersion: (name: string, body: string, isAuto?: boolean) => Promise<void>;
  removeVersion: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCommTemplateVersions(
  args: UseCommTemplateVersionsArgs,
): UseCommTemplateVersionsResult {
  const { active, config, templateId } = args;
  const [versions, setVersions] = useState<CommTemplateVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const cfgRef = useRef(config);
  const tidRef = useRef(templateId);
  const opSeqRef = useRef(0);

  useEffect(() => {
    cfgRef.current = config;
  }, [config]);

  useEffect(() => {
    tidRef.current = templateId;
  }, [templateId]);

  const canRun = () => active && cfgRef.current !== null && !!tidRef.current;

  const load = useCallback(async () => {
    if (!canRun()) {
      setVersions([]);
      return;
    }
    const startSeq = opSeqRef.current;
    try {
      const list = await loadVersions(cfgRef.current, tidRef.current as string);
      if (opSeqRef.current !== startSeq) return;
      setVersions(list);
    } catch {
      // optional feature — swallow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !cfgRef.current || !templateId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    const startSeq = opSeqRef.current;
    void (async () => {
      try {
        const list = await loadVersions(cfgRef.current, templateId);
        if (cancelled || opSeqRef.current !== startSeq) return;
        setVersions(list);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, templateId]);

  const saveVersion = useCallback(
    async (name: string, body: string, isAuto = false) => {
      if (!canRun()) return;
      opSeqRef.current += 1;
      setBusy(true);
      try {
        const now = new Date().toISOString();
        const suffix = Math.random().toString(36).slice(2, 8);
        const tid = tidRef.current as string;
        const v: CommTemplateVersion = {
          id: `${tid}-v-${now}-${suffix}`,
          templateId: tid,
          name,
          body,
          isAuto,
          createdAt: now,
        };
        await storeSave(cfgRef.current, v);
        setVersions((prev) => [v, ...prev]);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active],
  );

  const removeVersion = useCallback(
    async (id: string) => {
      if (!canRun()) return;
      opSeqRef.current += 1;
      setBusy(true);
      try {
        await storeDelete(cfgRef.current, id);
        setVersions((prev) => prev.filter((v) => v.id !== id));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active],
  );

  return { versions, busy, saveVersion, removeVersion, refresh: load };
}
