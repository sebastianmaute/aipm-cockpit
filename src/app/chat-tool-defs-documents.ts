// src/app/chat-tool-defs-documents.ts — Anthropic tool schemas for project
// documents. Pure data; routing lives in chat-tools-documents.ts (Task 17) and
// the impl in use-document-tools.ts (Task 18).
//
// Split out of chat-tool-defs.ts for COHESION, not for the ratchet. Measured
// 2026-08-07 with the gate's own counter (`split("\n").length`, i.e. wc -l + 1):
// chat-tool-defs.ts is 596 lines against the 800-line limit, and the
// DOCUMENT_TOOL_DEFS block below is 74 lines, so 596 + 74 = 670 and it would
// have fit inline. (chat-tools.ts, at 763, is the one genuinely forced by the
// ratchet.) An earlier revision of this header claimed the split was required;
// it was not.
//
// ★★ NO SELF-REFERENTIAL LINE NUMBER HERE, DELIBERATELY. That revision sized
// this file as "line 44 of a 117-line file" — true when the number was composed,
// FALSE by the time it was saved, because the very edit carrying it grew the
// file by four lines and pushed both figures to 48/121. It invalidated its own
// measurement by the act of writing it down, in a commit whose whole purpose
// was correcting false counts. The figures kept above cannot rot that way:
// each measures either ANOTHER file or this block's LENGTH, and no edit to the
// header above it can move either one.

import { EXPORT_SECTION_KEYS } from "./settings-types";

// ★★★ KEEP THIS IN SYNC WITH `DocBlock` IN document-model.ts BY HAND — this is
// a JSON-schema literal for the model, not a type derived from DocBlock, so
// tsc cannot catch drift between them. If a variant, field name or the heading
// level range changes there, this description lies to the model, which will
// then emit blocks the sanitizer silently drops (document-model.ts's structural
// validator degrades unknown shapes rather than throwing). Verified against the
// union as of Task 16: six variants — heading{level:1|2|3,text},
// paragraph{html}, bullets{items,ordered?}, table{columns,rows,caption?},
// dataSection{key}, pageBreak — field-for-field match.
//
// ★★★ THE PARAGRAPH TAG LIST MUST TRACK `sanitizeDocumentHtml` — do not simplify
// it away. There is no human editor for `paragraph.html` (grep RichTextEditor in
// document*.tsx: nothing), so this schema is the ONLY thing that decides what the
// sole author of that field emits. One failure mode it still prevents, and one it
// used to paper over:
//   (a) UNDER-ADVERTISING — LIVE, and this schema is the only guard. The
//       description used to name p/strong/em/ul/ol/li/a and say everything else
//       is unwrapped, so the document-only marks the sanitizer keeps
//       (s/code/pre/blockquote/hr/mark/sub/sup) were never asked for and the
//       wider allow-list sat inert.
//   (b) THE CLASSIFIER GAP — CLOSED IN THE CODE, not here. One shared 8-tag
//       classifier (p/br/strong/em/ul/ol/li/a, since retired) answered "is this
//       HTML?" for every sink, so a `paragraph.html` LEADING with one of the nine
//       document-only tags failed that test and was ESCAPED to literal visible
//       tags. Widening the shared constant was never the fix (the "note" sink is
//       KEEP_CONTENT:false and would DELETE the text instead); each sink now
//       derives its own test from its own allow-list (`isHtmlStart`,
//       open-followups.md §114). The "start with `<p>`" instruction below merely
//       sidestepped this on the one path it was reachable from — it is still good
//       prompting for well-formed blocks, but it is NOT a mitigation and must not
//       be cited as one.
// `chat-tools-documents.test.ts` pins the advertised set against what the
// sanitizer actually keeps, so widening one without the other goes red.
const docBlockSchema = {
  type: "object" as const,
  description:
    "One document block. heading: {type,level:1-3,text}. paragraph: {type,html} — HTML using p, br, strong, em, u, s, code, pre, blockquote, mark, sub, sup, hr, ul/ol/li, a; anything else is unwrapped to its text. ALWAYS start the value with <p> and wrap each paragraph in <p>...</p>. bullets: {type,items,ordered?}. table: {type,columns,rows,caption?}. dataSection: {type,key} embeds live project data — key must be one of the enum values, which mirror the app's export sections. pageBreak: {type} starts a new page in Word/PDF and a new slide in PowerPoint.",
  properties: {
    type: { type: "string" as const, enum: ["heading", "paragraph", "bullets", "table", "dataSection", "pageBreak"] },
    level: { type: "number" as const, description: "heading only: 1, 2 or 3" },
    text: { type: "string" as const, description: "heading only" },
    html: { type: "string" as const, description: "paragraph only" },
    items: { type: "array" as const, items: { type: "string" as const }, description: "bullets only" },
    ordered: { type: "boolean" as const, description: "bullets only: numbered instead of bulleted" },
    columns: { type: "array" as const, items: { type: "string" as const }, description: "table only" },
    rows: { type: "array" as const, items: { type: "array" as const, items: { type: "string" as const } }, description: "table only" },
    caption: { type: "string" as const, description: "table only" },
    // Drawn from the real registry (not hand-typed) so this enum cannot drift
    // from the sections the app actually exports — see settings-types.ts.
    key: {
      type: "string" as const,
      enum: [...EXPORT_SECTION_KEYS] as string[],
      description: "dataSection only: which live project data section to embed",
    },
  },
  required: ["type"],
};

export const DOCUMENT_TOOL_DEFS = [
  {
    name: "list_documents",
    description:
      "List every project document with its id, title, block count and last-updated time. Read this before get_document when you do not know the id.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_document",
    description:
      "Read one document in full, including every block. You MUST call this before update_document so your op indices refer to the blocks that actually exist.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "number" as const, description: "The document id" } },
      required: ["id"],
    },
  },
  {
    name: "create_document",
    description:
      "Create a project document. Supply the full block list you want; an empty document is created when blocks is omitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const },
        blocks: { type: "array" as const, items: docBlockSchema },
      },
      required: ["title"],
    },
  },
  {
    name: "update_document",
    description:
      "Edit a document with a list of block operations. Ops apply LEFT TO RIGHT against the evolving block list, so [{op:'delete',index:0},{op:'delete',index:0}] removes the first TWO blocks. Prefer targeted ops (append/insert/replace/delete) over replaceAll — replaceAll discards every block you do not resend, and chat tool writes have no undo capture in this app, so an accidental replaceAll cannot be recovered from this session. Call get_document first so your indices refer to the blocks that actually exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "number" as const },
        title: { type: "string" as const, description: "Optional new title; omit to leave it alone" },
        ops: {
          type: "array" as const,
          description:
            "The edits to apply, in order. Each op reads the block list as already modified by every op before it in this array.",
          items: {
            type: "object" as const,
            properties: {
              op: { type: "string" as const, enum: ["append", "insert", "replace", "delete", "replaceAll"] },
              index: { type: "number" as const, description: "0-based; required for insert, replace and delete" },
              block: docBlockSchema,
              blocks: {
                type: "array" as const,
                items: docBlockSchema,
                description: "replaceAll only: the COMPLETE new block list",
              },
            },
            required: ["op"],
          },
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_document",
    description:
      "Delete a project document. The document is recoverable from its version history in the Documents view, but tell the user you have deleted it.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "number" as const } },
      required: ["id"],
    },
  },
];
