import { describe, it, expect } from "vitest";
import {
  parseMimeMessage, MAX_MIME_DEPTH, MAX_HEADER_BYTES, MAX_PARTS, MAX_TOTAL_OUTPUT_BYTES,
  MAX_PARAM_SEGMENTS, MAX_PARAM_VALUE_BYTES,
} from "./mime-parse";

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

  // ★★★ RFC 2231 (open-followups §353). This — not RFC 2047 — is what every
  // modern client emits for a non-ASCII filename, so it is the everyday
  // German/French case. Before the fix `paramOf` saw "filename" followed by
  // "*" rather than "=", nothing else handled the form, and the part was
  // dropped from the attachment list entirely with no diagnostic.
  //
  // `dispositionLines` are folded into ONE Content-Disposition header exactly
  // as a real client wraps a long continued parameter (a line starting with
  // whitespace continues the previous header).
  const withDisposition = (dispositionLines: string[]) => parseMimeMessage(msg([
    'Content-Type: multipart/mixed; boundary="B"', "",
    "--B", "Content-Type: application/pdf",
    ...dispositionLines, "", "x",
    "--B--", "",
  ]));

  it("decodes an RFC 2231 extended-form filename", () => {
    const m = withDisposition([
      "Content-Disposition: attachment; filename*=UTF-8''Bericht%20Q3%20f%C3%BCr%20M%C3%BCller.pdf",
    ]);
    expect(m.parts[0].fileName).toBe("Bericht Q3 für Müller.pdf");
    expect(m.diagnostics).toEqual([]);
  });

  it("decodes an RFC 2231 filename in a non-UTF-8 charset", () => {
    // 0xFC is "ü" and 0xE9 is "é" in windows-1252, and NEITHER is valid UTF-8
    // on its own — so a decoder that ignored the named charset would yield
    // U+FFFD here rather than these characters.
    const m = withDisposition([
      "Content-Disposition: attachment; filename*=windows-1252''M%FCller%20caf%E9.pdf",
    ]);
    expect(m.parts[0].fileName).toBe("Müller café.pdf");
    expect(m.parts[0].fileName).not.toContain("�");
    expect(m.diagnostics).toEqual([]);
  });

  it("assembles an RFC 2231 continuation filename", () => {
    const m = withDisposition([
      "Content-Disposition: attachment;",
      ' filename*0="Bericht ";',
      ' filename*1="Q3.pdf"',
    ]);
    expect(m.parts[0].fileName).toBe("Bericht Q3.pdf");
  });

  // The charset'language' prefix rides an ENCODED first section only. Section
  // 0 here is literal and happens to contain two apostrophes, which a decoder
  // that stripped the prefix unconditionally would eat — leaving "Roll Q3.pdf"
  // after reading "Rock" as a charset and "n" as a language.
  it("does not read a charset prefix out of a literal first section", () => {
    const m = withDisposition([
      "Content-Disposition: attachment;",
      ` filename*0="Rock'n'Roll ";`,
      ' filename*1="Q3.pdf"',
    ]);
    expect(m.parts[0].fileName).toBe("Rock'n'Roll Q3.pdf");
  });

  it("assembles a continuation mixing an encoded and a literal section", () => {
    // Legal and real: the trailing "*" marks a section percent-encoded, its
    // absence marks it literal, and one parameter may carry both.
    const m = withDisposition([
      "Content-Disposition: attachment;",
      " filename*0*=UTF-8''Bericht%20f%C3%BCr%20M%C3%BCller%20;",
      ' filename*1="Q3.pdf"',
    ]);
    expect(m.parts[0].fileName).toBe("Bericht für Müller Q3.pdf");

    // The other half of the same rule, and the direction the case above
    // cannot see: a LITERAL section is not percent-decoded, so a "%" in it
    // stays a "%". Treating every section as encoded would silently rewrite
    // this filename to "Bericht Q3 final.pdf".
    const literalPercent = withDisposition([
      "Content-Disposition: attachment;",
      " filename*0*=UTF-8''Bericht%20;",
      ' filename*1="Q3%20final.pdf"',
    ]);
    expect(literalPercent.parts[0].fileName).toBe("Bericht Q3%20final.pdf");
  });

  // ★★ Pins the byte-level join. The UTF-8 encoding of "ü" is C3 BC, split
  // here across two sections. Decoding each section to a STRING before
  // joining gives "M�" + "�ller.pdf"; only joining the BYTES first
  // recovers the character.
  it("joins continuation sections as bytes, so a split multi-byte character survives", () => {
    const m = withDisposition([
      "Content-Disposition: attachment;",
      " filename*0*=UTF-8''M%C3;",
      " filename*1*=%BCller.pdf",
    ]);
    expect(m.parts[0].fileName).toBe("Müller.pdf");
    expect(m.parts[0].fileName).not.toContain("�");
  });

  // new TextDecoder(label) throws a RangeError on an unknown label AND on the
  // "replacement" encoding family (hz-gb-2312 is one). This module's contract
  // is partial results, never an exception, so both must degrade.
  it("degrades an unknown or unsupported RFC 2231 charset instead of throwing", () => {
    for (const label of ["x-not-a-real-charset", "hz-gb-2312"]) {
      const m = withDisposition([
        `Content-Disposition: attachment; filename*=${label}''Bericht%20Q3.pdf`,
      ]);
      expect(m.parts[0].fileName).toBe("Bericht Q3.pdf");
      expect(m.diagnostics.some((d) => d.includes("unsupported charset"))).toBe(true);
      // The label is attacker-controlled and must not be echoed into text
      // that is rendered for a reader and for the model.
      expect(m.diagnostics.join(" ")).not.toContain(label);
    }
  });

  // ★★ SECURITY. The same payloads the RFC 2047 test above smuggles, smuggled
  // instead through RFC 2231 — they must be neutralised by the SAME
  // sanitizer, not merely decoded.
  it("sanitizes path traversal and control characters out of an RFC 2231 filename", () => {
    const forward = withDisposition([
      "Content-Disposition: attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd",
    ]);
    expect(forward.parts[0].fileName).toBe("passwd");

    const back = withDisposition([
      "Content-Disposition: attachment; filename*=UTF-8''..%5C..%5Cwin.ini%0D%0AX-Injected:%201",
    ]);
    const fileName = back.parts[0].fileName ?? "";
    expect(fileName).not.toMatch(/[\r\n]/);
    expect(fileName).not.toContain("..\\");
    expect(fileName).not.toContain("../");
  });

  // RFC 2231 §4: the extended form wins when a header carries both.
  it("prefers the extended form over a plain filename on the same header", () => {
    const m = withDisposition([
      `Content-Disposition: attachment; filename="fallback.pdf"; filename*=UTF-8''Bericht.pdf`,
    ]);
    expect(m.parts[0].fileName).toBe("Bericht.pdf");
  });

  // Content-Disposition still outranks Content-Type wholesale: the extended
  // form only outranks the plain one WITHIN one header.
  it("still prefers Content-Disposition's plain filename over Content-Type's extended name", () => {
    const m = parseMimeMessage(msg([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", `Content-Type: application/pdf; name*=UTF-8''from-content-type.pdf`,
      'Content-Disposition: attachment; filename="from-disposition.pdf"', "", "x",
      "--B--", "",
    ]));
    expect(m.parts[0].fileName).toBe("from-disposition.pdf");
  });

  // The paramOf anchor must hold for the extended form too — a longer name
  // sharing the suffix cannot hijack it.
  it("does not let a longer parameter name hijack an extended filename", () => {
    const hijack = withDisposition([
      "Content-Disposition: attachment; xfilename*=UTF-8''evil.pdf",
    ]);
    expect(hijack.parts[0].fileName).toBeNull();
    // Non-vacuity: the same message with a properly anchored parameter IS read.
    const real = withDisposition([
      "Content-Disposition: attachment; filename*=UTF-8''good.pdf",
    ]);
    expect(real.parts[0].fileName).toBe("good.pdf");
  });

  it("caps the number of RFC 2231 continuation sections", () => {
    const sections = Array.from(
      { length: MAX_PARAM_SEGMENTS + 10 },
      (_, i) => ` filename*${i}="a"${i === MAX_PARAM_SEGMENTS + 9 ? "" : ";"}`,
    );
    const m = withDisposition(["Content-Disposition: attachment;", ...sections]);
    expect(m.parts[0].fileName).toBe("a".repeat(MAX_PARAM_SEGMENTS));
    expect(m.diagnostics.some((d) => d.includes("filename truncated"))).toBe(true);
  });

  it("caps the assembled length of an RFC 2231 filename", () => {
    const m = withDisposition([
      `Content-Disposition: attachment; filename*=UTF-8''${"a".repeat(MAX_PARAM_VALUE_BYTES + 500)}`,
    ]);
    expect(m.parts[0].fileName).toHaveLength(MAX_PARAM_VALUE_BYTES);
    expect(m.diagnostics.some((d) => d.includes("filename truncated"))).toBe(true);
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

// RFC 5322 mandates CRLF on the wire, but LF-only .eml is what Unix mail
// stores, mbox exports, git send-email and anything that has been through a
// text-mode tool produce. Every test above joins with CRLF via `msg`, which
// is exactly why a splitter that required a literal CRLF before each
// delimiter passed a fully green suite while silently losing EVERY
// attachment of an LF-only message and handing the raw MIME source — part
// headers and base64 blobs included — back as the mail body.
describe("parseMimeMessage line endings", () => {
  const msgLf = (lines: string[]) => lines.join("\n");

  const multipart = [
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="B"', "",
    "preamble that is not a part",
    "--B", "Content-Type: text/plain", "", "hello",
    "--B", 'Content-Type: text/csv; name="rows.csv"',
    "Content-Transfer-Encoding: base64", "", "YSxiCjEsMg==",
    "--B--", "",
  ];

  // Asserts the SAME observations for every ending: nothing about a part
  // count, a filename, the decoded bytes or the diagnostics may depend on
  // which line break the sender used.
  const expectSplitCleanly = (raw: string) => {
    const m = parseMimeMessage(raw);
    expect(m.parts).toHaveLength(2);
    expect(m.parts[0].mimeType).toBe("text/plain");
    // Exact, not toContain: the line break in front of a delimiter belongs
    // to the delimiter, so it must NOT be left on the end of the part before
    // it. A `toContain` assertion passes either way.
    expect(m.parts[0].text).toBe("hello");
    expect(m.parts[1].fileName).toBe("rows.csv");
    expect(new TextDecoder().decode(m.parts[1].bytes)).toBe("a,b\n1,2");
    // The closing "--B--" was recognised as a terminator under this ending.
    expect(m.diagnostics).toEqual([]);
    return m;
  };

  it("splits an LF-only multipart body and keeps its attachment", () => {
    expectSplitCleanly(msgLf(multipart));
  });

  it("splits a CRLF multipart body identically (the control)", () => {
    expectSplitCleanly(multipart.join("\r\n"));
  });

  // Headers rewritten by one tool, body left alone by another — the shape a
  // real mixed-ending message takes. splitHeaders already accepted "\r?\n",
  // so this direction reached the multipart splitter and died there.
  it("splits a message with CRLF headers and an LF-only body", () => {
    expectSplitCleanly(multipart.slice(0, 3).join("\r\n") + "\r\n" + multipart.slice(3).join("\n"));
  });

  it("splits a message with LF-only headers and a CRLF body", () => {
    expectSplitCleanly(multipart.slice(0, 3).join("\n") + "\n" + multipart.slice(3).join("\r\n"));
  });

  // The endings alternate delimiter by delimiter, so no single "detect the
  // message's ending once" shortcut can pass this: the leading break and the
  // trailing break of one delimiter can even differ from each other.
  it("splits a body whose delimiters alternate between CRLF and LF", () => {
    const raw =
      'Content-Type: multipart/mixed; boundary="B"\r\n\r\n' +
      "--B\nContent-Type: text/plain\n\nhello\r\n" +
      "--B\r\nContent-Type: text/csv; name=\"rows.csv\"\nContent-Transfer-Encoding: base64\r\n\r\nYSxiCjEsMg==\n" +
      "--B--\n";
    expectSplitCleanly(raw);
  });

  // ★★ SECURITY. The widening above must not become a forgery hole: the
  // leading-break requirement is the whole §5.1.1 anchor. The CRLF case is
  // pinned by "does not let boundary text mid-line forge a second part"
  // above; this is the same message under the ending that used to collapse
  // it into one undivided blob, where the anchoring was only VACUOUSLY safe.
  const forged = [
    'Content-Type: multipart/mixed; boundary="B"', "",
    "--B", "Content-Type: text/plain", "",
    "benign text --B", "Content-Type: application/x-forged",
    'Content-Disposition: attachment; filename="evil.exe"', "",
    "FORGED",
    "--B--", "",
  ];

  const expectNoForgedPart = (raw: string) => {
    const m = parseMimeMessage(raw);
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].mimeType).toBe("text/plain");
    expect(m.parts.map((p) => p.mimeType)).not.toContain("application/x-forged");
    expect(m.parts.map((p) => p.fileName)).toEqual([null]);
    // The forged block stayed inside the benign part's text.
    expect(m.parts[0].text).toContain("benign text --B");
    expect(m.parts[0].text).toContain("FORGED");
    // Non-vacuity, and the assertion that makes this a real test rather than
    // a tautology: the message DID split — its real "--B" delimiters and its
    // "--B--" terminator were all recognised under this ending. Without it,
    // a parser that simply failed to split anything at all would pass every
    // line above, which is exactly what the pre-fix code did for LF-only.
    expect(m.diagnostics).toEqual([]);
  };

  it("does not let mid-line boundary text forge a part in an LF-only message", () => {
    expectNoForgedPart(msgLf(forged));
  });

  it("does not let mid-line boundary text forge a part in a mixed-ending message", () => {
    // CRLF everywhere except the line carrying the mid-line marker, which
    // ends in a bare LF — so the forged headers follow a real line break and
    // only the marker's own position rejects them.
    const raw = forged.join("\r\n").replace("benign text --B\r\n", "benign text --B\n");
    expect(raw).toContain("benign text --B\nContent-Type: application/x-forged");
    expectNoForgedPart(raw);
  });

  it("does not treat a single-dash line as a delimiter in an LF-only message", () => {
    const m = parseMimeMessage(msgLf([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B", "Content-Type: text/plain", "", "line one", "-B", "line two",
      "--B--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toBe("line one\n-B\nline two");
  });

  // The C2 property (an inner boundary that extends the outer one) under the
  // widened anchor: "--B1" must not be consumed by the outer "--B" marker.
  it("does not let an outer boundary swallow an extending inner one in an LF-only message", () => {
    const m = parseMimeMessage(msgLf([
      'Content-Type: multipart/mixed; boundary="B"', "",
      "--B",
      'Content-Type: multipart/mixed; boundary="B1"', "",
      "--B1", "Content-Type: text/plain", "", "inner part",
      "--B1--",
      "--B--", "",
    ]));
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0].text).toBe("inner part");
    expect(m.diagnostics.join(" ")).not.toContain("no closing boundary");
  });
});
