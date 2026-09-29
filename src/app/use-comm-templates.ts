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
import { logDiag } from "./diagnostics";
import { pendingEditScope, settlePendingEdit, takePendingEdits, trackPendingEdit } from "./pending-edits";
import type { PendingEditKind } from "./pending-edits";

/** §626 — the outbox kinds for a template's two draftable fields. */
export type TemplateDraftField = "name" | "body";
const DRAFT_KIND: Record<TemplateDraftField, PendingEditKind> = { name: "template-name", body: "template-body" };

/** The outbox scope for the templates of a Turso database, or null when there is no usable config
 *  (hashing an absent URL would throw). */
function outboxScope(config: TursoConfig | null): string | null {
  const url: unknown = config?.httpUrl;
  return typeof url === "string" && url.length > 0 ? pendingEditScope(url, "templates") : null;
}

/** A typed template name as the commit stores it: trimmed, and null when nothing is left. Shared by the
 *  section's commit and the outbox replay so both normalize identically. */
export function normalizeTemplateName(raw: string): string | null {
  const name = raw.trim();
  return name.length > 0 ? name : null;
}

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
  /** §626 — reports the draft in a name or body field so it survives a page close. A value equal to
   *  the stored field cancels the draft. */
  trackDraft: (id: string, field: TemplateDraftField, value: string) => void;
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

  // §626 (R9). The last SERVER-CONFIRMED name and body per template id: set from every load and moved
  // only once a write resolves. The outbox `base` comes from here, never from optimistic local state,
  // so a draft typed while an earlier save is still in flight is based on what the server holds.
  const confirmedRef = useRef(new Map<string, { name: string; body: string }>());
  const confirm = useCallback((tpl: CommTemplate, patch: Partial<Pick<CommTemplate, "name" | "body">> = {}) => {
    confirmedRef.current.set(tpl.id, { name: patch.name ?? tpl.name, body: patch.body ?? tpl.body });
  }, []);
  const adoptLoaded = useCallback((list: readonly CommTemplate[]) => {
    confirmedRef.current = new Map(list.map((t) => [t.id, { name: t.name, body: t.body }]));
  }, []);

  // Written by the render below, once upsertField exists: both load success paths replay through it.
  const replayRef = useRef<(loaded: readonly CommTemplate[]) => void>(() => {});

  const load = useCallback(async () => {
    if (!active || !cfgRef.current) return;
    const startSeq = opSeqRef.current;
    try {
      const list = await loadTemplates(cfgRef.current);
      if (opSeqRef.current !== startSeq) return;
      adoptLoaded(list);
      setTemplates(list);
      replayRef.current(list);
    } catch {
      // Optional feature: swallow so the send flow falls back to i18n.
    }
  }, [active, adoptLoaded]);

  useEffect(() => {
    if (!active || !cfgRef.current) return;
    let cancelled = false;
    const startSeq = opSeqRef.current;
    (async () => {
      try {
        const list = await loadTemplates(cfgRef.current);
        if (cancelled || opSeqRef.current !== startSeq) return;
        adoptLoaded(list);
        setTemplates(list);
        replayRef.current(list);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
    // active is the only meaningful trigger; config is read via cfgRef. adoptLoaded is stable.
  }, [active, adoptLoaded]);

  const create = useCallback(async (category: CommTemplateCategory, name: string, body: string) => {
    if (!active || !cfgRef.current) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const suffix = Math.random().toString(36).slice(2, 8);
      // First template in a category becomes its default, so the send flow uses
      // it automatically without requiring an explicit "Set as default" click.
      const isDefault = !templates.some((tpl) => tpl.category === category && tpl.isDefault);
      const tpl: CommTemplate = { id: `${category}-${now}-${suffix}`, category, name, body, isDefault, createdAt: now, updatedAt: now };
      await storeUpsert(cfgRef.current, tpl);
      confirm(tpl);
      setTemplates((prev) => [...prev, tpl]);
    } finally {
      setBusy(false);
    }
  }, [active, templates, confirm]);

  type FieldPatch = Partial<Pick<CommTemplate, "name" | "body">>;

  /** Writes `patch` onto `existing`. Once the durable write resolves, each patched field's outbox
   *  edit is settled with the value just saved: a newer draft typed while the write was in flight
   *  stays. A rejection leaves the edit tracked. */
  const writeField = useCallback(async (existing: CommTemplate, patch: FieldPatch) => {
    const cfg = cfgRef.current;
    if (!active || !cfg) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const next: CommTemplate = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await storeUpsert(cfg, next);
      confirm(existing, patch);
      const scope = outboxScope(cfg);
      if (scope) {
        for (const field of ["name", "body"] as const) {
          const saved = patch[field];
          if (saved !== undefined) settlePendingEdit(scope, DRAFT_KIND[field], existing.id, saved);
        }
      }
      setTemplates((prev) => prev.map((t) => (t.id === existing.id ? next : t)));
    } finally {
      setBusy(false);
    }
  }, [active, confirm]);

  const upsertField = useCallback(async (id: string, patch: FieldPatch) => {
    const existing = templates.find((t) => t.id === id);
    if (!existing) return;
    await writeField(existing, patch);
  }, [templates, writeField]);

  // §626. Re-issues the name and body edits typed before the last close, once a load has succeeded.
  // Runs against the loaded list, tracking each applied edit so a second stored edit for the same field
  // (two tabs) sees it as changed. Normalized exactly as the commit is. A write that fails goes back
  // into the outbox so the next close still keeps it.
  const replayEdits = useCallback((loaded: readonly CommTemplate[]) => {
    const scope = outboxScope(cfgRef.current);
    if (!active || !scope) return;
    const edits = takePendingEdits(scope, Date.now());
    if (edits.length === 0) return;
    void (async () => {
      let working = [...loaded];
      for (const edit of edits) {
        const field = (Object.keys(DRAFT_KIND) as TemplateDraftField[]).find((f) => DRAFT_KIND[f] === edit.kind);
        if (!field) continue;
        const target = working.find((t) => t.id === edit.id);
        if (!target) {
          logDiag("warn", "storage.pendingEditDropped", { reason: "missing", kind: edit.kind, id: edit.id });
          continue;
        }
        if (target[field] !== edit.base) {
          logDiag("warn", "storage.pendingEditDropped", { reason: "changed", kind: edit.kind, id: edit.id });
          continue;
        }
        const value = field === "name" ? normalizeTemplateName(edit.value) : edit.value;
        if (value === null || value === target[field]) continue;
        try {
          await writeField(target, { [field]: value });
          working = working.map((t) => (t.id === target.id ? { ...t, [field]: value } : t));
        } catch {
          trackPendingEdit(scope, { kind: edit.kind, id: edit.id, base: edit.base, value: edit.value });
        }
      }
    })();
  }, [active, writeField]);
  useEffect(() => { replayRef.current = replayEdits; }, [replayEdits]);

  const trackDraft = useCallback((id: string, field: TemplateDraftField, value: string) => {
    const scope = outboxScope(cfgRef.current);
    const confirmed = confirmedRef.current.get(id);
    if (!active || !scope || !confirmed) return;
    if (value === confirmed[field]) settlePendingEdit(scope, DRAFT_KIND[field], id);
    else trackPendingEdit(scope, { kind: DRAFT_KIND[field], id, base: confirmed[field], value });
  }, [active]);

  const rename = useCallback((id: string, name: string) => upsertField(id, { name }), [upsertField]);
  const saveBody = useCallback((id: string, body: string) => upsertField(id, { body }), [upsertField]);

  const remove = useCallback(async (id: string) => {
    if (!active || !cfgRef.current) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeDelete(cfgRef.current, id);
      confirmedRef.current.delete(id);
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

  return { templates, busy, create, rename, saveBody, trackDraft, remove, setDefault, resolveTemplateBody, refresh: load };
}
