import type { BudgetBucket, Role } from "./types";

export type RatePair = { internal: number; external: number };

/** Unweighted mean of the internal/external rates of every Role whose
 *  disciplineId === id. Returns { internal: 0, external: 0 } when the discipline
 *  has no roles.
 *
 *  ★★ An UNPRICED grade poisons the internal blend rather than being averaged in
 *  as a 0. `Role.internalRate` is a required number, so 0 is the only
 *  representation of "nobody has priced this" — it never means a free role.
 *  Averaging it produced a rate nobody entered (100 + unpriced ⇒ 50) that passed
 *  every downstream guard, so the panel presented a diluted cost as sound. A
 *  plausible wrong number is worse than a blank one. */
export function blendedDisciplineRate(id: number, roles: readonly Role[]): RatePair {
  const matched = roles.filter((r) => r.disciplineId === id);
  if (matched.length === 0) return { internal: 0, external: 0 };
  const sum = matched.reduce(
    (acc, r) => ({ internal: acc.internal + r.internalRate, external: acc.external + r.externalRate }),
    { internal: 0, external: 0 },
  );
  return {
    internal: matched.some((r) => r.internalRate <= 0) ? 0 : sum.internal / matched.length,
    // The external mean has the SAME dilution defect (an unpriced role drags it
    // down and understates T&M revenue), left untouched on purpose: gating it
    // cascades into revenue, consumption and T&M win/loss, which are ungated by
    // design because they are knowable without a rate card. That is its own
    // design decision, tracked separately — not an oversight.
    external: sum.external / matched.length,
  };
}

/** True when the discipline has roles and at least one is unpriced. A discipline
 *  with NO roles is false: it has no grade to price, so that guidance would send
 *  the user after something that does not exist. */
export function disciplineHasUnpricedGrade(id: number, roles: readonly Role[]): boolean {
  const matched = roles.filter((r) => r.disciplineId === id);
  return matched.length > 0 && matched.some((r) => r.internalRate <= 0);
}

/** True when a per-bucket override field is usable (a finite number >= 0). */
function usable(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** True when the bucket prices itself directly, making the rate card behind it
 *  irrelevant — an override wins over the blend, so it must also suppress the
 *  unpriced-grade poison. */
export function hasUsableInternalOverride(
  bucket: Pick<BudgetBucket, "rateOverrideInternal">,
): boolean {
  return usable(bucket.rateOverrideInternal);
}

/** Effective rate for a row: each field uses the bucket override when usable,
 *  otherwise the fallback (role rate or blended discipline rate). */
export function effectiveRates(
  bucket: Pick<BudgetBucket, "rateOverrideInternal" | "rateOverrideExternal">,
  fallback: RatePair,
): RatePair {
  return {
    internal: usable(bucket.rateOverrideInternal) ? bucket.rateOverrideInternal : fallback.internal,
    external: usable(bucket.rateOverrideExternal) ? bucket.rateOverrideExternal : fallback.external,
  };
}
