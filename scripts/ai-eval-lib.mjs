// scripts/ai-eval-lib.mjs — pure core of the AI prompt-quality harness (slice H).
//
// Everything that DECIDES anything lives here so it can be tested without a key
// and without the network. The CLI (scripts/ai-eval.ts) does I/O and nothing else.
//
// ★★ No network, no filesystem, no clock, no key. If a function here needs the
//    time or a file, it takes it as an argument. That is what makes the whole
//    verdict path testable, and the verdict is the only thing anyone will trust.
import { createHash } from "node:crypto";

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

/** Every id that gets a token in one run, in a FIXED order.
 *
 *  ★★★ The order is load-bearing: a token is regenerated until it differs from
 *  the token of every id EARLIER in this list at the same salt, so the mapping
 *  is total, deterministic and collision-free by construction. Reordering this
 *  list changes tokens. Adding an id to a run without adding it here removes
 *  that id's guarantee, which is why an unknown id throws. */
export const TOKEN_IDS = Object.freeze([
  "date", "viewScope", "insights", "activityRecap", "chatPointer",
  "anchor", "anchorDecoy",
]);

/** A nonsense token for one id, derived from (id, salt).
 *
 *  ★★ It must satisfy two properties at once and they pull apart: unique
 *  enough that no other part of a ~31k-token prompt can emit it by accident,
 *  and pronounceable enough that the model echoes it back verbatim rather than
 *  normalising it. A uuid satisfies the first and fails the second — the manual
 *  eval's tokens were syllabic for exactly this reason.
 *
 *  ★ The salt exists so a run can rotate tokens. A token reused across many
 *  runs risks ending up in a cached prefix somewhere and being answerable
 *  without reading the block, which would silently turn every probe green.
 *
 *  ★★★ Collision-free BY CONSTRUCTION, not merely unlikely. Measured against
 *  the first cut (a bare FNV-1a hash of `${id}:${salt}` with no retry): 11 of
 *  salts 1..5000 produced a within-run collision among the seven TOKEN_IDS,
 *  including `insights`/`activityRecap` at 2126 (each other's designated
 *  distractor) and `anchor`/`anchorDecoy` at 1418 — a target equal to its own
 *  decoy, which the scorer can only ever call ambiguous, silently, forever. So
 *  a candidate is regenerated, folding in an attempt counter, until it differs
 *  from the token of every id that sorts EARLIER in `TOKEN_IDS` at the same
 *  salt. The first id in the list never retries. An id outside `TOKEN_IDS` has
 *  no such guarantee, so it throws rather than silently risk a collision. */
export function plantedToken(id, salt) {
  const index = TOKEN_IDS.indexOf(id);
  if (index === -1) throw new Error(`unknown token id: ${id}`);
  // The comparison set is the ACTUAL resolved tokens of every earlier id, not
  // their attempt-0 candidates — an earlier id may itself have needed a retry
  // against ids before IT, and comparing against its raw candidate would miss
  // that. Each earlier id has strictly smaller index, so this recursion always
  // terminates at index 0.
  const earlierTokens = TOKEN_IDS.slice(0, index).map((other) =>
    plantedToken(other, salt),
  );
  let attempt = 0;
  let candidate = generateToken(id, salt, attempt);
  while (earlierTokens.includes(candidate)) {
    attempt += 1;
    candidate = generateToken(id, salt, attempt);
  }
  return candidate;
}

