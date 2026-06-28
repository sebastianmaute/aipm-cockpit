"use client";

import { useMemo, useState } from "react";
import { type Lang, type TranslationKey, t } from "../i18n";
import {
  type NextActionsConfig,
  type NextActionsLearningConfig,
  type LearningStoreKind,
  type Settings,
  aiKeyIfEnabled,
  isAiEnabled,
  defaultAiConfig,
  defaultNextActionsConfig,
  resolveNextActionsConfig,
} from "../settings-types";
import { InfoTooltip } from "../info-tooltip";
import { useWeightSuggestions } from "../use-weight-suggestions";
import { applyWeightSuggestion, type SuggestionScope, type WeightSuggestion } from "../next-actions-tuning";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "../interaction-styles";

interface NextActionsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Learning layer controls — omitted (e.g. in popouts) hides the block entirely. */
  learningConfig?: NextActionsLearningConfig;
  onChangeLearningConfig?: (c: NextActionsLearningConfig) => void;
  onResetLearning?: () => void;
  onOpenInsights?: () => void;
  /** SP-C: builds the AI weight-suggestion context for a scope. Omitted (popouts)
   *  hides the "Suggest with AI" control. */
  buildWeightSuggestionContext?: (scope: SuggestionScope) => string;
}

/** Map the hook's controlled error token to a sanitized translation key — never
 *  surface the raw key/body/status to the UI. */
