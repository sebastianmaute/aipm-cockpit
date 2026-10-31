import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeopleDictionary } from "./ai-people-dictionary";
import { countUnrestoredPlaceholders, mergeBatch, redactionSessionFor, redactJsonBody, restoreJsonText } from "./ai-people-redact";

const dict = (names: string[], emails: string[] = [], phones: string[] = []): PeopleDictionary => ({ names, emails, phones });

let keySeq = 0;
/** Sessions are memoised per key list for the whole module, so each test takes fresh keys. */
const fresh = (d: PeopleDictionary) => redactionSessionFor([`test-${++keySeq}`], [d]);

describe("name matching", () => {
  // ★ Rule (controller ruling R-a): a FULL known name is always redacted. A single
  // name token (first OR last) is redacted only when it is at least 3 characters,
  // belongs to exactly ONE known person, and is not in the small stop list of
  // common words (Mark, May, Will, Ann, …). So "Mark" alone is left alone even
  // though Mark Quillfeld is known; "Quillfeld" alone is not a stop word and is redacted.
  it("full name always, unambiguous surname alone, stop-listed first name never alone", () => {
    const s = fresh(dict(["Mark Quillfeld"]));
    expect(s.redact("Mark the task done, Mark")).toBe("Mark the task done, Mark");
    expect(s.redact("Mark Quillfeld said")).toBe("[Person 1] said");
    expect(s.redact("ask Quillfeld")).toBe("ask [Person 2]");
    expect(s.redact("Annual review with QUILLFELD.")).toBe("Annual review with [Person 2].");
    // F2a: a LONE token must look like a name — capitalised or all caps.
    expect(s.redact("ask quillfeld")).toBe("ask quillfeld");
    expect(s.redact("mark quillfeld said")).toBe("[Person 1] said");
  });

  // F1: a one-word dictionary entry IS the full known name — no stop list, no
  // length floor — but it is still case-gated (F2a).
  it("a one-word known name is redacted even when short or stop-listed", () => {
    const s = fresh(dict(["Max", "Al", "Mark Quillfeld"]));
    expect(s.redact("Max owns it; Al too")).toBe("[Person 1] owns it; [Person 2] too");
    expect(s.redact("max speed, al dente")).toBe("max speed, al dente");
    expect(s.restore("[Person 2]")).toBe("Al");
  });

  // Review 3, R1: the case gate exists so a capitalised name ("Max") does not take the common word with it
  // ("max speed"). A one-word entry the dictionary itself stores in lower case ("anna", a user id like "jdoe")
  // has no capitalised form to tell apart, so it is matched in ANY case; a spelling exactly as stored is
  // therefore always redacted. A capitalised entry ("Bob") stays case-gated: "bob" is left, like "max speed".
  it("a one-word entry stored in lower case is redacted in any case; a capitalised one stays case-gated", () => {
    const s = fresh(dict(["anna", "jdoe", "Bob"]));
    expect(s.redact('{"assignee":"anna"}')).toBe('{"assignee":"[Person 1]"}');
    expect(s.redact("assignee: jdoe")).toBe("assignee: [Person 2]");
    expect(s.redact("Anna, JDOE and Jdoe")).toBe("[Person 1], [Person 2] and [Person 2]");
    expect(s.redact("Bob, BOB")).toBe("[Person 3], [Person 3]");
    expect(s.redact("bob said")).toBe("bob said");
    expect(s.restore("[Person 1] and [Person 2]")).toBe("anna and jdoe");
  });

  it("the case gate still holds for lone tokens of a multi-word name", () => {
    const s = fresh(dict(["Mark Quillfeld", "anna brandvik"]));
    expect(s.redact("Mark the task done")).toBe("Mark the task done");
    expect(s.redact("ask quillfeld, ask brandvik")).toBe("ask quillfeld, ask brandvik");
    expect(s.redact("anna brandvik said")).toBe("[Person 1] said");
  });

  // Review 3, R2: an alias entry is a lone token of that person, so it restores as itself, not as the full name.
  it("a one-word entry that is a token of exactly one full name is that person's token", () => {
    const s = fresh(dict(["Mark", "Mark Quillfeld"]));
    expect(s.redact("Mark said")).toBe("[Person 1] said");
    expect(s.redact("Mark Quillfeld said")).toBe("[Person 2] said");
    expect(s.restore("[Person 1] and [Person 2]")).toBe("Mark and Mark Quillfeld");
  });

  // Review 3, R2: a lone token used to share the full name's placeholder, so restore turned "Brandvik GmbH" into
  // "Anna Brandvik GmbH" — and a restored tool input is what gets saved. A lone token now has its OWN placeholder
  // per (person, token), restoring that token's dictionary spelling; full-name variants still share one.
  it("a lone token gets its own placeholder and restores as itself; the full name and its variants share one", () => {
    const s = fresh(dict(["Anna Brandvik", "Mark Quillfeld"]));
    expect(s.redact("Brandvik GmbH contract")).toBe("[Person 1] GmbH contract");
    expect(s.redact("Anna Brandvik said")).toBe("[Person 2] said");
    expect(s.redact("ask Quillfeld")).toBe("ask [Person 3]");
    expect(s.redact("BRANDVIK, Anna Brandvik's, anna  brandvik")).toBe("[Person 1], [Person 2]'s, [Person 2]");
    // The model echoes the placeholders; restore gives back the original text.
    expect(s.restore("[Person 1] GmbH contract")).toBe("Brandvik GmbH contract");
    expect(s.restore("[Person 2] said")).toBe("Anna Brandvik said");
    expect(s.restore("ask [Person 3]")).toBe("ask Quillfeld");
    for (const t of ["Brandvik GmbH contract", "Anna Brandvik said", "ask Quillfeld", "Quillfeld and Mark Quillfeld"]) {
      expect(s.restore(s.redact(t)), t).toBe(t);
    }
    expect(restoreJsonText(redactJsonBody(JSON.stringify({ vendor: "Brandvik GmbH" }), s), s)).toBe('{"vendor":"Brandvik GmbH"}');
  });

  // F2: common words that happen to be names, team labels and role suffixes.
  it("does not redact common words, placeholder values or role suffixes", () => {
    const s = fresh(dict(["Team Alpha", "TBD", "Anna Brandvik (CFO)", "Liam Price", "Eva Lang"]));
    expect(s.redact("The team is TBD; price list; lang dauert; (CFO) said")).toBe(
      "The team is TBD; price list; lang dauert; (CFO) said",
    );
    expect(s.redact("Anna Brandvik (CFO) and Price, with Team Alpha")).toBe("[Person 1] (CFO) and [Person 2], with [Person 3]");
    expect(s.restore("[Person 1]")).toBe("Anna Brandvik");
  });

  it("each non-person placeholder value in the dictionary is ignored", () => {
    for (const v of ["TBD", "TBC", "N/A", "NA", "None", "Unassigned", "Unknown", "N.N.", "TBA", "-", "?", "Offen", "Keine", "Niemand"]) {
      const s = fresh(dict([v, "Real Person"]));
      expect(s.redact(`owner: ${v}`), v).toBe(`owner: ${v}`);
    }
  });

  it("never touches a word that merely contains a name", () => {
    const s = fresh(dict(["Ann Webster", "Sofia Ramirez"]));
    expect(s.redact("Annual planning, Websterian prose, Sofiaville")).toBe("Annual planning, Websterian prose, Sofiaville");
    expect(s.redact("Ann said hi")).toBe("Ann said hi");
    expect(s.redact("Webster said hi")).toBe("[Person 1] said hi");
  });

  // Review 5, S1: a first name shared by two known people is redacted alone too, under ONE placeholder of its own.
  it("a first name shared by two known people is redacted alone under a shared placeholder; surnames are their own", () => {
    const s = fresh(dict(["Anna Brandvik", "Anna Keller"]));
    expect(s.redact("Anna asked Brandvik and Keller")).toBe("[Person 1] asked [Person 2] and [Person 3]");
    expect(s.redact("Anna Keller and Anna Brandvik")).toBe("[Person 4] and [Person 5]");
    expect(s.restore("[Person 1], [Person 2], [Person 3], [Person 4], [Person 5]")).toBe("Anna, Brandvik, Keller, Anna Keller, Anna Brandvik");
  });

  it("diacritics, case, ue-transliteration and possessive all map to one placeholder", () => {
    const s = fresh(dict(["Hans Müller"]));
    expect(s.redact("hans mueller, Hans Müller's, HANS MÜLLER")).toBe("[Person 1], [Person 1]'s, [Person 1]");
    expect(s.redact("Müller, MÜLLER, Mueller, Müller's")).toBe("[Person 2], [Person 2], [Person 2], [Person 2]'s");
    expect(s.restore("[Person 1] agreed with [Person 2]")).toBe("Hans Müller agreed with Müller");
  });

  it("longest match first: a full name beats its own tokens, across line breaks too", () => {
    const s = fresh(dict(["Sofia Ramirez", "Sofia Ramirez Lopez"]));
    expect(s.redact("Sofia Ramirez Lopez and Sofia\nRamirez")).toBe("[Person 1] and [Person 2]");
  });

  it("restore(redact(t)) === t when every match is a full known spelling", () => {
    const s = fresh(dict(
      ["Sofia Ramirez", "Noah Bennett", "Hans Müller", "Elena Fischer"],
      ["sofia.ramirez@example.com", "noah.bennett@example.com"],
      ["+49 30 5550101"],
    ));
    const texts = [
      "Sofia Ramirez owns the cutover.",
      "Ask Noah Bennett and Elena Fischer.",
      "Hans Müller signed on 2026-10-30.",
      "Mail sofia.ramirez@example.com today.",
      "Call +49 30 5550101 at 09:00.",
      "Budget 1.234,56 EUR approved by Elena Fischer.",
      "No people here at all.",
      "Sofia Ramirez, Noah Bennett, Hans Müller, Elena Fischer.",
      "Version 2.10.3 shipped; ticket LOP-42.",
      "noah.bennett@example.com cc sofia.ramirez@example.com",
      "Elena Fischer: approved.",
      "(Hans Müller)",
      "\"Noah Bennett\" wrote",
      "Sofia Ramirez's plan",
      "IBAN DE89 3704 0044 0532 0130 00 belongs to Hans Müller",
      "phone 030-1234567, ask Elena Fischer",
      "12 000 units, Q4",
      "Sofia Ramirez\nNoah Bennett",
      "A plain sentence with Annual and May.",
      "Elena Fischer and Elena Fischer again",
    ];
    for (const t of texts) expect(s.restore(s.redact(t)), t).toBe(t);
  });

  it("restore leaves unknown placeholders untouched", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    s.redact("Sofia Ramirez");
    expect(s.restore("[Person 99] said hi")).toBe("[Person 99] said hi");
    expect(s.restore("[email 3] and [Person 1]")).toBe("[email 3] and Sofia Ramirez");
  });

  // Review 5, S5: the caller logs the count of placeholder-shaped tokens restore could not map.
  it("counts the placeholders it cannot restore: never issued, and near-miss forms", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    s.redact("Sofia Ramirez");
    expect(countUnrestoredPlaceholders("[Person 1] and [PERSON 1]", s)).toBe(0);
    expect(countUnrestoredPlaceholders("[Person 12], [Person1], [person 12], [ phone 3 ], [IBAN 1]", s)).toBe(5);
    expect(countUnrestoredPlaceholders("[Persona 1], [Person], [Person x], plain text", s)).toBe(0);
  });

  // F2d: the model may change the placeholder's case.
  it("restore matches placeholders case-insensitively", () => {
    const s = fresh(dict(["Sofia Ramirez"], ["s@example.com"]));
    s.redact("Sofia Ramirez s@example.com");
    expect(s.restore("[person 1], [PERSON 1], [Email 1]")).toBe("Sofia Ramirez, Sofia Ramirez, s@example.com");
  });
});

