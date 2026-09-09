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
