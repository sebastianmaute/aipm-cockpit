import { describe, it, expect } from "vitest";
import { EXIT, mulberry32 } from "./ai-eval-lib.mjs";

describe("EXIT", () => {
  it("matches the repo's two-failure-code convention", () => {
    // 0 pass, 1 a real regression, 2 the harness could not measure.
    // A run that measures nothing must never report 0.
    expect(EXIT).toEqual({ PASS: 0, REGRESSION: 1, UNUSABLE: 2 });
  });
});

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it("stays inside [0, 1)", () => {
    const r = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("pins the exact output stream, so an algorithm swap cannot pass", () => {
    // ★★ The three tests above are all self-referential — same-seed agreement,
    //    cross-seed difference, and range. A DIFFERENT but still valid seeded
    //    PRNG satisfies every one of them. These literals are the only thing
    //    that pins THIS algorithm, and the seeded anchor arm's whole value is
    //    that it regenerates byte-identically forever.
    const r = mulberry32(12345);
    expect([r(), r(), r()]).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985,
    ]);
  });
});

import { PROBES, TOKEN_IDS, plantedToken, probeById } from "./ai-eval-lib.mjs";

describe("plantedToken", () => {
  it("is stable for a given block and salt", () => {
    expect(plantedToken("date", 7)).toBe(plantedToken("date", 7));
  });

  it("differs between blocks at the same salt", () => {
    expect(plantedToken("date", 7)).not.toBe(plantedToken("insights", 7));
  });

  it("differs between salts for the same block", () => {
    expect(plantedToken("date", 7)).not.toBe(plantedToken("date", 8));
  });

  it("is alphabetic and long enough not to collide with ordinary prose", () => {
    for (const p of PROBES) {
      const tok = plantedToken(p.id, 1);
      expect(tok).toMatch(/^[a-z]{16,}$/);
    }
  });

  it("never collides within a run, across every id used together", () => {
    // ★★★ MEASURED, not assumed: before the ordered-universe guarantee, 11 of
    //     these 3000 salts produced a within-run collision, including
    //     insights/activityRecap at 2126 and anchor/anchorDecoy at 1418 — a
    //     target equal to its own decoy, which the scorer can only ever call
    //     ambiguous, silently, forever.
    //
    //  ★★★ THIS RANGE ALONE CANNOT KILL A "remove the retry" MUTANT, and it
    //  is not vacuity to say so — it is the mutation-test result. Folding the
    //  attempt counter into the hash key gives each (id, salt, 0) candidate an
    //  effectively fresh 32-bit draw, so a natural collision among ~14000
    //  attempt-0 draws only becomes likely near the birthday bound
    //  (sqrt(2**32) ≈ 65536) — measured first collision at salt 66350
    //  ("viewScope" vs "chatPointer"), none in 1..3000. Coverage of ordinary
    //  usage, not a substitute for the targeted pin below.
    for (let salt = 1; salt <= 3000; salt += 1) {
      const tokens = TOKEN_IDS.map((id) => plantedToken(id, salt));
      expect(new Set(tokens).size).toBe(TOKEN_IDS.length);
    }
  });

  it("resolves the salt where a first-candidate-only draw naturally collides", () => {
    // ★★★ THE MUTATION-KILLING PIN. At salt 66350, generateToken(id, 66350, 0)
    //     alone gives "viewScope" and "chatPointer" the same string — measured
    //     by disabling the retry loop and scanning up to salt 200000, where it
    //     was the first of only four such coincidences. Removing the retry
    //     loop turns this assertion red; the 1..3000 sweep above does not.
    expect(plantedToken("viewScope", 66350)).not.toBe(
      plantedToken("chatPointer", 66350),
    );
  });

  it("refuses an id outside the declared universe", () => {
    expect(() => plantedToken("chatpointer", 1)).toThrow(/unknown token id/i);
  });

  it("no longer collides at the exact salts the first cut failed at", () => {
    // Named regression pins, not just the range scan above — a range scan can
    // pass again after someone "simplifies" the retry loop away by luck of
    // whatever salts they happened to weaken; these three are known-bad.
    expect(plantedToken("insights", 2126)).not.toBe(
      plantedToken("activityRecap", 2126),
    );
    expect(plantedToken("anchor", 1418)).not.toBe(
      plantedToken("anchorDecoy", 1418),
    );
    expect(plantedToken("insights", 3449)).not.toBe(
      plantedToken("chatPointer", 3449),
    );
  });
});

describe("PROBES", () => {
  it("covers the five blocks slice B relocated", () => {
    expect(PROBES.map((p) => p.id)).toEqual([
      "date", "viewScope", "insights", "activityRecap", "chatPointer",
    ]);
  });

  it("gives every probe a distractor in a DIFFERENT block", () => {
    for (const p of PROBES) {
      expect(p.distractorBlock).not.toBe(p.id);
      expect(PROBES.map((q) => q.id)).toContain(p.distractorBlock);
    }
  });

  it("asks each question in a form whose only correct answer is the token", () => {
    for (const p of PROBES) {
      expect(p.question).toContain("exactly as written");
    }
  });

  // ★★★ The fix for the salience defect: five identical "reference code"
  //     labels made the model return the most salient code rather than the one
  //     asked for, and the vaguest description lost every time.
  it("gives every block a DISTINCT label", () => {
    const labels = PROBES.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(typeof l === "string" && l.length > 0).toBe(true);
  });

  it("asks each question for its OWN label and for none of the other four", () => {
    // The question and the prompt text are the two halves that must agree; a
    // question naming a label its block does not use is unanswerable, and a
    // question naming TWO labels is ambiguous again by another route.
    for (const p of PROBES) {
      expect(p.question).toContain(p.label);
      for (const other of PROBES) {
        if (other.id === p.id) continue;
        expect(p.question).not.toContain(other.label);
      }
    }
  });

  it("exposes each block's label as the single source the prompt interpolates", () => {
    expect(labelOf("chatPointer")).toBe(probeById("chatPointer").label);
    expect(() => labelOf("nope")).toThrow(/unknown probe/i);
  });

  it("keeps no label a substring of another, so no question can name two", () => {
    for (const p of PROBES) {
      for (const other of PROBES) {
        if (other.id === p.id) continue;
        expect(p.label.includes(other.label)).toBe(false);
      }
    }
  });

  it("looks a probe up by id and throws on an unknown one", () => {
    expect(probeById("date").id).toBe("date");
    expect(() => probeById("nope")).toThrow(/unknown probe/i);
  });
});

