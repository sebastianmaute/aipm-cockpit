"use client";

import { useCallback, useMemo } from "react";
import { useSettings } from "./use-settings";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import type { ProjectTemplate } from "./templates";

/** Generate a new template id, preferring crypto.randomUUID (the create-project
 *  convention) with a deterministic fallback for environments without it. */
function newTemplateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Thin convenience hook over settings: merges the immutable in-code built-in
 * templates with the user's saved templates, and exposes CRUD that writes user
 * templates through the settings setter (which persists to localStorage).
 *
 * Built-ins are immutable: update/remove operate only on `userTemplates`, so a
 * built-in id is simply never found = a no-op. `duplicateTemplate` is the path
 * to make an editable copy of a built-in.
 */
export function useTemplates() {
  const { settings, setSettings } = useSettings();
  const userTemplates = useMemo(
    () => settings.templates ?? [],
    [settings.templates],
  );
  const templates = useMemo(
    () => [...BUILT_IN_TEMPLATES, ...userTemplates],
    [userTemplates],
  );

  const writeUser = useCallback(
    (update: (prev: ProjectTemplate[]) => ProjectTemplate[]) =>
      setSettings((prev) => ({
        ...prev,
        templates: update(prev.templates ?? []),
      })),
    [setSettings],
  );

  const addTemplate = useCallback(
    (t: ProjectTemplate) =>
      writeUser((prev) => [...prev, { ...t, builtIn: false }]),
    [writeUser],
  );

  const updateTemplate = useCallback(
    (id: string, patch: Partial<ProjectTemplate>) =>
      writeUser((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, ...patch, id: t.id, builtIn: false } : t,
        ),
      ),
    [writeUser],
  );

  const removeTemplate = useCallback(
    (id: string) => writeUser((prev) => prev.filter((t) => t.id !== id)),
    [writeUser],
  );

  const duplicateTemplate = useCallback(
    (id: string) => {
      const src = [...BUILT_IN_TEMPLATES, ...userTemplates].find(
        (t) => t.id === id,
      );
      if (!src) return;
      const copy: ProjectTemplate = {
        ...src,
        id: newTemplateId(),
        name: `${src.name} copy`,
        builtIn: false,
      };
      writeUser((prev) => [...prev, copy]);
    },
    [userTemplates, writeUser],
  );

  return {
    templates,
    userTemplates,
    addTemplate,
    updateTemplate,
    removeTemplate,
    duplicateTemplate,
  };
}
