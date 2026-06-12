// src/app/use-version-history.ts
// Turso-only per-project version history: lists versions, captures one on idle
// after a successful save (coalescing rapid saves; skipping unchanged payloads),
// supports manual checkpoints, and prunes auto-versions to `retention`. Inert
// when `enabled` is false (non-Turso backends / popout).

import { useCallback, useEffect, useRef, useState } from "react";
import { appendVersion, listVersionMeta, loadVersionPayload, pruneVersions } from "./version-store";
import { diffWorkspaces, summarizeDiff } from "./version-diff";
import type { VersionChange } from "./version-diff";
import { jsonToWorkspace, workspaceToJson } from "./workspace";
import type { Workspace } from "./workspace";
import { applyRestore } from "./version-restore";
import type { RestoreSelection } from "./version-restore";
import type { TursoConfig } from "./turso-config";
import type { ProjectVersion, ProjectVersionMeta } from "./version-history";

export interface UseVersionHistoryArgs {
  config: TursoConfig | null;
  projectId: string;
  enabled: boolean;
  idleMs: number;
  retention: number;
  getPayload: () => string; // lazily serialize the CURRENT workspace
  onError?: (err: unknown) => void;
  applyWorkspace?: (ws: Workspace) => void;
  logActivity?: (kind: "history.restore", ...args: (string | number)[]) => void;
}

export interface UseVersionHistoryResult {
  versions: ProjectVersionMeta[];
  busy: boolean;
  notifySaved: () => void;
  captureNow: (label: string) => Promise<void>;
  loadDiff: (fromId: string, to: string | "now") => Promise<VersionChange[]>;
  restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useVersionHistory(args: UseVersionHistoryArgs): UseVersionHistoryResult {
  const { config, projectId, enabled, idleMs, retention, getPayload, onError, applyWorkspace, logActivity } = args;
  const [versions, setVersions] = useState<ProjectVersionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayload = useRef<string | null>(null);
  const counter = useRef(0);

  const active = enabled && !!config && !!projectId;

  const refresh = useCallback(async () => {
    if (!active) {
      // Functional update returning the SAME reference when already empty: a
      // plain `setVersions([])` allocates a new array each call, which React
      // treats as a state change and re-renders. Combined with an unstable
      // caller arg (e.g. an inline `onError`) that churns this callback's
      // identity, that re-render re-runs the refresh effect, which calls
      // refresh again — a mount-time whole-tree render loop on non-Turso
      // backends where this hook is inert. Bail without churning state.
      setVersions((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    try {
      setVersions(await listVersionMeta(config, projectId));
    } catch (err) {
      onError?.(err);
    }
  }, [active, config, projectId, onError]);

  // Defer out of the synchronous effect body so the initial list (or the
  // inactive `[]` reset) does not trigger a cascading-render lint warning.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  // Append-from-explicit-payload core (shared by writeVersion and restore).
  const capturePayload = useCallback(
    async (payload: string, trigger: "auto" | "manual", label: string | null) => {
      if (!active) return;
      let summary: string | null = null;
      const prev = lastPayload.current;
      if (prev && prev !== payload) {
        try { summary = summarizeDiff(diffWorkspaces(jsonToWorkspace(prev), jsonToWorkspace(payload))) || null; }
        catch { summary = null; } // never let a summary failure block capture
      }
      const capturedAt = new Date().toISOString();
      counter.current += 1;
      const v: ProjectVersion = {
        id: `${capturedAt}-${counter.current}`,
        projectId,
        capturedAt,
        trigger,
        label,
        summary,
        payload,
      };
      setBusy(true);
      try {
        await appendVersion(config, v, projectId);
        lastPayload.current = payload;
        await pruneVersions(config, projectId, retention);
        await refresh();
      } catch (err) {
        onError?.(err);
      } finally {
        setBusy(false);
      }
    },
    [active, config, projectId, retention, refresh, onError],
  );

  const writeVersion = useCallback(
    async (trigger: "auto" | "manual", label: string | null) => {
      if (!active) return;
      const payload = getPayload();
      if (trigger === "auto" && payload === lastPayload.current) return; // no-op
      await capturePayload(payload, trigger, label);
    },
    [active, getPayload, capturePayload],
  );

  const notifySaved = useCallback(() => {
    if (!active) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void writeVersion("auto", null);
    }, idleMs);
  }, [active, idleMs, writeVersion]);

  const captureNow = useCallback(
    async (label: string) => {
      await writeVersion("manual", label);
    },
    [writeVersion],
  );

  const restore = useCallback(async (versionId: string, selection: RestoreSelection, versionLabel: string) => {
    if (!active) return;
    const count = Object.keys(selection).length;
    if (count === 0) return;
    try {
      const verStr = await loadVersionPayload(config, versionId, projectId);
      if (!verStr) return;
      const version = jsonToWorkspace(verStr);
      const now = jsonToWorkspace(getPayload());
      const changes = diffWorkspaces(version, now);
      const restored = applyRestore(now, version, changes, selection);
      await capturePayload(workspaceToJson(restored), "auto", null);
      applyWorkspace?.(restored);
      logActivity?.("history.restore", count, versionLabel);
    } catch (err) { onError?.(err); }
  }, [active, config, projectId, getPayload, capturePayload, applyWorkspace, logActivity, onError]);

  const loadDiff = useCallback(async (fromId: string, to: string | "now"): Promise<VersionChange[]> => {
    if (!active) return [];
    try {
      const fromStr = await loadVersionPayload(config, fromId, projectId);
      const toStr = to === "now" ? getPayload() : await loadVersionPayload(config, to, projectId);
      if (!fromStr || !toStr) return [];
      return diffWorkspaces(jsonToWorkspace(fromStr), jsonToWorkspace(toStr));
    } catch (err) { onError?.(err); return []; }
  }, [active, config, projectId, getPayload, onError]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { versions, busy, notifySaved, captureNow, loadDiff, restore, refresh };
}