import {
  PROBE_HARDENING, plantLabel, priorLabel, plantedProbeIds, compositionProbeId,
  CURRENT_QUALIFIER, PREVIOUS_QUALIFIER, COMPOSITION_ALT_IDS,
} from "./ai-eval-lib.mjs";

describe("PROBE_HARDENING", () => {
  it("carries a knob set for every probe and for nothing else", () => {
    expect(Object.keys(PROBE_HARDENING).sort()).toEqual(PROBES.map((p) => p.id).sort());
  });

  // ★★★ The lead's constraint, pinned rather than trusted: if composition
  //     proves too hard we learn it from ONE probe instead of losing the run.
  it("switches composition on for AT MOST ONE probe", () => {
    expect(PROBES.filter((p) => PROBE_HARDENING[p.id].composition).length)
      .toBeLessThanOrEqual(1);
  });

  it("gives the composition probe an ask of its own", () => {
    const id = compositionProbeId();
    if (id === null) return;
    expect(typeof probeById(id).compositionAsk).toBe("string");
    expect(probeById(id).compositionAsk.length).toBeGreaterThan(20);
  });

  it("never asks a competitor probe for a code its block does not label", () => {
    // competitor ON  -> the block writes "current <label>" and the question
    //                   asks for it; competitor OFF -> both use the plain label.
    for (const p of PROBES) {
      if (PROBE_HARDENING[p.id].composition) continue;
      expect(p.question).toContain(plantLabel(p.id));
      if (PROBE_HARDENING[p.id].competitor) {
        expect(plantLabel(p.id)).toBe(`${CURRENT_QUALIFIER} ${p.label}`);
        expect(priorLabel(p.id)).toBe(`${PREVIOUS_QUALIFIER} ${p.label}`);
        // The question must name the CURRENT one, never the previous.
        expect(p.question).not.toContain(priorLabel(p.id));
      } else {
        expect(plantLabel(p.id)).toBe(p.label);
      }
    }
  });

  it("still says 'exactly as written' on every question, hardened or not", () => {
    for (const p of PROBES) expect(p.question).toContain("exactly as written");
  });

  it("derives the planted id set from the knobs, not from a list", () => {
    const ids = plantedProbeIds();
    for (const p of PROBES) {
      const h = PROBE_HARDENING[p.id];
      expect(ids).toContain(p.id);
      expect(ids.includes(`${p.id}Prev`)).toBe(h.competitor);
      for (const alt of COMPOSITION_ALT_IDS) {
        if (h.composition) expect(ids).toContain(alt);
      }
    }
  });

  it("plants no composition alternatives while composition is off", () => {
    // The derived set must SHRINK when a knob is turned off, or pre-flight's
    // exactly-once assertion would demand tokens the snapshot never wrote.
    if (compositionProbeId() !== null) return;
    for (const alt of COMPOSITION_ALT_IDS) {
      expect(plantedProbeIds()).not.toContain(alt);
    }
  });

  it("keeps every planted id inside the declared token universe", () => {
    // An id outside TOKEN_IDS loses the collision-free guarantee, and
    // `plantedToken` throws rather than mint one silently.
    for (const id of plantedProbeIds()) {
      expect(TOKEN_IDS).toContain(id);
      expect(() => plantedToken(id, 1)).not.toThrow();
    }
  });

  it("plants a distinct token for every planted id", () => {
    const toks = plantedProbeIds().map((id) => plantedToken(id, 1));
    expect(new Set(toks).size).toBe(toks.length);
  });

  it("leaves the five original tokens byte-identical after the append", () => {
    // The committed rolling drift reference holds a previous run's bytes and is
    // scored against plantedToken(id, thatRunsSalt). A changed mint would make
    // the replay miss every time and read as catastrophic drift.
    expect(plantedToken("date", 1)).toBe("tsavazumurkazuyth");
    expect(plantedToken("viewScope", 1)).toBe("tresktsavolnzilmab");
    expect(plantedToken("insights", 1)).toBe("mabscesceflenquen");
    expect(plantedToken("activityRecap", 1)).toBe("zilurnquenolnquen");
    expect(plantedToken("chatPointer", 1)).toBe("flenmabscequentresk");
  });
});

import { labelOf, tokenSubstringConflicts, TOKEN_IDS } from "./ai-eval-lib.mjs";

describe("tokenSubstringConflicts", () => {
  it("reports nothing for the real token set at the salts in use", () => {
    // `plantedToken` guarantees DISTINCT tokens, never non-containment, and
    // the scorer matches by substring across the whole set — one containment
    // would score every correct answer "ambiguous", silently and forever.
    for (const salt of [1, 2, 3, 4, 5]) {
      const tokens = Object.fromEntries(TOKEN_IDS.map((id) => [id, plantedToken(id, salt)]));
      expect(tokenSubstringConflicts(tokens)).toEqual([]);
    }
  });

  it("names both sides when one token contains another", () => {
    const c = tokenSubstringConflicts({ a: "vorquenzilmab", b: "quenzil" });
    expect(c.join(" ")).toMatch(/b's token is contained in a's/);
  });

  it("ignores blank and non-string entries rather than matching everything", () => {
    expect(tokenSubstringConflicts({ a: "vorquen", b: "", c: undefined })).toEqual([]);
  });
});

import { ANCHOR_SPEC, buildAnchorPrompt, sha256 } from "./ai-eval-lib.mjs";

