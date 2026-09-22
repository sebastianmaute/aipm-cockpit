import { describe, it, expect } from "vitest";
import {
  sanitizeSteeringCommittee,
  sanitizeRaidItem,
  dropUnacceptedRaidFields,
  sanitizeMilestone,
  sanitizeMilestoneTaskIds,
  sanitizeChangeItem,
  sanitizeModelChangeItem,
  sanitizeLoadedChangeItem,
  sanitizeLoadedSeedChangeItem,
  rebuildChangeForUpdate,
  sanitizeStakeholder,
  acceptsRiskScale,
  acceptsScheduleDays,
  acceptsCostAmount,
  acceptsStakeholderCategory,
  acceptsInfluenceInterest,
  sanitizeIsoDate,
  AMOUNT_MAX,
  toNumber,
} from "./sanitize";

/** Distinguishable test-case labels. `JSON.stringify` maps null, NaN and
 *  Infinity all to "null", so three probes would otherwise share a name and a
 *  failure could not be attributed to the value that caused it. */
const probeLabel = (v: unknown): string =>
  typeof v === "number" ? String(v) : (JSON.stringify(v) ?? String(v));

const baseRaid = {
  id: 1,
  category: "R" as const,
  title: "Vendor risk",
  status: "Open" as const,
  raisedDate: "2026-01-01",
};

describe("sanitizeRaidItem — inquiriesSent", () => {
  it("keeps a positive integer count", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: 4 })?.inquiriesSent).toBe(4);
  });
  it("floors a fractional count", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: 2.9 })?.inquiriesSent).toBe(2);
  });
  it("drops a negative count (sparse undefined)", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: -3 })?.inquiriesSent).toBeUndefined();
  });
  it("drops zero / absent (sparse undefined)", () => {
    expect(sanitizeRaidItem({ ...baseRaid, inquiriesSent: 0 })?.inquiriesSent).toBeUndefined();
    expect(sanitizeRaidItem({ ...baseRaid })?.inquiriesSent).toBeUndefined();
  });
});

