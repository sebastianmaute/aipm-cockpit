import { describe, it, expect, vi } from "vitest";
import { runDocumentTool, isDocumentTool, type DocumentToolDispatcher } from "./chat-tools-documents";
import { DOCUMENT_TOOL_DEFS } from "./chat-tool-defs-documents";
import { sanitizeAiDocumentRichText } from "./ai-rich-text";
import { blockToken } from "./document-block-token";
import type { DocBlock } from "./document-model";

const doc = {
  id: 1,
  title: "Status",
  blocks: [{ type: "paragraph" as const, html: "<p>kept</p>" }],
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};

function makeDispatcher(over: Partial<DocumentToolDispatcher> = {}): DocumentToolDispatcher {
  return {
    listDocuments: vi.fn(() => [{ id: 1, title: "Status", blockCount: 1, updatedAt: doc.updatedAt }]),
    getDocument: vi.fn(() => doc),
    createDocument: vi.fn(() => ({ id: 2, title: "New", blockCount: 0 })),
    updateDocument: vi.fn(() => ({ id: 1, title: "Status", blockCount: 1, applied: 1, rejected: [], removed: 0 })),
    deleteDocument: vi.fn(() => ({ deleted: true, restorableVersionId: 7 })),
    ...over,
  };
}

describe("isDocumentTool", () => {
  it("claims exactly the five names", () => {
    expect(
      ["list_documents", "get_document", "create_document", "update_document", "delete_document"].every(
        isDocumentTool,
      ),
    ).toBe(true);
    expect(isDocumentTool("list_tasks")).toBe(false);
  });

  // ★★ DRIFT GUARD, and it earns its place: the routing set is a LOCAL literal
  // (deliberately — a `new Set(IMPORTED_CONST)` at module-eval can come out
  // EMPTY under an import cycle, which is why it is not derived from the defs)
  // and the schema list lives in another file. Adding a sixth schema without
  // adding it here would make the tool visible to the model and route it into
  // chat-tools' `unknown tool` throw, which reads as a bug in the model's call
  // rather than a missing route. Compared BOTH ways so neither list can grow
  // alone.
  it("covers every shipped document tool schema, and claims nothing else", () => {
    const schemaNames = DOCUMENT_TOOL_DEFS.map((t) => t.name).sort();
    expect(schemaNames.filter((n) => !isDocumentTool(n))).toEqual([]);
    expect(schemaNames).toEqual(
      ["create_document", "delete_document", "get_document", "list_documents", "update_document"],
    );
  });
});

