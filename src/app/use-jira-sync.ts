"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import { formatExpiryDate } from "./date-format";
import { type Lang, t, tPlural } from "./i18n";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Settings } from "./settings-types";
import type { Task } from "./types";
import { daysUntil } from "./jira-token-status";
import { isReadOnlyIssue, jiraProjectKeyOf } from "./jira-projects";
import { mintId } from "./id-mint-session";
import { lazyRetryOnReject } from "./lazy-retry";
import { logDiag } from "./diagnostics";
import { dropStaleScopeWrite, isScopeStale, type ScopeEpochReader } from "./scope-epoch";
import { statusActivityKind } from "./task-status";
import { useWorkspace } from "./workspace-context";

// ── Lazy-load cache ──────────────────────────────────────────────────────────
type JiraApiModule = typeof import("./jira-api");
// A rejected import (chunk-download failure) is NOT cached — the next call retries.
const loadJiraApiOnce = lazyRetryOnReject<JiraApiModule>(() => import("./jira-api"));
export function loadJiraApi(): Promise<JiraApiModule> {
  return loadJiraApiOnce();
}

/** The jira-api chunk failed to download. The raw browser message can carry a chunk URL, so it
 *  goes to diagnostics only; the caller shows the returned translated message however its
 *  surface reports errors (toast, status line). The next `loadJiraApi()` retries. One helper
 *  for every load site (settings, Push to Jira, sync, conflict resolution). */
export function reportModuleLoadFailed(lang: Lang, err: unknown): string {
  logDiag("error", "jira.moduleLoadFailed", { message: err instanceof Error ? err.message : String(err) });
  return t(lang, "jiraModuleLoadFailed");
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
  /** §667 — the §548 scope epoch reader (`getScopeEpoch` from `useStorageBackend`). Sync and
   *  conflict resolution await Jira and then write tasks, so a project swap in between would write
   *  the previous project's rows into the next one. REQUIRED here, as at every boundary that hands
   *  the reader down (docs/AGENTS/platform.md, "The load hold"): an optional one that nobody threads
   *  silently restores the unguarded behaviour. A test opts out by passing a constant reader. */
  getScopeEpoch: ScopeEpochReader;
}

type ActivityTransition = NonNullable<ReturnType<typeof statusActivityKind>>;

