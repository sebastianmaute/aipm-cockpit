import { describe, expect, it } from "vitest";
import { ingestBytes, type IngestNode } from "./attachment-ingest";
import { buildAttachmentSummary } from "./chat-attachment-summary";
import { t } from "./i18n";

// Real ingest walks, not hand-built IngestNodes: the summary reads the
// diagnostics the walk writes into a mail's Markdown, so a hand-built fixture
// would pin this module against a shape the walk may not actually emit.

const CRLF = "\r\n";

function mail(boundary: string, body: string, parts: string[]): string {
  return [
    "Subject: S",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    body,
    "",
    ...parts.flatMap((p) => [`--${boundary}`, p, ""]),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

async function walk(source: string, fileName: string): Promise<IngestNode> {
  const res = await ingestBytes(new TextEncoder().encode(source), "message/rfc822", fileName);
  if (!res.ok) throw new Error(`ingest failed: ${res.error}`);
  return res.node;
}

describe("buildAttachmentSummary", () => {
  it("says nothing about a flat file that expanded into nothing", async () => {
    const res = await ingestBytes(new TextEncoder().encode("plain"), "text/plain", "notes.txt");
    if (!res.ok) throw new Error(res.error);
    expect(buildAttachmentSummary("en-US", "notes.txt", res.node)).toBeNull();
  });

  it("counts a mail's walked attachment", async () => {
    const node = await walk(
      mail("B", "body", [
        ['Content-Type: text/plain; name="a.txt"', 'Content-Disposition: attachment; filename="a.txt"', "", "alpha"].join(CRLF),
      ]),
      "m.eml",
    );
    expect(node.children).toHaveLength(1);
    expect(buildAttachmentSummary("en-US", "m.eml", node)).toBe(t("en-US", "chatAttachmentSummaryOne", "m.eml"));
  });

  // ★★★ THE CASE THE SUMMARY EXISTED FOR AND COULD NOT REACH. A mail whose
  // ONLY attachment was skipped has ZERO children, so the old `kids === 0`
  // early return fired BEFORE any skip was counted and the user was shown
  // nothing at all — while the model was handed a "skipped -" drop notice.
  // chatAttachmentSummarySkipped was therefore reachable only when some
  // SIBLING attachment had succeeded. This is the committed real fixture's
  // shape (msg-integration.test.ts: one unsupported smime.p7m).
  it("still discloses a skip when the mail's only attachment was skipped", async () => {
    const node = await walk(
      mail("B", "body", [
        [
          'Content-Type: application/pkcs7-mime; name="smime.p7m"',
          'Content-Disposition: attachment; filename="smime.p7m"',
          "",
          "AAAA",
        ].join(CRLF),
      ]),
      "signed.eml",
    );
    expect(node.children).toHaveLength(0);
    expect(buildAttachmentSummary("en-US", "signed.eml", node)).toBe(
      t("en-US", "chatAttachmentSummarySkipped", "signed.eml", "0", "1"),
    );
  });

  // ★★ A nested mail's own drops are written into THAT mail's block and are
  // never propagated up, so counting only the root reports 0 for every skip
  // below the first level — the root here has a child and no "skipped -" of
  // its own, which read as a clean "1 attachment".
  it("counts a skip that happened inside a nested mail", async () => {
    const inner = mail("IN", "inner body", [
      [
        'Content-Type: application/pkcs7-mime; name="smime.p7m"',
        'Content-Disposition: attachment; filename="smime.p7m"',
        "",
        "AAAA",
      ].join(CRLF),
    ]);
    const node = await walk(
      mail("OUT", "outer body", [
        ['Content-Type: message/rfc822; name="inner.eml"', 'Content-Disposition: attachment; filename="inner.eml"', "", inner].join(CRLF),
      ]),
      "outer.eml",
    );
    expect(node.children).toHaveLength(1);
    const rootMd = (node.block.source as { data: string }).data;
    expect(rootMd).not.toContain("skipped -");
    expect(buildAttachmentSummary("en-US", "outer.eml", node)).toBe(
      t("en-US", "chatAttachmentSummarySkipped", "outer.eml", "1", "1"),
    );
  });

  // A leaf's `data` is the extracted document itself, so prose that happens to
  // read like a drop notice must not be counted as one.
  it("does not count a leaf document whose own text reads 'skipped -'", async () => {
    const node = await walk(
      mail("B", "body", [
        [
          'Content-Type: text/plain; name="minutes.txt"',
          'Content-Disposition: attachment; filename="minutes.txt"',
          "",
          "Item 3 skipped - no owner present",
        ].join(CRLF),
      ]),
      "m.eml",
    );
    expect(buildAttachmentSummary("en-US", "m.eml", node)).toBe(t("en-US", "chatAttachmentSummaryOne", "m.eml"));
  });
});
