import { healthColorName, type Health } from "./health";
import { type Lang } from "./i18n";

// value → fill + letter, each pair held to 4.5:1 in every scheme (§683). Red and
// green ride derived darker fills under a white letter; amber keeps its own fill
// and takes a derived dark letter. Never `healthDot` here: white on the raw RAG
// colours measured 1.68-5.02:1 and failed in all but two scheme/colour pairs.
const CHIP_CLASS: Record<Health, string> = {
  R: "bg-[var(--rag-badge-red)] text-white",
  A: "bg-[var(--rag-amber)] text-[var(--rag-badge-amber-ink)]",
  G: "bg-[var(--rag-badge-green)] text-white",
};

/** Lettered RAG dot: the R/A/G glyph on the health colour, grey "—" when null.
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
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact]";
  if (!value) {
    return <span role="img" aria-label={label} title={label} className={`${base} bg-surface-muted text-muted-foreground`}>—</span>;
  }
  return <span role="img" aria-label={label} title={label} data-rag-chip={value} className={`${base} ${CHIP_CLASS[value]}`}>{value}</span>;
}
