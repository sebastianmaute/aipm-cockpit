"use client";

// The dashed, full-width "+ Add …" row that trails a register table (Open Points,
// RAID). It was hand-rolled in each table with one class string between them
// (open-followups §102). It is NOT a `Button` variant on purpose: it is a row
// affordance — a full-width strip with only a dashed bottom rule — and `Button`'s
// bordered chip would turn it into a box, while a caller `className` cannot strip
// the variant's border (Tailwind resolves a conflict by stylesheet order).
// The caller keeps the cell around it (`<tr><td colSpan>`), so a table decides
// its own column span.

import { PlusIcon } from "./icons";
import { INTERACTIVE } from "./interaction-styles";

const ADD_ROW_CLASS =
  "group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-ui-dark-blue/5 hover:text-ui-dark-blue dark:hover:text-ui-light-grey dark:hover:bg-white/5";

export interface TableAddRowButtonProps {
  /** The visible text, e.g. "Add task". */
  label: string;
  /** The accessible name when it must differ from `label` — RAID qualifies it
   *  by category (WCAG 2.4.6). Omitted, the visible label is the name. */
  ariaLabel?: string;
  onClick: () => void;
}

export function TableAddRowButton({ label, ariaLabel, onClick }: TableAddRowButtonProps) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={`${ADD_ROW_CLASS} ${INTERACTIVE}`}>
      <PlusIcon aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
      {label}
    </button>
  );
}