// ★★★ THE MODEL IS THE ONLY AUTHOR OF `paragraph.html` — there is no
// RichTextEditor on any document surface — so the schema description is not
// documentation, it is the input contract. S3a widened the allow-list to nine
// document-only tags while the description still named the old seven and said
// everything else is unwrapped; the sanitizer kept `<mark>` that nothing ever
// asked for. These tests tie the ADVERTISED set to what the WRITE BOUNDARY
// actually keeps, so the two cannot drift apart again.
describe("the paragraph schema description matches the document write boundary", () => {
  const blockDescription = (
    DOCUMENT_TOOL_DEFS.find((def) => def.name === "create_document")!.input_schema as unknown as {
      properties: { blocks: { items: { description: string } } };
    }
  ).properties.blocks.items.description;

  const advertisedTags = (blockDescription.match(/HTML using ([^;]+);/)?.[1] ?? "")
    .split(/[,/\s]+/)
    .filter(Boolean);

  /** ★ Each sample LEADS with `<p>`, which is the very instruction under test.
   *  It USED to be load-bearing for a second reason too: while one shared 8-tag
   *  classifier (p/br/strong/em/ul/ol/li/a, since retired) served every sink, a
   *  sample opening with `<mark>` or `<pre>` would have been escaped to literal
   *  text and the assertion would have failed for the classifier's reason rather
   *  than the allow-list's. The "document" sink now derives its test from
   *  `DOCUMENT_ALLOWED_TAGS` and recognises both, so only the first reason is
   *  live.
   *
   *  ★★★ Block-level samples still sit AFTER a `<p>`, but NOT for the reason an
   *  earlier revision of this comment gave. It said `<pre>`/`<hr>` inside a `<p>`
   *  "is not parseable markup" — which is the exact claim the "do not restore
   *  either" note below BANS, re-promoted from a parenthetical aside into the SOLE
   *  stated reason — in the SAME FILE as its own ban. Measured 2026-08-10 against
   *  jsdom and the real exported sanitizer, not reasoned:
   *
   *    parse "<p><pre>a</pre></p>" -> "<p></p><pre>a</pre><p></p>"  (p/pre/p)
   *    parse "<p><hr></p>"         -> "<p></p><hr><p></p>"          (p/hr/p)
   *    sanitizeAiDocumentRichText("<p><pre>a</pre></p>") -> "<p></p><pre>a</pre><p></p>"
   *    sanitizeAiDocumentRichText("<p><hr></p>")         -> ""
   *
   *  So the parser auto-closes the `<p>` in BOTH cases and `pre` would still
   *  satisfy the survival assertion wrapped. Exactly ONE sample needs the leading
   *  `<p>`, and for a different reason: `hr`. `<p><hr></p>` carries no TEXT, so
   *  `sanitizeRichText`'s drop-empty rule (`htmlTextLength(html) === 0 ? ""`)
   *  discards the WHOLE value and the assertion sees `""`. The other block-level
   *  samples sit after a `<p>` only to match that shape. */
  const TAG_SAMPLE: Record<string, string> = {
    p: "<p>a</p>",
    br: "<p>a<br>b</p>",
    strong: "<p><strong>a</strong></p>",
    em: "<p><em>a</em></p>",
    u: "<p><u>a</u></p>",
    s: "<p><s>a</s></p>",
    code: "<p><code>a</code></p>",
    mark: "<p><mark>a</mark></p>",
    sub: "<p><sub>a</sub></p>",
    sup: "<p><sup>a</sup></p>",
    pre: "<p>x</p><pre>a</pre>",
    blockquote: "<p>x</p><blockquote>a</blockquote>",
    hr: "<p>x</p><hr>",
    ul: "<p>x</p><ul><li>a</li></ul>",
    ol: "<p>x</p><ol><li>a</li></ol>",
    li: "<p>x</p><ul><li>a</li></ul>",
    a: '<p><a href="https://example.test/">a</a></p>',
  };

  // ★ Anti-vacuity: an empty or unparsed list would make the survival loop
  // below assert nothing at all, and it would still be green.
  it("advertises exactly the document tag set", () => {
    expect(advertisedTags).toEqual([
      "p", "br", "strong", "em", "u", "s", "code", "pre",
      "blockquote", "mark", "sub", "sup", "hr", "ul", "ol", "li", "a",
    ]);
  });

  it("advertises only tags sanitizeAiDocumentRichText actually keeps", () => {
    for (const tag of advertisedTags) {
      const sample = TAG_SAMPLE[tag];
      expect(sample, `no sample for advertised tag <${tag}>`).toBeTruthy();
      expect(sanitizeAiDocumentRichText(sample), `<${tag}> did not survive the write boundary`)
        .toMatch(new RegExp(`<${tag}[ >]`));
    }
  });

  // ★★ Three tags the sanitizer keeps are withheld ON PURPOSE, and pinning that
  // keeps the omission a decision rather than an oversight: `h1`/`h2` because a
  // document heading is its own block kind (a heading buried in paragraph HTML
  // gets no outline level in .docx and no slide title in .pptx), and `img`
  // because it is inert until the S3c asset store exists — advertising it would
  // invite the model to emit a reference nothing can resolve.
  it("withholds h1, h2 and img", () => {
    expect(advertisedTags).not.toContain("h1");
    expect(advertisedTags).not.toContain("h2");
    expect(advertisedTags).not.toContain("img");
  });

  // ★★★ NO LONGER LOAD-BEARING FOR SURVIVAL, and this comment used to say the
  // opposite. It claimed a value LEADING with a document-only tag fails layer 1's
  // classifier and is escaped to permanently visible literal tags. That WAS true:
  // one shared 8-tag `HTML_START` (p/br/strong/em/ul/ol/li/a, since retired)
  // served every sink,
  // so `<mark>`, `<pre>`, `<hr>` and the rest of the document-only set were read
  // as plain text and `plainToHtml` escaped the WHOLE value — open-followups §107
  // at the document sink, on the tags this very schema advertises.
  //
  // The classifier is now DERIVED per sink from that sink's own allow-list, so the
  // document sink recognises every one of the 20 tags in `DOCUMENT_ALLOWED_TAGS`
  // as an opener and a leading `<mark>` passes through as markup. The test below
  // used to pin the escaping and now pins the survival.
  //
  // ★★ KEEP the instruction, but for ONE measured reason and not the two obvious
  // ones. Measured 2026-08-09 by probe, both renderer families:
  //   - HTML/PDF: bare inline content is emitted verbatim, so it lands between
  //     <header> and <footer> with NO <p> around it — no paragraph semantics and
  //     no paragraph spacing. This is the whole of what the instruction buys.
  //   - DOCX/PPTX: `htmlToRichLines` opens a line on first text when none is
  //     current (rich-text-runs.ts pushText), so bare and wrapped produce
  //     BYTE-IDENTICAL RichLine[]. The wrapper is a no-op on this path.
  // ★ Two justifications that read well and are FALSE — do not restore either:
  // "<pre>/<hr> inside a <p> is not parseable" (the parser auto-closes the <p>
  // and yields a correct p/pre/p) and "bare inline content has no block to
  // render" (refuted by the DOCX/PPTX result above).
  // ★★★ THE FIRST ONE CAME BACK. A later commit on this same branch re-promoted
  // it into the TAG_SAMPLE comment ABOVE — in this same file, above this ban — as
  // the SOLE reason the block-level samples are unwrapped, and it was measured and
  // corrected a second time. Before writing any reason for those sample shapes,
  // read that comment: the real one is `hr`'s drop-empty rule, not parseability.
  // ★ The schema's own rationale in chat-tool-defs-documents.ts USED to be wrong
  // for the same reason this comment was — it told the model the value "is stored
  // as literal visible text" otherwise, which is the §107 behaviour this slice
  // removed. That clause is gone; the instruction itself stayed, for the measured
  // reason above. Confirm with
  // `grep -n "literal visible text" src/app/chat-tool-defs-documents.ts`
  // (no hits).
  it("tells the model to start the value with <p>", () => {
    expect(blockDescription).toMatch(/start the value with <p>/i);
  });

  it("keeps a leading document-only tag as markup, wrapped or not", () => {
    expect(sanitizeAiDocumentRichText("<p><mark>keep</mark></p>")).toContain("<mark>");
    const unwrapped = sanitizeAiDocumentRichText("<mark>keep</mark> and more");
    expect(unwrapped).toContain("<mark>");
    // The §107 regression in miniature: the whole value escaped into literal text.
    expect(unwrapped).not.toContain("&lt;mark&gt;");
  });
});

