import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_KIND_TO_KEY } from "./activity-log";
import {
  ACTIVITY_PLURAL_KINDS,
  activityChangeValues,
  activityMessage,
  activityPluralBase,
} from "./activity-message";
import { loadI18n } from "./i18n";
import { formatExpiryDate } from "./date-format";

describe("activityMessage", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  // §715 — a project-record edit names the fields it changed, in both languages.
  it("renders project.updated with the changed field names", () => {
    expect(activityMessage("en-US", "project.updated", ["customer, endDate"])).toBe("Project details updated: customer, endDate");
    expect(activityMessage("de", "project.updated", ["customer, endDate"])).toBe("Projektdetails aktualisiert: customer, endDate");
  });

  // The panel (display: true) names the changed fields as the project form does; the stored args, the
  // audit download and the AI prompt keep the keys. A key outside `ProjectMeta` stays as written.
  it("renders project.updated field keys as the form's labels for display", () => {
    const args = ["customer, endDate, contactPersons, keyStakeholdersInternal, keyStakeholdersExternal, knowledgeLinks"];
    expect(activityMessage("en-US", "project.updated", args, { display: true })).toBe(
      "Project details updated: Customer, End date, Contact persons, Internal stakeholders, External stakeholders, Knowledge",
    );
    expect(activityMessage("de", "project.updated", args, { display: true })).toBe(
      "Projektdetails aktualisiert: Kunde, Enddatum, Ansprechpartner, Interne Stakeholder, Externe Stakeholder, Wissen",
    );
  });

  /**
   * ★★★ THE DRIFT PIN. `ACTIVITY_PLURAL` restates the base key that
   * `ACTIVITY_KIND_TO_KEY` already maps the kind to, because typing it
   * `PluralBaseKey` is what makes an unpaired key a tsc error — a Record of
   * slot numbers alone could not. The cost of that duplication is exactly this
   * failure mode: the two tables disagreeing, and the renderer then pluralising
   * a key the entry does not use. Nothing else in the repo compares them.
   */
  it("keeps every plural base in step with the kind→key map", () => {
    // ★★ EXACT, not `> 0`, and the loose form is what this replaced. The
    // anti-vacuity floor is the guard meant to notice a DELETED row, and at
    // `> 0` it stays green with one member left — so it did not do the one job
    // it was there for. Measured 2026-09-08: two members; §450 tier 1 added
    // eight (2026-10-02). Bump this deliberately when a kind is added, which
    // is the point.
    expect(ACTIVITY_PLURAL_KINDS.length).toBe(12);
    for (const kind of ACTIVITY_PLURAL_KINDS) {
      expect(activityPluralBase(kind)).toBe(ACTIVITY_KIND_TO_KEY[kind]);
    }
  });

  /**
   * ★★★ THE COMPLETENESS PIN, AND IT GUARDS THE ONLY DIRECTION LEFT OPEN.
   * The drift pin above compares the members that are PRESENT; a kind whose
   * key gains a `…One` sibling and never gets an `ACTIVITY_PLURAL` row is
   * invisible to it, and that omission IS the original defect — the renderer
   * silently keeps calling `t()` and emits "1 allocation cells" again.
   *
   * ★★ The i18n-plural scan is NOT a substitute, and reading it as one is the
   * trap. It would fire (the new base key sits as a bare literal in
   * `activity-log.ts`'s Record, so it lands in `bareOffenders`), but its own
   * failure message offers "convert it, OR add `key@file` to EXCEPTIONS with
   * the reason", modelling exactly the resolution that leaves the defect in
   * place. A developer following that message can turn the gate green without
   * touching `ACTIVITY_PLURAL`. This test is the one that cannot be satisfied
   * that way.
   *
   * ★ Reads the dictionary from SOURCE rather than importing it, because the
   * EN key set is a compile-time type (`keyof typeof enUS`) with no runtime
   * export. The key half of a line is never wrapped, so a `^  key:` anchor is
   * safe here — unlike a VALUE scan, where ~200 EN values wrap onto the next
   * line and an anchored grep undercounts by 24% (§450).
   */
  it("routes every map-reachable key that HAS a singular sibling through ACTIVITY_PLURAL", () => {
    const src = readFileSync("src/app/i18n.ts", "utf8");
    const keys = new Set([...src.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
    // Cross-check the scan itself: the sibling suite measures the same
    // population independently and quotes 42. A scan that reads nothing would
    // make this whole test vacuous.
    const paired = [...keys].filter((k) => !k.endsWith("One") && keys.has(`${k}One`));
    expect(paired.length).toBeGreaterThanOrEqual(40);

    const missing = Object.entries(ACTIVITY_KIND_TO_KEY)
      .filter(([kind, key]) => keys.has(`${key}One`) && !ACTIVITY_PLURAL_KINDS.includes(kind as never))
      .map(([kind, key]) => `${kind} → ${key} (has ${key}One)`);
    expect(missing, `add an ACTIVITY_PLURAL row for: ${missing.join(", ")}`).toEqual([]);
  });

  it("selects the singular at a count of one and the plural elsewhere", () => {
    expect(activityMessage("en-US", "ai.allocationPlan", [1])).toBe("AI planned 1 allocation cell");
    expect(activityMessage("en-US", "ai.allocationPlan", [2])).toBe(
      "AI planned 2 allocation cells",
    );
    // ★ Zero is a real count and takes the PLURAL in both supported languages —
    //   the reason the finite-check below cannot be a truthiness test.
    expect(activityMessage("en-US", "ai.allocationPlan", [0])).toBe(
      "AI planned 0 allocation cells",
    );
    expect(activityMessage("en-US", "ai.wbsPlan", [1])).toBe("AI applied 1 work-breakdown change");
    expect(activityMessage("en-US", "ai.wbsPlan", [7])).toBe("AI applied 7 work-breakdown changes");
  });

  /**
   * ★ The panel stringifies through `changeText` before calling this, so the
   * count reaches it as `"1"`, not `1`. Both spellings must select the same
   * form or the two renderers disagree on the same entry.
   */
  it("selects on a stringified count exactly as on a numeric one", () => {
    expect(activityMessage("en-US", "ai.raciSuggest", ["1"])).toBe(
      "Applied 1 AI-proposed RACI assignment",
    );
    expect(activityMessage("en-US", "ai.raciSuggest", ["4"])).toBe(
      "Applied 4 AI-proposed RACI assignments",
    );
  });

  it("agrees the German forms too", () => {
    expect(activityMessage("de", "ai.allocationPlan", [1])).toBe("KI hat 1 Planungszelle geplant");
    expect(activityMessage("de", "ai.allocationPlan", [3])).toBe("KI hat 3 Planungszellen geplant");
    expect(activityMessage("de", "ai.wbsPlan", [1])).toBe("KI hat 1 Änderung an den Arbeitspaketen übernommen");
    expect(activityMessage("de", "ai.wbsPlan", [5])).toBe("KI hat 5 Änderungen an den Arbeitspaketen übernommen");
  });

  // §769 — an applied alternative is logged by its NUMBER and counts only, never the model's summary.
  it("renders an applied Plan with AI alternative by number and counts", () => {
    expect(activityMessage("en-US", "ai.allocationPlanAlt", [2, 3, 4])).toBe("AI applied alternative 2: task moves 3, hour edits 4");
    // Count-neutral (ruling R6): two counts cannot share one plural selector, so a count of one still reads right.
    expect(activityMessage("en-US", "ai.allocationPlanAlt", [1, 1, 1])).toBe("AI applied alternative 1: task moves 1, hour edits 1");
    expect(activityMessage("de", "ai.allocationPlanAlt", [2, 3, 4])).toBe("KI hat Alternative 2 übernommen: Aufgabenverschiebungen 3, Stundenänderungen 4");
  });

  /**
   * A count that is not a number must not throw and must not render
   * singular text.
   *
   * ★★★ THESE TWO CASES TAKE DIFFERENT BRANCHES AND PRODUCE DIFFERENT STRINGS,
   * and an earlier version of this comment called them "the same safe form"
   * three lines above two visibly different expectations. `[""]` is
   * `Number("") === 0`, which `Intl` puts in `other`, so it renders the plural
   * with an EMPTY slot; `[]` has no arg at all, so `t()` leaves the literal
   * `{0}` in place — a pre-existing property of `t()` (it only replaces slots
   * it was given args for), surfaced here rather than introduced.
   *
   * ★★ NEITHER CASE PINS A GUARD, because there is no guard left to pin: both
   * reach `other` through `Intl` itself. What they pin is that a malformed
   * count cannot produce the SINGULAR — which is the user-visible property —
   * and that neither input throws.
   */
  it("renders the plural, not the singular, for a count that is not a number", () => {
    // `Number("") === 0` → `other` → the plural key, with an empty slot.
    expect(activityMessage("en-US", "ai.allocationPlan", [""])).toBe(
      "AI planned  allocation cells",
    );
    // No arg at all → `t()` leaves the literal `{0}`. Different branch, and
    // deliberately a different expectation from the case above.
    expect(activityMessage("en-US", "ai.allocationPlan", [])).toBe(
      "AI planned {0} allocation cells",
    );
    // ★ The property the test is NAMED for, asserted rather than implied: the
    //   singular is the form that must never appear for a malformed count.
    for (const args of [[""], [], ["abc"], [Number.NaN]]) {
      expect(activityMessage("en-US", "ai.allocationPlan", args)).not.toContain(
        "1 allocation cell",
      );
    }
  });

  it("keeps the unknown-kind fallback for a kind this release does not know", () => {
    expect(activityMessage("en-US", "future.kind", [])).toBe("Unrecognized activity (future.kind)");
  });

  /**
   * ★ The own-property guard in `activityMessageKey` is what stops this
   * resolving to `Function.prototype.toString` and crashing the panel. Pinned
   * here as well as there because this module is now the only caller.
   */
  it("does not resolve a prototype member as a kind", () => {
    expect(activityMessage("en-US", "toString", [])).toBe("Unrecognized activity (toString)");
  });
});

describe("§450 tier 1 — the eight converted activity kinds render a real singular", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("selects the singular at a count of one and the plural otherwise, in both languages", () => {
    expect(activityMessage("en-US", "undo", [1])).toBe("Undo: restored 1 item");
    expect(activityMessage("en-US", "undo", [3])).toBe("Undo: restored 3 items");
    expect(activityMessage("de", "bulk.edit", [1])).toBe("Sammelbearbeitung auf 1 Aufgabe angewendet");
    expect(activityMessage("de", "bulk.edit", [2])).toBe("Sammelbearbeitung auf 2 Aufgaben angewendet");
    // The count is slot 0 even where a second argument follows it.
    expect(activityMessage("de", "history.restore", [1, "v3"])).toBe("1 Änderung aus Version v3 wiederhergestellt");
    expect(activityMessage("en-US", "calendar.autoPulled", [1, "Kickoff"])).toBe("Auto-applied 1 Outlook date change to Kickoff");
  });
});


