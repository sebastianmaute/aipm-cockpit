"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ActivityKind } from "./activity-log";

export type LogActivityFn = (kind: ActivityKind, ...args: (string | number)[]) => void;

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
