import { healthColorName, healthDot, type Health } from "./health";
import { type Lang } from "./i18n";

/** Lettered RAG dot: white R/A/G glyph on the health colour, grey "—" when null.
 *  Grayscale-/print-safe (the letter survives loss of colour). Used on the
 *  dashboard pills, budget metrics, the roles table, and in print. */
export function RagBadge({
  value, lang, title,
}: {
  value: Health | null;
  lang: Lang;
  title?: string;
}) {
  const name = value ? healthColorName(value, lang) : "—";
  const label = title ?? name;
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white";
  if (!value) {
    return <span aria-label={label} title={label} className={`${base} bg-slate-300`}>—</span>;
  }
  return <span aria-label={label} title={label} className={`${base} ${healthDot[value]}`}>{value}</span>;
}
