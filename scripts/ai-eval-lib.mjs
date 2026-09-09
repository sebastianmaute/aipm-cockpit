// scripts/ai-eval-lib.mjs — pure core of the AI prompt-quality harness (slice H).
//
// Everything that DECIDES anything lives here so it can be tested without a key
// and without the network. The CLI (scripts/ai-eval.ts) does I/O and nothing else.
//
// ★★ No network, no filesystem, no clock, no key. If a function here needs the
//    time or a file, it takes it as an argument. That is what makes the whole
//    verdict path testable, and the verdict is the only thing anyone will trust.

/** Exit codes, matching version-sync-check and both followups gates.
 *
 *  ★★★ 1 and 2 demand OPPOSITE responses and a single code cannot be read
 *  without opening the log. 2 is the load-bearing one: a scan that reads
 *  nothing passes everything, so a harness that could not measure must never
 *  report PASS. */
export const EXIT = Object.freeze({ PASS: 0, REGRESSION: 1, UNUSABLE: 2 });

/** Deterministic PRNG. Seeded, dependency-free and stable across Node versions
 *  — all three are required, because the anchor arm's whole value is that it
 *  regenerates byte-identically forever. Math.random() would silently make the
 *  drift reference a different prompt on every run. */
export function mulberry32(seed) {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
