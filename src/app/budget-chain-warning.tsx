"use client";

// Explains why the burn-down x-axis covers the whole plan period instead of the
// budget window. Presentational: the offending bucket names travel on the
// BucketChain itself, so this needs no bucket list.
import { Banner } from "./banner";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { BucketChain, BucketChainBreak } from "./budget-bucket-chain";

const REASON_KEY: Record<BucketChainBreak, TranslationKey> = {
  "multiple-roots": "burndownChainMultipleRoots",
  unreachable: "burndownChainUnreachable",
  cycle: "burndownChainCycle",
  "missing-dates": "burndownChainMissingDates",
  dangling: "burndownChainDangling",
  "outside-plan": "burndownChainOutsidePlan",
};

/** Renders nothing for a resolved `chain`, and nothing for `unchained` either:
 *  buckets with no successor links at all are the ordinary parallel-workstream
 *  budget model, so there is no break to explain. */
export function BurndownChainWarning({ lang, chain }: { lang: Lang; chain: BucketChain | null }) {
  if (!chain || chain.kind !== "broken" || chain.offenders.length === 0) return null;
  const names = chain.offenders.map((o) => o.name).join(", ");
  // Takes the primitive's severity-derived role (warn → role="status"): the
  // banner only mounts on real, actionable bucket-data breaks now, so a polite
  // announcement is the right behaviour rather than noise on every view mount.
  // ★ NOT `print:hidden`: the chart is the artefact people circulate, and without
  // this line a printed burn-down shows a full-plan x-axis with nothing saying why
  // it is not the budget window.
  return (
    <Banner severity="warn" className="mb-2">
      {t(lang, REASON_KEY[chain.reason], names)}
    </Banner>
  );
}
