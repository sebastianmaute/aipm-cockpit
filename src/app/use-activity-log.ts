"use client";

import { useCallback } from "react";
import {
  appendActivity,
  appendActivityEntry,
  type ActivityActor,
  type ActivityEntry,
  type ActivityKind,
  type FieldChange,
} from "./activity-log";
import { useWorkspace } from "./workspace-context";

/** ★★ The log is WORKSPACE state now, not per-device localStorage — this hook
 *  owns no state of its own. It hydrated from and wrote back to
 *  `localStorage["aipm-cockpit:activity-log"]` (`ACTIVITY_STORAGE_KEY` in
 *  `activity-log.ts`) until the activityLog-as-workspace-data
 *  slice; both effects (and the `clearActivityLog` storage wipe in
 *  `handleClearActivityLog`) were REMOVED, because a second writer would fight
 *  the storage backend's own save for the same entries. Persistence is the save
 *  effect in `use-storage-backend.ts`; reconciliation on load is
 *  `mergeActivityLogs`. Do NOT reintroduce a local mirror here. */
export function useActivityLog(): {
  activityLog: readonly ActivityEntry[];
  /** ★ NO `setActivityLog` here — it used to be returned so task-manager could
   *  hand it to `useStorageBackend`, which now reads the slice from
   *  `useWorkspace()` directly. A raw setter on this hook is a second way to
   *  write the log that bypasses `appendActivity`; anything genuinely needing
   *  it takes it from the workspace context. */
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  /** ★★ ACTOR LEADS, and this is a settled precedent rather than a style
   *  choice: `logActivity` ends in a rest parameter, so nothing can follow it.
   *  That is the same constraint that forced `logActivityChanges` to exist as
   *  its own function instead of an options argument.
   *
   *  ★★★ WHO NAMES THE ACTOR — the rule, because "just stamp every call site"
   *  is the wrong answer and was tried first. **The actor is named where it is
   *  KNOWN, and that is not always the leaf.**
   *
   *   - A leaf that hard-codes an `ai.*` kind KNOWS its actor (`use-tasks-dedup`,
   *     `use-alloc-plan`, `use-raci-suggest`, `use-inline-entity-edit`), as does
   *     `useChatDispatcher` / `useDocumentTools` / `useJiraSync` /
   *     `useCalendarIntegrations`. Those take an actor-aware logger and stamp at
   *     the call site.
   *   - A leaf that logs a GENERIC entity kind (`task.updated`, `raid.created`)
   *     does NOT know its actor: the chat dispatcher writes the very same kinds
   *     for the same entities. Stamping `"user"` inside `useResourcePlanner`
   *     would be a guess that happens to be right today. Those leaves keep the
   *     plain `(kind, ...args)` shape and the WIRING decides — `task-manager`
   *     threads `logActivityUser` / `logActivityChangesUser` (below) under the
   *     plain prop names, so every threading site reads `logActivity:
   *     logActivityUser` and the decision is auditable in one file.
   *
   *  ★★ The plain variants therefore still exist and still default to an ABSENT
   *  actor (which is NOT "user" — see the `actor` field doc on `ActivityEntry`),
   *  but after the actor-stamping slice exactly ONE production call site is left
   *  on them: `task-manager`'s debounced `settings.updated` logger, which is
   *  genuinely ambiguous (the AI's `update_settings` tool mutates the same state
   *  and the same effect fires for it). Reproduce the survivors with
   *  `grep -rnE "logActivity(Changes)?(Ref\.current)?\s*\??\.?\s*\(" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -vE "logActivity(Changes)?As"`
   *  — ★★ note the THREE call shapes in that pattern: a bare call, an optional
   *  call (`args.logActivity?.(`) and a ref indirection (`logActivityRef.current(`).
   *  A grep for only the first reported 27 sites when there were 65. */
  logActivityAs: (
    actor: ActivityActor,
    kind: ActivityKind,
    ...args: (string | number)[]
  ) => void;
  logActivityChangesAs: (
    actor: ActivityActor,
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  /** ★★★ PRE-STAMPED `"user"` — the loggers `task-manager` threads into every
   *  entity hook, per the rule above. They live HERE rather than as a local
   *  `useCallback` in task-manager for two reasons: that file sits under the
   *  800-line ratchet at a baseline it cannot grow past, and the wrappers belong
   *  beside the rule that explains them.
   *
   *  ★★ They are NOT a shortcut for "log something". Reach for one only when the
   *  call path is a USER GESTURE all the way down — an effect over state cannot
   *  know that (see the `settings.updated` logger in `task-manager`, the one
   *  production site deliberately left actor-less). A wrongly-stamped entry
   *  corrupts the audit record and nothing can detect it afterwards; an
   *  actor-less one is merely unattributed, which is what absence MEANS. */
  logActivityUser: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChangesUser: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  handleClearActivityLog: () => void;
} {
  const { activityLog, setActivityLog } = useWorkspace();

  // ★ FUNCTIONAL setters, always: two appends in one tick must both survive,
  // and each must produce a NEW array — the save effect's dirty check is
  // reference equality, so an in-place push would silently skip the write.
  const logActivity = useCallback(
    (kind: ActivityKind, ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivity(prev, kind, ...args));
    },
    [setActivityLog],
  );

  // UPDATE-event variant carrying a per-field diff (#22). Separate from
  // logActivity because the shared `(kind, ...args)` signature can't take a
  // trailing options arg after a rest param.
  const logActivityChanges = useCallback(
    (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, changes));
    },
    [setActivityLog],
  );

  // Actor-aware variants. Same functional-setter rule as above — an actor
  // changes WHO the entry names, never HOW it is written.
  const logActivityAs = useCallback(
    (actor: ActivityActor, kind: ActivityKind, ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, undefined, actor));
    },
    [setActivityLog],
  );

  const logActivityChangesAs = useCallback(
    (
      actor: ActivityActor,
      kind: ActivityKind,
      changes: readonly FieldChange[],
      ...args: (string | number)[]
    ) => {
      setActivityLog((prev) => appendActivityEntry(prev, kind, args, changes, actor));
    },
    [setActivityLog],
  );

  // The pre-stamped user pair. Thin wrappers, but they exist so the actor is
  // decided ONCE: an inline `(k, ...a) => logActivityAs("user", k, ...a)` at
  // each of the ~20 threading sites would be twenty places to get wrong, and a
  // fresh identity every render at every one of them.
  const logActivityUser = useCallback(
    (kind: ActivityKind, ...args: (string | number)[]) => logActivityAs("user", kind, ...args),
    [logActivityAs],
  );
  const logActivityChangesUser = useCallback(
    (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) =>
      logActivityChangesAs("user", kind, changes, ...args),
    [logActivityChangesAs],
  );

  const handleClearActivityLog = useCallback(() => {
    // The Clear button (activity-log-panel) is the sole caller; it already
    // gates on entries.length > 0 and shows the branded confirm dialog. This
    // just performs the wipe. (Keeping the confirm here would be dead: the
    // hook runs above ConfirmProvider in the tree, so useConfirm would resolve
    // to the no-op default.)
    setActivityLog([]);
  }, [setActivityLog]);

  return {
    activityLog,
    logActivity,
    logActivityChanges,
    logActivityAs,
    logActivityChangesAs,
    logActivityUser,
    logActivityChangesUser,
    handleClearActivityLog,
  };
}
