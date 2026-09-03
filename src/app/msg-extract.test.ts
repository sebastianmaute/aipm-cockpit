import { describe, it, expect } from "vitest";
import {
  msgToParsedMail,
  MAX_ATTACHMENTS,
  MAX_PROPERTY_BYTES,
  MAX_BODY_PROPERTY_BYTES,
  MAX_ADDRESSES_PER_LIST,
} from "./msg-extract";

const uni = (s: string) => new Uint8Array(Buffer.from(s, "utf16le"));

function streams(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map(Object.entries(entries));
}

describe("msgToParsedMail", () => {
  it("reads subject, sender and the plain body from the root storage", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_0037001F": uni("Q3 plan"),
      "__substg1.0_0C1A001F": uni("Alice Example"),
      "__substg1.0_1000001F": uni("Body text here"),
    }));
    expect(p.headers.subject).toBe("Q3 plan");
    expect(p.headers.from).toBe("Alice Example");
    expect(p.body.content).toContain("Body text here");
    expect(p.body.kind).toBe("text");
  });

  // ★★★ THE MEASURED DEFECT, PINNED. A flattened reader attributed a
  //  __nameid_version1.0 stream to the message and reported a body that did not
  //  exist. Properties resolve by ROOT PATH ONLY.
  it("ignores same-named streams inside other storages", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_0037001F": uni("Real subject"),
      "__nameid_version1.0/__substg1.0_0037001F": uni("Decoy subject"),
      "__attach_version1.0_#00000000/__substg1.0_0037001F": uni("Attachment subject"),
    }));
    expect(p.headers.subject).toBe("Real subject");
  });

  // ★★★ THE ABOVE TEST IS ORDER-DEPENDENT AND DOES NOT ALONE KILL A
  //  suffix-matching mutant of rootProp: `streams({...})` preserves object
  //  key order, so the root entry (inserted first) is found first by a
  //  `for...of` + `endsWith` scan too, regardless of whether it correctly
  //  matches by EXACT path. Measured directly: mutating rootProp to
  //  `for (const [k,v] of streams) if (k.endsWith(...)) return v;` still
  //  passed the test above, and only fails THIS one, where the decoy is
  //  inserted before the real root property.
  it("resolves the root property by exact path even when a same-named decoy is inserted first", () => {
    const p = msgToParsedMail(streams({
      "__nameid_version1.0/__substg1.0_0037001F": uni("Decoy subject"),
      "__attach_version1.0_#00000000/__substg1.0_0037001F": uni("Attachment subject"),
      "__substg1.0_0037001F": uni("Real subject"),
    }));
    expect(p.headers.subject).toBe("Real subject");
  });

  it("falls back to the sender email when the sender name is absent", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_0C1F001F": uni("alice@example.com"),
    }));
    expect(p.headers.from).toBe("alice@example.com");
  });

  it("collects attachments from their own storages", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_1000001F": uni("body"),
      "__attach_version1.0_#00000000/__substg1.0_3707001F": uni("plan.xlsx"),
      "__attach_version1.0_#00000000/__substg1.0_370E001F": uni("application/vnd.ms-excel"),
      "__attach_version1.0_#00000000/__substg1.0_37010102": new Uint8Array([1, 2, 3]),
    }));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].fileName).toBe("plan.xlsx");
    expect(p.attachments[0].mimeType).toBe("application/vnd.ms-excel");
    expect(Array.from(p.attachments[0].bytes)).toEqual([1, 2, 3]);
  });

  it("falls back to the short filename when the long one is absent", () => {
    const p = msgToParsedMail(streams({
      "__attach_version1.0_#00000000/__substg1.0_3704001F": uni("SHORT~1.XLS"),
      "__attach_version1.0_#00000000/__substg1.0_37010102": new Uint8Array([9]),
    }));
    expect(p.attachments[0].fileName).toBe("SHORT~1.XLS");
  });

  it("falls back to a generic name and MIME type when neither is present", () => {
    const p = msgToParsedMail(streams({
      "__attach_version1.0_#00000000/__substg1.0_37010102": new Uint8Array([9]),
    }));
    expect(p.attachments[0].fileName).toBe("attachment");
    expect(p.attachments[0].mimeType).toBe("application/octet-stream");
  });

  it("skips an attachment storage with no data stream, and notes it", () => {
    const p = msgToParsedMail(streams({
      "__attach_version1.0_#00000000/__substg1.0_3707001F": uni("embedded.msg"),
    }));
    expect(p.attachments).toEqual([]);
    expect(p.diagnostics.some((d) => d.includes("__attach_version1.0_#00000000"))).toBe(true);
  });

  it("reports the degraded kind when only an RTF body exists", () => {
    // A MELA container is uncompressed, so no compressor is needed here.
    const rtf = "{\\rtf1 Formatted body}";
    const body = new TextEncoder().encode(rtf);
    const c = new Uint8Array(16 + body.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, 12 + body.length, true);
    dv.setUint32(4, body.length, true);
    c.set(new TextEncoder().encode("MELA"), 8);
    c.set(body, 16);
    const p = msgToParsedMail(streams({ "__substg1.0_10090102": c }));
    expect(p.body.content).toContain("Formatted body");
    expect(p.body.kind).toBe("rtf-degraded");
  });

  it("falls back to the plain body when RTF decompresses to nothing", () => {
    // A well-formed-enough header (magic "LZFu") whose payload never
    // resolves to any literal or valid back-reference byte.
    const c = new Uint8Array(16);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, 12, true);
    dv.setUint32(4, 4, true);
    c.set(new TextEncoder().encode("LZFu"), 8);
    const p = msgToParsedMail(streams({
      "__substg1.0_10090102": c,
      "__substg1.0_1000001F": uni("plain fallback"),
    }));
    expect(p.body.kind).toBe("text");
    expect(p.body.content).toBe("plain fallback");
    expect(p.diagnostics.some((d) => d.includes("could not be decompressed"))).toBe(true);
  });

  it("ignores an HTML stream too short to be a real body and falls through to RTF", () => {
    const rtf = "{\\rtf1 From RTF}";
    const body = new TextEncoder().encode(rtf);
    const c = new Uint8Array(16 + body.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, 12 + body.length, true);
    dv.setUint32(4, body.length, true);
    c.set(new TextEncoder().encode("MELA"), 8);
    c.set(body, 16);
    const p = msgToParsedMail(streams({
      "__substg1.0_10130102": new Uint8Array(8), // below MIN_HTML_BODY_BYTES
      "__substg1.0_10090102": c,
    }));
    expect(p.body.kind).toBe("rtf-degraded");
    expect(p.body.content).toContain("From RTF");
  });

  // ★★ CHANGED: this asserted `content` EQUALS the raw markup, which pinned the
  //  defect that the HTML body bypassed extractHtmlMarkdown entirely. The
  //  subject of the test — HTML wins over RTF — is unchanged; only the shape
  //  of the winning body is, and it now matches eml-extract.ts's.
  it("prefers a real HTML body over RTF", () => {
    const html = "<html><body>" + "x".repeat(40) + "</body></html>";
    const p = msgToParsedMail(streams({
      "__substg1.0_10130102": new TextEncoder().encode(html),
      "__substg1.0_10090102": new Uint8Array([1, 2, 3, 4]), // malformed, must not be reached
    }));
    expect(p.body.kind).toBe("html");
    expect(p.body.content).toBe("x".repeat(40));
  });

  it("returns an empty mail rather than throwing on an empty stream map", () => {
    const p = msgToParsedMail(new Map());
    expect(p.headers.subject).toBe("");
    expect(p.attachments).toEqual([]);
  });

  // --- Hostile-input bounds added beyond the plan's Step 3 sample ---

  it("clamps a property value at MAX_PROPERTY_BYTES and records it", () => {
    const oversized = new Uint8Array(MAX_PROPERTY_BYTES + 200);
    // Fill with a repeating unicode "A" so the clamp lands mid-string, not on
    // an already-zero tail.
    for (let i = 0; i < oversized.length; i += 2) oversized[i] = 0x41;
    const p = msgToParsedMail(streams({ "__substg1.0_0037001F": oversized }));
    expect(p.headers.subject.length).toBe(MAX_PROPERTY_BYTES / 2);
    expect(p.diagnostics.some((d) => d.includes("property value(s) truncated"))).toBe(true);
  });

  it("does not clamp a property value at or under MAX_PROPERTY_BYTES", () => {
    const exact = new Uint8Array(MAX_PROPERTY_BYTES);
    for (let i = 0; i < exact.length; i += 2) exact[i] = 0x41;
    const p = msgToParsedMail(streams({ "__substg1.0_0037001F": exact }));
    expect(p.headers.subject.length).toBe(MAX_PROPERTY_BYTES / 2);
    expect(p.diagnostics.some((d) => d.includes("truncated"))).toBe(false);
  });

  it("clamps a plain body at MAX_BODY_PROPERTY_BYTES", () => {
    const oversized = new Uint8Array(MAX_BODY_PROPERTY_BYTES + 100);
    for (let i = 0; i < oversized.length; i += 2) oversized[i] = 0x41;
    const p = msgToParsedMail(streams({ "__substg1.0_1000001F": oversized }));
    expect(p.body.content.length).toBe(MAX_BODY_PROPERTY_BYTES / 2);
    expect(p.diagnostics.some((d) => d.includes("property value(s) truncated"))).toBe(true);
  });

  // ★★ CHANGED: this asserted the rendered length EQUALS MAX_BODY_PROPERTY_BYTES,
  //  which was only true while the body was emitted as raw undecoded markup.
  //  The body now passes through extractHtmlMarkdown, whose own (smaller)
  //  input clamp decides the final length — pinning that number here would
  //  pin ANOTHER module's constant, so only the bound is asserted. The
  //  DIAGNOSTIC is what pins this module's clamp, and deleting the clamp
  //  turns it red; the clamp is no longer observable in `content`, because
  //  html-extract.ts cuts further in than it does either way.
  it("clamps an HTML body at MAX_BODY_PROPERTY_BYTES", () => {
    const oversized = new Uint8Array(MAX_BODY_PROPERTY_BYTES + 100).fill(0x61); // "aaaa..."
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": oversized }));
    expect(p.body.kind).toBe("html");
    expect(p.body.content.length).toBeLessThan(MAX_BODY_PROPERTY_BYTES);
    expect(p.body.content.length).toBeGreaterThan(0);
    expect(p.diagnostics.some((d) => d.includes("property value(s) truncated"))).toBe(true);
  });

  it("truncates a to/cc address list at MAX_ADDRESSES_PER_LIST and notes it", () => {
    const many = Array.from({ length: MAX_ADDRESSES_PER_LIST + 5 }, (_, i) => `a${i}@x.com`).join(";");
    const p = msgToParsedMail(streams({ "__substg1.0_0E04001F": uni(many) }));
    expect(p.headers.to).toHaveLength(MAX_ADDRESSES_PER_LIST);
    expect(p.diagnostics.some((d) => d.startsWith("To truncated"))).toBe(true);
  });

  it("keeps a to/cc address list unchanged at or under MAX_ADDRESSES_PER_LIST", () => {
    const exact = Array.from({ length: MAX_ADDRESSES_PER_LIST }, (_, i) => `a${i}@x.com`).join(",");
    const p = msgToParsedMail(streams({ "__substg1.0_0E03001F": uni(exact) }));
    expect(p.headers.cc).toHaveLength(MAX_ADDRESSES_PER_LIST);
    expect(p.diagnostics.some((d) => d.startsWith("Cc truncated"))).toBe(false);
  });

  it("caps the number of attachment storages walked at MAX_ATTACHMENTS", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ATTACHMENTS + 3; i++) {
      const id = i.toString(16).padStart(8, "0");
      entries[`__attach_version1.0_#${id}/__substg1.0_37010102`] = new Uint8Array([i % 256]);
    }
    const p = msgToParsedMail(streams(entries));
    expect(p.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(p.diagnostics.some((d) => d.startsWith("attachment list truncated"))).toBe(true);
  });

  it("does not report truncation at exactly MAX_ATTACHMENTS storages", () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ATTACHMENTS; i++) {
      const id = i.toString(16).padStart(8, "0");
      entries[`__attach_version1.0_#${id}/__substg1.0_37010102`] = new Uint8Array([1]);
    }
    const p = msgToParsedMail(streams(entries));
    expect(p.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(p.diagnostics.some((d) => d.startsWith("attachment list truncated"))).toBe(false);
  });

  // --- The HTML body: extraction, charset, and the PT_UNICODE tag variant ---
  //
  // ★★ THESE FIXTURES CARRY LITERAL NON-ASCII CHARACTERS, and that makes the
  //  test source itself part of what is under test: a fixture and its expected
  //  value are the same literal, so an editor that mangles one mangles both
  //  and the test goes on passing while proving nothing. It cannot be a
  //  self-check. Byte-scan the file after editing anything below — every
  //  character outside ASCII here should be one of
  //  U+00DF U+00E2 U+00E4 U+00F6 U+00FC U+20AC U+FFFD, and nothing else:
  //    node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');
  //      const m=new Set(); for(const c of s) if(c.codePointAt(0)>127) m.add(c);
  //      console.log([...m].join(' '))" src/app/msg-extract.test.ts
  //  (the em dash and ★ of these comments will show up too).

  /** windows-1252 bytes. Every character used here is in the 0x00-0xFF range
   *  where windows-1252 and the code point agree, so this is exact. */
  const cp1252 = (s: string) => Uint8Array.from(s, (ch) => ch.codePointAt(0) ?? 0);

  it("routes the HTML body through the Markdown extractor instead of emitting raw markup", () => {
    const rich =
      "<html><head><style>p{color:red}</style></head><body>"
      + "<h1>Quarterly plan</h1>"
      + '<div style="font-family:Calibri"><p>Ship <b>on time</b>.</p></div>'
      + "<ul><li>Alpha</li><li>Beta</li></ul>"
      + "</body></html>";
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": new TextEncoder().encode(rich) }));
    expect(p.body.kind).toBe("html");
    // The structure a reader saw, as Markdown — not the markup that carried it.
    expect(p.body.content).toBe("# Quarterly plan\n\nShip on time .\n\n- Alpha\n- Beta");
    expect(p.body.content).not.toContain("<div");
    expect(p.body.content).not.toContain("color:red"); // the <style> subtree is gone
  });

  it("decodes an undeclared windows-1252 HTML body without losing its umlauts", () => {
    const bytes = cp1252(
      "<html><body><p>Preisverhältnis und Maßnahmen für München</p></body></html>",
    );
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": bytes }));
    expect(p.body.content).toBe("Preisverhältnis und Maßnahmen für München");
    expect(p.body.content).not.toContain("�");
  });

  // ★ A legacy body MISLABELLED as UTF-8 is the common case, not a contrived
  //  one — Outlook stamps the meta declaration from the composing client, not
  //  from the bytes. Honouring a declared UTF-8 label would lose the eszett.
  it("falls back to windows-1252 for a body whose own declaration claims UTF-8", () => {
    const bytes = cp1252(
      '<html><head><meta charset="utf-8"></head><body><p>Maßnahmen</p></body></html>',
    );
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": bytes }));
    expect(p.body.content).toBe("Maßnahmen");
  });

  it("honours a charset declared in the http-equiv Content-Type form", () => {
    const bytes = cp1252(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'
      + "</head><body><p>Größe</p></body></html>",
    );
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": bytes }));
    expect(p.body.content).toBe("Größe");
  });

  it("still decodes a real UTF-8 HTML body exactly", () => {
    const bytes = new TextEncoder().encode(
      "<html><body><p>Preisverhältnis und Maßnahmen für München</p></body></html>",
    );
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": bytes }));
    expect(p.body.content).toBe("Preisverhältnis und Maßnahmen für München");
  });

  // ★★ THE CLAMP CAN CUT A MULTI-BYTE SEQUENCE IN HALF. A non-streaming
  //  `fatal: true` decode throws on that tail, which would send an entire
  //  valid UTF-8 body down the windows-1252 branch — one lost character
  //  becoming whole-body mojibake. The euro sign is 3 bytes and the cap is
  //  not a multiple of 3, so this fixture guarantees the mid-sequence cut.
  it("does not mistake a clamp-truncated UTF-8 tail for a legacy body", () => {
    expect(MAX_BODY_PROPERTY_BYTES % 3).not.toBe(0);
    const n = Math.ceil((MAX_BODY_PROPERTY_BYTES + 30) / 3);
    const bytes = new TextEncoder().encode("€".repeat(n));
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": bytes }));
    expect(p.body.content.startsWith("€€€€")).toBe(true);
    expect(p.body.content).not.toContain("�");
    expect(p.body.content).not.toContain("â"); // the cp1252 reading of a euro sign's lead byte
    expect(p.diagnostics.some((d) => d.includes("property value(s) truncated"))).toBe(true);
  });

  // ★★ PidTagHtml is PT_BINARY (10130102) in MS-OXPROPS, but some producers
  //  write the PT_UNICODE variant. A map carrying only that tag reported an
  //  EMPTY text body before it was accepted here.
  it("honours the PT_UNICODE variant of the HTML body tag", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_1013001F": uni("<html><body><p>Maßnahmen aus dem Unicode-Tag</p></body></html>"),
    }));
    expect(p.body.kind).toBe("html");
    expect(p.body.content).toBe("Maßnahmen aus dem Unicode-Tag");
  });

  it("prefers the spec-canonical PT_BINARY HTML tag when both variants are present", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_10130102": new TextEncoder().encode("<html><body><p>From the binary tag body</p></body></html>"),
      "__substg1.0_1013001F": uni("<html><body><p>From the unicode tag body</p></body></html>"),
    }));
    expect(p.body.content).toBe("From the binary tag body");
  });

  it("ignores a PT_UNICODE HTML stream too short to be a real body", () => {
    const p = msgToParsedMail(streams({
      "__substg1.0_1013001F": uni("<p>hi</p>"), // 18 bytes, below MIN_HTML_BODY_BYTES
      "__substg1.0_1000001F": uni("plain fallback"),
    }));
    expect(p.body.kind).toBe("text");
    expect(p.body.content).toBe("plain fallback");
  });
});
