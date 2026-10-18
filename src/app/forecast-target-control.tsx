"use client";

// The project's target confidence (§502 part 4): one SegmentedControl, the Forecast view header's and the Reports
// Forecast section's alike. The control speaks strings; the stored value is the number.

import { type Lang, t } from "./i18n";
import { SegmentedControl } from "./segmented-control";
import { DEFAULT_TARGET_CONFIDENCE, TARGET_CONFIDENCES, type TargetConfidence } from "./forecast-target";

const LABEL_KEY = { 50: "simEvenOdds", 80: "simSafeToCommit", 95: "simCautious" } as const;

/** "Safe to commit 80%": the percentile word and the percent, in the language's own percent form. */
export function targetConfidenceLabel(lang: Lang, value: TargetConfidence): string {
  return t(lang, "forecastTargetOption", t(lang, LABEL_KEY[value]), t(lang, "forecastPercent", value));
}

function parse(raw: string): TargetConfidence {
  return TARGET_CONFIDENCES.find((v) => String(v) === raw) ?? DEFAULT_TARGET_CONFIDENCE;
}

export function ForecastTargetControl({ lang, value, onChange, disabled = false }: {
  lang: Lang;
  value: TargetConfidence;
  onChange: (v: TargetConfidence) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="text-xs text-muted-foreground">{t(lang, "forecastTargetLabel")}</span>
      <SegmentedControl<string>
        ariaLabel={t(lang, "forecastTargetLabel")}
        value={String(value)}
        onChange={(raw) => onChange(parse(raw))}
        disabled={disabled}
        options={TARGET_CONFIDENCES.map((v) => ({ value: String(v), label: targetConfidenceLabel(lang, v) }))}
      />
    </div>
  );
}