// Review 5, S1: a name part several known people share used to be sent in clear, though the consent text promises the
// AI sees no known person's name. It now gets ONE placeholder keyed by the token alone, restoring that token's spelling.
describe("a name part shared by several known people (review 5, S1)", () => {
  const people = ["Ilse Mürwald", "Tobin Mürwald", "Corvin Ashgrove", "Corvin Pellatt"];

  it("a shared surname and a shared first name are redacted alone and round-trip byte-exact", () => {
    const s = fresh(dict(people));
    const surname = "Ask Mürwald about the budget";
    expect(s.redact(surname)).toBe("Ask [Person 1] about the budget");
    expect(s.restore(s.redact(surname))).toBe(surname);
    const first = "Corvin will deliver the report";
    expect(s.redact(first)).toBe("[Person 2] will deliver the report");
    expect(s.restore(s.redact(first))).toBe(first);
  });

  it("the shared placeholder covers the token's variants and never stands for a full name", () => {
    const s = fresh(dict(people));
    expect(s.redact("Mürwald, MUERWALD, Mürwalds")).toBe("[Person 1], [Person 1], [Person 1]s");
    expect(s.redact("Ilse Mürwald and Tobin Mürwald")).toBe("[Person 2] and [Person 3]");
    expect(s.restore("[Person 1] / [Person 2] / [Person 3]")).toBe("Mürwald / Ilse Mürwald / Tobin Mürwald");
  });

  it("the case gate, the minimum length and the stop list still hold for a shared token", () => {
    const s = fresh(dict([...people, "Mark Quillfeld", "Mark Ostrander", "Al Brix", "Al Venn"]));
    expect(s.redact("ask mürwald; corvin too")).toBe("ask mürwald; corvin too");
    expect(s.redact("Mark the task done")).toBe("Mark the task done");
    expect(s.redact("Al said so")).toBe("Al said so");
  });
});