describe("sanitizeSteeringCommittee — per-meeting report", () => {
  it("round-trips a valid meeting report (html/updatedAt/sentAt preserved)", () => {
    const out = sanitizeSteeringCommittee({
      name: "Board",
      memberResourceIds: [],
      meetings: [
        {
          id: 1,
          date: "2026-07-11",
          title: "Kickoff",
          report: {
            html: "<p>Status is green.</p>",
            updatedAt: "2026-07-11T10:00:00.000Z",
            sentAt: "2026-07-11T11:00:00.000Z",
          },
        },
      ],
      infoSchedules: [],
    })!;
    expect(out.meetings[0].report).toEqual({
      html: "<p>Status is green.</p>",
      updatedAt: "2026-07-11T10:00:00.000Z",
      sentAt: "2026-07-11T11:00:00.000Z",
    });
  });

  it("drops a report with no html", () => {
    const out = sanitizeSteeringCommittee({
      name: "Board",
      memberResourceIds: [],
      meetings: [
        { id: 1, date: "2026-07-11", title: "Kickoff", report: { updatedAt: "2026-07-11T10:00:00.000Z" } },
      ],
      infoSchedules: [],
    })!;
    expect(out.meetings[0].report).toBeUndefined();
  });

  const reportOf = (html: string) =>
    sanitizeSteeringCommittee({
      name: "Board",
      memberResourceIds: [],
      meetings: [
        { id: 1, date: "2026-07-11", title: "Kickoff", report: { html, updatedAt: "2026-07-11T10:00:00.000Z" } },
      ],
      infoSchedules: [],
    })!.meetings[0].report?.html;

  /** A `<` with no `>` after it — what a raw slice leaves when it cuts mid-tag. */
  const endsInsideTag = (s: string): boolean => {
    const lt = s.lastIndexOf("<");
    return lt !== -1 && s.indexOf(">", lt) === -1;
  };

  /** A high surrogate not followed by a low one, or a low one not preceded by a
   *  high one. A loop, not a lookbehind regex, so tsc's target cannot object. */
  const hasLoneSurrogate = (s: string): boolean => {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { i += 1; continue; }
        return true;
      }
      if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  };

  // ★★ §108. The cap used to be `rr.html.slice(0, 100_000)` over raw UTF-16
  // units, so an over-cap report could end inside a tag or on half a surrogate
  // pair. Over the cap it now goes through sanitizeRichText, which bounds VISIBLE
  // text and degrades to plain text past it.
  it("does not end an over-cap report inside a tag (§108)", () => {
    // The raw slice at 100_000 lands on "<s" of "<strong>". Visible text is
    // 99_999, within the cap, so the whole report survives untouched.
    const html = `<p>${"a".repeat(99_995)}<strong>bold</strong></p>`;
    const out = reportOf(html);
    expect(out).toBeDefined();
    expect(endsInsideTag(out!)).toBe(false);
    expect(out).toBe(html);
  });

  it("does not split a surrogate pair at the cap (§108)", () => {
    // The raw slice at 100_000 ends on the emoji's HIGH surrogate. Visible text
    // is 100_008, over the cap, so the report degrades to plain text cut at
    // 100_000 visible characters — after the pair, not inside it.
    const html = `<p>${"a".repeat(99_996)}\u{1F600}${"b".repeat(10)}</p>`;
    const out = reportOf(html)!;
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(endsInsideTag(out)).toBe(false);
    expect(out).toBe(`<p>${"a".repeat(99_996)}\u{1F600}bb</p>`);
  });

  it("caps an oversized report body to 100_000 VISIBLE characters", () => {
    expect(reportOf("x".repeat(200_000))).toBe(`<p>${"x".repeat(100_000)}</p>`);
  });

  it("drops an over-cap report with no visible text, matching the empty-html rule", () => {
    expect(reportOf(`<p>${"<br>".repeat(30_000)}</p>`)).toBeUndefined();
  });

  // ★★★ §108 r1: the anchored RICH_SINK "starts with a rich tag?" test answers
  // NO for a body that opens with plain text before its first real tag —
  // write-time DOMPurify output keeps a leading sentence like this — so
  // descriptionHtml escaped the WHOLE body into literal `&lt;h2&gt;`/`&lt;p&gt;`
  // text, which the next save then persisted. The fix classifies on RENDER_SINK
  // (unanchored "contains a tag anywhere?") instead.
  it("does not escape an over-cap report that opens with plain text before real markup (§108 r1)", () => {
    const html = "Here is the report:\n<h2>Summary</h2><p>" + "x".repeat(100_050) + "</p>";
    expect(html.length).toBeGreaterThan(100_000);
    const out = reportOf(html);
    expect(out).toBeDefined();
    expect(out).not.toContain("&lt;h2&gt;");
    expect(out).not.toContain("&lt;p&gt;");
    expect(out).toContain("Summary");
    expect(hasLoneSurrogate(out!)).toBe(false);
    expect(endsInsideTag(out!)).toBe(false);
  });

  it("returns an under-cap report BYTE-IDENTICAL, including shapes sanitizeRichText would rewrite", () => {
    // ★★★ THE CONTROL FOR THE LENGTH GATE. sanitizeRichText trims, turns a tab
    // into a space, and escapes a value that does not OPEN with a rich tag —
    // measured. Stored reports are sanitized at write time, so an under-cap one
    // must come back exactly as stored.
    for (const html of [
      "<p>Status is green.</p>",
      "<h2>Summary</h2>\n<p>ok</p>\n",
      "Here is the report:\n<h2>Summary</h2><p>ok</p>",
      "<p>a\tb</p>",
      "x".repeat(100_000),
    ]) {
      expect(reportOf(html)).toBe(html);
    }
  });

  // ★★ Review r1 (§108): pin the literal `REPORT_HTML_MAX` boundary itself,
  // not just values well above/below it. sanitizeRichText's very first step
  // (WS_CONTROL) replaces every tab with a space UNCONDITIONALLY, before the
  // cap logic runs — so a tab is a clean observable marker for "did this body
  // go through sanitizeRichText at all".
  it("returns a report at the exact REPORT_HTML_MAX boundary byte-identical (§108 boundary)", () => {
    const html = `<p>${"a".repeat(99_992)}\t</p>`;
    expect(html.length).toBe(100_000);
    expect(reportOf(html)).toBe(html);
  });

  it("routes REPORT_HTML_MAX + 1 raw chars through sanitizeRichText (§108 boundary)", () => {
    const html = `<p>${"a".repeat(99_993)}\t</p>`;
    expect(html.length).toBe(100_001);
    const out = reportOf(html)!;
    expect(out).not.toBe(html);
    expect(out).not.toContain("\t");
    expect(endsInsideTag(out)).toBe(false);
    expect(hasLoneSurrogate(out)).toBe(false);
    expect(out).toBe(`<p>${"a".repeat(99_993)} </p>`);
  });
});

