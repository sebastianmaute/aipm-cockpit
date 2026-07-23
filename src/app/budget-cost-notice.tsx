"use client";

import { type Lang, t } from "./i18n";
import type { CostUnknownReason } from "./budget-report";

/** One message per reason. An exhaustive Record so tsc forces a message for any
 *  reason added later — the surface must never be left to infer one, which is
 *  how "set them on the rate card" ended up on a bucket with no roles. */
const REASON_KEY: Record<CostUnknownReason, Parameters<typeof t>[1]> = {
  "no-rows": "budgetNoAllocations",
  "no-rates": "budgetNoInternalRates",
  "unrated-hours": "budgetUnratedHours",
  "unpriced-blend": "budgetUnpricedBlend",
};

/**
 * The muted line under a budget card explaining why cost, margin and burn are
 * dashes. Renders nothing when they are sound.
 *
 * Muted guidance, NOT a warning banner: an empty bucket is a normal early state
 * and must not nag.
 */
export function CostUnknownNotice({
  lang, reason, disciplineNames,
}: {
  lang: Lang;
  reason: CostUnknownReason | null;
  /** Resolved names for `unpricedDisciplineIds`; ignored for other reasons. */
  disciplineNames: readonly string[];
}) {
  if (reason === null) return null;
  // The named variant needs names. With none resolvable it would print a
  // dangling "in: ." — the generic rate-card message is still true.
  const named = reason === "unpriced-blend" && disciplineNames.length > 0;
  const text = named
    ? t(lang, "budgetUnpricedBlend", disciplineNames.join(", "))
    : t(lang, REASON_KEY[reason === "unpriced-blend" ? "no-rates" : reason]);
  return <p className="mt-2 text-xs text-muted-foreground">{text}</p>;
}
