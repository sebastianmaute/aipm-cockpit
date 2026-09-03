import { describe, it, expect } from "vitest";
import {
  renderMailMarkdown,
  parseMail,
  looksLikeCfbf,
  type ParsedMail,
  MAX_HEADER_FIELD_CHARS,
  MAX_ATTACHMENTS_RENDERED,
  MAX_DIAGNOSTICS_RENDERED,
  MAIL_MARKDOWN_HARD_CAP,
} from "./mail-extract";

const base: ParsedMail = {
  headers: { from: "a@x.com", to: ["b@x.com"], cc: [], subject: "Subj", date: "2026-09-03T10:00:00.000Z" },
  body: { kind: "text", content: "Body text" },
  attachments: [],
  diagnostics: [],
};

describe("renderMailMarkdown", () => {
  it("puts the headers above the body", () => {
    const md = renderMailMarkdown(base, 100_000);
    expect(md).toContain("**From:** a@x.com");
    expect(md).toContain("**Subject:** Subj");
    expect(md.indexOf("**Subject:**")).toBeLessThan(md.indexOf("Body text"));
  });

  it("names each attachment so the model knows what it is about to see", () => {
    const md = renderMailMarkdown({ ...base, attachments: [
      { fileName: "a.xlsx", mimeType: "application/vnd.ms-excel", bytes: new Uint8Array(3) },
    ] }, 100_000);
    expect(md).toContain("a.xlsx");
  });

  // ★★★ DISCLOSURE. A silent truncation makes the model report confidently on
  //  data it never saw. Every cut says so.
  it("discloses a truncated body rather than cutting silently", () => {
    const md = renderMailMarkdown({ ...base, body: { kind: "text", content: "x".repeat(5000) } }, 500);
    expect(md).toContain("_(truncated");
    expect(md.length).toBeLessThan(1200);
  });

  it("carries parser diagnostics into the output", () => {
    const md = renderMailMarkdown({ ...base, diagnostics: ["multipart body had no closing boundary"] }, 100_000);
    expect(md).toContain("no closing boundary");
  });

  it("marks a degraded rtf body with a note", () => {
    const md = renderMailMarkdown({ ...base, body: { kind: "rtf-degraded", content: "plain fallback" } }, 100_000);
    expect(md).toContain("formatting could not be recovered");
    expect(md).toContain("plain fallback");
  });

  it("omits empty header lines rather than printing them blank", () => {
    const md = renderMailMarkdown({ ...base, headers: { from: "", to: [], cc: [], subject: "", date: "" } }, 100_000);
    expect(md).not.toContain("**From:**");
    expect(md).not.toContain("**Subject:**");
    expect(md).not.toContain("**To:**");
    expect(md).not.toContain("**Date:**");
  });

  it("truncates an oversized header field rather than rendering it whole", () => {
    const hostileSubject = "s".repeat(MAX_HEADER_FIELD_CHARS + 500);
    const md = renderMailMarkdown({ ...base, headers: { ...base.headers, subject: hostileSubject } }, 100_000);
    expect(md).not.toContain(hostileSubject);
    expect(md).toContain("s".repeat(MAX_HEADER_FIELD_CHARS) + "…");
  });

  it("caps the rendered attachment list and notes what was left out", () => {
    const attachments = Array.from({ length: MAX_ATTACHMENTS_RENDERED + 10 }, (_, i) => ({
      fileName: `f${i}.txt`, mimeType: "text/plain", bytes: new Uint8Array(0),
    }));
    const md = renderMailMarkdown({ ...base, attachments }, 100_000);
    expect(md).toContain(`f${MAX_ATTACHMENTS_RENDERED - 1}.txt`);
    expect(md).not.toContain(`f${MAX_ATTACHMENTS_RENDERED}.txt`);
    expect(md).toContain("10 more attachments not listed");
  });

  it("caps the rendered diagnostics list and notes what was left out", () => {
    const diagnostics = Array.from({ length: MAX_DIAGNOSTICS_RENDERED + 3 }, (_, i) => `diag ${i}`);
    const md = renderMailMarkdown({ ...base, diagnostics }, 100_000);
    expect(md).toContain(`diag ${MAX_DIAGNOSTICS_RENDERED - 1}`);
    expect(md).not.toContain(`diag ${MAX_DIAGNOSTICS_RENDERED}`);
    expect(md).toContain("3 more parser diagnostics not shown");
  });

  it("applies a hard cap to the whole rendered output", () => {
    const attachments = Array.from({ length: MAX_ATTACHMENTS_RENDERED }, (_, i) => ({
      fileName: `${"f".repeat(MAX_HEADER_FIELD_CHARS)}${i}.txt`, mimeType: "text/plain", bytes: new Uint8Array(0),
    }));
    const md = renderMailMarkdown({ ...base, attachments, body: { kind: "text", content: "y".repeat(400_000) } }, 400_000);
    expect(md.length).toBeLessThanOrEqual(MAIL_MARKDOWN_HARD_CAP + 200);
    expect(md).toContain("output exceeded the hard size cap");
  });
});

// ★ .msg is a binary CFBF compound file, not RFC 5322 text — parseMail must
//  route it to the CFBF reader rather than the UTF-8 MIME parser, and must
//  never throw on a malformed one (a real .msg with a broken directory is a
//  parser diagnostic, not a crash).
describe("parseMail — CFBF routing", () => {
  it("routes a compound file to the msg parser rather than the MIME parser", () => {
    const header = new Uint8Array(512);
    header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(looksLikeCfbf(header)).toBe(true);
    const mail = parseMail(header);          // malformed body, but must not throw
    expect(mail.attachments).toEqual([]);
    expect(mail.body.content).toBe("");
  });
});