// §476 — the currency-switch entry stores the rate as a number and the ECB date as
// ISO; the RENDER formats both for the viewer's locale. The stored args never change.
describe("activityMessage — plan.currencySwitched formats its rate and date (§476)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  const args = ["EUR", "GBP", 0.852, "2026-10-13"];

  it("renders the rate with a decimal comma and a German date in German", () => {
    const msg = activityMessage("de", "plan.currencySwitched", args, { display: true });
    expect(msg).toContain("Kurs 0,852 ");
    expect(msg).not.toContain("2026-10-13");
    expect(msg).toContain(formatExpiryDate("2026-10-13", "de"));
  });

  it("renders the rate with a decimal point and an English date in English", () => {
    const msg = activityMessage("en-US", "plan.currencySwitched", args, { display: true });
    expect(msg).toBe(`Project currency switched from EUR to GBP at 0.852 (ECB rates of ${formatExpiryDate("2026-10-13", "en-US")})`);
    expect(msg).not.toContain("2026-10-13");
  });

  it("formats a rate the panel already stringified", () => {
    expect(activityMessage("de", "plan.currencySwitched", ["EUR", "GBP", "0.852", "2026-10-13"], { display: true })).toContain("Kurs 0,852 ");
  });

  it("leaves an unparseable rate and date as stored", () => {
    const msg = activityMessage("en-US", "plan.currencySwitched", ["EUR", "GBP", "n/a", "someday"], { display: true });
    expect(msg).toBe("Project currency switched from EUR to GBP at n/a (ECB rates of someday)");
  });

  it("does not touch another kind's numeric args", () => {
    expect(activityMessage("de", "history.restore", [1, "0.5"], { display: true })).toBe("1 Änderung aus Version 0.5 wiederhergestellt");
  });

  it("without the display option (the audit and prompt paths) renders the stored values", () => {
    expect(activityMessage("de", "plan.currencySwitched", args)).toContain("Kurs 0.852 (EZB-Kurse vom 2026-10-13)");
  });

  it("does not mutate the args it is given", () => {
    const stored = ["EUR", "GBP", 0.852, "2026-10-13"];
    activityMessage("de", "plan.currencySwitched", stored, { display: true });
    expect(stored).toEqual(["EUR", "GBP", 0.852, "2026-10-13"]);
  });
});

