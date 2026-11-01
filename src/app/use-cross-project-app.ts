// src/app/use-cross-project-app.ts — §785: the app-level wiring of `useCrossProjectPeople`, kept out of
// task-manager (at its size baseline). It turns the project list into a stable `projects` array and a failed
// link write into a toast; the loading and matching live in the hook it wraps.
"use client";
import { useCallback, useMemo } from "react";
import type { Lang } from "./i18n";
import { reportSilentFailure } from "./guard-feedback";
import { useCrossProjectPeople, type CrossProjectDeps, type CrossProjectPeople } from "./use-cross-project-people";

export interface CrossProjectAppDeps extends Omit<CrossProjectDeps, "projects" | "onWriteError"> {
  tursoProjects: readonly { id: string; meta: { name: string } }[];
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useCrossProjectApp({ tursoProjects, lang, showToast, ...deps }: CrossProjectAppDeps): CrossProjectPeople {
  // A fresh array every render would re-mint `request` and break the Resources panel's memo bail.
  const projects = useMemo(() => tursoProjects.map((p) => ({ id: p.id, name: p.meta.name })), [tursoProjects]);
  const onWriteError = useCallback(
    (err: unknown) => reportSilentFailure(showToast, lang, "crossProject.linkWriteFailed", err, "allocElsewhereWriteFailed"),
    [showToast, lang],
  );
  return useCrossProjectPeople({ ...deps, projects, onWriteError });
}
