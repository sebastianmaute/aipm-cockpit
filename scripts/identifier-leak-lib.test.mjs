import { describe, it, expect } from "vitest";
import { buildPatterns, classifyHit } from "./identifier-leak-lib.mjs";
import { parseList, isBinary, scanText } from "./identifier-leak-lib.mjs";

const P = buildPatterns(["acme-corp.example", "word:acm"]);

describe("classifyHit", () => {
  it("reports a bare identifier as a leak", () => {
    expect(classifyHit("src/app/foo.ts", 'const h = "acme-corp.example";', P).kind).toBe("leak");
  });

  it("suppresses a mention marked as deliberately absent", () => {
    const line = 'The host "acme-corp.example" was removed. Do NOT reintroduce it.';
    expect(classifyHit("docs/open-followups.md", line, P).kind).toBe("allowed");
  });

  it("does not suppress a leak merely because the file is a doc", () => {
    // The marker, not the file type, is what suppresses.
    expect(classifyHit("docs/whatever.md", "host: acme-corp.example", P).kind).toBe("leak");
  });

  it("matches a word-bounded pattern only as a word", () => {
    expect(classifyHit("a.md", "the acm theme", P).kind).toBe("leak");
    expect(classifyHit("a.md", "acme and acmx", P).kind).toBe("clean");
  });
});

// ---- Beyond the brief's four cases: the list format and the helpers the CLI uses.

describe("parseList", () => {
  it("drops blank lines and # comments, keeps entries trimmed", () => {
    const text = "# a comment\n\n  acme-corp.example  \r\n@brand word:acm\n";
    expect(parseList(text)).toEqual(["acme-corp.example", "@brand word:acm"]);
  });
});

describe("buildPatterns", () => {
  it("names each entry's class — the only thing a report prints", () => {
    const [a, b] = buildPatterns(["@domain acme-corp.example", "globex"]);
    expect(a.cls).toBe("domain");
    expect(b.cls).toBe("entry-2");
    expect(classifyHit("x.ts", "mail@ACME-CORP.example", [a]).classes).toEqual(["domain"]);
  });

  it("refuses an entry with no text to match", () => {
    expect(() => buildPatterns(["word:"])).toThrow(/no text/);
    expect(() => buildPatterns(["@brand word:"])).toThrow(/class brand/);
  });

  it("matches case-insensitively and treats regex metacharacters literally", () => {
    const P2 = buildPatterns(["acme-corp.example"]);
    expect(classifyHit("x", "ACME-CORP.EXAMPLE", P2).kind).toBe("leak");
    expect(classifyHit("x", "acme-corpXexample", P2).kind).toBe("clean");
  });

  it("word-bounds on underscores and digits too, not just letters", () => {
    const P3 = buildPatterns(["word:acm"]);
    expect(classifyHit("x", "acm_theme", P3).kind).toBe("clean");
    expect(classifyHit("x", "acm2", P3).kind).toBe("clean");
    expect(classifyHit("x", "(acm)", P3).kind).toBe("leak");
    expect(classifyHit("x", "acm-theme", P3).kind).toBe("leak");
  });
});

describe("classifyHit — the verdict ignores the path", () => {
  it("gives the same verdict for one line in code and in a doc", () => {
    const line = "host: acme-corp.example";
    expect(classifyHit("src/app/a.ts", line, P).kind).toBe(classifyHit("docs/b.md", line, P).kind);
  });
});

describe("isBinary", () => {
  it("flags a NUL byte within the probe window and passes plain text", () => {
    expect(isBinary(Buffer.from("plain text\n"))).toBe(false);
    expect(isBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
  });
});

describe("scanText", () => {
  it("returns only non-clean lines, 1-based, across CRLF and LF", () => {
    const hits = scanText("f.md", "ok\r\nacme-corp.example\nfine\nacm", P);
    expect(hits.map((h) => [h.line, h.kind])).toEqual([
      [2, "leak"],
      [4, "leak"],
    ]);
  });
});
