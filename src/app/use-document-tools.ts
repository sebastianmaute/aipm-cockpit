// src/app/use-document-tools.ts — implementation of the five document tools
// the AI chat calls through DocumentToolDispatcher (chat-tools-documents.ts's
// interface). This is the WRITE PATH: every mutation composes
// document-mutations.ts's single mutation entry point (`mutateDocuments`,
// threaded through from `useWorkspace()`) with the model-input allow-list
// (ai-document-blocks.ts's `sanitizeAiDocBlocks`).
//
// ★★★ NOT coverage-excluded, and deliberately unlike the render-scope UI-glue
// hooks vitest.config.ts's coverage.exclude lists (use-calendar-integrations.ts
// and its siblings, which wire live DOM/render state to user-interaction
// handlers and are validated by task-manager's characterization suites + e2e
// instead). This hook holds real decisions — which mutation kind a tool call
// becomes, what gets sanitized before it reaches storage, and how each tool's
// result is shaped for the model (and, via the chat card, for the user) — so
// it is unit-tested directly through use-chat-dispatcher.test.tsx's existing
// renderDispatcher/runTool harness, the same way use-chat-dispatcher.ts itself
// is tested rather than excluded (verified against vitest.config.ts — it does
// NOT list use-chat-dispatcher.ts, despite an earlier plan draft assuming it
// did).
//
// ★★ Every write refuses in a read-only popout (mirrors use-chat-dispatcher's
// own per-tool `isReadOnly` guards) — chat tool writes have no undo capture,
// so a popout mirror must never be able to reach mutateDocuments at all.
import { useMemo, useRef, useEffect } from "react";
import type { LogActivityAsFn } from "./activity-log-context";
import { sanitizeAiDocBlocks } from "./ai-document-blocks";
import { MAX_BLOCKS_PER_DOC } from "./document-model";
import type { DocOp } from "./document-mutations";
import type { DocumentToolDispatcher } from "./chat-tools-documents";
import { useWorkspace } from "./workspace-context";

/** The engine's block-cap reason, reproduced byte-for-byte.
 *
 *  ★★ `blockLimitReason` (document-mutations.ts) is NOT exported, so this
 *  cannot import it — the wording is duplicated deliberately rather than
 *  widening that module's surface. Both spellings derive from the SAME
 *  `MAX_BLOCKS_PER_DOC`, so a cap change moves them together; a test pins this
 *  string against the constant so a reworded engine reason surfaces here as a
 *  diff rather than as two subtly different messages for one condition. */
function blockCapReason(count: number): string {
  return `block limit exceeded (${count} > ${MAX_BLOCKS_PER_DOC})`;
}

/** ★★★ TWO DIFFERENT REASONS A BLOCK DOES NOT SURVIVE `sanitizeAiDocBlocks`,
 *  and reporting one as the other sends the model down the wrong retry.
 *
 *  `sanitizeAiDocBlocks` routes through `sanitizeProjectDocuments`, whose
 *  `sanitizeDocument` does `.slice(0, MAX_BLOCKS_PER_DOC)` BEFORE
 *  `.map(sanitizeBlock).filter(...)` (document-model.ts) — so a long payload is
 *  TRUNCATED first and only the survivors of that truncation are ever validated.
 *  A 503-block create therefore came back three blocks shorter and was reported
 *  as "3 of 503 block(s) failed the model-input allow-list" (measured). Nothing
 *  failed an allow-list; the document exceeded a 500-block cap. A model told its
 *  blocks failed VALIDATION rewrites them; a model told it hit a CAP splits the
 *  document.
 *
 *  ★★ The slice-before-filter order is what makes this exact arithmetic rather
 *  than an estimate: `examined` blocks were the only ones the allow-list ever
 *  saw, so `examined - kept` is precisely the allow-list's drop and the rest is
 *  the cap's. Measured on both edges — 503 sent with 2 invalid inside the first
 *  500 decomposes to 3 + 2, and 503 sent with all 3 invalid blocks in the TAIL
 *  decomposes to 3 + 0, because the cap removed them before validation could. */
