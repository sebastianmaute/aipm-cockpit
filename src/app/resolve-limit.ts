/**
 * Coerce a model-supplied result cap.
 *
 * Absent / non-numeric / non-finite → `fallback`; anything above `max` is
 * clamped down to it. Fractional limits FLOOR, so `2.9` caps at 2.
 *
 * ★★★ THE FLOOR HAPPENS BEFORE THE NON-POSITIVE TEST, NOT AFTER, and the order
 * is the whole point. `raw` is model-supplied untrusted input, so `0.5` is
 * reachable — and testing `raw <= 0` first lets it through, after which the
 * floor yields a cap of ZERO. The result is an empty page that still reports
 * `truncated: true`: no rows, while asserting that rows were withheld. That is
 * the one output combination that actively misleads the caller, since
 * `truncated` is the field the model reads to decide whether it may claim a
 * complete answer.
 *
 * ★ Falling back to `fallback` rather than clamping up to 1: a limit that
 * floors to nothing is a nonsense request, and every other nonsense value here
 * (absent, NaN, -1, 0) already answers with the fallback. Returning a
 * single-item page instead would make `0.5` the only input whose garbage-ness
 * is silently reinterpreted as a real, very specific instruction.
 *
 * ★ `Infinity` therefore yields `fallback`, not `max` — it fails the finite
 * test before it can reach the clamp. Defensible (it is not a number the caller
 * meant) and pinned by a test so it cannot change silently.
 */
export function resolveLimit(
  raw: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const whole = Math.floor(raw);
  if (whole <= 0) return fallback;
  return Math.min(whole, max);
}
