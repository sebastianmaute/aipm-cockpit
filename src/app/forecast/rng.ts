/** Seeded PRNG so a forecast is reproducible for the same inputs (§502). */

const MULBERRY_STEP = 0x6d2b79f5;

/** A float stream in [0, 1) that can also jump `calls` draws ahead without computing them. */
export type Rng = (() => number) & { skip: (calls: number) => void };

/**
 * Mulberry32: returns floats in [0, 1). Its state only adds a constant per draw, so `skip(n)` lands on
 * exactly the state `n` draws would leave: an early exit that skips draws leaves every later trial as it was.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + MULBERRY_STEP) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    skip: (calls: number) => {
      a = (a + Math.imul(calls, MULBERRY_STEP)) >>> 0;
    },
  });
}

/** FNV-1a 32-bit over the parts joined by "|"; unsigned. */
export function seedFrom(parts: readonly (string | number)[]): number {
  const text = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
