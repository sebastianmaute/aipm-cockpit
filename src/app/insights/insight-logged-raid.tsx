"use client";
// "Logged as RAID #N" + Open (§515). Props-only and shared by BOTH insight
// surfaces (dashboard card, Insights view), which otherwise render their own rows.
// ★ `nameToken` is the ROW-UNIQUE token from `insightRowTitles`, never the visible
//   title — two same-type rows would otherwise share the Open name (WCAG 2.4.6).
//   The accessible name starts with the visible text (label-in-name, WCAG 2.5.3).
import { t, type Lang } from "../i18n";
import { Button } from "../button";
import type { InsightEntityRef } from "./insight";

export interface InsightLoggedRaidProps {
  raidId: number;
  nameToken: string;
  lang: Lang;
  /** Deep-link channel; without it only the link text renders. */
  onOpen?: (ref: InsightEntityRef) => void;
}

export function InsightLoggedRaid({ raidId, nameToken, lang, onOpen }: InsightLoggedRaidProps) {
  const openLabel = t(lang, "insightOpenLoggedRaid", raidId);
  return (
    <>
      <span className="text-xs text-muted-foreground">{t(lang, "insightLoggedAsRaid", raidId)}</span>
      {onOpen ? (
        <Button
          variant="secondary"
          size="xs"
          aria-label={`${openLabel} – ${nameToken}`}
          onClick={() => onOpen({ view: "raid", id: raidId })}
        >
          {openLabel}
        </Button>
      ) : null}
    </>
  );
}
