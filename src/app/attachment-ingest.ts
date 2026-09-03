// src/app/attachment-ingest.ts — the ONE read/classify/extract pipeline.
//
// ★★★ THREE CONSUMERS CALL THIS AND NONE MAY REIMPLEMENT IT: chat-panel.tsx,
// step0-import-panel.tsx and anything added later. They each carried their own
// copy once, and the copies drifted — the wizard silently rejected six token
// classes the assistant accepted. A dropped .eml is a TREE (mail can attach
// mail, which can attach mail), so this module also drives the recursive walk
// under ONE shared budget (chars / bytes / nodes / depth) — three separate
// tree walks with three separate budgets is not a thing anyone should
// maintain.
//
// ★★★ THE WALK IS BREADTH-FIRST BY CONSTRUCTION, not merely by test. A mail
// node reserves a node-count slot for EVERY direct attachment
// (`admitted = attachments.slice(0, nodesRemaining)`) BEFORE recursing into
// any of them, and divides what's left of its OWN character ceiling among
// them in equal shares with carry-forward. A depth-first "spend as you
// recurse" walk would let the first attached mail's whole subtree consume
// the shared budget before a sibling attachment is even admitted into the
// tree. `mail-extract.ts` / `eml-extract.ts` / `mime-parse.ts` stay pure,
// value-to-value parsers that never recurse — recursion lives here alone.

import {
  classifyAttachment,
  checkAttachmentSize,
  buildAttachmentBlock,
  type AttachmentKind,
  type AttachmentBlock,
  type AttachmentError,
} from "./chat-attachments";
import { officeKindOf, extractOfficeMarkdown } from "./office-extract";
import { extractHtmlMarkdown } from "./html-extract";
import { bytesToBase64 } from "./base64";
import { parseMail, renderMailParts, MAIL_BODY_FLOOR, truncateField, type ParsedMail } from "./mail-extract";

export type IngestNode = {
  fileName: string;
  kind: AttachmentKind;
  block: AttachmentBlock;
  /** Nested attachments, for mail. Empty for every flat file. */
  children: IngestNode[];
};

export type IngestResult =
  | { ok: true; node: IngestNode }
  | { ok: false; error: AttachmentError | "read-failed" | "encrypted" | "budget-exhausted" };

/** Fallback `media_type` for an image whose `File.type` is empty — common on
 *  drag-drop. buildAttachmentBlock passes an image's mimeType straight into
 *  `source.media_type` (every other kind builds a fixed value instead), so an
 *  empty mimeType would otherwise emit `media_type: ""` and the API 400s.
 *  classifyAttachment can only reach "image" via this same extension set when
 *  mimeType does not start with "image/" (chat-attachments.ts's
 *  IMAGE_EXTENSIONS / SUPPORTED_IMAGE_MIMES), so this always resolves when it
 *  fires. */
const IMAGE_EXT_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function imageMimeFallback(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return IMAGE_EXT_MIME[ext] ?? null;
}

/** Extract one file's model-facing payload. Bytes in, `data` for
 *  buildAttachmentBlock out. Mail is NOT handled here — `ingestNode` below
 *  branches on "mail" before ever reaching this function, because a mail's
 *  payload is a whole subtree (its own rendered body PLUS its walked
 *  attachments), not a single string this signature can return. */
