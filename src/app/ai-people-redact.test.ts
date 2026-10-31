import { describe, expect, it } from "vitest";
import type { PeopleDictionary } from "./ai-people-dictionary";
import { redactionSessionFor, redactJsonBody, restoreJsonText } from "./ai-people-redact";

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
    expect(s.redact("ask Quillfeld")).toBe("ask [Person 1]");
    expect(s.redact("Annual review with QUILLFELD.")).toBe("Annual review with [Person 1].");
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

  it("a one-word entry that is a token of exactly one full name is that person", () => {
    const s = fresh(dict(["Mark", "Mark Quillfeld"]));
    expect(s.redact("Mark said")).toBe("[Person 1] said");
    expect(s.restore("[Person 1]")).toBe("Mark Quillfeld");
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

  it("a first name shared by two known people is not redacted alone; surnames are", () => {
    const s = fresh(dict(["Anna Brandvik", "Anna Keller"]));
    expect(s.redact("Anna asked Brandvik and Keller")).toBe("Anna asked [Person 1] and [Person 2]");
    expect(s.redact("Anna Keller and Anna Brandvik")).toBe("[Person 2] and [Person 1]");
  });

  it("diacritics, case, ue-transliteration and possessive all map to one placeholder", () => {
    const s = fresh(dict(["Hans Müller"]));
    expect(s.redact("Müller, MÜLLER, Mueller, Müller's, hans mueller")).toBe(
      "[Person 1], [Person 1], [Person 1], [Person 1]'s, [Person 1]",
    );
    expect(s.restore("[Person 1] agreed")).toBe("Hans Müller agreed");
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

  // F2d: the model may change the placeholder's case.
  it("restore matches placeholders case-insensitively", () => {
    const s = fresh(dict(["Sofia Ramirez"], ["s@example.com"]));
    s.redact("Sofia Ramirez s@example.com");
    expect(s.restore("[person 1], [PERSON 1], [Email 1]")).toBe("Sofia Ramirez, Sofia Ramirez, s@example.com");
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

  it("growth can make a token ambiguous; then it is no longer redacted alone", () => {
    const s1 = redactionSessionFor(["amb"], [dict(["Sofia Ramirez"])]);
    expect(s1.redact("Sofia")).toBe("[Person 1]");
    const s2 = redactionSessionFor(["amb"], [dict(["Sofia Ramirez", "Sofia Keller"])]);
    expect(s2.redact("Sofia")).toBe("Sofia");
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
    // Final review F1: no `data` exemption — under protection an image is refused
    // before redaction (`hasUnredactableContent`), so none is ever walked here.
    expect(out.messages[0].content[1].source.data).toBe("[Person 1]");
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

  it("opaque blobs pass untouched: signature and redacted_thinking; other data is redacted", () => {
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
    // Final review F1: the `data` exemption is gone (such blocks are refused
    // before redaction under protection), so a `data` string is redacted.
    expect(c[2].source.data).toBe("[Person 1]");
    expect(c[3].source.data).toBe("[Person 1]");
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
