"use client";

import { t, type Lang } from "./i18n";
import {
  learnedBias,
  type LearningState,
  type LearningOverrides,
  type LearningOverride,
} from "./action-learning";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import type { ActionSource } from "./next-actions/types";
import { TABLE_HEAD_CLASS } from "./table-styles";

interface LearningInsightsProps {
  lang: Lang;
  state: LearningState;
  overrides: LearningOverrides;
  onSetOverride: (kind: string, override: LearningOverride) => void;
  onReset: () => void;
}

const OVERRIDE_OPTIONS: readonly LearningOverride[] = ["auto", "surface", "suppress", "off"];

const OVERRIDE_LABEL_KEY: Record<LearningOverride, Parameters<typeof t>[1]> = {
  auto: "learningOverrideAuto",
  surface: "learningOverrideSurface",
  suppress: "learningOverrideSuppress",
  off: "learningOverrideOff",
};

function sourceLabel(lang: Lang, kind: string): string {
  const source = kind.split(":")[0] as ActionSource;
  const key = ACTION_SOURCE_LABEL[source];
  return key ? t(lang, key) : source;
}

function formatBias(bias: number): string {
  if (bias > 0) return `+${bias}`;
  return String(bias);
}

export function LearningInsights({
  lang,
  state,
  overrides,
  onSetOverride,
  onReset,
}: LearningInsightsProps) {
  const kinds = Object.keys(state);

  return (
    <section className="flex flex-col gap-4 text-foreground">
      <h2 className="text-lg font-semibold">{t(lang, "learningInsightsTitle")}</h2>

      {kinds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "learningInsightsEmpty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 text-left">{t(lang, "learningColKind")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "learningColActed")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "learningColSnoozed")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "learningColDismissed")}</th>
                  <th className="px-3 py-2 text-right">{t(lang, "learningColBias")}</th>
                  <th className="px-3 py-2 text-left">{t(lang, "learningColOverride")}</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((kind) => {
                  const stats = state[kind];
                  return (
                    <tr key={kind} className="border-t border-line align-top">
                      <td className="px-3 py-2">
                        <div>{sourceLabel(lang, kind)}</div>
                        <div className="text-xs text-muted-foreground">{kind}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(stats.acted)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(stats.snoozed)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Math.round(stats.dismissed)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBias(learnedBias(stats))}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={t(lang, "learningColOverride")}
                          className="rounded border border-line bg-background px-2 py-1 text-foreground"
                          value={overrides[kind] ?? "auto"}
                          onChange={(e) => onSetOverride(kind, e.target.value as LearningOverride)}
                        >
                          {OVERRIDE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {t(lang, OVERRIDE_LABEL_KEY[opt])}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <button
              type="button"
              className="rounded border border-line px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted/40"
              onClick={() => {
                if (window.confirm(t(lang, "settingsLearningResetConfirm"))) onReset();
              }}
            >
              {t(lang, "settingsLearningReset")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
