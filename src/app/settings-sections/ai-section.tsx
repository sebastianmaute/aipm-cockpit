"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import type { ChatModel, Settings } from "../settings-types";
import { DEFAULT_SESSION_TOKEN_CAP, DEFAULT_WEEKLY_TOKEN_CAP } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { FieldNotice } from "../field-feedback";
import { AiUsagePanel } from "./ai-usage-panel";
import type { UseOperatingGuidesResult } from "../use-operating-guides";
import type { OperatingGuide, GuideScope } from "../operating-guide";
import { guidesCharCount, GUIDE_CHAR_BUDGET } from "../operating-guide";
import { FEATURE_MODULES } from "../feature-modules";
import type { AppMode, FeatureModuleId } from "../feature-modules";

interface AiSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  operatingGuides?: UseOperatingGuidesResult;
}

function CapInput({
  label,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number | undefined;
  defaultValue: number;
  onChange: (n: number) => void;
}) {
  const displayed = value != null && value > 0 ? value : defaultValue;
  return (
    <label className="mt-2 block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={1}
        step={1}
        value={displayed}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n > 0 ? n : defaultValue);
        }}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
    </label>
  );
}

const APP_MODES: AppMode[] = ["simple", "modular", "advanced"];

interface GuideDraft {
  name: string;
  content: string;
  priority: number;
  scopeModes: AppMode[];
  scopeModules: FeatureModuleId[];
}

function emptyDraft(): GuideDraft {
  return { name: "", content: "", priority: 10, scopeModes: [], scopeModules: [] };
}

function draftFromGuide(g: OperatingGuide): GuideDraft {
  return {
    name: g.name,
    content: g.content,
    priority: g.priority,
    scopeModes: (g.scope.modes ?? []) as AppMode[],
    scopeModules: (g.scope.modules ?? []) as FeatureModuleId[],
  };
}