// Review 4, M1: RAG colours, month names and "Rich" are app vocabulary. As a lone token they stay; the full name goes.
describe("app vocabulary is never a lone token (review 4, M1)", () => {
  const vocab = () => fresh(dict(["Amber Lee", "Tom Green", "Jan Koch", "Rich Turner", "Ruth Rot", "Mai Gelb", "Okt Grün"]));

  it("RAG status words, EN and DE", () => {
    const s = vocab();
    expect(s.redact("RAG status: Amber (was Green), now Red")).toBe("RAG status: Amber (was Green), now Red");
    expect(s.redact("Ampel: Rot, Gelb, Grün")).toBe("Ampel: Rot, Gelb, Grün");
  });

  it("month names and abbreviations, EN and DE", () => {
    const s = fresh(dict(["Jan Koch", "Mär Okt", "Sept Dez", "March Smith", "Juli Quillfeld"]));
    expect(s.redact("Planned for Jan 2026, Sept and March; Juli, Mär, Okt, Dez")).toBe("Planned for Jan 2026, Sept and March; Juli, Mär, Okt, Dez");
  });

  it("'Rich' as in rich text", () => {
    const s = vocab();
    expect(s.redact("Rich text fields are HTML.")).toBe("Rich text fields are HTML.");
  });

  it("the full names are still redacted", () => {
    const s = vocab();
    expect(s.redact("Jan Koch, Amber Lee, Rich Turner and Tom Green")).toBe("[Person 1], [Person 2], [Person 3] and [Person 4]");
    expect(s.redact("ask Koch")).toBe("ask [Person 5]");
  });
});

