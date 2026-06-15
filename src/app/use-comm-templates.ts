// src/app/use-comm-templates.ts — Turso-gated hook for communication templates.
// Mirrors use-snapshots.ts gating: cfgRef mirror, opSeq staleness guard, effect
// deps limited to `active`. Templates are OPTIONAL — load/mutation failures are
// swallowed so the send flow can fall back to the i18n body template.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTemplates, upsertTemplate as storeUpsert,
  deleteTemplate as storeDelete, setDefaultTemplate as storeSetDefault,
} from "./comm-templates-store";
import { withDefault } from "./comm-templates";
import type { CommTemplate, CommTemplateCategory } from "./comm-templates";
import type { TursoConfig } from "./turso-config";

export interface UseCommTemplatesArgs {
  /** True only when storage is Turso, tursoConfig !== null, and not a popout. */
  active: boolean;
  config: TursoConfig | null;
}

export interface UseCommTemplatesResult {
  templates: CommTemplate[];
  busy: boolean;
  create: (category: CommTemplateCategory, name: string, body: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  saveBody: (id: string, body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setDefault: (category: CommTemplateCategory, id: string) => Promise<void>;
  resolveTemplateBody: (category: CommTemplateCategory) => string | null;
  refresh: () => Promise<void>;
}

export function useCommTemplates(args: UseCommTemplatesArgs): UseCommTemplatesResult {
  const { active, config } = args;
  const [templates, setTemplates] = useState<CommTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const cfgRef = useRef(config);
  // Bumped by every mutation; a load in flight that sees this change must not
  // clobber state with a stale list.
  const opSeqRef = useRef(0);
  useEffect(() => { cfgRef.current = config; }, [config]);

  const load = useCallback(async () => {
    if (!active || !cfgRef.current) return;
    const startSeq = opSeqRef.current;
    try {
      const list = await loadTemplates(cfgRef.current);
      if (opSeqRef.current !== startSeq) return;
      setTemplates(list);
    } catch {
      // Optional feature: swallow so the send flow falls back to i18n.
    }
  }, [active]);

  useEffect(() => {
    if (!active || !cfgRef.current) return;
    let cancelled = false;
    const startSeq = opSeqRef.current;
    (async () => {
      try {
        const list = await loadTemplates(cfgRef.current);
        if (cancelled || opSeqRef.current !== startSeq) return;
        setTemplates(list);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
    // active is the only meaningful trigger; config is read via cfgRef.
  }, [active]);

  const create = useCallback(async (category: CommTemplateCategory, name: string, body: string) => {
    if (!active || !cfgRef.current) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const tpl: CommTemplate = { id: `${category}-${now}`, category, name, body, isDefault: false, createdAt: now, updatedAt: now };
      await storeUpsert(cfgRef.current, tpl);
      setTemplates((prev) => [...prev, tpl]);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const upsertField = useCallback(async (id: string, patch: Partial<Pick<CommTemplate, "name" | "body">>) => {
    if (!active || !cfgRef.current) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const existing = templates.find((t) => t.id === id);
      if (!existing) return;
      const next: CommTemplate = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await storeUpsert(cfgRef.current, next);
      setTemplates((prev) => prev.map((t) => (t.id === id ? next : t)));
    } finally {
      setBusy(false);
    }
  }, [active, templates]);

  const rename = useCallback((id: string, name: string) => upsertField(id, { name }), [upsertField]);
  const saveBody = useCallback((id: string, body: string) => upsertField(id, { body }), [upsertField]);

  const remove = useCallback(async (id: string) => {
    if (!active || !cfgRef.current) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeDelete(cfgRef.current, id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setBusy(false);
    }
  }, [active]);

  const setDefault = useCallback(async (category: CommTemplateCategory, id: string) => {
    if (!active || !cfgRef.current) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeSetDefault(cfgRef.current, category, id);
      setTemplates((prev) => withDefault(prev, id));
    } finally {
      setBusy(false);
    }
  }, [active]);

  const resolveTemplateBody = useCallback(
    (category: CommTemplateCategory): string | null => {
      if (!active) return null;
      const def = templates.find((t) => t.category === category && t.isDefault);
      return def ? def.body : null;
    },
    [active, templates],
  );

  return { templates, busy, create, rename, saveBody, remove, setDefault, resolveTemplateBody, refresh: load };
}
