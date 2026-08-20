// src/app/document-ops.ts — the op interpreter for a `{kind:"ops"}` mutation.
//
// ★★★ DOM-FREE BY CONTRACT, inherited from document-mutations.ts: this only
// rearranges already-sanitized DocBlock values. HTML sanitization is the
// caller's job, composed at the load boundary.
//
// ★ SPLIT OUT OF document-mutations.ts, which stood at 795 of the 800-line
// ratchet. Nothing about the split is semantic — `applyDocMutation` is the
// dispatcher, this is the interpreter its `"ops"` arm calls. The DocOp type
// lives HERE (it is this module's vocabulary) and is RE-EXPORTED from
// document-mutations.ts so its consumers did not have to move.

import { blockChanged, type DocBlock } from "./document-model";

export type DocOp =
  | { op: "append"; block: DocBlock }
  | { op: "insert"; index: number; block: DocBlock }
  // ★★★ `expect` IS AN OPTIMISTIC-CONCURRENCY PRECONDITION: apply this only
  //  while the block at `index` is still the one the caller derived its edit
  //  from. The hand block editor supplies its draft's baseline, because its own
  //  in-component guard reads refs that only advance when that row RENDERS — and
  //  a write changing the block's TYPE at an index unmounts the row with NO
  //  final render, freezing every ref at the pre-write value. This module reads
  //  live state at call time, so it is the one place the check cannot be fooled.
  //  ★ OPTIONAL, and an absent one must never be read as "expected nothing":
  //   every AI/tool caller omits it and must keep applying.
  | { op: "replace"; index: number; block: DocBlock; expect?: DocBlock }
  | { op: "delete"; index: number }
  | { op: "replaceAll"; blocks: readonly DocBlock[] };

/** ★★★ AN OMITTED FIELD IS NOT AN EMPTY ONE — the same rule chat-tools-documents.ts
 *  applies to the ops ARRAY, applied one level down to each op's PAYLOAD. That
 *  outer guard checked array-ness and stopped; nothing checked the `blocks` and
 *  `block` fields inside, so the inner door stayed open through two different
 *  failure modes, both measured:
 *
 *  - Through the AI chain, `{op:"replaceAll"}` with no `blocks` reached
 *    use-document-tools' per-op `sanitizeAiDocBlocks(op.blocks)`, which returns
 *    `[]` for a non-array. The engine then saw a well-formed "replace everything
 *    with nothing", wiped every block and reported `changed:true, rejected:[]` —
 *    a refusal that reads as success, the `set_task_dependencies` shape again.
 *  - Reaching the engine directly (the UI path, and any future caller handing it
 *    a raw op) the SAME input threw `TypeError: op.blocks is not iterable` out of
 *    a module whose header promises purity.
 *
 *  ★★ `{op:"append"}` with no `block` was worse than either: it pushed a literal
 *  `undefined` into the array and reported success, so the document carried a
 *  hole that serialises as `null` and that `sanitizeBlock` silently drops on the
 *  next load. Measured — `changed=true`, `blocks=3`, `blocks[2] === undefined`.
 *
 *  ★★★ AN EXPLICIT EMPTY LIST IS LEGAL AND MUST STAY LEGAL. `replaceAll: []` is
 *  a real request ("clear this document"), the caller asked for it, and the
 *  before-image preserves what it replaced. Only a MISSING or non-array field is
 *  the defect. A guard that refused both would break a legitimate operation —
 *  which is exactly why these read the field as `unknown` and test its SHAPE,
 *  rather than testing it for truthiness. */
function opBlockIsMissing(op: DocOp): boolean {
  return !isBlockShaped((op as { block?: unknown }).block);
}

