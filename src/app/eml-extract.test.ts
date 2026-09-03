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
