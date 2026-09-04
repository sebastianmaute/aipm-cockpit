# Document write concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI document write path a concurrency precondition, so an `update_document` `replace`, `delete` or `move` cannot silently overwrite an edit the user made after the model read the block.

**Architecture:** A per-block hash (`blockToken`) is handed out by `get_document` and returned by `update_document` as `expectHash`. The comparison runs inside `applyOps`, where the evolving block list lives; required-ness is enforced one layer up in the tool, leaving the engine permissive for the hand block editor that shares it.

**Tech Stack:** TypeScript, vitest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-document-write-concurrency-design.md` · register entry §349

---

## Before you start

**CRLF.** Every `src/app/*.ts` in this repo is CRLF in the working tree (`i/lf w/crlf`). Use the **Edit** tool on existing files — **never Write**, which re-lines the whole file to LF, and never `sed -i`. New files created by Write land LF; that is cosmetic here (the clean filter normalises either way and ~66 `src/app` files are already `w/lf`), but check an existing file you edited with `git ls-files --eol <file>` before committing.

**Never read a gate's exit code through a pipe.** Redirect, echo `$?` unpiped, then grep the file.

**Reverting a mutation-test mutant:** `git checkout -- <file>` is deny-blocked in this repo. Revert with an inverse anchored edit, assert the anchor is unique in both directions, and end on an empty `git diff --stat`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/token-hash.ts` | **NEW.** The two-pass FNV-style `hash`, extracted verbatim from `ai-entity-token.ts` so two callers share one implementation. |
| `src/app/ai-entity-token.ts` | **MODIFY.** Imports `hash` instead of declaring it. No behaviour change. |
| `src/app/document-block-token.ts` | **NEW.** `blockToken(block)` — the canonical, injective projection of a `DocBlock` plus the hash. |
| `src/app/document-block-token.test.ts` | **NEW.** Injectivity, and agreement with `blockChanged`. |
| `src/app/document-ops.ts` | **MODIFY.** `expectHash?: string` on the `replace`/`delete`/`move` arms and its three enforcement sites. |
| `src/app/document-ops.test.ts` | **MODIFY.** Engine refusal and evolving-list cases. |
| `src/app/chat-tool-defs-documents.ts` | **MODIFY.** Schema: `expectHash`, `move` in the op enum, `from`/`to`. |
| `src/app/chat-tools-documents.ts` | **MODIFY.** `get_document` returns `blockTokens`; `requirePayload` requires `expectHash`. |
| `src/app/chat-tools-documents.test.ts` | **MODIFY.** Tool-layer required-ness and the `blockTokens` response. |

`blockToken` lives in its own module rather than in `ai-entity-token.ts` on purpose: that file is the *entity CSV projection* token, and `NOT_TOKEN_GUARDED` in `ai-entity-token.test.ts` pins `update_document` as exempt from it. Putting a document token there would blur a distinction a test exists to hold. It is not in `document-model.ts` either — that module deliberately "owns `DocBlock`, is imported by both, and imports neither".

`document-ops.ts` today imports exactly one module (`./document-model`). Importing `ai-entity-token.ts` directly would pull the CSV codecs into a pure engine; extracting the hash keeps that dependency at one tiny leaf.

---

### Task 1: Extract the shared hash

**Files:**
- Create: `src/app/token-hash.ts`
- Modify: `src/app/ai-entity-token.ts`
- Test: `src/app/ai-entity-token.test.ts` (existing, must stay green unchanged)

- [ ] **Step 1: Record the current token for a fixed entity, so the refactor is provably behaviour-preserving**

Run:
```bash
npx vitest run src/app/ai-entity-token.test.ts > scratch-t1-before.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" scratch-t1-before.log
```
Expected: EXIT=0, all tests passing. Note the passing count — it must be identical after the move.

- [ ] **Step 2: Create `src/app/token-hash.ts`**

Move `mix` and `hash` verbatim. Do not rewrite either function: the header comment on `hash` records a measurement (the two passes' bit 0 are uncorrelated) that only holds for this exact code.

```ts
// The concurrency-token hash, shared by `ai-entity-token.ts` (entity rows) and
// `document-block-token.ts` (document blocks).
//
// ★★ Extracted rather than imported from `ai-entity-token.ts` because
//    `document-ops.ts` is a pure engine importing exactly one module today, and
//    reaching into the entity token would pull the CSV codecs in behind it.

function mix(h: number): number {
  let x = h;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Two FNV-1a-style passes over the same bytes, each finalized, emitted as one
 *  16-character hex string.
 *
 *  ★★ NOT CRYPTOGRAPHIC, AND IT DOES NOT NEED TO BE — this detects concurrent
 *  edits, it does not resist an attacker; both versions of the record come from
 *  the same trusted store. It IS sync, which `crypto.subtle` is not, and the
 *  token has to be produced inside a synchronous tool dispatch.
 *  ★★ TWO passes rather than one: a single 32-bit hash collides often enough to
 *  matter across a long session, and a collision here is a false PERMIT.
 *  ★ CLAIM THE MEASUREMENT, NOT A ROUND NUMBER. What was measured is that the
 *  two passes' bit 0 are no longer correlated; that is not a proof of full
 *  64-bit independence, and this comment previously asserted "the effective
 *  width is 64 bits" when it was demonstrably 63. If you change either pass,
 *  re-run the measurement rather than restating this. */
