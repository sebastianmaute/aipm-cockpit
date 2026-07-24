"use client";
import { healthDot, type Health } from "./health";
import { Dot, type DotSize } from "./dot";

// Shared RAG status dot — the small coloured circle that precedes a health
// label across the app (task rows, RAID/change severity, reports groups, KPI
// tiles, digests). Colour rides `healthDot` (the single --rag-* role-token map
// in health.ts); the size+shape come from the shared `Dot` atom. This wrapper
// pins the Health-only contract the codebase leans on — non-Health callers use
// `Dot` directly with their own colour map, NOT this component.
export type RagDotSize = DotSize;

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
  return <Dot color={healthDot[level]} size={size} className={className} label={label} />;
}
