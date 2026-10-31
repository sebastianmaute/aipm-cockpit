import { describe, expect, it } from "vitest";
import type { PeopleDictionary } from "./ai-people-dictionary";
import { createRedactionSession, redactionSessionFor, redactJsonBody, restoreJsonText } from "./ai-people-redact";

const dict = (names: string[], emails: string[] = [], phones: string[] = []): PeopleDictionary => ({ names, emails, phones });

let keySeq = 0;
/** Sessions are memoised per key list for the whole module, so each test takes fresh keys. */
const fresh = (d: PeopleDictionary) => redactionSessionFor([`echo-test-${++keySeq}`], [d]);

// Follow-up m5 (owner ruling 2026-10-31): one placeholder per person, so the model's view is unchanged; where the
// reply carries a placeholder at a spot where the request had it, that spot gets the spelling the user wrote back;
// new text the AI writes gets the stored spelling.
describe("an echoed spot keeps the spelling the user wrote (follow-up m5)", () => {
  const people = () => fresh(dict(["Ilse Mürwald", "Hans Müller", "Anna Brandvik"]));
  const said = "MUERWALD said the budget is late";

  it("a whole echoed value comes back exactly as written, in plain text and in JSON", () => {
    const s = people();
    expect(s.redact(said)).toBe("[Person 1] said the budget is late");
    expect(s.restore("[Person 1] said the budget is late")).toBe(said);
    const body = redactJsonBody(JSON.stringify({ type: "tool_use", input: { description: said } }), s);
    expect(JSON.parse(restoreJsonText(body, s)).input.description).toBe(said);
  });

  it("an echo inside a longer AI sentence restores the original spelling at that spot", () => {
    const s = people();
    s.redact(said);
    expect(s.restore("Noted: [Person 1] said the budget is late, so I moved the date.")).toBe(
      "Noted: MUERWALD said the budget is late, so I moved the date.",
    );
    const reply = JSON.stringify({ content: [{ type: "tool_use", input: { notes: "Quote: [Person 1] said the budget is late." } }] });
    expect(JSON.parse(restoreJsonText(reply, s)).content[0].input.notes).toBe("Quote: MUERWALD said the budget is late.");
  });

  it("fresh text using the placeholder gets the stored spelling; so does a bare placeholder value", () => {
    const s = people();
    s.redact(said);
    expect(s.restore("Ask [Person 1] to confirm the new date.")).toBe("Ask Mürwald to confirm the new date.");
    s.redact("MUERWALD");
    expect(s.restore("[Person 1]")).toBe("Mürwald");
    expect(JSON.parse(restoreJsonText(JSON.stringify({ assignee: "[Person 1]" }), s)).assignee).toBe("Mürwald");
  });

  it("two spellings of one person in one input each come back in their own spelling", () => {
    const s = people();
    const t = "Mueller wrote the plan; MÜLLER signed it off.";
    expect(s.redact(t)).toBe("[Person 1] wrote the plan; [Person 1] signed it off.");
    expect(s.restore(s.redact(t))).toBe(t);
    expect(s.restore("As agreed, [Person 1] wrote the plan; [Person 1] signed it off yesterday.")).toBe(
      "As agreed, Mueller wrote the plan; MÜLLER signed it off yesterday.",
    );
  });

  it("the canonical spelling stays byte-exact, and a spot never takes another person's name", () => {
    const s = people();
    expect(s.redact("Hans Müller approved the budget today")).toBe("[Person 1] approved the budget today");
    expect(s.redact("Anna Brandvik is out")).toBe("[Person 2] is out");
    expect(s.redact("MUERWALD approved the budget today")).toBe("[Person 3] approved the budget today");
    expect(s.restore("Yes: [Person 1] approved the budget today.")).toBe("Yes: Hans Müller approved the budget today.");
    // The context matches records of [Person 1] and [Person 3], never of [Person 2]: Anna Brandvik keeps her name.
    expect(s.restore("Yes: [Person 2] approved the budget today.")).toBe("Yes: Anna Brandvik approved the budget today.");
    expect(s.restore("Yes: [Person 3] approved the budget today.")).toBe("Yes: MUERWALD approved the budget today.");
    // One other person's record in that context, and nothing else: still never borrowed.
    const t = people();
    t.redact("MUERWALD approved the budget today");
    expect(t.redact("Anna Brandvik is out")).toBe("[Person 2] is out");
    expect(t.restore("[Person 2] approved the budget today")).toBe("Anna Brandvik approved the budget today");
  });

  it("two spellings in the same context: neither is guessed, the stored spelling is used", () => {
    const s = people();
    s.redact("Mueller approved the budget today");
    s.redact("MÜLLER approved the budget today");
    expect(s.restore("So [Person 1] approved the budget today.")).toBe("So Müller approved the budget today.");
    expect(s.restore("[Person 1] approved the budget today")).toBe("Müller approved the budget today");
  });

  it("the records go with the cache: on a dictionary change and on eviction", () => {
    const grown = redactionSessionFor(["m5-grow"], [dict(["Ilse Mürwald"])]);
    grown.redact(said);
    expect(grown.restore("Noted: [Person 1] said the budget is late")).toBe("Noted: MUERWALD said the budget is late");
    redactionSessionFor(["m5-grow"], [dict(["Ilse Mürwald", "Noah Bennett"])]);
    expect(grown.restore("Noted: [Person 1] said the budget is late")).toBe("Noted: Mürwald said the budget is late");

    const small = createRedactionSession([dict(["Ilse Mürwald"])], { entries: 1, chars: 1_000_000 });
    small.redact(said);
    small.redact("another string");
    expect(small.restore("Noted: [Person 1] said the budget is late")).toBe("Noted: Mürwald said the budget is late");
  });

  // The transport reads a streamed reply whole and restores it once. Each SSE event's JSON string is restored on its
  // own, so a spot keeps the user's spelling only when its context arrives in the same delta as the placeholder;
  // otherwise it gets the stored spelling, which is what every spot got before m5.
  it("SSE: a delta carrying enough context keeps the spelling; a short delta gets the stored one", () => {
    const s = people();
    s.redact(said);
    const event = (text: string) =>
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`;
    const restored = restoreJsonText(event("[Person 1] said the budget is late") + event("[Person 1]") + event(" said the budget is late"), s);
    const texts = restored.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)).delta.text);
    expect(texts).toEqual(["MUERWALD said the budget is late", "Mürwald", " said the budget is late"]);
  });
});
