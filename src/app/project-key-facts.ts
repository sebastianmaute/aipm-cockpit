// Pure, i18n-free key-fact completeness model (spec §5.1). Feeds the
// `project-meta` Next-actions provider and the Projects-list meter.
//
// ★★ The emptiness test MIRRORS sanitizeProjectMeta's blank rules — `.trim()`
// for strings, `length > 0` for the two arrays — and a test pins that. A model
// that disagreed with what the backends store would render a meter that
// contradicts the data (the defect class resolveEffectiveFilters exists for).
// It is deliberately NOT mirrored against validateProjectMeta: after O-1 that
// checks only `name`, so the comparison would be vacuous for ten facts.

import type { ProjectMeta } from "./types";

/** The eleven facts O-1 de-mandated, in declaration order (spec §3.3). */
export const KEY_FACT_IDS = Object.freeze([
  "name",
  "code",
  "projectManager",
  "customer",
  "products",
  "profitCenter",
  "naceSection",
  "deployment",
  "contactPersons",
  "regulatory",
  "startDate",
] as const);

export type KeyFactId = (typeof KEY_FACT_IDS)[number];

export interface KeyFactCompleteness {
  filled: number;
  total: number;
  /** Declaration order, so a list rendered from it is stable between renders. */
  missing: KeyFactId[];
}

function isFactSet(meta: ProjectMeta, id: KeyFactId): boolean {
  switch (id) {
    case "contactPersons":
      return meta.contactPersons.length > 0;
    case "regulatory":
      return meta.regulatory.length > 0;
    default:
      // name, code, projectManager, customer, products, profitCenter,
      // naceSection, deployment ("" = not set since O-1), startDate.
      return meta[id].trim() !== "";
  }
}

export function keyFactCompleteness(meta: ProjectMeta): KeyFactCompleteness {
  const missing = KEY_FACT_IDS.filter((id) => !isFactSet(meta, id));
  return { filled: KEY_FACT_IDS.length - missing.length, total: KEY_FACT_IDS.length, missing };
}
