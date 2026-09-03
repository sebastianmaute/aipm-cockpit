// src/app/chat-tools-documents.ts — routing + boundary validation for the five
// document tools. Split out of chat-tools.ts, which is close enough to the
// 800-line ratchet that five more inline cases would not fit — same reason
// chat-tool-defs-documents.ts exists. Check before adding to either:
// `wc -l src/app/chat-tools.ts` (762 when this was written; the ratchet is
// enforced by `npm run size:check`, which is the number that actually gates).
//
// ★★★ THIS IS THE VALIDATION BOUNDARY, and it is the only one. Everything
// downstream is deliberately permissive: applyDocMutation (document-mutations.ts)
// is pure and treats its inputs as already-shaped, and the entity sanitizers
// degrade unknown shapes rather than throwing. Malformed MODEL output has to be
// refused here or it silently becomes a legal-looking write.
//
// ★★ Chat tool writes have NO undo capture — the version log
// (document-versions.ts) is the only thing standing behind them, and it records
// what a mutation replaced, not what a caller meant. So a guard that lets a
// wrong write through cannot be recovered from within the session that made it.
import type { DocOp } from "./document-mutations";
import type { ProjectDocument } from "./document-model";
import { blockToken } from "./document-block-token";

export type DocumentSummary = {
  id: number;
  title: string;
  blockCount: number;
  updatedAt: string;
};

export type DocumentUpdateResult = {
  id: number;
  /** ★★★ REQUIRED BY THE CHAT FILE CARD, and required non-blank. The card
   *  (chat-tool-block.tsx) renders only for a tool result shaped
   *  `{id: integer > 0, title: non-empty after trim, blockCount: integer >= 0}`;
   *  ANY deviation — a missing field, a wrong type, an id-as-string, a blank
   *  title — silently falls back to the plain tool block. So a successful
   *  update with a blank title does not error, it just stops offering the user
   *  the document they were just shown editing. This is the document's title
   *  AFTER the write.
   *  ★ It is REQUIRED here rather than optional on purpose: that makes the
   *  dispatcher's obligation a compile error instead of a rendering
   *  disappointment nobody traces back. The routing layer deliberately does NOT
   *  runtime-guard it — failing an applied write over a cosmetic card would be
   *  the worse trade. ★ The card also prefers the LIVE document (looked up by
   *  id through useWorkspace) for everything it displays, so this value is the
   *  fallback for when that document is gone — it need not be perfect, but it
   *  must be there. */
  title: string;
  blockCount: number;
  applied: number;
  /** Human-readable reasons, one per refused op. */
  rejected: readonly string[];
  /** Blocks the write dropped — non-zero only for replaceAll. */
  removed: number;
};

export type DocumentToolDispatcher = {
  listDocuments(): DocumentSummary[];
  getDocument(id: number): ProjectDocument | null;
  /** `blocks` is RAW model output, passed through unvalidated on purpose — the
   *  model-input allow-list (ai-document-blocks.ts) is the dispatcher's job, so
   *  block shape is checked in exactly one place rather than two that can
   *  drift. This module owns only the guards the dispatcher cannot express. */
  createDocument(title: string, blocks: unknown): { id: number; title: string; blockCount: number };
  updateDocument(id: number, ops: readonly DocOp[], title: string | undefined): DocumentUpdateResult | null;
  deleteDocument(id: number): { deleted: boolean; restorableVersionId: number | null };
};

// ★ A LOCAL literal, deliberately NOT derived from DOCUMENT_TOOL_DEFS: a
// module-eval `new Set(IMPORTED_CONST)` comes out EMPTY when an import cycle
// puts this module ahead of the defs one, and an empty set here routes every
// document tool into chat-tools' `unknown tool` throw. The test cross-checks the
// two lists instead, which catches drift without the cycle risk.
const DOCUMENT_TOOLS = new Set([
  "list_documents",
  "get_document",
  "create_document",
  "update_document",
  "delete_document",
]);

export function isDocumentTool(name: string): boolean {
  return DOCUMENT_TOOLS.has(name);
}

function requireDocId(input: Record<string, unknown>): number {
  const id = Number(input.id);
  if (!Number.isFinite(id)) throw new Error("id must be a number");
  return id;
}