describe("boundary guards", () => {
  // ★★★ THE set_task_dependencies SHAPE (chat-tools.ts's own guard on
  // `dependencies` is the precedent): a non-array must be refused, never
  // reinterpreted. ★★ Its CONSEQUENCE differs from that precedent and from
  // what the plan claimed — a missing check here does NOT erase the document
  // (see requireOps in chat-tools-documents.ts for the measurement), it
  // silently DISCARDS the model's ops while reporting success. Refusal-reading-
  // as-success either way, which is what makes it worth guarding.
  // Mutation-proved: weakening requireOps to `return []` for a non-array makes
  // this and the test below go red.
  it("throws on a non-array ops rather than treating it as a clear", async () => {
    const d = makeDispatcher();

    // ★★★ MATCH THE SPECIFIC MESSAGE, not a loose /ops/i. The plan's regex was
    // /ops/i, which ALSO matches "supply ops, a title, or both" — so with the
    // array check deleted this test still passed, on a different error, from a
    // different branch. Measured, not reasoned: weakening requireOps to
    // `return []` left the loose form GREEN.
    await expect(runDocumentTool(d, "update_document", { id: 1, ops: "delete everything" })).rejects.toThrow(
      /ops must be an array/i,
    );
    expect(d.updateDocument).not.toHaveBeenCalled();

    // ★★ The line above is an ABSENCE assertion and is vacuous on its own —
    // a dispatcher that could never be reached would satisfy it too. This
    // proves the same dispatcher IS reachable through the same call shape.
    await expect(
      runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }] }),
    ).resolves.toMatchObject({ applied: 1 });
    expect(d.updateDocument).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE DISCRIMINATING CASE, and the only one where a missing array check
  // reaches the dispatcher at all. Without a title, a non-array degrading to
  // `[]` still throws ("supply ops, a title, or both"), so that shape cannot
  // tell a present guard from an absent one. WITH a title it can: the write
  // proceeds, the model's ops are silently discarded, and the tool reports the
  // rename as success while every edit the model asked for vanished.
  it("throws on a non-array ops even when a title would otherwise carry the write", async () => {
    const d = makeDispatcher();
    await expect(
      runDocumentTool(d, "update_document", { id: 1, title: "Renamed", ops: { op: "replaceAll" } }),
    ).rejects.toThrow(/ops must be an array/i);
    expect(d.updateDocument).not.toHaveBeenCalled();
    // Paired positive — see the test above.
    await expect(runDocumentTool(d, "update_document", { id: 1, title: "Renamed" })).resolves.toBeTruthy();
    expect(d.updateDocument).toHaveBeenCalledTimes(1);
  });

  it("throws when the document does not exist", async () => {
    const d = makeDispatcher({ getDocument: vi.fn(() => null) });
    await expect(runDocumentTool(d, "get_document", { id: 9 })).rejects.toThrow(/not found/i);
  });

  it("requires a numeric id", async () => {
    await expect(runDocumentTool(makeDispatcher(), "delete_document", {})).rejects.toThrow(
      /id must be a number/i,
    );
  });

  // A PARTIAL application resolves and reports what it refused. (A write where
  // applied === 0 throws instead — see below.)
  it("surfaces rejected ops alongside a partial application", async () => {
    const d = makeDispatcher({
      updateDocument: vi.fn(() => ({
        id: 1,
        title: "Status",
        blockCount: 2,
        applied: 1,
        rejected: ["op 1: delete index 9 out of range"],
        removed: 0,
      })),
    });
    const out = await runDocumentTool(d, "update_document", {
      id: 1,
      // ★ `expectHash` is REQUIRED on a delete at this boundary now. It is a
      // placeholder rather than a real token because the dispatcher is MOCKED
      // here — the engine never runs, so nothing compares it. What this test
      // pins is that a partial application's `rejected` list reaches the
      // caller, not the range guard that produced the canned string.
      ops: [{ op: "append", block: { type: "pageBreak" } }, { op: "delete", index: 9, expectHash: "t9" }],
    });
    expect(out).toMatchObject({ applied: 1, rejected: ["op 1: delete index 9 out of range"] });
  });

  // Mutation-proved: deleting the `applied === 0` throw and returning the
  // result makes this go red.
  it("throws when nothing could be applied, so a refusal never reads as success", async () => {
    const refusing = vi.fn(() => ({
      id: 1,
      title: "Status",
      blockCount: 1,
      applied: 0,
      rejected: ["op 0: delete index 9 out of range"],
      removed: 0,
    }));
    const d = makeDispatcher({ updateDocument: refusing });

    await expect(
      // ★ Placeholder token — see the partial-application test above. It must
      // be PRESENT so the refusal under test is the dispatcher's `applied: 0`,
      // not this layer's missing-expectHash guard; the paired
      // `toHaveBeenCalledTimes(1)` below is what proves the difference.
      runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "delete", index: 9, expectHash: "t9" }] }),
    ).rejects.toThrow(/no operation could be applied/i);
    // Paired positive: the throw is the ROUTING layer's, not a failure to
    // reach the dispatcher — it was called, and its refusal is what threw.
    expect(refusing).toHaveBeenCalledTimes(1);
  });

  // ★★ THE SEAM between the two rules above. `applied === 0` is legitimate
  // when a title was supplied: the rename applied even though no op did, so
  // this is a partial application, not a wholly-refused write, and it must
  // RESOLVE with the refusals reported rather than throw.
  it("resolves a title change whose ops were all refused, reporting the refusals", async () => {
    const d = makeDispatcher({
      updateDocument: vi.fn(() => ({
        id: 1,
        title: "Status",
        blockCount: 1,
        applied: 0,
        rejected: ["op 0: delete index 9 out of range"],
        removed: 0,
      })),
    });
    const out = await runDocumentTool(d, "update_document", {
      id: 1,
      title: "Renamed",
      // ★ Placeholder token — the dispatcher is mocked, so nothing compares
      // it; it must merely be present to reach the dispatcher at all.
      ops: [{ op: "delete", index: 9, expectHash: "t9" }],
    });
    expect(out).toMatchObject({ applied: 0, rejected: ["op 0: delete index 9 out of range"] });
  });

  it("renames with no ops at all", async () => {
    const update = vi.fn(() => ({ id: 1, title: "Status", blockCount: 1, applied: 0, rejected: [], removed: 0 }));
    const d = makeDispatcher({ updateDocument: update });
    await expect(runDocumentTool(d, "update_document", { id: 1, title: "Renamed" })).resolves.toMatchObject({
      id: 1,
    });
    expect(update).toHaveBeenCalledWith(1, [], "Renamed");
  });

  it("refuses an update that asks for nothing", async () => {
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "update_document", { id: 1 })).rejects.toThrow(/supply ops, a title/i);
    expect(d.updateDocument).not.toHaveBeenCalled();
    // Paired positive — see the non-array test.
    await expect(runDocumentTool(d, "update_document", { id: 1, title: "T" })).resolves.toBeTruthy();
    expect(d.updateDocument).toHaveBeenCalledTimes(1);
  });

  it("throws when the document to update does not exist", async () => {
    const d = makeDispatcher({ updateDocument: vi.fn(() => null) });
    await expect(runDocumentTool(d, "update_document", { id: 9, title: "T" })).rejects.toThrow(/not found/i);
  });

  // ★★★ THE CHAT FILE CARD'S PARSE CONTRACT, pinned at the seam rather than
  // trusted across it. chat-tool-block.tsx renders a card only for
  // `{id: integer > 0, title: non-empty after trim, blockCount: integer >= 0}`
  // and falls back to the plain tool block on ANY deviation — so a missing or
  // blank `title` here does not fail loudly, it just stops offering the user
  // the document they were watching get edited. `update_document` shipped
  // without `title` in the original contract, which would have meant no card
  // after any successful edit; this test is what stops that recurring.
  it("returns the three fields the chat file card requires", async () => {
    const out = (await runDocumentTool(makeDispatcher(), "update_document", {
      id: 1,
      ops: [{ op: "append", block: { type: "pageBreak" } }],
    })) as { id: number; title: string; blockCount: number };

    expect(Number.isInteger(out.id) && out.id > 0).toBe(true);
    expect(typeof out.title === "string" && out.title.trim().length > 0).toBe(true);
    expect(Number.isInteger(out.blockCount) && out.blockCount >= 0).toBe(true);
  });

  it("reports what replaceAll removed", async () => {
    const d = makeDispatcher({
      updateDocument: vi.fn(() => ({ id: 1, title: "Status", blockCount: 1, applied: 1, rejected: [], removed: 4 })),
    });
    const out = await runDocumentTool(d, "update_document", {
      id: 1,
      ops: [{ op: "replaceAll", blocks: [{ type: "pageBreak" }] }],
    });
    expect(out).toMatchObject({ removed: 4 });
  });
});

