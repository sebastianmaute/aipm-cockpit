import { describe, it, expect, vi } from "vitest";
import {
  ingestBytes,
  ingestFile,
  MAX_INGEST_DEPTH,
  MAX_INGEST_NODES,
  MAX_NODE_EXTRACT_CHARS,
  MAX_TREE_EXTRACT_CHARS,
  MAX_BASE64_CHARS,
} from "./attachment-ingest";
import { MAX_ATTACHMENT_BYTES } from "./chat-attachments";
import { MAIL_BODY_FLOOR } from "./mail-extract";

/** Pass-through mock of `parseMail` — every test here keeps the REAL parser
 *  unless it flips this flag, so the mock cannot quietly hollow out the rest
 *  of the file. Only the "mail parser throws" test below sets it, and it
 *  resets it in a `finally`. */
const mailParser = vi.hoisted(() => ({ throwOnParse: false }));
vi.mock("./mail-extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mail-extract")>();
  return {
    ...actual,
    parseMail: (bytes: Uint8Array) => {
      if (mailParser.throwOnParse) throw new RangeError("crafted input");
      return actual.parseMail(bytes);
    },
  };
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("ingestBytes", () => {
  it("rejects an unsupported type", async () => {
    const r = await ingestBytes(enc("x"), "application/x-thing", "a.thing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported-type");
  });

  it("rejects an oversized file before reading it", async () => {
    const r = await ingestBytes(new Uint8Array(21 * 1024 * 1024), "text/plain", "big.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("too-large");
  });

  it("decodes text", async () => {
    const r = await ingestBytes(enc("hello"), "text/plain", "a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.kind).toBe("text");
      expect(r.node.block.source).toMatchObject({ type: "text", data: "hello" });
    }
  });

  it("routes html through the html extractor", async () => {
    const r = await ingestBytes(enc("<p>Hi</p><script>x()</script>"), "text/html", "a.html");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.kind).toBe("html");
      const src = r.node.block.source as { data: string };
      expect(src.data).toContain("Hi");
      expect(src.data).not.toContain("x()");
    }
  });

  it("base64-encodes a pdf without decoding it as text", async () => {
    const r = await ingestBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", "a.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ type: "base64", data: "JVBERg==" });
  });

  // ★★★ REGRESSION GUARD: THE TREE BASE64 BUDGET APPLIES BELOW THE ROOT ONLY.
  // MAX_BASE64_CHARS exists to stop ONE mail's many nested images/PDFs from
  // ballooning the prompt payload. Charged at the root too, it silently
  // became a second, much smaller file-size cap: bytesToBase64 emits
  // 4*ceil(n/3) chars, so 10,485,760 chars is exactly 7,864,320 decoded
  // bytes (7.50 MiB) — while checkAttachmentSize admits MAX_ATTACHMENT_BYTES
  // (20 MB) and i18n.ts tells the user "up to 20 MB each". Both callers turn
  // the resulting "budget-exhausted" into something worse than a size error:
  // chat-panel reports "could not be read", and the setup wizard throws and
  // abandons the whole import batch, discarding valid files already
  // collected. A root node's own size is already bounded by
  // checkAttachmentSize above.
  it("accepts a root-level pdf larger than the tree base64 budget's decoded equivalent", async () => {
    const size = 9 * 1024 * 1024;
    expect(size).toBeGreaterThan((MAX_BASE64_CHARS / 4) * 3); // past the old ceiling...
    expect(size).toBeLessThan(MAX_ATTACHMENT_BYTES); // ...and inside the advertised one
    const r = await ingestBytes(new Uint8Array(size), "application/pdf", "report.pdf");
    expect(r.ok).toBe(true);
    // The WHOLE payload, not a truncated one — base64 is opaque bytes, so a
    // short read would corrupt the document rather than shorten it.
    if (r.ok) expect((r.node.block.source as { data: string }).data.length).toBe(4 * Math.ceil(size / 3));
  });

  it("reports one node and no children for a flat file", async () => {
    const r = await ingestBytes(enc("hello"), "text/plain", "a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.children).toEqual([]);
  });

  // ★★★ REGRESSION GUARD: before this branch existed, "mail" fell through to
  // the base64 path (payloadFor's default) while buildAttachmentBlock's
  // "mail" branch treats `data` as pre-extracted Markdown — so a dropped
  // .eml silently sent the model a base64 blob presented as prose. Assert
  // BOTH that real header/body content comes through AND that the output
  // does not look like the base64 of the raw message.
  it("routes eml through the mail extractor to readable Markdown, not base64", async () => {
    const eml = [
      "Subject: Weekly status",
      "From: alice@example.com",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello team, the migration is done.",
    ].join("\r\n");
    const r = await ingestBytes(enc(eml), "message/rfc822", "status.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.kind).toBe("mail");
    const src = r.node.block.source as { type: string; data: string };
    expect(src.type).toBe("text");
    expect(src.data).toContain("**Subject:** Weekly status");
    expect(src.data).toContain("Hello team, the migration is done.");
    // The raw message contains no "@" once base64-encoded, and base64 of a
    // message this size is one unbroken run with no space or literal "@" —
    // the readable Markdown has both.
    expect(src.data).toContain("alice@example.com");
    expect(src.data).not.toMatch(/^[A-Za-z0-9+/=\s]+$/);
  });

  it("reports no children for a flat mail message", async () => {
    const eml = ["Subject: x", "", "body"].join("\r\n");
    const r = await ingestBytes(enc(eml), "message/rfc822", "x.eml");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.children).toEqual([]);
  });

  // ★★★ REGRESSION GUARD: buildAttachmentBlock passes an image's mimeType
  // straight into source.media_type (unlike every other kind, which builds a
  // fixed internal value) — an empty File.type (common on drag-drop) must not
  // reach it verbatim, or the API 400s on media_type: "". mimeForKind's old
  // `file.type || mimeForKind(kind)` fallback covered this before the
  // three-consumer refactor; this pins its replacement.
  it("falls back to a media_type derived from the extension when mimeType is empty", async () => {
    const r = await ingestBytes(new Uint8Array([1, 2, 3]), "", "photo.jpg");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ media_type: "image/jpeg" });
  });

  it("falls back to image/png for a mimeType-less .png", async () => {
    const r = await ingestBytes(new Uint8Array([1, 2, 3]), "", "photo.png");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ media_type: "image/png" });
  });

  // Control: a NON-empty (if wrong) mimeType is passed through unchanged —
  // the fallback only fires on "", matching the old `||` semantics exactly.
  it("does not override a present (even if wrong) image mimeType", async () => {
    const r = await ingestBytes(new Uint8Array([1, 2, 3]), "image/gif", "photo.jpg");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ media_type: "image/gif" });
  });
});