type BlockDrop = {
  /** How many of `sent` the allow-list actually got to look at. */
  examined: number;
  /** Blocks the block cap removed before validation ran. */
  overCap: number;
  /** Blocks the allow-list rejected among those it examined. */
  failedAllowList: number;
};

function classifyBlockDrop(sent: number, kept: number): BlockDrop {
  const examined = Math.min(sent, MAX_BLOCKS_PER_DOC);
  return { examined, overCap: sent - examined, failedAllowList: examined - kept };
}

/** ★★★ TWO OP-INDEX SPACES MET IN ONE `rejected` ARRAY AND NEITHER WAS LABELLED.
 *
 *  `selfRejected` below is built in `ops.forEach((op, i) => …)` — the CALLER's
 *  index. `applyOps` (document-mutations.ts) indexes `ops.entries()` of the
 *  array it RECEIVES, which is `cleanOps` — shorter by every op this function
 *  rejected before it. So every engine index was shifted down by the number of
 *  self-rejections preceding it. Measured: `[badBlock, {op:"delete",index:42}]`
 *  produced `["op 0: block failed the model-input allow-list", "op 0: delete
 *  index 42 out of range 0..0"]` — two contradictory "op 0" lines, and the model
 *  told to retry the wrong op. Since e27fc155 the chat transcript's document
 *  card renders these, so the user reads the contradiction too.
 *
 *  Remapping restores ONE space (the caller's), which is the only one either
 *  audience can act on: the model sent `ops`, and the card shows `ops`.
 *
 *  ★★ IT PRESERVES THE `/^op \d+:/` SHAPE BY CONSTRUCTION — an entry that
 *  matched still matches, and one that did not still does not. That is what
 *  keeps the `applied` arithmetic below correct: its filter counts op-scoped
 *  entries to separate them from MUTATION-scoped ones (a blank title, a block
 *  cap), and renumbering must not move that count in either direction. */
const OP_INDEX_PREFIX = /^op (\d+):/;

function remapOpIndex(entry: string, callerIndexOf: readonly number[]): string {
  const match = OP_INDEX_PREFIX.exec(entry);
  if (!match) return entry;
  const callerIndex = callerIndexOf[Number(match[1])];
  // Defensive: applyOps only ever indexes the array it was handed, so every
  // engine index is in range. A miss leaves the entry verbatim rather than
  // inventing a number.
  if (callerIndex === undefined) return entry;
  return `op ${callerIndex}:${entry.slice(match[0].length)}`;
}

/** ★★★ `logActivityAs` is THREADED (ChatDispatcherArgs → useChatDispatcher →
 *  here), never obtained by calling `useActivityLog()` in this file: that hook
 *  owns its own `useState`, so a second call would build an independent log
 *  that the Activity panel — which renders task-manager's instance — never
 *  reads. Rows would be written and silently never appear.
 *
 *  ★★ ONE ROW PER WRITE, AND ONLY WHEN SOMETHING ACTUALLY CHANGED. A create, a
 *  rename, an ops edit and a delete are each "the assistant wrote a document" —
 *  not one row per block or per op. A refused write (read-only popout, a create
 *  whose blocks failed the allow-list, an update whose every op was rejected, a
 *  delete of a missing id) must emit NOTHING: the row is a record of what
 *  happened, and `applyDocMutation` reports exactly that as `changed`. Chat tool
 *  writes take no undo capture, so an activity row claiming an edit that never
 *  landed is the same false-success class the refusal paths below exist to
 *  prevent. Every write therefore gates on `result.changed` (create reaches its
 *  log only past the `if (!doc) throw`, which is the same condition).
 *
 *  ★ `activityAiDocumentWrite` is "Assistant edited a document" — ZERO `{0}`
 *  placeholders in BOTH locales (verified in i18n.ts:3853 / i18n.de.ts:3824), so
 *  `t()` renders neither arg today. They are carried anyway, exactly as
 *  `ai.inlineEdit` carries `(id, title)` against its own placeholder-free
 *  string: the entry is the audit record, and the id is what a deep-link would
 *  need. ★ `dashboard-activity-nav.ts`'s `activityViewOf("ai.documentWrite") ->
 *  "documents"` has NO production caller at all (only its own test), so the
 *  deep-link stays unreachable until something renders it — writing the row does
 *  not by itself light that path up.
 *
 *  ★ THE ACTOR IS STAMPED EVEN THOUGH `ai.documentWrite` ALREADY SAYS "ai". A
 *  consumer filtering the log by actor — "show me only what the assistant did"
 *  — must not have to carry a list of which kinds happen to imply an actor;
 *  that list would silently go stale the next time an `ai.*` kind is added. */
