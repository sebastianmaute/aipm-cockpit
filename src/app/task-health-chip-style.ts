// Active manual-health-override chip tint (task editor). Pure, i18n-free.
//
// RAG-semantic: border + background ride the canonical --rag-* role tokens
// (amber = warning orange, never purple) so the active RAG choice matches every
// RAG dot and reflows per scheme. Text stays dark-blue/light-grey (AA-safe) —
// the amber tint is a background only, never small text (--rag-amber-text fails
// AA on dark/mockup). Kept in its own module so it stays guarded against a
// raw-brand revert without pushing task-form-fields.tsx over the size ratchet.
import type { Health } from "./health";

export const HEALTH_CHIP_ACTIVE_CLASS: Record<Health, string> = {
  R: "border-[var(--rag-red)] bg-[var(--rag-red)]/10 text-AIPM-dark-blue dark:bg-[var(--rag-red)]/15 dark:text-AIPM-light-grey",
  A: "border-[var(--rag-amber)] bg-[var(--rag-amber)]/10 text-AIPM-dark-blue dark:bg-[var(--rag-amber)]/15 dark:text-AIPM-light-grey",
  G: "border-[var(--rag-green)] bg-[var(--rag-green)]/10 text-AIPM-dark-blue dark:bg-[var(--rag-green)]/15 dark:text-AIPM-light-grey",
};
