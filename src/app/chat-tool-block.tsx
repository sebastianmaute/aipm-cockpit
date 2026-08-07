"use client";

// src/app/chat-tool-block.tsx — the chat transcript's tool-call bubble.
// Extracted from chat-panel.tsx (which is file-size-ratchet baselined) to make
// room for the document-tool file card below without growing that file.

import { useState } from "react";
import { ArrowDownTrayIcon, ArrowRightIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { downloadDocument, type DocFormat } from "./document-download";
import { DOC_FORMATS } from "./documents-toolbar";
import { DOCUMENT_TOOL_DEFS } from "./chat-tool-defs-documents";
import { Button } from "./button";

// ---------------------------------------------------------------------------
// Document file card. A document tool call that succeeded and returned the
// shape below renders as a card instead of a raw JSON blob.
//
// THE RESULT SHAPES, AS THE TOOLS NOW ACTUALLY IMPLEMENT THEM. (An earlier
// revision of this header said the implementation had not landed and that this
// card was DEFINING the contract; use-document-tools.ts and
// chat-tools-documents.ts both landed in this same branch, so it is read back
// from them now. `result` is `stringifyResult` output — chat-api.ts —
// i.e. `JSON.stringify(value, null, 2)` of the dispatcher's return value.)
//
//   create_document → `{id, title, blockCount}` — an EXACT match for
//                     DocumentCardData; cards.
//   update_document → `DocumentUpdateResult` = `{id, title, blockCount,
//                     applied, rejected, removed}` — a SUPERSET; cards,
//                     because the parser validates the three fields it needs
//                     and reads the rest OPTIONALLY rather than demanding an
//                     exact key set. `title` is REQUIRED and non-blank on that
//                     type specifically so this card cannot silently vanish
//                     after a successful edit (chat-tools-documents.ts
//                     documents it at the field).
//   list_documents  → `DocumentSummary[]` — an ARRAY; falls back.
//   get_document    → the whole `ProjectDocument` `{id, title, blocks, …}` —
//                     carries `blocks`, never a `blockCount`; falls back.
//   delete_document → `{deleted, restorableVersionId}` — no id/title; falls
//                     back.
//
// ★★ `parseDocumentResult` is deliberately STRICT: anything that is not
// EXACTLY `{ id: number; title: string; blockCount: number }` in those three
// fields (missing/renamed field, non-object, bare array, a numeric id arriving
// as a string, …) falls back to the plain tool block — never a half-populated
// card, never a throw. The three misses above are EXPECTED and intentional,
// not a gap this should "fix" by widening the parser: an array names no single
// document to card, a deleted one has nothing left to open or download, and
// get_document's payload is the block list the MODEL reads, not a summary for
// a card.
//
// ★★★ THE EXTRAS ARE READ SEPARATELY AND NEVER GATE THE CARD. `rejected` and
// `removed` are what update_document uses to say "part of your edit did not
// land" / "this write dropped N blocks". Before they were surfaced here the
// card showed a clean success for a PARTLY-REFUSED edit: the refusal reached
// the MODEL (it is in the tool result it reads) but never the person, which is
// the same silent-drop failure use-document-tools.ts and documents-panel.tsx
// were both fixed for in this branch. They are read AFTER the three strict
// checks above pass, with their own defensive readers, so a malformed extra
// degrades to "not shown" — never to a throw, and never to withholding a card
// whose three required fields are perfectly good.
// ---------------------------------------------------------------------------

type DocumentCardData = {
  id: number;
  title: string;
  blockCount: number;
  /** Human-readable reasons, one per refused op (chat-tools-documents.ts types
   *  it `readonly string[]`). EMPTY when absent, malformed, or genuinely empty
   *  — a successful edit reports `rejected: []` and must look exactly like one
   *  that reports nothing at all. ★ Already CAPPED and truncated by
   *  `readRejected` — this is what will be RENDERED, not what the engine
   *  returned, and it may carry a trailing `REASON_ELLIPSIS` bullet. */
  rejected: readonly string[];
  /** Blocks the write dropped; `number`, non-zero only for replaceAll. 0 when
   *  absent or malformed, and 0 renders nothing — "0 removed" is noise. */
  removed: number;
};

// ---------------------------------------------------------------------------
// ★★ DISPLAY CAPS ON THE ENGINE'S REASON STRINGS — these are MODEL-INFLUENCEABLE
// TEXT. document-mutations.ts builds `op ${i}: unknown op ${JSON.stringify(
// op.op)}`, interpolating the model's OWN `op` value verbatim, and the model in
// turn reads ingested PDF / SharePoint / Confluence content — so this is not
// purely self-inflicted. Measured against the real engine BEFORE capping:
// `op: "A".repeat(200000)` rendered ONE 200 019-character bullet, and 5000 bogus
// ops rendered 5000 bullets totalling 133 890 characters.
//
// ★ NOT an XSS fix, and do not let it read as one: these render as JSX text, so
// React escapes them — `op: "<img src=x onerror=alert(1)>"` was MEASURED inert.
// What the caps bound is transcript FLOODING plus attacker-chosen prose sitting
// inside the app's own "Not applied" chrome. Escaping is what makes it safe;
// this is what keeps it small.
//
// Shape and naming follow activity-log.ts's MAX_FIELD_CHANGES /
// MAX_FIELD_VALUE_LEN, and 120 is not arbitrary here: the engine's LONGEST
// legitimate template is `op ${i}: insert index ${op.index} out of range
// 0..${n}` — well under half of it — so the length cap can only ever bite on an
// interpolated value, never on a reason a real refusal produced.
// ---------------------------------------------------------------------------
const MAX_REJECTED_REASONS = 12;
const MAX_REJECTED_REASON_LEN = 120;

/** Marks a cut: the suffix on an over-long reason, and the whole content of the
 *  final bullet when reasons were dropped.
 *
 *  ★★ NOT AN i18n GAP. It is language-neutral punctuation, sitting among the
 *  engine's own UNTRANSLATED English reason strings (DocumentCardNotices
 *  documents that trade-off), and activity-log.ts already marks a clipped value
 *  with this same character.
 *
 *  ★ KNOWN LIMITATION, deliberately taken: it does NOT say HOW MANY reasons were
 *  dropped. "+N more" would need a new i18n key, and no existing key fits —
 *  the nearest, `actionMoreReasons` ("+{0} more reasons"), labels an EXPANDER
 *  and so promises more on click, which this bullet cannot deliver. Reusing it
 *  would render a false affordance; a foreign domain-named key would also rot
 *  silently the next time the Action Center rewords its own string. */
const REASON_ELLIPSIS = "…";

/** Truncates one reason to MAX_REJECTED_REASON_LEN, marking the cut.
 *
 *  ★★ `slice` counts UTF-16 CODE UNITS, so a cut landing between the halves of a
 *  surrogate pair keeps a LONE HIGH SURROGATE — not a character. Same back-off-
 *  one shape as rich-text-plain.ts's `capHtmlText`. The stakes are lower here
 *  (display-only; nothing on this path is persisted, so no backend-dependent
 *  U+FFFD corruption is possible) but a replacement glyph mid-reason is still
 *  a worse outcome than dropping one whole astral character. */
function capReasonLength(reason: string): string {
  if (reason.length <= MAX_REJECTED_REASON_LEN) return reason;
  const last = reason.charCodeAt(MAX_REJECTED_REASON_LEN - 1);
  const cut =
    last >= 0xd800 && last <= 0xdbff ? MAX_REJECTED_REASON_LEN - 1 : MAX_REJECTED_REASON_LEN;
  return `${reason.slice(0, cut)}${REASON_ELLIPSIS}`;
}

/** Keeps the string members of a `rejected` array and drops everything else.
 *  A non-array (the whole field malformed) yields no reasons; a MIXED array
 *  keeps what it can, because showing three of four reasons discloses more
 *  than showing none. Blank strings are dropped — they would render an empty
 *  bullet that says nothing.
 *
 *  ★ THE COUNT CAP APPLIES TO THE KEPT LIST, NOT THE RAW ARRAY, so 20 blanks
 *  beside 5 real reasons still shows all 5 — junk must not consume the budget
 *  that real disclosure needs. The length cap runs only over the survivors, so
 *  a 5000-entry flood costs 12 truncations rather than 5000.
 *
 *  ★ The marker rides IN the array as a final element rather than as a separate
 *  flag: DocumentCardNotices renders this list verbatim, and a `<li>` is already
 *  the right shape for "the list continues". It can never be the ONLY element —
 *  it is appended only when the kept list overflowed, which means real reasons
 *  precede it — so `rejected.length > 0` still means "something was refused". */
function readRejected(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const kept = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
  );
  const shown = kept.slice(0, MAX_REJECTED_REASONS).map(capReasonLength);
  return kept.length > MAX_REJECTED_REASONS ? [...shown, REASON_ELLIPSIS] : shown;
}

