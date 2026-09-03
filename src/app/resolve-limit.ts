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
/**
 * Coerce raw model-supplied JSON into a finite number, or `undefined`.
 *
 * ★★★ A NUMERIC STRING IS COMPREHENSIBLE INTENT, NOT MALFORMED INPUT. Models
 * emit `"10"` for a numeric field routinely, and a bare `typeof raw ===
 * "number"` test drops it — silently, on a request whose meaning was never in
 * doubt. What that costs depends on the caller's fallback: `list_tasks` returned
 * the WHOLE register, while `search_chats` merely widens to its default page
 * size. Both are wrong in the same direction, so the coercion lives here once
 * rather than being re-spelled per call site.
 *
 * ★★ POLICY STAYS WITH THE CALLER. This applies NO floor, NO positivity test
 * and NO clamp — `resolveLimit` falls back on a non-positive value while
 * `listTasksEnvelope` reads it as "no limit", and collapsing those two into one
 * helper would force a single answer on two different contracts.
 *
 * ★★ A BLANK STRING NEEDS NO SPECIAL CASE, and adding one is dead code: an
 * earlier version guarded `raw.trim() !== ""`, but `Number("")` and
 * `Number("  ")` are both `0`, and every caller already treats 0 as "no usable
 * limit". Measured over 16 inputs (`""`, `"  "`, `"\t\n"`, NBSP, ZWSP, `"abc"`,
 * `"0x10"`, `" 10 "`, `"Infinity"`, `1e21`, booleans, null, `{}`, `[]`): the
 * guard changed the observable result for NONE of them.
 *
 * ★ Booleans and `null` are deliberately NOT coerced — `Number(true)` is 1, so
 * a `true` would otherwise become a real, very specific page size of one.
 */
export function coerceNumericInput(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

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
