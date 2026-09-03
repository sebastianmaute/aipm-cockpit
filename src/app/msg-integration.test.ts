import { describe, it, expect } from "vitest";
import { MINIMAL_OUTLOOK_MSG_BASE64 } from "./__fixtures__/minimal-outlook.msg.base64";
import { readCfbfTree } from "./cfbf";
import { msgToParsedMail } from "./msg-extract";
import { ingestBytes } from "./attachment-ingest";

function fixtureBytes(): Uint8Array {
  const bin = atob(MINIMAL_OUTLOOK_MSG_BASE64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe("a real Outlook .msg", () => {
  // ★★★ THE ANTI-TAUTOLOGY TEST. Everything else round-trips our own writer.
  it("reads streams Outlook actually wrote", () => {
    const tree = readCfbfTree(fixtureBytes());
    expect(tree.size).toBeGreaterThan(10);
    expect([...tree.keys()].some((k) => k.startsWith("__substg1.0_"))).toBe(true);
  });

  // ★★★ THIS IS ALSO THE LZFU DICTIONARY'S ONLY REAL PROOF. Outlook writes the
  //  formatted body as an LZFu-compressed RTF stream, so if lzfu.ts's
  //  transcribed initial dictionary is off by even one byte, decompression
  //  produces garbage and this marker is absent. A length assertion on the
  //  dictionary proves nothing; this does.
  it("extracts the subject and body, proving the LZFu dictionary is correct", () => {
    const mail = msgToParsedMail(readCfbfTree(fixtureBytes()));
    expect(mail.headers.subject).toContain("Ingest fixture");
    expect(mail.body.content).toContain("FIXTURE-BODY-MARKER");
  });

  // ★★★ WHAT THIS FIXTURE ACTUALLY CONTAINS, NOT WHAT WAS REQUESTED OF IT.
  // The plan asked for a plain .txt attachment recoverable through the normal
  // recursion path. What Outlook actually produced is different: this
  // tenant's transport policy auto-signs outgoing mail with S/MIME, so
  // "Save As .msg" did not store the composed body and the .txt attachment
  // as separate, independently-readable MSG attachment-table entries.
  // Instead the ENTIRE readable content — body, the bold word, the table,
  // and the real .txt attachment (its payload does contain
  // "fixture attachment payload", verified by decoding the raw stream by
  // hand) — is wrapped inside ONE opaque `multipart/signed` MIME blob that
  // Outlook exposes as a single .msg attachment named "smime.p7m". That is
  // a genuine, not-supported-here nested format (S/MIME / detached MIME),
  // so `classifyAttachment` correctly returns null for it and the ingest
  // orchestrator skips it rather than fabricating a result.
  //
  // So: this fixture DOES prove the real attachment table is read correctly
  // (property tags for filename/MIME type/data, off a real Outlook file,
  // not our own writer) and that an unsupported nested attachment is
  // reported rather than silently dropped or crashing. It does NOT prove
  // "recurses into a plain attachment", because there is no plain,
  // classifier-supported attachment in this real file to recurse into.
  // Recording that gap explicitly rather than rewriting the assertion to
  // something that would pass without saying so.
  it("reads the real attachment table, and correctly skips the one entry it cannot classify", async () => {
    const mail = msgToParsedMail(readCfbfTree(fixtureBytes()));
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].fileName).toBe("smime.p7m");
    expect(mail.attachments[0].mimeType).toBe("multipart/signed");

    const r = await ingestBytes(fixtureBytes(), "application/vnd.ms-outlook", "fixture.msg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.kind).toBe("mail");
    // Correctly skipped, not silently dropped: no child node, but a
    // diagnostic explaining why is folded into the rendered mail block.
    expect(r.node.children).toHaveLength(0);
    const rendered = r.node.block.source as { data: string };
    expect(rendered.data).toContain('attachment "smime.p7m" skipped - unsupported-type');
  });
});

// ★★★ THE DIFAT CHAIN WALK REMAINS UNPROVEN BY THIS FIXTURE — recorded, not
// closed, per the plan's Step 5. This fixture is 82KB; the header's 109
// DIFAT pointers cover ~7.1 MB of FAT, so nothing here ever forces a chained
// DIFAT sector. Measured, not assumed: temporarily replacing cfbf.ts's DIFAT
// chain-walk block with only the header's 109 entries left every test in
// this file (and cfbf.test.ts) green. That mutant survives, which is the
// honest result — it means this fixture does not cover DIFAT chaining, not
// that the guard is unnecessary (see cfbf.ts's own comment on that block,
// and its ★★★ note on the 17.8 MB real Outlook mail that needed it). Closing
// this gap would need a second, ~8 MB+ synthetic-or-real fixture whose only
// job is to force a chained DIFAT sector; none is added here.