// Review 4, I1: three spellings of a known name that the matcher missed.
describe("matching gaps (review 4, I1)", () => {
  const NFD_UE = "ü";
  const names = () => fresh(dict(["Anna Müller", "Sean O’Brien"]));

  it("a German genitive -s: the name is redacted, the s stays in the text", () => {
    const s = names();
    const t = "Anna Müllers Aufgabe; Müllers Team";
    expect(s.redact(t)).toBe("[Person 1]s Aufgabe; [Person 2]s Team");
    expect(s.restore(s.redact(t))).toBe(t);
  });

  it("the genitive look-ahead still refuses a longer word", () => {
    const s = names();
    expect(s.redact("Müllerstraße, Müllersen")).toBe("Müllerstraße, Müllersen");
  });

  it("NFD text (u + combining diaeresis) matches a name the dictionary stores in NFC", () => {
    const s = names();
    const t = `Anna M${NFD_UE}ller called, M${NFD_UE}ller too`;
    expect(s.redact(t)).toBe("[Person 1] called, [Person 2] too");
    // The placeholder restores the dictionary spelling (NFC), canonically equal to the input.
    expect(s.restore(s.redact(t)).normalize("NFC")).toBe(t.normalize("NFC"));
  });

  it("NFD round-trips byte-exact when the dictionary stores the NFD spelling; NFD text elsewhere is untouched", () => {
    const s = fresh(dict([`Anna M${NFD_UE}ller`]));
    const t = `Gr${NFD_UE}ße: Anna M${NFD_UE}ller and Anna Müller`;
    expect(s.redact(t)).toBe(`Gr${NFD_UE}ße: [Person 1] and [Person 1]`);
    const exact = `x Anna M${NFD_UE}ller y, Gr${NFD_UE}ße`;
    expect(s.restore(s.redact(exact))).toBe(exact);
  });

  it("a combining mark after a name's last letter is not a match boundary", () => {
    const s = fresh(dict(["Anna"]));
    // "Annä" in NFD is not "Anna": the match must not end before the mark and strand it.
    expect(s.redact("Annä said")).toBe("Annä said");
  });

  it("a straight apostrophe matches a name stored with a curly one, and vice versa", () => {
    const s = names();
    expect(s.redact("Sean O'Brien said")).toBe("[Person 1] said");
    expect(s.redact("Sean O‘Brien and Sean OʼBrien")).toBe("[Person 1] and [Person 1]");
    // The placeholder restores the dictionary spelling.
    expect(s.restore("[Person 1]")).toBe("Sean O’Brien");
    const straight = fresh(dict(["Sean O'Brien"]));
    expect(straight.redact("Sean O’Brien said")).toBe("[Person 1] said");
  });

  it("a curly-apostrophe name round-trips byte-exact", () => {
    const s = names();
    const t = "Sean O’Brien said, O’Brien agreed";
    expect(s.redact(t)).toBe("[Person 1] said, [Person 2] agreed");
    expect(s.restore(s.redact(t))).toBe(t);
  });

  it("a match never ends inside a folded expansion (ß -> ss)", () => {
    const s = fresh(dict(["Hans"]));
    // "Hanß" folds to "hanss"; the genitive look-ahead must not take "hans" + "s" out of one ß.
    expect(s.redact("Hanß kam")).toBe("Hanß kam");
  });
});

