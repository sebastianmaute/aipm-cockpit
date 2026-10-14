"use client";

// Schedule forecast toolbar (§502): mode · unit · history window · (What-if) scope and
// capacity inputs · the trailing Print · reset-size group (ui-shell.md "toolbar button order").

import { useId, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { SegmentedControl } from "./segmented-control";
import { Input, Select } from "./form-controls";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import type { WhatIf } from "./forecast";
import { EFFORT_MODE_MIN_COVERAGE, HISTORY_WINDOWS, type ForecastUnit, type HistoryWindow } from "./forecast/constants";

export type ForecastMode = "quick" | "whatif";
export type WhatIfField = keyof WhatIf;

const windowValue = (w: HistoryWindow): string => String(w);
const parseWindow = (v: string): HistoryWindow =>
  HISTORY_WINDOWS.find((w) => windowValue(w) === v) ?? HISTORY_WINDOWS[0];

/**
 * A number field that commits on blur or Enter, never per keystroke. `onCommit`
 * answers whether the value was accepted; a refused value reverts to the last
 * committed one and the message appears beside the field.
 */
function WhatIfNumberField({
  lang,
  label,
  value,
  onCommit,
}: {
  lang: Lang;
  label: string;
  value: number;
  onCommit: (raw: string) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const messageId = useId();
  const commit = () => {
    if (draft === null) return;
    setInvalid(!onCommit(draft));
    setDraft(null);
  };
  return (
    <span className="flex items-center gap-1 text-xs">
      <label className="flex items-center gap-1 text-muted-foreground">
        {label}
        <Input
          type="number"
          size="xs"
          className="w-20 text-right tabular-nums"
          value={draft ?? String(value)}
          invalid={invalid}
          aria-describedby={invalid ? messageId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      </label>
      {invalid && (
        <span id={messageId} className="font-medium text-ui-pink-strong">
          {t(lang, "forecastInputInvalid")}
        </span>
      )}
    </span>
  );
}

export function ForecastToolbar({
  lang,
  mode,
  onModeChange,
  unit,
  onUnitChange,
  coverage,
  historyWindow,
  onWindowChange,
  whatIf,
  onCommitWhatIf,
  onResetSize,
}: {
  lang: Lang;
  mode: ForecastMode;
  onModeChange: (m: ForecastMode) => void;
  unit: ForecastUnit;
  onUnitChange: (u: ForecastUnit) => void;
  /** Share of open tasks with an estimate; effort is offered only at EFFORT_MODE_MIN_COVERAGE. */
  coverage: number;
  historyWindow: HistoryWindow;
  onWindowChange: (w: HistoryWindow) => void;
  whatIf: WhatIf;
  onCommitWhatIf: (field: WhatIfField, raw: string) => boolean;
  onResetSize: () => void;
}) {
  const effortAvailable = coverage >= EFFORT_MODE_MIN_COVERAGE;
  const effortReasonId = useId();
  // Visible as well as the title: a disabled radio takes no focus and a title shows only on hover.
  const effortReason = effortAvailable
    ? undefined
    : t(lang, "forecastEffortUnavailable", Math.round(EFFORT_MODE_MIN_COVERAGE * 100), Math.round(coverage * 100));
  const field = (f: WhatIfField, labelKey: TranslationKey) => (
    <WhatIfNumberField lang={lang} label={t(lang, labelKey)} value={whatIf[f]} onCommit={(raw) => onCommitWhatIf(f, raw)} />
  );
  return (
    <div data-forecast-toolbar="" className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
      <SegmentedControl<ForecastMode>
        ariaLabel={t(lang, "forecastModeLabel")}
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "quick", label: t(lang, "forecastModeQuick") },
          { value: "whatif", label: t(lang, "forecastModeWhatIf") },
        ]}
      />
      <SegmentedControl<ForecastUnit>
        ariaLabel={t(lang, "forecastUnitLabel")}
        value={effortAvailable ? unit : "tasks"}
        onChange={onUnitChange}
        disabled={!effortAvailable}
        title={effortReason}
        ariaDescribedBy={effortReason ? effortReasonId : undefined}
        options={[
          { value: "tasks", label: t(lang, "forecastUnitTasks") },
          { value: "effort", label: t(lang, "forecastUnitEffort") },
        ]}
      />
      {effortReason && (
        <span id={effortReasonId} className="text-xs text-muted-foreground">
          {effortReason}
        </span>
      )}
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        {t(lang, "forecastWindowLabel")}
        <Select size="xs" value={windowValue(historyWindow)} onChange={(e) => onWindowChange(parseWindow(e.target.value))}>
          {HISTORY_WINDOWS.map((w) => (
            <option key={windowValue(w)} value={windowValue(w)}>
              {w === "all" ? t(lang, "forecastWindowAll") : t(lang, "forecastWindowDays", w)}
            </option>
          ))}
        </Select>
      </label>
      {mode === "whatif" && (
        <>
          {field("scopeTasks", "forecastScopeTasks")}
          {field("scopePercent", "forecastScopePercent")}
          {field("capacityPercent", "forecastCapacityPercent")}
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetSizeButton onClick={onResetSize} lang={lang} />
      </div>
    </div>
  );
}
