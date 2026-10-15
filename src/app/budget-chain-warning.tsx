"use client";

// Explains why the burn-down x-axis covers the whole plan period instead of the
// budget window. Presentational: the offending bucket names travel on the
// BucketChain itself, so this needs no bucket list.
import { Banner, SEVERITY_CLASS } from "./banner";
import { InfoTooltip } from "./info-tooltip";
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

/** Whether the banner and the chip render: a broken chain with at least one bucket to name. */
export function isChainBroken(chain: BucketChain | null): boolean {
  return brokenChain(chain) !== null;
}

function brokenChain(chain: BucketChain | null): Extract<BucketChain, { kind: "broken" }> | null {
  return chain && chain.kind === "broken" && chain.offenders.length > 0 ? chain : null;
}

function warningText(lang: Lang, chain: Extract<BucketChain, { kind: "broken" }>): string {
  return t(lang, REASON_KEY[chain.reason], chain.offenders.map((o) => o.name).join(", "));
}

/** Renders nothing for a resolved `chain`, and nothing for `unchained` either:
 *  buckets with no successor links at all are the ordinary parallel-workstream
 *  budget model, so there is no break to explain. */
export function BurndownChainWarning({ lang, chain }: { lang: Lang; chain: BucketChain | null }) {
  const broken = brokenChain(chain);
  if (!broken) return null;
  // Takes the primitive's severity-derived role (warn → role="status"): the
  // banner only mounts on real, actionable bucket-data breaks now, so a polite
  // announcement is the right behaviour rather than noise on every view mount.
  // ★ NOT `print:hidden`: the chart is the artefact people circulate, and without
  // this line a printed burn-down shows a full-plan x-axis with nothing saying why
  // it is not the budget window.
  return (
    <Banner severity="warn" className="mb-2">
      {warningText(lang, broken)}
    </Banner>
  );
}

/** The dashboard tile's compact form of the same warning: a chip counting the buckets to check,
 *  which opens the full sentence on hover or focus. Renders nothing exactly when the banner does.
 *  The sentence is on screen only in the bubble, so the trigger's name carries it too, after the
 *  chip's own text (WCAG 2.5.3). The chip does not print; the tile prints the banner instead. */
export function BurndownChainChip({ lang, chain }: { lang: Lang; chain: BucketChain | null }) {
  const broken = brokenChain(chain);
  if (!broken) return null;
  const n = broken.offenders.length;
  const label = t(lang, n === 1 ? "burndownChainChipOne" : "burndownChainChipMany", String(n));
  const text = warningText(lang, broken);
  return (
    <span className="print:hidden">
      <InfoTooltip text={text} label={`${label}: ${text}`}>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${SEVERITY_CLASS.warn}`}>
          <span aria-hidden="true">⚠</span>{label}
        </span>
      </InfoTooltip>
    </span>
  );
}
