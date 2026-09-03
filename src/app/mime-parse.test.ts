import { describe, it, expect } from "vitest";
import { parseMimeMessage, MAX_MIME_DEPTH, MAX_HEADER_BYTES, MAX_PARTS, MAX_TOTAL_OUTPUT_BYTES } from "./mime-parse";

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

  // Pins the "--" prefix specifically: a single-dash line that merely looks
  // similar must never be treated as a delimiter (T05 fix).
  it("does not treat a single-dash line as a boundary delimiter", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="BND"', "",
      "--BND", "Content-Type: text/plain", "", "line one", "-BND", "line two",
      "--BND--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("line one");
    expect(m.parts[0].text).toContain("-BND");
    expect(m.parts[0].text).toContain("line two");
  });

  // ★★ SECURITY (C1 fix). Boundary text appearing mid-line -- e.g. quoted
  // in the preceding part's text, or deliberately forged -- must never be
  // treated as a delimiter: it is not preceded by CRLF.
  it("does not let boundary text mid-line forge a second part", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "",
      "benign text --B", "Content-Type: text/plain", "X-Forged: yes", "",
      "FORGED",
      "--B--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].mimeType).toBe("text/plain");
    expect(m.parts[0].text).toContain("benign text --B");
    expect(m.parts[0].text).toContain("FORGED");
  });

  // ★★ SECURITY (C2 fix). An inner boundary that extends the outer one
  // (a real pattern some MUAs use, e.g. "B" then "B1") must not have its
  // delimiters eaten by the outer boundary's marker.
  it("does not let an outer boundary swallow an inner boundary that extends it", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B",
      'Content-Type: multipart/mixed; boundary="B1"', "",
      "--B1", "Content-Type: text/plain", "", "inner part",
      "--B1--",
      "--B--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("inner part");
    expect(m.diagnostics.join(" ")).not.toContain("no closing boundary");
  });

  // name= and filename= now differ so the test actually pins that
  // Content-Disposition's filename wins over Content-Type's name (T06 fix).
  it("base64-decodes an attachment part and prefers Content-Disposition's filename", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", 'Content-Type: text/csv; name="fallback.csv"',
      'Content-Disposition: attachment; filename="rows.csv"',
      "Content-Transfer-Encoding: base64", "", "YSxiCjEsMg==",
      "--B--", "",
    ]));
    const att = m.parts.find((p) => p.fileName === "rows.csv");
    expect(att).toBeDefined();
    expect(new TextDecoder().decode(att!.bytes)).toBe("a,b\n1,2");
  });

  // ★★ SECURITY. An unterminated boundary must consume the remainder, never
  // loop, AND must disclose it (T07 fix: previously nothing pinned the
  // diagnostic, so deleting it was undetected).
  it("does not loop on a missing closing boundary, and says so", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "", "--B",
      "Content-Type: text/plain", "", "orphan", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("orphan");
    expect(m.diagnostics.join(" ")).toContain("no closing boundary");
  });

  // ★★ SECURITY (M3 fix). A declared boundary that never appears at all —
  // not even as an opening delimiter — must not discard the whole body.
  it("falls back to the raw body as a single part when the boundary never appears", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="NEVER-SEEN"', "", "just plain text", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("just plain text");
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

  // ★★ SECURITY (I1 fix). Nodes past the depth cap must still spend the
  // part budget -- otherwise a deeply-nested multipart can hang unlimited
  // children off its deepest allowed level for free. Build MAX_MIME_DEPTH
  // levels of single-child nesting so the innermost container's own
  // children land one level past the cap, and give it far more children
  // than MAX_PARTS: the part-count diagnostic can only fire if every one of
  // those over-depth attempts still cost a budget unit.
  it("spends the part budget even for nodes past the depth cap", () => {
    const leafCount = MAX_PARTS + 500;
    const leaf: string[] = ['Content-Type: multipart/mixed; boundary="LEAF"', ""];
    for (let i = 0; i < leafCount; i++) leaf.push("--LEAF", "Content-Type: text/plain", "", `p${i}`);
    leaf.push("--LEAF--", "");
    let body = msg(leaf);
    for (let i = 0; i < MAX_MIME_DEPTH; i++) {
      body = msg([`Content-Type: multipart/mixed; boundary="B${i}"`, "", `--B${i}`, "", body, `--B${i}--`, ""]);
    }
    const m = parseMimeMessage(body);
    expect(m.diagnostics.join(" ")).toMatch(/part count exceeded the cap/);
  }, 20000);

  // ★★ SECURITY. A header flood is capped rather than retained.
  it("caps the header count", () => {
    const flood = Array.from({ length: 5000 }, (_, i) => `X-N-${i}: v`);
    const m = parseMimeMessage(msg([...flood, "", "body", ""]));
    expect(m.headers.size).toBeLessThanOrEqual(512);
    expect(m.diagnostics.join(" ")).toContain("header");
  });

  // M5 fix: landing EXACTLY at the cap with nothing dropped must not claim
  // anything was capped.
  it("does not claim the header count was capped when nothing was dropped", () => {
    const exact = Array.from({ length: 512 }, (_, i) => `X-N-${i}: v`);
    const m = parseMimeMessage(msg([...exact, "", "body", ""]));
    expect(m.headers.size).toBe(512);
    expect(m.diagnostics.join(" ")).not.toContain("header count capped");
  });

  // ★★ SECURITY. A header block flood (few headers, one gigantic value) is
  // capped independently of header COUNT.
  it("caps the header block size", () => {
    const longValue = "a".repeat(MAX_HEADER_BYTES + 5000);
    const m = parseMimeMessage(msg([`X-Long: ${longValue}`, "", "body", ""]));
    expect(m.diagnostics.join(" ")).toContain("size cap");
    expect((m.headers.get("x-long") ?? "").length).toBeLessThan(longValue.length);
  });

  it("never throws on malformed base64", () => {
    expect(() => parseMimeMessage(msg([
      "Content-Transfer-Encoding: base64", "", "!!!not base64!!!", "",
    ]))).not.toThrow();
  });

  // ★★ SECURITY (I4 fix). A single mangled byte (here: a missing trailing
  // "=" so the length is no longer a multiple of 4) must recover the
  // largest valid prefix instead of silently dropping the whole attachment.
  it("recovers a valid prefix instead of nothing from a single mangled base64 byte", () => {
    const m = parseMimeMessage(msg([
      "Content-Transfer-Encoding: base64", "", "aGVsbG8", "", // "hello" minus its "="
    ]));
    expect(m.parts[0].bytes.byteLength).toBeGreaterThan(0);
    expect(m.diagnostics.join(" ")).toMatch(/base64/i);
  });

  // ★★ SECURITY (I5 fix). A duplicate Content-Type must resolve first-wins,
  // matching real mail user agents, and disclose the collision.
  it("keeps the first Content-Type on a duplicate", () => {
    const m = parseMimeMessage(msg([
      "Content-Type: text/plain", "Content-Type: text/html", "", "hi", "",
    ]));
    expect(m.parts[0].mimeType).toBe("text/plain");
    expect(m.diagnostics.join(" ")).toMatch(/duplicate/i);
  });

  // ★★ SECURITY (I2 fix). A prefixed parameter name must not hijack the
  // real one -- xboundary vs boundary.
  // Uses TWO parts deliberately: if the hijack succeeds, splitting on the
  // wrong ("EVIL") boundary finds no delimiter at all, and the M3
  // never-appears fallback would recover the raw body as a single
  // unstructured part anyway -- masking the hijack with only one part in
  // the fixture. Two real parts turn that mask into a visible, wrong count.
  it("does not let a prefixed parameter name hijack the real boundary", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; xboundary="EVIL"; boundary="REAL"', "",
      "--REAL", "Content-Type: text/plain", "", "part one",
      "--REAL", "Content-Type: text/plain", "", "part two",
      "--REAL--", "",
    ]));
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0].text).toContain("part one");
    expect(m.parts[1].text).toContain("part two");
  });

  // ★★ SECURITY (I2 fix). Same hijack shape against charset.
  it("does not let a prefixed parameter name hijack the real charset", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: text/plain; xcharset="utf-16le"; charset="iso-8859-1"',
      "Content-Transfer-Encoding: quoted-printable", "", "caf=E9", "",
    ]));
    expect(m.parts[0].text).toContain("café");
  });

  // ★★ SECURITY (I3 fix). A header-less body part is legal per RFC 2046 --
  // it must become body text, never vanish.
  it("treats a header-less message as body text rather than losing it", () => {
    const m = parseMimeMessage("hello world");
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toContain("hello world");
  });

  // ★★ SECURITY (I3 fix). Content that merely contains a blank line but was
  // never really a header block must not have its first "line" silently
  // swallowed as a bogus header.
  it("does not eat leading content as headers when it never looked like headers", () => {
    const m = parseMimeMessage("para one\r\n\r\npara two");
    expect(m.parts[0].text).toContain("para one");
    expect(m.parts[0].text).toContain("para two");
  });

  // ★★ SECURITY (I6 / M6 fix). A literal (non-escaped) multi-byte character
  // in quoted-printable text must round-trip, not be truncated to garbage.
  it("does not truncate a literal non-ASCII character in quoted-printable text", () => {
    const m = parseMimeMessage(msg([
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable", "", "你好", "",
    ]));
    expect(m.parts[0].text).toContain("你好");
  });

  // ★★ SECURITY (I7 fix). An RFC 2047 encoded-word filename can smuggle
  // control characters and path traversal invisibly (the raw header looks
  // innocuous) -- both must be stripped from the decoded value.
  it("sanitizes control characters and path traversal out of a decoded filename", () => {
    const payload = "..\\..\\win.ini\r\nX-Injected: 1";
    const encoded = `=?utf-8?B?${Buffer.from(payload, "utf-8").toString("base64")}?=`;
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: application/octet-stream",
      `Content-Disposition: attachment; filename="${encoded}"`, "", "x",
      "--B--", "",
    ]));
    const fileName = m.parts[0].fileName ?? "";
    expect(fileName).not.toMatch(/[\r\n]/);
    expect(fileName).not.toContain("..\\");
    expect(fileName).not.toContain("../");
  });

  it("flags a message/rfc822 part as isMessage", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: message/rfc822", "", "From: x@example.com",
      "--B", "Content-Type: text/plain", "", "hi",
      "--B--", "",
    ]));
    expect(m.parts[0].isMessage).toBe(true);
    expect(m.parts[1].isMessage).toBe(false);
  });

  it("lowercases the mime type", () => {
    const m = parseMimeMessage(msg(["Content-Type: TEXT/PLAIN", "", "hi", ""]));
    expect(m.parts[0].mimeType).toBe("text/plain");
  });

  it("decodes a part using its declared charset", () => {
    const m = parseMimeMessage(msg([
      "Content-Type: text/plain; charset=iso-8859-1",
      "Content-Transfer-Encoding: quoted-printable", "", "caf=E9", "",
    ]));
    expect(m.parts[0].text).toContain("café");
  });

  it("leaves an encoded-word with an unrecognized charset untouched rather than throwing", () => {
    const m = parseMimeMessage(msg(["Subject: =?not-a-charset?B?aGVsbG8=?=", "", "b", ""]));
    expect(m.headers.get("subject")).toBe("=?not-a-charset?B?aGVsbG8=?=");
  });

  it("falls back to utf-8 when a part's declared charset is unrecognized", () => {
    const m = parseMimeMessage(msg([
      "Content-Type: text/plain; charset=not-a-charset", "", "hello", "",
    ]));
    expect(m.parts[0].text).toContain("hello");
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
    // Matches the specific diagnostic, not the unrelated
    // "multipart body had no closing boundary" (which also contains "part").
    expect(m.diagnostics.join(" ")).toMatch(/part count exceeded the cap/);
  });

  // ★★ SECURITY (M1 fix). The output budget now bounds a SINGLE oversized
  // part too, not just the running total: a part whose raw body already
  // exceeds the remaining budget is dropped rather than decoded-then-kept.
  it("drops a single part whose body already exceeds the output budget", () => {
    const big = "x".repeat(MAX_TOTAL_OUTPUT_BYTES + 1024);
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", big,
      "--B", "Content-Type: text/plain", "", "small tail",
      "--B--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toBe("small tail");
    expect(m.diagnostics.join(" ")).toMatch(/output|size/i);
  });

  // Cumulative total across many smaller parts is still bounded even though
  // no single one of them exceeds the budget on its own.
  it("caps the running total across many smaller parts", () => {
    const chunk = "y".repeat(1024 * 1024); // 1 MB, well under the cap alone
    const partCount = Math.ceil(MAX_TOTAL_OUTPUT_BYTES / chunk.length) + 5;
    const lines: string[] = ['Content-Type: multipart/mixed; boundary="B"', ""];
    for (let i = 0; i < partCount; i++) lines.push("--B", "Content-Type: text/plain", "", chunk);
    lines.push("--B--", "");
    const m = parseMimeMessage(msg(lines));
    const total = m.parts.reduce((sum, p) => sum + p.bytes.byteLength, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_OUTPUT_BYTES);
    expect(m.parts.length).toBeLessThan(partCount);
  }, 20000);
});