describe("buildAnchorPrompt", () => {
  const target = "zzztargetzzz";
  const decoy = "zzzdecoyzzz";

  it("is byte-identical across calls with the same spec", () => {
    const a = buildAnchorPrompt(ANCHOR_SPEC, target, decoy);
    const b = buildAnchorPrompt(ANCHOR_SPEC, target, decoy);
    expect(a).toBe(b);
  });

  it("places the target and the decoy exactly once each", () => {
    const text = buildAnchorPrompt(ANCHOR_SPEC, target, decoy);
    expect(text.split(target).length - 1).toBe(1);
    expect(text.split(decoy).length - 1).toBe(1);
  });

  it("puts the target deep in the text, not near its head", () => {
    const text = buildAnchorPrompt(ANCHOR_SPEC, target, decoy);
    // Needle depth is the property that makes this representative of a real
    // ~31k prefix. A token near the head would test nothing the short arms do not.
    expect(text.indexOf(target) / text.length).toBeGreaterThan(0.5);
  });

  it("keeps the decoy before the target, so the model must pass it to reach the answer", () => {
    // ANCHOR_SPEC places the decoy at 0.31 and the target at 0.72 of the way
    // through — that ORDER is the point, not merely that both exist.
    const text = buildAnchorPrompt(ANCHOR_SPEC, target, decoy);
    expect(text.indexOf(decoy)).toBeLessThan(text.indexOf(target));
  });

  it("changes when the spec changes, so the hash guard can see an edit", () => {
    const other = { ...ANCHOR_SPEC, seed: ANCHOR_SPEC.seed + 1 };
    expect(buildAnchorPrompt(other, target, decoy)).not.toBe(
      buildAnchorPrompt(ANCHOR_SPEC, target, decoy),
    );
  });

  it("refuses a target equal to its own decoy", () => {
    // ★★ A colliding target/decoy makes every anchor response score as
    //    "ambiguous" — silently, forever, with nothing raising an error.
    //    plantedToken can no longer produce that collision, but this function
    //    takes both as plain strings, so a caller can still pass the same
    //    value twice.
    expect(() => buildAnchorPrompt(ANCHOR_SPEC, target, target)).toThrow(
      /target.*decoy|decoy.*target/i,
    );
  });

  it("still places each exactly once at the default spec (positive case)", () => {
    // The four negatives below only prove the function CAN refuse things —
    // this keeps a positive case beside them so the suite also proves the
    // postcondition does not fire on the happy path.
    const text = buildAnchorPrompt(ANCHOR_SPEC, target, decoy);
    expect(text.split(target).length - 1).toBe(1);
    expect(text.split(decoy).length - 1).toBe(1);
  });

  it("throws rather than silently drop the decoy when words is too small", () => {
    // words: 1 floors both targetAt and decoyAt to 0 — the if/else chain lets
    // the target win the tie and the decoy never gets an iteration.
    expect(() =>
      buildAnchorPrompt({ ...ANCHOR_SPEC, words: 1 }, target, decoy),
    ).toThrow(/decoy/i);
  });

  it("throws rather than silently drop the target when words is 0", () => {
    expect(() =>
      buildAnchorPrompt({ ...ANCHOR_SPEC, words: 0 }, target, decoy),
    ).toThrow(/target/i);
  });

  it("throws rather than silently drop the target when its fraction is out of range", () => {
    // targetAtFraction: 1.0 lands on index `words`, which the loop `i < words`
    // never visits.
    expect(() =>
      buildAnchorPrompt(
        { ...ANCHOR_SPEC, words: 100, targetAtFraction: 1.0 },
        target,
        decoy,
      ),
    ).toThrow(/target/i);
  });

  it("throws rather than silently double-count a decoy that is a substring of the target", () => {
    expect(() =>
      buildAnchorPrompt(ANCHOR_SPEC, "abcdef1234567890", "abcdef"),
    ).toThrow(/decoy/i);
  });
});

