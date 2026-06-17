import { type Lang, t } from "./i18n";
import type { VarianceRow } from "./snapshot";
import { VARIANCE_LABEL_KEYS, fmtVarianceDelta } from "./variance-format";

export function VarianceSummary({ variance, lang }: { variance: readonly VarianceRow[]; lang: Lang }) {
  if (variance.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
      {variance.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t(lang, VARIANCE_LABEL_KEYS[row.key])}</dt>
          <dd className="font-medium text-foreground">{fmtVarianceDelta(row, lang)}</dd>
        </div>
      ))}
    </dl>
  );
}
