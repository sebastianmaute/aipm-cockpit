"use client";
// The three read-only notices above the Timelog panel's "Apply to budget"
// button. Presentational and prop-driven — extracted from `timelog-panel.tsx`
// both because that file sits against the 800-line ratchet and because all
// three had grown into one repeated <p> shell that a fourth would copy again.
//
// ★★ ORDER IS SEVERITY, NOT HISTORY. `partial` leads because it is the only one
//    that DISABLES Apply: the other two explain hours that will be left out of
//    a write the user can still make, while this one explains why there is no
//    write to make. A reader who sees a greyed button needs its reason first.
import { type Lang, t } from "./i18n";

interface TimelogApplyNoticesProps {
  lang: Lang;
  /** The cached aggregate lost at least one project to a fetch error (§172). */
  partial: boolean;
  /** Buckets with booked hours but no role/discipline line to hold them. */
  skippedCount: number;
  /** Buckets where some hours matched no role line. */
  unmatchedCount: number;
  /** Hours withheld across those buckets. */
  unmatchedHours: number;
}

const NOTICE =
  "mb-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-muted-foreground print:hidden";

export function TimelogApplyNotices({
  lang, partial, skippedCount, unmatchedCount, unmatchedHours,
}: TimelogApplyNoticesProps) {
  return (
    <>
      {partial && <p className={NOTICE}>{t(lang, "timelogApplyPartial")}</p>}
      {skippedCount > 0 && (
        <p className={NOTICE}>{t(lang, "timelogApplyNoAllocation", String(skippedCount))}</p>
      )}
      {unmatchedCount > 0 && (
        <p className={NOTICE}>
          {/* Gated on the bucket LIST, not the hour total: a +40/-40 credit
              correction nets to zero while hours are still withheld. */}
          {/* 1dp, not Math.round: a net of -0.4 rounded to "0 hours withheld",
              so the notice contradicted itself. Trailing ".0" is trimmed. */}
          {t(lang, "timelogApplyUnmatched", String(unmatchedCount),
             unmatchedHours.toFixed(1).replace(/\.0$/, ""))}
        </p>
      )}
    </>
  );
}