/** ★★★ `typeof x === "object"` IS NOT A BLOCK TEST. The first version of this
 *  guard was `!block || typeof block !== "object"`, which refuses `42`,
 *  `"str"` and `null` but ADMITS `[]` and `{}` — both stored verbatim and
 *  reported as success (measured), then dropped by `sanitizeBlock` on the next
 *  load. That is the same silent-success class the missing-field guard exists
 *  to close, reached with a differently-malformed value instead of an absent
 *  one.
 *
 *  ★★ Every real `DocBlock` is discriminated by a string `type`, so that is the
 *  cheapest test that admits all of them and neither of those two. It
 *  deliberately does NOT check the type against the known set — that is
 *  document-model.ts's `sanitizeBlock`, and duplicating the block registry here
 *  is a second copy that can drift. This only has to establish "shaped like a
 *  block at all". */
function isBlockShaped(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function opBlocksIsNotAnArray(op: DocOp): boolean {
  return !Array.isArray((op as { blocks?: unknown }).blocks);
}

/** Apply ops LEFT TO RIGHT against the evolving array. An index is resolved
 *  against the array as it stands at that step, which is the only reading a
 *  model can act on deterministically — `[delete 0, delete 0]` means "the
 *  first two". Returns null when EVERY op was rejected. */
export function applyOps(
  blocks: readonly DocBlock[],
  ops: readonly DocOp[],
  rejected: string[],
): readonly DocBlock[] | null {
  let next: DocBlock[] = [...blocks];
  let applied = 0;
  for (const [i, op] of ops.entries()) {
    switch (op.op) {
      case "append":
        if (opBlockIsMissing(op)) {
          rejected.push(`op ${i}: append requires a block`);
          break;
        }
        next.push(op.block);
        applied++;
        break;
      case "replaceAll":
        if (opBlocksIsNotAnArray(op)) {
          rejected.push(`op ${i}: replaceAll requires a blocks array`);
          break;
        }
        next = [...op.blocks];
        applied++;
        break;
      case "insert":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index > next.length) {
          rejected.push(`op ${i}: insert index ${op.index} out of range 0..${next.length}`);
          break;
        }
        if (opBlockIsMissing(op)) {
          rejected.push(`op ${i}: insert requires a block`);
          break;
        }
        next.splice(op.index, 0, op.block);
        applied++;
        break;
      case "replace":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) {
          rejected.push(`op ${i}: replace index ${op.index} out of range 0..${next.length - 1}`);
          break;
        }
        if (opBlockIsMissing(op)) {
          rejected.push(`op ${i}: replace requires a block`);
          break;
        }
        // ★★ REFUSE, do not overwrite — the concurrent write has no undo (AI
        //  and restore writes bypass the undo stack), while the draft this
        //  refuses is one unblurred keystroke burst the user can retype. The
        //  reason reaches them through the panel's existing refusal banner.
        if (op.expect !== undefined && blockChanged(op.expect, next[op.index])) {
          rejected.push(`op ${i}: replace index ${op.index} was changed by another writer`);
          break;
        }
        next[op.index] = op.block;
        applied++;
        break;
      case "delete":
        if (!Number.isInteger(op.index) || op.index < 0 || op.index >= next.length) {
          rejected.push(`op ${i}: delete index ${op.index} out of range 0..${next.length - 1}`);
          break;
        }
        next.splice(op.index, 1);
        applied++;
        break;
      // ★★ An off-enum `op` used to fall straight through this switch: not
      // applied, and — because nothing was pushed — not reported either, so the
      // call came back `changed:false, rejected:[]`, i.e. "I did nothing and
      // have nothing to say about it". The types cannot prevent it (model JSON
      // and stored ops both arrive as `unknown` at runtime), so the arm has to
      // exist. `op` is `never` here, which is precisely why the name has to be
      // read back off it as `unknown`.
      default:
        rejected.push(`op ${i}: unknown op ${JSON.stringify((op as { op?: unknown }).op)}`);
        break;
    }
  }
  // ★★★ A WHOLLY-REFUSED WRITE MUST NOT MUTATE. Writing the (unchanged or
  // empty) result here would destroy the document while the caller reports
  // only "I couldn't do that" — chat tool writes have NO undo capture, so
  // this branch is the only thing standing between a bad model index and
  // real data loss.
  return applied === 0 ? null : next;
}