describe("ingestFile", () => {
  // ★★★ REGRESSION GUARD: ingestFile must classify BEFORE reading the file's
  // bytes — both old callers ordered it size -> classify -> read. Reading
  // first meant a large unsupported file was fully loaded into memory before
  // being rejected, and a read failure on a would-be-unsupported file
  // surfaced as "read-failed" instead of "unsupported-type" — the wizard's
  // batch loop treats those two very differently (drop-and-continue vs.
  // abandon-the-whole-batch).
  it("classifies before reading — an unsupported file's bytes are never read", async () => {
    const file = new File(["x"], "bad.exe", { type: "application/x-msdownload" });
    let readCalled = false;
    file.arrayBuffer = () => {
      readCalled = true;
      return Promise.reject(new Error("should not be called"));
    };
    const r = await ingestFile(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported-type");
    expect(readCalled).toBe(false);
  });

  it("still reads a supported file's bytes", async () => {
    const file = new File(["hello"], "a.txt", { type: "text/plain" });
    const r = await ingestFile(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ type: "text", data: "hello" });
  });
});

const CRLF = "\r\n";
const mail = (lines: string[]) => new TextEncoder().encode(lines.join(CRLF));
const b64 = (s: string) => btoa(s);

/** An .eml carrying N text attachments of the given size.
 *
 *  ★★★ `boundary` MUST be unique whenever a mail built here is embedded
 *  RAW inside another one (a message/rfc822 attachment) — the outer
 *  parser's boundary scan has no concept of "nested message", it just
 *  looks for literal `CRLF--<boundary>` text, so an inner message reusing
 *  the SAME boundary as its outer envelope corrupts the outer split the
 *  moment the inner message's own `--B` lines appear in the outer body.
 *  This is not a parser bug — RFC 2046 requires a boundary to not occur in
 *  any part's content, and a fixture nesting `mailWith(...)` inside
 *  `mailWith(...)` at the default boundary violates exactly that. */
