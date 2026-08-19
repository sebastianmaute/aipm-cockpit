import { describe, it, expect } from "vitest";
import {
  shouldCoalesce,
  COALESCE_WINDOW_MS,
  paragraphHasImage,
  blockChanged,
  replaceBlockOp,
  blockSurvivesLoad,
  normalizeBlockForStorage,
} from "./document-editor-commit";
import type { DocVersion } from "./document-versions";
import { MAX_HTML_TEXT_CHARS, type DocBlock } from "./document-model";

const version = (over: Partial<DocVersion> = {}): DocVersion => ({
  id: 1,
  documentId: 7,
  title: "D",
  blocks: [],
  savedAt: "2026-08-18T10:00:00.000Z",
  source: "user",
  op: "update",
  ...over,
});

const SAVED = "2026-08-18T10:00:00.000Z"; // the `version()` fixture's savedAt
const NOW = "2026-08-18T10:00:30.000Z"; // 30s after the fixture's savedAt

/** The anchor a caller holds: the `(id, savedAt)` PAIR its own last commit
 *  minted (`DocResult.minted`). Defaults to the fixture's savedAt so a call
 *  only has to spell the half it is varying. */
const anchor = (id: number, savedAt: string = SAVED) => ({ id, savedAt });

describe("shouldCoalesce", () => {
  it("is false when the document has no versions — the first edit of a session always records", () => {
    expect(shouldCoalesce([], 7, NOW, null)).toBe(false);
  });

  it("is true when the newest version is a recent user update on the same document", () => {
    expect(shouldCoalesce([version()], 7, NOW, anchor(1))).toBe(true);
  });

  it("is false when the newest version belongs to a DIFFERENT document", () => {
    expect(shouldCoalesce([version({ documentId: 99 })], 7, NOW, anchor(1))).toBe(false);
  });

  // The three run-breaking cases. Each records a different actor's change, so
  // it is never the current session's start state.
  it("is false when the newest version is an AI write", () => {
    expect(shouldCoalesce([version({ source: "ai" })], 7, NOW, anchor(1))).toBe(false);
  });

  it("is false when the newest version is not an update", () => {
    for (const op of ["rename", "delete", "duplicate", "restored"] as const) {
      expect(shouldCoalesce([version({ op })], 7, NOW, anchor(1))).toBe(false);
    }
  });

  it("is false when the newest version is outside the window", () => {
    const stale = version({ savedAt: "2026-08-18T09:00:00.000Z" });
    expect(shouldCoalesce([stale], 7, NOW, anchor(1, "2026-08-18T09:00:00.000Z"))).toBe(false);
  });

  it("reads the NEWEST version, not the last array element", () => {
    // A caller must not have to pre-sort. Newest here is the AI write, which
    // breaks the run — if this read the last element it would return true.
    const older = version({ id: 1, savedAt: "2026-08-18T10:00:20.000Z", source: "user" });
    const newer = version({ id: 2, savedAt: "2026-08-18T10:00:25.000Z", source: "ai" });
    expect(shouldCoalesce([newer, older], 7, NOW, anchor(2, "2026-08-18T10:00:25.000Z"))).toBe(false);
  });

  it("is false on an unparseable savedAt rather than coalescing blindly", () => {
    expect(shouldCoalesce([version({ savedAt: "not a date" })], 7, NOW, anchor(1, "not a date"))).toBe(false);
  });

  it("breaks a savedAt tie by the HIGHER id, not array order", () => {
    const shared = "2026-08-18T10:00:00.000Z";
    const higherId = version({ id: 2, documentId: 99, source: "ai", op: "rename", savedAt: shared });
    const lowerId = version({ id: 1, documentId: 7, source: "user", op: "update", savedAt: shared });
    // higherId is listed FIRST on purpose: "return the last array element" and
    // "return the higher id" must disagree here, or the fixture can't tell them
    // apart. Last-element would read lowerId (documentId 7, user/update — would
    // coalesce); the correct tie-break reads higherId (documentId 99 — does not).
    expect(shouldCoalesce([higherId, lowerId], 7, NOW, anchor(2, shared))).toBe(false);
  });

  it("coalesces exactly at the window boundary (inclusive)", () => {
    const savedAt = "2026-08-18T10:00:00.000Z";
    const atBoundary = new Date(Date.parse(savedAt) + COALESCE_WINDOW_MS).toISOString();
    expect(shouldCoalesce([version({ savedAt })], 7, atBoundary, anchor(1, savedAt))).toBe(true);
  });

  it("does not coalesce one millisecond past the window boundary", () => {
    const savedAt = "2026-08-18T10:00:00.000Z";
    const pastBoundary = new Date(Date.parse(savedAt) + COALESCE_WINDOW_MS + 1).toISOString();
    expect(shouldCoalesce([version({ savedAt })], 7, pastBoundary, anchor(1, savedAt))).toBe(false);
  });

  it("exposes the window as a named constant", () => {
    expect(COALESCE_WINDOW_MS).toBeGreaterThan(0);
  });

  // ★★★ THE RUN IS ANCHORED BY IDENTITY, NOT BY CONTENT. A live-document
  //  restore writes `snapshot(liveDoc, "update", ctx)` with `source: "user"`
  //  (document-mutations.ts, `case "restore"`), so it is BYTE-INDISTINGUISHABLE
  //  from one of the editor's own before-images by source+op. Without the id
  //  check the editor coalesces straight onto it, the restored state is
  //  overwritten, and NO history entry records that it ever existed.
  it("does not coalesce onto a user/update version the editor did not mint", () => {
    const mine = version({ id: 4, savedAt: "2026-08-18T10:00:00.000Z" });
    // A restore's before-image: same document, same source, same op, newer.
    const restore = version({ id: 5, savedAt: "2026-08-18T10:00:10.000Z" });
    expect(shouldCoalesce([mine, restore], 7, NOW, anchor(4))).toBe(false);
  });

  it("coalesces onto the version the editor itself last minted", () => {
    const mine = version({ id: 4 });
    expect(shouldCoalesce([mine], 7, NOW, anchor(4))).toBe(true);
  });

  // ★★★ THE CASE THE PAIR EXISTS FOR — same document, same version ID,
  //  DIFFERENT savedAt. `seedMintFromWorkspace(ws, "reset")` restarts the
  //  `documentVersion` high-water per project while the editor's anchor is a
  //  hook ref that survives a project switch, so project B really can hold
  //  version #4 on document #7 while the ref still names project A's #4. An
  //  id-only check resumes the run onto that stranger's row and suppresses
  //  the before-image; comparing savedAt too separates them.
  it("does not coalesce onto a same-id row from a different project", () => {
    // Everything else about this row invites coalescing: same document, id 4,
    // user/update, and 10s old — well inside the window. ONLY savedAt differs,
    // so the pair check is the sole thing that can return false here.
    const foreign = version({ id: 4, savedAt: "2026-08-18T10:00:20.000Z" });
    expect(shouldCoalesce([foreign], 7, NOW, anchor(4, SAVED))).toBe(false);
  });

  // ★★★ THE MIRROR OF THE CASE ABOVE, AND IT IS NOT REDUNDANT — the two tests
  //  pin the two HALVES of the pair, and a suite carrying only one of them
  //  leaves the other half free. Measured, not assumed: with only the
  //  different-project test present, replacing the whole comparison with
  //  `newest.savedAt !== anchor.savedAt` (i.e. dropping the id check outright)
  //  passed the entire suite.
  //  ★★ The case is REACHABLE, not hypothetical: `snapshot` stamps `ctx.now`,
  //   so two mutations landing in the SAME TICK carry an IDENTICAL savedAt and
  //   differ only by id — which is exactly why `newestVersion` needs an id
  //   tie-break at all, and workspace-context.tsx's mutateDocuments comment
  //   describes two renames in one tick as a real path.
  it("does not coalesce onto a same-savedAt row minted by someone else", () => {
    // Same document, same timestamp, user/update, inside the window. ONLY the
    // id differs, so the id half of the pair is the sole thing that can
    // return false here.
    const sameTick = version({ id: 5, savedAt: SAVED });
    expect(shouldCoalesce([sameTick], 7, NOW, anchor(4, SAVED))).toBe(false);
  });

  it("does not coalesce when the editor has minted nothing yet", () => {
    // A null anchor is a fresh run: the first edit ALWAYS records, so the
    // pre-session state stays the revert target even when some other writer
    // left a recent user/update sitting there.
    expect(shouldCoalesce([version({ id: 4 })], 7, NOW, null)).toBe(false);
  });

});