/** Stable empty queue, so hiding stale conflicts does not hand the modal a new array each render. */
const NO_CONFLICTS: ConflictItem[] = [];

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
  const [jiraResolving, setJiraResolving] = useState(false);
  const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);

  // Ref guards for stable callbacks (avoid stale closures on boolean/array state)
  // ★ ONE in-flight guard for sync AND conflict resolution, naming which one holds it. Separate
  //   guards let them overlap: a sync started mid-resolution could queue new conflicts that the
  //   resolution's closing `setJiraConflicts([])` then wiped. Whichever starts second is a no-op.
  // ★ No effect mirrors `jiraSyncing` / `jiraResolving` into this ref: each handler writes both
  //   itself. A mirror effect would run AFTER the render of a finished run, and if a new run had
  //   already taken the guard by then it would clear it under that run and let a third click through.
  const jiraInFlightRef = useRef<"sync" | "resolve" | null>(null);
  const jiraConflictsRef = useRef(jiraConflicts);
  useEffect(() => { jiraConflictsRef.current = jiraConflicts; }, [jiraConflicts]);
  // §667 — the scope epoch the queued conflicts were computed in. A resolution writes against THAT
  // project, not whichever one is in scope when the user clicks Apply, so it is checked against
  // this value rather than a fresh read (the chat panel's staged proposals carry theirs the same way).
  // The ref serves the callbacks; the state copy serves the render below, which may not read a ref.
  const jiraConflictsEpochRef = useRef<number | undefined>(undefined);
  const [jiraConflictsEpoch, setJiraConflictsEpoch] = useState<number | undefined>(undefined);
  // §667 — conflicts queued in a project that has since left are not shown. `useJiraSync` lives in
  // `task-manager.tsx`, which the load hold does not unmount, so its queue outlives a swap, and the
  // conflicts modal would come back after the hold showing the previous project's rows. DERIVED,
  // not cleared: no effect may set state here (`set-state-in-effect`), and the epoch reader is not
  // a render value. Reading it during render is still current, because every epoch bump is
  // immediately followed by the replacement of `tasks`, which this hook reads from the workspace,
  // so the swap itself re-renders the hook. The stale queue stays in state until the next sync
  // replaces it or a resolution drops it; nothing can reach it meanwhile.
  const visibleConflicts = isScopeStale(args.getScopeEpoch, jiraConflictsEpoch) ? NO_CONFLICTS : jiraConflicts;

  const handleJiraSync = useCallback(async () => {
    if (jiraInFlightRef.current !== null) return;
    const jiraCfg = settingsRef.current.jira;
    if (!jiraCfg.enabled) return;
    if (jiraCfg.tokenExpiresAt) {
      const d = daysUntil(jiraCfg.tokenExpiresAt, todayRef.current);
      if (d !== null && d < 0) {
        args.showToast("info", t(langRef.current, "jiraTokenExpiredBanner", formatExpiryDate(jiraCfg.tokenExpiresAt, langRef.current)));
        return;
      }
    }
    // ★ The in-flight guard is taken HERE, synchronously, before the first await. Taken after the
    //   module load, two clicks during a slow chunk download both passed the check above and ran
    //   two syncs. Every exit from here on releases it: the load-failure return below, and the
    //   `finally` of the main try, which also covers the no-scope and stale-scope returns.
    //   `jiraSyncing` goes up with it, so both "Sync with Jira" buttons show the syncing state
    //   during the download too, and comes down on the same two exits.
    jiraInFlightRef.current = "sync";
    setJiraSyncing(true);
    // §667 — captured before the first await, as every §548 writer does. No `loadPending` start
    // gate: both sync buttons live in the main-window tree, which the render hold replaces with
    // `PanelSkeleton`, so no sync can START during a hold (scope-epoch.ts, "the start gate").
    const startEpoch = args.getScopeEpoch();
    let api: JiraApiModule;
    try {
      api = await loadJiraApi();
    } catch (err) {
      jiraInFlightRef.current = null;
      setJiraSyncing(false);
      args.showToast("error", reportModuleLoadFailed(langRef.current, err));
      return;
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
    } = api;
    try {
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
      const issues = await searchAllIssues(creds, jql);
      // The token verdict is device settings, true whichever project is now in scope.
      onJiraAuthResultRef.current?.(true);
      // §667 — `tasksRef` below is read NOW, so after a swap it would be the next project's list
      // diffed against this project's issues. Dropped silently, per the §548 convention.
      if (dropStaleScopeWrite(args.getScopeEpoch, startEpoch, "useJiraSync.sync", { at: "search" })) return;
      const issueByKey = new Map(issues.map((i) => [i.key, i]));
      const todayNow = todayRef.current;
      const syncStamp = new Date().toISOString();
      const list = tasksRef.current;

      let added = 0;
      let pulled = 0;
      let pushed = 0;
      let pushErrors = 0;
      const conflictItems: ConflictItem[] = [];
      // Status transitions the two pull arms observe, logged after the commit (see the note there).
      const transitions: Array<[ActivityTransition, number, string]> = [];

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
            // ★★ BUFFERED, NOT LOGGED HERE. An earlier revision logged inside
            // the loop and argued that was safe because nothing could abandon
            // the batch between here and the single `setTasks(next)` after the
            // loop — and said to buffer the day an early return appeared. §667
            // added one: the push arm awaits Jira, a project swap can land
            // during it, and the stale-scope check before the commit then drops
            // the whole batch. A transition logged here would reach the NEXT
            // project's activity log for a row it never received. The buffer
            // is emitted right after the commit and before the `jira.sync`
            // summary, so the audit trail keeps its order.
            const transition = statusActivityKind(row, { completedDate: patch.completedDate });
            if (transition) {
              transitions.push([transition, row.id, patch.taskName ?? row.taskName]);
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
          // Jira's real resolution date with `today`); and buffer it for after
          // the commit — the note there carries the reason.
          const transition = statusActivityKind(row, { completedDate: patch.completedDate });
          if (transition) {
            transitions.push([transition, row.id, patch.taskName ?? row.taskName]);
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

      // §667 — the push arm above awaits Jira per row, so the scope can move during the loop too.
      // The pushes already sent are not undone; their rows' sync stamps are dropped with the rest,
      // so the next sync in that project pushes them again (an idempotent field update).
      if (dropStaleScopeWrite(args.getScopeEpoch, startEpoch, "useJiraSync.sync", { at: "commit" })) return;

      tasksRef.current = next;
      setTasks(next);

      for (const [kind, id, name] of transitions) {
        args.logActivityAs("integration", kind, id, name);
      }
      args.logActivityAs("integration", "jira.sync", added + pulled, pushed, conflictItems.length);

      const summary = tPlural(langRef.current, "jiraSyncDoneFull", issues.length, issues.length, added, pulled, pushed);
      if (conflictItems.length > 0) {
        jiraConflictsEpochRef.current = startEpoch;
        setJiraConflictsEpoch(startEpoch);
        setJiraConflicts(conflictItems);
        args.showToast(
          "info",
          summary +
            " " +
            tPlural(langRef.current, "jiraSyncConflictsReview", conflictItems.length, conflictItems.length),
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
      jiraInFlightRef.current = null;
      setJiraSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- args is a new object each render; showToast/logActivityAs/getScopeEpoch are called directly but are stable callbacks; setTasks is a stable WorkspaceContext setter
  }, [args.showToast, args.logActivityAs, args.getScopeEpoch]);

  const resolveConflicts = useCallback(async (resolutions: ConflictResolution[]) => {
    const jiraCfg = settingsRef.current.jira;
    // §667 — the epoch the conflicts were computed in, read before the first await.
    const startEpoch = jiraConflictsEpochRef.current;
    // A stale resolution's conflicts belong to the project that left: drop them (hook state, not
    // workspace), which also closes the modal, and skip the summary toast. Silent, per §548.
    const dropStale = (at: string): boolean => {
      if (!dropStaleScopeWrite(args.getScopeEpoch, startEpoch, "useJiraSync.resolve", { at })) return false;
      setJiraConflicts([]);
      jiraConflictsRef.current = [];
      return true;
    };
    // On a failed download nothing has been written and the conflicts stay, so the user can retry.
    let api: JiraApiModule;
    try {
      api = await loadJiraApi();
    } catch (err) {
      args.showToast("error", reportModuleLoadFailed(langRef.current, err));
      return;
    }
    const {
      updateIssue,
      taskFieldsToJiraFields,
      transitionIssueTo,
      formatJiraError,
    } = api;
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
      // Before the lookup and any push: after a swap `tasksRef` holds the next project's rows, and
      // an id match there would push that row's fields to this project's Jira issue.
      if (dropStale("push")) return;
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
      // The push above awaited Jira, so the scope can have moved since the check at the loop top.
      if (dropStale("commit")) return;
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
      tPlural(langRef.current, "jiraConflictResolved", resolutions.length, resolutions.length, pulled, pushed),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- args is a new object each render; showToast/logActivityAs/getScopeEpoch are called directly but are stable callbacks; setTasks is a stable WorkspaceContext setter
  }, [args.showToast, args.logActivityAs, args.getScopeEpoch]);

  // The conflicts modal stays open until a resolution finishes, so a second Resolve click during
  // the module load or the pushes would run a second resolution and push every row twice. The
  // shared guard is taken before the first await and released however the run ends; a sync in
  // flight refuses the resolution the same way.
  const handleResolveConflicts = useCallback(async (resolutions: ConflictResolution[]) => {
    if (jiraInFlightRef.current !== null) return;
    jiraInFlightRef.current = "resolve";
    setJiraResolving(true);
    try {
      await resolveConflicts(resolutions);
    } finally {
      jiraInFlightRef.current = null;
      setJiraResolving(false);
    }
  }, [resolveConflicts]);

  // Every way out of the conflicts modal (Cancel, ✕, Escape, backdrop) lands here, so a resolution
  // in flight is protected at this one place: closing mid-run would hide its outcome and let the
  // user start a sync whose new conflicts the resolution's closing clear would then wipe. `Modal`
  // already handles an `onClose` that does not close (docs/AGENTS/ui-shell.md, dismissal).
  const clearConflicts = useCallback(() => {
    if (jiraInFlightRef.current === "resolve") return;
    setJiraConflicts([]);
  }, []);

  return { handleJiraSync, handleResolveConflicts, jiraSyncing, jiraResolving, jiraConflicts: visibleConflicts, clearConflicts };
}
