// src/app/use-version-history-wiring.ts
//
// task-manager's wiring for Turso version history: the lazy capture payload
// (`getVersionPayload`), the restore fan-out into every workspace setter
// (`applyRestoredWorkspace`, the SECOND load funnel), the error bridge into the
// storage-status banner, the `useVersionHistory` call and the effect that hands
// its `notifySaved` to task-manager's save-success bridge. Extracted from
// task-manager.tsx (§491); move-only. The workspace slices and setters are read
// from `useWorkspace()`, the same context task-manager reads them from;
// `stakeholders` and `calendarEvents` arrive as deps fields because task-manager
// takes those two from other hooks. The three settings reads arrive as deps fields
// (`storageKind`, `features`, `versionHistoryRetention`) with the same values.
//
// ★ The three callbacks KEEP their memoization, against Extraction convention 1.
// `getVersionPayload` and `applyRestoredWorkspace` are `useVersionHistory` args,
// and `handleVersionError` must stay stable so that hook's `refresh` keeps one
// identity (see the comment on it below).
//
// ★★ The capture and restore lists must agree, and other docs cite them by name:
// `getVersionPayload` here, not in task-manager.tsx. The comments on both say why
// each deliberately omitted slice is missing.
"use client";
import { useCallback, useEffect } from "react";
import { isModuleEnabled } from "./feature-modules";
import { backfillTaskResourceFks } from "./resource-foundation";
import { dropDanglingDependencies } from "./sanitize";
import { seedMintFromWorkspace } from "./id-mint-session";
import { useVersionHistory, type UseVersionHistoryArgs, type UseVersionHistoryResult } from "./use-version-history";
import { DEFAULT_VERSION_RETENTION } from "./version-history";
import { useWorkspace } from "./workspace-context";
import { workspaceToJson, type Workspace } from "./workspace";
import type { CalendarEvent } from "./calendar-event";
import type { Settings } from "./settings-types";
import type { Stakeholder } from "./types";

// Idle window before an auto version is captured after a save. Coalesces a
// burst of saves into a single version.
const VERSION_IDLE_MS = 180_000; // 3 minutes

export interface VersionHistoryWiringDeps {
  /** From `useStakeholders` in task-manager, not from the workspace context. */
  stakeholders: readonly Stakeholder[];
  /** From `useResourcePlanner` in task-manager, not from the workspace context. */
  calendarEvents: readonly CalendarEvent[] | undefined;
  tursoConfig: UseVersionHistoryArgs["config"];
  tursoProjectId: string | null;
  storageKind: Settings["storageConfig"]["kind"];
  features: Settings["features"];
  versionHistoryRetention: Settings["versionHistoryRetention"];
  isPopout: boolean;
  logActivityUser: UseVersionHistoryArgs["logActivity"];
  /** task-manager's storage-status bridge; a version error raises its banner. */
  reportStorageOutcome: (err: unknown | null) => void;
  /** task-manager's save-success bridge, filled here with `notifySaved`. */
  versionNotifyRef: { current: () => void };
}

