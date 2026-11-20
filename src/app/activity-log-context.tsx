"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ActivityKind, HumanActor } from "./activity-log";
import type { AiOrigin } from "./activity-origin";

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
  actor: HumanActor,
  kind: ActivityKind,
  ...args: (string | number)[]
) => void;

/** §799 — the AI counterpart: the origin LEADS and is REQUIRED, so an AI feature cannot log without naming
 *  itself. Stamps `actor: "ai"` plus that origin. */
export type LogActivityAiFn = (origin: AiOrigin, kind: ActivityKind, ...args: (string | number)[]) => void;

const ActivityLogContext = createContext<LogActivityAsFn | null>(null);
const ActivityLogAiContext = createContext<LogActivityAiFn | null>(null);

/** Provides an actor-aware logger to deep components (e.g. document-link
 *  fields) without prop-drilling. Returns null when no provider is mounted
 *  (graceful no-op). */
export function ActivityLogProvider({
  value,
  ai,
  children,
}: {
  value: LogActivityAsFn;
  ai?: LogActivityAiFn;
  children: ReactNode;
}) {
  return (
    <ActivityLogContext.Provider value={value}>
      <ActivityLogAiContext.Provider value={ai ?? null}>{children}</ActivityLogAiContext.Provider>
    </ActivityLogContext.Provider>
  );
}

/** The AI logger, for a deep AI surface (the Gantt's dedup). Null when no provider supplies one. */
export function useActivityLoggerAi(): LogActivityAiFn | null {
  return useContext(ActivityLogAiContext);
}

export function useActivityLogger(): LogActivityAsFn | null {
  return useContext(ActivityLogContext);
}
