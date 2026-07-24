"use client";

// Presentational size+shape dot atom. Owns ONLY the diameter + the
// `rounded-full` shape; the COLOUR is passed as a raw bg-token className so
// each caller keeps its own local semantic map (TIER_RAG, DIRECTION_DOT, …).
// Kept deliberately colour-agnostic so the palette-sweep is unaffected and so
// the atom never re-centralises a semantic map (see AGENTS.md — a shared
// coloured status enum belongs in the caller, not here). `RagDot` builds on it.
export type DotSize = "xs" | "sm" | "md" | "lg";

export const DOT_SIZE: Record<DotSize, string> = {
  xs: "h-1.5 w-1.5", // 6px
  sm: "h-2 w-2", //     8px
  md: "h-2.5 w-2.5", // 10px
  lg: "h-3 w-3", //    12px
};

interface DotProps {
  /** A bg colour-token className, e.g. "bg-[var(--rag-red)]" or "bg-ui-green". */
  color: string;
  /** Diameter token; defaults to "sm" (8px). */
  size?: DotSize;
  /** Extra positioning classes (e.g. "mt-1") appended verbatim. */
  className?: string;
  /** When set, the dot is a LABELED graphic (role="img" + name) instead of
   *  decorative — use only when no adjacent visible text conveys the meaning. */
  label?: string;
}

export function Dot({ color, size = "sm", className, label }: DotProps) {
  const cls = `inline-block shrink-0 rounded-full ${DOT_SIZE[size]} ${color}${
    className ? ` ${className}` : ""
  }`;
  if (label) {
    return <span role="img" title={label} aria-label={label} className={cls} />;
  }
  return <span aria-hidden className={cls} />;
}
