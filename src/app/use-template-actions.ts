// src/app/use-template-actions.ts
//
// Deps-object hook factory extracted from task-manager.tsx (Phase 3 convention,
// §491). Holds the Save-as-template and Apply-template actions the shell's
// project menu offers: the template list (built-ins plus the user's own, via
// `useTemplates`), capturing the live project as a template, and applying one
// to the current project. It reads the workspace setters and the template
// snapshot builder from context itself, so the deps are `lang` and `showToast`.
// The `useCallback`s keep the exact memoization the code had
// inline. Move-only: no behaviour change.
//
// ★ Coverage-GATED on purpose (not in `coverage.exclude`): apply decides what a
// template changes (it appends the seed only with `includeSeed`, it sets the
// features always)
// and raises the unsafe-email notice, which is real logic. Pinned by
// `use-template-actions.test.tsx`, plus `task-manager.template-notice.test.tsx`
// through the real component.

import { useCallback } from "react";
import { t, type Lang } from "./i18n";
import type { ToastKind } from "./use-toast";
import { useTemplates } from "./use-templates";
import { templateFromWorkspace, type SaveTemplateInput } from "./templates";
import { applyTemplate } from "./template-apply";
import { useCurrentWorkspace } from "./use-current-workspace";
import { ALL_MODULE_IDS } from "./feature-modules";
import { sanitizeFieldVisibility } from "./field-visibility";
import { summarizeUnsafeEmailRecords, templateSeedEmailScope } from "./sanitize";
import { useWorkspace } from "./workspace-context";

export interface TemplateActionsDeps {
  lang: Lang;
  showToast: (kind: ToastKind, text: string) => void;
}

export function useTemplateActions({ lang, showToast }: TemplateActionsDeps) {
  const { features: savedFeatures, setFieldVisibility, setFeatures, setTasks, setMilestones, setRaid, setChanges, setStakeholders, setBudgets } =
    useWorkspace();
  const { templates: projectTemplates, addTemplate } = useTemplates();
  // ★ A snapshot FOR TEMPLATE USE, not the persisted workspace: it leaves out the
  // per-project config a reusable template must not carry (see its own header).
  const buildCurrentWorkspace = useCurrentWorkspace();
  // §779 — a saved template carries the project's SAVED functions (`Workspace.features`), the same
  // source as Settings -> Templates, not a `settings.features` mirror, which another instance can hold
  // stale. `?? ALL_MODULE_IDS` is the legacy-project default `useFeaturesSync` mirrors.
  const features = savedFeatures ?? ALL_MODULE_IDS;

  const handleSaveTemplate = useCallback(
    (input: SaveTemplateInput) => {
      addTemplate(
        templateFromWorkspace(buildCurrentWorkspace(), features, input, crypto.randomUUID()),
      );
      showToast("info", t(lang, "templateSaved"));
    },
    [addTemplate, buildCurrentWorkspace, features, showToast, lang],
  );

  // Apply always sets the template's field visibility AND its features (the pure
  // `applyTemplate` leaves features alone; this hook sets them). With
  // `includeSeed`, the seed records are APPENDED with fresh ids: `applyTemplate`
  // keeps every existing row. The setters trigger the autosave.
  const handleApplyTemplate = useCallback(
    (id: string, opts: { includeSeed: boolean }) => {
      const tpl = projectTemplates.find((x) => x.id === id);
      if (!tpl) return;
      const current = buildCurrentWorkspace();
      const next = applyTemplate(current, tpl, opts);
      // A template's visibility is sanitised when it is loaded or saved, but `updateTemplate` takes
      // a raw patch and this is the one place it enters the workspace: re-run the sanitiser so a
      // stored set can never hide a required field or carry an unknown id.
      setFieldVisibility(sanitizeFieldVisibility(next.fieldVisibility) ?? {});
      // Apply the template's functions to the current project too (reactive via
      // useFeaturesSync, persisted via autosave). Filter through ALL_MODULE_IDS so
      // only valid ids in registry order are set — mirrors creation behavior.
      setFeatures(ALL_MODULE_IDS.filter((id) => tpl.features.includes(id)));
      if (opts.includeSeed) {
        setTasks(next.tasks);
        setMilestones(next.milestones ?? []);
        setRaid(next.raid);
        setChanges(next.changes ?? []);
        setStakeholders(next.stakeholders ?? []);
        setBudgets(next.budgets ?? []);
      }
      showToast("info", t(lang, "templateApplied"));
      const seededEmails = opts.includeSeed ? summarizeUnsafeEmailRecords(templateSeedEmailScope(current, next)) : null;
      if (seededEmails) showToast("info", t(lang, "importUnsafeEmailsNotice", seededEmails.count, seededEmails.names));
    },
    [projectTemplates, buildCurrentWorkspace, setFieldVisibility, setFeatures, setTasks, setMilestones, setRaid, setChanges, setStakeholders, setBudgets, showToast, lang],
  );

  return { projectTemplates, handleSaveTemplate, handleApplyTemplate };
}
