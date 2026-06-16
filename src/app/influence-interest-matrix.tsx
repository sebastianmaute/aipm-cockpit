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
// Tint is a thin LEFT-ACCENT border + subtle cell background — text contrast
// no longer depends on it (labels/markers sit on a solid chip, see below).
function cellTint(score: number): string {
  if (score >= 6) return "border-l-2 border-AIPM-green bg-AIPM-green/15 hover:bg-AIPM-green/25";
  if (score >= 5) return "border-l-2 border-AIPM-green/70 bg-AIPM-green/10 hover:bg-AIPM-green/20";
  if (score >= 4) return "border-l-2 border-AIPM-purple/60 bg-AIPM-purple/10 hover:bg-AIPM-purple/20";
  if (score >= 3) return "border-l-2 border-surface-muted bg-surface-muted/20 hover:bg-surface-muted/30";
  return "border-l-2 border-surface-muted bg-surface-muted/10 hover:bg-surface-muted/20";
}

export interface InfluenceInterestMatrixProps {
  lang: Lang;
  influence: InfluenceInterest;
  interest: InfluenceInterest;
  onPick: (influence: InfluenceInterest, interest: InfluenceInterest) => void;
  /** Id of the stakeholder this matrix is editing (drives the needs-comms icon). */
  stakeholderId?: number;
  /** Stakeholder ids with a pending stakeholder-comms next-action. */
  commsPendingStakeholderIds?: ReadonlySet<number>;
  /** Jump to the Action Center for the given stakeholder (deep-link target). */
  onJumpToComms?: (stakeholderId: number) => void;
}

export function InfluenceInterestMatrix({
  lang,
  influence,
  interest,
  onPick,
  stakeholderId,
  commsPendingStakeholderIds,
  onJumpToComms,
}: InfluenceInterestMatrixProps) {
  const idx = (l: InfluenceInterest) => INFLUENCE_INTEREST_LEVELS.indexOf(l) + 1;
  const rows: InfluenceInterest[] = ["High", "Medium", "Low"];   // top -> bottom
  const cols: InfluenceInterest[] = ["Low", "Medium", "High"];   // left -> right
  const influenceLabel = t(lang, "stakeholderFieldInfluence");
  const interestLabel = t(lang, "stakeholderFieldInterest");
  const needsComms =
    stakeholderId !== undefined && (commsPendingStakeholderIds?.has(stakeholderId) ?? false);

  return (
    <div className="inline-flex items-stretch gap-1">
      <div className="flex w-4 items-center justify-center">
        <span className="whitespace-nowrap text-[10px] text-muted-foreground" style={{ transform: "rotate(-90deg)" }}>
          {influenceLabel} &uarr;
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
                  className={`flex h-12 w-14 items-center justify-center rounded ${cellTint(score)} ${isSelected ? "ring-2 ring-AIPM-green ring-offset-1" : ""}`}
                >
                  {/* Solid chip: text/marker contrast is independent of the quadrant tint. */}
                  <span
                    data-testid="ii-cell-chip"
                    className="inline-flex min-h-5 min-w-5 items-center justify-center gap-0.5 rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                  >
                    {isSelected ? <span aria-hidden>&#9679;</span> : null}
                    {isSelected && needsComms && stakeholderId !== undefined && onJumpToComms ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={t(lang, "stakeholderNeedsComms")}
                        title={t(lang, "stakeholderNeedsComms")}
                        className="inline-flex cursor-pointer items-center justify-center rounded text-AIPM-purple hover:text-AIPM-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-AIPM-green"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToComms?.(stakeholderId);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onJumpToComms?.(stakeholderId);
                          }
                        }}
                      >
                        <svg
                          viewBox="0 0 16 16"
                          width="11"
                          height="11"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H6.7l-2.5 2.2A.6.6 0 0 1 3.2 13v-2H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        <div className="mt-1 grid grid-cols-[auto_repeat(3,3.5rem)] gap-0.5">
          <span style={{ width: "3rem" }} />
          <span className="col-span-3 text-center text-[10px] text-muted-foreground">
            {interestLabel} &rarr;
          </span>
        </div>
      </div>
    </div>
  );
}