function generateToken(id, salt, attempt) {
  let h = 2166136261 >>> 0;
  const key = `${id}:${salt}:${attempt}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rand = mulberry32(h);
  let out = "";
  while (out.length < 16) {
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
 *  instruction, an elaborated answer is not a deviation from anything.
 *
 *  ★ `Object.freeze` on the outer array is shallow — each probe object is
 *  frozen individually too, so `PROBES[0].question = "x"` cannot silently
 *  succeed. */
export const PROBES = Object.freeze([
  Object.freeze({
    id: "date",
    distractorBlock: "viewScope",
    headroom: "distractor",
    question:
      "Two reference codes appear in your context. Reply with the code attached to today's date, exactly as written, and nothing else.",
  }),
  Object.freeze({
    id: "viewScope",
    distractorBlock: "date",
    headroom: "distractor",
    question:
      "Two reference codes appear in your context. Reply with the code attached to the current view's scope description, exactly as written, and nothing else.",
  }),
  Object.freeze({
    id: "insights",
    distractorBlock: "activityRecap",
    headroom: "depth",
    question:
      "Reply with the reference code carried by the last active insight, exactly as written, and nothing else.",
  }),
  Object.freeze({
    id: "activityRecap",
    distractorBlock: "insights",
    headroom: "distractor",
    question:
      "Reply with the reference code carried by the recent-activity summary, exactly as written, and nothing else.",
  }),
  Object.freeze({
    id: "chatPointer",
    distractorBlock: "insights",
    headroom: "distractor",
    question:
      "Reply with the reference code carried by the past-conversations pointer, exactly as written, and nothing else.",
  }),
]);

export function probeById(id) {
  const found = PROBES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown probe: ${id}`);
  return found;
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const FILLER_WORDS = [
  "the", "project", "schedule", "owner", "risk", "budget", "review", "phase",
  "milestone", "capacity", "vendor", "scope", "release", "sprint", "backlog",
  "stakeholder", "estimate", "baseline", "variance", "dependency",
];

/** The frozen shape of the drift anchor.
 *
 *  ★★★ CHANGING ANY FIELD HERE INVALIDATES EVERY RECORDED ANCHOR SCORE, which
 *  is precisely what the hash guard exists to catch. Do not tune these to make
 *  a run pass. If the anchor genuinely must change, that is a new series: say
 *  so in the artifact and stop comparing across the boundary.
 *
 *  `words` is sized so the anchor's token count lands near production's ~31k
 *  prefix — the dimension that governs whether a model change hurts is prefix
 *  length and needle depth, not content. */
export const ANCHOR_SPEC = Object.freeze({
  seed: 20260909,
  words: 24000,
  targetAtFraction: 0.72,
  decoyAtFraction: 0.31,
});

/** Deterministic filler with the two tokens planted at fixed depths.
 *
 *  ★★ Throws when `target === decoy`: a colliding pair makes every anchor
 *  response score as "ambiguous" — silently, forever, with nothing raising an
 *  error. `plantedToken` cannot produce that collision by construction, but
 *  this function takes both as plain strings, so a caller can still pass the
 *  same value twice.
 *
 *  ★★★ POSTCONDITION, not four argument validators: this function is scored by
 *  substring occurrence downstream (`scoreResponse`), so "the target occurs
 *  exactly once and the decoy occurs exactly once" IS the contract — a silent
 *  breach makes the drift reference meaningless rather than merely wrong. One
 *  assertion on the actual output subsumes every way the inputs could produce
 *  a bad text: an index tie at `words` small enough that `targetAt === decoyAt`
 *  (the target wins the if/else chain and the decoy never gets an iteration),
 *  a fraction of 1.0 landing on the never-visited index `spec.words` (the loop
 *  is `i < spec.words`), `words: 0` producing an empty string with neither
 *  token, and a decoy that is itself a substring of the target (or vice
 *  versa), which double-counts one of them. None of those four is reachable at
 *  the frozen `ANCHOR_SPEC` today, which is exactly why a postcondition is
 *  needed rather than a comment — the failure is invisible until someone
 *  edits the fractions or the word count. */
export function buildAnchorPrompt(spec, target, decoy) {
  if (target === decoy) {
    throw new Error(
      `buildAnchorPrompt: target and decoy must differ, both were ${JSON.stringify(target)}`,
    );
  }
  const rand = mulberry32(spec.seed);
  const targetAt = Math.floor(spec.words * spec.targetAtFraction);
  const decoyAt = Math.floor(spec.words * spec.decoyAtFraction);
  const out = [];
  for (let i = 0; i < spec.words; i += 1) {
    if (i === targetAt) out.push(`reference code ${target}`);
    else if (i === decoyAt) out.push(`reference code ${decoy}`);
    else out.push(FILLER_WORDS[Math.floor(rand() * FILLER_WORDS.length)]);
  }
  const text = out.join(" ");
  for (const [label, needle] of [
    ["target", target],
    ["decoy", decoy],
  ]) {
    const count = text.split(needle).length - 1;
    if (count !== 1) {
      throw new Error(
        `buildAnchorPrompt: expected the ${label} (${JSON.stringify(needle)}) to occur exactly once, got ${count}`,
      );
    }
  }
  return text;
}

