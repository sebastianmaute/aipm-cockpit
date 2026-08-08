"use client";

// Operating-guides CRUD, extracted from ai-section.tsx. It moved because that
// file sat at 782 lines against the 800-line ratchet (`size:check` counts
// `wc -l` + 1), leaving no room for the button-primitive conversions.
//
// The `aiGroundInGuides` toggle moved WITH the guides — it is what makes them
// take effect. The action-suggestion and insight-recommendation toggles that
// sat under the same heading did NOT: they are unrelated AI settings that were
// mis-grouped, and they stay in ai-section.tsx.

import { useState } from "react";
import { type Lang, t } from "../i18n";
import { type Settings } from "../settings-types";
import { Banner } from "../banner";
import { FieldHint } from "../field-hint";
import { Button } from "../button";
import { Checkbox, Input, Textarea } from "../form-controls";
import type { UseOperatingGuidesResult } from "../use-operating-guides";
import type { OperatingGuide, GuideScope } from "../operating-guide";
import { guidesCharCount, GUIDE_CHAR_BUDGET } from "../operating-guide";
import { FEATURE_MODULES } from "../feature-modules";
import type { AppMode, FeatureModuleId } from "../feature-modules";
import { allNavViews, navLabelKey, type AppView } from "../nav-config";

interface AiGuidesSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  operatingGuides?: UseOperatingGuidesResult;
}

const APP_MODES: AppMode[] = ["simple", "modular", "advanced"];
const SCOPE_VIEWS: AppView[] = allNavViews();

interface GuideDraft {
  name: string;
  content: string;
  priority: number;
  scopeModes: AppMode[];
  scopeModules: FeatureModuleId[];
  scopeViews: AppView[];
}

function emptyDraft(): GuideDraft {
  return { name: "", content: "", priority: 10, scopeModes: [], scopeModules: [], scopeViews: [] };
}

function draftFromGuide(g: OperatingGuide): GuideDraft {
  return {
    name: g.name,
    content: g.content,
    priority: g.priority,
    scopeModes: (g.scope.modes ?? []) as AppMode[],
    scopeModules: (g.scope.modules ?? []) as FeatureModuleId[],
    scopeViews: (g.scope.views ?? []) as AppView[],
  };
}

function draftToScope(draft: GuideDraft): GuideScope {
  return {
    ...(draft.scopeModes.length ? { modes: draft.scopeModes } : {}),
    ...(draft.scopeModules.length ? { modules: draft.scopeModules } : {}),
    ...(draft.scopeViews.length ? { views: draft.scopeViews } : {}),
  };
}

