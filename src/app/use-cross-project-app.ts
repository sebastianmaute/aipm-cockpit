// src/app/use-cross-project-app.ts — §785: the app-level wiring of `useCrossProjectPeople`, kept out of
// task-manager (at its size baseline). It turns the project list into a stable `projects` array and a failed
// link write into a toast; the loading and matching live in the hook it wraps.
"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Lang } from "./i18n";
import { reportSilentFailure } from "./guard-feedback";
import { useCrossProjectPeople, type CrossProjectDeps, type CrossProjectPeople } from "./use-cross-project-people";

type ForgetFn = (resourceIds: readonly number[]) => Promise<void>;

/** §788 — lets `useResourcePlanner`, built BEFORE `useCrossProjectApp` (which needs `resources`), report a delete to a
 *  hook that does not exist yet. `notify` is a no-op until `useCrossProjectApp` binds its `forgetPeople`, and again after it unmounts. */
export interface ForgetPeopleBridge {
  notify: (resourceIds: readonly number[]) => void;
  bind: (fn: ForgetFn | null) => void;
}

export function useForgetPeopleBridge(): ForgetPeopleBridge {
  const target = useRef<ForgetFn | null>(null);
  return useMemo(
    () => ({
      notify: (resourceIds) => { void target.current?.(resourceIds); },
      bind: (fn) => { target.current = fn; },
    }),
    [],
  );
}

export interface CrossProjectAppDeps extends Omit<CrossProjectDeps, "projects" | "onWriteError" | "onForgetError"> {
  tursoProjects: readonly { id: string; meta: { name: string } }[];
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
  /** §788: where a deleted person's sweep is wired in (see `useForgetPeopleBridge`). */
  forgetBridge?: ForgetPeopleBridge;
}

export function useCrossProjectApp({ tursoProjects, lang, showToast, forgetBridge, ...deps }: CrossProjectAppDeps): CrossProjectPeople {
  // A fresh array every render would re-mint `request` and break the Resources panel's memo bail.
  const projects = useMemo(() => tursoProjects.map((p) => ({ id: p.id, name: p.meta.name })), [tursoProjects]);
  const onWriteError = useCallback(
    (err: unknown) => reportSilentFailure(showToast, lang, "crossProject.linkWriteFailed", err, "allocElsewhereWriteFailed"),
    [showToast, lang],
  );
  // A failed sweep must not read as a failed answer: the person IS deleted, only their name could not be removed.
  const onForgetError = useCallback(
    (err: unknown) => reportSilentFailure(showToast, lang, "crossProject.forgetFailed", err, "allocElsewhereForgetFailed"),
    [showToast, lang],
  );
  const people = useCrossProjectPeople({ ...deps, projects, onWriteError, onForgetError });
  const { forgetPeople } = people;
  useEffect(() => {
    forgetBridge?.bind(forgetPeople);
    return () => forgetBridge?.bind(null);
  }, [forgetBridge, forgetPeople]);
  return people;
}
