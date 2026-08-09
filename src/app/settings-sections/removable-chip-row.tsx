"use client";

import type { ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
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
        title={ariaLabel}
        className={`text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
      >
        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}