describe("pattern kinds (redacted even when not in the dictionary)", () => {
  it("emails, phones and IBANs get their own placeholders and counts", () => {
    const s = fresh(dict([]));
    const out = s.redact(
      "Write to jane.doe@corp.example or j@x.io; call +4930123456, +49 30 1234567 or 030-1234567; " +
        "pay DE89 3704 0044 0532 0130 00 or DE89370400440532013000.",
    );
    expect(out).toBe(
      // The same IBAN with and without spaces is ONE value, so one placeholder.
      "Write to [email 1] or [email 2]; call [phone 1], [phone 2] or [phone 3]; pay [IBAN 1] or [IBAN 1].",
    );
    expect(s.counts()).toEqual({ person: 0, email: 2, phone: 3, iban: 2 });
  });

  it("the same value reuses its placeholder; restore returns the spelling seen", () => {
    const s = fresh(dict(["Sofia Ramirez"], ["Sofia.Ramirez@example.com"]));
    expect(s.redact("sofia.ramirez@example.com, Sofia Ramirez, Sofia.Ramirez@example.com")).toBe(
      "[email 1], [Person 1], [email 1]",
    );
    expect(s.restore("[email 1]")).toBe("Sofia.Ramirez@example.com");
    expect(s.counts()).toEqual({ person: 1, email: 2, phone: 0, iban: 0 });
  });

  it("a known phone is matched by its digits even without a leading + or 0", () => {
    const s = fresh(dict([], [], ["555 0101"]));
    expect(s.redact("extension 5550101 or 555-0101")).toBe("extension [phone 1] or [phone 1]");
  });

  // ★ Rule (controller ruling R-b): an UNKNOWN phone needs a leading "+" or "0",
  // at least 7 digits, and only space - . ( ) / as separators.
  it("phone-shaped: these ARE phones", () => {
    for (const p of ["+49 30 1234567", "030-1234567", "+14155552671", "0049 30 1234567", "(030) 123 4567", "0171/1234567"]) {
      const s = fresh(dict([]));
      expect(s.redact(`call ${p} now`), p).toBe("call [phone 1] now");
    }
  });

  it("dates, times, integers, money, versions and ids are NOT phones", () => {
    for (const t of [
      "2026-10-30", "2026-01-05T09:00:00Z", "05.10.2026", "01/02/2026", "09:00-17:30", "1234567", "12345678",
      "1.234,56", "12 000", "0,99", "v10.0.1", "2.10.3", "LOP-0123456", "id 000123456", "+5%", "0.5 days",
      "05.10.2026 10:00",
    ]) {
      const s = fresh(dict([]));
      expect(s.redact(t), t).toBe(t);
    }
  });

  it("an IBAN-shaped string with a bad checksum is left alone, phone pattern included", () => {
    const s = fresh(dict([]));
    expect(s.redact("DE00 3704 0044 0532 0130 00")).toBe("DE00 3704 0044 0532 0130 00");
  });
});

describe("redactionSessionFor", () => {
  it("the same key list returns the same numbering; another key list numbers afresh", () => {
    const d1 = dict(["Sofia Ramirez", "Noah Bennett"]);
    const a = redactionSessionFor(["p-a", "p-b"], [d1]);
    expect(a.redact("Noah Bennett")).toBe("[Person 1]");
    const b = redactionSessionFor(["p-b", "p-a"], [d1]);
    expect(b.redact("Sofia Ramirez and Noah Bennett")).toBe("[Person 2] and [Person 1]");
    const c = redactionSessionFor(["p-c"], [d1]);
    expect(c.redact("Sofia Ramirez")).toBe("[Person 1]");
  });

  it("placeholders stay stable as the dictionary grows; dictionaries are unioned", () => {
    const first = redactionSessionFor(["grow"], [dict(["Sofia Ramirez"])]);
    expect(first.redact("Sofia Ramirez")).toBe("[Person 1]");
    const grown = redactionSessionFor(["grow"], [dict(["Noah Bennett"]), dict(["Sofia Ramirez", "Elena Fischer"])]);
    expect(grown.redact("Elena Fischer, Sofia Ramirez, Noah Bennett")).toBe("[Person 2], [Person 1], [Person 3]");
  });

  // Review 5, S1: a token that growth makes shared moves to the shared placeholder; the one already issued still restores.
  it("growth can make a token shared; it is still redacted alone, under the shared placeholder", () => {
    const s1 = redactionSessionFor(["amb"], [dict(["Sofia Ramirez"])]);
    expect(s1.redact("Sofia")).toBe("[Person 1]");
    const s2 = redactionSessionFor(["amb"], [dict(["Sofia Ramirez", "Sofia Keller"])]);
    expect(s2.redact("Sofia")).toBe("[Person 2]");
    expect(s2.restore("[Person 1] / [Person 2]")).toBe("Sofia / Sofia");
  });

  // Review 2, E: a placeholder the user typed themselves, which this session never issued, is not a name.
  it("a literal placeholder the session never issued stays literal; an issued one maps to this session's name only", () => {
    const a = fresh(dict(["Sofia Ramirez"]));
    const b = fresh(dict(["Noah Bennett", "Elena Fischer", "Liam Keller"]));
    expect(b.redact("Noah Bennett, Elena Fischer, Liam Keller")).toBe("[Person 1], [Person 2], [Person 3]");
    const sent = a.redact("Sofia Ramirez wrote [Person 3] in the ticket.");
    expect(sent).toBe("[Person 1] wrote [Person 3] in the ticket.");
    // Session b has issued [Person 3], session a has not: a leaves it as typed.
    expect(a.restore(sent)).toBe("Sofia Ramirez wrote [Person 3] in the ticket.");
    expect(a.restore("[Person 1]")).toBe("Sofia Ramirez");
    expect(b.restore("[Person 1] and [Person 3]")).toBe("Noah Bennett and Liam Keller");
  });
});