describe("entity rich-field sink regression (open-followups §143)", () => {
  // Same probe as narrative-html: RICH_ALLOWED_TAGS and DOCUMENT_ALLOWED_TAGS
  // differ by exactly "img". Measured: swapping "rich" -> "document" at these
  // six call sites left every owning suite (151/151) green before this test
  // existed.
  const IMG_INPUT = '<img src="x.png">Status';

  it("sanitizeMilestone escapes an <img>-leading description", () => {
    const m = sanitizeMilestone({ id: 1, name: "M1", date: "2026-01-01", description: IMG_INPUT });
    expect(m?.description).toContain("&lt;img");
    expect(m?.description).not.toContain("<img");
  });

  it("sanitizeChangeItem escapes <img>-leading description/impactDescription/resolutionNotes", () => {
    const c = sanitizeChangeItem({
      id: 1,
      title: "C1",
      description: IMG_INPUT,
      impactDescription: IMG_INPUT,
      resolutionNotes: IMG_INPUT,
    });
    expect(c?.description).toContain("&lt;img");
    expect(c?.description).not.toContain("<img");
    expect(c?.impactDescription).toContain("&lt;img");
    expect(c?.impactDescription).not.toContain("<img");
    expect(c?.resolutionNotes).toContain("&lt;img");
    expect(c?.resolutionNotes).not.toContain("<img");
  });

  it("sanitizeRaidItem escapes <img>-leading description/mitigation", () => {
    const r = sanitizeRaidItem({ id: 1, title: "R1", description: IMG_INPUT, mitigation: IMG_INPUT });
    expect(r?.description).toContain("&lt;img");
    expect(r?.description).not.toContain("<img");
    expect(r?.mitigation).toContain("&lt;img");
    expect(r?.mitigation).not.toContain("<img");
  });
});

describe("sanitizeMilestoneTaskIds", () => {
  it("keeps positive integers in first-occurrence order and dedupes", () => {
    // WAS "keeps positive integers in order and does NOT dedupe" — it expected
    // [3, 1, 3]. The order half is unchanged and still pinned here.
    expect(sanitizeMilestoneTaskIds([3, 1, 3])).toEqual([3, 1]);
  });

  it("parses a delimited string and dedupes, like sanitizeIdList", () => {
    // WAS "yields [] for a delimited string, unlike sanitizeIdList" — the
    // milestone rule was array-only and did not dedupe, so `linkedTaskIds: "1;2"`
    // linked two tasks on a raid item and NOTHING on a milestone, and duplicates
    // inflated the digest's linkedTasks count (§403).
    expect(sanitizeMilestoneTaskIds("1;2")).toEqual([1, 2]);
    expect(sanitizeMilestoneTaskIds([1, 1, 2])).toEqual([1, 2]);
    expect(sanitizeMilestoneTaskIds([3, 0, -1, "x"])).toEqual([3]);
  });

  it("drops zero, negatives and non-numbers", () => {
    expect(sanitizeMilestoneTaskIds([0, -1, "x", 2])).toEqual([2]);
  });
});

describe("delegate-never-restate: the raid sanitizer and its merge-site guard", () => {
  // ★★ This is a PROPERTY over the two, not a hand-picked row. The it.each
  //  tables in sanitize-raid-patch.test.ts cannot catch a divergence, because
  //  they assert chosen values against BOTH sides at once; a rule that drifted
  //  in the same direction on both would pass. Enumerating over a value set
  //  that straddles every boundary is what makes the delegation checkable.
  const PROBES: unknown[] = [
    1, 3, 5, 0, 6, -1, 2.5, "3", "abc", "", true, false, null, undefined, [], {}, NaN, Infinity,
  ];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "stores probability %s exactly when acceptsRiskScale admits it",
    (_label, probe) => {
      const item = sanitizeRaidItem({ id: 1, title: "t", category: "R", probability: probe });
      expect(item).not.toBeNull();
      expect("probability" in item!).toBe(acceptsRiskScale(probe, "R"));
    },
  );

  it("refuses a boolean probability rather than storing a fabricated 1", () => {
    // toNumber(true) is 1, which is inside [1,5] — so the old rule stored a
    // plausible score that feeds riskSeverityFromMatrix. toNumber(false) is 0
    // and was already out of range, so only one half of the pair was reachable.
    expect(acceptsRiskScale(true, "R")).toBe(false);
    expect(acceptsRiskScale(false, "R")).toBe(false);
    expect(acceptsRiskScale(3, "R")).toBe(true);
    expect(acceptsRiskScale("3", "R")).toBe(true);
  });
});