/**
 * ★★★ VALIDATE ops ARRAY-NESS HERE, at the TOOL boundary — never in the pure
 * mutation module, where a non-array is byte-identical to a legitimate "no
 * ops". This is the `set_task_dependencies` shape (see chat-tools.ts's guard
 * on `dependencies`): malformed model output — a stray string, an omitted
 * field — must be refused rather than reinterpreted.
 *
 * ★★★ BUT THE CONSEQUENCE HERE IS NOT A WIPE, and the plan said it was. That
 * matters, because "it would erase the document" is the kind of claim someone
 * later checks, disproves, and then discounts the whole guard over. MEASURED by
 * deleting this check: a non-array degrades to `[]`, `applyOps` returns null
 * for an empty list, and `applyDocMutation` refuses to touch the blocks — so
 * nothing is destroyed. What actually happens is that the model's ops are
 * SILENTLY DISCARDED and the tool reports success: with no title the call
 * throws anyway ("supply ops, a title, or both"), and WITH a title the rename
 * lands, resolves, and every edit the model asked for vanishes with no
 * rejection to show the user. `set_task_dependencies` really would clear; this
 * one lies. Both are refusals-that-read-as-success, which is why the guard
 * stays — it is just not the data-loss story.
 *
 * ★★ `undefined` is the ONE non-array that is legal, and it means "no ops" —
 * a title-only rename. Every other non-array is a refusal, including `null`,
 * a string, and an object: none of them can be a caller's honest empty list.
 */
function requireOps(input: Record<string, unknown>): readonly DocOp[] {
  if (input.ops === undefined) return [];
  if (!Array.isArray(input.ops)) {
    throw new Error("ops must be an array of block operations");
  }
  input.ops.forEach(requirePayload);
  return input.ops as readonly DocOp[];
}

/**
 * ★★★ THE SAME RULE, ONE LEVEL DOWN. The array-ness guard above closed the
 * outer door and stopped there: the schema declares each op `required: ["op"]`
 * only, so a model may legally omit `blocks`/`block`, and nothing looked inside.
 *
 * ★★★ AND THE OMISSION READ AS A DELETION. Measured through the real chain: a
 * `{op:"replaceAll"}` with no `blocks` reached use-document-tools' per-op
 * `sanitizeAiDocBlocks(op.blocks)`, which returns `[]` for a non-array, so the
 * engine saw a well-formed "replace everything with nothing", wiped every block
 * and returned `changed:true, rejected:[]`. The model is told it succeeded and
 * tells the user so. That is the `set_task_dependencies` shape, and unlike the
 * outer guard's case this one really does destroy content.
 *
 * ★★ AN EXPLICIT `blocks: []` IS LEGAL AND MUST STAY LEGAL — the model asked to
 * clear the document, and the before-image preserves what it replaced. Only a
 * MISSING or non-array field is the defect, which is why this tests the SHAPE
 * (`Array.isArray`) and never truthiness: `[]` is falsy-adjacent in exactly the
 * way that would break a legitimate operation.
 *
 * ★ The engine carries its own copy of these checks (`applyOps`) because it has
 * other callers. This one exists so the MODEL gets a refusal it can read and
 * retry against, rather than a silently-dropped op buried in `rejected`.
 */
function requirePayload(op: unknown, i: number): void {
  const kind = (op as { op?: unknown } | null)?.op;
  if (kind === "replaceAll" && !Array.isArray((op as { blocks?: unknown }).blocks)) {
    throw new Error(
      `op ${i}: replaceAll requires a blocks array — send [] to clear the document, or omit the op to leave it unchanged`,
    );
  }
  if (kind === "append" || kind === "insert" || kind === "replace") {
    // ★★★ `typeof x === "object"` IS NOT A BLOCK TEST, and this guard shared the
    // weak version with applyOps: it refuses `42`, `"str"` and `null` but
    // ADMITS `[]` and `{}`, which were stored verbatim, reported as success and
    // dropped on the next load. Every real DocBlock is discriminated by a string
    // `type`, so that is the cheapest test admitting all of them and neither of
    // those. It deliberately does NOT check the type against the known set —
    // that is document-model.ts's `sanitizeBlock`, and a second copy of the
    // block registry here is one that can drift.
    const block = (op as { block?: unknown }).block;
    if (
      typeof block !== "object" ||
      block === null ||
      Array.isArray(block) ||
      typeof (block as { type?: unknown }).type !== "string"
    ) {
      throw new Error(`op ${i}: ${kind} requires a block`);
    }
  }
  // ★★★ REFUSE ON ABSENCE, in the same spirit as `requireToken` — but NOT as a
  // mirror of it, and this comment claimed to be one. Two corrections:
  // ★★ `requireToken` guards SEVEN tools, not six: the six `update_*` plus
  // `set_task_dependencies`, which reaches it through `requireTaskWriteToken`.
  // Enumerate rather than trusting the number, which rots on the next tool:
  //   awk '/case "/{c=$0} /requireToken\("|requireTaskWriteToken\(/{print c}' src/app/chat-tools.ts
  // ★★ AND THIS GUARD IS STRICTLY STRONGER. `requireToken` tests `typeof sent
  // !== "string" || sent.length === 0`, so it ACCEPTS `"   "` and lets it fail
  // one layer down as "changed since you read it" — precisely the misleading
  // reason the blank-string check below exists to avoid. `requirePayload`
  // trims, so the same input is refused here as the malformed call it is.
  // The ENGINE (document-ops.ts) is deliberately permissive about a missing
  // `expectHash` — the hand block editor shares those arms and omits the field
  // — so the strictness has to live HERE, at the boundary where the caller is
  // known to be a model. Without it a model can overwrite a block the user
  // edited after it read the document, and chat tool writes have NO undo
  // capture, so that loss cannot be recovered from within the session.
  //
  // ★★ ORDER IS LOAD-BEARING: this sits AFTER the block-shape check above, so
  // a `replace` carrying neither a block nor a token still reports the missing
  // BLOCK. Hoisting it would silently re-point the "refuses a %s with no
  // block" cases at this message and stop them pinning the shape guard.
  //
  // ★★ Only these three ops. append/insert/replaceAll have no target block
  // that could have been concurrently changed, and no token can name a block
  // that does not exist yet — requiring one there would be unsatisfiable.
  if (kind === "replace" || kind === "delete" || kind === "move") {
    // ★ A BLANK STRING IS NOT A TOKEN. `typeof x === "string"` alone admits
    // `""`, which the engine would compare against a real token and reject one
    // layer down as "changed by another writer" — a misleading reason for what
    // is really a malformed call.
    const expectHash = (op as { expectHash?: unknown }).expectHash;
    if (typeof expectHash !== "string" || expectHash.trim() === "") {
      throw new Error(
        `op ${i}: ${kind} requires expectHash — call get_document, then send the blockTokens entry for the block you are targeting`,
      );
    }
  }
}

