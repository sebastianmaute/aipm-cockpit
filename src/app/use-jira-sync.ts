"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityKind } from "./activity-log";
import { formatExpiryDate } from "./date-format";
import { type Lang, t } from "./i18n";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Settings } from "./settings-types";
import type { Task } from "./types";
import { daysUntil } from "./jira-token-status";
import { useWorkspace } from "./workspace-context";

// ── Lazy-load cache ──────────────────────────────────────────────────────────
type JiraApiModule = typeof import("./jira-api");
let jiraApiPromise: Promise<JiraApiModule> | null = null;
export function loadJiraApi(): Promise<JiraApiModule> {
  if (!jiraApiPromise) { jiraApiPromise = import("./jira-api"); }
  return jiraApiPromise;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface UseJiraSyncArgs {
  settings: Settings;
  today: string;
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** Called false when a sync hits a 401/403 (token rejected), true on a successful sync. */
  onJiraAuthResult?: (ok: boolean) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useJiraSync(args: UseJiraSyncArgs) {
  const { tasks, setTasks } = useWorkspace();

  // Reactive values behind refs so stable useCallbacks never go stale
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(args.settings);
  const langRef = useRef(args.lang);
  const todayRef = useRef(args.today);
  const onJiraAuthResultRef = useRef(args.onJiraAuthResult);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { todayRef.current = args.today; }, [args.today]);
  useEffect(() => { onJiraAuthResultRef.current = args.onJiraAuthResult; }, [args.onJiraAuthResult]);

  // Owned state
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);

  // Ref guards for stable callbacks (avoid stale closures on boolean/array state)
  const jiraSyncingRef = useRef(false);
  const jiraConflictsRef = useRef(jiraConflicts);
  useEffect(() => { jiraConflictsRef.current = jiraConflicts; }, [jiraConflicts]);
  useEffect(() => { jiraSyncingRef.current = jiraSyncing; }, [jiraSyncing]);

  const handleJiraSync = useCallback(async () => {
    if (jiraSyncingRef.current) return;
    const jiraCfg = settingsRef.current.jira;
    if (!jiraCfg.enabled) return;
    if (jiraCfg.tokenExpiresAt) {
      const d = daysUntil(jiraCfg.tokenExpiresAt, todayRef.current);
      if (d !== null && d < 0) {
        args.showToast("info", t(langRef.current, "jiraTokenExpiredBanner", formatExpiryDate(jiraCfg.tokenExpiresAt, langRef.current)));
        return;
      }
    }
    const {
      buildJql,
      searchAllIssues,
      issueToTaskFields,
      diffTaskAgainstIssue,
      isIssueDone,
      updateIssue,
      taskFieldsToJiraFields,
      transitionIssueTo,
      formatJiraError,
      classifyJiraError,
    } = await loadJiraApi();
    const jql = buildJql(jiraCfg);
    if (!jql) {
      args.showToast("error", t(langRef.current, "jiraSyncNoScope"));
      return;
    }
    const creds = {
      siteUrl: jiraCfg.siteUrl,
      email: jiraCfg.email,
      apiToken: jiraCfg.apiToken,
    };
    jiraSyncingRef.current = true;
    setJiraSyncing(true);
    try {
      const issues = await searchAllIssues(creds, jql);
      onJiraAuthResultRef.current?.(true);
      const issueByKey = new Map(issues.map((i) => [i.key, i]));
      const todayNow = todayRef.current;
      const syncStamp = new Date().toISOString();
      const list = tasksRef.current;

      let added = 0;
      let pulled = 0;
      let pushed = 0;
      let pushErrors = 0;
      const conflictItems: ConflictItem[] = [];
      let nextId =
        list.length > 0 ? Math.max(...list.map((row) => row.id)) + 1 : 1;

      // Walk existing tasks first; decide pull/push/conflict per row.
      const next: Task[] = [];
      for (const row of list) {
        if (!row.jiraKey) {
          next.push(row);
          continue;
        }
        const issue = issueByKey.get(row.jiraKey);
        if (!issue) {
          // Out of scope or deleted in Jira — leave alone.
          next.push(row);
          continue;
        }
        const remoteUpdated = (issue.fields?.updated ?? "").slice(0, 19);
        const lastSync = row.lastSyncedAt ?? "";
        const localMod = row.localModifiedAt ?? "";
        const remoteChanged = lastSync ? remoteUpdated > lastSync : true;
        const localChanged = lastSync ? localMod > lastSync : false;

        if (remoteChanged && localChanged) {
          // Both sides moved — queue for user review. Don't touch the row;
          // the conflicts modal will resolve it after the user picks per field.
          const patch = issueToTaskFields(issue, todayNow);
          const diffs = diffTaskAgainstIssue(row, patch);
          if (diffs.length === 0) {
            // Both timestamps moved but actual values match → just refresh sync stamp.
            next.push({
              ...row,
              lastSyncedAt: syncStamp,
              localModifiedAt: undefined,
            });
          } else {
            conflictItems.push({
              taskId: row.id,
              jiraKey: issue.key,
              jiraIssueType: row.jiraIssueType ?? patch.jiraIssueType,
              remoteDone: isIssueDone(issue),
              fields: diffs,
            });
            next.push(row);
          }
        } else if (localChanged) {
          // Push local fields → Jira.
          try {
            await updateIssue(
              creds,
              row.jiraKey,
              taskFieldsToJiraFields(row),
            );
            // Status transition if completion state diverges.
            const localDone = !!row.completedDate;
            const remoteDone = isIssueDone(issue);
            if (localDone && !remoteDone) {
              await transitionIssueTo(creds, row.jiraKey, "done");
            }
            // Note: reopening (local !completed but remote done) isn't pushed —
            // workflows vary and "go back to To Do" requires per-project mapping.
            pushed++;
            next.push({
              ...row,
              lastSyncedAt: syncStamp,
              localModifiedAt: undefined,
            });
          } catch (err) {
            pushErrors++;
            // Keep the local row as-is; user can retry.
            next.push(row);
            // Surface the first push failure for visibility.
            if (pushErrors === 1) {
              args.showToast(
                "error",
                t(
                  langRef.current,
                  "jiraPushFailed",
                  row.jiraKey,
                  formatJiraError(err),
                ),
              );
            }
          }
        } else if (remoteChanged) {
          // Pull Jira → local.
          const patch = issueToTaskFields(issue, todayNow);
          pulled++;
          next.push({
            ...row,
            taskName: patch.taskName ?? row.taskName,
            assignee: patch.assignee ?? row.assignee,
            assigneeEmail: patch.assigneeEmail ?? row.assigneeEmail,
            dueDate: patch.dueDate ?? row.dueDate,
            lastUpdateDate: patch.lastUpdateDate ?? row.lastUpdateDate,
            priority: patch.priority ?? row.priority,
            labels: patch.labels ?? row.labels,
            notes: patch.notes ?? row.notes,
            // Jira is authoritative for a synced task: take the patch's status +
            // completedDate directly so a done→reopen clears completedDate, keeping
            // the invariant `status==="Done" ⟺ completedDate set` consistent.
            status: patch.status,
            completedDate: patch.completedDate,
            jiraKey: issue.key,
            jiraIssueType: patch.jiraIssueType ?? row.jiraIssueType,
            lastSyncedAt: syncStamp,
          });
        } else {
          // No-op; refresh sync stamp.
          next.push({ ...row, lastSyncedAt: syncStamp });
        }
      }

      // New Jira issues we didn't have locally → create.
      const existingKeys = new Set(list.map((r) => r.jiraKey).filter(Boolean));
      for (const issue of issues) {
        if (existingKeys.has(issue.key)) continue;
        const patch = issueToTaskFields(issue, todayNow);
        next.push({
          id: nextId++,
          taskName: patch.taskName ?? issue.key,
          assignee: patch.assignee ?? "",
          assigneeEmail: patch.assigneeEmail ?? "",
          dueDate: patch.dueDate ?? "",
          lastUpdateDate: patch.lastUpdateDate ?? todayNow,
          priority: patch.priority ?? "Medium",
          // patch carries Jira's status (invariant-consistent with completedDate below).
          status: patch.status,
          blockers: "",
          notes: patch.notes ?? "",
          // Taken directly from the patch: a real date only when Jira is done, else
          // undefined — keeping the `status==="Done" ⟺ completedDate set` invariant.
          completedDate: patch.completedDate,
          inquiriesSent: 0,
          group: jiraCfg.projectName || jiraCfg.projectKey || "",
          labels: patch.labels ?? [],
          jiraKey: issue.key,
          jiraIssueType: patch.jiraIssueType,
          lastSyncedAt: syncStamp,
        });
        added++;
      }

      tasksRef.current = next;
      setTasks(next);

      args.logActivity("jira.sync", added + pulled, pushed, conflictItems.length);

      const summary = t(
        langRef.current,
        "jiraSyncDoneFull",
        issues.length,
        added,
        pulled,
        pushed,
      );
      if (conflictItems.length > 0) {
        setJiraConflicts(conflictItems);
        args.showToast(
          "info",
          summary +
            " " +
            t(langRef.current, "jiraSyncConflictsReview", conflictItems.length),
        );
      } else {
        args.showToast("info", summary);
      }
    } catch (err) {
      const kind = classifyJiraError(err);
      if (kind === "auth") {
        onJiraAuthResultRef.current?.(false);
        args.showToast("info", t(langRef.current, "jiraTokenInvalidBanner"));
      } else if (kind === "network") {
        args.showToast("info", t(langRef.current, "jiraSyncUnreachable"));
      } else {
        args.showToast("error", t(langRef.current, "jiraSyncFailed", formatJiraError(err)));
      }
    } finally {
      jiraSyncingRef.current = false;
      setJiraSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- args is a new object each render; showToast/logActivity are called directly but are stable callbacks; setTasks is a stable WorkspaceContext setter
  }, [args.showToast, args.logActivity]);

  const handleResolveConflicts = useCallback(async (resolutions: ConflictResolution[]) => {
    const jiraCfg = settingsRef.current.jira;
    const {
      updateIssue,
      taskFieldsToJiraFields,
      transitionIssueTo,
      formatJiraError,
    } = await loadJiraApi();
    const creds = {
      siteUrl: jiraCfg.siteUrl,
      email: jiraCfg.email,
      apiToken: jiraCfg.apiToken,
    };
    const syncStamp = new Date().toISOString();
    let pulled = 0;
    let pushed = 0;
    let pushErrors = 0;

    for (const res of resolutions) {
      const original = tasksRef.current.find((row) => row.id === res.taskId);
      const conflict = jiraConflictsRef.current.find((c) => c.taskId === res.taskId);
      if (!original || !conflict) continue;

      const merged: Task = { ...original };
      let anyLocalPicked = false;
      let completionChanged = false;
      for (const field of conflict.fields) {
        const pick = res.picks[field.key] ?? "remote";
        const value = pick === "local" ? field.localValue : field.remoteValue;
        if (pick === "local") anyLocalPicked = true;
        if (field.key === "labels") {
          merged.labels = Array.isArray(value) ? (value as string[]) : [];
        } else if (field.key === "completedDate") {
          merged.completedDate =
            typeof value === "string" && value ? value : undefined;
          completionChanged = true;
        } else if (
          field.key === "taskName" ||
          field.key === "assignee" ||
          field.key === "assigneeEmail" ||
          field.key === "dueDate" ||
          field.key === "priority" ||
          field.key === "notes"
        ) {
          (merged as Record<string, unknown>)[field.key] =
            typeof value === "string" ? value : "";
        }
      }

      if (anyLocalPicked) {
        try {
          await updateIssue(
            creds,
            conflict.jiraKey,
            taskFieldsToJiraFields(merged),
          );
          if (completionChanged && merged.completedDate && !conflict.remoteDone) {
            await transitionIssueTo(creds, conflict.jiraKey, "done");
          }
          pushed++;
        } catch (err) {
          pushErrors++;
          if (pushErrors === 1) {
            args.showToast(
              "error",
              t(langRef.current, "jiraPushFailed", conflict.jiraKey, formatJiraError(err)),
            );
          }
          continue;
        }
      } else {
        pulled++;
      }

      merged.lastSyncedAt = syncStamp;
      merged.localModifiedAt = undefined;
      const next = tasksRef.current.map((row) =>
        row.id === merged.id ? merged : row,
      );
      tasksRef.current = next;
      setTasks(next);
    }

    setJiraConflicts([]);
    jiraConflictsRef.current = [];
    args.showToast(
      "info",
      t(langRef.current, "jiraConflictResolved", resolutions.length, pulled, pushed),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- args is a new object each render; showToast/logActivity are called directly but are stable callbacks; setTasks is a stable WorkspaceContext setter
  }, [args.showToast, args.logActivity]);

  const clearConflicts = useCallback(() => setJiraConflicts([]), []);

  return { handleJiraSync, handleResolveConflicts, jiraSyncing, jiraConflicts, clearConflicts };
}
