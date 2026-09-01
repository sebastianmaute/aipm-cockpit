"use client";

import type { ReactNode } from "react";
import { XMarkIcon } from "../icons";
import { IconButton } from "../icon-button";

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
 * `key`, and the (differently-formatted) aria-label.
 *
 * ★ It no longer "emits the exact prior DOM", which it did when extracted: the
 *   remove glyph is now the shared `IconButton` danger variant rather than a
 *   hand-rolled copy of it, so the button gains that primitive's padding,
 *   radius and hover tint. The accessible name is unchanged and still the
 *   caller's.
 */
export function RemovableChipRow({ label, ariaLabel, onRemove }: RemovableChipRowProps) {
  return (
    <li className="flex items-center justify-between rounded-md bg-surface-muted px-3 py-1.5 text-sm">
      <span className="text-foreground">{label}</span>
      <IconButton onClick={onRemove} label={ariaLabel} title={ariaLabel} variant="danger">
        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
      </IconButton>
    </li>
  );
}
