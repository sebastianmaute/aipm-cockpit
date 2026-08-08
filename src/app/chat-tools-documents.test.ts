import { describe, it, expect, vi } from "vitest";
import { runDocumentTool, isDocumentTool, type DocumentToolDispatcher } from "./chat-tools-documents";
import { DOCUMENT_TOOL_DEFS } from "./chat-tool-defs-documents";

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
      ops: [{ op: "append", block: { type: "pageBreak" } }, { op: "delete", index: 9 }],
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
      runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "delete", index: 9 }] }),
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
      ops: [{ op: "delete", index: 9 }],
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

  it("reads one document in full", async () => {
    await expect(runDocumentTool(makeDispatcher(), "get_document", { id: 1 })).resolves.toEqual(doc);
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
    const d = makeDispatcher();
    const ops = [{ op: "append", block: { type: "pageBreak" } }, { op: "delete", index: 0 }];
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
      runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "delete", index: 0 }], title: "   " }),
    ).resolves.toMatchObject({ id: 1 });
    expect(d.updateDocument).toHaveBeenCalledWith(1, [{ op: "delete", index: 0 }], undefined);
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

  it("refuses BEFORE reaching the dispatcher, so nothing is written", async () => {
    // ★★ The assertion that makes the refusals above meaningful: a guard that
    // threw AFTER the write would satisfy every `rejects.toThrow` here while
    // the document was already wiped.
    const d = makeDispatcher();
    await expect(runDocumentTool(d, "update_document", { id: 1, ops: [{ op: "replaceAll" }] })).rejects.toThrow();
    expect(d.updateDocument).not.toHaveBeenCalled();
  });
});