export function useDocumentTools(
  isReadOnly: boolean,
  logActivityAs?: LogActivityAsFn,
  /** ★★ The one-shot destructive-save bypass — see the arming site in
   *  `deleteDocument` below for why this route needs it and the panel route is
   *  not enough. */
  allowDestructiveSave?: () => void,
): DocumentToolDispatcher {
  const { documents, documentVersions, mutateDocuments } = useWorkspace();

  // Refs, so the dispatcher identity stays stable (useMemo below never
  // rebuilds on a documents/versions change) and back-to-back tool calls in
  // one turn read each other's writes — the same pattern use-chat-dispatcher
  // already uses for tasks/raid/changes/etc.
  const documentsRef = useRef(documents);
  const versionsRef = useRef(documentVersions);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);
  useEffect(() => {
    versionsRef.current = documentVersions;
  }, [documentVersions]);

  // ★★ A MIRROR, for the same reason `use-document-assets.ts` and
  // `use-bulk-operations.ts` keep one: the producer (`use-storage-backend.ts`)
  // re-creates this arrow every render, so taking it into the `useMemo` dep
  // list below would rebuild the whole dispatcher on every render of the tree —
  // defeating the stable identity the refs above exist to preserve. The ref
  // keeps the deps stable while the arming site still reads the LIVE callback.
  // Synced in an effect, never during render.
  const allowDestructiveSaveRef = useRef(allowDestructiveSave);
  useEffect(() => {
    allowDestructiveSaveRef.current = allowDestructiveSave;
  }, [allowDestructiveSave]);

  const readOnlyError = () =>
    new Error("This window is read-only; open the main window to make changes.");

  return useMemo<DocumentToolDispatcher>(
    () => ({
      listDocuments: () =>
        documentsRef.current.map((d) => ({
          id: d.id,
          title: d.title,
          blockCount: d.blocks.length,
          updatedAt: d.updatedAt,
        })),

      getDocument: (id) => documentsRef.current.find((d) => d.id === id) ?? null,

      createDocument: (title, blocks) => {
        if (isReadOnly) throw readOnlyError();
        // ★★ The model may send either HTML or plain text in a paragraph
        // block. sanitizeAiDocBlocks is the allow-list boundary — the
        // downstream structural sanitizer (document-model.ts) is DOM-free by
        // contract and cannot strip markup, so a <script> the model wrote
        // would otherwise reach storage verbatim. Applied to the model's
        // INPUT here, before it ever reaches mutateDocuments.
        const cleanBlocks = sanitizeAiDocBlocks(blocks);
        // ★★★ A DROPPED BLOCK MUST NOT BE SILENT, and create has NO channel to
        // say so: its result is `{id, title, blockCount}` (chat-tools-
        // documents.ts's DocumentToolDispatcher) with no `rejected` field, so a
        // shorter array after sanitizing simply produced a document missing a
        // section while the tool resolved and the model told the user it had
        // written the whole thing. Chat tool writes take no undo capture, so
        // "reported success, content gone" is the one outcome this path must
        // not have. THROW BEFORE THE WRITE instead: nothing is created, no
        // version row is minted, and the model gets a reason it can retry
        // against — the same shape as create_document's own "title is required"
        // refusal one layer up. Refusing the whole create is the right trade
        // here and NOT in updateDocument's replaceAll arm below, because every
        // block of a create is model-authored in this same call (there is no
        // pre-existing content to preserve by applying the survivors).
        //
        // ★★★ AND IT MUST NAME THE RIGHT REASON. A create longer than
        // MAX_BLOCKS_PER_DOC came back shorter for a reason that has nothing to
        // do with the allow-list (see `classifyBlockDrop`), and the whole point
        // of throwing is that "the model gets a reason it can retry against".
        // The two compose — a 503-block payload with 2 invalid blocks is BOTH —
        // so they are collected rather than allowed to mask one another.
        const sentBlocks = Array.isArray(blocks) ? blocks.length : 0;
        const drop = classifyBlockDrop(sentBlocks, cleanBlocks.length);
        const reasons: string[] = [];
        if (drop.overCap > 0) reasons.push(blockCapReason(sentBlocks));
        if (drop.failedAllowList > 0) {
          // ★ The denominator is `examined`, NOT `sentBlocks`: blocks past the
          // cap were never shown to the allow-list, so counting them here would
          // claim a rate over a population that was never tested.
          reasons.push(
            `${drop.failedAllowList} of ${drop.examined} block(s) failed the model-input allow-list`,
          );
        }
        if (reasons.length > 0) {
          throw new Error(`${reasons.join("; ")}; no document was created`);
        }
        const result = mutateDocuments(
          { kind: "create", title, blocks: cleanBlocks },
          "ai",
        );
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const doc = result.documents.find((d) => d.id === result.documentId);
        // Only unreachable if mutateDocuments refused the create (a blank
        // title) — chat-tools-documents.ts already requires a non-blank,
        // trimmed title before calling this, so this is a defensive invariant
        // check, not an expected path.
        if (!doc) throw new Error("title is required");
        logActivityAs?.("ai", "ai.documentWrite", doc.id, doc.title);
        return { id: doc.id, title: doc.title, blockCount: doc.blocks.length };
      },

      updateDocument: (id, ops, title) => {
        if (isReadOnly) throw readOnlyError();
        const before = documentsRef.current.find((d) => d.id === id);
        if (!before) return null;
        // Sanitize the blocks the model supplied, op by op — applied to the
        // model's INPUT only, never to the merged/stored document (re-running
        // the allow-list over already-stored bytes would rewrite content the
        // call never asked to touch).
        //
        // ★★★ A block the allow-list DROPPED must REJECT its op, never fall
        // back to the original. sanitizeAiDocBlocks([op.block]) drops a block
        // for two reasons — an unknown/invalid block type, or a paragraph
        // whose html sanitizes down to nothing (e.g. its ENTIRE content was a
        // disallowed element, so nothing survives) — and applyOps
        // (document-mutations.ts) has NO block-content validation of its own:
        // append/insert/replace apply whatever `op.block` they are given
        // unconditionally. Falling back to the unsanitized `op` here would
        // therefore store the model's RAW block verbatim — for the paragraph
        // case, the raw unsanitized HTML — reported as a successful write,
        // silently dropped only on the next load (sanitizeProjectDocuments
        // rejects it then, too late). Collecting a rejection here instead
        // means the op never reaches mutateDocuments at all.
        //
        // ★★ THE SECOND OF THOSE TWO REASONS NEEDS A WRAPPED PAYLOAD TO
        // REPRODUCE, and a test written the obvious way never reaches the
        // branch it claims to cover. A BARE "<script>alert(1)</script>" does
        // not open with a tag the "document" sink keeps — `isHtmlStart`
        // (html-start.ts) derives that test from `DOCUMENT_ALLOWED_TAGS`, which
        // carries no `script` — so layer 1 treats it as PLAIN TEXT and ESCAPES
        // it; the block is safe,
        // non-empty, and SURVIVES. "<p><script>alert(1)</script></p>" starts
        // with <p>, so DOMPurify sees real markup and strips the tag AND its
        // content, leaving "<p></p>", which the next sanitizeRichText pass's
        // empty rule collapses to "" — and an empty paragraph then fails
        // document-model.ts's structural check. That is the input that
        // actually gets dropped.
        const selfRejected: string[] = [];
        const cleanOps: DocOp[] = [];
        // ★★ Parallel to `cleanOps`: `callerIndexOf[engineIndex]` is the index
        // that op had in the CALLER's `ops`. Every push goes through `keepOp` so
        // the two arrays cannot drift — a bare `cleanOps.push` at one of the
        // three sites would silently shift every later remap by one.
        const callerIndexOf: number[] = [];
        const keepOp = (op: DocOp, callerIndex: number) => {
          // ★★★ STRIP `expect`: it is the HAND EDITOR's concurrency guard and carries
          //  a draft's baseline, and an AI op resolves no draft. The tool schema sets
          //  no `additionalProperties: false`, so a model CAN emit the field, and the
          //  spreads above (`{ ...op, block }`) would carry it into `applyOps`.
          //  ★★ That can only SUBTRACT writes — a mismatched `expect` REJECTS and
          //  an absent one always applies — so the exposure was a self-inflicted
          //  refusal, NOT an integrity hole, and this comment overstated it until a
          //  review said so. Do not cite this as a security control. Stripped in
          //  `keepOp` because every op funnels through here, so no later branch can
          //  reintroduce it. A model op that legitimately wants to guard on prior
          //  content should read the document first, not hand us an `expect`.
          const rest = { ...op } as DocOp & { expect?: unknown };
          delete rest.expect;
          cleanOps.push(rest as DocOp);
          callerIndexOf.push(callerIndex);
        };
        ops.forEach((op, i) => {
          if (op.op === "replaceAll") {
            // ★★★ A NON-ARRAY `blocks` MUST NOT BECOME AN EMPTY ONE.
            // applyOps has its own `replaceAll requires a blocks array` guard,
            // but it CANNOT fire on this path: sanitizeAiDocBlocks always
            // hands it an array, so a `{op:"replaceAll"}` with no blocks
            // arrived as a well-formed "replace everything with nothing" and
            // wiped the document. chat-tools-documents.ts's requirePayload
            // refuses that at the TOOL boundary, so the model cannot reach it
            // today — this closes the same door for a direct dispatcher
            // caller, which is the only reason the engine's guard exists.
            if (!Array.isArray(op.blocks)) {
              selfRejected.push(`op ${i}: replaceAll requires a blocks array`);
              return;
            }
            // ★★★ THE SAME RULE AS THE SINGLE-BLOCK ARM BELOW, one container
            // deeper — and this arm did not have it. sanitizeAiDocBlocks
            // returns a SHORTER array when it drops blocks, nothing compared
            // the lengths, so a 4-block replaceAll carrying one bad block
            // wrote 3 and reported `changed:true, rejected:[]` (measured). The
            // tool resolved, the model said "I've rewritten the document", and
            // a section was simply absent. The before-image can still restore
            // it — but nothing told the user there was anything to restore,
            // which is what makes this the reported-success-lost-the-content
            // class rather than a cosmetic miscount.
            const sent = op.blocks.length;
            const kept = sanitizeAiDocBlocks(op.blocks);
            // ★★★ SAME MISATTRIBUTION AS create's, one container deeper: a
            // 503-block replaceAll reported "3 block(s) failed the model-input
            // allow-list" while APPLYING the 500 survivors (measured). The cap
            // reason is emitted alongside — never instead of — the allow-list
            // one, since a payload can hit both.
            const drop = classifyBlockDrop(sent, kept.length);
            if (drop.overCap > 0) {
              selfRejected.push(`op ${i}: ${blockCapReason(sent)}`);
            }
            // ★★★ AN EXPLICIT EMPTY LIST IS LEGAL AND STAYS LEGAL — `blocks:
            // []` is a real "clear this document" request (document-mutations
            // .ts says so at length) and the before-image preserves what it
            // replaced. But `sent > 0 && kept === 0` is NOT that request: it
            // is a replace whose every block the allow-list voided, and
            // applying it would wipe the document on the strength of content
            // that never survived validation. Reject the op instead, exactly
            // as the single-block arm does. The distinction is `sent`, the
            // length of what the model SUPPLIED — a guard keying on `kept`
            // alone cannot tell the two apart and would break the legitimate
            // clear.
            if (sent > 0 && kept.length === 0) {
              // ★ `examined`, not `sent`: with an over-cap payload the blocks
              // past the cap were never validated, so "all N failed" would name
              // a population the allow-list never saw. The cap entry pushed
              // above already accounts for those.
              selfRejected.push(
                `op ${i}: all ${drop.examined} block(s) failed the model-input allow-list`,
              );
              return;
            }
            // A PARTIAL drop still applies — the survivors are what the model
            // asked for, minus what it may not store — but it must be named.
            // ★ This message is OP-SCOPED and so must match the `/^op \d+:/`
            // shape the `applied` arithmetic below keys on. It rides
            // `selfRejected`, which that filter never reads, so it cannot move
            // the count either way; the pattern is kept for the reader's sake
            // and for anything downstream that partitions the two kinds.
            if (drop.failedAllowList > 0) {
              selfRejected.push(
                `op ${i}: ${drop.failedAllowList} block(s) failed the model-input allow-list`,
              );
            }
            keepOp({ ...op, blocks: kept }, i);
            return;
          }
          if ("block" in op && op.block) {
            const [block] = sanitizeAiDocBlocks([op.block]);
            if (!block) {
              selfRejected.push(`op ${i}: block failed the model-input allow-list`);
              return;
            }
            keepOp({ ...op, block }, i);
            return;
          }
          keepOp(op, i);
        });
        const result = mutateDocuments({ kind: "ops", id, ops: cleanOps, title }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        const after = result.documents.find((d) => d.id === id);
        // ★★★ Renumbered into the CALLER's op space before anything reads them
        // — see `remapOpIndex`. Everything downstream (the `applied` filter, the
        // `rejected` array the model and the chat card both see) works off THIS
        // array, never `result.rejected`, so there is one index space left.
        const engineRejected = result.rejected.map((r) => remapOpIndex(r, callerIndexOf));
        // ★★★ READS `cleanOps`, NOT `ops`. A replaceAll that `selfRejected`
        // removed never reached the engine, so it removed nothing — but the flag
        // still fired, and `removed` (a plain before/after block-count delta)
        // then attributed ANOTHER op's deletions to it. Measured: a self-
        // rejected replaceAll beside a `{op:"delete", index:0}` reported
        // `removed: 1` for a replaceAll that never ran.
        const usedReplaceAll = cleanOps.some((o) => o.op === "replaceAll");
        // ★★★ `result.rejected` mixes OP-SCOPED entries ("op N: …", one per
        // rejected op — applyOps prefixes every one, document-mutations.ts)
        // with MUTATION-SCOPED ones (a blank title; a future block-count cap)
        // that describe the WRITE, not any single op. Subtracting the whole
        // array from an op count conflates two different denominators and can
        // go negative the moment both kinds land together — e.g. an
        // out-of-range op alongside a blank title. Count only the op-scoped
        // ones: every op in `cleanOps` contributes at most one such entry, so
        // this can never exceed `cleanOps.length` and needs no clamp.
        // ★★ Counted on the REMAPPED array, which is safe precisely because
        // `remapOpIndex` cannot change whether an entry matches: renumbering
        // "op 0:" to "op 1:" leaves it op-scoped, and a mutation-scoped entry is
        // returned untouched. Counting the pre-remap array would give the same
        // number today — reading the array everything else reads keeps it that
        // way if the remap ever grows a case.
        const opRejectedCount = engineRejected.filter((r) => OP_INDEX_PREFIX.test(r)).length;
        // ★★ Gated on `changed`, NOT on "the document exists" or "some op was
        // sent". An update whose every op the engine rejected — or a rename to
        // the title it already has — returns `changed:false` and mutates
        // nothing, so a row here would assert an edit that did not occur.
        if (result.changed) {
          logActivityAs?.("ai", "ai.documentWrite", id, after?.title ?? before.title);
        }
        return {
          id,
          title: after?.title ?? before.title,
          blockCount: after?.blocks.length ?? before.blocks.length,
          // Derived from what was actually SENT (cleanOps) and what the
          // engine itself reported as rejected AMONG THOSE — never from the
          // caller's raw `ops.length`, which over-counts by exactly the ops
          // this function rejected before the engine ever saw them.
          applied: cleanOps.length - opRejectedCount,
          rejected: [...selfRejected, ...engineRejected],
          removed: usedReplaceAll ? Math.max(0, before.blocks.length - (after?.blocks.length ?? 0)) : 0,
        };
      },

      deleteDocument: (id) => {
        if (isReadOnly) throw readOnlyError();
        // Read the title BEFORE the mutation — after it the row is gone from
        // `result.documents`, and the activity entry names what was deleted.
        const before = documentsRef.current.find((d) => d.id === id);
        const result = mutateDocuments({ kind: "delete", id }, "ai");
        documentsRef.current = result.documents;
        versionsRef.current = result.versions;
        // `changed:false` here means the id did not exist — nothing was
        // deleted, so nothing is logged.
        if (result.changed) {
          // ★★★ ARM THE ONE-SHOT DESTRUCTIVE-SAVE BYPASS. `documents` counts
          // toward `workspaceRecordCount`, and this is the SECOND removal route
          // — `documents-panel.tsx` armed and this one did not. Several
          // `delete_document` calls in one assistant turn run back-to-back —
          // `chat-panel.tsx` walks EVERY tool_use block of ONE response in a
          // single loop with no model round-trip between, and each block is a
          // local mutation — so they land orders of magnitude inside
          // SAVE_DEBOUNCE_MS and coalesce into one save. That save can then be
          // REFUSED: the UI shows the documents gone while the backend still
          // holds them.
          // ★★★ THE THRESHOLD IS NOT INTUITIVE AND THIS COMMENT ONCE GOT IT
          // WRONG. It claimed 8 deletes in a project of 8 documents + 1 task
          // refuse. They do NOT: `isMassDeletion(9,1)` passes the floor (8 >= 5)
          // and FAILS the fraction (1 <= 0.9 is false), so every document goes
          // and Layer B stays silent. The near-miss is ONE RECORD wide. Run it,
          // do not re-derive it:
          //   node -e 'const f=(p,c,fl=5,fr=0.1)=>c<p&&(p-c)>=fl&&c<=p*fr;
          //     console.log(f(10,1), f(9,1), f(8,0))'   -> true false true
          // So 9 docs + 1 task refuses, and 8 docs with no other records
          // refuses; 8 docs + 1 task does not.
          // ★★ ARMED PER DELETE AND ONLY WHEN `changed`, deliberately, NOT once
          // per tool run. There is no run-begin seam in the dispatcher, and
          // arming for a run that deletes nothing leaks the one-shot: the
          // bypass is consumed by the next SAVE, so with no state change none
          // ever runs and it stays up indefinitely (the shape
          // `documents-panel.tsx` was fixed for). Gating on `changed` means a
          // state change is guaranteed, so the save that spends it is too.
          allowDestructiveSaveRef.current?.();
          logActivityAs?.("ai", "ai.documentWrite", id, before?.title ?? "");
        }
        const newest = result.versions[result.versions.length - 1];
        return {
          deleted: result.changed,
          restorableVersionId: result.changed && newest ? newest.id : null,
        };
      },
    }),
    [isReadOnly, mutateDocuments, logActivityAs],
  );
}