// Review 5, S4: the history is re-redacted on every tool-loop step, so a session caches each string's redaction.
describe("the per-session redaction cache (review 5, S4)", () => {
  afterEach(() => vi.restoreAllMocks());
  const people = dict(["Sofia Ramirez", "Noah Bennett"], ["s@example.com"], ["+49 30 5550101"]);
  const text = "Sofia Ramirez asked Bennett (s@example.com, +49 30 5550101) and Noah Bennett; call 0170 1234567.";

  it("a cached redaction equals a fresh one, and counts it again", () => {
    const s = fresh(people);
    const first = s.redact(text);
    const afterFirst = s.counts();
    expect(s.redact(text)).toBe(first);
    const afterSecond = s.counts();
    expect(afterFirst).toEqual({ person: 3, email: 1, phone: 2, iban: 0 });
    expect(afterSecond).toEqual({ person: 6, email: 2, phone: 4, iban: 0 });
    expect(fresh(people).redact(text)).toBe(first);
  });

  it("an unchanged string is not matched again (operation count, not wall time)", () => {
    const s = fresh(people);
    const long = text.repeat(50);
    s.redact(long);
    const matchAll = vi.spyOn(RegExp.prototype, Symbol.matchAll);
    s.redact(long);
    expect(matchAll).not.toHaveBeenCalled();
    s.redact(`${long} more`);
    expect(matchAll).toHaveBeenCalled();
  });

  it("a dictionary change invalidates the cache", () => {
    const first = redactionSessionFor(["s4-grow"], [dict(["Sofia Ramirez"])]);
    expect(first.redact("Noah said so")).toBe("Noah said so");
    const grown = redactionSessionFor(["s4-grow"], [dict(["Sofia Ramirez", "Noah Bennett"])]);
    expect(grown.redact("Noah said so")).toBe("[Person 1] said so");
  });
});