export async function runDocumentTool(
  d: DocumentToolDispatcher,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;

  switch (name) {
    case "list_documents":
      return d.listDocuments();

    case "get_document": {
      const id = requireDocId(input);
      const doc = d.getDocument(id);
      if (!doc) throw new Error(`document #${id} not found`);
      // ★★★ THE ONLY PLACE A CONCURRENCY TOKEN IS HANDED OUT, which is what
      // makes this read a precondition of every targeted write:
      // `update_document` REFUSES replace/delete/move without one, so a model
      // that skipped this call cannot edit a block at all.
      // ★★ A PARALLEL ARRAY, never a field on DocBlock: the token is
      // model-facing plumbing and must not leak into the persisted block type,
      // which is sanitized and written across the six storage paths. Indices
      // line up with `blocks`, which is also how the op `index` is addressed.
      return { ...doc, blockTokens: doc.blocks.map(blockToken) };
    }

    case "create_document": {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title) throw new Error("title is required");
      return d.createDocument(title, input.blocks);
    }

    case "update_document": {
      const id = requireDocId(input);
      const ops = requireOps(input);
      // ★★ TRIMMED, matching create_document one case above. The asymmetry was
      // not cosmetic: an untrimmed `"   "` reached the engine, which caps+trims
      // it to empty, refuses the rename and pushes a rejection — so a caller
      // deriving "how many ops applied" from `ops.length - rejected.length`
      // counted a rejection that belongs to no op and could report a NEGATIVE
      // applied count. Trimming here means a whitespace-only title is simply
      // absent, which is what the model meant, and the two routes now read the
      // title the same way.
      const trimmed = typeof input.title === "string" ? input.title.trim() : "";
      const title = trimmed === "" ? undefined : trimmed;
      if (ops.length === 0 && title === undefined) {
        throw new Error("supply ops, a title, or both");
      }
      const result = d.updateDocument(id, ops, title);
      if (!result) throw new Error(`document #${id} not found`);
      // ★★★ A WHOLLY-REFUSED WRITE MUST THROW. The dispatcher has already
      // declined to write (applyDocMutation refuses to mutate when every op
      // was rejected), so resolving here would hand the model a success it can
      // only read as "the edit landed" — and it will then tell the user it made
      // an edit that does not exist. Throwing is what puts the refusal in front
      // of the model.
      // ★★ `title === undefined` is not incidental: with a title supplied the
      // rename DID apply, so `applied === 0` is a PARTIAL application, not a
      // refusal, and it resolves with `rejected` populated. Dropping that
      // clause would turn every "rename plus one bad op" into a hard failure.
      if (result.applied === 0 && title === undefined) {
        throw new Error(`no operation could be applied: ${result.rejected.join("; ")}`);
      }
      return result;
    }

    case "delete_document": {
      const id = requireDocId(input);
      const out = d.deleteDocument(id);
      if (!out.deleted) throw new Error(`document #${id} not found`);
      return out;
    }

    default:
      throw new Error(`unknown document tool: ${name}`);
  }
}