/** A positive integer count, or 0 for "nothing to disclose". Non-numbers, NaN,
 *  negatives and fractions all degrade to 0 rather than rendering a count the
 *  engine cannot have meant. */
function readRemoved(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

// Read DOCUMENT_TOOL_DEFS live inside the function, never cached into a
// module-eval-time Set — a Set snapshotted from an imported const at THIS
// module's own eval time can freeze empty if this module is entered mid an
// import cycle (document-model.ts's header documents the general shape of
// that trap for settings-types/workspace/document-model; DOCUMENT_TOOL_DEFS
// sits in a different, currently acyclic, import graph, but reading it live
// costs nothing and the eager-Set failure mode is silent, so there is no
// reason to risk it).
function isDocumentTool(name: string): boolean {
  return DOCUMENT_TOOL_DEFS.some((def) => def.name === name);
}

function parseDocumentResult(result: string): DocumentCardData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) return null;
  if (typeof r.title !== "string" || r.title.trim() === "") return null;
  if (typeof r.blockCount !== "number" || !Number.isInteger(r.blockCount) || r.blockCount < 0) return null;
  // Only AFTER the three required fields are known good — the extras can never
  // turn a valid card into a fallback.
  return {
    id: r.id,
    title: r.title,
    blockCount: r.blockCount,
    rejected: readRejected(r.rejected),
    removed: readRemoved(r.removed),
  };
}