export function hash(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
  }
  return mix(a).toString(16).padStart(8, "0") + mix(b).toString(16).padStart(8, "0");
}
```

- [ ] **Step 3: Delete `mix` and `hash` from `ai-entity-token.ts` and import instead**

With the Edit tool (the file is CRLF). Add the import beside the existing imports:

```ts
import { hash } from "./token-hash";
```

Then delete the `mix` function and the `hash` function bodies from that file, leaving `entityToken` unchanged.

- [ ] **Step 4: Prove the refactor changed no token**

Run:
```bash
npx vitest run src/app/ai-entity-token.test.ts > scratch-t1-after.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" scratch-t1-after.log
```
Expected: EXIT=0 and the SAME passing count as Step 1. A changed count means the move was not verbatim.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/token-hash.ts src/app/ai-entity-token.ts; echo "EXIT=$?"
```
Expected: both EXIT=0. Note `tsc` exits **2** on diagnostics, not 1.

- [ ] **Step 6: Commit**

```bash
rm -f scratch-t1-before.log scratch-t1-after.log
git add src/app/token-hash.ts
git commit --only src/app/token-hash.ts src/app/ai-entity-token.ts -m "refactor(ai): extract the concurrency-token hash into its own module"
```

---

### Task 2: `blockToken`

**Files:**
- Create: `src/app/document-block-token.ts`
- Test: `src/app/document-block-token.test.ts`

**The trap this task exists to avoid.** `blockChanged` is `!deepEqual`, and that `deepEqual` treats an **omitted** field and one explicitly set to `undefined` as the same block — but treats `{caption: ""}` and `{}` as **different** blocks (`"" === undefined` is false, and the next branch returns false). So a projection using `block.caption ?? ""` maps a present empty caption and an absent one to the same bytes, while the engine's other guard calls them different. That is a false PERMIT. Every optional field therefore needs a **presence flag** beside its value.

- [ ] **Step 1: Write the failing tests**

