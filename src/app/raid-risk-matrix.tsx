"use client";

// 5×5 risk matrix picker for the RAID edit modal (Risk items only).
// Presentational: the modal owns the draft and passes the selected
// probability/impact plus an onPick callback.
import { type Lang, t } from "./i18n";
import { RISK_SCALES, type RiskScale } from "./types";
import { INTERACTIVE } from "./interaction-styles";

export function RiskMatrix({
  probability,
  impact,
  onPick,
  lang,
}: {
  probability: RiskScale;
  impact: RiskScale;
  onPick: (probability: RiskScale, impact: RiskScale) => void;
  lang: Lang;
}) {
  function cellColor(p: RiskScale, i: RiskScale): string {
    const score = p * i;
    if (score <= 5)
      return "bg-ui-green/20 hover:bg-ui-green/30 dark:bg-ui-green/20 dark:hover:bg-ui-green/30";
    if (score <= 10)
      return "bg-ui-blue/20 hover:bg-ui-blue/30 dark:bg-ui-blue/20 dark:hover:bg-ui-blue/30";
    if (score <= 15)
      return "bg-ui-purple/25 hover:bg-ui-purple/35 dark:bg-ui-purple/25 dark:hover:bg-ui-purple/35";
    return "bg-ui-pink/30 hover:bg-ui-pink/40 dark:bg-ui-pink/30 dark:hover:bg-ui-pink/40";
  }

  return (
    <div className="inline-flex items-center gap-1">
      {/* Vertical probability axis label — mirrors the horizontal "← Impact →"
          footer. Rotated -90deg so the arrows end up pointing ↓ (low) at the
          bottom and ↑ (high) at the top, matching the matrix orientation
          (5 at the top, 1 at the bottom). */}
      <div className="flex w-4 items-center justify-center">
        <span
          className="whitespace-nowrap text-[10px] text-muted-foreground"
          style={{ transform: "rotate(-90deg)" }}
        >
          ← {t(lang, "raidProbability")} →
        </span>
      </div>
      <div className="inline-block">
      <div className="mb-1 grid grid-cols-[auto_repeat(5,2rem)] gap-0.5 text-[10px] text-muted-foreground">
        <span />
        {RISK_SCALES.map((i) => (
          <span key={`imp-${i}`} className="text-center">
            {i}
          </span>
        ))}
      </div>
      {/* Probability rows from 5 (top) down to 1 (bottom) so higher risk
          appears in the top-right corner, matching standard risk-matrix
          orientation. */}
      {([5, 4, 3, 2, 1] as RiskScale[]).map((p) => (
        <div
          key={`row-${p}`}
          className="grid grid-cols-[auto_repeat(5,2rem)] gap-0.5"
        >
          <span className="self-center pr-1 text-[10px] text-muted-foreground">
            {p}
          </span>
          {RISK_SCALES.map((i) => {
            const isSelected = probability === p && impact === i;
            return (
              <button
                key={`cell-${p}-${i}`}
                type="button"
                onClick={() => onPick(p, i)}
                aria-label={`${t(lang, "raidProbability")} ${p}, ${t(lang, "raidImpact")} ${i}`}
                className={`h-8 w-8 rounded text-[10px] font-medium text-foreground ${cellColor(p, i)} ${
                  isSelected ? "ring-2 ring-ui-green ring-offset-1" : ""
                } ${INTERACTIVE}`}
              >
                {p * i}
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-1 grid grid-cols-[auto_repeat(5,2rem)] gap-0.5">
        <span />
        <span className="col-span-5 text-center text-[10px] text-muted-foreground">
          ← {t(lang, "raidImpact")} →
        </span>
      </div>
      </div>
    </div>
  );
}
