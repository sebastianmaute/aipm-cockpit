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

  it("prefers a real HTML body over RTF", () => {
    const html = "<html><body>" + "x".repeat(40) + "</body></html>";
    const p = msgToParsedMail(streams({
      "__substg1.0_10130102": new TextEncoder().encode(html),
      "__substg1.0_10090102": new Uint8Array([1, 2, 3, 4]), // malformed, must not be reached
    }));
    expect(p.body.kind).toBe("html");
    expect(p.body.content).toBe(html);
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

  it("clamps an HTML body at MAX_BODY_PROPERTY_BYTES", () => {
    const oversized = new Uint8Array(MAX_BODY_PROPERTY_BYTES + 100).fill(0x61); // "aaaa..."
    const p = msgToParsedMail(streams({ "__substg1.0_10130102": oversized }));
    expect(p.body.kind).toBe("html");
    expect(p.body.content.length).toBe(MAX_BODY_PROPERTY_BYTES);
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
});