function mailWith(atts: { name: string; body: string }[], bodyText = "mail body", boundary = "B"): Uint8Array {
  const parts = atts.flatMap((a) => [
    `--${boundary}`, `Content-Type: text/plain; name="${a.name}"`,
    `Content-Disposition: attachment; filename="${a.name}"`,
    "Content-Transfer-Encoding: base64", "", b64(a.body),
  ]);
  return mail([
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "Subject: Test", "",
    `--${boundary}`, "Content-Type: text/plain", "", bodyText, ...parts, `--${boundary}--`, "",
  ]);
}

describe("mail recursion", () => {
  it("ingests a mail and its attachments as a tree", async () => {
    const r = await ingestBytes(mailWith([{ name: "a.txt", body: "alpha" }]), "message/rfc822", "m.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.kind).toBe("mail");
    expect(r.node.children).toHaveLength(1);
    expect(r.node.children[0].fileName).toBe("a.txt");
    const src = r.node.children[0].block.source as { data: string };
    expect(src.data).toBe("alpha");
  });

  // ★★ WHAT THIS ACTUALLY PROVES, which is less than its name used to claim:
  // every DIRECT attachment of a mail becomes a child — in the order
  // mime-parse.ts produced them — even when one of those attachments is
  // itself a mail with its own nested attachment. It does NOT witness
  // breadth-first anything: no traversal order changes this list, so a
  // depth-first mutant passes it unchanged. The guarantee the module header
  // is really about is budget ALLOCATION, and the equal-shares test below
  // ("divides the tree budget into comparable shares…") is what covers it.
  it("admits every direct attachment as a child, in source order, even beside a nested mail", async () => {
    // Distinct boundaries at each nesting level — see mailWith's doc comment.
    const inner = mailWith([{ name: "deep.txt", body: "deep" }], "inner body", "INNER");
    const outer = mail([
      'Content-Type: multipart/mixed; boundary="B"', "Subject: Outer", "",
      "--B", "Content-Type: text/plain", "", "outer body",
      "--B", 'Content-Type: message/rfc822; name="inner.eml"',
      'Content-Disposition: attachment; filename="inner.eml"', "", new TextDecoder().decode(inner),
      "--B", 'Content-Type: text/plain; name="sibling.txt"',
      'Content-Disposition: attachment; filename="sibling.txt"', "", "sibling",
      "--B--", "",
    ]);
    const r = await ingestBytes(outer, "message/rfc822", "outer.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children.map((c) => c.fileName)).toEqual(["inner.eml", "sibling.txt"]);
  });

  // ★★ SECURITY + DISCLOSURE.
  it("stops at the depth cap and discloses it", async () => {
    // Distinct boundaries at each nesting level — see mailWith's doc comment.
    let cur = mailWith([{ name: "leaf.txt", body: "leaf" }], "mail body", "B_leaf");
    for (let i = 0; i < MAX_INGEST_DEPTH + 2; i++) {
      const boundary = `B${i}`;
      cur = mail([
        `Content-Type: multipart/mixed; boundary="${boundary}"`, `Subject: L${i}`, "",
        `--${boundary}`, "Content-Type: text/plain", "", "body",
        `--${boundary}`, 'Content-Type: message/rfc822; name="n.eml"',
        'Content-Disposition: attachment; filename="n.eml"', "", new TextDecoder().decode(cur),
        `--${boundary}--`, "",
      ]);
    }
    const r = await ingestBytes(cur, "message/rfc822", "deep.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = JSON.stringify(r.node);
    expect(all).toContain("nesting depth limit");
  });

  // ★★ DISCLOSURE. Reaching the depth cap must not erase what the model is
  // TOLD the mail contained — only the recursion into it is skipped, not
  // the attachment-list summary. Walks the tree to find the exact node that
  // hit the cap (children.length === 0 with the depth-limit note) and
  // checks THAT node's own rendered block, not just the tree as a whole —
  // every level in this chain has exactly one attachment, so a bare
  // substring search over the full JSON couldn't tell a fixed node from a
  // coincidence at another depth.
  it("still discloses its own attachment list at the depth cap, only the recursion stops", async () => {
    let cur = mailWith([{ name: "leaf.txt", body: "leaf" }], "mail body", "B_leaf");
    for (let i = 0; i < MAX_INGEST_DEPTH + 2; i++) {
      const boundary = `B${i}`;
      cur = mail([
        `Content-Type: multipart/mixed; boundary="${boundary}"`, `Subject: L${i}`, "",
        `--${boundary}`, "Content-Type: text/plain", "", "body",
        `--${boundary}`, 'Content-Type: message/rfc822; name="n.eml"',
        'Content-Disposition: attachment; filename="n.eml"', "", new TextDecoder().decode(cur),
        `--${boundary}--`, "",
      ]);
    }
    const r = await ingestBytes(cur, "message/rfc822", "deep.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    type Node = typeof r.node;
    function findCappedNode(node: Node): Node | undefined {
      const data = (node.block.source as { data: string }).data;
      if (node.children.length === 0 && data.includes("nesting depth limit")) return node;
      for (const c of node.children) {
        const found = findCappedNode(c);
        if (found) return found;
      }
      return undefined;
    }
    const capped = findCappedNode(r.node);
    expect(capped).toBeDefined();
    if (!capped) return;
    const data = (capped.block.source as { data: string }).data;
    expect(data).toContain("**Attachments (1):**");
    expect(data).toContain("n.eml (message/rfc822)");
  });

  it("stops at the node cap and discloses it", async () => {
    const atts = Array.from({ length: MAX_INGEST_NODES + 10 }, (_, i) => ({ name: `f${i}.txt`, body: "x" }));
    const r = await ingestBytes(mailWith(atts), "message/rfc822", "many.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children.length).toBeLessThanOrEqual(MAX_INGEST_NODES);
    expect(JSON.stringify(r.node)).toContain("omitted");
  });

  // ★★★ CRITICAL REGRESSION GUARD. A large attachment-list PREFIX (headers +
  // "Attachments (N):" summary) used to be capped as part of the SAME string
  // as the body and its diagnostics, so a mail with enough attachments could
  // exhaust the whole ceiling before the body — the thread's own words — was
  // ever reached, and take the node-limit disclosure down with it. The
  // prefix must be what gets trimmed; the body and the disclosure that
  // attachments were dropped must always survive.
  it("keeps the body AND the node-limit diagnostic even when the attachment list is huge", async () => {
    // 200 attachments with near-500-char filenames (close to
    // MAX_HEADER_FIELD_CHARS): the rendered attachment-list PREFIX alone
    // comes out to ~84,000 chars — comfortably past the ~20,000-char
    // ceiling this mail ends up with once its 50 admitted attachments (each
    // with a body oversized relative to its equal share, so every one
    // spends its whole allocation) have exhausted the rest of the budget.
    // A short-filename fixture (e.g. "s0.txt") is NOT adversarial enough to
    // exercise this: at ~4.5k chars total, its prefix fits the ceiling on
    // its own and the bug this test guards never triggers either way.
    const atts = Array.from({ length: 200 }, (_, i) => ({
      name: `${"f".repeat(400)}${i}.txt`,
      body: "y".repeat(50_000),
    }));
    const r = await ingestBytes(mailWith(atts, "IMPORTANT BODY MARKER"), "message/rfc822", "root.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = (r.node.block.source as { data: string }).data;
    expect(data).toContain("IMPORTANT BODY MARKER");
    expect(data).toContain("150 of 200 attachments omitted - node limit");
  });

  it("shares one output budget across the whole tree", async () => {
    const big = "y".repeat(300_000);
    const r = await ingestBytes(
      mailWith([{ name: "a.txt", body: big }, { name: "b.txt", body: big }, { name: "c.txt", body: big }]),
      "message/rfc822", "big.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const total = JSON.stringify(r.node).length;
    expect(total).toBeLessThan(MAX_TREE_EXTRACT_CHARS * 1.2);
  });

  it("keeps the body floor even when attachments are large", async () => {
    const big = "y".repeat(300_000);
    const r = await ingestBytes(
      mailWith([{ name: "a.txt", body: big }], "IMPORTANT BODY MARKER"),
      "message/rfc822", "b.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const src = r.node.block.source as { data: string };
    expect(src.data).toContain("IMPORTANT BODY MARKER");
  });

  it("keeps the mail when one attachment is corrupt", async () => {
    const r = await ingestBytes(
      mailWith([{ name: "ok.txt", body: "fine" }, { name: "bad.thing", body: "??" }]),
      "message/rfc822", "m.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children.some((c) => c.fileName === "ok.txt")).toBe(true);
    expect(JSON.stringify(r.node)).toContain("bad.thing");
  });

  // ★★★ EVIDENCE THE SPLIT IS GENUINELY BREADTH-FIRST (equal shares), NOT
  // JUST "bounded total" or "order-preserving". A single large attachment
  // can't demonstrate this — MAX_NODE_EXTRACT_CHARS (200k) already stops any
  // ONE node from eating the whole 400k tree budget, fair division or not.
  // Four large siblings does: a GREEDY first-come-first-served walk (each
  // child spends up to MAX_NODE_EXTRACT_CHARS from whatever is left, in
  // order) would give child 1 the full 200k cap, child 2 the ~180k
  // remainder, and leave children 3 and 4 with ~0. Equal-share division with
  // carry-forward instead gives all four a comparable slice of the ~380k
  // pool left after the body's floor is reserved (~95k each) — none capped
  // by MAX_NODE_EXTRACT_CHARS, none starved.
  it("divides the tree budget into comparable shares across many large siblings, not first-come-first-served", async () => {
    const big = "y".repeat(300_000);
    const atts = ["a", "b", "c", "d"].map((n) => ({ name: `${n}.txt`, body: big }));
    const r = await ingestBytes(mailWith(atts), "message/rfc822", "fair.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lengths = r.node.children.map((c) => (c.block.source as { data: string }).data.length);
    // What the shares actually came out as (recorded for the report, not
    // just asserted): every share is well clear of empty...
    for (const len of lengths) expect(len).toBeGreaterThan(50_000);
    // ...none hit the per-node cap (which would signal one child was left
    // free to spend far more than an equal share)...
    for (const len of lengths) expect(len).toBeLessThan(150_000);
    // ...and no child's share dwarfs another's — a >3x spread is what a
    // greedy walk (200k / 180k / ~0 / ~0) would look like.
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(3);
  });

  // ★★★ IMPORTANT REGRESSION GUARD. MAX_TREE_EXTRACT_CHARS deliberately does
  // NOT bound base64 document payloads (pdf/image) — they reach the model
  // as document/image blocks, not extracted text, so charging them against
  // a cap sized for prose would break ordinary PDF/image attachments
  // outright. But that leaves base64 payloads with NO bound at all unless
  // something else covers them: MAX_BASE64_CHARS is that something —
  // 30 attachments each encoding to exactly 400,000 base64 chars
  // (300,000 decoded bytes) sum to 12,000,000, comfortably past the
  // 10,485,760-char cap, so some must be rejected rather than all included.
  it("degrades a mail carrying too many PDFs instead of ballooning the base64 payload unbounded", async () => {
    const pdfBytes = new Uint8Array(300_000).fill(0x41);
    const pdfB64 = Buffer.from(pdfBytes).toString("base64");
    const parts = Array.from({ length: 30 }, (_, i) => [
      "--B", `Content-Type: application/pdf; name="p${i}.pdf"`,
      `Content-Disposition: attachment; filename="p${i}.pdf"`,
      "Content-Transfer-Encoding: base64", "", pdfB64,
    ]).flat();
    const outer = mail([
      'Content-Type: multipart/mixed; boundary="B"', "Subject: PDFs", "",
      "--B", "Content-Type: text/plain", "", "see attached", ...parts, "--B--", "",
    ]);
    const r = await ingestBytes(outer, "message/rfc822", "pdfs.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Not all 30 were admitted...
    expect(r.node.children.length).toBeLessThan(30);
    // ...the sum of what WAS admitted never exceeds the base64 budget...
    const base64Total = r.node.children.reduce(
      (sum, c) => sum + (c.block.source as { data: string }).data.length,
      0,
    );
    expect(base64Total).toBeLessThanOrEqual(MAX_BASE64_CHARS);
    // ...and the drop is disclosed, not silent.
    expect((r.node.block.source as { data: string }).data).toContain("budget-exhausted");
  });

  // ★★★ IMPORTANT REGRESSION GUARD. mail-extract.ts's header comment claims
  // its renderer "bounds every field it prints" — but a "skipped" diagnostic
  // built in attachment-ingest.ts interpolates an attacker-controlled
  // filename directly. Without truncateField, a hostile 30,000-char
  // filename reaches the model verbatim inside that diagnostic string.
  it("truncates an attacker-controlled filename before it reaches a skipped-attachment diagnostic", async () => {
    const longName = `${"n".repeat(30_000)}.weird`;
    const outer = mail([
      'Content-Type: multipart/mixed; boundary="B"', "Subject: LongName", "",
      "--B", "Content-Type: text/plain", "", "body",
      "--B", `Content-Type: application/octet-stream; name="${longName}"`,
      `Content-Disposition: attachment; filename="${longName}"`,
      "Content-Transfer-Encoding: base64", "", b64("x"),
      "--B--", "",
    ]);
    const r = await ingestBytes(outer, "message/rfc822", "m.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = (r.node.block.source as { data: string }).data;
    expect(data).not.toContain("n".repeat(30_000));
    expect(data).toContain("…");
  });

  // ★★★ REGRESSION GUARD: MAIL_BODY_FLOOR IS A FLOOR, NOT A CEILING.
  // mail-extract.ts documents it as the minimum a body keeps under budget
  // pressure; attachment-ingest passed it straight through as
  // renderMailParts' bodyBudget, which is the argument that TRUNCATES. So
  // every mail body was cut at 20,000 characters however much of the
  // 400,000-character ceiling was free — a plain .eml with no attachments
  // left 380,000 unspent and told the model its body "exceeded its share of
  // the extraction budget" when nothing had competed for it.
  it("does not truncate an uncontested mail body at the body floor", async () => {
    const body = "z".repeat(150_000);
    // Comfortably past the floor, and inside the per-node cap — so the only
    // thing that could cut this body is the defect.
    expect(body.length).toBeGreaterThan(MAIL_BODY_FLOOR);
    expect(body.length).toBeLessThan(MAX_NODE_EXTRACT_CHARS);
    const r = await ingestBytes(
      mail(["Content-Type: text/plain", "Subject: Long", "", body, ""]),
      "message/rfc822",
      "long.eml",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = (r.node.block.source as { data: string }).data;
    expect(data).toContain(body);
    expect(data).not.toContain("exceeded its share");
  });

  // ★★★ THE PROPERTY THE FLOOR EXISTS FOR — and the half that a "let an
  // uncontested body use the free room" fix is most likely to destroy while
  // the test above goes green. Four 300,000-char attachments really do
  // compete for the tree budget here (the equal-shares test above pins that
  // they each get ~95k of it), so the body's share is genuinely contested
  // and only the reservation keeps it from being squeezed out.
  // ★★ WHICH reservation, and the narrower reading: this pins `ingestNode`'s
  // `bodyShare`. It does NOT discriminate `renderMailBlock`'s
  // `Math.max(bodyFloor, …)` clamp, which the assertion below survives.
  it("still reserves the body floor when many large attachments compete for the budget", async () => {
    const atts = ["a", "b", "c", "d"].map((n) => ({ name: `${n}.txt`, body: "y".repeat(300_000) }));
    const r = await ingestBytes(mailWith(atts, "z".repeat(300_000)), "message/rfc822", "contested.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.children).toHaveLength(4);
    const data = (r.node.block.source as { data: string }).data;
    const kept = Math.max(...(data.match(/z+/g) ?? [""]).map((m) => m.length));
    // Measured 19,897 both before and after the floor fix. The shortfall
    // from 20,000 is what the assembled block's own backstop truncation note
    // costs; asserting the exact figure would pin that note's wording rather
    // than the reservation, so this asserts the reservation held to within
    // one note's length.
    expect(kept).toBeGreaterThan(MAIL_BODY_FLOOR - 500);
  });

  // ★★★ DEFENCE IN DEPTH. The flat-file branch wraps its extractor in
  // try/catch; the mail branch's `parseMail` call sat outside one, and
  // neither ingestBytes nor ingestFile adds a guard. A throw from anywhere in
  // the mail parser stack therefore REJECTED the promise instead of
  // returning an IngestResult — in chat-panel an unhandled rejection that
  // drops the whole file selection with no error shown. This was reachable
  // for real until cfbf.ts's two RangeError paths on crafted .msg input were
  // fixed; it stays guarded regardless, because this is a hostile-input
  // parser stack whose no-throw contract is a claim about the code, not a
  // guarantee of the language.
  it("returns read-failed instead of rejecting when the mail parser throws", async () => {
    mailParser.throwOnParse = true;
    try {
      const r = await ingestBytes(mailWith([{ name: "a.txt", body: "alpha" }]), "message/rfc822", "m.eml");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("read-failed");
    } finally {
      mailParser.throwOnParse = false;
    }
  });
});