describe("sha256", () => {
  it("is stable and hex", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });

  it("matches the published NIST test vector for 'abc'", () => {
    // ★★ The three assertions above are self-referential — any deterministic
    //    64-hex function passes them. This is the only one that says it is SHA-256.
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

import { scoreResponse, hitRate, OUTCOMES, MISS_OUTCOMES } from "./ai-eval-lib.mjs";

/** A reply as the API returns it. `scoreResponse` REQUIRES all three fields —
 *  the defaults here are the ordinary case, and each test that cares about a
 *  miss cause overrides them explicitly. */
const rep = (text, extra = {}) => ({ text, toolUses: 0, stopReason: "end_turn", ...extra });

describe("scoreResponse", () => {
  const t = "vorquenzil";
  const d = "mabtresk";
  // The FULL planted set: the target's own block, its designated decoy, and
  // three others. `third` is the one the old one-decoy scorer was blind to.
  const third = "glimscedrav";
  const set = {
    date: t, viewScope: d, insights: third,
    activityRecap: "ythkeshobr", chatPointer: "wintazuflen",
  };

  it("scores the target alone as a hit", () => {
    expect(scoreResponse(rep("vorquenzil"), t, set)).toEqual({ outcome: "hit", otherBlocks: [] });
  });

  it("scores the designated decoy alone as wrong-block", () => {
    const r = scoreResponse(rep("I think it is mabtresk"), t, set);
    expect(r.outcome).toBe("wrong-block");
    expect(r.otherBlocks).toEqual(["viewScope"]);
  });

  // ★★★ THE WIDENING. Mutation-proved: narrowing the scan back to the
  //     designated decoy turns this red and nothing else.
  it("scores a THIRD block's token as wrong-block, not absent, and names it", () => {
    // This is the case the one-decoy scorer got wrong. It reported `absent` —
    // "read nothing" — while the model had read a different block entirely,
    // which is what made three zeros on the chatPointer probe undiagnosable.
    const r = scoreResponse(rep("I think it is glimscedrav"), t, set);
    expect(r.outcome).toBe("wrong-block");
    expect(r.otherBlocks).toEqual(["insights"]);
  });

  it("names every foreign block it found, sorted", () => {
    const r = scoreResponse(rep("maybe wintazuflen or glimscedrav"), t, set);
    expect(r.outcome).toBe("wrong-block");
    expect(r.otherBlocks).toEqual(["chatPointer", "insights"]);
  });

  it("scores neither as absent, with no blocks named", () => {
    expect(scoreResponse(rep("I could not find a code."), t, set))
      .toEqual({ outcome: "absent", otherBlocks: [] });
  });

  it("scores target + designated decoy as ambiguous, never as a hit", () => {
    // The question named ONE block. Returning several means it did not answer
    // the question asked, so counting it as a hit would inflate every rate.
    expect(scoreResponse(rep("either vorquenzil or mabtresk"), t, set).outcome).toBe("ambiguous");
  });

  // ★★★ THE RULE THAT STOPS A CONTEXT-DUMPING MODEL SCORING A PERFECT RUN,
  //     pinned with a THIRD block's token rather than the designated decoy —
  //     the widening must make this rule stronger, never weaker.
  //     Mutation-proved: letting a non-decoy token through as a hit turns this
  //     red and nothing else.
  it("scores target + a THIRD block's token as ambiguous, never as a hit", () => {
    const r = scoreResponse(rep("either vorquenzil or glimscedrav"), t, set);
    expect(r.outcome).toBe("ambiguous");
    expect(r.otherBlocks).toEqual(["insights"]);
  });

  it("is case-insensitive on the token", () => {
    expect(scoreResponse(rep("VORQUENZIL"), t, set).outcome).toBe("hit");
  });

  it("scores a repeated target with no other token as a hit, not ambiguous", () => {
    // Repetition is not ambiguity — only ANOTHER block's token flips the
    // verdict. A model that says the right thing twice still answered the
    // question that was asked.
    expect(scoreResponse(rep("vorquenzil, vorquenzil"), t, set).outcome).toBe("hit");
  });

  it("never counts the target against itself, whatever the map is keyed by", () => {
    // The anchor arm keys its set by "anchor"/"anchorDecoy", not by probe id.
    const r = scoreResponse(rep("vorquenzil"), t, { somethingElse: t, other: d });
    expect(r).toEqual({ outcome: "hit", otherBlocks: [] });
  });

  it("ignores blank entries rather than matching every reply against them", () => {
    // Arm X blanks a token when BUILDING its prompt; a blank reaching the
    // scorer must not make `"".includes` true for every reply on earth.
    expect(scoreResponse(rep("nothing here"), t, { date: t, viewScope: "" }).outcome).toBe("absent");
  });

  // ★★★ GUARD (a) OF THE SPLIT. Mutation-proved: collapsing tool-call and
  //     truncated back into `absent` turns these three red and nothing else.
  it("scores a tool call with no token as tool-call, not absent", () => {
    // A model event: it distrusted its context and went looking. Measured
    // 2026-09-09 on the composition probe — 2 of 3 reps did exactly this, and
    // the old vocabulary reported all of it as "produced nothing".
    const r = scoreResponse(rep("", { toolUses: 1, stopReason: "tool_use" }), t, set);
    expect(r.outcome).toBe("tool-call");
  });

  it("scores a reply cut off at the cap as truncated, not absent", () => {
    // An INSTRUMENT event: the score measures the cap, and nothing about
    // reachability can be concluded from it.
    const r = scoreResponse(rep("", { stopReason: "max_tokens" }), t, set);
    expect(r.outcome).toBe("truncated");
  });

  it("keeps absent for a completed reply that simply found nothing", () => {
    expect(scoreResponse(rep("I could not find it.", { stopReason: "end_turn" }), t, set).outcome)
      .toBe("absent");
  });

  it("ranks tool-call ABOVE truncated when a reply did both", () => {
    // The re-sweep produced both shapes for ONE model behaviour: think, then
    // call a tool — once stopping cleanly at `tool_use`, once running into the
    // cap on the way. Letting truncation win would split one decision across
    // two buckets on an incidental collision.
    const r = scoreResponse(rep("", { toolUses: 1, stopReason: "max_tokens" }), t, set);
    expect(r.outcome).toBe("tool-call");
  });

  // ★★★ THE DECISION THE LEAD ASKED FOR, PINNED. A hit that also called a tool
  //     is still a hit: the probe asks whether the block is REACHABLE, and a
  //     reply carrying the target reached it. The tool call is recorded by
  //     `toolReaches`, which sums over every reply regardless of outcome.
  it("still scores a hit when the reply ALSO called a tool", () => {
    const r = scoreResponse(rep("vorquenzil", { toolUses: 1, stopReason: "tool_use" }), t, set);
    expect(r.outcome).toBe("hit");
  });

  it("still scores wrong-block when a foreign token arrived alongside a tool call", () => {
    // The first three branches are unchanged by the split: only the old
    // `absent` bucket divides.
    const r = scoreResponse(rep("mabtresk", { toolUses: 1, stopReason: "tool_use" }), t, set);
    expect(r.outcome).toBe("wrong-block");
  });

  it("refuses a bare string — a miss cannot name its cause from text alone", () => {
    expect(() => scoreResponse("vorquenzil", t, set)).toThrow(/whole reply/i);
    expect(() => scoreResponse({ text: "x" }, t, set)).toThrow(/whole reply/i);
    expect(() => scoreResponse({ text: "x", toolUses: 0 }, t, set)).toThrow(/whole reply/i);
  });
});

describe("the outcome vocabulary", () => {
  it("declares exactly one success and five misses", () => {
    expect(OUTCOMES).toEqual([
      "hit", "wrong-block", "ambiguous", "tool-call", "truncated", "absent",
    ]);
    expect(MISS_OUTCOMES).toEqual([
      "wrong-block", "ambiguous", "tool-call", "truncated", "absent",
    ]);
  });

  // ★★★ GUARD (b) OF THE SPLIT. Mutation-proved: letting `tool-call` (or any
  //     other miss) count towards the rate turns this red.
  it("counts NOTHING but hit towards the rate", () => {
    for (const miss of MISS_OUTCOMES) {
      expect(hitRate([miss, miss, miss])).toBe(0);
    }
    expect(hitRate(["hit", "tool-call", "truncated", "absent"])).toBeCloseTo(0.25);
  });

  it("carries every miss through to a hard verdict failure, not a partial pass", () => {
    // The whole path: outcomes -> hitRate -> verdict. A tool call or a
    // truncation must never soften into a partial success on the way.
    for (const miss of ["tool-call", "truncated"]) {
      const A = hitRate([miss, miss, miss]);
      const v = verdict({
        complete: true, filter: null,
        perProbe: [{ id: "chatPointer", A, B: 1, X: 0 }],
      });
      expect(A).toBe(0);
      expect(v.code).toBe(E.UNUSABLE);
      expect(v.reasons.join(" ")).toMatch(/arm A scored zero/);
    }
  });
});

describe("hitRate", () => {
  it("counts only hits, over all reps", () => {
    expect(hitRate(["hit", "hit", "absent", "wrong-block"])).toBeCloseTo(0.5);
  });

  it("is 0 for an empty list rather than NaN", () => {
    // A NaN rate compares false against every threshold, which would make an
    // empty arm read as passing.
    expect(hitRate([])).toBe(0);
  });
});

import { GRADED_AXES, gradeArm } from "./ai-eval-lib.mjs";

describe("GRADED_AXES", () => {
  it("says outputTokens is only comparable at the same cap", () => {
    // A cap change moves what the axis can reach, so a rise can be headroom
    // rather than behaviour. The pre-registration has to say so, or the axis
    // silently means something different after the cap moves.
    const axis = GRADED_AXES.find((a) => a.id === "outputTokens");
    expect(axis.meaning).toMatch(/maxOutputTokens/);
    expect(axis.meaning).toMatch(/truncation|stopReasons/);
  });

  it("pre-registers a direction and a meaning for every axis", () => {
    expect(GRADED_AXES.map((a) => a.id)).toEqual([
      "toolReaches", "wrongBlock", "adherence", "outputTokens",
    ]);
    for (const axis of GRADED_AXES) {
      expect(axis.worseDirection).toBe("higher");
      expect(axis.meaning.length).toBeGreaterThan(20);
    }
  });
});

describe("gradeArm", () => {
  const responses = [
    { text: "vorquenzil", outcome: "hit", toolUses: 0, outputTokens: 4 },
    { text: "The code is vorquenzil, taken from the date block.", outcome: "hit", toolUses: 1, outputTokens: 12 },
    { text: "mabtresk", outcome: "wrong-block", toolUses: 0, outputTokens: 3 },
  ];

  it("sums tool reaches across reps", () => {
    expect(gradeArm(responses, "vorquenzil").toolReaches).toBe(1);
  });

  it("counts wrong-block outcomes", () => {
    expect(gradeArm(responses, "vorquenzil").wrongBlock).toBe(1);
  });

  it("tallies WHICH blocks were returned instead", () => {
    // The count says a probe failed; this says what it reached instead, which
    // is the difference between another full run and a diagnosis.
    const rs = [
      { text: "a", outcome: "wrong-block", toolUses: 0, outputTokens: 3, otherBlocks: ["date"] },
      { text: "b", outcome: "wrong-block", toolUses: 0, outputTokens: 3, otherBlocks: ["date"] },
      { text: "c", outcome: "wrong-block", toolUses: 0, outputTokens: 3, otherBlocks: ["insights"] },
    ];
    expect(gradeArm(rs, "vorquenzil").wrongBlockFrom).toEqual({ date: 2, insights: 1 });
  });

  it("counts the two new miss causes per arm", () => {
    const rs = [
      { text: "", outcome: "tool-call", toolUses: 1, outputTokens: 300 },
      { text: "", outcome: "truncated", toolUses: 0, outputTokens: 512 },
      { text: "vorquenzil", outcome: "hit", toolUses: 1, outputTokens: 13 },
    ];
    const g = gradeArm(rs, "vorquenzil");
    expect(g.toolCall).toBe(1);
    expect(g.truncated).toBe(1);
    // The hit that ALSO called a tool is not a toolCall miss — but its tool use
    // still lands on toolReaches, which is the only record of that event.
    expect(g.toolReaches).toBe(2);
  });

  it("keeps ambiguous replies OUT of the wrong-block tally", () => {
    // An ambiguous reply named the target too — it DID reach the right block
    // and then dumped more, which is a different failure from a misread.
    const rs = [
      { text: "a", outcome: "ambiguous", toolUses: 0, outputTokens: 3, otherBlocks: ["date"] },
    ];
    const g = gradeArm(rs, "vorquenzil");
    expect(g.wrongBlock).toBe(0);
    expect(g.wrongBlockFrom).toEqual({});
  });

  it("survives a response with no otherBlocks field at all", () => {
    expect(gradeArm(responses, "vorquenzil").wrongBlockFrom).toEqual({});
  });

  it("counts an elaborated answer against adherence", () => {
    // A bare token is adherent; anything longer is not. Both probes said
    // "exactly as written", so this is measured against an explicit instruction.
    expect(gradeArm(responses, "vorquenzil").adherence).toBe(1);
  });

  it("averages output tokens", () => {
    expect(gradeArm(responses, "vorquenzil").outputTokens).toBeCloseTo(19 / 3);
  });

  it("treats an exact bare token as adherent regardless of surrounding space", () => {
    const bare = [{ text: "  vorquenzil \n", outcome: "hit", toolUses: 0, outputTokens: 4 }];
    expect(gradeArm(bare, "vorquenzil").adherence).toBe(0);
  });

  it("reports the elaboration count against its hit denominator", () => {
    // `responses` above is 2 hits (one bare, one elaborated) + 1 wrong-block.
    // adherenceOf must be the HIT count (2), never the response count (3).
    const graded = gradeArm(responses, "vorquenzil");
    expect(graded.adherence).toBe(1);
    expect(graded.adherenceOf).toBe(2);
  });

  it("reports adherence 0 over a 0 denominator when the arm has no hits at all", () => {
    // This is the "no signal" case, not a clean run — an arm that missed
    // every rep must never read as having perfect adherence. Pinned
    // explicitly so a reader of adherence alone (without adherenceOf) cannot
    // mistake 0/0 for 0/N.
    const noHits = [
      { text: "mabtresk", outcome: "wrong-block", toolUses: 0, outputTokens: 3 },
      { text: "nothing here", outcome: "absent", toolUses: 0, outputTokens: 5 },
    ];
    const graded = gradeArm(noHits, "vorquenzil");
    expect(graded.adherence).toBe(0);
    expect(graded.adherenceOf).toBe(0);
  });

  it("reports adherence equal to its denominator when every hit elaborated", () => {
    const allElaborated = [
      { text: "The code is vorquenzil.", outcome: "hit", toolUses: 0, outputTokens: 6 },
      { text: "It is vorquenzil, I believe.", outcome: "hit", toolUses: 0, outputTokens: 8 },
    ];
    const graded = gradeArm(allElaborated, "vorquenzil");
    expect(graded.adherence).toBe(2);
    expect(graded.adherenceOf).toBe(2);
  });
});

import { preflight } from "./ai-eval-lib.mjs";

const okInput = () => ({
  target: "vorquenzil",
  decoy: "mabtresk",
  armPrompts: {
    // A genuine relocation: arm A carries the token in `system`, arm B on the
    // turn tail. Each arm DECLARES the half it carries it in — the half is
    // never assumed by `preflight`, which is the whole point of the fix.
    A: {
      expectedHalf: "system",
      system: "... reference code vorquenzil ... and reference code mabtresk ...",
      turn: "question",
    },
    B: {
      expectedHalf: "turn",
      system: "... reference code mabtresk ...",
      turn: "question ... reference code vorquenzil ...",
    },
  },
  anchorHash: "abc",
  recordedAnchorHash: "abc",
  rollingHash: "def",
  recordedRollingHash: "def",
});

describe("preflight", () => {
  it("passes a well-formed input", () => {
    expect(preflight(okInput())).toEqual({ ok: true, failures: [] });
  });

  it("fails when the target appears twice in one arm", () => {
    const input = okInput();
    input.armPrompts.A.system += " vorquenzil again";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/target.*exactly once.*A/i);
  });

  it("fails when the target is missing from an arm entirely", () => {
    const input = okInput();
    input.armPrompts.B.turn = "question with no code";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/target.*exactly once.*B/i);
  });

  it("fails when arm B carries the target in the half it did not declare", () => {
    // The failure that would otherwise produce two IDENTICAL arms and a
    // confident "no regression" — a toggle that silently stopped toggling.
    const input = okInput();
    input.armPrompts.B.system = "reference code vorquenzil and reference code mabtresk";
    input.armPrompts.B.turn = "question";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/arm B.*exactly once in the turn half/i);
  });

  it("fails when the decoy is missing", () => {
    const input = okInput();
    input.armPrompts.A.system = "reference code vorquenzil";
    input.armPrompts.B.system = "nothing";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/decoy/i);
  });

  it("fails on an anchor hash mismatch", () => {
    const input = okInput();
    input.anchorHash = "changed";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/anchor hash/i);
  });

  it("fails on a rolling hash mismatch", () => {
    const input = okInput();
    input.rollingHash = "changed";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/rolling/i);
  });

  it("accepts an absent rolling reference, so the first run can bootstrap", () => {
    const input = okInput();
    input.rollingHash = null;
    input.recordedRollingHash = null;
    expect(preflight(input).ok).toBe(true);
  });

  it("reports every failure at once rather than stopping at the first", () => {
    const input = okInput();
    input.anchorHash = "changed";
    input.rollingHash = "changed";
    expect(preflight(input).failures.length).toBe(2);
  });
});