async function payloadFor(
  kind: Exclude<AttachmentKind, "mail">,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> {
  if (kind === "office") {
    const fmt = officeKindOf(mimeType, fileName);
    if (!fmt) throw new Error("unknown office format");
    return extractOfficeMarkdown(bytes, fmt);
  }
  if (kind === "html") return extractHtmlMarkdown(new TextDecoder().decode(bytes));
  if (kind === "text") return new TextDecoder().decode(bytes);
  return bytesToBase64(bytes);
}

// ---------------------------------------------------------------------------
// The shared extraction budget
// ---------------------------------------------------------------------------

/** No single node's own rendered text may exceed this, however much of the
 *  tree budget is still unspent — otherwise one attachment (or one mail's
 *  own body) could still eat almost the whole tree budget by itself. */
export const MAX_NODE_EXTRACT_CHARS = 200_000;

/** Total EXTRACTED-TEXT output across the whole tree (~100k tokens), shared
 *  by every text-bearing node — leaves and mail bodies alike. Deliberately
 *  does NOT bound base64 document payloads: a pdf/image attachment reaches
 *  the model as a document/image content block, not as extracted text, so
 *  charging it against a cap sized for prose would break ordinary PDF/image
 *  attachments outright. Those are bounded separately, by
 *  MAX_BASE64_CHARS below. */
export const MAX_TREE_EXTRACT_CHARS = 400_000;

/** Tree-wide cap on base64 PAYLOAD characters (pdf/image attachments),
 *  independent of MAX_TREE_EXTRACT_CHARS above — see that constant's
 *  comment for why base64 needs its own budget rather than sharing the
 *  extracted-text one. 10MB of base64 is ~7.5MB of decoded bytes; a mail
 *  carrying many images/PDFs degrades attachment-by-attachment (later ones
 *  reported "budget-exhausted") instead of ballooning the prompt payload
 *  unbounded. MAX_DECODED_BYTES (64MB) is far too loose to serve this
 *  purpose on its own — it bounds decode work, not model-facing payload. */
export const MAX_BASE64_CHARS = 10 * 1024 * 1024;

/** mail -> attached mail -> attached mail -> attached mail is where walking
 *  stops; the node AT this depth still renders, but its own attachments are
 *  never admitted. */
export const MAX_INGEST_DEPTH = 3;

/** Total attachment nodes across the whole tree — the root itself consumes
 *  no slot (ingesting one mail with 50 admitted attachments is 51 nodes
 *  total: the root plus 50). 50 attachments is already an attack or a
 *  mistake for anything a person actually sends. */
export const MAX_INGEST_NODES = 50;

/** Cumulative DECODED bytes across the whole tree. checkAttachmentSize's
 *  20MB cap bounds a single file; this bounds many individually-small-enough
 *  attachments from adding up to something huge. Deliberately conservative:
 *  a nested mail's bytes are a SUBSET of its parent's raw bytes, already
 *  charged once at the parent's own level, so the same underlying bytes are
 *  charged again every time they're re-decoded one level deeper. Don't
 *  "fix" that into a single per-byte charge — it would let a message widen
 *  the real ceiling simply by nesting deeper, which is the opposite of what
 *  the depth cap is for. */
export const MAX_DECODED_BYTES = 64 * 1024 * 1024;

/** Mutated in place through the whole walk — NEVER cloned per child. Cloning
 *  it would break "shared": a child would spend from its own copy and the
 *  deduction would never reach back up to a sibling or a cousin, so a
 *  tree-wide cap would only ever bound one branch at a time instead of the
 *  whole tree. */
type Budget = {
  charsRemaining: number;
  bytesRemaining: number;
  base64Remaining: number;
  nodesRemaining: number;
};

/** Scoped to ONE `ingestBytes` call, not shared across a multi-file drop —
 *  ten files dropped together each get their own full budget, not a tenth
 *  each. A whole-batch ceiling, if one is ever wanted, belongs in the
 *  caller (chat-panel.tsx / step0-import-panel.tsx), which already loops
 *  over the file list one `ingestFile`/`ingestBytes` call at a time. */
function newBudget(): Budget {
  return {
    charsRemaining: MAX_TREE_EXTRACT_CHARS,
    bytesRemaining: MAX_DECODED_BYTES,
    base64Remaining: MAX_BASE64_CHARS,
    nodesRemaining: MAX_INGEST_NODES,
  };
}

const TRUNCATION_NOTE = "\n\n_(truncated - exceeded the extraction budget)_";

/** Spends from the ONE shared `budget.charsRemaining`, capped further by
 *  `ceiling` — the caller's local ceiling on how much of that shared pool
 *  THIS text may use. `ceiling` is what makes the equal-share breadth-first
 *  split in `ingestNode` bite: a child cannot out-spend the share it was
 *  handed even while the global pool still has room left over.
 *
 *  The returned string's length is always exactly what gets deducted — a
 *  truncated result is sliced SHORT of `room` by `TRUNCATION_NOTE.length`
 *  first, so appending the note lands back on `room`, not `room +
 *  TRUNCATION_NOTE.length`. An earlier version deducted `room` but returned
 *  `room + TRUNCATION_NOTE.length`, silently under-charging the shared pool
 *  by the note's length on every truncation. */
function cap(text: string, ceiling: number, budget: Budget): string {
  const room = Math.max(0, Math.min(ceiling, MAX_NODE_EXTRACT_CHARS, budget.charsRemaining));
  if (text.length <= room) {
    budget.charsRemaining -= text.length;
    return text;
  }
  const sliceLen = Math.max(0, room - TRUNCATION_NOTE.length);
  const truncated = `${text.slice(0, sliceLen)}${TRUNCATION_NOTE}`;
  budget.charsRemaining -= truncated.length;
  return truncated;
}

/** Trims a mail's rendered PREFIX (headers + attachment-list summary) to
 *  fit `maxLen` — never the body or its diagnostics, which are reserved
 *  before this is ever called and passed through untouched. Does not touch
 *  `budget`: `renderMailBlock` below makes exactly one deduction, via `cap`
 *  on the fully-assembled string, so there is one bookkeeping site per mail
 *  render, not two racing to charge the same characters. */
function trimPrefixToFit(prefix: string, maxLen: number): string {
  if (prefix.length <= maxLen) return prefix;
  const room = Math.max(0, maxLen - TRUNCATION_NOTE.length);
  return `${prefix.slice(0, room)}${TRUNCATION_NOTE}`;
}

/** Assembles one mail's rendered block. Reserves room for the body and its
 *  diagnostics FIRST, then fits the prefix (headers + attachment-list
 *  summary — the only piece safe to trim; it's a summary, not the thread's
 *  own words) into whatever is left of `ceiling`. `cap()` on the fully
 *  assembled string is a BACKSTOP, not the mechanism doing the cutting: in
 *  the ordinary case the prefix has already been trimmed to make everything
 *  fit, so `cap()` just charges the shared pool for the exact length
 *  emitted. It only truncates for real when diagnostics + body ALONE
 *  already exceed `ceiling` (prefix trimmed to nothing and still over) —
 *  and because diagnostics are concatenated BEFORE the body, that rare
 *  backstop truncation lands on the body, never on a drop notice. */
function renderMailBlock(mail: ParsedMail, bodyBudget: number, ceiling: number, budget: Budget): string {
  const { prefix, diagnostics, body } = renderMailParts(mail, bodyBudget);
  const tail = [diagnostics, body].filter((s) => s.length > 0).join("\n\n");
  const reserved = tail.length + (tail.length > 0 ? 2 : 0);
  const trimmedPrefix = trimPrefixToFit(prefix, Math.max(0, ceiling - reserved));
  const assembled = [trimmedPrefix, tail].filter((s) => s.length > 0).join("\n\n");
  return cap(assembled, ceiling, budget);
}

/**
 * One node of the walk: a flat file returns immediately; a mail renders its
 * own Markdown and recurses into its attachments, breadth-first.
 *
 * `ceiling` bounds this node's OWN combined output — its rendered block plus
 * everything under it — separately from `budget.charsRemaining`, the single
 * tree-wide pool every node actually draws from. The invariant that makes
 * the split correct is `ceiling <= budget.charsRemaining` on every call
 * (true at the root, where they start equal, and preserved by every call
 * site below, which always intersects a computed share with the live
 * `budget.charsRemaining` before handing it down). That invariant is what
 * lets a mail reserve `bodyShare` of `ceiling` for its own body BEFORE
 * dividing the rest among its children: the children are structurally
 * capped to spend at most `ceiling - bodyShare` of the shared pool between
 * them, so at least `bodyShare` of the shared pool is still there once it's
 * the body's own turn to be capped, however much of the shared pool
 * remained when this node started.
 */
async function ingestNode(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
  depth: number,
  budget: Budget,
  ceiling: number,
): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(bytes.byteLength);
  if (sizeErr) return { ok: false, error: sizeErr };
  // "budget-exhausted", not "too-large" — "too-large" (above) means THIS
  // FILE alone exceeds the fixed 20MB per-attachment cap; this means the
  // TREE has already spent its 64MB decoded-byte allowance on other nodes.
  // A 1KB file failing this for the same reason a 21MB file fails the check
  // above would be a confusing, wrong-cause error message.
  if (bytes.byteLength > budget.bytesRemaining) return { ok: false, error: "budget-exhausted" };
  budget.bytesRemaining -= bytes.byteLength;

  const kind = classifyAttachment(mimeType, fileName);
  if (!kind) return { ok: false, error: "unsupported-type" };

  if (kind !== "mail") {
    try {
      const raw = await payloadFor(kind, bytes, mimeType, fileName);
      const outputMime =
        kind === "image" && mimeType.trim() === "" ? (imageMimeFallback(fileName) ?? mimeType) : mimeType;
      if (kind === "pdf" || kind === "image") {
        // Base64 payloads are opaque bytes for the model, not extracted
        // text — MAX_TREE_EXTRACT_CHARS deliberately excludes them (see its
        // comment), so they draw from their OWN tree-wide budget instead of
        // `cap()`'s chars pool.
        if (raw.length > budget.base64Remaining) return { ok: false, error: "budget-exhausted" };
        budget.base64Remaining -= raw.length;
        return {
          ok: true,
          node: { fileName, kind, block: buildAttachmentBlock(kind, outputMime, raw), children: [] },
        };
      }
      const data = cap(raw, ceiling, budget);
      return {
        ok: true,
        node: { fileName, kind, block: buildAttachmentBlock(kind, outputMime, data), children: [] },
      };
    } catch {
      return { ok: false, error: "read-failed" };
    }
  }

  // --- mail: reserve the body's floor, then walk its attachments breadth-first ---
  const mail = parseMail(bytes);
  const notes: string[] = [...mail.diagnostics];

  if (depth >= MAX_INGEST_DEPTH) {
    notes.push(`attachment "${truncateField(fileName)}" not expanded further - nesting depth limit`);
    // Keeps `mail.attachments` (NOT overridden to []) — the model still
    // learns what this mail contained even though it isn't walked further;
    // only the recursion is skipped, not the disclosure.
    const md = renderMailBlock({ ...mail, diagnostics: notes }, MAIL_BODY_FLOOR, ceiling, budget);
    return {
      ok: true,
      node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, md), children: [] },
    };
  }

  // Reserve a node slot for EVERY direct attachment before recursing into
  // any of them — this is what stops the first attachment's own subtree
  // (itself possibly a mail with many attachments) from exhausting the
  // shared node budget before a later sibling of THIS mail is even admitted
  // into the tree.
  const admitted = mail.attachments.slice(0, Math.max(0, budget.nodesRemaining));
  if (admitted.length < mail.attachments.length) {
    notes.push(
      `${mail.attachments.length - admitted.length} of ${mail.attachments.length} attachments omitted - node limit`,
    );
  }
  budget.nodesRemaining -= admitted.length;

  // The body's floor is reserved out of THIS node's ceiling first, so a
  // large attachment can never erase the thread and a long thread can never
  // starve its own attachments.
  const bodyShare = Math.max(0, Math.min(MAIL_BODY_FLOOR, ceiling, budget.charsRemaining));
  let childrenCeiling = Math.max(0, ceiling - bodyShare);

  const children: IngestNode[] = [];
  let left = admitted.length;
  for (const a of admitted) {
    // Equal shares of what's left, recomputed every iteration: an early
    // child that spends less than its share leaves the remainder for later
    // siblings (carry-forward); one that spends its whole share never dips
    // into what a later sibling was promised.
    const pool = Math.min(childrenCeiling, budget.charsRemaining);
    const share = left > 0 ? Math.floor(pool / left) : 0;
    left -= 1;

    const before = budget.charsRemaining;
    const child = await ingestNode(a.bytes, a.mimeType, a.fileName, depth + 1, budget, share);
    const spent = before - budget.charsRemaining;
    childrenCeiling = Math.max(0, childrenCeiling - spent);

    if (child.ok) {
      children.push(child.node);
    } else {
      notes.push(`attachment "${truncateField(a.fileName)}" skipped - ${child.error}`);
    }
  }

  // Re-rendered AFTER children so a skipped-child diagnostic reaches the
  // model. `finalCeiling` is `bodyShare + childrenCeiling` — the reserved
  // body share plus whatever of the children's allocation went unspent —
  // which is always >= bodyShare (see the function doc comment). Building
  // the block via renderMailBlock (not a raw cap() over the whole rendered
  // string) is what makes that reservation real: it trims the headers/
  // attachment-list PREFIX to fit, rather than truncating the concatenated
  // whole from the tail and risking the body or a drop notice instead.
  const finalCeiling = bodyShare + childrenCeiling;
  const finalMd = renderMailBlock({ ...mail, diagnostics: notes }, bodyShare, finalCeiling, budget);
  return {
    ok: true,
    node: { fileName, kind, block: buildAttachmentBlock(kind, mimeType, finalMd), children },
  };
}

export async function ingestBytes(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<IngestResult> {
  const budget = newBudget();
  return ingestNode(bytes, mimeType, fileName, 0, budget, budget.charsRemaining);
}

/** Browser entry point. Classifies (cheap) before reading the File's bytes
 *  so a large unsupported file is rejected without being loaded into memory,
 *  and so a read failure on a file that would have classified as unsupported
 *  still surfaces as "unsupported-type" rather than "read-failed" — the
 *  wizard treats those two very differently (drop-and-continue vs.
 *  abandon-the-batch). Then defers to ingestBytes so both paths share one
 *  implementation — the wizard already had a bytes-oriented path and the
 *  assistant a File-oriented one, and they had diverged. ingestBytes
 *  re-classifies, which costs nothing. */
export async function ingestFile(file: File): Promise<IngestResult> {
  const sizeErr = checkAttachmentSize(file.size);
  if (sizeErr) return { ok: false, error: sizeErr };
  const kind = classifyAttachment(file.type, file.name);
  if (!kind) return { ok: false, error: "unsupported-type" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "read-failed" };
  }
  return ingestBytes(bytes, file.type, file.name);
}