// The format this compact surface downloads with — there is no format picker
// here, unlike the full Documents panel. Sourced from DOC_FORMATS (not a
// hardcoded literal) so it can never disagree with that list if its order
// ever changes; DOC_FORMATS[0] is "docx" today, matching the Documents
// panel's own default.
const CARD_DOWNLOAD_FORMAT: DocFormat = DOC_FORMATS[0].value;

/** What the write did NOT do, drawn only when there is something to say.
 *
 *  ★★ ABSENT, EMPTY AND PRESENT ARE THREE STATES, and the first two must look
 *  identical: a clean edit reports `rejected: [], removed: 0` and gets no
 *  strip at all, so this returns null rather than an empty container. An empty
 *  warning strip on every successful edit would train the user to ignore the
 *  one that matters.
 *
 *  ★★ NO `role="status"` — DELIBERATE, NOT AN OMISSION. This card renders
 *  inside chat-panel.tsx's message list, which is `<ul role="log"
 *  aria-relevant="additions">` (chat-panel.tsx). `role="log"` is already a live
 *  region, and the whole `<li>` subtree — this strip included — is announced
 *  when the tool block is appended. Nesting a second live region here would
 *  announce the same text twice, which is worse than announcing it once.
 *  (documents-panel.tsx DOES use `role="status"` for its restore refusal, and
 *  correctly: that one renders in a static pane with no live-region ancestor.
 *  The pattern is the same, the ancestor is not.)
 *
 *  ★ Independent of `liveDoc`. What was refused is a historical fact about the
 *  call; a document deleted afterwards does not un-refuse it. */
