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

const TOKEN_SYLLABLES = [
  "vor", "quen", "zil", "mab", "tresk", "oln", "phad", "urn", "glim", "sce",
  "drav", "yth", "kesh", "obr", "wint", "azu", "flen", "murk", "tsav", "erol",
];

/** A nonsense token for one block, derived from (blockId, salt).
 *
 *  ★★ It must satisfy two properties at once and they pull apart: unique
 *  enough that no other part of a ~31k-token prompt can emit it by accident,
 *  and pronounceable enough that the model echoes it back verbatim rather than
 *  normalising it. A uuid satisfies the first and fails the second — the manual
 *  eval's tokens were syllabic for exactly this reason.
 *
 *  ★ The salt exists so a run can rotate tokens. A token reused across many
 *  runs risks ending up in a cached prefix somewhere and being answerable
 *  without reading the block, which would silently turn every probe green. */
export function plantedToken(blockId, salt) {
  let h = 2166136261 >>> 0;
  const key = `${blockId}:${salt}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rand = mulberry32(h);
  let out = "";
  while (out.length < 10) {
    out += TOKEN_SYLLABLES[Math.floor(rand() * TOKEN_SYLLABLES.length)];
  }
  return out;
}

/** The five relocatable blocks, one probe each.
 *
 *  `id`               which snapshot-derived block carries the target token
 *  `distractorBlock`  which OTHER block carries the decoy
 *  `question`         the user turn; its only correct answer is the target
 *  `headroom`         how this probe is made non-trivial: "distractor",
 *                     "depth" or "composition" (see the spec's Probes section)
 *
 *  ★★ Every question says "exactly as written". That phrasing is what makes the
 *  `adherence` graded axis measurable at all — without an explicit terseness
 *  instruction, an elaborated answer is not a deviation from anything. */
export const PROBES = Object.freeze([
  {
    id: "date",
    distractorBlock: "viewScope",
    headroom: "distractor",
    question:
      "Two reference codes appear in your context. Reply with the code attached to today's date, exactly as written, and nothing else.",
  },
  {
    id: "viewScope",
    distractorBlock: "date",
    headroom: "distractor",
    question:
      "Two reference codes appear in your context. Reply with the code attached to the current view's scope description, exactly as written, and nothing else.",
  },
  {
    id: "insights",
    distractorBlock: "activityRecap",
    headroom: "depth",
    question:
      "Reply with the reference code carried by the last active insight, exactly as written, and nothing else.",
  },
  {
    id: "activityRecap",
    distractorBlock: "insights",
    headroom: "distractor",
    question:
      "Reply with the reference code carried by the recent-activity summary, exactly as written, and nothing else.",
  },
  {
    id: "chatPointer",
    distractorBlock: "insights",
    headroom: "distractor",
    question:
      "Reply with the reference code carried by the past-conversations pointer, exactly as written, and nothing else.",
  },
]);

export function probeById(id) {
  const found = PROBES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown probe: ${id}`);
  return found;
}
