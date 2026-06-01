import type { BudgetBucket, Role } from "./types";

export type RatePair = { internal: number; external: number };

/** Unweighted mean of the internal/external rates of every Role whose
 *  disciplineId === id. Returns { internal: 0, external: 0 } when the discipline
 *  has no roles. */
export function blendedDisciplineRate(id: number, roles: readonly Role[]): RatePair {
  const matched = roles.filter((r) => r.disciplineId === id);
  if (matched.length === 0) return { internal: 0, external: 0 };
  const sum = matched.reduce(
    (acc, r) => ({ internal: acc.internal + r.internalRate, external: acc.external + r.externalRate }),
    { internal: 0, external: 0 },
  );
  return { internal: sum.internal / matched.length, external: sum.external / matched.length };
}

/** True when a per-bucket override field is usable (a finite number >= 0). */
function usable(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
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