// §502 final review: a scenario's row count is stored as bare digits and worded only here, at render.
describe("activityChangeValues", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  const rows = (from: string, to: string) => ({ field: "changes", from, to });

  it("agrees in number and says an equal count is an edit", () => {
    expect(activityChangeValues("en-US", "forecastScenario.updated", rows("1", "2"))).toEqual({ from: "1 row", to: "2 rows" });
    expect(activityChangeValues("en-US", "forecastScenario.updated", rows("2", "1"))).toEqual({ from: "2 rows", to: "1 row" });
    expect(activityChangeValues("en-US", "forecastScenario.updated", rows("3", "3"))).toEqual({ from: "3 rows", to: "3 rows (edited)" });
    expect(activityChangeValues("en-US", "forecastScenario.updated", rows("1", "1"))).toEqual({ from: "1 row", to: "1 row (edited)" });
    expect(activityChangeValues("en-US", "forecastScenario.updated", rows("0", "1"))).toEqual({ from: "0 rows", to: "1 row" });
    expect(activityChangeValues("de", "forecastScenario.updated", rows("1", "1"))).toEqual({ from: "1 Zeile", to: "1 Zeile (bearbeitet)" });
  });

  it("passes every other change through unchanged", () => {
    // Another kind, another field, or a value that is not a bare count: raw data, shown as stored.
    expect(activityChangeValues("en-US", "task.updated", rows("1", "2"))).toEqual({ from: "1", to: "2" });
    expect(activityChangeValues("en-US", "forecastScenario.updated", { field: "name", from: "1", to: "2" })).toEqual({ from: "1", to: "2" });
    // A value that is not a bare count (hand-edited or foreign bytes) is shown as stored.
    expect(activityChangeValues("en-US", "forecastScenario.updated", rows("1 rows", "2 rows"))).toEqual({ from: "1 rows", to: "2 rows" });
  });
});