describe("preflight position assertions", () => {
  it("fails when the target sits in the wrong half, and names the half it was expected in", () => {
    const input = okInput();
    // Same bytes, opposite declaration: the target is genuinely in `system`,
    // but this arm claims to carry it in the turn.
    input.armPrompts.A.expectedHalf = "turn";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/arm A.*exactly once in the turn half/i);
  });

  it("fails when the target sits in BOTH halves", () => {
    // ★ The half the old pair could not see. A token duplicated across both
    //   halves satisfies "once in the expected half" on its own — only the
    //   zero-in-the-other-half assertion catches it. The whole-prompt
    //   exactly-once check fires too, which is the point: both are real.
    const input = okInput();
    input.armPrompts.A.turn = "question ... reference code vorquenzil ...";
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/arm A.*must not appear in the turn half/i);
  });

  it("passes the A/A self-test cleanly, with nothing suppressed", () => {
    // Arm B is a deliberate alias of arm A until a gated slice registers a
    // variant. Both arms declare the same half and both assertions hold
    // honestly — there is no flag switching anything off. ★ This configuration
    // does NOT prove the arms differ; nothing can, because they do not.
    const input = okInput();
    input.armPrompts.B = { ...input.armPrompts.A };
    expect(preflight(input)).toEqual({ ok: true, failures: [] });
  });

  it("passes a genuine relocation in either direction", () => {
    const input = okInput();
    const a = input.armPrompts.A;
    const b = input.armPrompts.B;
    input.armPrompts.A = b;
    input.armPrompts.B = a;
    expect(preflight(input)).toEqual({ ok: true, failures: [] });
  });

  it("fails an arm that declares no half rather than skipping the check", () => {
    // ★★ A position check that does not know where to look must never pass
    //    silently — that vacuity is what the old hardcoded assertion decayed
    //    into once it was flagged off.
    const input = okInput();
    delete input.armPrompts.A.expectedHalf;
    const res = preflight(input);
    expect(res.ok).toBe(false);
    expect(res.failures.join(" ")).toMatch(/arm A: expectedHalf must be/i);
  });
});

