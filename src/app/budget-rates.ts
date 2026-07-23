import type { BudgetBucket, Role } from "./types";

export type RatePair = { internal: number; external: number };

/** A rate that cannot be used to cost anything: absent-as-0, negative, or
 *  malformed. `internalRate` is a required number, so 0 is the only
 *  representation of "unpriced" and never means a free role. */
function isUnpricedRate(v: number): boolean {
  return !Number.isFinite(v) || v <= 0;
}

/** Unweighted mean of the internal/external rates of every Role whose
 *  disciplineId === id. Returns { internal: 0, external: 0 } when the discipline
 *  has no roles.
 *
 *  ★★ An UNPRICED grade poisons the internal blend rather than being averaged in
 *  as a 0. `Role.internalRate` is a required number, so 0 is the only
 *  representation of "nobody has priced this" — it never means a free role.
 *  Averaging it produced a rate nobody entered (100 + unpriced ⇒ 50) that passed
 *  every downstream guard, so the panel presented a diluted cost as sound. A
 *  plausible wrong number is worse than a blank one.
 *
 *  ★ SCOPE: this guards against UNPRICED, not against UNDERPRICED. `sanitizeRate`
 *  rounds to 2dp, so 0.004 collapses to 0 and is poisoned while 0.005 becomes
 *  0.01 and blends to a figure just as misleading. That is correct by this fix's
 *  own premise — 0.01 is a rate somebody entered — and the residual dilution is
 *  inherent to an unweighted mean. Do not read the guard as protection against
 *  dilution generally. */
export function blendedDisciplineRate(id: number, roles: readonly Role[]): RatePair {
  const matched = roles.filter((r) => r.disciplineId === id);
  if (matched.length === 0) return { internal: 0, external: 0 };
  const unpriced = matched.some((r) => isUnpricedRate(r.internalRate));
  const sum = matched.reduce(
    (acc, r) => ({ internal: acc.internal + r.internalRate, external: acc.external + r.externalRate }),
    { internal: 0, external: 0 },
  );
  return {
    internal: unpriced ? 0 : sum.internal / matched.length,
    // The external mean has the SAME dilution defect (an unpriced role drags it
    // down and understates T&M revenue), left untouched on purpose: gating it
    // cascades into revenue, consumption and T&M win/loss, which are ungated by
    // design because they are knowable without a rate card. That is its own
    // design decision, tracked separately — not an oversight.
    //
    // ★★ That exemption covers DILUTION ONLY. A malformed (NaN/Infinity) external
    // still propagates into revenue, and that is also deliberate: mapping it to 0
    // here would be strictly WORSE. The internal side can collapse to 0 safely
    // because `uncostedWork`/`costIsKnowable` downstream catch a 0 and blank the
    // figure; there is no `revenueIsKnowable` counterpart, so a 0 external would
    // render as a real "earned nothing" and silently understate margin — the
    // plausible-wrong-number class this module exists to prevent. NaN is ugly but
    // it fails LOUDLY and cannot be mistaken for a reading. Unreachable in
    // practice: `sanitizeRate` maps any non-finite input to 0 before persistence.
    external: sum.external / matched.length,
  };
}

/** True when the discipline has roles and at least one is unpriced. A discipline
 *  with NO roles is false: it has no grade to price, so that guidance would send
 *  the user after something that does not exist. */
export function disciplineHasUnpricedGrade(id: number, roles: readonly Role[]): boolean {
  const matched = roles.filter((r) => r.disciplineId === id);
  return matched.length > 0 && matched.some((r) => isUnpricedRate(r.internalRate));
}

/** True when a per-bucket override field is usable (a finite number >= 0). */
function usable(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** True when the bucket carries a well-formed internal rate override — present,
 *  finite, non-negative. Parity with `effectiveRates` is the point: that
 *  function treats a 0 override as usable, so a caller suppressing the
 *  unpriced-grade notice MUST use the same test or the two diverge and the
 *  bucket gets told to price disciplines that its own override has already
 *  overruled. Note 0 is *present* but prices nothing — it resolves to a 0 rate
 *  and is caught downstream as unrated work, which is the honest signal. */
export function hasInternalOverride(
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
