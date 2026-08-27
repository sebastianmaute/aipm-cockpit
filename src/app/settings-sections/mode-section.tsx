"use client";

import { useId, useState } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import {
  ALL_MODULE_IDS,
  FEATURE_MODULES,
  type FeatureModuleId,
  deriveMode,
} from "../feature-modules";
import {
  MAX_VERSION_RETENTION,
  MIN_VERSION_RETENTION,
  VERSION_RETENTION_STEP,
  sanitizeVersionRetention,
} from "../version-history";
import { INTERACTIVE } from "../interaction-styles";
import { Checkbox, Input } from "../form-controls";
import { FieldHint } from "../field-hint";

interface ModeSectionProps {
  lang: Lang;
  settings: Settings;
  /** Called only on explicit Save; the parent writes the per-project features (synced reactively, no reload). */
  onCommitFeatures: (features: FeatureModuleId[]) => void;
  /** Live settings patch (version-history retention saves immediately, unlike feature modules). */
  onChange: (s: Settings) => void;
}

function sameSet(a: readonly FeatureModuleId[], b: readonly FeatureModuleId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

const MODE_LABEL_KEY = {
  simple: "modeSimple",
  modular: "modeModular",
  advanced: "modeAdvanced",
} as const;

export function ModeSection({ lang, settings, onCommitFeatures, onChange }: ModeSectionProps) {
  const saved = settings.features;
  const [draft, setDraft] = useState<FeatureModuleId[]>(saved);
  // Namespace the per-module checkbox + description ids so two concurrent mounts
  // (e.g. a settings pop-out beside the main window) can't collide.
  const idBase = useId();

  const mode = deriveMode(draft);
  const dirty = !sameSet(draft, saved);
  // One-directional: warn only when the draft drops a saved module (not when adding).
  const removesModules = saved.some((id) => !draft.includes(id));

  const toggle = (id: FeatureModuleId) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "settingsSectionMode")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "modeIntro")}</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t(lang, "modeBadgeLabel")}:</span>
        <span
          data-testid="mode-badge"
          className="rounded-full bg-ui-green/15 px-3 py-1 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey"
        >
          {t(lang, MODE_LABEL_KEY[mode])}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={t(lang, "modeApplySimplePreset")}
          onClick={() => setDraft([])}
          className={`rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "modePresetSimple")}
        </button>
        <button
          type="button"
          aria-label={t(lang, "modeApplyAdvancedPreset")}
          onClick={() => setDraft([...ALL_MODULE_IDS])}
          className={`rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "modePresetAdvanced")}
        </button>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          {t(lang, "modeModulesHeading")}
        </legend>
        {FEATURE_MODULES.map((m) => (
          <div key={m.id} className="flex items-start gap-2 text-sm">
            <Checkbox
              id={`${idBase}-${m.id}`}
              checked={draft.includes(m.id)}
              onChange={() => toggle(m.id)}
              aria-describedby={m.descKey ? `${idBase}-desc-${m.id}` : undefined}
              className="mt-0.5 shrink-0"
            />
            <span className="flex flex-col">
              <label htmlFor={`${idBase}-${m.id}`} className="font-medium">
                {t(lang, m.labelKey)}
              </label>
              {m.descKey && (
                <FieldHint as="span" id={`${idBase}-desc-${m.id}`}>
                  {t(lang, m.descKey)}
                </FieldHint>
              )}
            </span>
          </div>
        ))}
      </fieldset>

      {removesModules && (
        <p className="rounded-md bg-[var(--rag-amber)]/20 px-3 py-2 text-xs text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "modeRetentionNote")}
        </p>
      )}

      <div className="border-t border-line pt-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <span className="font-medium">{t(lang, "versionRetentionLabel")}</span>
          <Input
            size="xs"
            type="number"
            min={MIN_VERSION_RETENTION}
            max={MAX_VERSION_RETENTION}
            step={VERSION_RETENTION_STEP}
            aria-label={t(lang, "versionRetentionLabel")}
            value={settings.versionHistoryRetention ?? MIN_VERSION_RETENTION}
            onChange={(e) =>
              onChange({
                ...settings,
                versionHistoryRetention: sanitizeVersionRetention(e.target.value),
              })
            }
            className="w-20 text-right tabular-nums"
          />
          <span className="text-xs text-muted-foreground">{t(lang, "versionRetentionUnit")}</span>
        </label>
        <FieldHint className="mt-1">{t(lang, "versionRetentionHelp")}</FieldHint>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onCommitFeatures(ALL_MODULE_IDS.filter((id) => draft.includes(id)))}
          className={`rounded-md bg-ui-green px-4 py-2 text-sm font-medium text-ui-dark-blue disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "modeSave")}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => setDraft(saved)}
          className={`rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50 ${INTERACTIVE}`}
        >
          {t(lang, "modeDiscard")}
        </button>
      </div>
    </div>
  );
}
