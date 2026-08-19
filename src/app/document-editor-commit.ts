// Pure decision layer for the hand block editor.
//
// ★★★ DOM-FREE AND i18n-FREE BY CONTRACT. Nothing here may touch `document`,
//  `window`, DOMPurify or a translation. The React layer renders; this module
//  decides. Keeping it pure is what makes the coalescing rule testable at all.
import type { DocVersion } from "./document-versions";
import type { DocBlock } from "./document-model";
import { normalizeBlockForStorage } from "./document-model";
import type { DocMintedVersion, DocOp } from "./document-mutations";

/** How long after the last MINTED version's `savedAt` a further edit still
 *  coalesces into the same editing session — anchored to the last version
 *  actually WRITTEN, not to the previous edit: a coalesced edit mints no
 *  version, so it never advances that anchor, and a continuous burst of
 *  sub-window edits can still cross this window measured from wherever the
 *  session's last real version landed. Deliberately short: long enough that
 *  typing through a document is one session, short enough that coming back
 *  after a break records a fresh before-image. */
export const COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Is a before-image UNWARRANTED for the edit about to be applied?
 *
 * ★★ The property this preserves is that the FIRST before-image of a session
 *  holds the state before the session started — the thing a user actually
 *  reverts to. Twenty keystroke-shaped snapshots would evict that, and every
 *  AI-authored version with it, against MAX_VERSIONS_PER_DOC (20).
 *
 * ★★★ THE RUN IS ANCHORED BY IDENTITY. `anchor` is the `(id, savedAt)` PAIR
 *  the CALLER's own last commit MINTED — `DocResult.minted`, never a "newest"
 *  re-derived from the list — and `null` before it has minted one. Coalescing
 *  happens only while that exact row is still the newest.
 *
 * ★★★ BOTH HALVES OF THE PAIR ARE COMPARED, and the id alone is NOT enough.
 *  `seedMintFromWorkspace(ws, "reset")` reseeds the `documentVersion` high-water
 *  per project, so version ids restart on a project switch — while the caller's
 *  anchor is a hook ref that survives one. An id-only check therefore resumes a
 *  run onto an identically-numbered row in a DIFFERENT project. `savedAt`
 *  separates them. ★ Both comparisons are EQUALITY: no ordering, no `Date.parse`,
 *  no arithmetic, so nothing about this identity depends on a clock. (The window
 *  check further down does parse `now` — that is a separate question about
 *  RECENCY, not about whose row this is.)
 *
 * ★★★ STATE THAT PRECISELY: **a writer whose row sorts NEWEST ends the run.**
 *  An earlier revision of this line said "ANY other writer ends the run, with
 *  no per-writer case analysis", which over-claims in the direction that
 *  matters. What the check actually asks is an identity question about ONE
 *  row — the newest — not a change-detector over the whole list. So the
 *  cases it does cover are the realistic ones (a restore, an AI write, a
 *  rename, a delete, a second tab, a future user/update writer nobody has
 *  thought of yet), and the RESIDUAL is a foreign row carrying an EARLIER
 *  `savedAt` than the caller's own last one: it never becomes newest, so it
 *  does not end the run. That is strictly narrower than the defect this
 *  replaced — the caller's own row is still what a coalesced edit folds
 *  into, and the foreign writer wrote its own before-image — but it is not
 *  nothing, and it is why this says "sorts newest" rather than "any".
 *
 *  This replaced a content test (`source === "user" && op === "update"`), which
 *  a live-document restore defeats: `document-mutations.ts`'s restore-in-place
 *  writes `snapshot(liveDoc, "update", ctx)` and `ctx.source` is `"user"`, so
 *  its before-image is byte-indistinguishable from one of the editor's own.
 *  The editor coalesced onto it and overwrote the restored state with NO
 *  history entry that it had existed. Giving the restore its own DocVersionOp
 *  was rejected: `sanitizeDocumentVersions` coerces an unknown op back to
 *  `"update"`, so an older client reading the same project would silently
 *  re-open the hole on shared data.
 *
 * ★ The source/op checks below are unreachable for the ONE caller today (the
 *  block editor anchors to an `ops` mint, which is by construction a
 *  `user`/`update` row) — but that is a property of that caller, not of this
 *  function: `DocResult.minted` also reports a `rename`/`delete`/
 *  `duplicate`/`restored` mint, so a future caller anchoring to one of those
 *  reaches them. They are KEPT for that, and as a guard against a mis-passed
 *  anchor — this is an exported pure function and cannot assume its caller's
 *  discipline. The PAIR check is the load-bearing one; do not delete IT and
 *  keep them.
 */
export function shouldCoalesce(
  versions: readonly DocVersion[],
  documentId: number,
  now: string,
  anchor: DocMintedVersion | null,
): boolean {
  const newest = newestVersion(versions);
  if (!newest) return false;
  if (newest.documentId !== documentId) return false;
  if (!anchor) return false;
  if (newest.id !== anchor.id || newest.savedAt !== anchor.savedAt) return false;
  if (newest.source !== "user" || newest.op !== "update") return false;

  const nowMs = Date.parse(now);
  const savedMs = Date.parse(newest.savedAt);
  // ★ An unparseable timestamp must NOT coalesce. Coalescing on a value we
  //  cannot compare would silently drop a before-image on bad data — the
  //  failure that costs history rather than merely an extra version.
  if (Number.isNaN(nowMs) || Number.isNaN(savedMs)) return false;

  return nowMs - savedMs <= COALESCE_WINDOW_MS && nowMs >= savedMs;
}


