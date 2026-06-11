// src/app/use-version-history.ts
// Turso-only per-project version history: lists versions, captures one on idle
// after a successful save (coalescing rapid saves; skipping unchanged payloads),
// supports manual checkpoints, and prunes auto-versions to `retention`. Inert
// when `enabled` is false (non-Turso backends / popout).

import { useCallback, useEffect, useRef, useState } from "react";
import { appendVersion, listVersionMeta, pruneVersions } from "./version-store";
import { diffWorkspaces, summarizeDiff } from "./version-diff";
import { jsonToWorkspace } from "./workspace";
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
}

export interface UseVersionHistoryResult {
  versions: ProjectVersionMeta[];
  busy: boolean;
  notifySaved: () => void;
  captureNow: (label: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useVersionHistory(args: UseVersionHistoryArgs): UseVersionHistoryResult {
  const { config, projectId, enabled, idleMs, retention, getPayload, onError } = args;
  const [versions, setVersions] = useState<ProjectVersionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayload = useRef<string | null>(null);
  const counter = useRef(0);

  const active = enabled && !!config && !!projectId;

  const refresh = useCallback(async () => {
    if (!active) {
      setVersions([]);
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

  const writeVersion = useCallback(
    async (trigger: "auto" | "manual", label: string | null) => {
      if (!active) return;
      const payload = getPayload();
      if (trigger === "auto" && payload === lastPayload.current) return; // no-op
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
    [active, config, projectId, retention, getPayload, refresh, onError],
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { versions, busy, notifySaved, captureNow, refresh };
}
