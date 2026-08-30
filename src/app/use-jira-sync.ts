"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import { formatExpiryDate } from "./date-format";
import { type Lang, t } from "./i18n";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Settings } from "./settings-types";
import type { Task } from "./types";
import { daysUntil } from "./jira-token-status";
import { isReadOnlyIssue, jiraProjectKeyOf } from "./jira-projects";
import { mintId } from "./id-mint-session";
import { statusActivityKind } from "./task-status";
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
  /** Actor-aware logger. The sync summary is stamped `"integration"`: `actor`
   *  names the subsystem that AUTHORED the data, not whether a gesture started
   *  the run. Jira sync writes fields the user never typed, so it is an
   *  integration write even though a "Sync with Jira" button triggers it — the
   *  gesture-origin reading would also make `"ai"` unreachable, since every AI
   *  write descends from the user typing a chat message. The plain `logActivity`
   *  is deliberately NOT threaded here: this hook logs nothing else. */
  logActivityAs: LogActivityAsFn;
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

        // Read-only project: never push/transition, never queue a conflict.
        // Remote is authoritative — pull (reverting any stray local edit) or
        // just refresh the stamp when nothing moved.
        if (isReadOnlyIssue(row.jiraKey, jiraCfg)) {
          if (remoteChanged || localChanged) {
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
              description: patch.description ?? row.description,
              status: patch.status,
              completedDate: patch.completedDate,
              jiraKey: issue.key,
              jiraIssueType: patch.jiraIssueType ?? row.jiraIssueType,
              localModifiedAt: undefined,
              lastSyncedAt: syncStamp,
            });
            // ★★★ OBSERVES the transition; it does not write one. Routing this
            // arm through `applyStatusChange` would stamp `today` over Jira's
            // REAL resolution date — the prohibition in
            // docs/AGENTS/task-status.md. `issueToTaskFields` derives `status`
            // and `completedDate` from ONE `statusKey` read, so the patch's
            // pair is already coherent and the comparison needs nothing more.
            // ★★ LOGGED INSIDE THE LOOP, BEFORE THE COMMIT — the opposite of
            // the conflict path below, and deliberately so rather than by
            // oversight. Both pull arms accumulate into `next` and the loop
            // commits ONCE (`setTasks(next)` after it), so there is no
            // per-iteration write for a log to get ahead of: either the whole
            // batch lands or none of it does. The only throwing calls between
            // here and that commit are the push arm's `updateIssue` /
            // `transitionIssueTo`, and its own `catch` keeps the row and
            // carries on, so nothing can abandon the batch. Buffering these
            // transitions to emit them after the commit would REORDER the audit
            // trail (they currently precede the `jira.sync` summary) and add a
            // list that can silently diverge from the committed rows — a real
            // defect surface bought to close a hazard no path can reach. If a
            // future edit adds an early `return`/`throw` between this line and
            // that commit, this reasoning dies with it: buffer then.
            const transition = statusActivityKind(row, { completedDate: patch.completedDate });
            if (transition) {
              args.logActivityAs("integration", transition, row.id, patch.taskName ?? row.taskName);
            }
          } else {
            next.push({ ...row, lastSyncedAt: syncStamp });
          }
          continue;
        }

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
              // ★ Non-optional by construction: issueToTaskFields returns
              //   `Partial<Task> & { status: TaskStatus }`, so this is the same
              //   single `statusKey` read that produced patch.completedDate.
              remoteStatus: patch.status,
              localStatus: row.status,
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
            // ★★★ `status`, NOT `completedDate`. `status` is the source of
            //   truth for "done" (docs/AGENTS/task-status.md), and
            //   `taskFieldsToJiraFields` pushes no status — so this transition
            //   is the ONLY route by which local completion reaches Jira on
            //   this path. Keying it on the date moved a real issue to Done
            //   off a SPLIT local row whose status still read "In Progress".
            //   The same defect on the CONFLICT path was fixed separately;
            //   this is the plain auto-push sibling, which runs on every
            //   ordinary sync and so fires far more often (open-followups
            //   §227). On a consistent pair the two are equivalent.
            const localDone = row.status === "Done";
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
            description: patch.description ?? row.description,
            // Jira is authoritative for a synced task: take the patch's status +
            // completedDate directly so a done→reopen clears completedDate, keeping
            // the invariant `status==="Done" ⟺ completedDate set` consistent.
            status: patch.status,
            completedDate: patch.completedDate,
            jiraKey: issue.key,
            jiraIssueType: patch.jiraIssueType ?? row.jiraIssueType,
            lastSyncedAt: syncStamp,
          });
          // Same two rules as the read-only pull above: OBSERVE the transition,
          // never route this arm through `applyStatusChange` (it would overwrite
          // Jira's real resolution date with `today`); and log inside the loop,
          // because this arm shares that one's single-commit shape — the note
          // there carries the argument and the condition that would void it.
          const transition = statusActivityKind(row, { completedDate: patch.completedDate });
          if (transition) {
            args.logActivityAs("integration", transition, row.id, patch.taskName ?? row.taskName);
          }
        } else {
          // No-op; refresh sync stamp.
          next.push({ ...row, lastSyncedAt: syncStamp });
        }
      }

      // New Jira issues we didn't have locally → create.
      // ★★ SILENT BY DESIGN. An issue that arrives ALREADY Done produces a delivered
      //   task (`completedDate` comes straight off the patch below), and no
      //   `task.completed` is logged for it. That is the same exemption
      //   `status-activity-census.test.ts` records for `task-manager.tsx`'s
      //   `handleCreateLinkedTask`: there is no before-row, so there is no
      //   transition to classify — `statusActivityKind` compares two states and
      //   only one exists here. Do NOT "complete the pattern" by synthesising an
      //   undelivered before-state; that would log a completion for work that
      //   was finished before this workspace ever heard of it.
      // ★ The completion-trend consequence is a missing SEED, not a wrong
      //   number: `deliveredBy` reduces over `tasks[].completedDate`, which this
      //   row does set, so the numerator is right on every day — the day the
      //   issue was resolved simply does not become a plotted point unless
      //   something else moved the total on it.
      const existingKeys = new Set(list.map((r) => r.jiraKey).filter(Boolean));
      for (const issue of issues) {
        if (existingKeys.has(issue.key)) continue;
        const patch = issueToTaskFields(issue, todayNow);
        // Mint a fresh, session-monotonic id per created row. `next` already holds
        // every kept/pulled/pushed existing task plus rows added earlier in this
        // loop, so each mint sees the growing accumulator and never reuses an id.
        next.push({
          id: mintId("task", next),
          taskName: patch.taskName ?? issue.key,
          assignee: patch.assignee ?? "",
          assigneeEmail: patch.assigneeEmail ?? "",
          dueDate: patch.dueDate ?? "",
          lastUpdateDate: patch.lastUpdateDate ?? todayNow,
          priority: patch.priority ?? "Medium",
          // patch carries Jira's status (invariant-consistent with completedDate below).
          status: patch.status,
          blockers: "",
          description: patch.description ?? "",
          // Taken directly from the patch: a real date only when Jira is done, else
          // undefined — keeping the `status==="Done" ⟺ completedDate set` invariant.
          completedDate: patch.completedDate,
          inquiriesSent: 0,
          group: (() => {
            const proj = jiraProjectKeyOf(issue.key);
            if (proj === jiraCfg.projectKey) return jiraCfg.projectName || jiraCfg.projectKey || "";
            return (jiraCfg.extraProjects ?? []).find((p) => p.key === proj)?.name || proj;
          })(),
          labels: patch.labels ?? [],
          jiraKey: issue.key,
          jiraIssueType: patch.jiraIssueType,
          lastSyncedAt: syncStamp,
        });
        added++;
      }

      tasksRef.current = next;
      setTasks(next);

      args.logActivityAs("integration", "jira.sync", added + pulled, pushed, conflictItems.length);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- args is a new object each render; showToast/logActivityAs are called directly but are stable callbacks; setTasks is a stable WorkspaceContext setter
  }, [args.showToast, args.logActivityAs]);

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
      // Read-only projects never push, even if a stale conflict resolution asks to.
      if (isReadOnlyIssue(conflict.jiraKey, jiraCfg)) continue;

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
          // ★★★ Write BOTH halves of the coupled pair from the side the user
          //   picked. `status` is deliberately not a ConflictFieldKey: offering
          //   it as its own row would let the user pick local for one half and
          //   remote for the other, i.e. construct the split pair by hand.
          //   Taking both from one side inherits the guarantee the pull path
          //   already has — issueToTaskFields derives completedDate and status
          //   from ONE statusKey read, so remoteStatus and the remote date
          //   cannot disagree.
          // ★★ The LOCAL arm is a PASS-THROUGH, not a normaliser, and it does
          //   NOT inherit that guarantee: `merged` is already `{ ...original }`,
          //   so `merged.status = original.status` writes what is already there
          //   — a no-op. This branch therefore re-emits whatever the local row
          //   HOLDS. Rows the local writers produced are consistent
          //   (applyStatusChange by construction, template import since it
          //   started reconciling), but a row that was ALREADY split — an older
          //   build, a hand-edited blob, a pre-fix resolution — survives a local
          //   pick unchanged. Repairing it here is a deliberate deferral rather
          //   than an oversight (open-followups §227).
          // ★★ NOT applyStatusChange here: it would stamp `today` over Jira's
          //   real resolution date, which is why every Jira write site bypasses
          //   that engine. NOT reconcileStatusFromDate either — though not for
          //   the reason once given ("would rewrite a reopened In Progress into
          //   To Do"), which is FALSE: that input falls through both its guards.
          //   It is a strict NO-OP on every Jira patch — it writes `status` only
          //   for a date on a non-Done/non-Cancelled row or a dateless Done,
          //   issueToTaskFields pairs both fields off ONE statusKey read, and
          //   jiraCategoryToStatus never emits Cancelled. The REAL hazard runs
          //   the other way: on the LOCAL arm a stale date beside a non-Done
          //   status is promoted to Done by date-wins — the §227 question.
          merged.status = pick === "local" ? original.status : conflict.remoteStatus;
          completionChanged = true;
        } else if (
          field.key === "taskName" ||
          field.key === "assignee" ||
          field.key === "assigneeEmail" ||
          field.key === "dueDate" ||
          field.key === "priority" ||
          field.key === "description"
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
          // ★★★ Gate on `status`, NOT on `completedDate`. `status` is the
          //   source of truth for "done" (docs/AGENTS/task-status.md), and
          //   `taskFieldsToJiraFields` pushes no status — so this transition is
          //   the ONLY route by which local completion reaches Jira on this
          //   path. Keying it on the date moved a real issue to Done off a
          //   SPLIT local row whose status still read "In Progress"
          //   (open-followups §227). On a consistent pair the two are
          //   equivalent, so this changes nothing for well-formed rows.
          if (completionChanged && merged.status === "Done" && !conflict.remoteDone) {
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

      // ★★★ THE CONFLICT MERGE — one of the five pair-writers listed in
      //   docs/AGENTS/task-status.md ("The five writers, and the mechanism each
      //   holds the pair by"), where it is the THIRD entry.
      //   It is also the site no FILE-granular census could ever catch: a
      //   census asserting "this file calls statusActivityKind somewhere" is
      //   already satisfied by the two pull sites above, so this one could stay
      //   silent forever behind a green run. Its own tests in
      //   use-jira-sync.test.tsx are the only cover. `original` is a real
      //   before-row (the `find` at the top of the loop) and `merged` is the
      //   committed after-row, so this is a genuine transition with both ends
      //   in hand.
      // ★★ OBSERVES the transition; it does not write one. Routing it through
      //   `applyStatusChange` would stamp `today` over the resolution date the
      //   merge just picked — the same prohibition the pull sites carry.
      // ★★ Logged AFTER the write — A CLAIM ABOUT THIS PATH ONLY.
      //   This loop COMMITS PER ITERATION (`setTasks(next)` a
      //   few lines up), so an early `continue` past a log really would strand
      //   an entry describing a row the workspace never received. The two PULL
      //   arms have the opposite shape and log inside their loop on purpose —
      //   see the note at the read-only pull arm for why that is safe there.
      const transition = statusActivityKind(original, merged);
      if (transition) {
        args.logActivityAs("integration", transition, original.id, merged.taskName);
      }
    }

    setJiraConflicts([]);
    jiraConflictsRef.current = [];
    args.showToast(
      "info",
      t(langRef.current, "jiraConflictResolved", resolutions.length, pulled, pushed),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- args is a new object each render; showToast/logActivityAs are called directly but are stable callbacks; setTasks is a stable WorkspaceContext setter
  }, [args.showToast, args.logActivityAs]);

  const clearConflicts = useCallback(() => setJiraConflicts([]), []);

  return { handleJiraSync, handleResolveConflicts, jiraSyncing, jiraConflicts, clearConflicts };
}