describe("paragraphHasImage", () => {
  it("detects an image element in stored paragraph HTML", () => {
    expect(paragraphHasImage('<p>a</p><img src="x.png">')).toBe(true);
    expect(paragraphHasImage('<p>a <img src="x.png"> b</p>')).toBe(true);
  });

  it("is false for HTML with no image", () => {
    expect(paragraphHasImage("<p>a</p>")).toBe(false);
    expect(paragraphHasImage("")).toBe(false);
  });

  it("does not match a word that merely starts with img", () => {
    // The tag boundary matters: "imgur" is not an <img>.
    expect(paragraphHasImage("<p>see imgur.com</p>")).toBe(false);
    expect(paragraphHasImage('<p><a href="https://imgur.com">x</a></p>')).toBe(false);
  });

  it("disagrees with a naive includes('<img') check on a longer tag name", () => {
    // "<imgcaption>" contains the literal substring "<img", so a naive
    // `.includes("<img")` would wrongly say yes. The real predicate requires
    // a tag BOUNDARY right after "img" (whitespace, "/" or ">") and correctly
    // says no — this fixture is where the two implementations disagree.
    const html = "<p>a <imgcaption> b</p>";
    expect(html.includes("<img")).toBe(true);
    expect(paragraphHasImage(html)).toBe(false);
  });

  it("does not match escaped text that only looks like a tag", () => {
    // Stored HTML is already sanitized, so this is literal text, not an element.
    expect(paragraphHasImage("<p>&lt;img&gt;</p>")).toBe(false);
  });

  it("matches a self-closing image tag", () => {
    expect(paragraphHasImage('<p>a</p><img src="x.png"/>')).toBe(true);
  });
});