describe("redactJsonBody / restoreJsonText", () => {
  it("redacts string values, never keys, model, role, type, tool names or ids", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    const body = JSON.stringify({
      model: "Sofia Ramirez",
      system: "Team: Sofia Ramirez",
      tools: [{ name: "Sofia Ramirez", description: "about Sofia Ramirez", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: [
          { type: "text", text: "Ask Sofia Ramirez" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "Sofia Ramirez" } },
        ] },
        { role: "assistant", content: [{ type: "tool_use", id: "Sofia Ramirez", name: "Sofia Ramirez", input: { name: "Sofia Ramirez" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "Sofia Ramirez", content: "owner Sofia Ramirez" }] },
      ],
      "Sofia Ramirez": 1,
      max_tokens: 100,
    });
    const out = JSON.parse(redactJsonBody(body, s));
    expect(out.model).toBe("Sofia Ramirez");
    expect(out.system).toBe("Team: [Person 1]");
    expect(out.tools[0].name).toBe("Sofia Ramirez");
    // F2c: tool definitions are app-authored; they are passed through untouched.
    expect(out.tools[0].description).toBe("about Sofia Ramirez");
    expect(out.messages[0].content[0].text).toBe("Ask [Person 1]");
    // Review 3, R3: a base64 source's `data` is opaque bytes and passes untouched. A refusing protection never
    // walks one (`hasUnredactableContent`); the unforced create-project wizard sends images and PDFs through a
    // pattern-only session, and a pattern matched inside base64 would corrupt the file.
    expect(out.messages[0].content[1].source.data).toBe("Sofia Ramirez");
    expect(out.messages[0].content[1].source.media_type).toBe("image/png");
    expect(out.messages[1].content[0].id).toBe("Sofia Ramirez");
    expect(out.messages[1].content[0].name).toBe("Sofia Ramirez");
    // A tool INPUT's `name` is data the model wrote — it is redacted.
    expect(out.messages[1].content[0].input.name).toBe("[Person 1]");
    expect(out.messages[2].content[0].tool_use_id).toBe("Sofia Ramirez");
    expect(out.messages[2].content[0].content).toBe("owner [Person 1]");
    expect(out["Sofia Ramirez"]).toBe(1);
    expect(out.max_tokens).toBe(100);
  });

  it("opaque blobs pass untouched: signature, redacted_thinking and base64 data; other data is redacted", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    const body = JSON.stringify({ messages: [{ role: "assistant", content: [
      { type: "thinking", thinking: "Sofia Ramirez", signature: "Sofia Ramirez" },
      { type: "redacted_thinking", data: "Sofia Ramirez", note: "Sofia Ramirez" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "Sofia Ramirez" } },
      { type: "image", source: { type: "url", url: "https://x.example/a.png", data: "Sofia Ramirez" } },
    ] }] });
    const c = JSON.parse(redactJsonBody(body, s)).messages[0].content;
    expect(c[0]).toEqual({ type: "thinking", thinking: "[Person 1]", signature: "Sofia Ramirez" });
    expect(c[1]).toEqual({ type: "redacted_thinking", data: "Sofia Ramirez", note: "Sofia Ramirez" });
    // Review 3, R3: base64 bytes are opaque (see above); any other `data` string is redacted.
    expect(c[2].source.data).toBe("Sofia Ramirez");
    expect(c[3].source.data).toBe("[Person 1]");
  });

  // Review 3, R7: `restoreJsonText` works on the reply's raw text, so it restores a placeholder in an object KEY
  // too. A tool input the model keyed by a person (no schema does today) would come back with the real name as a
  // key, ride in the history, and leave unredacted on the next send if only values were redacted. So keys inside
  // a tool `input` are redacted as well; every other key is protocol or app-authored and stays.
  it("keys inside a tool input are redacted and restored; keys elsewhere stay", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    const body = JSON.stringify({
      messages: [{ role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "x", input: { raci: { "Sofia Ramirez": "R" }, note: "Sofia Ramirez" } },
      ] }],
      metadata: { "Sofia Ramirez": "Sofia Ramirez" },
    });
    const out = JSON.parse(redactJsonBody(body, s));
    expect(out.messages[0].content[0].input).toEqual({ raci: { "[Person 1]": "R" }, note: "[Person 1]" });
    expect(out.metadata).toEqual({ "Sofia Ramirez": "[Person 1]" });
    const reply = JSON.stringify({ content: [{ type: "tool_use", id: "t2", name: "x", input: { raci: { "[Person 1]": "A" } } }] });
    expect(JSON.parse(restoreJsonText(reply, s)).content[0].input).toEqual({ raci: { "Sofia Ramirez": "A" } });
  });

  // Deviation from F2c's "any data field", flagged in the report: a plain-text
  // document source carries readable attachment text, not an opaque blob.
  it("a plain-text document source's data IS redacted", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    const body = JSON.stringify({ messages: [{ role: "user", content: [
      { type: "document", source: { type: "text", media_type: "text/plain", data: "Sofia Ramirez" } },
    ] }] });
    expect(JSON.parse(redactJsonBody(body, s)).messages[0].content[0].source.data).toBe("[Person 1]");
  });

  // Final review F1: protocol-key and `data` exemptions stop at a tool INPUT —
  // every string the model wrote there is data, whatever its key.
  it("inside a tool_use input every string is redacted, protocol-named keys included", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    const body = JSON.stringify({ messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "update_task", input: {
        data: "Sofia Ramirez", role: "Sofia Ramirez", type: "Sofia Ramirez", id: "Sofia Ramirez",
        model: "Sofia Ramirez", media_type: "Sofia Ramirez", signature: "Sofia Ramirez",
        nested: { type: "redacted_thinking", data: "Sofia Ramirez", role: "Sofia Ramirez" },
      } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "owner Sofia Ramirez" }] },
    ] });
    const out = JSON.parse(redactJsonBody(body, s));
    const block = out.messages[0].content[0];
    expect(block.type).toBe("tool_use");
    expect(block.id).toBe("toolu_1");
    expect(block.name).toBe("update_task");
    expect(block.input).toEqual({
      data: "[Person 1]", role: "[Person 1]", type: "[Person 1]", id: "[Person 1]",
      model: "[Person 1]", media_type: "[Person 1]", signature: "[Person 1]",
      // Not passed whole as an opaque block: its data is redacted inside an input.
      nested: { type: "redacted_thinking", data: "[Person 1]", role: "[Person 1]" },
    });
    expect(out.messages[0].role).toBe("assistant");
    expect(out.messages[1].content[0].tool_use_id).toBe("toolu_1");
    expect(out.messages[1].content[0].content).toBe("owner [Person 1]");
  });

  it("a body that is not JSON is redacted as plain text (never sent raw)", () => {
    const s = fresh(dict(["Sofia Ramirez"]));
    expect(redactJsonBody("not json Sofia Ramirez", s)).toBe("not json [Person 1]");
  });

  it("restores placeholders inside JSON text with JSON escaping, unknown ones untouched", () => {
    const s = fresh(dict(['Liam O"Neil\\Jr']));
    s.redact('Liam O"Neil\\Jr');
    const text = JSON.stringify({ content: [{ type: "text", text: "Hi [Person 1] and [Person 7]" }] });
    const restored = JSON.parse(restoreJsonText(text, s));
    expect(restored.content[0].text).toBe('Hi Liam O"Neil\\Jr and [Person 7]');
  });
});

