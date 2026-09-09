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
  // ★★★ THE HARDENING TOKENS ARE APPENDED, NEVER INSERTED, and that is
  //     load-bearing. `plantedToken` regenerates a candidate only against ids
  //     EARLIER in this list, so appending leaves all seven original tokens
  //     byte-identical at every salt — which is what keeps the committed
  //     rolling drift reference replayable and the three recorded runs
  //     comparable. Inserting one of these above `chatPointer` could change a
  //     later id's token on some salt, and the replay would then miss every
  //     time and read as catastrophic drift.
  "datePrev", "viewScopePrev", "insightsPrev", "activityRecapPrev",
  "chatPointerAlt1", "chatPointerAlt2",
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
 *  `label`            how that block INTRODUCES its token in the prompt, and
 *                     the exact phrase this probe's question asks for
 *  `distractorBlock`  which OTHER block carries the decoy
 *  `question`         the user turn; its only correct answer is the target
 *  `headroom`         how this probe is made non-trivial: "distractor",
 *                     "depth" or "composition" (see the spec's Probes section)
 *
 *  ★★★ EVERY LABEL IS DISTINCT, AND THAT IS A BUG FIX. All five blocks used to
 *  introduce their token as a "reference code" and every question asked for
 *  "the reference code carried by <description of the block>", so the model had
 *  to tell five IDENTICALLY-labelled codes apart from prose descriptions alone
 *  — and the vaguest description loses systematically. Measured 2026-09-09: on
 *  three arm-A reps the `chatPointer` probe returned, identically, the DATE
 *  block's token, which sits on the first line of the turn context. The model
 *  was not failing to reach the block; it was returning the most SALIENT code.
 *  A probe that measures salience while claiming to measure reachability is
 *  worse than no probe — it reports a real number about the wrong thing.
 *
 *  ★★ The labels are what the QUESTIONS ask for, so the two cannot be edited
 *  apart: `probeById(id).label` is the single source the CLI's snapshot text
 *  interpolates, and a unit test asserts each question contains its OWN label
 *  and none of the other four.
 *
 *  ★★ DIFFICULTY STILL COMES FROM DEPTH AND DISTRACTION, not from ambiguity.
 *  The other four codes are still present, the decoy still rides a different
 *  block, the token is still nonsense the prompt cannot otherwise emit, and
 *  placement is unchanged. What was removed is the model's need to GUESS which
 *  of five identical labels was meant.
 *
 *  ★★ Every question still says "exactly as written". That phrasing is what
 *  makes the `adherence` graded axis measurable at all — without an explicit
 *  terseness instruction, an elaborated answer is not a deviation from
 *  anything. Do not soften it.
 *
 *  ★ `Object.freeze` on the outer array is shallow — each probe object is
 *  frozen individually too, so `PROBES[0].question = "x"` cannot silently
 *  succeed. */
/** ★★★ THE DIFFICULTY KNOBS — THE ONE PLACE TO EDIT.
 *
 *  Turn a probe UP or DOWN by changing ONE line here. Nothing else needs
 *  touching: the block text, the question and the planted-token universe are
 *  all DERIVED from these three switches, so a knob and the prompt it governs
 *  cannot drift apart. That derivation is the whole point — the two defects
 *  this harness has shipped were both a prompt and a question disagreeing.
 *
 *  `competitor`   plant a SECOND, near-miss code in the SAME block, labelled
 *                 "previous <label>" while the target becomes "current
 *                 <label>", and ask for the current one. The strongest lever,
 *                 and it stays unambiguous because the distinguishing
 *                 attribute is written in the prompt text itself. Off → one
 *                 code, plain label.
 *  `fillerBefore` how many realistic, code-free items precede the target
 *                 INSIDE its block, so the target is neither the first nor the
 *                 most salient thing in it.
 *                 ★★ INERT for `date` and `activityRecap`: those tokens ride a
 *                 single short field the app fills with a date and a timestamp
 *                 (`today`, `ActivitySummary.latestAt`), and there is no list
 *                 to pad. Padding them would make the block unrepresentative
 *                 of what the app sends, which is worse than an easy probe.
 *  `composition`  the answer requires combining TWO blocks: the code belongs to
 *                 the item satisfying a condition stated in a DIFFERENT block.
 *                 ★★★ AT MOST ONE PROBE, pinned by a test. If composition
 *                 proves too hard we want to learn it from one probe rather
 *                 than lose a whole run — and it is the only mechanism here
 *                 that changes WHAT the probe measures (it now needs two
 *                 blocks, so a failure does not say which one was missed).
 *                 ★★ Implemented for `chatPointer` ONLY — its block is the one
 *                 that naturally holds a LIST to select from. Switching it on
 *                 elsewhere needs block text for that block too, and the CLI
 *                 refuses at pre-flight rather than silently asking an
 *                 unanswerable question.
 *
 *  ★★★ WHATEVER YOU TURN, THE RULE IS: DIFFICULTY COMES FROM RETRIEVAL EFFORT,
 *  NEVER FROM AMBIGUITY. Every question must keep exactly one answer a careful
 *  reader would agree on. An ambiguous probe is not a hard probe — it is a
 *  broken one, and it fails in a way that looks identical to a regression.
 *  `chatPointer` scored 0.0 for two runs on exactly that mistake. */
export const PROBE_HARDENING = Object.freeze({
  date: Object.freeze({ competitor: true, fillerBefore: 0, composition: false }),
  viewScope: Object.freeze({ competitor: true, fillerBefore: 4, composition: false }),
  insights: Object.freeze({ competitor: true, fillerBefore: 4, composition: false }),
  activityRecap: Object.freeze({ competitor: true, fillerBefore: 0, composition: false }),
  chatPointer: Object.freeze({ competitor: false, fillerBefore: 2, composition: true }),
});

/** The two qualifiers a `competitor` probe writes into its block and its
 *  question. Exported so the CLI's prompt text and the question come from ONE
 *  pair of strings. */
export const CURRENT_QUALIFIER = "current";
export const PREVIOUS_QUALIFIER = "previous";

/** The fixed opening of every probe question. */
export const QUESTION_PREAMBLE =
  "Several labelled reference codes appear in your context.";

/** The extra codes the composition probe's block plants beside its target —
 *  the near-miss conversations the model must NOT return. */
export const COMPOSITION_ALT_IDS = Object.freeze(["chatPointerAlt1", "chatPointerAlt2"]);

const PROBE_SPECS = [
  { id: "date", label: "calendar code", distractorBlock: "viewScope", headroom: "distractor" },
  { id: "viewScope", label: "view code", distractorBlock: "date", headroom: "depth" },
  { id: "insights", label: "finding code", distractorBlock: "activityRecap", headroom: "depth" },
  { id: "activityRecap", label: "activity code", distractorBlock: "insights", headroom: "distractor" },
  {
    id: "chatPointer",
    label: "transcript code",
    distractorBlock: "insights",
    headroom: "composition",
    // ★★ Names the DISCRIMINATING ATTRIBUTE, not the block. The current view is
    //    stated in the VIEW SCOPE block ('the user is looking at the "budget"
    //    view') and exactly one listed conversation is about that view, so the
    //    answer is unique — but reaching it needs both blocks. Deliberately
    //    avoids the literal phrase "view code", which is another probe's label.
    compositionAsk:
      "the transcript code of the earlier conversation about the view you are currently looking at",
  },
];

function askFrom(spec) {
  const h = PROBE_HARDENING[spec.id];
  if (h?.composition) return spec.compositionAsk;
  return h?.competitor ? `the ${CURRENT_QUALIFIER} ${spec.label}` : `the ${spec.label}`;
}

function questionFrom(spec) {
  return `${QUESTION_PREAMBLE} Reply with ${askFrom(spec)}, exactly as written, and nothing else.`;
}

export const PROBES = Object.freeze(
  PROBE_SPECS.map((spec) => Object.freeze({ ...spec, question: questionFrom(spec) })),
);

/** The label the target's own block writes beside the token: qualified when a
 *  near-miss competitor shares the block, plain otherwise. */
export function plantLabel(id) {
  return PROBE_HARDENING[id]?.competitor
    ? `${CURRENT_QUALIFIER} ${probeById(id).label}`
    : probeById(id).label;
}

/** The label the near-miss competitor writes. Only meaningful where
 *  `competitor` is on; the CLI plants nothing for it otherwise. */
export function priorLabel(id) {
  return `${PREVIOUS_QUALIFIER} ${probeById(id).label}`;
}

/** Every token id the snapshot plants, DERIVED from the knobs.
 *
 *  ★★ Derived and not listed, because pre-flight asserts each of these appears
 *  EXACTLY ONCE in the assembled prompt. A hardcoded list would fail that
 *  assertion the moment a knob was turned off — which is the failure mode that
 *  would push someone to weaken the assertion instead of the list. */
export function plantedProbeIds() {
  const ids = [];
  for (const p of PROBES) {
    const h = PROBE_HARDENING[p.id] ?? {};
    ids.push(p.id);
    if (h.competitor) ids.push(`${p.id}Prev`);
    if (h.composition) ids.push(...COMPOSITION_ALT_IDS);
  }
  return ids;
}

/** The probe `composition` is switched on for, or null. */
export function compositionProbeId() {
  const on = PROBES.filter((p) => PROBE_HARDENING[p.id]?.composition);
  return on.length > 0 ? on[0].id : null;
}

/** The label a block introduces its token with. The CLI's snapshot text reads
 *  it from here so the prompt and the question can never name it differently —
 *  a silent mismatch would make the probe unanswerable while every gate stayed
 *  green. */
export function labelOf(id) {
  return probeById(id).label;
}

/** Planted tokens that contain one another, which nothing else can detect.
 *
 *  ★★★ `plantedToken` guarantees the tokens are DISTINCT, never that none is a
 *  SUBSTRING of another — and `scoreResponse` matches by substring across the
 *  whole planted set, so one containment would make every correct answer score
 *  "ambiguous", silently and forever. The exposure grew tenfold when the scorer
 *  widened from one decoy to all five tokens, which is why this is asserted now
 *  and was not before.
 *
 *  ★★ IT IS A PRE-FLIGHT ASSERTION AND DELIBERATELY NOT A CHANGE TO THE MINT.
 *  Rejecting substrings inside `plantedToken` would give different tokens at
 *  the SAME salt, and the rolling drift reference holds a previous run's bytes
 *  that are scored against `plantedToken(id, thatRunsSalt)` — a re-mint would
 *  make the replay miss every time and read as catastrophic drift. The repair
 *  for a conflict is to rotate `AI_EVAL_SALT`, not to change how tokens are
 *  made. */
export function tokenSubstringConflicts(tokens) {
  const entries = Object.entries(tokens ?? {}).filter(
    ([, t]) => typeof t === "string" && t.length > 0,
  );
  const conflicts = [];
  for (const [outerId, outer] of entries) {
    for (const [innerId, inner] of entries) {
      if (outerId === innerId) continue;
      if (outer.toLowerCase().includes(inner.toLowerCase())) {
        conflicts.push(`${innerId}'s token is contained in ${outerId}'s`);
      }
    }
  }
  return conflicts;
}

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

/** Classify one response against the WHOLE planted token set for the run.
 *
 *  `tokens` is `{blockId: token}` for every token planted in the prompt this
 *  reply answered — not just this probe's designated decoy. Returns
 *  `{outcome, otherBlocks}`, where `otherBlocks` names every NON-target block
 *  whose token appears, sorted, and is empty on `hit` and `absent`.
 *
 *  The four outcomes, stated plainly because `verdict` and `gradeArm` both read
 *  them and each means something different about what the model did:
 *
 *  - `hit`         — the target and no other planted token. The only success.
 *  - `wrong-block` — no target, but at least one OTHER planted token. It read
 *                    something, just not the block it was asked for, and
 *                    `otherBlocks` says which.
 *  - `ambiguous`   — the target AND at least one other planted token. Counted
 *                    as a MISS: it named several blocks when one was asked for.
 *  - `absent`      — no planted token at all. It produced nothing usable.
 *
 *  ★★★ THE SET, NOT THE DESIGNATED DECOY, AND THAT IS A BUG FIX. This used to
 *  take one `decoy` string, so a reply carrying a THIRD probe's token scored
 *  `absent` — "read nothing" and "read the wrong thing" were indistinguishable
 *  in exactly the case that matters most. The first full live run therefore
 *  reported `wrongBlock: 0` everywhere while the model was returning the DATE
 *  block's token on every `chatPointer` rep. `otherBlocks` is the diagnostic
 *  payload: naming the block is what turned three opaque zeros into an obvious
 *  answer.
 *
 *  ★★ AMBIGUOUS STILL OUTRANKS HIT, and the widening makes that rule STRONGER,
 *  not weaker: any other planted token demotes a hit, not merely the designated
 *  decoy. That rule is what stops a context-dumping model scoring a perfect
 *  run, and folding it into `hit` would inflate every rate while hiding exactly
 *  the confusion a relocation is most likely to cause.
 *
 *  ★ The target is excluded from `otherBlocks` BY VALUE, not by key, so a
 *  caller whose map is keyed differently (the anchor arm's is) cannot
 *  accidentally have the target counted against itself. */
export function scoreResponse(text, target, tokens) {
  const hay = String(text).toLowerCase();
  const wanted = String(target).toLowerCase();
  const hasTarget = wanted.length > 0 && hay.includes(wanted);
  const otherBlocks = Object.entries(tokens ?? {})
    .filter(([, tok]) => {
      if (typeof tok !== "string" || tok.length === 0) return false;
      const t = tok.toLowerCase();
      return t !== wanted && hay.includes(t);
    })
    .map(([id]) => id)
    .sort();
  if (hasTarget && otherBlocks.length > 0) return { outcome: "ambiguous", otherBlocks };
  if (hasTarget) return { outcome: "hit", otherBlocks: [] };
  if (otherBlocks.length > 0) return { outcome: "wrong-block", otherBlocks };
  return { outcome: "absent", otherBlocks: [] };
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
      "ANOTHER block's planted token was returned instead of the target — any of them, not merely this probe's designated decoy (widened 2026-09-09, after a run reported zero here while the model returned the date block's token on every chatPointer rep). Unambiguous: it read something, just not the block asked for. Read it against `wrongBlockFrom`, which tallies WHICH blocks were returned and is the whole diagnostic value of the axis; a reply carrying the target AS WELL is `ambiguous`, not this, and is deliberately excluded from both",
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
  const wrongs = responses.filter((r) => r.outcome === "wrong-block");
  // ★★ WHICH block was returned instead, tallied. The count alone says a probe
  //    failed; this says what it reached instead, which is the difference
  //    between "run it again and stare at it" and a diagnosis. Built from
  //    `wrong-block` responses ONLY — an `ambiguous` reply named the target too
  //    and is a dump, not a misread, so folding it in here would inflate the
  //    tally with replies that DID reach the right block.
  const wrongBlockFrom = {};
  for (const r of wrongs) {
    for (const id of r.otherBlocks ?? []) {
      wrongBlockFrom[id] = (wrongBlockFrom[id] ?? 0) + 1;
    }
  }
  return {
    toolReaches: sum((r) => r.toolUses ?? 0),
    wrongBlock: wrongs.length,
    wrongBlockFrom,
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

/** Every arm a run can dispatch. A, B and X are per-probe and gate; N (the
 *  seeded anchor) and R (the rolling replay) are probe-independent drift arms
 *  and only ever inform. */
export const ARM_IDS = Object.freeze(["A", "B", "X", "N", "R"]);

/** The three environment variables that narrow a run, and the only three. */
export const FILTER_ENV = Object.freeze({
  probes: "AI_EVAL_PROBES",
  reps: "AI_EVAL_REPS",
  arms: "AI_EVAL_ARMS",
});

/** An upper bound on `AI_EVAL_REPS`. Not a narrowing limit — a typo'd `500`
 *  would otherwise quietly plan a run costing two orders of magnitude more than
 *  the standard one, and the operator finds out from the bill. */
const MAX_FILTER_REPS = 50;

/** Render a filter as the one-line string that travels into both the artifact
 *  and the verdict's reason, so the record and the refusal can never describe
 *  different narrowings. */
export function filterSpec(filter) {
  if (filter == null) return "none";
  if (typeof filter.spec === "string" && filter.spec.length > 0) return filter.spec;
  const parts = [];
  if (filter.probes) parts.push(`probes=${filter.probes.join(",")}`);
  if (filter.reps != null) parts.push(`reps=${filter.reps}`);
  if (filter.arms) parts.push(`arms=${filter.arms.join(",")}`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

/** Read the diagnostic filter out of the environment.
 *
 *  ★★ A filter exists so one broken probe can be re-run for cents instead of
 *  the standard run's sixty requests. That affordability is the whole point,
 *  and it is also the danger: a narrowed run that reported a normal verdict
 *  would be a confident green over a measurement of almost nothing. `verdict`
 *  and `shouldWriteRolling` both refuse outright on a non-null filter, which is
 *  why this returns a DESCRIPTION rather than a set of booleans — the thing
 *  that narrowed the run travels with the run, into the artifact, forever.
 *
 *  ★★ NO VARIABLE SET AT ALL RETURNS `null`, NOT AN "EVERYTHING" FILTER. Those
 *  two are not the same: `null` is the standard run and is the only shape that
 *  can pass. A filter naming every probe, every arm and the default rep count
 *  is still a filter and still cannot pass — deliberately, because proving it
 *  equivalent to the standard run means re-deriving the plan, and a check that
 *  has to re-derive the thing it guards is a check that will drift away from it.
 *
 *  ★ An empty or whitespace-only value is treated as UNSET, so `AI_EVAL_ARMS=`
 *  clears rather than selects nothing — selecting nothing is a run that
 *  dispatches nothing and reports a verdict over it, the exact vacuity this
 *  harness exists to refuse.
 *
 *  Returns `{ok: true, filter}` or `{ok: false, errors}`; a bad value is a
 *  refusal, never a silently ignored one. */
export function parseFilter(env) {
  const rawProbes = trimmedOrNull(env[FILTER_ENV.probes]);
  const rawReps = trimmedOrNull(env[FILTER_ENV.reps]);
  const rawArms = trimmedOrNull(env[FILTER_ENV.arms]);
  if (rawProbes === null && rawReps === null && rawArms === null) {
    return { ok: true, filter: null };
  }

  const errors = [];
  const knownProbes = PROBES.map((p) => p.id);
  let probes = null;
  if (rawProbes !== null) {
    probes = uniq(rawProbes.split(",").map((s) => s.trim()).filter((s) => s.length > 0));
    const unknown = probes.filter((id) => !knownProbes.includes(id));
    if (unknown.length > 0) {
      errors.push(
        `${FILTER_ENV.probes}: unknown probe id(s) ${unknown.join(", ")} — known ids are ${knownProbes.join(", ")}`,
      );
    }
    if (probes.length === 0) errors.push(`${FILTER_ENV.probes}: named no probes`);
  }

  let reps = null;
  if (rawReps !== null) {
    if (!/^\d+$/.test(rawReps)) {
      errors.push(`${FILTER_ENV.reps}: must be a whole number, got ${JSON.stringify(rawReps)}`);
    } else {
      reps = Number(rawReps);
      if (reps < 1 || reps > MAX_FILTER_REPS) {
        errors.push(`${FILTER_ENV.reps}: must be between 1 and ${MAX_FILTER_REPS}, got ${reps}`);
      }
    }
  }

  let arms = null;
  if (rawArms !== null) {
    arms = uniq(rawArms.split(",").map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0));
    const unknown = arms.filter((a) => !ARM_IDS.includes(a));
    if (unknown.length > 0) {
      errors.push(
        `${FILTER_ENV.arms}: unknown arm(s) ${unknown.join(", ")} — known arms are ${ARM_IDS.join(", ")}`,
      );
    }
    if (arms.length === 0) errors.push(`${FILTER_ENV.arms}: named no arms`);
  }

  if (errors.length > 0) return { ok: false, errors };
  const filter = { probes, reps, arms, spec: "" };
  filter.spec = filterSpec({ probes, reps, arms });
  return { ok: true, filter };
}

function trimmedOrNull(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function uniq(list) {
  return [...new Set(list)];
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
  // ★★★ A FILTERED RUN CAN NEVER REPORT PASS, AND `filter` IS REQUIRED RATHER
  //     THAN DEFAULTED FOR EXACTLY THAT REASON. A defaulted field makes
  //     omission mean "unfiltered", so the one line a caller forgets is the
  //     line that turns a one-probe one-rep diagnostic into a green light for
  //     the whole harness. Absent throws; `null` is the standard run; anything
  //     else is a narrowing and is refused BEFORE a single score is read — the
  //     refusal must not depend on the scores happening to be good.
  if (!("filter" in run) || (run.filter !== null && typeof run.filter !== "object")) {
    throw new Error(
      "verdict: `filter` is required and must be null (a standard run) or a filter object — an omitted filter would let a narrowed run report PASS",
    );
  }

  const reasons = [];
  const notes = [];

  if (run.filter !== null) {
    reasons.push(
      `run was FILTERED (${filterSpec(run.filter)}) — it measured a subset of the probes, reps or arms the verdict is defined over, so it can diagnose but never pass`,
    );
  }
  if (!run.complete) reasons.push("run did not complete");
  if (reasons.length > 0) return { code: EXIT.UNUSABLE, reasons, notes };

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

/** The rolling drift reference is written by complete, UNFILTERED live runs and
 *  nothing else.
 *
 *  ★★★ `filtered` IS REQUIRED, for the same reason `verdict`'s `filter` is: a
 *  defaulted boolean makes omission mean "not filtered", and the file a
 *  forgotten argument would overwrite is the one every later run measures drift
 *  against. A filtered run's arm A is not arm A's full bytes — a narrowed rep
 *  count still writes the same prompt, but a narrowed PROBE set writes a prompt
 *  built for a different question — so a replay of it attributes to drift
 *  whatever the narrowing changed, silently and forever. */
export function shouldWriteRolling({ mode, complete, filtered }) {
  if (typeof filtered !== "boolean") {
    throw new Error(
      "shouldWriteRolling: `filtered` is required — an omitted flag would let a narrowed run overwrite the drift reference every later run is measured against",
    );
  }
  return mode === "live" && complete === true && filtered === false;
}

/** Assemble the artifact record for one run.
 *
 *  ★★★ PURE, AND IT CALLS `verdict` ITSELF. That is the structural half of the
 *  filter guard: the record's `filter` field and the verdict's `filter`
 *  argument are the SAME value from ONE parameter, so a caller cannot record a
 *  narrowing while reporting an unnarrowed verdict, or the reverse. Two call
 *  sites taking the flag separately is precisely how a guard ends up
 *  half-applied — the record says "filtered", the exit code says PASS, and a
 *  reader believes the exit code.
 *
 *  ★ `date` is a parameter because the lib is clock-free; the CLI owns the
 *  clock, as it owns every other I/O. */
export function buildRunRecord(input) {
  if (!("filter" in input) || (input.filter !== null && typeof input.filter !== "object")) {
    throw new Error(
      "buildRunRecord: `filter` is required and must be null (a standard run) or a filter object",
    );
  }
  const v = verdict({
    complete: input.complete,
    perProbe: input.perProbe,
    filter: input.filter,
  });
  return {
    date: input.date,
    model: input.model,
    gitSha: input.gitSha,
    anchorHash: input.anchorHash,
    rollingHash: input.rollingHash,
    // ★★ The hash of what THIS run WROTE, or null when it wrote nothing. The
    //    next run's pre-flight compares the file on disk against the most
    //    recent non-null one of these — never against `rollingHash`, which is
    //    what a run READ before overwriting it. Getting that backwards made
    //    every run after a prompt change refuse to spend.
    rollingWrittenHash: input.rollingWrittenHash ?? null,
    anchorSpec: input.anchorSpec,
    reps: input.reps,
    salt: input.salt,
    // Sits high in the record on purpose: a reader must not have to scroll past
    // five probe rows to discover that only one of them was run.
    filter: input.filter,
    sizes: input.sizes,
    usage: input.usage,
    perProbe: input.perProbe,
    graded: input.graded,
    drift: input.drift,
    samples: input.samples,
    complete: input.complete,
    verdict: v,
  };
}