describe("blockChanged", () => {
  it("is false for a block that was focused and left untouched", () => {
    const a: DocBlock = { type: "paragraph", html: "<p>x</p>" };
    expect(blockChanged(a, { type: "paragraph", html: "<p>x</p>" })).toBe(false);
  });

  it("is true when content differs", () => {
    const a: DocBlock = { type: "paragraph", html: "<p>x</p>" };
    expect(blockChanged(a, { type: "paragraph", html: "<p>y</p>" })).toBe(true);
  });

  it("compares nested content, not identity", () => {
    const a: DocBlock = { type: "bullets", items: ["one", "two"] };
    expect(blockChanged(a, { type: "bullets", items: ["one", "two"] })).toBe(false);
    expect(blockChanged(a, { type: "bullets", items: ["one", "three"] })).toBe(true);
  });

  it("treats an absent optional field and an omitted one as equal", () => {
    const a: DocBlock = { type: "bullets", items: ["one"] };
    expect(blockChanged(a, { type: "bullets", items: ["one"], ordered: undefined })).toBe(false);
  });

  it("catches a difference nested deep inside a table's rows", () => {
    const a: DocBlock = {
      type: "table",
      columns: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    };
    const sameShapeDifferentCell: DocBlock = {
      type: "table",
      columns: ["A", "B"],
      rows: [
        ["1", "2"],
        ["3", "5"],
      ],
    };
    expect(blockChanged(a, { ...a, rows: a.rows.map((r) => [...r]) })).toBe(false);
    expect(blockChanged(a, sameShapeDifferentCell)).toBe(true);
  });
});

describe("replaceBlockOp", () => {
  it("builds a replace op at the given index", () => {
    const block: DocBlock = { type: "heading", level: 2, text: "H" };
    expect(replaceBlockOp(3, block)).toEqual({ op: "replace", index: 3, block });
  });
});

describe("blockSurvivesLoad", () => {
  // Mirrors document-model.ts's three drop rules WITHOUT restating them — it
  // asks the real loader. A block the editor can produce but the loader
  // discards is silent data loss: it renders for the session and is gone on
  // the next load, and this slice ships no add-block control to recreate it.
  it("rejects the three shapes sanitizeProjectDocuments drops", () => {
    expect(blockSurvivesLoad({ type: "heading", level: 1, text: "   " })).toBe(false);
    expect(blockSurvivesLoad({ type: "paragraph", html: "<p></p>" })).toBe(false);
    expect(blockSurvivesLoad({ type: "bullets", items: [] })).toBe(false);
    expect(blockSurvivesLoad({ type: "bullets", items: ["", "  "] })).toBe(false);
  });

  it("accepts every block kind that survives a load", () => {
    expect(blockSurvivesLoad({ type: "heading", level: 2, text: "Q3" })).toBe(true);
    expect(blockSurvivesLoad({ type: "paragraph", html: "<p>x</p>" })).toBe(true);
    expect(blockSurvivesLoad({ type: "bullets", items: ["a"] })).toBe(true);
    expect(blockSurvivesLoad({ type: "pageBreak" })).toBe(true);
    expect(blockSurvivesLoad({ type: "dataSection", key: "tasks" })).toBe(true);
    expect(blockSurvivesLoad({ type: "table", columns: ["c"], rows: [["v"]] })).toBe(true);
  });
});