Create `src/app/document-block-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockToken } from "./document-block-token";
import { blockChanged, type DocBlock } from "./document-model";

describe("blockToken", () => {
  it("agrees with blockChanged that an omitted field and an explicit undefined are one block", () => {
    // ★★★ The two guards run side by side in applyOps. If they disagree about
    //   any pair of blocks, the AI path refuses writes the hand editor accepts.
    const omitted: DocBlock = { type: "bullets", items: ["a"] };
    const explicit: DocBlock = { type: "bullets", items: ["a"], ordered: undefined };
    expect(blockChanged(omitted, explicit)).toBe(false);
    expect(blockToken(omitted)).toBe(blockToken(explicit));
  });

  it("agrees with blockChanged that a PRESENT empty optional differs from an absent one", () => {
    // ★★★ The false-permit case, and the reason every optional carries a
    //   presence flag: `caption ?? ""` would collapse these two into one token
    //   while blockChanged calls them different.
    const absent: DocBlock = { type: "table", columns: ["c"], rows: [["v"]] };
    const empty: DocBlock = { type: "table", columns: ["c"], rows: [["v"]], caption: "" };
    expect(blockChanged(absent, empty)).toBe(true);
    expect(blockToken(absent)).not.toBe(blockToken(empty));
  });

  it("distinguishes two tables differing only in where a row is split", () => {
    // The case a naive concatenation collides: same characters, different shape.
    const a: DocBlock = { type: "table", columns: ["x", "y"], rows: [["ab", "c"]] };
    const b: DocBlock = { type: "table", columns: ["x", "y"], rows: [["a", "bc"]] };
    expect(blockToken(a)).not.toBe(blockToken(b));
  });

  it("distinguishes bullets whose items differ only in where the split falls", () => {
    const a: DocBlock = { type: "bullets", items: ["ab", "c"] };
    const b: DocBlock = { type: "bullets", items: ["a", "bc"] };
    expect(blockToken(a)).not.toBe(blockToken(b));
  });

  it("distinguishes ordered:false from an absent ordered", () => {
    const absent: DocBlock = { type: "bullets", items: ["a"] };
    const explicitFalse: DocBlock = { type: "bullets", items: ["a"], ordered: false };
    expect(blockChanged(absent, explicitFalse)).toBe(true);
    expect(blockToken(absent)).not.toBe(blockToken(explicitFalse));
  });

  it("gives every block type a distinct token from every other", () => {
    const blocks: DocBlock[] = [
      { type: "heading", level: 1, text: "t" },
      { type: "heading", level: 2, text: "t" },
      { type: "paragraph", html: "<p>t</p>" },
      { type: "bullets", items: ["t"] },
      { type: "table", columns: ["t"], rows: [] },
      { type: "dataSection", key: "tasks" },
      { type: "pageBreak" },
    ];
    const tokens = blocks.map(blockToken);
    expect(new Set(tokens).size).toBe(blocks.length);
  });

  it("is stable across calls", () => {
    const b: DocBlock = { type: "paragraph", html: "<p>hello</p>" };
    expect(blockToken(b)).toBe(blockToken(b));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/document-block-token.test.ts > scratch-t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Cannot find" scratch-t2.log
```
Expected: FAIL — `Cannot find module './document-block-token'`.

- [ ] **Step 3: Write `src/app/document-block-token.ts`**

```ts
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
//
// ★★ LENGTH-PREFIXED, copying `ai-entity-token.ts`. A value cannot contain its
//   own length, so prefixing makes the concatenation injective: without it
//   {columns:["ab"],…} and {columns:["a","b"],…} reach the same bytes.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/document-block-token.test.ts > scratch-t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " scratch-t2.log
```
Expected: EXIT=0, 7 passed.

- [ ] **Step 5: Mutation-prove the presence flag**

Edit `optional` so it drops the flag — replace its body with `return field(name, value === undefined ? "" : String(value));` — then run the tests and read WHICH cases fail.

```bash
npx vitest run src/app/document-block-token.test.ts > scratch-t2-mutant.log 2>&1; echo "EXIT=$?"; grep -E "×|✓|Tests " scratch-t2-mutant.log
```
Expected: the "PRESENT empty optional" case FAILS. Record the result as `N failed / M passed` and check the sum equals 7. If nothing fails, the test is vacuous — fix the test, not the mutant.

Revert with an inverse anchored edit, then:
```bash
git diff --stat; echo "EXIT=$?"
```
Expected: empty output — the mutant is gone.