/** Classify one response against its probe's target and decoy.
 *
 *  ★★ "hit" requires the target AND the absence of the decoy. A response
 *  carrying both did not answer the question that was asked — it named two
 *  blocks when one was requested — so it is recorded as `ambiguous` and counted
 *  as a miss. Folding it into `hit` would inflate every rate and would hide
 *  exactly the confusion a relocation is most likely to cause. */
export function scoreResponse(text, target, decoy) {
  const hay = String(text).toLowerCase();
  const hasTarget = hay.includes(target.toLowerCase());
  const hasDecoy = hay.includes(decoy.toLowerCase());
  if (hasTarget && hasDecoy) return "ambiguous";
  if (hasTarget) return "hit";
  if (hasDecoy) return "wrong-block";
  return "absent";
}

/** Fraction of outcomes that were hits. Empty is 0, never NaN — a NaN rate
 *  compares false against every threshold, so an arm that produced nothing
 *  would read as passing. */
export function hitRate(outcomes) {
  if (outcomes.length === 0) return 0;
  return outcomes.filter((o) => o === "hit").length / outcomes.length;
}

/** The four graded axes, pre-registered.
 *
 *  ★★★ DIRECTION AND MEANING ARE FIXED BEFORE ANY RUN AND CARRY NO THRESHOLDS.
 *  A threshold invented after seeing numbers is a verdict authored to fit them,
 *  and a guessed threshold that fires blocks work on a number nobody can
 *  defend. These report. Promoting one to a gate is its own decision, needing
 *  its own calibration evidence, and belongs in the spec — not in a patch. */
export const GRADED_AXES = Object.freeze([
  {
    id: "toolReaches",
    worseDirection: "higher",
    meaning:
      "the model called a tool for an answer already present in its context; currently at zero, so it has room only in the bad direction",
  },
  {
    id: "wrongBlock",
    worseDirection: "higher",
    meaning:
      "the decoy was returned instead of the target; unambiguous, it read something but not the block asked for",
  },
  {
    id: "adherence",
    worseDirection: "higher",
    meaning:
      "answers that elaborated where the probe said 'exactly as written', counted over hits only (a wrong-block miss is not an elaboration defect — that is wrongBlock's) — read it against its adherenceOf denominator, never in isolation: 0 means clean only when adherenceOf is the arm's full hit count, and means no signal at all when adherenceOf is 0. The one real difference the manual eval surfaced, still unadjudicated.",
  },
  {
    id: "outputTokens",
    worseDirection: "higher",
    meaning:
      "mean output tokens per response; billed at five times input, so a move is a cost fact even where it is not a quality fact — but a fall here alongside a fall in hit rate is not an improvement: a model that gives up tersely scores better on this axis than one that succeeds and explains itself, so read the two together, not this one alone",
  },
]);

/** Reduce one arm's responses to the graded vector.
 *
 *  ★★ `adherence` is a raw count over HITS ONLY, so it is meaningless without
 *  its denominator — `adherenceOf` (the arm's hit count) travels alongside it
 *  for exactly that reason. An arm that missed every rep has zero hits and
 *  therefore zero elaborations by construction: `adherence: 0` there is "no
 *  signal", not "perfect adherence", and reading it as the latter would let
 *  the worst possible run (zero hits) score the best possible value on a
 *  `worseDirection: "higher"` axis. Always read `adherence` against
 *  `adherenceOf`, never alone. */
export function gradeArm(responses, target) {
  const total = responses.length;
  const sum = (f) => responses.reduce((acc, r) => acc + f(r), 0);
  const hits = responses.filter((r) => r.outcome === "hit");
  return {
    toolReaches: sum((r) => r.toolUses ?? 0),
    wrongBlock: responses.filter((r) => r.outcome === "wrong-block").length,
    // Elaboration only means anything against a response that actually
    // named the target — a wrong-block response never touched the target's
    // wording at all, so it belongs to `wrongBlock`, not here.
    adherence: hits.filter(
      (r) => String(r.text).trim().toLowerCase() !== target.toLowerCase(),
    ).length,
    adherenceOf: hits.length,
    outputTokens: total === 0 ? 0 : sum((r) => r.outputTokens ?? 0) / total,
  };
}

function countOf(haystack, needle) {
  if (!needle) return 0;
  return String(haystack).toLowerCase().split(needle.toLowerCase()).length - 1;
}

/** The two halves of a request an arm can carry a relocatable block in: the
 *  cacheable system array, or the volatile turn context that rides in messages. */
