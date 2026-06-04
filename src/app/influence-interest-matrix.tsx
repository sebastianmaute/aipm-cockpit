"use client";

// Clickable 3x3 influence/interest matrix. Adapted from RaidPanel's RiskMatrix
// (function, style, makeup): one <button> per cell, axis labels flanking the
// grid, selected cell ringed. X = interest (Low->High, left->right),
// Y = influence (High at top -> Low at bottom), matching the stakeholder map.
// Clicking a cell reports BOTH influence and interest in one onPick call.

import { type Lang, t, type TranslationKey } from "./i18n";
import { INFLUENCE_INTEREST_LEVELS, type InfluenceInterest } from "./types";

const LEVEL_LABEL_KEYS: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow",
  Medium: "levelMedium",
  High: "levelHigh",
};

// score = influenceIdx + interestIdx (1-based, 2..6). Brand tokens only.
function cellTint(score: number): string {
  if (score >= 6) return "bg-AIPM-green/30 hover:bg-AIPM-green/40";
  if (score >= 5) return "bg-AIPM-green/20 hover:bg-AIPM-green/30";
  if (score >= 4) return "bg-AIPM-purple/15 hover:bg-AIPM-purple/25";
  if (score >= 3) return "bg-AIPM-light-grey/30 hover:bg-AIPM-light-grey/40";
  return "bg-surface-muted hover:bg-AIPM-light-grey/30";
}

export interface InfluenceInterestMatrixProps {
  lang: Lang;
  influence: InfluenceInterest;
  interest: InfluenceInterest;
  onPick: (influence: InfluenceInterest, interest: InfluenceInterest) => void;
}

export function InfluenceInterestMatrix({ lang, influence, interest, onPick }: InfluenceInterestMatrixProps) {
  const idx = (l: InfluenceInterest) => INFLUENCE_INTEREST_LEVELS.indexOf(l) + 1;
  const rows: InfluenceInterest[] = ["High", "Medium", "Low"];   // top -> bottom
  const cols: InfluenceInterest[] = ["Low", "Medium", "High"];   // left -> right
  const influenceLabel = t(lang, "stakeholderFieldInfluence");
  const interestLabel = t(lang, "stakeholderFieldInterest");

  return (
    <div className="inline-flex items-stretch gap-1">
      <div className="flex w-4 items-center justify-center">
        <span className="whitespace-nowrap text-[10px] text-muted-foreground" style={{ transform: "rotate(-90deg)" }}>
          &larr; {influenceLabel} &rarr;
        </span>
      </div>
      <div className="inline-block">
        {rows.map((inf) => (
          <div key={`row-${inf}`} className="grid grid-cols-[auto_repeat(3,3.5rem)] gap-0.5">
            <span className="self-center pr-1 text-right text-[10px] text-muted-foreground" style={{ width: "3rem" }}>
              {t(lang, LEVEL_LABEL_KEYS[inf])}
            </span>
            {cols.map((intr) => {
              const isSelected = influence === inf && interest === intr;
              const score = idx(inf) + idx(intr);
              return (
                <button
                  key={`cell-${inf}-${intr}`}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${influenceLabel} ${t(lang, LEVEL_LABEL_KEYS[inf])}, ${interestLabel} ${t(lang, LEVEL_LABEL_KEYS[intr])}`}
                  onClick={() => onPick(inf, intr)}
                  className={`h-12 w-14 rounded text-[10px] font-medium text-foreground ${cellTint(score)} ${isSelected ? "ring-2 ring-AIPM-green ring-offset-1" : ""}`}
                />
              );
            })}
          </div>
        ))}
        <div className="mt-1 grid grid-cols-[auto_repeat(3,3.5rem)] gap-0.5">
          <span style={{ width: "3rem" }} />
          <span className="col-span-3 text-center text-[10px] text-muted-foreground">
            &larr; {interestLabel} &rarr;
          </span>
        </div>
      </div>
    </div>
  );
}