- [ ] **Step 6: Typecheck, lint, size**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-block-token.ts src/app/document-block-token.test.ts; echo "EXIT=$?"
npm run size:check > scratch-size.log 2>&1; echo "EXIT=$?"
```
Expected: all EXIT=0.

- [ ] **Step 7: Commit**

```bash
rm -f scratch-t2.log scratch-t2-mutant.log scratch-size.log
git add src/app/document-block-token.ts src/app/document-block-token.test.ts
git commit --only src/app/document-block-token.ts src/app/document-block-token.test.ts -m "feat(documents): add blockToken, the per-block concurrency token"
```

---

### Task 3: `expectHash` in the engine

**Files:**
- Modify: `src/app/document-ops.ts`
- Test: `src/app/document-ops.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/document-ops.test.ts`. Import `blockToken` at the top of the file alongside the existing imports.

```ts
describe("expectHash", () => {
  const para = (html: string): DocBlock => ({ type: "paragraph", html });

  it("refuses a replace whose expectHash does not match, and leaves the block UNCHANGED", () => {
    // ★★ Asserting on the BLOCK, not merely on a rejection. A test that only
    //   checks the rejection message passes against code that pushed the
    //   message AFTER writing.
    // ★★★ THE SECOND OP IS LOAD-BEARING, and the obvious one-op version of this
    //   test is VACUOUS: applyOps copies its input (`next = [...blocks]`), so
    //   asserting the CALLER's array is untouched is true however the engine
    //   behaves, and a wholly-refused batch returns null with no array to read.
    //   The append makes the batch partially apply, so there is a RESULT whose
    //   index 0 can be checked against the live block.
    const rejected: string[] = [];
    const next = applyOps([para("<p>live</p>")], [
      { op: "replace", index: 0, block: para("<p>ai</p>"), expectHash: blockToken(para("<p>stale</p>")) },
      { op: "append", block: para("<p>appended</p>") },
    ], rejected);
    expect(next).toEqual([para("<p>live</p>"), para("<p>appended</p>")]);
    expect(rejected[0]).toMatch(/changed by another writer/);
  });

  it("applies a replace whose expectHash matches", () => {
    const blocks = [para("<p>live</p>")];
    const rejected: string[] = [];
    const next = applyOps(blocks, [
      { op: "replace", index: 0, block: para("<p>ai</p>"), expectHash: blockToken(para("<p>live</p>")) },
    ], rejected);
    expect(next).not.toBeNull();
    expect(next?.[0]).toEqual(para("<p>ai</p>"));
    expect(rejected).toEqual([]);
  });

  it("reads the EVOLVING list, not the original", () => {
    // ★★★ This is why the check cannot live in the tool layer. After op 0
    //   deletes index 0, the block the model tokenised as index 1 IS index 0.
    const blocks = [para("<p>a</p>"), para("<p>b</p>")];
    const rejected: string[] = [];
    const next = applyOps(blocks, [
      { op: "delete", index: 0, expectHash: blockToken(para("<p>a</p>")) },
      { op: "replace", index: 0, block: para("<p>c</p>"), expectHash: blockToken(para("<p>b</p>")) },
    ], rejected);
    expect(rejected).toEqual([]);
    expect(next).toEqual([para("<p>c</p>")]);
  });

  it("refuses a delete and a move on mismatch too", () => {
    const stale = blockToken(para("<p>stale</p>"));
    const rejDelete: string[] = [];
    expect(applyOps([para("<p>live</p>")], [{ op: "delete", index: 0, expectHash: stale }], rejDelete)).toBeNull();
    expect(rejDelete[0]).toMatch(/changed by another writer/);

    const rejMove: string[] = [];
    expect(
      applyOps([para("<p>live</p>"), para("<p>x</p>")], [{ op: "move", from: 0, to: 1, expectHash: stale }], rejMove),
    ).toBeNull();
    expect(rejMove[0]).toMatch(/changed by another writer/);
  });

  it("an ABSENT expectHash still applies — the engine stays permissive", () => {
    // ★★★ document-ops.ts's stated contract: an absent precondition must never
    //   be read as "expected nothing". The hand block editor shares this engine
    //   and omits the field. Strictness lives in the TOOL layer.
    const rejected: string[] = [];
    const next = applyOps([para("<p>live</p>")], [{ op: "replace", index: 0, block: para("<p>x</p>") }], rejected);
    expect(next).toEqual([para("<p>x</p>")]);
    expect(rejected).toEqual([]);
  });

  it("checks BOTH preconditions when both are supplied", () => {
    const rejected: string[] = [];
    const next = applyOps([para("<p>live</p>")], [
      { op: "replace", index: 0, block: para("<p>x</p>"), expect: para("<p>live</p>"), expectHash: blockToken(para("<p>stale</p>")) },
    ], rejected);
    expect(next).toBeNull();
    expect(rejected[0]).toMatch(/changed by another writer/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/document-ops.test.ts > scratch-t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests |error TS|×" scratch-t3.log | head
```
Expected: FAIL — `expectHash` is not a known property of the op type.

- [ ] **Step 3: Add `expectHash` to the three `DocOp` arms**

With the Edit tool. The arms become:

```ts
  | { op: "replace"; index: number; block: DocBlock; expect?: DocBlock; expectHash?: string }
  | { op: "delete"; index: number; expect?: DocBlock; expectHash?: string }
  | { op: "move"; from: number; to: number; expect?: DocBlock; expectHash?: string }
```

Add this note immediately above the `replace` arm, under the existing `expect` note:

```ts
  //  ★★ `expectHash` is the SAME precondition for a caller that has a token
  //   rather than the block: `get_document` hands one out per block and
  //   `update_document` returns it. It exists because `blockChanged` is
  //   structural deepEqual, so `expect` would require a model to reproduce
  //   rich HTML byte-for-byte — which misfires on whitespace and entity
  //   encoding, and an optional precondition that misfires is one the caller
  //   learns to omit. Both are OPTIONAL here and BOTH are checked when both
  //   are present; the tool layer, not this module, refuses on absence.
```

- [ ] **Step 4: Add the three checks**

Immediately AFTER each existing `op.expect` check, in each of the three arms. For `replace`:

```ts
        if (op.expectHash !== undefined && blockToken(next[op.index]) !== op.expectHash) {
          rejected.push(`op ${i}: replace index ${op.index} was changed by another writer`);
          break;
        }
```

For `delete`, identical but with `delete` in the message. For `move`, use `next[op.from]` and `move index ${op.from}`. The messages deliberately match the `expect` ones — the cause is the same and the model should not have to learn two.

Add the import at the top:

```ts
import { blockToken } from "./document-block-token";
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/app/document-ops.test.ts > scratch-t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " scratch-t3.log
```
Expected: EXIT=0, every test passing including the pre-existing ones.

- [ ] **Step 6: Mutation-prove each of the three checks**

One at a time, delete a single check and record which cases fail:

```bash
npx vitest run src/app/document-ops.test.ts > scratch-t3-mutant.log 2>&1; echo "EXIT=$?"; grep -E "×|Tests " scratch-t3-mutant.log
```
Expected per mutant: the matching refusal case fails and the others pass. A mutant that kills nothing means the case is not pinned. Record each as `N failed / M passed`; revert each by inverse anchored edit and confirm `git diff --stat` is empty before the next.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-ops.ts src/app/document-ops.test.ts; echo "EXIT=$?"
git ls-files --eol src/app/document-ops.ts
```
Expected: both EXIT=0, and `i/lf w/crlf` — if it reads `w/lf` the file was re-lined by the wrong tool.

- [ ] **Step 8: Commit**

```bash
rm -f scratch-t3.log scratch-t3-mutant.log
git commit --only src/app/document-ops.ts src/app/document-ops.test.ts -m "feat(documents): accept expectHash as a per-block concurrency precondition"
```

---

### Task 4: `get_document` hands out the tokens

**Files:**
- Modify: `src/app/chat-tools-documents.ts`
- Test: `src/app/chat-tools-documents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("get_document returns one blockToken per block, in order", async () => {
  const doc = {
    id: 1,
    title: "D",
    blocks: [{ type: "paragraph", html: "<p>a</p>" }, { type: "pageBreak" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const d = { ...baseDispatcher, getDocument: () => doc } as unknown as DocumentToolDispatcher;
  const res = (await runDocumentTool(d, "get_document", { id: 1 })) as {
    blocks: DocBlock[];
    blockTokens: string[];
  };
  expect(res.blockTokens).toEqual(doc.blocks.map((b) => blockToken(b as DocBlock)));
  // The document itself is still returned in full — the model needs the blocks.
  expect(res.blocks).toHaveLength(2);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/chat-tools-documents.test.ts > scratch-t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests |×" scratch-t4.log | head
```
Expected: FAIL — `blockTokens` is `undefined`.

- [ ] **Step 3: Return the tokens**

Edit the `get_document` case:

```ts
    case "get_document": {
      const id = requireDocId(input);
      const doc = d.getDocument(id);
      if (!doc) throw new Error(`document #${id} not found`);
      // ★★ A PARALLEL array, never a field on DocBlock: the token is
      //   model-facing plumbing and must not leak into the persisted block
      //   type, which is sanitised and written across the storage paths.
      return { ...doc, blockTokens: doc.blocks.map(blockToken) };
    }
```

Add the import:

```ts
import { blockToken } from "./document-block-token";
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/chat-tools-documents.test.ts > scratch-t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " scratch-t4.log
```
Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
rm -f scratch-t4.log
git commit --only src/app/chat-tools-documents.ts src/app/chat-tools-documents.test.ts -m "feat(documents): hand out per-block tokens from get_document"
```

---

### Task 5: Schema and tool-layer required-ness

**Files:**
- Modify: `src/app/chat-tool-defs-documents.ts`
- Modify: `src/app/chat-tools-documents.ts`
- Test: `src/app/chat-tools-documents.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses replace, delete and move with no expectHash, naming get_document", async () => {
  for (const op of [
    { op: "replace", index: 0, block: { type: "paragraph", html: "<p>x</p>" } },
    { op: "delete", index: 0 },
    { op: "move", from: 0, to: 1 },
  ]) {
    await expect(runDocumentTool(baseDispatcher, "update_document", { id: 1, ops: [op] })).rejects.toThrow(
      /expectHash.*get_document/s,
    );
  }
});

it("accepts append and insert with no expectHash — they have no target block", async () => {
  await expect(
    runDocumentTool(baseDispatcher, "update_document", {
      id: 1,
      ops: [{ op: "append", block: { type: "paragraph", html: "<p>x</p>" } }],
    }),
  ).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/chat-tools-documents.test.ts > scratch-t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests |×" scratch-t5.log | head
```
Expected: FAIL — the refusal is not thrown.

- [ ] **Step 3: Require `expectHash` in `requirePayload`**

Append to `requirePayload` in `chat-tools-documents.ts`:

```ts
  if (kind === "replace" || kind === "delete" || kind === "move") {
    // ★★★ REFUSE ON ABSENCE, matching `requireToken` on the six entity tools.
    //   The engine stays permissive because the hand block editor shares it and
    //   omits the field; strictness belongs here, where the caller is a model.
    const expectHash = (op as { expectHash?: unknown }).expectHash;
    if (typeof expectHash !== "string" || expectHash === "") {
      throw new Error(
        `op ${i}: ${kind} requires expectHash — call get_document, then send the blockTokens entry for the block you are targeting`,
      );
    }
  }
```

- [ ] **Step 4: Advertise the field and `move` in the schema**

Edit the op `properties` in `chat-tool-defs-documents.ts`:

```ts
              op: { type: "string" as const, enum: ["append", "insert", "replace", "delete", "move", "replaceAll"] },
              index: { type: "number" as const, description: "0-based; required for insert, replace and delete" },
              from: { type: "number" as const, description: "move only: the 0-based index to take the block from" },
              to: { type: "number" as const, description: "move only: the 0-based index to put it at, in the list AFTER the removal, so to === length-1 appends" },
              expectHash: {
                type: "string" as const,
                description:
                  "REQUIRED for replace, delete and move: the blockTokens entry get_document returned for the block you are targeting. The edit is refused if that block changed since you read it.",
              },
```

Extend the `update_document` description with one sentence:

```
Use move to reorder a block — never a delete followed by an insert, which can lose the block if the insert is refused.
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run src/app/chat-tools-documents.test.ts > scratch-t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " scratch-t5.log
```
Expected: EXIT=0.

- [ ] **Step 6: Mutation-prove the required-ness guard**

Narrow the condition to `kind === "replace"` alone, re-run, and confirm the `delete` and `move` legs of the first test now fail. Record `N failed / M passed`. Revert by inverse anchored edit; confirm `git diff --stat` empty.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/chat-tool-defs-documents.ts src/app/chat-tools-documents.ts src/app/chat-tools-documents.test.ts; echo "EXIT=$?"
```
Expected: both EXIT=0.

- [ ] **Step 8: Commit**

```bash
rm -f scratch-t5.log
git commit --only src/app/chat-tool-defs-documents.ts src/app/chat-tools-documents.ts src/app/chat-tools-documents.test.ts -m "feat(documents): require expectHash on guarded ops and advertise move"
```

---

### Task 6: Verify the field survives the dispatcher, then run the full gates

**Files:**
- Read: `src/app/use-document-tools.ts`
- Modify: only if the check below shows the field is dropped.

- [ ] **Step 1: Confirm `expectHash` reaches the engine**

`use-document-tools.ts` rebuilds each op as `keepOp({ ...op, block }, i)`, so a spread should carry `expectHash` through. Prove it rather than assuming — add a temporary assertion, or write this test in `use-document-tools.test.tsx` and keep it:

```ts
it("carries expectHash through to the engine op", () => {
  // Anti-vacuity: a spread that dropped the field would leave the engine
  // permissive and the whole guard would be dead with every other test green.
  const seen: unknown[] = [];
  // ... drive an update_document with an expectHash-bearing replace through the
  // hook's dispatcher, capturing the ops handed to mutateDocuments, then:
  expect((seen[0] as { expectHash?: string }).expectHash).toBe("deadbeefdeadbeef");
});
```

If the field is dropped, add it explicitly at the `keepOp` call sites.

- [ ] **Step 2: Full gate run**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "LINT_EXIT=$?"
npm run test:run > scratch-suite.log 2>&1; echo "SUITE_EXIT=$?"; grep -E "Test Files|Tests " scratch-suite.log
npm run size:check > scratch-size.log 2>&1; echo "SIZE_EXIT=$?"
```
Expected: TSC_EXIT=0, LINT_EXIT=0, SUITE_EXIT=0, SIZE_EXIT=0.

Do not run two vitest processes at once — a red mentioning `Failed to start forks worker` is machine contention, not a real failure.

- [ ] **Step 3: Update the register**

Close §349 in `docs/open-followups.md`. That is a FOUR-place edit: the heading marker, the summary-table STATUS cell, the summary-table ANCHOR (it is derived from the heading text, so changing the heading breaks the link), and the `**Status:**` witness line. A body line must never contain the word CLOSED. Then:

```bash
npm run followups:status:check > scratch-fs.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > scratch-dc.log 2>&1; echo "EXIT=$?"
```
Expected: both EXIT=0.

- [ ] **Step 4: Commit**

```bash
rm -f scratch-suite.log scratch-size.log scratch-fs.log scratch-dc.log
git commit --only docs/open-followups.md src/app/use-document-tools.ts -m "docs(followups): close §349 — the AI document write path now carries a concurrency precondition"
```

Never `git add -A` or `git add .` in this repo: `not-in-use.env.local.bak` is untracked, not gitignored, and holds live credentials, and `sample-workspace-huge.json` is modified by a concurrent writer.

---

## Self-review

**Spec coverage.** Decision 1 (hash over echo) → Task 2. Decision 2 (check in the engine, strictness in the tool) → Tasks 3 and 5. Decision 3 (agreement with `blockChanged`, injectivity) → Task 2 Steps 1 and 3. Decision 4 (`move` in the enum) → Task 5 Step 4. Decision 5 (partial apply kept, refusals reported) → no code: `rejected` already carries the messages, and Task 3 Step 4 reuses the existing wording rather than adding a channel. Tool surface → Tasks 4 and 5. Every "In" scope item has a task.

**One thing the spec did not anticipate, added here:** the presence-flag requirement in `blockToken`. The spec said the projection must "normalise `undefined` away", which is only half true — `deepEqual` keeps a *present* empty string distinct from an absent field, so normalising with `?? ""` would have shipped a false permit. Task 2's second test is the one that catches it.

**Type consistency.** `blockToken(block: DocBlock): string` is used with that signature in Tasks 3 and 4. `hash(input: string): string` is exported in Task 1 and imported in Task 2. `expectHash?: string` is declared in Task 3 and read in Tasks 3 and 5.
