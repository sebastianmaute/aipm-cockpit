import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { loadI18n, tPlural } from "./i18n";

describe("tPlural", () => {
  beforeAll(async () => {
    // The DE dictionary is lazy — an assertion on German output before this
    // resolves silently reads the EN fallback and passes for the wrong reason.
    await loadI18n("de");
  });

  it("selects the singular key only for a count of exactly one", () => {
    expect(tPlural("en-US", "activityEntriesLogged", 1, 1)).toBe("1 entry logged");
    expect(tPlural("en-US", "activityEntriesLogged", 2, 2)).toBe("2 entries logged");
  });

  // ★ ZERO is the assertion that discriminates the implementations. A naive
  // `count === 1 ?` and a correct Intl.PluralRules both pass the 1-vs-2 case
  // above; a `count > 1 ?` implementation passes it too and gets ZERO wrong.
  it("treats zero as the plural form, not the singular", () => {
    expect(tPlural("en-US", "activityEntriesLogged", 0, 0)).toBe("0 entries logged");
    expect(tPlural("de", "activityEntriesLogged", 0, 0)).toBe("0 Einträge protokolliert");
  });

  // ★★★ NEGATIVE ONE IS THE OTHER DISCRIMINATOR, AND THE HELPER SHIPPED
  // GETTING IT WRONG. CLDR's plural operands use the ABSOLUTE integer part, so
  // `new Intl.PluralRules(l).select(-1)` is "one" in all three locales while
  // the `count === 1` ternary this replaced gave the plural. The singular
  // forms hardcode the digit, so the minus sign was silently DELETED: an
  // overdue steering info-reminder at daysLeft === -1 rendered identically to
  // one due tomorrow. Found by cold review, 2026-09-07.
  // ★★ Assert -1 AND -2. Only -1 is affected (-2 is already "other"), so a
  // test written at -3 — the value a reader reaches for when checking
  // "negatives" — passes against the unfixed helper. -2 is the control that
  // proves this test is testing the boundary and not negatives in general.
  it("treats a negative count as the plural form, at the -1 boundary", () => {
    expect(tPlural("en-US", "activityEntriesLogged", -1, -1)).toBe("-1 entries logged");
    expect(tPlural("de", "activityEntriesLogged", -1, -1)).toBe("-1 Einträge protokolliert");
    expect(tPlural("en-US", "activityEntriesLogged", -2, -2)).toBe("-2 entries logged");
  });

  it("selects the German singular, which is a different stem, not a suffix drop", () => {
    expect(tPlural("de", "activityEntriesLogged", 1, 1)).toBe("1 Eintrag protokolliert");
    expect(tPlural("de", "activityEntriesLogged", 2, 2)).toBe("2 Einträge protokolliert");
  });

  // ★ This does NOT pin dictionary choice — `enGB` is `{ ...enUS }` with no
  // overrides, so it cannot distinguish "read enUS" from "read enGB and got
  // the same string". It pins that tPlural's form-selection works for the
  // "en-GB" locale tag.
  it("selects correctly for en-GB, which renders the same strings as en-US today", () => {
    expect(tPlural("en-GB", "activityEntriesLogged", 1, 1)).toBe("1 entry logged");
  });

  // ★ The count is NOT injected as {0}. Two of the converted keys carry the
  // count in another slot, so args are forwarded verbatim and the call site
  // passes the number wherever it belongs.
  it("forwards args verbatim rather than injecting the count", () => {
    expect(tPlural("en-US", "timelogTestOk", 1, 1, "read")).toBe("Connected — 1 user, scope: read");
    expect(tPlural("en-US", "timelogTestOk", 3, 3, "read")).toBe("Connected — 3 users, scope: read");
  });
});

