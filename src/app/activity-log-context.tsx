"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ActivityActor, ActivityKind } from "./activity-log";

export type LogActivityFn = (kind: ActivityKind, ...args: (string | number)[]) => void;

/** Actor-aware counterpart to `LogActivityFn`. The actor LEADS because
 *  `logActivity` ends in a rest parameter and nothing can follow it.
 *
 *  ★ `ActivityLogContext` itself deliberately stays on `LogActivityFn`: its two
 *  consumers (`gantt-view.tsx`, `knowledge-links-field-gated.tsx`) are USER
 *  actions, so they must keep writing actor-less entries. This type exists for
 *  the non-context call paths (the AI dispatcher and the integration writers)
 *  that thread an actor-aware logger explicitly. */
export type LogActivityAsFn = (
  actor: ActivityActor,
  kind: ActivityKind,
  ...args: (string | number)[]
) => void;

const ActivityLogContext = createContext<LogActivityFn | null>(null);

/** Provides logActivity to deep components (e.g. document-link fields) without
 *  prop-drilling. Returns null when no provider is mounted (graceful no-op). */
export function ActivityLogProvider({
  value,
  children,
}: {
  value: LogActivityFn;
  children: ReactNode;
}) {
  return <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>;
}

export function useActivityLogger(): LogActivityFn | null {
  return useContext(ActivityLogContext);
}