interface GuideFormProps {
  lang: Lang;
  draft: GuideDraft;
  onChange: (d: GuideDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}

function GuideForm({ lang, draft, onChange, onSave, onCancel, busy }: GuideFormProps) {
  function toggleMode(mode: AppMode) {
    const next = draft.scopeModes.includes(mode)
      ? draft.scopeModes.filter((m) => m !== mode)
      : [...draft.scopeModes, mode];
    onChange({ ...draft, scopeModes: next });
  }

  function toggleModule(id: FeatureModuleId) {
    const next = draft.scopeModules.includes(id)
      ? draft.scopeModules.filter((m) => m !== id)
      : [...draft.scopeModules, id];
    onChange({ ...draft, scopeModules: next });
  }

  function toggleView(view: AppView) {
    const next = draft.scopeViews.includes(view)
      ? draft.scopeViews.filter((v) => v !== view)
      : [...draft.scopeViews, view];
    onChange({ ...draft, scopeViews: next });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuideName")}</span>
        <Input
          type="text"
          size="xs"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="w-full"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuideContent")}</span>
        <Textarea
          value={draft.content}
          rows={6}
          size="xs"
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          className="w-full"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuidePriority")}</span>
        <Input
          type="number"
          size="xs"
          min={1}
          step={1}
          value={draft.priority}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ ...draft, priority: Number.isFinite(n) && n > 0 ? n : draft.priority });
          }}
          className="w-24"
        />
      </label>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">
          {draft.scopeModes.length === 0 &&
          draft.scopeModules.length === 0 &&
          draft.scopeViews.length === 0
            ? t(lang, "aiGuideScopeAny")
            : t(lang, "aiGuideScopeModes")}
        </legend>
        <div className="flex flex-wrap gap-3">
          {APP_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-1 text-xs text-foreground">
              <Checkbox
                aria-label={mode}
                checked={draft.scopeModes.includes(mode)}
                onChange={() => toggleMode(mode)}
              />
              {mode}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">{t(lang, "aiGuideScopeModules")}</legend>
        <div className="flex flex-wrap gap-3">
          {FEATURE_MODULES.map((m) => (
            <label key={m.id} className="flex items-center gap-1 text-xs text-foreground">
              <Checkbox
                aria-label={t(lang, m.labelKey)}
                checked={draft.scopeModules.includes(m.id)}
                onChange={() => toggleModule(m.id)}
              />
              {t(lang, m.labelKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">{t(lang, "aiGuideScopeViews")}</legend>
        <div className="flex flex-wrap gap-3">
          {SCOPE_VIEWS.map((view) => (
            <label key={view} className="flex items-center gap-1 text-xs text-foreground">
              <Checkbox
                aria-label={t(lang, navLabelKey(view))}
                checked={draft.scopeViews.includes(view)}
                onChange={() => toggleView(view)}
              />
              {t(lang, navLabelKey(view))}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-1 flex gap-2">
        <Button size="xs" disabled={busy || !draft.name.trim()} onClick={onSave}>
          {t(lang, "aiGuideSave")}
        </Button>
        <Button size="xs" variant="secondary" onClick={onCancel}>
          {t(lang, "aiGuideCancel")}
        </Button>
      </div>
    </div>
  );
}

export function AiGuidesSection({ lang, settings, onChange, operatingGuides }: AiGuidesSectionProps) {
  // Guide form state: null = closed, "add" = new guide, string id = editing existing
  const [formMode, setFormMode] = useState<null | "add" | string>(null);
  const [draft, setDraft] = useState<GuideDraft>(emptyDraft);
  const og = operatingGuides;

  const overBudget =
    og != null &&
    guidesCharCount(og.guides.filter((g) => g.enabled)) > GUIDE_CHAR_BUDGET;

  function openAdd() {
    setDraft(emptyDraft());
    setFormMode("add");
  }

  function openEdit(g: OperatingGuide) {
    setDraft(draftFromGuide(g));
    setFormMode(g.id);
  }

  function closeForm() {
    setFormMode(null);
  }

  async function handleSave() {
    if (!og) return;
    if (formMode === "add") {
      await og.create(draft.name.trim(), draft.content, {
        priority: draft.priority,
        scope: draftToScope(draft),
      });
    } else if (formMode !== null) {
      const existing = og.guides.find((g) => g.id === formMode);
      if (existing) {
        await og.update({
          ...existing,
          name: draft.name.trim(),
          content: draft.content,
          priority: draft.priority,
          scope: draftToScope(draft),
        });
      }
    }
    closeForm();
  }

  // DECISION A: the guides UI lived inside ai-section's
  // `settings.ai.enabled === true &&` fragment, so it was invisible whenever
  // the AI master switch was off. Promoting it to its own rail section would
  // have rendered it unconditionally — a silent behaviour change. The gate
  // moves with it, and the rail entry stays visible either way (a child that
  // could vanish while active would need stale-active coercion).
  // The message is `aiDisabledSectionHint`, not the master switch's own
  // `aiEnableHelp`: this pane contains no toggle, so "Turn on to use …" is an
  // instruction with no target here. The new string names Settings → AI
  // Assistant. Gate behaviour is unchanged.
  if (settings.ai.enabled !== true) {
    return <FieldHint>{t(lang, "aiDisabledSectionHint")}</FieldHint>;
  }

  return (
    <div>
      <FieldHint>{t(lang, "aiGuidesDesc")}</FieldHint>

      {/* Master toggle */}
      <label className="mt-3 flex items-center gap-2">
        <Checkbox
          aria-label={t(lang, "aiGroundInGuides")}
          checked={settings.ai.groundInGuides}
          onChange={() =>
            onChange({
              ...settings,
              ai: { ...settings.ai, groundInGuides: !settings.ai.groundInGuides },
            })
          }
        />
        <span className="text-xs text-foreground">{t(lang, "aiGroundInGuides")}</span>
      </label>

      {og != null && (
        <>
          {overBudget && (
            <Banner severity="error" className="mt-2">
              {t(lang, "aiGuideBudgetWarning")}
            </Banner>
          )}

          {/* Guide list */}
          <ul className="mt-3 flex flex-col gap-2">
            {og.guides.map((g) => (
              <li key={g.id} className="rounded-md border border-line bg-surface p-2">
                {formMode === g.id ? (
                  <GuideForm
                    lang={lang}
                    draft={draft}
                    onChange={setDraft}
                    onSave={() => { void handleSave(); }}
                    onCancel={closeForm}
                    busy={og.busy}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-xs font-medium text-foreground">{g.name}</span>
                    {g.builtIn && (
                      <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-line">
                        {t(lang, "aiGuideBuiltInBadge")}
                      </span>
                    )}
                    <label className="flex items-center gap-1 text-xs text-foreground">
                      <Checkbox
                        aria-label={`${t(lang, "aiGuideEnabled")} – ${g.name}`}
                        checked={g.enabled}
                        onChange={() => { void og.update({ ...g, enabled: !g.enabled }); }}
                      />
                      {t(lang, "aiGuideEnabled")}
                    </label>
                    {/* Row-UNIQUE accessible names. N identical "Edit"/"Delete"
                        names is a WCAG 2.4.6 failure the axe gate passes
                        whenever the seed renders a single row. */}
                    <Button
                      size="xs"
                      variant="secondary"
                      aria-label={`${t(lang, "aiGuideEdit")} – ${g.name}`}
                      onClick={() => openEdit(g)}
                    >
                      {t(lang, "aiGuideEdit")}
                    </Button>
                    {!g.builtIn && (
                      <Button
                        size="xs"
                        variant="destructive"
                        aria-label={`${t(lang, "aiGuideDelete")} – ${g.name}`}
                        onClick={() => { void og.remove(g.id); }}
                      >
                        {t(lang, "aiGuideDelete")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Add guide */}
          {formMode === "add" ? (
            <GuideForm
              lang={lang}
              draft={draft}
              onChange={setDraft}
              onSave={() => { void handleSave(); }}
              onCancel={closeForm}
              busy={og.busy}
            />
          ) : (
            <Button size="xs" variant="secondary" className="mt-3" onClick={openAdd}>
              {t(lang, "aiGuideAdd")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
