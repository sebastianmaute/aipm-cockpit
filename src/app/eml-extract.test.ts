import { describe, it, expect } from "vitest";
import { parseMimeMessage } from "./mime-parse";
import { emlToParsedMail, MAX_ADDRESSES_PER_LIST, MAX_ATTACHMENTS } from "./eml-extract";

const msg = (lines: string[]) => lines.join("\r\n");

describe("emlToParsedMail", () => {
  it("lifts headers into the normalised shape", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      "From: a@example.com", "To: b@example.com, c@example.com", "Cc: d@example.com",
      "Subject: Q3 plan", "Date: Wed, 03 Sep 2026 10:00:00 +0000", "", "hi", "",
    ])));
    expect(p.headers.from).toBe("a@example.com");
    expect(p.headers.to).toEqual(["b@example.com", "c@example.com"]);
    expect(p.headers.cc).toEqual(["d@example.com"]);
    expect(p.headers.subject).toBe("Q3 plan");
    expect(p.headers.date).toMatch(/^2026-09-03T/);
  });

  it("prefers the html body and marks its kind", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      'Content-Type: multipart/alternative; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "plain version",
      "--B", "Content-Type: text/html", "", "<p>html version</p>",
      "--B--", "",
    ])));
    expect(p.body.kind).toBe("html");
    expect(p.body.content).toContain("html version");
  });

  it("falls back to the plain body when there is no html part", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      "Content-Type: text/plain", "", "just plain", "",
    ])));
    expect(p.body.kind).toBe("text");
    expect(p.body.content).toContain("just plain");
  });

  it("collects attachments with bytes, name and mime type", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "body",
      "--B", 'Content-Type: text/csv; name="rows.csv"',
      'Content-Disposition: attachment; filename="rows.csv"',
      "Content-Transfer-Encoding: base64", "", "YSxi",
      "--B--", "",
    ])));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].fileName).toBe("rows.csv");
    expect(p.attachments[0].mimeType).toBe("text/csv");
    expect(new TextDecoder().decode(p.attachments[0].bytes)).toBe("a,b");
  });

  it("leaves the date empty rather than inventing one when unparseable", () => {
    const p = emlToParsedMail(parseMimeMessage(msg(["Date: not a date", "", "b", ""])));
    expect(p.headers.date).toBe("");
  });

  it("carries a message/rfc822 part as an attachment named by its type", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "body",
      "--B", "Content-Type: message/rfc822", "",
      "From: nested@example.com", "Subject: inner", "", "inner body",
      "--B--", "",
    ])));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].fileName).toBe("attached-message.eml");
    expect(p.attachments[0].mimeType).toBe("message/rfc822");
  });

  it("truncates a To header past the address cap and records a diagnostic", () => {
    const many = Array.from({ length: MAX_ADDRESSES_PER_LIST + 20 }, (_, i) => `a${i}@example.com`).join(", ");
    const p = emlToParsedMail(parseMimeMessage(msg([`To: ${many}`, "", "b", ""])));
    expect(p.headers.to).toHaveLength(MAX_ADDRESSES_PER_LIST);
    expect(p.diagnostics.some((d) => d.includes("To") && d.includes("truncated"))).toBe(true);
  });

  it("keeps an address list at exactly the cap without a diagnostic", () => {
    const exact = Array.from({ length: MAX_ADDRESSES_PER_LIST }, (_, i) => `a${i}@example.com`).join(", ");
    const p = emlToParsedMail(parseMimeMessage(msg([`To: ${exact}`, "", "b", ""])));
    expect(p.headers.to).toHaveLength(MAX_ADDRESSES_PER_LIST);
    expect(p.diagnostics.some((d) => d.includes("To") && d.includes("truncated"))).toBe(false);
  });

  // ★★★ open-followups §353. This is the VISIBLE half of that defect: an
  // attachment named the way every modern client names a non-ASCII file
  // (RFC 2231, not RFC 2047) had no fileName, so the `fileName !== null ||
  // isMessage` filter above dropped it from the list entirely — silently,
  // with no diagnostic for the user or the model to notice.
  it("keeps an attachment whose filename uses the RFC 2231 extended form", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      "From: a@example.com",
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "hello",
      "--B", "Content-Type: application/pdf",
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment; filename*=UTF-8''Bericht%20f%C3%BCr%20M%C3%BCller.pdf",
      "", "AAEC",
      "--B--", "",
    ])));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].fileName).toBe("Bericht für Müller.pdf");
    expect(p.attachments[0].mimeType).toBe("application/pdf");
    expect(p.attachments[0].bytes).toEqual(new Uint8Array([0, 1, 2]));
    expect(p.diagnostics).toEqual([]);
  });

  it("truncates attachments past the attachment cap and records a diagnostic", () => {
    const boundary = "B";
    const lines = [`Content-Type: multipart/mixed; boundary="${boundary}"`, ""];
    for (let i = 0; i < MAX_ATTACHMENTS + 5; i++) {
      lines.push(`--${boundary}`, `Content-Type: text/plain; name="f${i}.txt"`,
        `Content-Disposition: attachment; filename="f${i}.txt"`, "", `body${i}`);
    }
    lines.push(`--${boundary}--`, "");
    const p = emlToParsedMail(parseMimeMessage(msg(lines)));
    expect(p.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(p.diagnostics.some((d) => d.includes("attachment list truncated"))).toBe(true);
  });
});

