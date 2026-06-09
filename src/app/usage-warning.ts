// src/app/usage-warning.ts
// Pure helper — no React dependency.

/**
 * Returns true when usage crosses the 80 % threshold of `cap` between two
 * consecutive recordings.  Guards:
 *   - cap <= 0  → never fire (disabled / unconfigured cap)
 *   - prevUsed already >= threshold → don't re-fire
 */
export function crossed80(prevUsed: number, nextUsed: number, cap: number): boolean {
  if (cap <= 0) return false;
  const threshold = 0.8 * cap;
  return prevUsed < threshold && nextUsed >= threshold;
}
