// src/app/field-visibility.ts
import { MODAL_FIELDS, MODAL_IDS, type FieldTier, type ModalId } from "./modal-fields";

export interface ModalVisibility {
  /** Explicit visible field ids; always includes every required field. */
  fields: readonly string[];
}
export interface FieldVisibilityConfig {
  [modalId: string]: ModalVisibility;
}

const TIER_RANK: Record<FieldTier, number> = { simple: 0, advanced: 1, full: 2 };
const TIERS: readonly FieldTier[] = ["simple", "advanced", "full"];
const DEFAULT_TIER: FieldTier = "advanced";

function knownIds(modalId: ModalId): Set<string> {
  return new Set(MODAL_FIELDS[modalId].map((f) => f.id));
}
function requiredIds(modalId: ModalId): string[] {
  return MODAL_FIELDS[modalId].filter((f) => f.required).map((f) => f.id);
}

/** Field ids belonging to a tier (this tier and all lower ones). */
export function tierFields(modalId: ModalId, tier: FieldTier): string[] {
  const rank = TIER_RANK[tier];
  return MODAL_FIELDS[modalId].filter((f) => TIER_RANK[f.tier] <= rank).map((f) => f.id);
}

/** Visible field ids for a modal given its config (undefined → Advanced default). */
export function visibleFields(modalId: ModalId, cfg?: ModalVisibility): Set<string> {
  const known = knownIds(modalId);
  if (!cfg) return new Set(tierFields(modalId, DEFAULT_TIER));
  return new Set(cfg.fields.filter((id) => known.has(id)));
}

/** Build a config from a tier baseline. */
export function applyTier(modalId: ModalId, tier: FieldTier): ModalVisibility {
  return { fields: tierFields(modalId, tier) };
}

/** Toggle a field in/out of the visible set (required ids are no-ops). */
export function toggleField(
  modalId: ModalId,
  cfg: ModalVisibility,
  fieldId: string,
): ModalVisibility {
  if (requiredIds(modalId).includes(fieldId)) return cfg;
  if (!knownIds(modalId).has(fieldId)) return cfg;
  const set = new Set(cfg.fields);
  if (set.has(fieldId)) set.delete(fieldId);
  else set.add(fieldId);
  // Re-order to registry order for byte-stable serialization.
  const ordered = MODAL_FIELDS[modalId].filter((f) => set.has(f.id)).map((f) => f.id);
  return { fields: ordered };
}

/** Derive the segmented-control label: a named tier if the set matches it exactly, else "custom". */
export function tierOf(modalId: ModalId, cfg?: ModalVisibility): FieldTier | "custom" {
  const have = cfg ? new Set(cfg.fields.filter((id) => knownIds(modalId).has(id)))
                   : new Set(tierFields(modalId, DEFAULT_TIER));
  for (const tier of TIERS) {
    const want = new Set(tierFields(modalId, tier));
    if (want.size === have.size && [...want].every((id) => have.has(id))) return tier;
  }
  return "custom";
}

/** Validate stored config: drop unknown modals/fields, always re-add required, drop empties. */
export function sanitizeFieldVisibility(raw: unknown): FieldVisibilityConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: FieldVisibilityConfig = {};
  for (const modalId of MODAL_IDS) {
    const entry = src[modalId];
    if (!entry || typeof entry !== "object") continue;
    const fieldsRaw = (entry as Record<string, unknown>).fields;
    if (!Array.isArray(fieldsRaw)) continue;
    const known = knownIds(modalId);
    const kept = new Set(fieldsRaw.filter((x): x is string => typeof x === "string" && known.has(x)));
    for (const r of requiredIds(modalId)) kept.add(r);
    const ordered = MODAL_FIELDS[modalId].filter((f) => kept.has(f.id)).map((f) => f.id);
    out[modalId] = { fields: ordered };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
