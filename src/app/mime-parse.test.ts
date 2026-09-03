import { describe, it, expect } from "vitest";
import { parseMimeMessage, MAX_MIME_DEPTH, MAX_PARTS, MAX_TOTAL_OUTPUT_BYTES } from "./mime-parse";

const CRLF = "\r\n";
const msg = (lines: string[]) => lines.join(CRLF);

describe("parseMimeMessage", () => {
  it("reads headers and a plain body", () => {
    const m = parseMimeMessage(msg([
      "From: a@example.com", "To: b@example.com", "Subject: Hello",
      "Date: Wed, 03 Sep 2026 10:00:00 +0000", "", "Body text", "",
    ]));
    expect(m.headers.get("from")).toBe("a@example.com");
    expect(m.headers.get("subject")).toBe("Hello");
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("Body text");
  });

  it("unfolds a continued header", () => {
    const m = parseMimeMessage(msg(["Subject: one", " two", "", "b", ""]));
    expect(m.headers.get("subject")).toBe("one two");
  });

  it("decodes an RFC 2047 encoded-word subject", () => {
    const m = parseMimeMessage(msg(["Subject: =?utf-8?B?R3LDvMOfZQ==?=", "", "b", ""]));
    expect(m.headers.get("subject")).toBe("Grüße");
  });

  it("decodes quoted-printable", () => {
    const m = parseMimeMessage(msg([
      "Content-Type: text/plain", "Content-Transfer-Encoding: quoted-printable",
      "", "caf=C3=A9 s=", "oft", "",
    ]));
    expect(m.parts[0].text).toContain("café soft");
  });

  it("splits a multipart body and keeps each part's headers", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="BND"', "",
      "--BND", "Content-Type: text/plain", "", "hello",
      "--BND", "Content-Type: text/html", "", "<p>hi</p>",
      "--BND--", "",
    ]));
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0].mimeType).toBe("text/plain");
    expect(m.parts[1].mimeType).toBe("text/html");
  });

  it("base64-decodes an attachment part and keeps its filename", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", 'Content-Type: text/csv; name="rows.csv"',
      'Content-Disposition: attachment; filename="rows.csv"',
      "Content-Transfer-Encoding: base64", "", "YSxiCjEsMg==",
      "--B--", "",
    ]));
    const att = m.parts.find((p) => p.fileName === "rows.csv");
    expect(att).toBeDefined();
    expect(new TextDecoder().decode(att!.bytes)).toBe("a,b\n1,2");
  });

  // ★★ SECURITY. An unterminated boundary must consume the remainder, never loop.
  it("does not loop on a missing closing boundary", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "", "--B",
      "Content-Type: text/plain", "", "orphan", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("orphan");
  });

  // ★★ SECURITY. Nesting is capped and the cap is disclosed.
  it("caps nesting depth and says so", () => {
    let body = "deepest";
    for (let i = 0; i < MAX_MIME_DEPTH + 3; i++) {
      body = msg([`Content-Type: multipart/mixed; boundary="B${i}"`, "", `--B${i}`, "", body, `--B${i}--`]);
    }
    const m = parseMimeMessage(body);
    expect(m.diagnostics.join(" ")).toContain("nesting");
  });

  // ★★ SECURITY. A header flood is capped rather than retained.
  it("caps the header count", () => {
    const flood = Array.from({ length: 5000 }, (_, i) => `X-N-${i}: v`);
    const m = parseMimeMessage(msg([...flood, "", "body", ""]));
    expect(m.headers.size).toBeLessThanOrEqual(512);
    expect(m.diagnostics.join(" ")).toContain("header");
  });

  it("never throws on malformed base64", () => {
    expect(() => parseMimeMessage(msg([
      "Content-Transfer-Encoding: base64", "", "!!!not base64!!!", "",
    ]))).not.toThrow();
  });

  // ★★ SECURITY (added beyond the task text). A shallow-but-wide multipart —
  // thousands of sibling parts at one nesting level — is not caught by the
  // depth cap at all. Every node (container or leaf) spends one unit of a
  // shared MAX_PARTS budget, so a flood of declared parts is truncated
  // rather than fully walked.
  it("caps the total part count", () => {
    const N = MAX_PARTS + 200;
    const lines: string[] = ['Content-Type: multipart/mixed; boundary="B"', ""];
    for (let i = 0; i < N; i++) {
      lines.push("--B", "Content-Type: text/plain", "", `p${i}`);
    }
    lines.push("--B--", "");
    const m = parseMimeMessage(msg(lines));
    expect(m.parts.length).toBeLessThanOrEqual(MAX_PARTS);
    expect(m.parts.length).toBeLessThan(N);
    expect(m.diagnostics.join(" ")).toMatch(/part/i);
  });

  // ★★ SECURITY (added beyond the task text). Nothing bounded the sum of
  // decoded bytes across every part, so a chain of moderately-sized parts
  // could still assemble an unbounded amount of output. Once the shared
  // output budget is spent, later parts are dropped rather than decoded.
  it("caps total output bytes across parts", () => {
    const big = "x".repeat(MAX_TOTAL_OUTPUT_BYTES + 1024);
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", big,
      "--B", "Content-Type: text/plain", "", "small tail",
      "--B--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].bytes.byteLength).toBeGreaterThan(MAX_TOTAL_OUTPUT_BYTES);
    expect(m.diagnostics.join(" ")).toMatch(/output|size/i);
  });
});
