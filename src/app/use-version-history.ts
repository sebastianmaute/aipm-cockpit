// src/app/use-version-history.ts
// Turso-only per-project version history: lists versions, captures one on idle
// after a successful save (coalescing rapid saves; skipping unchanged payloads),
// supports manual checkpoints, and prunes auto-versions to `retention`. Inert
// when `enabled` is false (non-Turso backends / popout).

import { useCallback, useEffect, useRef, useState } from "react";
import { appendVersion, listVersionMeta, loadVersionPayload, pruneVersions, deleteVersion } from "./version-store";
import { diffWorkspaces, summarizeDiff } from "./version-diff";
import type { VersionChange } from "./version-diff";
import { jsonToWorkspace, workspaceToJson } from "./workspace";
import type { Workspace } from "./workspace";
import { applyRestore } from "./version-restore";
import type { RestoreSelection } from "./version-restore";
import type { TursoConfig } from "./turso-config";
import { logDiag } from "./diagnostics";
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
  restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<boolean>;
  remove: (versionId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

// True when a payload holds NO substantive project data — every content list is
// empty. Reference data (roles/disciplines/grades) and singletons (plan/status/
// project) are IGNORED: a project switch/reload resets the content arrays to []
// and briefly seeds default reference data before the new project hydrates, so
// those defaults must not mask an otherwise-empty transient. A parse failure is
// treated as NON-empty (don't skip on uncertainty). Pure.
// ★ Deliberately a SEPARATE definition — NOT `isWorkspaceEmpty` (which counts
// roles/disciplines/grades and would be defeated by the seeded reference-data).
// ★★ THE RULE FOR ADDING TO THIS LIST: count USER-AUTHORED content, never a
// DERIVED slice. A slice qualifies only if a project-switch transient cannot
// carry it non-empty while the others are empty. Two of the six captured slices
// fail that test and are excluded on purpose:
//   - `insights` is written by a DEBOUNCED detect→reconcile effect
//     (`task-manager.tsx`); a timer armed by the OLD project's inputs can fire
//     after the reset, so counting it would let a stale write mask a transient.
//   - `documentVersions` is derived from `documents` (`workspace-context.tsx`
//     sets both from one loader result), so it adds nothing a `documents` count
//     does not, and inherits the same objection.
// Same reasoning already excludes `activityLog` — see docs/AGENTS/activity-log.md.
export function isEmptyWorkspacePayload(json: string): boolean {
  try {
    // Parse RAW (not jsonToWorkspace, which sanitizes/drops incomplete records) —
    // the guard reflects what the payload literally stores.
    const w = JSON.parse(json) as Record<string, unknown>;
    const lists = [
      "tasks", "raid", "milestones", "stakeholders", "resources",
      "changes", "budgets", "absences", "shifts",
      "knowledgeItems", "documents", "calendarEvents",
    ];
    return lists.every((k) => !Array.isArray(w[k]) || (w[k] as unknown[]).length === 0);
  } catch {
    return false;
  }
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
      const list = await listVersionMeta(config, projectId);
      setVersions(list);
      // Seed the diff baseline ONCE from the latest stored version. Without this
      // `lastPayload` stays null across a reload, so the first idle auto-capture
      // of the session has no baseline: it writes a redundant version even when
      // nothing changed AND computes no change-summary. Seeding makes that first
      // auto-capture short-circuit on an unchanged workspace and produces counts.
      if (lastPayload.current === null && list.length > 0) {
        const latest = await loadVersionPayload(config, list[0].id, projectId);
        if (latest !== null && lastPayload.current === null) lastPayload.current = latest;
      }
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
      if (trigger === "auto") {
        const prev = lastPayload.current;
        // Cheap byte-identity short-circuit first.
        if (prev === payload) return; // no-op
        // Never AUTO-snapshot an empty workspace: a project-switch / reload
        // TRANSIENT resets the content arrays to [] before the new project
        // hydrates, and an idle save there would store a useless EMPTY version
        // whose diff-vs-prev summary misleadingly shows big "removed" counts
        // (e.g. "Tasks (35)") — a later restore of it would WIPE the project.
        // Unconditional (not gated on a non-empty prev) so it ALSO refuses a
        // second empty capture when a pre-fix empty row is already the baseline.
        // Tradeoff (accepted): a brand-new project's content-empty setup edits
        // aren't versioned until the first real content exists — which is fine.
        // A manual checkpoint is never skipped; a genuine change captures next.
        if (isEmptyWorkspacePayload(payload)) {
          logDiag("warn", "version.skipEmptyTransientCapture", { payloadLen: payload.length });
          return;
        }
        // Then a MEANINGFUL-change check: diffWorkspaces ignores volatile
        // bookkeeping (e.g. localModifiedAt), so an auto-save that only bumps
        // timestamps — with no real content change — does not create an empty
        // version. (Manual checkpoints always capture.)
        if (prev) {
          try {
            if (diffWorkspaces(jsonToWorkspace(prev), jsonToWorkspace(payload)).length === 0) return;
          } catch {
            // If the diff itself fails, fall through and capture rather than
            // silently dropping a potentially-real change.
          }
        }
      }
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

  const restore = useCallback(async (versionId: string, selection: RestoreSelection, versionLabel: string): Promise<boolean> => {
    if (!active) return false;
    const count = Object.keys(selection).length;
    if (count === 0) return false;
    try {
      const verStr = await loadVersionPayload(config, versionId, projectId);
      if (!verStr) {
        logDiag("warn", "history.restoreVersionMissing", { versionId });
        onError?.(new Error("version payload could not be loaded"));
        return false;
      }
      const version = jsonToWorkspace(verStr);
      const now = jsonToWorkspace(getPayload());
      const changes = diffWorkspaces(version, now);
      const restored = applyRestore(now, version, changes, selection);
      await capturePayload(workspaceToJson(restored), "auto", null);
      applyWorkspace?.(restored);
      logActivity?.("history.restore", count, versionLabel);
      return true;
    } catch (err) { onError?.(err); return false; }
  }, [active, config, projectId, getPayload, capturePayload, applyWorkspace, logActivity, onError]);

  const loadDiff = useCallback(async (fromId: string, to: string | "now"): Promise<VersionChange[]> => {
    if (!active) return [];
    try {
      const fromStr = await loadVersionPayload(config, fromId, projectId);
      const toStr = to === "now" ? getPayload() : await loadVersionPayload(config, to, projectId);
      // A null/empty payload is NOT "no changes" — it's a load failure (the row's
      // payload never stored, or came back empty/truncated). Log the lengths so a
      // failed compare is attributable (Settings → Diagnostics) instead of looking
      // identical to an unchanged version.
      if (!fromStr || !toStr) {
        logDiag("warn", "version.compareEmptyPayload", {
          fromId, to, fromLen: fromStr?.length ?? 0, toLen: toStr?.length ?? 0,
        });
        return [];
      }
      try {
        // STRICT parse: a truncated/malformed payload THROWS here instead of
        // silently degrading to an empty workspace (which would render a
        // misleading "everything added" diff). Surfaced as compareParseFailed.
        return diffWorkspaces(jsonToWorkspace(fromStr, { strict: true }), jsonToWorkspace(toStr, { strict: true }));
      } catch (parseErr) {
        // A parse throw here = a truncated/malformed payload (e.g. a big version
        // stored or read past a size limit). Distinct from a network/load error;
        // reportStorageOutcome only recognises storage errors, so log it directly.
        logDiag("error", "version.compareParseFailed", {
          fromId, to, fromLen: fromStr.length, toLen: toStr.length,
          message: String((parseErr as { message?: unknown })?.message ?? parseErr).slice(0, 200),
        });
        onError?.(parseErr);
        return [];
      }
    } catch (err) {
      logDiag("error", "version.compareLoadFailed", {
        fromId, to, message: String((err as { message?: unknown })?.message ?? err).slice(0, 200),
      });
      onError?.(err);
      return [];
    }
  }, [active, config, projectId, getPayload, onError]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Delete a single snapshot (any trigger). Refreshes the list on success.
  const remove = useCallback(async (versionId: string): Promise<boolean> => {
    if (!active) return false;
    try {
      await deleteVersion(config, versionId, projectId);
      await refresh();
      return true;
    } catch (err) {
      onError?.(err);
      return false;
    }
  }, [active, config, projectId, refresh, onError]);

  return { versions, busy, notifySaved, captureNow, loadDiff, restore, remove, refresh };
}
