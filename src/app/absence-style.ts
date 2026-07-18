// src/app/absence-style.ts
//
// Shared, i18n-free absence-type visual mapping used by BOTH the resource
// Calendar and the resource Planner/workload capacity view so absence colours
// read identically across surfaces. Pure — returns AIPM palette token class
// strings only (no off-palette colours). The strings MUST stay byte-identical
// to the calendar's original `absenceCellBg`/`absenceGlyph` (a source-scan test
// pins the mapping).

import type { AbsenceType } from "./types";

/** Cell/marker background tint (+ hover) for an absence type. */
export function absenceBg(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "bg-ui-blue/30 hover:bg-ui-blue/40 dark:bg-ui-blue/25 dark:hover:bg-ui-blue/35";
    case "sick":
      return "bg-ui-pink/30 hover:bg-ui-pink/40 dark:bg-ui-pink/25 dark:hover:bg-ui-pink/35";
    case "training":
      return "bg-ui-purple/30 hover:bg-ui-purple/40 dark:bg-ui-purple/25 dark:hover:bg-ui-purple/35";
    default:
      return "bg-ui-medium-grey/45 hover:bg-ui-medium-grey/55 dark:bg-ui-medium-grey/35 dark:hover:bg-ui-medium-grey/45";
  }
}

/** Non-hover legend swatch tint for an absence type (matches {@link absenceBg}
 *  resting state). Used by the legend rows. */
export function absenceLegendBg(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "bg-ui-blue/30 dark:bg-ui-blue/25";
    case "sick":
      return "bg-ui-pink/30 dark:bg-ui-pink/25";
    case "training":
      return "bg-ui-purple/30 dark:bg-ui-purple/25";
    default:
      return "bg-ui-medium-grey/45 dark:bg-ui-medium-grey/35";
  }
}

/** Single-letter glyph for an absence type. */
export function absenceGlyph(type: AbsenceType): string {
  switch (type) {
    case "vacation":
      return "V";
    case "sick":
      return "S";
    case "training":
      return "T";
    default:
      return "O";
  }
}
