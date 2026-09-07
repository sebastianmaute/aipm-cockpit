import { readFileSync } from "node:fs";
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
  const src = readFileSync("src/app/i18n.ts", "utf8");
  const keys = [...src.matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((m) => m[1]);

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
});
