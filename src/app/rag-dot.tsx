"use client";
import { healthDot, type Health } from "./health";

// Shared RAG status dot — the small coloured circle that precedes a health
// label across the app (task rows, RAID/change severity, reports groups, KPI
// tiles, digests). Colour rides `healthDot` (the single --rag-* role-token map
// in health.ts) so a given RAG letter reflows with the active scheme and reads
// identically everywhere; this atom just pins the size + shape so the ~15 call
// sites stop hand-rolling `h-2 w-2 rounded-full ${localDotMap[x]}`.
export type RagDotSize = "xs" | "sm" | "md" | "lg";

const RAG_DOT_SIZE: Record<RagDotSize, string> = {
  xs: "h-1.5 w-1.5", // 6px  — inline chips
  sm: "h-2 w-2", //     8px  — table severity/impact dots
  md: "h-2.5 w-2.5", // 10px — KPI tiles, kanban cards
  lg: "h-3 w-3", //    12px — reports group cards, digest
};

interface RagDotProps {
  level: Health;
  /** Diameter token; defaults to `sm` (8px). */
  size?: RagDotSize;
  /** Extra positioning classes (e.g. `mt-1`) appended verbatim. */
  className?: string;
  /** When set, the dot is a LABELED status graphic (`role="img"` + name)
   *  rather than decorative — use only when no adjacent visible text already
   *  conveys the RAG meaning (else keep it `aria-hidden`, the default). */
  label?: string;
}

export function RagDot({ level, size = "sm", className, label }: RagDotProps) {
  const cls = `inline-block shrink-0 rounded-full ${RAG_DOT_SIZE[size]} ${healthDot[level]}${
    className ? ` ${className}` : ""
  }`;
  if (label) {
    return <span role="img" title={label} aria-label={label} className={cls} />;
  }
  return <span aria-hidden className={cls} />;
}