export function useVersionHistoryWiring(deps: VersionHistoryWiringDeps): UseVersionHistoryResult {
  const {
    stakeholders, calendarEvents, tursoConfig, tursoProjectId, storageKind, features,
    versionHistoryRetention, isPopout, logActivityUser, reportStorageOutcome, versionNotifyRef,
  } = deps;
  const {
    tasks, setTasks, raid, setRaid, absences, setAbsences, shifts, setShifts,
    resources, setResources, roles, setRoles, disciplines, setDisciplines, grades, setGrades,
    plan, setPlan, budgets, setBudgets, fxRates, setFxRates, status, setStatus,
    project, setProject, milestones, setMilestones, changes, setChanges, setStakeholders,
    steeringCommittee, setSteeringCommittee, timelogLinks, setTimelogLinks,
    knowledgeItems, setKnowledgeItems, insights, setInsights, documents, setDocuments,
    documentVersions, setDocumentVersions, settingsOverrides, setSettingsOverrides, setCalendarEvents,
  } = useWorkspace();

  // Lazily serialize the CURRENT workspace for a version-history capture. The field
  // set mirrors `applyRestoredWorkspace` below — capture and restore must agree or a
  // restore blanks what the capture never carried. NOT the save/export set in
  // `use-storage-backend.ts` (which also carries fieldVisibility, features,
  // documentAssets, activityLog, budgetHistory). `stakeholders` and `calendarEvents` arrive as deps fields.
  // ★★ `documentAssets` is DELIBERATELY not captured — the decision, its two reasons and its user-visible consequence are recorded in docs/AGENTS/documents.md, "Asset images (S3c-1)" (open-followups §254); pinned by "captures documents but not documentAssets".
  const getVersionPayload = useCallback(
    () => workspaceToJson({
      tasks, raid, absences, shifts, resources, roles, disciplines, grades,
      plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
      steeringCommittee, timelogLinks,
      knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents,
    }),
    [tasks, raid, absences, shifts, resources, roles, disciplines, grades,
     plan, budgets, fxRates, status, project, milestones, changes, stakeholders,
     steeringCommittee, timelogLinks,
     knowledgeItems, insights, documents, documentVersions, settingsOverrides, calendarEvents],
  );

  // Fan a restored workspace into every setter — the SECOND load funnel, so it
  // repeats applyWorkspace's task-FK backfill and dangling-dependency pass (§133)
  // (but NOT `workspaceLoaded`: see it).
  // ★★ `activityLog` is DELIBERATELY MISSING, and missing STRUCTURALLY: no `setActivityLog` binding exists
  // in this file, so the blanking line cannot be written without first bringing a setter into scope. Why —
  // and what still differs between the two funnels — is in `docs/AGENTS/activity-log.md`, not AGENTS.md.
  // ★★ `budgetHistory` is DELIBERATELY MISSING here too, and since the §491 move for the STRUCTURAL reason
  // above as well: this hook does not destructure `setBudgetHistory` (task-manager does). The budget commit boundary is the series' only writer; undo and
  // version restore do not go through it, so a restore's BAC movement surfaces as unattributed variance
  // instead, and a restore never blanks the recorded series either.
  const applyRestoredWorkspace = useCallback((w: Workspace) => {
    setTasks(dropDanglingDependencies(backfillTaskResourceFks(w.resources ?? [], w.tasks ?? []))); setRaid(w.raid ?? []); setAbsences(w.absences ?? []); setShifts(w.shifts ?? []);
    setResources(w.resources ?? []); setRoles(w.roles ?? []); setDisciplines(w.disciplines ?? []); setGrades(w.grades ?? []);
    if (w.plan) setPlan(w.plan); setBudgets(w.budgets ?? []); setFxRates(w.fxRates ?? null); setStatus(w.status ?? {});
    setProject(w.project); setMilestones(w.milestones ?? []); setChanges(w.changes ?? []); setStakeholders(w.stakeholders ?? []);
    setSteeringCommittee(w.steeringCommittee); setTimelogLinks(w.timelogLinks); setKnowledgeItems(w.knowledgeItems); setInsights(w.insights); setDocuments(w.documents ?? []); setDocumentVersions(w.documentVersions ?? []); setSettingsOverrides(w.settingsOverrides); setCalendarEvents(w.calendarEvents);
    // Version restore replaces the SAME project's data — RAISE the id-minter
    // high-water (never lower it) so an id freed by restoring an older (smaller)
    // snapshot can't be reused this session. Side-effecting; runs on restore
    // (callback), not during render.
    seedMintFromWorkspace(w, "raise");
  }, [setTasks, setRaid, setAbsences, setShifts, setResources, setRoles, setDisciplines, setGrades, setPlan, setBudgets, setFxRates, setStatus, setProject, setMilestones, setChanges, setStakeholders, setSteeringCommittee, setTimelogLinks, setKnowledgeItems, setInsights, setDocuments, setDocumentVersions, setSettingsOverrides, setCalendarEvents]);

  // Stable onError so useVersionHistory's `refresh` callback keeps a stable
  // identity — an inline arrow here re-creates refresh every render, re-running
  // its effect and (on the Turso path) re-fetching the version list on every
  // render. See use-version-history.ts for the matching inactive-path guard.
  const handleVersionError = useCallback(
    (err: unknown) => {
      // reportStorageOutcome owns the sticky banner (all kinds) + the one-shot
      // generic toast; version capture is best-effort and never blocks the main
      // save.
      reportStorageOutcome(err);
    },
    [reportStorageOutcome],
  );

  // Version history. Turso-only, main-window-only; the hook is inert otherwise.
  // ★★★ DO NOT RE-GATE THIS `projectId` ON `portfolioMode`. It used to read
  // `portfolioMode === "turso" ? (tursoProjectId ?? "") : ""`, and that ternary
  // discarded an id which was ALREADY correct: `use-storage-backend.ts` seeds
  // `tursoProjectId` from `loadCurrentTursoProjectId()` on mount whatever the
  // portfolio mode is. So in single-DB Turso STORAGE — a configuration the app
  // deliberately supports, and which task-manager.tsx's `trendsActive` and
  // `workspace-section.tsx`'s `chatTursoMode` both handle by ORing the two
  // signals — the ternary forced `""`, `use-version-history.ts` folds
  // `!!projectId` into its `active` predicate, and the whole feature switched
  // off while its view stayed visible: an empty timeline and a "save version"
  // that silently did nothing, with no error, because the store was never
  // reached and `onError` never fired.
  // ★★★ THE DAMAGE WAS NOT MERELY A DEAD FEATURE. A user who had been on the
  // Turso PORTFOLIO and was later detached to file mode (`use-storage-file-ops`
  // writes `savePortfolioMode("file")` on a cross-mode file load and on the
  // demo load — both non-destructive) still has every version stored under
  // their real project id. Keying new ones anywhere else would fork the
  // history and leave the originals unreachable, which is why this resolves to
  // the SAME id the rest of the app uses rather than to a fallback constant.
  // ★★ SAFE MODE IS COVERED FOR FREE, and that is load-bearing rather than
  // incidental: `loadCurrentTursoProjectId()` returns null under `?safe`, so
  // `tursoProjectId` seeds null, this stays `""`, and the hook is inert —
  // Safe Mode must never write history under a key normal boot will not read.
  const versionHistory = useVersionHistory({
    config: tursoConfig,
    projectId: tursoProjectId ?? "",
    enabled: storageKind === "turso" && !isPopout && isModuleEnabled("history", features),
    idleMs: VERSION_IDLE_MS,
    retention: versionHistoryRetention ?? DEFAULT_VERSION_RETENTION,
    getPayload: getVersionPayload,
    applyWorkspace: applyRestoredWorkspace,
    logActivity: logActivityUser,
    onError: handleVersionError,
  });
  useEffect(() => { versionNotifyRef.current = versionHistory.notifySaved; }, [versionHistory.notifySaved, versionNotifyRef]);

  return versionHistory;
}
