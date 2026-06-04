"use client";

import { useState } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import {
  ALL_MODULE_IDS,
  FEATURE_MODULES,
  type FeatureModuleId,
  deriveMode,
} from "../feature-modules";

interface ModeSectionProps {
  lang: Lang;
  settings: Settings;
  /** Called only on explicit Save; the parent persists features and triggers a page reload. */
  onCommitFeatures: (features: FeatureModuleId[]) => void;
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

export function ModeSection({ lang, settings, onCommitFeatures }: ModeSectionProps) {
  const saved = settings.features;
  const [draft, setDraft] = useState<FeatureModuleId[]>(saved);

  const mode = deriveMode(draft);
  const dirty = !sameSet(draft, saved);
  // One-directional: warn only when the draft drops a saved module (not when adding).
  const removesModules = saved.some((id) => !draft.includes(id));

  const toggle = (id: FeatureModuleId) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "settingsSectionMode")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "modeIntro")}</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t(lang, "modeBadgeLabel")}:</span>
        <span
          data-testid="mode-badge"
          className="rounded-full bg-AIPM-green/15 px-3 py-1 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
        >
          {t(lang, MODE_LABEL_KEY[mode])}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="Apply Simple preset"
          onClick={() => setDraft([])}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          {t(lang, "modePresetSimple")}
        </button>
        <button
          type="button"
          aria-label="Apply Advanced preset"
          onClick={() => setDraft([...ALL_MODULE_IDS])}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          {t(lang, "modePresetAdvanced")}
        </button>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          {t(lang, "modeModulesHeading")}
        </legend>
        {FEATURE_MODULES.map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.includes(m.id)}
              onChange={() => toggle(m.id)}
              className="h-4 w-4 accent-AIPM-green"
            />
            <span>{t(lang, m.labelKey)}</span>
          </label>
        ))}
      </fieldset>

      {removesModules && (
        <p className="rounded-md bg-amber-500/20 px-3 py-2 text-xs text-AIPM-purple">
          {t(lang, "modeRetentionNote")}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onCommitFeatures(ALL_MODULE_IDS.filter((id) => draft.includes(id)))}
          className="rounded-md bg-AIPM-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t(lang, "modeSave")}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => setDraft(saved)}
          className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50"
        >
          {t(lang, "modeDiscard")}
        </button>
      </div>
    </div>
  );
}