import { verdict, EXIT as E } from "./ai-eval-lib.mjs";

const run = (over = {}) => ({
  complete: true,
  // `filter` is REQUIRED by verdict, not defaulted — see its guard. `null` is
  // the standard, unnarrowed run; every override below inherits it.
  filter: null,
  perProbe: [
    { id: "date", A: 1.0, B: 1.0, X: 0 },
    { id: "viewScope", A: 0.6, B: 0.6, X: 0 },
  ],
  ...over,
});

describe("verdict", () => {
  it("passes when B holds up against A", () => {
    expect(verdict(run()).code).toBe(E.PASS);
  });

  it("is UNUSABLE when the run did not complete", () => {
    expect(verdict(run({ complete: false })).code).toBe(E.UNUSABLE);
  });

  it("is UNUSABLE when the negative control scored above zero", () => {
    // The token surfaced with its block deleted, so it is reachable from
    // somewhere else and the probe never measured reachability at all.
    const r = run({ perProbe: [{ id: "date", A: 1.0, B: 1.0, X: 0.34 }] });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.join(" ")).toMatch(/negative control/i);
  });

  it("is UNUSABLE when the null arm itself fell to zero", () => {
    // A regressed null is not a verdict about the candidate. Reporting it as
    // REGRESSION would blame the slice for something that moved under both arms.
    const r = run({ perProbe: [{ id: "date", A: 0, B: 0, X: 0 }] });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.join(" ")).toMatch(/arm A/i);
  });

  it("is REGRESSION when B is zero on a probe where A is not", () => {
    const r = run({ perProbe: [{ id: "date", A: 1.0, B: 0, X: 0 }] });
    const v = verdict(r);
    expect(v.code).toBe(E.REGRESSION);
    expect(v.reasons.join(" ")).toMatch(/date/);
  });

  it("records a partial drop without failing on it", () => {
    // At the default rep count a one-rep difference is inside noise. It is
    // reported so a human can see it, and gates nothing.
    const r = run({ perProbe: [{ id: "date", A: 1.0, B: 0.67, X: 0 }] });
    const v = verdict(r);
    expect(v.code).toBe(E.PASS);
    expect(v.notes.join(" ")).toMatch(/date/);
  });

  it("reports every failing probe, not just the first", () => {
    const r = run({
      perProbe: [
        { id: "date", A: 1.0, B: 0, X: 0 },
        { id: "viewScope", A: 1.0, B: 0, X: 0 },
      ],
    });
    expect(verdict(r).reasons.length).toBe(2);
  });

  it("is UNUSABLE when the probe list is empty — a complete run with nothing in it is a contradiction, not a pass", () => {
    const r = run({ perProbe: [] });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.join(" ")).toMatch(/no probe/i);
  });

  it("is UNUSABLE when a probe's arms were never measured, and names the probe", () => {
    // No A/B/X at all — an arm that produced no response, not an arm that
    // scored zero. Absence of measurement must not read as a clean result.
    const r = run({ perProbe: [{ id: "date" }] });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.join(" ")).toMatch(/date/);
    expect(v.reasons.join(" ")).toMatch(/not measured/i);
  });

  it("treats an all-zero probe as MEASURED, not malformed — 0 is a real score", () => {
    // The finiteness check must not degrade into a truthiness check: 0 is
    // falsy but it is a genuine measured value and must reach the normal
    // arm-A-zero reasoning, never the "not measured" reasoning.
    const r = run({ perProbe: [{ id: "date", A: 0, B: 0, X: 0 }] });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.length).toBe(1);
    expect(v.reasons[0]).toMatch(/arm A/i);
    expect(v.reasons[0]).not.toMatch(/not measured/i);
  });

  it("lets an incomplete run short-circuit even when the probe list is also broken", () => {
    // Precedence: complete:false wins outright. A leaking negative control and
    // a zeroed arm A on the same probe must not also get reported — the run
    // never finished, so nothing past that is worth saying.
    const r = run({
      complete: false,
      perProbe: [{ id: "date", A: 0, B: 0, X: 0.5 }],
    });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons).toEqual(["run did not complete"]);
  });

  it("reports both the leak and the arm-A-zero reason when a single probe carries both", () => {
    const r = run({ perProbe: [{ id: "date", A: 0, B: 0, X: 0.5 }] });
    const v = verdict(r);
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.length).toBe(2);
    expect(v.reasons.join(" ")).toMatch(/negative control/i);
    expect(v.reasons.join(" ")).toMatch(/arm A/i);
  });

  it("never mutates its input run object", () => {
    const r = run({ perProbe: [{ id: "date", A: 1.0, B: 0, X: 0 }] });
    const before = JSON.stringify(r);
    verdict(r);
    expect(JSON.stringify(r)).toBe(before);
  });
});