describe("delegate-never-restate: the change sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = [0, 1, 1.5, -1, "2", "abc", "", true, false, null, undefined, [], NaN, Infinity];

  // ★★★ THESE TWO SWEEPS NOW TARGET `sanitizeModelChangeItem`, NOT THE PLAIN
  //  SANITIZER, and the move is the whole point of this block rather than a
  //  detail of it. The property they assert — "the predicate BOUNDS what lands"
  //  — was written when the loader repaired, and it is FALSE of the loader
  //  today ON PURPOSE: `sanitizeChangeItem` stores a person's saved number
  //  VERBATIM, so a stored 1.5 stays 1.5 while `acceptsScheduleDays` refuses
  //  1.5. A loader that rewrites stored data is the defect; a loader bounded by
  //  a model-write predicate was the symptom. The bound is a real property of
  //  the MODEL path, so it moved there with the repair.
  // ★★ THE PREVIOUS WORDING HERE IS STILL WORTH KNOWING, because it records a
  //  property that has now been FALSE TWICE FOR DIFFERENT REASONS. The original
  //  sweep read `"scheduleImpactDays" in item === acceptsScheduleDays(probe)`
  //  and held while a refused value was simply DROPPED; the §399 repair broke
  //  it at the loose end (1.5 became 2, present where the predicate refuses);
  //  verbatim storage now breaks it at the other end (1.5 stays 1.5). Do not
  //  restore either earlier form against `sanitizeChangeItem`.
  // ★ The STORED path gets its own pins below, asserting the opposite property.
  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "never stores a scheduleImpactDays acceptsScheduleDays would refuse, on the MODEL path (%s)",
    (_label, probe) => {
      const item = sanitizeModelChangeItem({ id: 1, title: "t", scheduleImpactDays: probe });
      expect(item).not.toBeNull();
      const stored = item!.scheduleImpactDays;
      expect(stored === undefined || acceptsScheduleDays(stored)).toBe(true);
      // ★ Repair never touches a value the predicate ALREADY accepts, so where
      //  there is nothing to repair the model path and the merge-site guard
      //  agree exactly — which is what this sweep was originally for.
      if (acceptsScheduleDays(probe)) expect(stored).toBe(toNumber(probe));
    },
  );

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "never stores a costImpact acceptsCostAmount would refuse, on the MODEL path (%s)",
    (_label, probe) => {
      const item = sanitizeModelChangeItem({ id: 1, title: "t", costImpact: probe });
      expect(item).not.toBeNull();
      const stored = item!.costImpact;
      expect(stored === undefined || acceptsCostAmount(stored)).toBe(true);
      if (acceptsCostAmount(probe)) expect(stored).toBe(toNumber(probe));
    },
  );

  // ★★ THE SWEEPS ABOVE ARE VACUOUS IF NOTHING IS EVER STORED — a loader that
  //  dropped every value would satisfy both. These name the repaired values, so
  //  they are the only thing pinning that the repair HAPPENS.
  it("repairs a legacy out-of-precision value instead of destroying it, on the MODEL path", () => {
    // ★★★ THE DEFECT THIS CLOSES IS A SILENT CLEAR. Tightening the predicate
    //  without a repair means a `1.5` — the shape the pre-fix modal could write,
    //  its `{ round: 0 }` clamp running only on blur while Enter-submit skipped
    //  it — simply vanishes, and on a write path that cannot report it.
    // ★★ THIS TEST USED TO TARGET `sanitizeChangeItem` AND ITS THREE VALUES ARE
    //  UNCHANGED. Only the subject moved: repair is a MODEL-input policy now,
    //  because the load path must not rewrite stored data. The load path's own
    //  behaviour on these very values is pinned by the sibling test below, so
    //  the pair is a differential rather than two independent claims.
    expect(sanitizeModelChangeItem({ id: 1, title: "t", scheduleImpactDays: 1.5 })!.scheduleImpactDays).toBe(2);
    expect(sanitizeModelChangeItem({ id: 1, title: "t", costImpact: 1500.555 })!.costImpact).toBe(1500.56);
    expect(sanitizeModelChangeItem({ id: 1, title: "t", costImpact: 5_000_000_000 })!.costImpact).toBe(AMOUNT_MAX);
    // The three values the load path is pinned to keep, repaired here.
    expect(sanitizeModelChangeItem({ id: 1, title: "t", costImpact: 2_000_000_000 })!.costImpact).toBe(AMOUNT_MAX);
    expect(sanitizeModelChangeItem({ id: 1, title: "t", costImpact: 1234.567 })!.costImpact).toBe(1234.57);
    expect(sanitizeModelChangeItem({ id: 1, title: "t", scheduleImpactDays: 0.5 })!.scheduleImpactDays).toBe(1);
  });

  it("keeps a STORED number exactly as saved, repairing and capping nothing", () => {
    // ★★★ THE MIRROR DEFECT, AND THE ONE THIS SPLIT EXISTS FOR. A cut of this
    //  branch ran the repair inside `sanitizeChangeItem`, which five of the six
    //  write paths' read side funnel through — `buildChangeFromObj` serves CSV,
    //  Markdown and both Turso layouts, `jsonToWorkspace` the JSON slot — so
    //  every load silently rewrote data a person had saved. AMOUNT_MAX is 1e9,
    //  an ordinary project figure in JPY, KRW or IDR, so the clamp was not
    //  theoretical.
    expect(sanitizeChangeItem({ id: 1, title: "t", costImpact: 2_000_000_000 })!.costImpact).toBe(2_000_000_000);
    expect(sanitizeChangeItem({ id: 1, title: "t", costImpact: 1234.567 })!.costImpact).toBe(1234.567);
    expect(sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: 0.5 })!.scheduleImpactDays).toBe(0.5);
    // ★★★ THE POSITIVE CONTROL, WITHOUT WHICH THE THREE ABOVE ARE WORTHLESS.
    //  "Stored unchanged" only means something once the values are known to be
    //  ones the predicate REFUSES — otherwise a sanitizer that had simply
    //  stopped guarding anything, or a test bound to the wrong function, would
    //  pass all three. These four lines are what make this an assertion about
    //  policy rather than about arithmetic.
    expect(acceptsCostAmount(2_000_000_000)).toBe(false);
    expect(acceptsCostAmount(1234.567)).toBe(false);
    expect(acceptsScheduleDays(0.5)).toBe(false);
    expect(sanitizeModelChangeItem({ id: 1, title: "t", costImpact: 2_000_000_000 })!.costImpact).toBe(AMOUNT_MAX);
  });

  it("keeps a STORED costImpact/scheduleImpactDays verbatim through the load, seed-load and AI-update rebuilds (R-I1)", () => {
    // ★★★ `sanitize-model-change-wiring.test.ts` pins that the load funnels call
    //  `sanitizeLoaded(Seed)?ChangeItem` and the AI update calls
    //  `rebuildChangeForUpdate` — on the premise that their VERBATIM behaviour is
    //  pinned elsewhere. The test above pins it for `sanitizeChangeItem` only, so a
    //  repair added to any of these three (keeping its date reader) survived the
    //  suite. Both values are ones the predicates REFUSE (positive control above).
    const stored = { id: 1, title: "t", costImpact: 2_000_000_000, scheduleImpactDays: 1.5 };
    expect(acceptsScheduleDays(1.5)).toBe(false);
    for (const load of [sanitizeLoadedChangeItem, sanitizeLoadedSeedChangeItem]) {
      const item = load(stored)!;
      expect(item.costImpact).toBe(2_000_000_000);
      expect(item.scheduleImpactDays).toBe(1.5);
    }
    const storedItem = sanitizeLoadedChangeItem(stored)!;
    const rebuilt = rebuildChangeForUpdate(storedItem, { ...storedItem, title: "renamed" })!;
    expect(rebuilt.title).toBe("renamed");
    expect(rebuilt.costImpact).toBe(2_000_000_000);
    expect(rebuilt.scheduleImpactDays).toBe(1.5);
  });

  it("leaves an already-valid value untouched on BOTH paths", () => {
    // ★ Where nothing needs repair the two functions are indistinguishable,
    //  which is what bounds the blast radius of the split: it changes only what
    //  happens to a value the predicate refuses.
    for (const sanitize of [sanitizeChangeItem, sanitizeModelChangeItem]) {
      expect(sanitize({ id: 1, title: "t", scheduleImpactDays: 12 })!.scheduleImpactDays).toBe(12);
      expect(sanitize({ id: 1, title: "t", costImpact: 4500.25 })!.costImpact).toBe(4500.25);
    }
  });

  it("still DROPS a boolean rather than repairing it into a fabricated number, on BOTH paths", () => {
    // ★★★ THE ONE VALUE WITH NO CORRECT REPAIR. `toNumber(true)` is 1, which is
    //  a plausible day count and a plausible cost — the §395 fabrication — so
    //  `isCoercibleNumber` gates the repair as well as the acceptance. Rounding
    //  it would be worse than dropping it: the number would look authored.
    // ★★★ ASSERTED ON BOTH FUNCTIONS BECAUSE "VERBATIM" IS THE EASIEST PLACE TO
    //  LOSE THIS. Storing a person's number unchanged is one step from storing
    //  whatever arrives unchanged, and the pre-branch loader — which this split
    //  otherwise restores — used a bare `toNumber` and DID save `true` as 1.
    //  The load path is verbatim about NUMBERS only; §395 stays fixed on it.
    for (const sanitize of [sanitizeChangeItem, sanitizeModelChangeItem]) {
      expect("scheduleImpactDays" in sanitize({ id: 1, title: "t", scheduleImpactDays: true })!).toBe(false);
      expect("costImpact" in sanitize({ id: 1, title: "t", costImpact: true })!).toBe(false);
      // ★ A NEGATIVE COST is dropped too, not clamped to 0 — `repairCostAmount`
      //  covers precision and the cap, never the floor, which is where
      //  `sanitizeAmount` puts it. The load path drops it on its own `>= 0` leg.
      expect("costImpact" in sanitize({ id: 1, title: "t", costImpact: -5 })!).toBe(false);
    }
    // ★★★ THAT IS NOT A SYMMETRY ACROSS THE TWO AMOUNTS, and an earlier wording
    //  of this comment asserted one ("A NEGATIVE is dropped too", unqualified).
    //  It holds for `costImpact`, whose predicate has an explicit `n < 0`. It is
    //  FALSE for `scheduleImpactDays` over [-0.5, 0]: `repairScheduleDays` is
    //  `Math.round`, which returns `-0` there (JS rounds .5 toward +∞), and
    //  `Number.isInteger(-0)` and `-0 >= 0` are both true — so it is ACCEPTED
    //  and stored. The stored `-0` is harmless (it normalises to 0 on the next
    //  save) and rounding a near-zero negative to zero is arguably the right
    //  repair. The defect was the JUSTIFICATION, which claimed a floor rule the
    //  two fields do not share. Measured, not reasoned — these two probes are
    //  the measurement.
    // ★★ THE SUBJECT MOVED WITH THE REPAIR AND THE ASSERTIONS ARE OTHERWISE
    //  UNTOUCHED: `Math.round` is what produces the `-0`, and `Math.round` now
    //  runs only on the MODEL path. The reasoning above is unchanged and still
    //  governs — a review round proposed giving `repairScheduleDays` the `n < 0`
    //  leg its sibling has, which is exactly the symmetry this comment records
    //  as already considered and rejected. It would also not achieve its stated
    //  aim: `-0 < 0` is false, so the leg removes the [-0.5, 0) window and
    //  leaves an explicit `-0` stored regardless.
    const nearZero = sanitizeModelChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.4 })!;
    expect(Object.is(nearZero.scheduleImpactDays, -0)).toBe(true);
    const halfDown = sanitizeModelChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.5 })!;
    expect(Object.is(halfDown.scheduleImpactDays, -0)).toBe(true);
    // ★★ THE LOAD PATH DOES NOT SHARE IT, and that asymmetry is now a THIRD
    //  thing this test pins. With no `Math.round` to pull it up to `-0`, a
    //  stored `-0.4` fails the loader's own `>= 0` leg and the key is dropped.
    //  So the `-0` is an artefact of REPAIR, never of storage.
    expect("scheduleImpactDays" in sanitizeChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.4 })!).toBe(false);
    // ★ The interval really is closed at BOTH ends, so the acceptance is
    //  bounded rather than open-ended: anything below -0.5 rounds to -1 or less
    //  and the floor rejects it. ★★ `-0.6` is a COMFORTABLE probe, not the
    //  boundary — an earlier wording called it "one step further out", which
    //  overstates how tightly this pins the edge. The true first rejected value
    //  is the next double below -0.5, `-0.5000000000000001`; probing at the
    //  representable edge would pin float behaviour rather than this rule.
    // ★ On the MODEL path, matching the two probes above: this closes the
    //  REPAIR interval, and only the repair path has one to close.
    expect("scheduleImpactDays" in sanitizeModelChangeItem({ id: 1, title: "t", scheduleImpactDays: -0.6 })!).toBe(false);
  });
});