describe("plural key pairing", () => {
  // ★ Source scan, not a dictionary import: the assertion is about the KEY SET
  // as written, and reading it off the module would make a stranded singular
  // indistinguishable from a live one.
  // ★★ SCOPED TO THE `enUS` LITERAL, not the whole file. A bare `/^ {2}(\w+):/`
  // over `i18n.ts` also matches the two-space-indented PARAMETER NAMES in the
  // `t`/`tPlural` signatures (`lang`, `key`, `count`, `baseKey`). Harmless
  // today — none ends in `One` and none is the base of a real singular — but a
  // future `…One` key whose base collided with a parameter name would make
  // `stranded` pass falsely, which is the one thing this test is for.
  const src = readFileSync("src/app/i18n.ts", "utf8");
  const srcLines = src.split(/\r?\n/);
  const enUsStart = srcLines.findIndex((l) => l.startsWith("const enUS = {"));
  const enUsEnd = srcLines.findIndex((l, i) => i > enUsStart && l === "} as const;");
  // Non-vacuity control for the SPAN itself: a renamed declaration or a changed
  // closer would silently yield an empty slice, and every assertion below would
  // then pass over nothing.
  expect(enUsStart).toBeGreaterThanOrEqual(0);
  expect(enUsEnd).toBeGreaterThan(enUsStart + 1000);
  const keys = srcLines
    .slice(enUsStart + 1, enUsEnd)
    .flatMap((l) => {
      const m = /^ {2}([a-zA-Z0-9]+):/.exec(l);
      return m ? [m[1]] : [];
    });

  it("gives every singular key a plural sibling", () => {
    const singulars = keys.filter((k) => k.endsWith("One"));
    // Non-vacuity control: if this scan ever returns an empty set the test
    // below passes over nothing, so assert the population first. Measured
    // 42 singulars at the time this floor was raised (2026-09-07) — 30
    // leaves headroom for the population to shrink somewhat without
    // silently weakening this control back to vacuity.
    expect(singulars.length).toBeGreaterThan(30);
    const stranded = singulars.filter((k) => !keys.includes(k.slice(0, -3)));
    expect(stranded).toEqual([]);
  });

  /**
   * ★★★ THE REGISTER SAID THIS COULD NOT BE GATED, AND IT CAN. `docs/open-followups.md`
   * §415 exception D was the class where a key HAS a `…One` sibling and a call
   * site still reaches the base through a plain `t()` — the shape of BOTH live
   * defects this slice fixed. Its own text said nothing in the branch or in CI
   * detects it and the next slice should be assumed to reintroduce it. A cold
   * reviewer refuted that on 2026-09-07 by writing the scan, so here it is.
   *
   * ★★ It WOULD have caught both: at `525313da~1`, `activityEntriesLoggedOne`
   * and `timelogTestOkOne` already existed while `activity-log-panel.tsx` and
   * `timelog-settings.tsx` still called plain `t()` on the bases.
   *
   * ★★ THE ALLOWLIST IS THE WHOLE RISK, so it is asserted in BOTH directions:
   * an un-allowlisted violation fails, AND an allowlisted key that no longer
   * violates fails too. Without the second half the list silently accumulates
   * dead entries, and a dead entry is a hole — the next call site to use that
   * key is exempt for a reason that stopped being true.
   *
   * ★ Line-level, not file-level: the check drops any line that mentions
   * `tPlural`, which is what makes the variable-base call sites below pass on
   * their own line while their bare key literal is still visible to the scan.
   */
  it("routes every paired base key through tPlural, outside a documented exception", () => {
    // Each entry is a base key that legitimately reaches `t()` today.
    // ★ Keep the REASON beside the key — this list is the thing that rots.
    const EXCEPTIONS: Record<string, string> = {
      // §415 exception A — the next-actions providers are i18n-free ENGINES with
      // no `Lang` in scope, so they emit a KEY plus params for a surface to
      // render and pick the form with a `count === 1` ternary over the two key
      // names. Converting them would mean threading a language into the engines.
      actionChangeAggTitle: "next-actions provider: i18n-free engine, emits a key",
      actionCommitteeInfoWhy: "next-actions provider: i18n-free engine, emits a key",
      actionRaidWhyReviewStale: "next-actions provider: i18n-free engine, emits a key",
      actionWorkloadWhyOverload: "next-actions provider: i18n-free engine, emits a key",
      // §415 exception B — the singulars exist but nothing reads them: both keys
      // are reached through `ACTIVITY_KIND_KEY`, a Record routed to a generic
      // `t()` renderer. The activity log still says "AI planned 1 allocation
      // cells" and the entry is OPEN.
      activityAiAllocationPlan: "ACTIVITY_KIND_KEY map -> generic t() renderer (§415 B, OPEN)",
      activityAiRaciSuggest: "ACTIVITY_KIND_KEY map -> generic t() renderer (§415 B, OPEN)",
      // Variable-base call: `seg(n, base)` calls tPlural correctly one line up,
      // so only the bare key literal is visible on these lines.
      diagnosticsUnitError: "variable-base seg() helper, tPlural on the helper's own line",
      diagnosticsUnitWarn: "variable-base seg() helper, tPlural on the helper's own line",
      // Union + map: the skip reasons are a `SkipMessageKey` union rendered
      // through a lookup, same shape as the activity-log map above.
      raciSuggestSkipped: "SkipMessageKey union + map",
      raciSuggestSkippedAccountable: "SkipMessageKey union + map",
      raciSuggestSkippedInvalidRole: "SkipMessageKey union + map",
      // `confirmKey` ternary picks the base, then tPlural renders it.
      storageConvertConfirm: "confirmKey ternary, tPlural on the next line",
      storageTursoLeaveWarn: "confirmKey ternary, tPlural on the next line",
    };

    const bases = keys
      .filter((k) => k.endsWith("One"))
      .map((k) => k.slice(0, -3))
      .filter((b) => keys.includes(b));
    // Non-vacuity: the scan below is meaningless over an empty key set.
    expect(bases.length).toBeGreaterThan(30);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.tsx?$/.test(e.name) &&
          !/\.test\.tsx?$/.test(e.name) &&
          !/^i18n(\.de)?\.ts$/.test(e.name)
        ) {
          files.push(p);
        }
      }
    };
    walk("src/app");
    // Non-vacuity: a broken walk would scan nothing and pass.
    expect(files.length).toBeGreaterThan(500);

    const offenders = new Map<string, string[]>();
    for (const f of files) {
      readFileSync(f, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (line.includes("tPlural")) return;
          for (const b of bases) {
            if (line.includes(`"${b}"`)) {
              const at = `${f.split(path.sep).join("/")}:${i + 1}`;
              offenders.set(b, [...(offenders.get(b) ?? []), at]);
            }
          }
        });
    }

    const undocumented = [...offenders].filter(([b]) => !(b in EXCEPTIONS));
    expect(
      undocumented.map(([b, at]) => `${b} @ ${at.join(", ")}`),
      "a key with a singular sibling is still rendered through plain t() — " +
        "convert the call site to tPlural, or add it to EXCEPTIONS with the reason",
    ).toEqual([]);

    // ★★ The other direction: a stale exemption is a hole, not clutter.
    const stale = Object.keys(EXCEPTIONS).filter((b) => !offenders.has(b));
    expect(
      stale,
      "these keys no longer reach t() anywhere — drop them from EXCEPTIONS, " +
        "or the next call site to use one is silently exempt",
    ).toEqual([]);
  });
});