/** ★ The caller must not have to pre-sort: this picks by `savedAt`, falling
 *  back to the higher id when two entries share a timestamp (two mutations in
 *  one tick carry an IDENTICAL `savedAt` — ids are minted in order).
 *
 * ★ The `savedAt` comparison below is a plain STRING (lexicographic) compare,
 *  not `Date.parse` — correct only because `DocVersion.savedAt` is guaranteed
 *  canonical `toISOString()` form (fixed-width UTC, millisecond precision),
 *  an invariant enforced by `isCanonicalIso` in `document-versions.ts` and
 *  documented only there. A caller passing an unsanitized/non-canonical
 *  `savedAt` here would silently misorder. */
function newestVersion(versions: readonly DocVersion[]): DocVersion | undefined {
  let best: DocVersion | undefined;
  for (const v of versions) {
    if (!best) { best = v; continue; }
    if (v.savedAt > best.savedAt || (v.savedAt === best.savedAt && v.id > best.id)) best = v;
  }
  return best;
}

/**
 * Does this paragraph's stored HTML contain an image element?
 *
 * ★★★ WHY THIS EXISTS: the shared `RichTextEditor` commits through
 *  `sanitizeRichHtml`, whose allow-list has no `img` — and `img` is a VOID
 *  element, so it does not unwrap to text, it vanishes outright. A document
 *  paragraph CAN hold one today, because model-authored paragraph HTML goes
 *  through `sanitizeDocumentHtml` (DOCUMENT_ALLOWED_TAGS is RICH_ALLOWED_TAGS
 *  plus `img`). So opening such a paragraph in the editor and typing one
 *  character would destroy the image with no error. Those paragraphs render
 *  read-only until S3c makes images first-class.
 *
 * ★ The `\b`-style boundary is load-bearing: without it "imgur" matches and a
 *  paragraph linking to imgur.com becomes uneditable for no reason.
 * ★ Operates on ALREADY-SANITIZED stored HTML, so a tag-shaped string in text
 *  content is escaped (`&lt;img&gt;`) and correctly does not match.
 */
export function paragraphHasImage(html: string): boolean {
  return /<img[\s/>]/i.test(html);
}

/** ★ RE-EXPORTED, not defined here. `document-mutations.ts` needs the same
 *  comparison for a `replace` op's `expect`, and the engine must not depend on
 *  the block editors' decision layer — see the function's own note in
 *  document-model.ts. Kept on this module's surface so its consumers
 *  (document-block-editors.tsx, this file's tests) do not have to know it
 *  moved. */
export { blockChanged, normalizeBlockForStorage } from "./document-model";

/** The single op a block edit produces. Block CONTENT is in scope for this
 *  slice; the SET of blocks is not, so nothing here appends, inserts or
 *  deletes.
 *
 *  ★★★ `expect` IS THE DRAFT'S BASELINE — the block this edit was derived
 *   from — and it is what makes the concurrent-write guard un-foolable. The
 *   in-component guard (`useBlockDraft`'s `externallyWritten`) reads refs that
 *   only advance when that row RENDERS, and a write changing the block's TYPE
 *   at an index unmounts the row with no final render, so every ref it reads is
 *   frozen at the pre-write value. `applyOps` compares this against live state
 *   at call time instead and refuses a stale one. OPTIONAL because the AI tools
 *   build their own ops and are resolving no draft of their own. */
export function replaceBlockOp(index: number, block: DocBlock, expect?: DocBlock): DocOp {
  return { op: "replace", index, block, expect };
}

/**
 * Would this block survive a load?
 *
 * ★★★ IT ASKS THE REAL LOADER, and that is the whole point. `document-model.ts`
 *  drops an empty heading, a paragraph with no visible text and an empty
 *  bullets list — three rules that a second copy here would drift from the
 *  moment a fourth is added. `sanitizeDocumentVersions` delegates to the same
 *  function for the same reason ("one implementation, not two that can
 *  drift"), so this follows an established pattern rather than inventing one.
 *
 * ★★★ SURVIVING IS NOT THE SAME AS BEING STORED UNCHANGED, which is why the
 *  commit path calls `normalizeBlockForStorage` and NOT this. An over-long
 *  paragraph survives — and comes back with every mark flattened to plain
 *  text. A predicate can only refuse; it cannot hand back the bytes the loader
 *  would keep, so a commit path built on one stores something else.
 *
 * ★ NO PRODUCTION CALLER as of this commit — the block editor moved to
 *  `normalizeBlockForStorage`. Kept as the tested statement of the loader's
 *  DROP rule (`document-editor-commit.test.ts` enumerates every dropped shape),
 *  and because a future caller that genuinely only needs the yes/no should ask
 *  for it by name rather than re-deriving `!== null`.
 *
 * ★ Both modules are DOM-FREE by contract, so this import cannot break either.
 *  Do NOT reach for DOMPurify here: `document-editor-commit.ts` is DOM-free
 *  and i18n-free by contract (see this file's header).
 */
/* ★★ NO TEST COMPARES THIS TO `normalizeBlockForStorage`, DELIBERATELY. One
 *  existed and was deleted: while this is DEFINED as `... !== null`, both sides
 *  of such an assertion move together under every mutation, so it could not
 *  fail. Measured — stubbing the normaliser to return `null` outright turned
 *  four tests in `document-editor-commit.test.ts` red and left that one green.
 *  ★ It would become a real test the moment this stops delegating (an inlined
 *  or independently reimplemented drop rule). If you ever do that, write it. */
export function blockSurvivesLoad(block: DocBlock): boolean {
  return normalizeBlockForStorage(block) !== null;
}