// ★★★ CONTENT SUBSTITUTION. A declared attachment whose filename sanitises
// away to nothing was promoted to BE the mail body, discarding the real one:
// `!p.fileName` (the body test) accepted "" while `p.fileName !== null` (the
// attachment filter) kept the same part, so one control character in a
// filename replaced the text handed to the model with attacker HTML. Fixed by
// splitting the DISPLAY name from the STRUCTURAL `isAttachment` flag.
//
// ★★ EVERY ROUTE NEEDS ITS OWN CASE — they do not share a fix path and they
// did not share a history. The plain route was reachable from the beginning;
// the 2231 route arrived later AND regressed a message that had been safe,
// because an unusable extended name outranked the `name=` fallback that had
// been rescuing it. A suite covering only one route clears the other.
const CONTROL_CHAR = String.fromCharCode(1);

const substitutionAttempt = (dispositionLine: string, contentTypeLine: string) =>
  msg([
    'Content-Type: multipart/mixed; boundary="B"', "",
    "--B", "Content-Type: text/plain", "", "the legitimate body",
    "--B", contentTypeLine, dispositionLine, "", "<p>ATTACKER CONTROLLED</p>",
    "--B--", "",
  ]);

describe("emlToParsedMail attachment-vs-body classification", () => {
  const keepsTheRealBody = (raw: string) => {
    const p = emlToParsedMail(parseMimeMessage(raw));
    expect(p.body.kind).toBe("text");
    expect(p.body.content).toContain("the legitimate body");
    expect(p.body.content).not.toContain("ATTACKER CONTROLLED");
    // Non-vacuity: the part was not merely excluded from the body, it is
    // still delivered as the attachment it declared itself to be. A parser
    // that dropped it entirely would satisfy every line above.
    expect(p.attachments).toHaveLength(1);
    return p;
  };

  it("does not promote a part whose PLAIN filename sanitises away", () => {
    keepsTheRealBody(substitutionAttempt(
      `Content-Disposition: attachment; filename="${CONTROL_CHAR}"`,
      "Content-Type: text/html",
    ));
  });

  it("does not promote a part whose RFC 2231 filename sanitises away", () => {
    keepsTheRealBody(substitutionAttempt(
      "Content-Disposition: attachment; filename*=UTF-8''%01",
      "Content-Type: text/html",
    ));
  });

  it("does not promote a part whose filename is a pure-separator traversal", () => {
    keepsTheRealBody(substitutionAttempt(
      'Content-Disposition: attachment; filename="../../"',
      "Content-Type: text/html",
    ));
  });

  // ★★ THE REGRESSION CASE, and the one a plain-route-only suite misses: an
  // unusable extended name must not swallow the Content-Type `name=` that
  // would otherwise have named this attachment. Before the fix this part came
  // back named "" and became the body; before the RFC 2231 work landed at all
  // it was correctly named "notes.html". Both halves are asserted.
  it("falls back to the Content-Type name when the extended form sanitises away", () => {
    const p = keepsTheRealBody(substitutionAttempt(
      "Content-Disposition: attachment; filename*=UTF-8''%01",
      'Content-Type: text/html; name="notes.html"',
    ));
    expect(p.attachments[0].fileName).toBe("notes.html");
  });

  it("names a declared attachment that has no usable name at all", () => {
    const p = keepsTheRealBody(substitutionAttempt(
      `Content-Disposition: attachment; filename="${CONTROL_CHAR}"`,
      "Content-Type: text/html",
    ));
    // Not "attached-message.eml" — that label belongs to message/rfc822 parts
    // and would mislabel this one as a nested mail.
    expect(p.attachments[0].fileName).toBe("attachment");
  });

  // A part with no filename parameter and no attachment disposition is still
  // body content. Without this, "treat everything as an attachment" would
  // pass every test above.
  it("still promotes an ordinary unnamed html part to the body", () => {
    const p = emlToParsedMail(parseMimeMessage(msg([
      'Content-Type: multipart/alternative; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "plain version",
      "--B", "Content-Type: text/html", "", "<p>html version</p>",
      "--B--", "",
    ])));
    expect(p.body.kind).toBe("html");
    expect(p.body.content).toContain("html version");
    expect(p.attachments).toHaveLength(0);
  });
});
