"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ActivityActor, ActivityKind } from "./activity-log";

export type LogActivityFn = (kind: ActivityKind, ...args: (string | number)[]) => void;

/** Actor-aware counterpart to `LogActivityFn`. The actor LEADS because
 *  `logActivity` ends in a rest parameter and nothing can follow it.
 *
 *  ★★★ `ActivityLogContext` CARRIES THIS ONE, and an earlier revision of this
 *  comment argued the opposite — that the context should stay on
 *  `LogActivityFn` because "its two consumers are USER actions, so they must
 *  keep writing actor-less entries". BOTH halves were wrong. Actor-less is not
 *  what a user action wants (`ActivityEntry.actor`'s own doc says an absent
 *  actor means *unknown*, not "user"), and the two consumers do not even share
 *  an actor: `knowledge-links-field-gated.tsx` logs a USER doc-link edit, while
 *  `gantt-view.tsx` forwards this straight into `useTasksDedup`, whose only
 *  entry is `ai.taskDedup`. One actor-less channel served both by naming
 *  neither. Each consumer now names its own. */
export type LogActivityAsFn = (
  actor: ActivityActor,
  kind: ActivityKind,
  ...args: (string | number)[]
) => void;

const ActivityLogContext = createContext<LogActivityAsFn | null>(null);

/** Provides an actor-aware logger to deep components (e.g. document-link
 *  fields) without prop-drilling. Returns null when no provider is mounted
 *  (graceful no-op). */
export function ActivityLogProvider({
  value,
  children,
}: {
  value: LogActivityAsFn;
  children: ReactNode;
}) {
  return <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>;
}

export function useActivityLogger(): LogActivityAsFn | null {
  return useContext(ActivityLogContext);
}