const HALVES = Object.freeze(["system", "turn"]);

const otherHalf = (half) => (half === "system" ? "turn" : "system");

/** Everything that must hold before a single token is spent.
 *
 *  ★★★ THE POSITION CHECKS ARE THE LOAD-BEARING ONES. Without them a toggle
 *  that silently stopped toggling gives two IDENTICAL arms, and the run reports
 *  a confident "no regression" while comparing a layout with itself. That is
 *  worse than no harness: it is a green light nobody earned.
 *
 *  ★★★ EACH ARM DECLARES ITS OWN `expectedHalf`; THE HALF IS NEVER HARDCODED
 *  HERE, AND THAT IS A BUG FIX, NOT A GENERALISATION. This function used to
 *  assert "the target sits in arm A's `system`" as a constant. Measured against
 *  the app's real builders: `buildStableSystemBlocks` contains NONE of the
 *  relocatable block builders and `buildTurnContext` contains all of them, so
 *  every one of the five probes carries its target in the TURN half and the
 *  assertion was false for all of them. It was then buried under an
 *  `expectRelocated: false` escape hatch, which is how a load-bearing check
 *  ends up permanently switched off: the next person to register a real variant
 *  would have dropped the flag, watched every probe red, and concluded the
 *  harness was broken rather than the assertion.
 *
 *  ★★ STRICTLY STRONGER THAN THE PAIR IT REPLACES. Per arm: the target occurs
 *  exactly ONCE in the half that arm declares, and ZERO times in the other. The
 *  old pair only constrained arm A's system count and arm B's system count, so
 *  a token that moved somewhere unintended inside arm B passed. Both directions
 *  are needed — the once-in-expected half alone cannot see a token that ALSO
 *  leaked into the other half.
 *
 *  ★★★ WHAT THIS CANNOT PROVE, stated because the previous version's whole
 *  failure was an assertion nobody could state the limits of: when both arms
 *  declare the SAME half, these checks pass without proving the arms differ —
 *  because in that configuration they do not differ. That is the A/A self-test
 *  and it is honest there. It is NOT a licence for a real candidate to declare
 *  the same half twice: a candidate whose two arms sit in one half has no
 *  toggle, and this function will not say so. Relocation is proven only when
 *  the two declared halves differ.
 *
 *  ★★ A MISSING OR UNKNOWN `expectedHalf` IS A FAILURE, never a skip. A
 *  position check that does not know where to look would otherwise pass every
 *  input silently, which is precisely the vacuity this replaced.
 *
 *  Returns every failure rather than the first, so one run tells you the whole
 *  story instead of one fix per invocation. */
export function preflight(input) {
  const failures = [];
  const { target, decoy, armPrompts } = input;

  for (const arm of ["A", "B"]) {
    const p = armPrompts[arm];
    const whole = `${p.system}\n${p.turn}`;
    if (countOf(whole, target) !== 1) {
      failures.push(
        `arm ${arm}: target must appear exactly once in the assembled prompt, found ${countOf(whole, target)}`,
      );
    }
    if (countOf(whole, decoy) !== 1) {
      failures.push(
        `arm ${arm}: decoy must appear exactly once in the assembled prompt, found ${countOf(whole, decoy)}`,
      );
    }

    const expected = p.expectedHalf;
    if (!HALVES.includes(expected)) {
      failures.push(
        `arm ${arm}: expectedHalf must be "system" or "turn", got ${JSON.stringify(expected)} — an arm that does not declare which half carries the target cannot have its position checked`,
      );
      continue;
    }
    const other = otherHalf(expected);
    const inExpected = countOf(p[expected], target);
    const inOther = countOf(p[other], target);
    if (inExpected !== 1) {
      failures.push(
        `arm ${arm}: the target must appear exactly once in the ${expected} half this arm declares, found ${inExpected}`,
      );
    }
    if (inOther !== 0) {
      failures.push(
        `arm ${arm}: the target must not appear in the ${other} half — arm ${arm} declares ${expected}, found ${inOther} in ${other}`,
      );
    }
  }

  if (input.anchorHash !== input.recordedAnchorHash) {
    failures.push(
      `anchor hash mismatch: the generator changed (${input.anchorHash} vs recorded ${input.recordedAnchorHash})`,
    );
  }
  if (input.recordedRollingHash != null && input.rollingHash !== input.recordedRollingHash) {
    failures.push(
      `rolling prompt hash mismatch: the stored drift reference is not what the last run wrote`,
    );
  }

  return { ok: failures.length === 0, failures };
}