describe("the read and create routes", () => {
  it("lists documents", async () => {
    await expect(runDocumentTool(makeDispatcher(), "list_documents", {})).resolves.toEqual([
      { id: 1, title: "Status", blockCount: 1, updatedAt: doc.updatedAt },
    ]);
  });

  // ★★ THE DOCUMENT IS STILL RETURNED IN FULL — `blockTokens` is ADDITIVE. The
  // model needs the blocks themselves to compose an edit, so this asserts the
  // whole document is present and the tokens ride ALONGSIDE it. A fix that
  // returned tokens INSTEAD of blocks would satisfy the token test below while
  // making update_document unusable.
  it("reads one document in full", async () => {
    await expect(runDocumentTool(makeDispatcher(), "get_document", { id: 1 })).resolves.toEqual({
      ...doc,
      blockTokens: doc.blocks.map(blockToken),
    });
  });

  // ★★★ THE OTHER HALF OF THE CONCURRENCY LOOP. `update_document` REFUSES a
  // replace/delete/move with no `expectHash` (see below), so a model that
  // cannot obtain one here cannot make a targeted edit at all. The two are a
  // pair: this is the only place a token is handed out.
  // ★★ A PARALLEL ARRAY, never a field on DocBlock — the token is model-facing
  // plumbing, and a field on the block would be sanitized away on some write
  // paths and persisted on others.
  it("returns one blockToken per block, in block order", async () => {
    const twoBlocks = {
      ...doc,
      blocks: [
        { type: "paragraph" as const, html: "<p>a</p>" },
        { type: "heading" as const, level: 2 as const, text: "B" },
      ],
    };
    const res = (await runDocumentTool(makeDispatcher({ getDocument: () => twoBlocks }), "get_document", {
      id: 1,
    })) as { blocks: DocBlock[]; blockTokens: string[] };
    expect(res.blockTokens).toEqual(twoBlocks.blocks.map(blockToken));
    // ★ ORDER, not just membership: a token array the model indexes in
    // parallel with `blocks` is wrong in the most dangerous way if it is
    // sorted or deduplicated, so the two distinct blocks must yield two
    // distinct tokens in the same positions as the blocks that made them.
    expect(res.blockTokens).toHaveLength(2);
    expect(res.blockTokens[0]).not.toBe(res.blockTokens[1]);
    expect(res.blocks).toHaveLength(2);
  });

  it("requires a non-blank title to create", async () => {
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "create_document", { title: "   " })).rejects.toThrow(
      /title is required/i,
    );
    expect(d.createDocument).not.toHaveBeenCalled();
    // Paired positive — see the non-array test.
    await expect(runDocumentTool(d, "create_document", { title: "New" })).resolves.toMatchObject({ id: 2 });
    expect(d.createDocument).toHaveBeenCalledTimes(1);
  });

  // Blocks are passed through UNVALIDATED on purpose: the model-input
  // allow-list is ai-document-blocks.ts's job, applied by the dispatcher
  // (Task 18). This layer only proves the value reaches it untouched.
  it("passes the raw blocks and the trimmed title to the dispatcher", async () => {
    const create = vi.fn(() => ({ id: 2, title: "New", blockCount: 1 }));
    const blocks = [{ type: "pageBreak" }];
    await runDocumentTool(makeDispatcher({ createDocument: create }), "create_document", {
      title: "  New  ",
      blocks,
    });
    expect(create).toHaveBeenCalledWith("New", blocks);
  });

  it("throws when the document to delete does not exist", async () => {
    const d = makeDispatcher({ deleteDocument: vi.fn(() => ({ deleted: false, restorableVersionId: null })) });
    await expect(runDocumentTool(d, "delete_document", { id: 9 })).rejects.toThrow(/not found/i);
  });

  it("returns the restorable version id on a delete", async () => {
    await expect(runDocumentTool(makeDispatcher(), "delete_document", { id: 1 })).resolves.toEqual({
      deleted: true,
      restorableVersionId: 7,
    });
  });

  it("throws on a name it does not route", async () => {
    await expect(runDocumentTool(makeDispatcher(), "burn_document", {})).rejects.toThrow(
      /unknown document tool/i,
    );
  });

  it("tolerates a non-object input", async () => {
    await expect(runDocumentTool(makeDispatcher(), "delete_document", "nonsense")).rejects.toThrow(
      /id must be a number/i,
    );
  });
});