function draftToScope(draft: GuideDraft): GuideScope {
  return {
    ...(draft.scopeModes.length ? { modes: draft.scopeModes } : {}),
    ...(draft.scopeModules.length ? { modules: draft.scopeModules } : {}),
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

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuideName")}</span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuideContent")}</span>
        <textarea
          value={draft.content}
          rows={6}
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{t(lang, "aiGuidePriority")}</span>
        <input
          type="number"
          min={1}
          step={1}
          value={draft.priority}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange({ ...draft, priority: Number.isFinite(n) && n > 0 ? n : draft.priority });
          }}
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        />
      </label>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">
          {draft.scopeModes.length === 0 && draft.scopeModules.length === 0
            ? t(lang, "aiGuideScopeAny")
            : t(lang, "aiGuideScopeModes")}
        </legend>
        <div className="flex flex-wrap gap-3">
          {APP_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-1 text-xs text-foreground">
              <input
                type="checkbox"
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
              <input
                type="checkbox"
                aria-label={t(lang, m.labelKey)}
                checked={draft.scopeModules.includes(m.id)}
                onChange={() => toggleModule(m.id)}
              />
              {t(lang, m.labelKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={busy || !draft.name.trim()}
          onClick={onSave}
          className="rounded-md border border-line bg-AIPM-green px-3 py-1 text-xs font-medium text-foreground disabled:opacity-50"
        >
          {t(lang, "aiGuideSave")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface"
        >
          {t(lang, "aiGuideCancel")}
        </button>
      </div>
    </div>
  );
}

export function AiSection({ lang, settings, onChange, operatingGuides }: AiSectionProps) {
  const sessionCap = settings.ai.sessionTokenCap ?? DEFAULT_SESSION_TOKEN_CAP;
  const weeklyCap = settings.ai.weeklyTokenCap ?? DEFAULT_WEEKLY_TOKEN_CAP;

  // Guide form state: null = closed, "add" = new guide, string id = editing existing
  const [formMode, setFormMode] = useState<null | "add" | string>(null);
  const [draft, setDraft] = useState<GuideDraft>(emptyDraft);

  const og = operatingGuides;

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

  const overBudget =
    og != null &&
    guidesCharCount(og.guides.filter((g) => g.enabled)) > GUIDE_CHAR_BUDGET;

  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "aiAssistant")}
        <InfoTooltip text={t(lang, "aiAssistantTooltip")} />
      </span>
      <label className="mt-2 block">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t(lang, "aiApiKey")}
          <InfoTooltip text={t(lang, "aiApiKeyTooltip")} />
        </span>
        <input
          type="password"
          autoComplete="off"
          value={settings.ai.apiKey}
          onChange={(e) =>
            onChange({
              ...settings,
              ai: { ...settings.ai, apiKey: e.target.value },
            })
          }
          placeholder={t(lang, "aiApiKeyPlaceholder")}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        />
        <FieldNotice>{t(lang, "credentialStorageNote")}</FieldNotice>
      </label>
      <label className="mt-2 block">
        <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t(lang, "aiModel")}
          <InfoTooltip text={t(lang, "aiModelTooltip")} />
        </span>
        <select
          value={settings.ai.model}
          onChange={(e) =>
            onChange({
              ...settings,
              ai: {
                ...settings.ai,
                model: e.target.value as ChatModel,
              },
            })
          }
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-line focus:outline-none focus:ring-1 focus:ring-AIPM-green"
        >
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-7">Claude Opus 4.7</option>
          <option value="claude-haiku-4-5-20251001">
            Claude Haiku 4.5
          </option>
        </select>
      </label>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(lang, "aiApiKeyHint")}
      </p>
      {settings.ai.consentAccepted ? (
        <p className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>✓ {t(lang, "aiConsentGranted")}</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...settings,
                ai: { ...settings.ai, consentAccepted: false },
              })
            }
            className="text-xs font-medium text-AIPM-pink-strong underline-offset-2 hover:underline"
          >
            {t(lang, "aiConsentRevoke")}
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-AIPM-purple">
          {t(lang, "aiConsentRequired")}
        </p>
      )}

      {/* Token cap inputs */}
      <CapInput
        label={t(lang, "aiSessionCap")}
        value={settings.ai.sessionTokenCap}
        defaultValue={DEFAULT_SESSION_TOKEN_CAP}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, sessionTokenCap: n } })
        }
      />
      <CapInput
        label={t(lang, "aiWeeklyCap")}
        value={settings.ai.weeklyTokenCap}
        defaultValue={DEFAULT_WEEKLY_TOKEN_CAP}
        onChange={(n) =>
          onChange({ ...settings, ai: { ...settings.ai, weeklyTokenCap: n } })
        }
      />

      {/* Live usage bars — sourced from AiUsageProvider */}
      <AiUsagePanel lang={lang} sessionCap={sessionCap} weeklyCap={weeklyCap} />

      {/* Operating guides */}
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-sm font-medium text-foreground">{t(lang, "aiGuidesHeading")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(lang, "aiGuidesDesc")}</p>

        {/* Master toggle */}
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
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
              <p className="mt-2 text-xs text-AIPM-pink-strong">
                {t(lang, "aiGuideBudgetWarning")}
              </p>
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
                        <input
                          type="checkbox"
                          aria-label={`${t(lang, "aiGuideEnabled")} – ${g.name}`}
                          checked={g.enabled}
                          onChange={() => { void og.update({ ...g, enabled: !g.enabled }); }}
                        />
                        {t(lang, "aiGuideEnabled")}
                      </label>
                      <button
                        type="button"
                        aria-label={`${t(lang, "aiGuideEdit")} – ${g.name}`}
                        onClick={() => openEdit(g)}
                        className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-foreground"
                      >
                        {t(lang, "aiGuideEdit")}
                      </button>
                      {!g.builtIn && (
                        <button
                          type="button"
                          aria-label={`${t(lang, "aiGuideDelete")} – ${g.name}`}
                          onClick={() => { void og.remove(g.id); }}
                          className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-AIPM-pink-strong"
                        >
                          {t(lang, "aiGuideDelete")}
                        </button>
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
              <button
                type="button"
                onClick={openAdd}
                className="mt-3 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground"
              >
                {t(lang, "aiGuideAdd")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
