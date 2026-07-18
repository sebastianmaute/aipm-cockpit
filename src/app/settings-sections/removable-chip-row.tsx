"use client";

import type { ReactNode } from "react";
import { INTERACTIVE } from "../interaction-styles";

interface RemovableChipRowProps {
  /** Visible row text (already localized by the caller). */
  label: ReactNode;
  /** Row-unique accessible name for the remove button (caller builds it). */
  ariaLabel: string;
  onRemove: () => void;
}

/**
 * A single removable list row shared by the Localization + Timezone settings
 * sections: the muted rounded `<li>` with a label on the left and an ✕ remove
 * button on the right. Presentational — the caller owns the `<ul>`/map, the
 * `key`, and the (differently-formatted) aria-label. Emits the exact prior DOM.
 */
export function RemovableChipRow({ label, ariaLabel, onRemove }: RemovableChipRowProps) {
  return (
    <li className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-1.5 text-sm">
      <span className="text-foreground">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={ariaLabel}
        className={`text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </li>
  );
}