// ★★★ THE OUTER DOOR WAS CLOSED AND THE INNER ONE WAS OPEN. The array-ness
// guard above validates the ops ARRAY and stopped there; the schema declares
// each op `required: ["op"]` only, so a model may legally omit `blocks`/`block`
// and nothing looked inside a single op.
//
// ★★★ AND HERE THE OMISSION REALLY DID DELETE. Measured through the whole
// chain: `{op:"replaceAll"}` with no `blocks` reached use-document-tools' per-op
// `sanitizeAiDocBlocks(op.blocks)`, which returns `[]` for a non-array, so the
// engine saw a well-formed "replace everything with nothing", wiped every block
// and returned `changed:true, rejected:[]`. The model is told it succeeded and
// tells the user so. Unlike the ops-array case above — which discards rather
// than destroys — this one loses content.
describe("per-op payload guards", () => {
  const update = (ops: unknown) => runDocumentTool(makeDispatcher(), "update_document", { id: 1, ops });

  it("refuses a replaceAll whose blocks field is missing", async () => {
    await expect(update([{ op: "replaceAll" }])).rejects.toThrow(/replaceAll requires a blocks array/i);
  });

  it("refuses a replaceAll whose blocks field is not an array", async () => {
    await expect(update([{ op: "replaceAll", blocks: null }])).rejects.toThrow(/replaceAll requires a blocks array/i);
    await expect(update([{ op: "replaceAll", blocks: "everything" }])).rejects.toThrow(
      /replaceAll requires a blocks array/i,
    );
  });

  it.each(["append", "insert", "replace"] as const)("refuses a %s with no block", async (op) => {
    await expect(update([{ op, index: 0 }])).rejects.toThrow(new RegExp(`${op} requires a block`, "i"));
  });

  it("names the offending op by INDEX, not just the kind", async () => {
    // ★ A batch is the realistic shape — "the second one" is the only thing
    // that lets the model fix its own call rather than resend the lot.
    await expect(
      update([{ op: "append", block: { type: "pageBreak" } }, { op: "replaceAll" }]),
    ).rejects.toThrow(/^op 1: /);
  });

  // ★★★ THE CONTROL, and the reason this guard tests SHAPE rather than
  // truthiness. `replaceAll: []` is a legitimate request — clear the document —
  // and the engine's before-image preserves what it replaced. A guard written
  // as `!op.blocks` would refuse it and break a real operation while every
  // refusal case above still passed.
  it("still accepts an EXPLICIT empty replaceAll and reaches the dispatcher", async () => {
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "replaceAll", blocks: [] }] })).resolves.toMatchObject({ id: 1 });
    expect(d.updateDocument).toHaveBeenCalledWith(1, [{ op: "replaceAll", blocks: [] }], undefined);
  });

  it("still accepts a well-formed block op, and a delete op that carries no block at all", async () => {
    // ★ The other half of the control: `delete` legitimately has NO `block`
    // field, so a guard that demanded one on every op would break it. Asserted
    // through to the dispatcher so "accepted" means reached, not merely
    // not-thrown.
    // ★★ It DOES need an `expectHash` — that is a separate precondition from
    // the block-shape guard this case exists for, and the two are pinned
    // apart: this one proves a delete needs no BLOCK, while the expectHash
    // describe block proves it needs a TOKEN.
    const d = makeDispatcher();
    const ops = [
      { op: "append", block: { type: "pageBreak" } },
      { op: "delete", index: 0, expectHash: "t0" },
    ];
    await expect(runDocumentTool(d, "update_document", { id: 1, ops })).resolves.toMatchObject({ id: 1 });
    expect(d.updateDocument).toHaveBeenCalledWith(1, ops, undefined);
  });

  // ★★★ `typeof x === "object"` IS NOT A BLOCK TEST, and this guard shared the
  // weak version with `applyOps`: `42`, `"str"` and `null` were refused, but
  // `[]` and `{}` sailed through, were stored verbatim, reported as success and
  // dropped on the next load.
  it.each([
    ["an empty array", []],
    ["an empty object", {}],
    ["an object with a non-string type", { type: 7 }],
  ])("refuses %s as a block", async (_label, block) => {
    await expect(update([{ op: "append", block }])).rejects.toThrow(/append requires a block/i);
  });

  it("still accepts every real block shape, through to the dispatcher", async () => {
    // ★ The control, across more than one block type — a guard hard-coding a
    // single `type` would pass a one-shape control while refusing most real
    // model output.
    const d = makeDispatcher();
    const ops = [
      { op: "append", block: { type: "pageBreak" } },
      { op: "append", block: { type: "heading", level: 1, text: "H" } },
      { op: "append", block: { type: "paragraph", html: "<p>x</p>" } },
    ];
    await expect(runDocumentTool(d, "update_document", { id: 1, ops })).resolves.toMatchObject({ id: 1 });
    expect(d.updateDocument).toHaveBeenCalledWith(1, ops, undefined);
  });

  // ★★ THE TRIM ASYMMETRY. `create_document` trimmed its title; this route did
  // not, so `"   "` reached the engine, which caps+trims it to empty, refuses
  // the rename and pushes a rejection belonging to NO op — and a caller
  // deriving applied-count from `ops.length - rejected.length` could report a
  // NEGATIVE number. Trimming here means a whitespace-only title is simply
  // absent, which is what the caller meant.
  it("treats a whitespace-only title as absent, like create_document does", async () => {
    const d = makeDispatcher();
    await expect(
      runDocumentTool(d, "update_document", {
        id: 1,
        // ★ Present only to satisfy the expectHash precondition — this case is
        // about the TITLE being trimmed to absent, and needs a delete that
        // actually reaches the dispatcher to show it.
        ops: [{ op: "delete", index: 0, expectHash: "t0" }],
        title: "   ",
      }),
    ).resolves.toMatchObject({ id: 1 });
    expect(d.updateDocument).toHaveBeenCalledWith(1, [{ op: "delete", index: 0, expectHash: "t0" }], undefined);
  });

  it("refuses a whitespace-only title with NO ops, rather than passing an empty rename down", async () => {
    // ★ Without ops there is nothing left to do, so this is the "supply ops, a
    // title, or both" case — a clearer refusal than letting the engine reject a
    // blank rename one layer down.
    await expect(runDocumentTool(makeDispatcher(), "update_document", { id: 1, title: "   " })).rejects.toThrow(
      /supply ops, a title, or both/i,
    );
  });

  it("still passes a REAL title through, trimmed", async () => {
    // ★ The control: a fix that dropped every title would satisfy both cases
    // above while silently disabling rename-via-update entirely.
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "update_document", { id: 1, title: "  Renamed  " })).resolves.toMatchObject({ id: 1 });
    expect(d.updateDocument).toHaveBeenCalledWith(1, [], "Renamed");
  });

  // ★★★ REFUSE ON ABSENCE — the mirror of `requireToken` on the six entity
  // tools. The ENGINE is deliberately permissive about a missing `expectHash`
  // (the hand block editor shares it and omits the field), so strictness has
  // to live HERE, where the caller is known to be a model. Without this the
  // model can overwrite a block the user edited after it read the document,
  // and chat tool writes have NO undo capture, so that loss is unrecoverable.
  //
  // ★★ it.each, NOT a `for` loop inside one `it`: a loop aborts at the first
  // failing assertion, so a regression in `move` would be INVISIBLE while
  // `replace` was also broken. Three legs report three verdicts.
  describe("the expectHash precondition", () => {
    it.each([
      ["replace", { op: "replace", index: 0, block: { type: "paragraph", html: "<p>x</p>" } }],
      ["delete", { op: "delete", index: 0 }],
      ["move", { op: "move", from: 0, to: 1 }],
    ])("refuses a %s with no expectHash, and names get_document as the way to get one", async (_kind, op) => {
      const d = makeDispatcher();
      // ★ The message must name the REMEDY, not just the rule: this is read by
      // a model that has to repair its own call without a second round trip.
      // ★ `[\s\S]` rather than the `/s` dotAll flag: this repo's tsc target is
      // below es2018, so `/s` is a TS1501 error — and vitest never
      // typechecks, so it runs GREEN while `npx tsc --noEmit` (CI) fails.
      await expect(runDocumentTool(d, "update_document", { id: 1, ops: [op] })).rejects.toThrow(
        /expectHash[\s\S]*get_document/,
      );
      // ★★ Refused BEFORE the write, which is the whole point — a guard that
      // threw afterwards would satisfy the rejects assertion above while the
      // block was already overwritten.
      expect(d.updateDocument).not.toHaveBeenCalled();
    });

    // ★★ A BLANK STRING IS NOT A TOKEN. `typeof x === "string"` alone would
    // admit `""`, which the engine then compares against a real token and
    // rejects one layer down as "changed by another writer" — a misleading
    // reason for what is actually a malformed call.
    it.each([[""], ["   "]])("refuses a blank expectHash %j rather than passing it down", async (bad) => {
      const d = makeDispatcher();
      await expect(
        runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "delete", index: 0, expectHash: bad }] }),
      ).rejects.toThrow(/expectHash/);
      expect(d.updateDocument).not.toHaveBeenCalled();
    });

    // ★★★ THE CONTROL, and without it every assertion above is satisfied by a
    // guard that refuses the three ops unconditionally — which would disable
    // targeted editing entirely while every refusal test stayed green.
    it.each([
      ["replace", { op: "replace", index: 0, block: { type: "paragraph", html: "<p>x</p>" }, expectHash: "t0" }],
      ["delete", { op: "delete", index: 0, expectHash: "t0" }],
      ["move", { op: "move", from: 0, to: 1, expectHash: "t0" }],
    ])("accepts a %s that carries one, passing it through UNTOUCHED", async (_kind, op) => {
      const d = makeDispatcher();
      await expect(runDocumentTool(d, "update_document", { id: 1, ops: [op] })).resolves.toMatchObject({ id: 1 });
      // ★ Through to the dispatcher verbatim: the engine is what compares the
      // token, so this layer must not normalise or strip it.
      expect(d.updateDocument).toHaveBeenCalledWith(1, [op], undefined);
    });

    // ★★★ THE OTHER CONTROL. append/insert/replaceAll have NO target block to
    // have been concurrently changed — `insert` at a shifted index merely puts
    // a new block one position off, which is recoverable by eye, while a
    // shifted delete removes something the user never pointed at. Requiring a
    // token here would be unsatisfiable, since no token names a block that
    // does not exist yet.
    it.each([
      ["append", { op: "append", block: { type: "paragraph", html: "<p>x</p>" } }],
      ["insert", { op: "insert", index: 0, block: { type: "paragraph", html: "<p>x</p>" } }],
      ["replaceAll", { op: "replaceAll", blocks: [] }],
    ])("accepts a %s with no expectHash — it has no target block", async (_kind, op) => {
      const d = makeDispatcher();
      await expect(runDocumentTool(d, "update_document", { id: 1, ops: [op] })).resolves.toMatchObject({ id: 1 });
      expect(d.updateDocument).toHaveBeenCalledWith(1, [op], undefined);
    });
  });

  it("refuses BEFORE reaching the dispatcher, so nothing is written", async () => {
    // ★★ The assertion that makes the refusals above meaningful: a guard that
    // threw AFTER the write would satisfy every `rejects.toThrow` here while
    // the document was already wiped.
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "replaceAll" }] })).rejects.toThrow();
    expect(d.updateDocument).not.toHaveBeenCalled();
  });
});