/** ★★★ THIS BLOCK CANNOT SEE THE MERGE-SITE GUARD, WHICH IS WHY ITS NAME NO
 *  LONGER CLAIMS TO — the peer blocks above still say "and its merge-site
 *  guard" and this one deliberately does not. It exercises `sanitizeMilestone`
 *  alone, and its expectation is COMPUTED BY THE SAME CALL the subject makes
 *  (`sanitizeIsoDate(probe)`), so it is a round-trip check of the sanitizer's
 *  own rule and nothing more. Kept because that round trip is real; renamed
 *  because the old name pointed an auditor at coverage that is not here.
 *
 *  ★★ MEASURED, not reasoned: deleting the `achievedDate: acceptsPatchDate` row
 *  from `MILESTONE_FIELD_GUARDS` leaves this WHOLE FILE green — 0 failed / 100
 *  passed. The same mutant turns `sanitize-milestone-patch.test.ts` red at
 *  8 failed / 26 passed, in its `dropUnacceptedMilestoneFields` describe. THAT
 *  file is the guard's only pin; do not read a green run here as covering it. */
describe("delegate-never-restate: the milestone sanitizer's own achievedDate rule", () => {
  const PROBES: unknown[] = ["2026-01-01", "not-a-date", "", "1899-01-01", 42, true, null, undefined, [], {}];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "keeps achievedDate %s only when the stored value is a real date",
    (_label, probe) => {
      const m = sanitizeMilestone({ id: 1, name: "n", date: "2026-01-01", achievedDate: probe });
      expect(m).not.toBeNull();
      // The guard's clear-carve-out admits values the sanitizer stores nothing
      // for, so the two are NOT equivalent here — assert the sanitizer's own
      // rule and let acceptsPatchDate stay the guard's business.
      expect("achievedDate" in m!).toBe(sanitizeIsoDate(probe) !== "");
    },
  );
});

