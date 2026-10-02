import { describe, expect, it } from "vitest";
import { en } from "./i18n";
import { de } from "./i18n.de";

// ---------------------------------------------------------------------------
// The VALUE-axis detector for §450's class: a count written both ways at once.
// ---------------------------------------------------------------------------
//
// `task(s)` / `Aufgabe(n)` dodges plural agreement instead of selecting a form,
// and every other plural gate here works on KEY NAMES (a `…One` sibling), so a
// key that never got one is outside their domain by construction. This reads
// the dictionary VALUES instead.
//
// ★★ ZERO, AND IT STAYS ZERO. This began as a ratchet (64 EN / 55 DE on
//   2026-10-02) and §450 converted every escape the same day: sentence keys
//   became `…One` pairs rendered through `tPlural`, two-count sentences take
//   one plural FRAGMENT per noun, the interval unit labels take the interval
//   as their count, dead keys were deleted and two count-free prompts were
//   reworded. A failure here names the key: author its singular instead.
// ★ The shapes matched are the parenthetical suffixes after a letter: `(s)`,
//   `(e)`, `(n)`, `(en)`, `(er)`, `(es)`. The SLASH shape (`Vorgang/Vorgänge`)
//   is NOT counted — a slash also separates real alternatives ("Ja/Nein"), so
//   no regex tells the two apart. §450 lists the known slash keys by name.
// ★ The DICTIONARY OBJECTS are read, not the source text, so a value wrapped
//   onto the next line in the file cannot hide from it (the single-line grep's
//   undercount §450 records).

const ESCAPE = /[A-Za-zäöüÄÖÜß]\((?:s|e|n|en|er|es)\)/;

function escapedKeys(dict: Record<string, string>): string[] {
  return Object.entries(dict).filter(([, v]) => ESCAPE.test(v)).map(([k]) => k).sort();
}

describe("plural escapes in dictionary values (§450)", () => {
  it("matches the escape shapes and nothing else", () => {
    for (const v of ["1 task(s)", "Aufgabe(n)", "Konflikt(e)", "Feld(er)", "Aktion(en)"]) expect(ESCAPE.test(v), v).toBe(true);
    for (const v of ["(s)ome", "see (e)", "Version (1)", "Vorgang/Vorgänge"]) expect(ESCAPE.test(v), v).toBe(false);
  });

  it("has none in EN", () => {
    expect(escapedKeys(en), "an escape-shaped plural — author a …One singular instead").toEqual([]);
  });

  it("has none in DE", () => {
    expect(escapedKeys(de), "an escape-shaped plural — author a …One singular instead").toEqual([]);
  });
});