/** Turn a completed run into an exit code plus its reasons.
 *
 *  ★★★ WHAT THIS CAN AND CANNOT DECIDE, stated rather than implied. The hard
 *  fail is narrow on purpose: arm B scoring ZERO on a probe where arm A did
 *  not. At the default rep count a smaller drop is inside noise, so failing on
 *  it would block work on a coin flip. Smaller drops are recorded in `notes`
 *  for a human, and gating on a RATE difference needs a higher rep count and
 *  its own calibration — see the spec.
 *
 *  ★★ Three separate conditions all map to UNUSABLE and they are not the same
 *  thing: an incomplete run, a leaking negative control, and a null arm that
 *  itself fell. Each says the measurement is void; none says the candidate is
 *  bad. Collapsing any of them into REGRESSION blames a slice for a broken
 *  instrument. */
export function verdict(run) {
  const reasons = [];
  const notes = [];

  if (!run.complete) {
    return { code: EXIT.UNUSABLE, reasons: ["run did not complete"], notes };
  }

  if (!Array.isArray(run.perProbe) || run.perProbe.length === 0) {
    return {
      code: EXIT.UNUSABLE,
      reasons: ["run carried no probe results — nothing was measured"],
      notes,
    };
  }

  // Absence of measurement must never be indistinguishable from a clean
  // result. `0` is a real, meaningful score and must survive this check —
  // this is a finiteness check, not a truthiness check, on purpose.
  const isMeasured = (x) => typeof x === "number" && Number.isFinite(x);
  for (const p of run.perProbe) {
    for (const arm of ["A", "B", "X"]) {
      if (!isMeasured(p[arm])) {
        reasons.push(
          `${p.id}: arm ${arm} was not measured (got ${JSON.stringify(p[arm])}) — the probe is malformed, not a scored result`,
        );
      }
    }
  }
  if (reasons.length > 0) return { code: EXIT.UNUSABLE, reasons, notes };

  for (const p of run.perProbe) {
    if (p.X > 0) {
      reasons.push(
        `${p.id}: negative control scored ${p.X} — the token is reachable with its block deleted, so this probe measures nothing`,
      );
    }
    if (p.A === 0) {
      reasons.push(`${p.id}: arm A scored zero — the null regressed, the measurement is void`);
    }
  }
  if (reasons.length > 0) return { code: EXIT.UNUSABLE, reasons, notes };

  for (const p of run.perProbe) {
    if (p.B === 0 && p.A > 0) {
      reasons.push(`${p.id}: arm B scored zero where arm A scored ${p.A}`);
    } else if (p.B < p.A) {
      notes.push(`${p.id}: arm B ${p.B} below arm A ${p.A} — inside noise at this rep count, recorded only`);
    }
  }

  return { code: reasons.length > 0 ? EXIT.REGRESSION : EXIT.PASS, reasons, notes };
}

/** The environment variable that opts into spending real money. */
export const SPEND_ENV = "AI_EVAL_SPEND";

/** Decide whether this invocation spends.
 *
 *  ★★ Dry run is the DEFAULT, and it is not a degraded mode — it assembles
 *  every arm and runs every pre-flight assertion, so most breakage (a moved
 *  symbol, a leaking token, a touched anchor) surfaces with no key at all.
 *
 *  ★★★ The CI refusal outranks the opt-in. Every other `npm run` in this repo
 *  is free and safe, so this one is a tab-completion away from being added to a
 *  pipeline by somebody who assumed the same. */
export function spendDecision({ env, hasKey }) {
  const wantsSpend = Boolean(env[SPEND_ENV]);
  if (!wantsSpend) return { mode: "dry", code: EXIT.PASS };
  if (env.CI) {
    return { mode: "refuse", code: EXIT.UNUSABLE, reason: "refusing to spend: CI is set" };
  }
  if (!hasKey) {
    return { mode: "refuse", code: EXIT.UNUSABLE, reason: "refusing to spend: no API key available" };
  }
  return { mode: "live", code: EXIT.PASS };
}

/** The rolling drift reference is written by complete live runs and nothing else. */
export function shouldWriteRolling({ mode, complete }) {
  return mode === "live" && complete === true;
}