// Follow-up m1: `mergeBatch` replaced a per-candidate check against every accepted span (review 5, S4). A span that only
// TOUCHES an accepted one must still be kept, or a name written straight against a phone number stays in clear.
describe("mergeBatch agrees with the per-candidate overlap check it replaced (follow-up m1)", () => {
  type Span = Parameters<typeof mergeBatch>[1][number];

  /** The pre-S4 algorithm, kept as the reference: add a span when it overlaps no span added so far. */
  function reference(batches: readonly (readonly Span[])[]): Span[] {
    const spans: Span[] = [];
    const free = (start: number, end: number) => spans.every((s) => end <= s.start || start >= s.end);
    for (const batch of batches) for (const span of batch) if (span.end > span.start && free(span.start, span.end)) spans.push(span);
    return spans.sort((a, b) => a.start - b.start);
  }

  /** mulberry32: a plain seeded PRNG, so every run checks the same cases. */
  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** One pattern's matches: sorted and disjoint, as `matchAll` yields them, but free to touch (gap 0) or be empty. */
  function batchOf(rand: () => number, id: number): Span[] {
    const out: Span[] = [];
    let at = Math.floor(rand() * 4);
    const count = Math.floor(rand() * 5);
    for (let k = 0; k < count && at < 24; k++) {
      const len = rand() < 0.1 ? 0 : 1 + Math.floor(rand() * 5);
      out.push({ start: at, end: at + len, kind: "person", key: `${id}.${k}`, spelling: "" });
      at += len + Math.floor(rand() * 3); // a gap of 0 makes the next span touch this one
    }
    return out;
  }

  const ids = (spans: readonly Span[]) => spans.map((s) => s.key);

  it("on 5000 seeded batch lists (touching, nested, identical, adjacent and empty spans)", () => {
    const rand = prng(20261031);
    for (let run = 0; run < 5000; run++) {
      const batches = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, b) => batchOf(rand, run * 10 + b));
      const merged = batches.reduce<readonly Span[]>((acc, batch) => mergeBatch(acc, batch), []);
      expect(ids(merged), JSON.stringify(batches.map((b) => b.map((s) => [s.start, s.end])))).toEqual(ids(reference(batches)));
    }
  });

  it("explicit cases: a span touching an accepted one on either side is kept; nested and identical ones are not", () => {
    const span = (start: number, end: number, key: string): Span => ({ start, end, kind: "phone", key, spelling: "" });
    const accepted = [span(5, 10, "a")];
    expect(ids(mergeBatch(accepted, [span(0, 5, "before"), span(10, 14, "after")]))).toEqual(["before", "a", "after"]);
    expect(ids(mergeBatch(accepted, [span(5, 10, "same")]))).toEqual(["a"]);
    expect(ids(mergeBatch(accepted, [span(6, 8, "inside")]))).toEqual(["a"]);
    expect(ids(mergeBatch(accepted, [span(2, 6, "left"), span(9, 12, "right")]))).toEqual(["a"]);
  });

  it("a name written straight against a phone number or an email, with no gap, is still redacted", () => {
    const s = fresh(dict(["Sofia Ramirez"], ["s@example.com"], ["+49 30 5550101"]));
    expect(s.redact("Sofia Ramirez+49 30 5550101")).toBe("[Person 1][phone 1]");
    expect(s.redact("+4930123456/Sofia Ramirez")).toBe("[phone 2]/[Person 1]");
    expect(s.redact("s@example.com/Sofia Ramirez")).toBe("[email 1]/[Person 1]");
  });
});