describe("delegate-never-restate: the stakeholder sanitizer and its merge-site guard", () => {
  const PROBES: unknown[] = ["Sponsor", "Other", "Nonsense", "", 42, true, null, undefined, [], {}];

  it.each(PROBES.map((v) => [probeLabel(v), v] as const))(
    "keeps category %s verbatim exactly when acceptsStakeholderCategory admits it",
    (_label, probe) => {
      const s = sanitizeStakeholder({ id: 1, name: "n", category: probe });
      expect(s).not.toBeNull();
      // A REFUSED value is reset to the hardcoded fallback, which is the defect
      // class the merge-site guard exists to stop. Assert the RESET, not a
      // missing key: this sanitizer always emits the field.
      expect(s!.category === probe).toBe(acceptsStakeholderCategory(probe));
    },
  );

  // influence/interest share acceptsInfluenceInterest and had no property
  // coverage of their own — the category sweep above cannot stand in for
  // them, since a divergence specific to this predicate would pass unseen.
  const INFLUENCE_PROBES: unknown[] = [
    "Low", "Medium", "High", "Nonsense", "", 42, true, null, undefined, [], {},
  ];

  it.each(INFLUENCE_PROBES.map((v) => [probeLabel(v), v] as const))(
    "keeps influence/interest %s verbatim exactly when acceptsInfluenceInterest admits it",
    (_label, probe) => {
      const s = sanitizeStakeholder({ id: 1, name: "n", influence: probe, interest: probe });
      expect(s).not.toBeNull();
      // "Medium" plays the same role here that "Other" plays for category: it
      // equals the fallback, so it is the probe that would catch a delegation
      // that always refuses. Keep it in the probe set.
      const admits = acceptsInfluenceInterest(probe);
      expect(s!.influence === probe).toBe(admits);
      expect(s!.interest === probe).toBe(admits);
    },
  );

  // ★★ The two it.each sweeps above compute their expectation by CALLING the
  //  predicate, so both sides move together — a predicate that accepted (or
  //  refused) EVERYTHING would keep the whole table green either way. These
  //  expectations are hardcoded on purpose: they are the only thing here that
  //  pins WHICH values are legal, independent of the predicate under test.
  it("names the accepted enum members, so an always-accepts mutant cannot hide", () => {
    expect(acceptsStakeholderCategory("Sponsor")).toBe(true);
    expect(acceptsStakeholderCategory("Nonsense")).toBe(false);
    expect(acceptsInfluenceInterest("Medium")).toBe(true);
    expect(acceptsInfluenceInterest("Nonsense")).toBe(false);
  });
});