// §774 — the hours-moved entry stores a language-neutral "name ±hours" list; the panel formats it for the viewer.
describe("activityMessage — resource.hoursMoved formats its hours (§774)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  const args = ["Maya Patel -16; Liam Foster +16.5"];
  it("renders hours with the viewer's unit and decimal mark", () => {
    expect(activityMessage("de", "resource.hoursMoved", args, { display: true })).toBe(
      "Geplante Stunden verschoben: Maya Patel -16 Std., Liam Foster +16,5 Std.",
    );
    expect(activityMessage("en-US", "resource.hoursMoved", args, { display: true })).toBe(
      "Planned hours moved: Maya Patel -16 h, Liam Foster +16.5 h",
    );
  });
  it("keeps the stored text for the audit download and the AI prompt", () => {
    expect(activityMessage("en-US", "resource.hoursMoved", args)).toBe("Planned hours moved: Maya Patel -16; Liam Foster +16.5");
  });
  it("leaves a part it cannot read as stored", () => {
    expect(activityMessage("en-US", "resource.hoursMoved", ["odd"], { display: true })).toBe("Planned hours moved: odd");
  });
});

// AI-04 — an AI-drafted report entry stores the meeting date as ISO; the panel formats it for the viewer's locale.
describe("activityMessage — ai.reportDraft formats its meeting date", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });
  it("shows the formatted date in English and German, never the raw ISO", () => {
    for (const lang of ["en-US", "de"] as const) {
      const msg = activityMessage(lang, "ai.reportDraft", ["2026-06-01"], { display: true });
      expect(msg).toContain(formatExpiryDate("2026-06-01", lang));
      expect(msg).not.toContain("2026-06-01");
    }
  });
  it("shows a title (anything that is not an ISO date) as it is, and keeps the stored value without display", () => {
    expect(activityMessage("en-US", "ai.reportDraft", ["Kickoff"], { display: true })).toContain("Kickoff");
    expect(activityMessage("en-US", "ai.reportDraft", ["2026-06-01"])).toContain("2026-06-01");
  });
});