import { spendDecision, shouldWriteRolling, SPEND_ENV } from "./ai-eval-lib.mjs";

describe("spendDecision", () => {
  it("dry-runs when the opt-in is absent", () => {
    const d = spendDecision({ env: {}, hasKey: true });
    expect(d.mode).toBe("dry");
    expect(d.code).toBe(0);
  });

  it("spends when the opt-in is set and a key is present", () => {
    const d = spendDecision({ env: { [SPEND_ENV]: "1" }, hasKey: true });
    expect(d.mode).toBe("live");
  });

  it("refuses to spend under CI even with the opt-in", () => {
    const d = spendDecision({ env: { CI: "true", [SPEND_ENV]: "1" }, hasKey: true });
    expect(d.mode).toBe("refuse");
    expect(d.code).toBe(2);
    expect(d.reason).toMatch(/CI/);
  });

  it("refuses to spend with the opt-in but no key", () => {
    const d = spendDecision({ env: { [SPEND_ENV]: "1" }, hasKey: false });
    expect(d.mode).toBe("refuse");
    expect(d.code).toBe(2);
    expect(d.reason).toMatch(/key/i);
  });

  it("still dry-runs under CI without the opt-in, since it spends nothing", () => {
    const d = spendDecision({ env: { CI: "true" }, hasKey: false });
    expect(d.mode).toBe("dry");
  });
});

describe("shouldWriteRolling", () => {
  it("writes after a complete live run", () => {
    expect(shouldWriteRolling({ mode: "live", complete: true, filtered: false })).toBe(true);
  });

  it("never writes after an incomplete run", () => {
    // Overwriting from a run nobody scored poisons the drift reference
    // invisibly: the NEXT run compares against garbage and reports no drift.
    expect(shouldWriteRolling({ mode: "live", complete: false, filtered: false })).toBe(false);
  });

  it("never writes from a dry run", () => {
    expect(shouldWriteRolling({ mode: "dry", complete: true, filtered: false })).toBe(false);
  });

  // GUARD 2 of the four filter properties. Mutation-proved: dropping
  // `&& filtered === false` from the return turns this red and nothing else.
  it("never writes the drift reference from a FILTERED run", () => {
    expect(shouldWriteRolling({ mode: "live", complete: true, filtered: true })).toBe(false);
  });

  it("refuses to answer at all when `filtered` was not supplied", () => {
    // A defaulted flag makes omission mean "not filtered", and the file a
    // forgotten argument overwrites is the drift reference every later run is
    // measured against.
    expect(() => shouldWriteRolling({ mode: "live", complete: true })).toThrow(/filtered/i);
  });
});

import { parseFilter, filterSpec, buildRunRecord, FILTER_ENV, ARM_IDS } from "./ai-eval-lib.mjs";