// ★★★ THE TWO AMOUNT FIELDS DO NOT SHARE A PRECISION RULE, which is the whole
//  reason one `acceptsChangeAmount` had to become two. `change-edit-modal.tsx`
//  clamps `scheduleImpactDays` with `describeClamp(value, { min: 0, round: 0 })`
//  and `costImpact` with `{ min: 0, max: AMOUNT_MAX, round: 2 }` — so the two
//  move in OPPOSITE directions here (§399): the writer TIGHTENS for days, the
//  preview LOOSENS for money. These expectations are hardcoded rather than
//  derived from the predicates, so an always-accepts mutant cannot hide behind
//  the it.each sweeps above, which compute both sides from the predicate.
describe("change amount precision follows each field's own form control", () => {
  // ★★★ THE NAME USED TO READ "which round:0 cannot produce" AND THAT WAS
  //  FALSE. `describeClamp(value, { min: 0, round: 0 })` ran only in the
  //  field's `onBlur`, and Enter inside a text input submits WITHOUT firing
  //  blur — the modal's own comment says so — so the form produced `1.5`
  //  routinely until the commit before this one added the same clamp to
  //  `handleSubmit`. The predicate is right either way; the JUSTIFICATION was
  //  the false half, and it is why `repairScheduleDays` exists for the data
  //  already written.
  it("refuses a fractional schedule-impact day, which the form no longer produces", () => {
    expect(acceptsScheduleDays(1.5)).toBe(false);
    expect(acceptsScheduleDays(2)).toBe(true);
    expect(acceptsScheduleDays(0)).toBe(true);
  });

  it("accepts a two-decimal cost, which round:2 does produce", () => {
    expect(acceptsCostAmount(1500.5)).toBe(true);
    expect(acceptsCostAmount(1500.55)).toBe(true);
  });

  it("refuses a cost with more precision than the form can express", () => {
    expect(acceptsCostAmount(1500.555)).toBe(false);
  });

  it("refuses a cost above the cap the form clamps to", () => {
    // Neither the sanitizer nor the preview had an upper bound, so a model
    // could store a cost a thousand times larger than the form permits.
    expect(acceptsCostAmount(AMOUNT_MAX)).toBe(true);
    expect(acceptsCostAmount(AMOUNT_MAX + 1)).toBe(false);
  });

  it("refuses a boolean on both, for the same reason as the risk scale", () => {
    expect(acceptsScheduleDays(true)).toBe(false);
    expect(acceptsCostAmount(true)).toBe(false);
  });
});