function suggestErrorKey(error: string): TranslationKey {
  if (error === "no-key") return "weightSuggestErrorKey";
  if (error === "parse") return "weightSuggestErrorParse";
  return "weightSuggestErrorNetwork"; // "network" or a digit-status
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
  buildWeightSuggestionContext,
}: NextActionsSectionProps) {
  const cfg = settings.nextActions ?? defaultNextActionsConfig;
  const learningEnabled =
    learningConfig != null && onChangeLearningConfig != null && onResetLearning != null && onOpenInsights != null;

  // SP-C: AI weight suggestions. Key-gated; ephemeral (cleared on re-run).
  const suggest = useWeightSuggestions({
    apiKey: aiKeyIfEnabled(settings.ai),
    model: settings.ai?.model ?? defaultAiConfig.model,
  });
  const scopeAll = settings.ai?.suggestAllNextActionThresholds === true;
  const scope: SuggestionScope = scopeAll ? "all" : "weights";
  // Accepting a row hides it; displayed = suggestions minus dismissed fields.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const displayed = useMemo(
    () => (suggest.result?.suggestions ?? []).filter((s) => !dismissed.has(s.field)),
    [suggest.result, dismissed],
  );
  const byField = useMemo(() => new Map(displayed.map((s) => [s.field, s])), [displayed]);
  const hasKey = isAiEnabled(settings.ai);
  const canSuggest = hasKey && buildWeightSuggestionContext != null;

  function runSuggest() {
    if (!buildWeightSuggestionContext) return;
    setDismissed(new Set());
    void suggest.run(buildWeightSuggestionContext(scope), resolveNextActionsConfig(settings.nextActions), scope);
  }
  function acceptSuggestion(s: WeightSuggestion) {
    onChange({ ...settings, nextActions: applyWeightSuggestion(resolveNextActionsConfig(settings.nextActions), s) });
    setDismissed((d) => new Set(d).add(s.field));
  }
  function acceptAll() {
    const next = displayed.reduce(
      (acc, s) => applyWeightSuggestion(acc, s),
      resolveNextActionsConfig(settings.nextActions),
    );
    onChange({ ...settings, nextActions: next });
    suggest.clear();
    setDismissed(new Set());
  }

  function patch(p: Partial<NextActionsConfig>) {
    onChange({ ...settings, nextActions: { ...cfg, ...p } });
  }
  function resetDefaults() {
    onChange({ ...settings, nextActions: { ...defaultNextActionsConfig } });
  }
  const isDefault = FIELDS.every((f) => cfg[f.key] === defaultNextActionsConfig[f.key]);

  return (
    <div className="mb-4">
      <p className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
        {t(lang, "nextActionsHint")}
        <InfoTooltip text={t(lang, "nextActionsTooltip")} />
      </p>

      {canSuggest && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runSuggest}
            disabled={suggest.busy}
            className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
          >
            {suggest.busy ? t(lang, "weightSuggestBusy") : t(lang, "weightSuggestRun")}
          </button>
          {displayed.length > 0 && (
            <button
              type="button"
              onClick={acceptAll}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {t(lang, "weightSuggestAcceptAll")}
            </button>
          )}
          <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={scopeAll}
              onChange={(e) =>
                onChange({ ...settings, ai: { ...settings.ai, suggestAllNextActionThresholds: e.target.checked } })
              }
              className="h-4 w-4 rounded border-line"
            />
            {t(lang, "weightSuggestScopeAll")}
          </label>
        </div>
      )}
      {suggest.error && (
        <p role="alert" className="mb-3 text-xs text-AIPM-pink-strong">
          {t(lang, suggestErrorKey(suggest.error))}
        </p>
      )}
      {!suggest.error && !suggest.busy && suggest.result && displayed.length === 0 && (
        <p className="mb-3 text-xs text-muted-foreground">{t(lang, "weightSuggestNone")}</p>
      )}
      {suggest.result?.recommendEnableLearning && learningEnabled && learningConfig && onChangeLearningConfig && !learningConfig.enabled && (
        <button
          type="button"
          onClick={() => onChangeLearningConfig({ ...learningConfig, enabled: true })}
          className={`mb-3 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "weightSuggestEnableLearning")}
        </button>
      )}

      {FIELDS.map((f) => {
        const value = cfg[f.key];
        const def = defaultNextActionsConfig[f.key];
        const fieldLabel = t(lang, f.labelKey);
        const s = byField.get(f.key);
        return (
          <label key={f.key} className="mb-2 flex items-center justify-between gap-2 text-sm text-foreground">
            <span className="inline-flex items-center gap-1">
              {fieldLabel}
              <InfoTooltip text={t(lang, f.hintKey)} />
              <span className="text-xs text-muted-foreground">({t(lang, "nextActionsDefault", def)})</span>
            </span>
            <span className="inline-flex items-center gap-2">
              {s && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">{s.suggested}</span>
                  {s.rationale && <InfoTooltip text={s.rationale} />}
                  <button
                    type="button"
                    onClick={() => acceptSuggestion(s)}
                    aria-label={`${t(lang, "weightSuggestAccept")} - ${fieldLabel}`}
                    className={`rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
                  >
                    {t(lang, "weightSuggestAccept")}
                  </button>
                </span>
              )}
              <input
                type="number"
                min={f.min ?? (f.kind === "ratio" ? 0.1 : 1)}
                max={f.kind === "ratio" ? 2 : 100000}
                step={f.kind === "ratio" ? 0.05 : 1}
                aria-label={fieldLabel}
                value={value}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  if (!Number.isFinite(raw)) return;
                  const next = f.kind === "ratio" ? raw : Math.round(raw);
                  patch({ [f.key]: next } as Partial<NextActionsConfig>);
                }}
                className={`w-24 rounded-md border border-line px-2 py-1 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
              />
            </span>
          </label>
        );
      })}

      <button
        type="button"
        onClick={resetDefaults}
        disabled={isDefault}
        className={`mt-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
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
              aria-labelledby="learning-enable-label"
              checked={learningConfig.enabled}
              onChange={(e) => onChangeLearningConfig({ ...learningConfig, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            <span className="inline-flex items-center gap-1">
              <span id="learning-enable-label">{t(lang, "settingsLearningEnable")}</span>
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
              className={`rounded-md border border-line bg-surface px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
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
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {t(lang, "settingsLearningReset")}
            </button>
            <button
              type="button"
              onClick={onOpenInsights}
              className={`rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {t(lang, "settingsLearningInsights")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
