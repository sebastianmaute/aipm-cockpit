"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityKind } from "./activity-log";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Settings } from "./settings-menu";
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
  lang: string;
  showToast: (kind: "info" | "error", text: string) => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useJiraSync(args: UseJiraSyncArgs) {
  const { tasks, setTasks } = useWorkspace();

  // Reactive values behind refs so stable useCallbacks never go stale
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(args.settings);
  const langRef = useRef(args.lang);
  const todayRef = useRef(args.today);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { todayRef.current = args.today; }, [args.today]);

  // Owned state
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);

  // Ref guards for stable callbacks (avoid stale closures on boolean/array state)
  const jiraSyncingRef = useRef(false);
  const jiraConflictsRef = useRef(jiraConflicts);
  useEffect(() => { jiraConflictsRef.current = jiraConflicts; }, [jiraConflicts]);
  useEffect(() => { jiraSyncingRef.current = jiraSyncing; }, [jiraSyncing]);

  const handleJiraSync = useCallback(async () => {
    // TODO: implement in Tasks 4 + 6
  }, [args.showToast, args.logActivity]);

  const handleResolveConflicts = useCallback(async (_resolutions: ConflictResolution[]) => {
    // TODO: implement in Task 8
  }, [args.showToast, args.logActivity]);

  const clearConflicts = useCallback(() => setJiraConflicts([]), []);

  return { handleJiraSync, handleResolveConflicts, jiraSyncing, jiraConflicts, clearConflicts };
}