function DocumentCardNotices({
  rejected,
  removed,
  lang,
}: {
  rejected: readonly string[];
  removed: number;
  lang: Lang;
}) {
  if (removed === 0 && rejected.length === 0) return null;
  return (
    // ★ `data-doc-notices` is a TEST HANDLE for the CONTAINER, and it is not
    // decoration: without it "no strip on a clean success" can only be checked
    // by its CONTENTS, and an unconditionally-rendered EMPTY strip has none —
    // so that assertion passes while a stray `border-t` rule draws across
    // every successful card. Mutation-proved: dropping the early return above
    // reddens the clean-success test only through this attribute.
    <div data-doc-notices="" className="border-t border-line pt-2 text-xs text-muted-foreground">
      {removed > 0 && (
        <p className="font-medium text-foreground">
          {removed === 1
            ? t(lang, "documentsCardRemovedOne")
            : t(lang, "documentsCardRemoved", removed)}
        </p>
      )}
      {rejected.length > 0 && (
        <>
          <p className="font-medium text-foreground">{t(lang, "documentsCardNotApplied")}</p>
          {/* The engine's own reason strings, untranslated — same trade-off
              documents-panel.tsx makes for its restore refusal: an
              untranslated reason beats a silent drop. A real list, so the
              count is conveyed structurally rather than by punctuation. */}
          <ul className="list-disc pl-4">
            {rejected.map((reason, i) => (
              // Index key: two ops can be refused for the identical reason, so
              // the string is not a stable identity. This list is render-only
              // and never reorders.
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DocumentCard({
  docId,
  title,
  blockCount,
  rejected,
  removed,
  lang,
}: {
  docId: number;
  title: string;
  blockCount: number;
  rejected: readonly string[];
  removed: number;
  lang: Lang;
}) {
  const ws = useWorkspace();
  // Navigation is the shell's, not this card's: requestOpen sets the active
  // tab AND writes the deep-link hash that useHashView turns into a
  // `pendingOpen` for the target panel — the same call global-search-box and
  // knowledge-panel make straight from render scope. This card owns only HALF
  // the "Open" feature; selecting the row on arrival is documents-panel's job,
  // driven by that `pendingOpen`.
  const { requestOpen } = useWorkspaceTab();
  // The tool result is a snapshot from the moment the call ran. The LIVE
  // document is authoritative when it still exists — a later edit in this
  // same conversation, or a concurrent write, can leave the snapshot stale.
  // Falling back to the tool's own numbers keeps the card USEFUL rather than
  // blank when the document has since been deleted; both actions are disabled
  // in that case — there is nothing left to render into bytes, and nothing for
  // the Documents view to select on arrival, so a live-looking Open would be a
  // false affordance.
  const liveDoc = ws.documents.find((d) => d.id === docId);
  const displayTitle = liveDoc?.title ?? title;
  const displayBlockCount = liveDoc?.blocks.length ?? blockCount;
  // ★★ ROW-UNIQUE ACCESSIBLE NAMES. One transcript can hold many of these
  // cards, so a bare "Download"/"Open in Documents" repeats verbatim N times
  // (WCAG 2.4.6). The id is the only qualifier that CANNOT collide — two cards
  // can carry the same title, either because the same document was touched
  // twice in one conversation or because two documents are genuinely named
  // alike. Same shape as documents-history-modal.tsx's per-version Restore
  // label. Each name still STARTS with the button's visible text, so
  // Label-in-Name (WCAG 2.5.3) holds for speech input.
  const nameQualifier = ` – ${displayTitle} · #${docId}`;

  return (
    <div className="flex justify-start">
      {/* A COLUMN now, so the notices strip can sit under the summary row. With
          no strip the single child renders exactly as the old flex row did —
          `gap-2` has nothing to separate. */}
      <div className="flex max-w-[85%] flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground">
        <div className="flex items-center gap-3">
          <DocumentTextIcon aria-hidden="true" className="h-8 w-8 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{displayTitle}</div>
            <div className="text-xs text-muted-foreground">
              {displayBlockCount} {t(lang, "documentsBlockCount")}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!liveDoc}
              onClick={() => requestOpen("documents", docId)}
              aria-label={`${t(lang, "documentsGoToDocument")}${nameQualifier}`}
              className="inline-flex items-center gap-1.5"
            >
              <ArrowRightIcon aria-hidden="true" className="h-4 w-4" />
              {t(lang, "documentsGoToDocument")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!liveDoc}
              onClick={() => {
                if (liveDoc) downloadDocument(liveDoc, CARD_DOWNLOAD_FORMAT, ws, lang);
              }}
              aria-label={`${t(lang, "documentsDownload")}${nameQualifier}`}
              className="inline-flex items-center gap-1.5"
            >
              <ArrowDownTrayIcon aria-hidden="true" className="h-4 w-4" />
              {t(lang, "documentsDownload")}
            </Button>
          </div>
        </div>
        <DocumentCardNotices rejected={rejected} removed={removed} lang={lang} />
      </div>
    </div>
  );
}

export function ToolBlock({
  name,
  input,
  result,
  error,
  lang,
}: {
  name: string;
  input: unknown;
  result: string;
  error: boolean;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);

  // A document tool that succeeded and returned the shape above gets a file
  // card instead of a raw JSON blob.
  const card = !error && isDocumentTool(name) ? parseDocumentResult(result) : null;
  if (card) {
    return (
      <DocumentCard
        docId={card.id}
        title={card.title}
        blockCount={card.blockCount}
        rejected={card.rejected}
        removed={card.removed}
        lang={lang}
      />
    );
  }

  return (
    <div className="flex justify-start">
      <details
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className={`max-w-[85%] rounded-lg border px-3 py-2 text-xs ${
          error
            ? "border-ui-pink/40 bg-ui-pink/10 text-ui-dark-blue dark:border-ui-pink/50 dark:bg-ui-pink/15 dark:text-ui-light-grey"
            : "border-line bg-surface text-foreground"
        }`}
      >
        <summary className="cursor-pointer select-none font-mono">
          {error ? `⚠ ${t(lang, "chatToolError")}: ` : "▸ "}
          {t(lang, "chatToolCall", name)}
        </summary>
        <div className="mt-2 space-y-1">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 font-mono text-[11px]">
            {JSON.stringify(input, null, 2)}
          </pre>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 font-mono text-[11px]">
            {result}
          </pre>
        </div>
      </details>
    </div>
  );
}
