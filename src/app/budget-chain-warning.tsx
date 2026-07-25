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
};

export function BurndownChainWarning({ lang, chain }: { lang: Lang; chain: BucketChain | null }) {
  if (!chain || chain.kind !== "broken" || chain.offenders.length === 0) return null;
  const names = chain.offenders.map((o) => o.name).join(", ");
  // role="none": this is a static explanation of the chart below it, not a live
  // update — a role="status" banner would re-announce on every view mount.
  return (
    <Banner severity="warn" role="none" className="mb-2 print:hidden">
      {t(lang, REASON_KEY[chain.reason], names)}
    </Banner>
  );
}