describe("parseFilter", () => {
  it("returns null when no filter variable is set — the standard run", () => {
    expect(parseFilter({})).toEqual({ ok: true, filter: null });
  });

  it("treats an empty or whitespace-only value as unset, not as 'select nothing'", () => {
    // Selecting nothing would dispatch nothing and then report a verdict over
    // it, which is the vacuity this harness exists to refuse.
    expect(parseFilter({ [FILTER_ENV.arms]: "", [FILTER_ENV.probes]: "   " }))
      .toEqual({ ok: true, filter: null });
  });

  it("parses probes, reps and arms and carries a readable spec", () => {
    const r = parseFilter({
      [FILTER_ENV.probes]: "chatPointer",
      [FILTER_ENV.reps]: "1",
      [FILTER_ENV.arms]: "a",
    });
    expect(r.ok).toBe(true);
    expect(r.filter.probes).toEqual(["chatPointer"]);
    expect(r.filter.reps).toBe(1);
    expect(r.filter.arms).toEqual(["A"]);
    expect(r.filter.spec).toBe("probes=chatPointer reps=1 arms=A");
  });

  it("leaves an unset dimension null rather than filling it in", () => {
    const r = parseFilter({ [FILTER_ENV.probes]: "date,insights,date" });
    expect(r.filter.probes).toEqual(["date", "insights"]); // deduped
    expect(r.filter.reps).toBeNull();
    expect(r.filter.arms).toBeNull();
  });

  it("refuses an unknown probe id rather than silently ignoring it", () => {
    const r = parseFilter({ [FILTER_ENV.probes]: "chatPointer,nosuchprobe" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/nosuchprobe/);
  });

  it("refuses an unknown arm rather than silently ignoring it", () => {
    const r = parseFilter({ [FILTER_ENV.arms]: "A,Q" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/unknown arm/i);
    expect(ARM_IDS).toEqual(["A", "B", "X", "N", "R"]);
  });

  it("refuses a non-numeric or out-of-range rep count", () => {
    expect(parseFilter({ [FILTER_ENV.reps]: "one" }).ok).toBe(false);
    expect(parseFilter({ [FILTER_ENV.reps]: "0" }).ok).toBe(false);
    expect(parseFilter({ [FILTER_ENV.reps]: "500" }).ok).toBe(false);
    expect(parseFilter({ [FILTER_ENV.reps]: "3" }).ok).toBe(true);
  });

  it("still counts as a filter when it names everything", () => {
    // Proving a filter equivalent to the standard run means re-deriving the
    // plan, and a check that re-derives the thing it guards drifts from it.
    const r = parseFilter({ [FILTER_ENV.arms]: "A,B,X,N,R" });
    expect(r.filter).not.toBeNull();
  });

  it("renders 'none' for a null filter", () => {
    expect(filterSpec(null)).toBe("none");
  });
});

describe("the filter can never report PASS", () => {
  const good = [{ id: "date", A: 1.0, B: 1.0, X: 0 }];

  // GUARD 1 of the four filter properties. Mutation-proved: removing the
  // `run.filter !== null` reason turns this red and nothing else.
  it("is UNUSABLE on an otherwise perfect run when a filter was applied", () => {
    const v = verdict({
      complete: true,
      perProbe: good,
      filter: { probes: ["date"], reps: 1, arms: ["A"], spec: "probes=date reps=1 arms=A" },
    });
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.join(" ")).toMatch(/FILTERED/);
    expect(v.reasons.join(" ")).toMatch(/probes=date reps=1 arms=A/);
  });

  it("refuses to answer at all when `filter` was not supplied", () => {
    expect(() => verdict({ complete: true, perProbe: good })).toThrow(/filter/i);
  });

  it("treats an explicit undefined as missing too, never as unfiltered", () => {
    expect(() => verdict({ complete: true, perProbe: good, filter: undefined }))
      .toThrow(/filter/i);
  });

  it("still passes an unfiltered run — the guard costs the standard run nothing", () => {
    expect(verdict({ complete: true, perProbe: good, filter: null }).code).toBe(E.PASS);
  });

  it("reports BOTH the filter and the incompleteness when both hold", () => {
    const v = verdict({ complete: false, perProbe: good, filter: { probes: ["date"] } });
    expect(v.code).toBe(E.UNUSABLE);
    expect(v.reasons.join(" ")).toMatch(/FILTERED/);
    expect(v.reasons.join(" ")).toMatch(/did not complete/);
  });
});

describe("buildRunRecord", () => {
  const base = {
    date: "2026-09-09", model: "m", gitSha: "abc", anchorHash: "h", rollingHash: null,
    anchorSpec: { seed: 1 }, reps: 5, salt: 1,
    sizes: {}, usage: {}, graded: [], drift: {}, samples: [],
    perProbe: [{ id: "date", A: 1.0, B: 1.0, X: 0 }],
    complete: true,
  };

  // GUARD 3 of the four filter properties: the record carries the narrowing,
  // so a reader can never mistake a narrowed record for a full one.
  it("records the filter that was applied", () => {
    const f = { probes: ["chatPointer"], reps: 1, arms: ["A"], spec: "probes=chatPointer reps=1 arms=A" };
    const rec = buildRunRecord({ ...base, filter: f });
    expect(rec.filter).toEqual(f);
  });

  // GUARD 4: an unfiltered run behaves exactly as before.
  it("records filter: null and a PASS verdict for a standard run", () => {
    const rec = buildRunRecord({ ...base, filter: null });
    expect(rec.filter).toBeNull();
    expect(rec.verdict.code).toBe(E.PASS);
    expect(rec.complete).toBe(true);
  });

  it("derives the verdict from the SAME filter it records, so the two cannot disagree", () => {
    const rec = buildRunRecord({ ...base, filter: { probes: ["date"], spec: "probes=date" } });
    expect(rec.filter).not.toBeNull();
    expect(rec.verdict.code).toBe(E.UNUSABLE);
    expect(rec.verdict.reasons.join(" ")).toMatch(/FILTERED/);
  });

  it("carries rollingWrittenHash through, and nulls it when nothing was written", () => {
    // ★★ `buildRunRecord` copies an EXPLICIT field list, so a new field added
    //    at the call site is silently dropped unless it is added here too —
    //    which is how this very field went missing on its first cut. The next
    //    run's pre-flight reads it; a dropped one makes the drift reference
    //    permanently unverifiable, with every gate green.
    expect(buildRunRecord({ ...base, filter: null, rollingWrittenHash: "abc" }).rollingWrittenHash)
      .toBe("abc");
    expect(buildRunRecord({ ...base, filter: null }).rollingWrittenHash).toBeNull();
  });

  it("carries maxOutputTokens and responseShape through, nulling them when absent", () => {
    // ★★ Same explicit-field-list hazard as rollingWrittenHash above, and the
    //    same consequence: `outputTokens` is only comparable between runs at
    //    the same cap, and a dropped `responseShape` puts a run back to being
    //    undiagnosable — which is what cost the 2026-09-09 sweep a rerun.
    const shape = { stopReasons: { end_turn: 12, max_tokens: 3 }, blockTypes: { text: 12 } };
    const rec = buildRunRecord({ ...base, filter: null, maxOutputTokens: 512, responseShape: shape });
    expect(rec.maxOutputTokens).toBe(512);
    expect(rec.responseShape).toEqual(shape);
    const bare = buildRunRecord({ ...base, filter: null });
    expect(bare.maxOutputTokens).toBeNull();
    expect(bare.responseShape).toBeNull();
  });

  it("carries the top-level truncation summary through", () => {
    // ★★ A run carrying truncations is partly measuring its own cap, and that
    //    must be readable from the record's SHAPE rather than reconstructed by
    //    hunting through samples. Explicit field list, so an untested
    //    pass-through is a field silently dropped — twice already.
    const trunc = {
      replies: 2, ofReplies: 15, maxOutputTokens: 512,
      probes: ["chatPointer"], arms: ["A"],
    };
    expect(buildRunRecord({ ...base, filter: null, truncation: trunc }).truncation)
      .toEqual(trunc);
    expect(buildRunRecord({ ...base, filter: null }).truncation).toBeNull();
  });

  it("refuses to build a record with no filter field", () => {
    expect(() => buildRunRecord({ ...base })).toThrow(/filter/i);
  });
});
