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

  it("looks a probe up by id and throws on an unknown one", () => {
    expect(probeById("date").id).toBe("date");
    expect(() => probeById("nope")).toThrow(/unknown probe/i);
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

import { scoreResponse, hitRate } from "./ai-eval-lib.mjs";

describe("scoreResponse", () => {
  const t = "vorquenzil";
  const d = "mabtresk";

  it("scores the target alone as a hit", () => {
    expect(scoreResponse("vorquenzil", t, d)).toBe("hit");
  });

  it("scores the decoy alone as wrong-block", () => {
    expect(scoreResponse("I think it is mabtresk", t, d)).toBe("wrong-block");
  });

  it("scores neither as absent", () => {
    expect(scoreResponse("I could not find a code.", t, d)).toBe("absent");
  });

  it("scores both as ambiguous, never as a hit", () => {
    // The question named ONE block. Returning both means it did not answer the
    // question asked, so counting it as a hit would inflate every rate.
    expect(scoreResponse("either vorquenzil or mabtresk", t, d)).toBe("ambiguous");
  });

  it("is case-insensitive on the token", () => {
    expect(scoreResponse("VORQUENZIL", t, d)).toBe("hit");
  });

  it("scores a repeated target with no decoy as a hit, not ambiguous", () => {
    // Repetition is not ambiguity — only the DECOY's presence flips the verdict
    // to "ambiguous". A model that says the right thing twice still answered
    // the question that was asked.
    expect(scoreResponse("vorquenzil, vorquenzil", t, d)).toBe("hit");
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

  it("refuses to build a record with no filter field", () => {
    expect(() => buildRunRecord({ ...base })).toThrow(/filter/i);
  });
});
