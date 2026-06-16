"use client";

import { type Lang, type TranslationKey, t } from "../i18n";
import {
  type NextActionsConfig,
  type NextActionsLearningConfig,
  type LearningStoreKind,
  type Settings,
  defaultNextActionsConfig,
} from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface NextActionsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Learning layer controls — omitted (e.g. in popouts) hides the block entirely. */
  learningConfig?: NextActionsLearningConfig;
  onChangeLearningConfig?: (c: NextActionsLearningConfig) => void;
  onResetLearning?: () => void;
  onOpenInsights?: () => void;
}

const LEARNING_STORE_OPTIONS: readonly { value: LearningStoreKind; labelKey: TranslationKey }[] = [
  { value: "local", labelKey: "settingsLearningStoreLocal" },
  { value: "turso", labelKey: "settingsLearningStoreTurso" },
];

type NumField = {
  key: keyof NextActionsConfig;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  /** "int" → whole numbers (count / percent); "ratio" → decimals (SPI). */
  kind: "int" | "ratio";
  min?: number;
};

const FIELDS: readonly NumField[] = [
  { key: "scopePendingRed", labelKey: "naScopePendingRed", hintKey: "naScopePendingRedHint", kind: "int" },
  { key: "scheduleSpiWarn", labelKey: "naScheduleSpiWarn", hintKey: "naScheduleSpiWarnHint", kind: "ratio" },
  { key: "scheduleSpiCritical", labelKey: "naScheduleSpiCritical", hintKey: "naScheduleSpiCriticalHint", kind: "ratio" },
  { key: "workloadAllocatedPct", labelKey: "naWorkloadAllocatedPct", hintKey: "naWorkloadAllocatedPctHint", kind: "int" },
  { key: "workloadAllocatedCritical", labelKey: "naWorkloadAllocatedCritical", hintKey: "naWorkloadAllocatedCriticalHint", kind: "int" },
  { key: "workloadOverdueThreshold", labelKey: "naWorkloadOverdueThreshold", hintKey: "naWorkloadOverdueThresholdHint", kind: "int" },
  { key: "workloadOverdueUrgent", labelKey: "naWorkloadOverdueUrgent", hintKey: "naWorkloadOverdueUrgentHint", kind: "int" },
  { key: "clarityBonus", labelKey: "naClarityBonus", hintKey: "naClarityBonusHint", kind: "int", min: 0 },
  { key: "semiClarityBonus", labelKey: "naSemiClarityBonus", hintKey: "naSemiClarityBonusHint", kind: "int", min: 0 },
  { key: "staticPenalty", labelKey: "naStaticPenalty", hintKey: "naStaticPenaltyHint", kind: "int", min: 0 },
];

export function NextActionsSection({
  lang,
  settings,
  onChange,
  learningConfig,
  onChangeLearningConfig,
  onResetLearning,
  onOpenInsights,
}: NextActionsSectionProps) {
  const cfg = settings.nextActions ?? defaultNextActionsConfig;
  const learningEnabled =
    learningConfig != null && onChangeLearningConfig != null && onResetLearning != null && onOpenInsights != null;

  function patch(p: Partial<NextActionsConfig>) {
    onChange({ ...settings, nextActions: { ...cfg, ...p } });
  }
  function resetDefaults() {
    onChange({ ...settings, nextActions: { ...defaultNextActionsConfig } });
  }
  const isDefault = FIELDS.every((f) => cfg[f.key] === defaultNextActionsConfig[f.key]);

  return (
    <div className="mb-4">
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "settingsSectionNextActions")}
        <InfoTooltip text={t(lang, "nextActionsTooltip")} />
      </span>
      <p className="mb-3 text-xs text-muted-foreground">{t(lang, "nextActionsHint")}</p>

      {FIELDS.map((f) => {
        const value = cfg[f.key];
        const def = defaultNextActionsConfig[f.key];
        return (
          <label key={f.key} className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
            <span className="inline-flex items-center gap-1">
              {t(lang, f.labelKey)}
              <InfoTooltip text={t(lang, f.hintKey)} />
              <span className="text-xs text-muted-foreground">({t(lang, "nextActionsDefault", def)})</span>
            </span>
            <input
              type="number"
              min={f.min ?? (f.kind === "ratio" ? 0.1 : 1)}
              max={f.kind === "ratio" ? 2 : 100000}
              step={f.kind === "ratio" ? 0.05 : 1}
              aria-label={t(lang, f.labelKey)}
              value={value}
              onChange={(e) => {
                const raw = Number(e.target.value);
                if (!Number.isFinite(raw)) return;
                const next = f.kind === "ratio" ? raw : Math.round(raw);
                patch({ [f.key]: next } as Partial<NextActionsConfig>);
              }}
              className="w-24 rounded-md border border-line px-2 py-1 text-right tabular-nums"
            />
          </label>
        );
      })}

      <button
        type="button"
        onClick={resetDefaults}
        disabled={isDefault}
        className="mt-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t(lang, "nextActionsReset")}
      </button>

      <hr className="my-3 border-line" />
      <div className="text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">{t(lang, "naFormulaHeading")}</p>
        <p>{t(lang, "naFormulaScore")}</p>
        <p>{t(lang, "naFormulaVars")}</p>
        <p>{t(lang, "naFormulaTiers")}</p>
        <p>{t(lang, "naFormulaThresholds")}</p>
      </div>

      {learningEnabled && learningConfig && onChangeLearningConfig && onResetLearning && onOpenInsights && (
        <>
          <hr className="my-3 border-line" />
          <label className="mb-2 flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              aria-label={t(lang, "settingsLearningEnable")}
              checked={learningConfig.enabled}
              onChange={(e) => onChangeLearningConfig({ ...learningConfig, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            <span className="inline-flex items-center gap-1">
              {t(lang, "settingsLearningEnable")}
              <InfoTooltip text={t(lang, "settingsLearningEnableHint")} />
            </span>
          </label>

          <label className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
            <span>{t(lang, "settingsLearningStore")}</span>
            <select
              aria-label={t(lang, "settingsLearningStore")}
              value={learningConfig.store}
              onChange={(e) =>
                onChangeLearningConfig({ ...learningConfig, store: e.target.value as LearningStoreKind })
              }
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
            >
              {LEARNING_STORE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(lang, o.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t(lang, "settingsLearningResetConfirm"))) onResetLearning();
              }}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              {t(lang, "settingsLearningReset")}
            </button>
            <button
              type="button"
              onClick={onOpenInsights}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              {t(lang, "settingsLearningInsights")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
