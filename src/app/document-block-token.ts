// The per-block concurrency token for the AI document write path.
//
// ★★★ IT MUST AGREE WITH `blockChanged`, which is the other precondition on the
//   same three engine arms. `blockChanged` is `!deepEqual`, and that deepEqual
//   treats an OMITTED field and an explicit `undefined` as the SAME block while
//   treating a PRESENT empty string as DIFFERENT from an absent field. A
//   projection written as `block.caption ?? ""` collapses that second pair into
//   one token — a false PERMIT, the exact failure the token exists to prevent.
//   Hence a presence flag beside every optional value, and `undefined`
//   normalised to the absent spelling.
//   ★★ THAT AGREEMENT IS CONDITIONAL — it holds over blocks that PASSED a
//   sanitiser (`sanitizeBlock`, reached from `normalizeBlockForStorage`, or
//   `sanitizeAiDocBlocks`), each of which rebuilds a block field by field from
//   a fixed registry. A RAW op payload is outside the precondition, and four
//   classes disagree there — measured, not reasoned; all four are tokens-EQUAL
//   while `blockChanged` is true, i.e. false PERMITS:
//     · an extra property outside the union — `deepEqual` unions BOTH objects'
//       keys, and this fixed projection cannot see one;
//     · `heading.level` `2` vs `"2"`, and `bullets.ordered` `true` vs `"true"`
//       — both sides go through `String(...)` below;
//     · any unregistered `type` — the switch has no `default:`, so such a block
//       emits `field("type", …)` and nothing else.
//   The sanitisers close all four: they return null for an unregistered type,
//   push `level` through `Number` + clamp, admit `ordered` only on `=== true`,
//   and copy no field they did not build.
//   ★★ SAME PRECONDITION, SECOND SYMPTOM: a field-INCOMPLETE block of a KNOWN
//   type THROWS here (`{type:"paragraph"}` → `TypeError` reading `.length`),
//   and that escapes `applyOps`, whose own header calls the module pure. Not
//   model-reachable today — `sanitizeAiDocBlocks` runs on every `op.block` and
//   the hand editor never sets `expectHash`. Deliberately undefended: the
//   engine's `isBlockShaped` stops at "shaped like a block at all" on purpose
//   (it refuses to keep a second copy of the block registry), so the shape
//   guard does NOT narrow enough to make this function total — the sanitiser
//   is what does, and it is the precondition to state rather than to duplicate.
//
// ★★ LENGTH-PREFIXED, copying `ai-entity-token.ts`. A value cannot contain its
//   own length, so prefixing makes the concatenation injective.
//   ★★★ NAME THE COLLISION IT ACTUALLY PREVENTS, because the obvious example is
//   NOT one: `list` already emits a `#<count>:` and a per-element index, so
//   items ["ab"] and ["a","b"] are separated with or without the length. What
//   the length buys is a value CONTAINING a delimiter — measured, not reasoned:
//   with `field` reduced to `name + ":" + value`, bullets ["x1:y","z"] and
//   ["x","y1:z"] BOTH render `items#2:0:x1:y1:z`, a false PERMIT between two
//   genuinely different blocks. A test fixture that merely moves a split (the
//   ["ab","c"] / ["a","bc"] shape) does NOT kill that mutant — it survived 0
//   failed / 7 passed until the delimiter-bearing fixtures below were added.
import { hash } from "./token-hash";
import type { DocBlock } from "./document-model";

/** `name:<len>:<value>` — injective for any single value. */
function field(name: string, value: string): string {
  return name + ":" + value.length + ":" + value;
}

/** `name#<count>:` then each element as a length-prefixed field. */
function list(name: string, values: readonly string[]): string {
  return name + "#" + values.length + ":" + values.map((v, i) => field(String(i), v)).join("");
}

/** An optional field: a presence flag, then the value. The flag is what keeps
 *  `{x: ""}` and `{}` apart, matching `blockChanged`. */
function optional(name: string, value: string | boolean | undefined): string {
  return field(name + "Set", value === undefined ? "0" : "1") + field(name, value === undefined ? "" : String(value));
}

/** The concurrency token for one document block. Equal tokens mean the block is
 *  unchanged; different tokens mean it changed. */
export function blockToken(block: DocBlock): string {
  const parts: string[] = [field("type", block.type)];
  switch (block.type) {
    case "heading":
      parts.push(field("level", String(block.level)), field("text", block.text));
      break;
    case "paragraph":
      parts.push(field("html", block.html));
      break;
    case "bullets":
      parts.push(optional("ordered", block.ordered), list("items", block.items));
      break;
    case "table":
      parts.push(optional("caption", block.caption), list("columns", block.columns));
      parts.push("rows#" + block.rows.length + ":" + block.rows.map((r, i) => list("r" + i, r)).join(""));
      break;
    case "dataSection":
      parts.push(field("key", block.key));
      break;
    case "pageBreak":
      break;
  }
  return hash(parts.join(""));
}
