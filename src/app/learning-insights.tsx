"use client";

import { useState } from "react";
import { t, type Lang } from "./i18n";
import {
  decayStats,
  effectiveBias,
  learnedBias,
  type LearningState,
  type LearningOverrides,
  type LearningOverride,
} from "./action-learning";
import { learningKindLabel } from "./learning-kind-label";
import { ROW_RULE_CLASS, TABLE_HEAD_CLASS } from "./table-styles";
import { useConfirm } from "./confirm-dialog";
import { Button } from "./button";
import { rowLabel } from "./row-tokens";
import { Select } from "./form-controls";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { INNER_TABLE_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";

interface LearningInsightsProps {
  lang: Lang;
  state: LearningState;
  overrides: LearningOverrides;
  onSetOverride: (kind: string, override: LearningOverride) => void;
  onReset: () => void;
  /** Leads the toolbar; returns to Settings, where this view is opened from. */
  onBack: () => void;
  /** The learning switch (`NextActionsLearningConfig.enabled`). Off, the engine
   *  gets no bias at all, so the Adjustment column shows 0 (§780). */
  learningEnabled: boolean;
  /** The stored learning could not be read (`useActionLearning`'s `loadFailed`): the
   *  rows are this session's only, and nothing is saved until a read works (§781). */
  loadFailed: boolean;
  /** Decay reference time. Defaults to Date.now(); injectable for deterministic tests. */
  now?: number;
}

const OVERRIDE_OPTIONS: readonly LearningOverride[] = ["auto", "surface", "suppress", "off"];

const OVERRIDE_LABEL_KEY: Record<LearningOverride, Parameters<typeof t>[1]> = {
  auto: "learningOverrideAuto",
  surface: "learningOverrideSurface",
  suppress: "learningOverrideSuppress",
  off: "learningOverrideOff",
};

function formatBias(bias: number): string {
  if (bias > 0) return `+${bias}`;
  return String(bias);
}

// §777 — a standard pane: the resizable card (`VIEW_PANE_RESIZABLE_CLASS`), the
// table scrolling inside it (`INNER_TABLE_CLASS`) rather than the page, and ONE
// toolbar row — Back leads, the bulk reset sits before the trailing
// Print · reset-size group (no column resize here, so no reset-columns).
export function LearningInsights({
  lang,
  state,
  overrides,
  onSetOverride,
  onReset,
  onBack,
  learningEnabled,
  loadFailed,
  now,
}: LearningInsightsProps) {
  const kinds = Object.keys(state);
  const confirm = useConfirm();
  const { ref, reset: resetSize } = useResizable("aipm-cockpit:learning-size");
  // Match the engine: display decayed stats/bias so old data stays consistent.
  // The react-hooks/purity lint bans Date.now() in the render body, so capture
  // the fallback "now" once via a lazy state initializer (runs outside render).
  const [fallbackNow] = useState(() => Date.now());
  const nowMs = now ?? fallbackNow;

  return (
    <div ref={ref} className={`${VIEW_PANE_RESIZABLE_CLASS} print-root text-foreground`}>
      <header className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" size="xs" onClick={onBack} className="print:hidden">
          {t(lang, "wizardBack")}
        </Button>
        <h2 className="mr-auto text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "learningInsightsTitle")}
        </h2>
        <div className="flex items-center gap-2 print:hidden">
          {kinds.length > 0 && (
            <Button
              variant="secondary"
              size="xs"
              onClick={async () => {
                if (await confirm({ message: t(lang, "settingsLearningResetConfirm") })) onReset();
              }}
            >
              {t(lang, "settingsLearningReset")}
            </Button>
          )}
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={resetSize} lang={lang} />
        </div>
      </header>

      {loadFailed && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">{t(lang, "learningLoadFailedNotice")}</p>
      )}
      {kinds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "learningInsightsEmpty")}</p>
      ) : (
        <div className={INNER_TABLE_CLASS}>
          {/* ★ `border-collapse` was REMOVED here, not forgotten (§68). It read as
              opting this table back into the collapsed borders model, and it never
              did: `globals.css`'s `table:has(> .aipm-cockpit-thead)` rule is
              UNLAYERED, so it beats a layered Tailwind utility whatever the
              specificity. Leaving it would keep implying that a `<tr>` border can
              paint here. Do NOT reintroduce it. */}
          <table className="w-full text-sm">
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
                const d = decayStats(stats, nowMs);
                const label = learningKindLabel(lang, kind);
                const override = overrides[kind] ?? "auto";
                return (
                  <tr key={kind} className={`${ROW_RULE_CLASS} align-top`}>
                    <td className="px-3 py-2">
                      <div>{label.source}</div>
                      <div className="text-xs text-muted-foreground">{label.reason}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(d.acted)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(d.snoozed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(d.dismissed)}</td>
                    {/* §780 — the APPLIED adjustment: `effectiveBias`, what
                        `buildBiasMap` feeds the engine while learning is on,
                        and 0 while it is off (`useActionLearning` then hands
                        the engine no bias). Under an override the learned value
                        stays visible, marked as learned, so "Always suppress"
                        never reads as a learned "+5". The engine's now-tier
                        floor can still move an urgent item less than shown. */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      <div>{formatBias(learningEnabled ? effectiveBias(d, override) : 0)}</div>
                      {!learningEnabled ? (
                        <div className="text-xs text-muted-foreground">{t(lang, "learningBiasDisabled")}</div>
                      ) : override !== "auto" && (
                        <div className="text-xs text-muted-foreground">
                          {t(lang, "learningBiasLearned", formatBias(learnedBias(d)))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        // §248: no token map here, deliberately — `kind` is
                        // this list's React key (`Object.keys(state)`) and
                        // cannot repeat in one render, so a per-list token
                        // map would be ceremony. The discriminator for
                        // this whole plan is "can this value repeat in one
                        // rendered list", and `kind` cannot.
                        //
                        // ★★★ But the SOURCE label alone fails that same
                        // test: `kind` is source plus why key (`learningKindOf`), and several
                        // sources legitimately emit more than one `why.key`
                        // in one render (milestone: overdue/at-risk;
                        // task-attention: unassigned/stale/blocked/
                        // dep-blocked), so those rows would share one name.
                        // The translated REASON restores uniqueness (§777 —
                        // it replaced the raw `kind` this name used to
                        // carry): `learningKindLabel` gives distinct learning
                        // kinds distinct reasons, pinned by the "every why key"
                        // tests beside this file. That holds because `state`
                        // arrives normalised (`normalizeLearningSnapshot`, §778):
                        // a count variant and its plural are one row, never two.
                        aria-label={rowLabel(t(lang, "learningColOverride"), `${label.source}: ${label.reason}`)}
                        size="xs"
                        value={override}
                        onChange={(e) => onSetOverride(kind, e.target.value as LearningOverride)}
                      >
                        {OVERRIDE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {t(lang, OVERRIDE_LABEL_KEY[opt])}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