describe("sanitizeRaidItem — escalations", () => {
  const ESC = { at: "2026-05-20T09:30:00.000Z", toName: "Noah Bennett", toEmail: "noah.bennett@example.com", fromSeverity: "Medium", toSeverity: "High" };
  it("keeps a valid escalation record", () => {
    expect(sanitizeRaidItem({ ...baseRaid, escalations: [ESC] })?.escalations).toEqual([ESC]);
  });
  it("is sparse: absent, empty or wholly invalid -> undefined", () => {
    expect(sanitizeRaidItem({ ...baseRaid })?.escalations).toBeUndefined();
    expect(sanitizeRaidItem({ ...baseRaid, escalations: [] })?.escalations).toBeUndefined();
    expect(sanitizeRaidItem({ ...baseRaid, escalations: [{ at: "nope" }] })?.escalations).toBeUndefined();
  });
});

describe("dropUnacceptedRaidFields — escalations is model-read-only (§515)", () => {
  const ESC = { at: "2026-05-20T09:30:00.000Z", toEmail: "forged@example.com", toSeverity: "Critical" };
  it("drops a model-supplied escalations key and keeps the rest of the patch", () => {
    expect(dropUnacceptedRaidFields({ title: "Renamed", escalations: [ESC] }, { category: "I" })).toEqual({ title: "Renamed" });
  });
  it("positive control: a patch without escalations is returned untouched", () => {
    const patch = { title: "Renamed" };
    expect(dropUnacceptedRaidFields(patch, { category: "I" })).toBe(patch);
  });
});