// ★★★ THE COMMIT PATH'S CONTRACT, and the reason it is a NORMALISER rather than
//  a predicate. `blockSurvivesLoad` can only refuse; it cannot hand back the
//  bytes the loader would keep, so an editor built on it stored values the next
//  load silently rewrote. Each case below is a measured instance of that drift.
describe("normalizeBlockForStorage", () => {
  it("caps a paragraph at MAX_HTML_TEXT_CHARS the way the loader does", () => {
    const long = "<p>" + "a".repeat(MAX_HTML_TEXT_CHARS + 500) + "</p>";
    const out = normalizeBlockForStorage({ type: "paragraph", html: long });
    expect(out).not.toBeNull();
    const html = (out as Extract<DocBlock, { type: "paragraph" }>).html;
    expect(html).not.toBe(long);
    // Idempotent: the value it returns is a FIXED POINT of the loader, which is
    // the whole property — commit it and the next load changes nothing.
    expect(normalizeBlockForStorage({ type: "paragraph", html })).toEqual({ type: "paragraph", html });
  });

  it("trims a heading's text", () => {
    expect(normalizeBlockForStorage({ type: "heading", level: 2, text: "  Q3  " })).toEqual({
      type: "heading",
      level: 2,
      text: "Q3",
    });
  });

  it("drops empty bullet items instead of storing them", () => {
    expect(normalizeBlockForStorage({ type: "bullets", items: ["one", "", "  ", "two"] })).toEqual({
      type: "bullets",
      items: ["one", "two"],
    });
  });

  // ★ ALL FIVE droppable shapes, one per block kind that has one — pageBreak
  //  cannot be dropped. The last two are unreachable through the editors own
  //  controls (remove-column is disabled at one column; the key select offers
  //  only registry keys), which is exactly why the PURE function has to pin
  //  them: nothing at the component layer can.
  it("returns null for exactly the blocks the loader discards", () => {
    expect(normalizeBlockForStorage({ type: "heading", level: 1, text: "   " })).toBeNull();
    expect(normalizeBlockForStorage({ type: "paragraph", html: "<p></p>" })).toBeNull();
    expect(normalizeBlockForStorage({ type: "bullets", items: ["", "  "] })).toBeNull();
    expect(normalizeBlockForStorage({ type: "table", columns: [], rows: [] })).toBeNull();
    expect(
      normalizeBlockForStorage({ type: "dataSection", key: "not-a-registry-key" } as unknown as DocBlock),
    ).toBeNull();
  });

  // ★ The two are defined in terms of each other on purpose — one rule, not two.
  it("agrees with blockSurvivesLoad on every shape", () => {
    const shapes: DocBlock[] = [
      { type: "heading", level: 1, text: "ok" },
      { type: "heading", level: 1, text: " " },
      { type: "paragraph", html: "<p>x</p>" },
      { type: "paragraph", html: "" },
      { type: "bullets", items: ["a"] },
      { type: "bullets", items: [] },
      { type: "pageBreak" },
    ];
    for (const b of shapes) {
      expect(normalizeBlockForStorage(b) !== null).toBe(blockSurvivesLoad(b));
    }
  });
});

// ★★★ THE SECOND HALF OF THE WINDOW CHECK, which had no test at all. The
//  expression is `nowMs - savedMs <= COALESCE_WINDOW_MS && nowMs >= savedMs`,
//  and a mutant dropping the second conjunct survived every other test in this
//  file: with only the first, a `now` BEFORE the anchor's `savedAt` yields a
//  NEGATIVE difference, which is trivially under the window, so the edit
//  coalesces. That is the failure that costs history rather than an extra
//  version — the before-image is suppressed on a clock the code cannot trust.
//  Reachable without malice: a device whose clock is corrected backwards, or a
//  `savedAt` written by another machine running ahead.
describe("shouldCoalesce — a clock that runs backwards must not coalesce", () => {
  const anchor = { id: 1, savedAt: SAVED };

  it("refuses when now is BEFORE the anchor's savedAt", () => {
    const before = "2026-08-18T09:59:30.000Z"; // 30s earlier than SAVED
    expect(shouldCoalesce([version()], 7, before, anchor)).toBe(false);
  });

  it("still coalesces at exactly the anchor's savedAt (the boundary is inclusive)", () => {
    expect(shouldCoalesce([version()], 7, SAVED, anchor)).toBe(true);
  });

  // ★ The companion boundary for the FIRST conjunct, so neither can be dropped
  //  without a red test: one millisecond past the window refuses, exactly at it
  //  still coalesces.
  it("coalesces at exactly the window edge and refuses one millisecond past it", () => {
    const edge = new Date(Date.parse(SAVED) + COALESCE_WINDOW_MS).toISOString();
    const past = new Date(Date.parse(SAVED) + COALESCE_WINDOW_MS + 1).toISOString();
    expect(shouldCoalesce([version()], 7, edge, anchor)).toBe(true);
    expect(shouldCoalesce([version()], 7, past, anchor)).toBe(false);
  });
});
