// src/app/dom-unavailable-error.ts — §97: the named error for "no DOM to sanitize with".
//
// ★★★ A MISSING DOM IS AN ENVIRONMENT FAULT, NOT BAD DATA, and the load paths
//  must not treat it as bad data. Every document decode wraps its DOM-dependent
//  rich-field pass in a local catch that degrades a throw to "documents dropped"
//  and reports the drop through the caller's `diag`. That is right for a stored
//  value the sanitizer cannot handle. It was wrong for a missing DOM: a caller
//  with no `diag` (a bare-node script, a node-environment test) lost every
//  document with no report at all, because `logDiag` is a no-op without a
//  `window` too (§624). `sanitize-html.ts` throws this instead of DOMPurify's
//  opaque "addHook is not a function", and each catch that used to turn a
//  sanitizer throw into dropped data rethrows it — the document and version
//  passes, the meta-slice decoders, `decodeNoteLog`, and the outer catches of
//  `jsonToWorkspace` and `BrowserBackend.load` — so the caller fails loudly
//  whether or not it passed a `diag`. Enumerate them with
//    grep -rn "rethrowIfDomUnavailable(" src/app --include=*.ts | grep -v test | grep -v "export function"
//
// ★ Its own module with no imports, so the DOM-free codec graph
//  (`meta-slice-decode.ts`, the CSV and Markdown codecs) can test for it without
//  importing dompurify.

export class DomUnavailableError extends Error {
  constructor() {
    super(
      "No DOM is available to sanitize rich HTML. Install one (e.g. JSDOM into globalThis) before decoding a workspace outside a browser.",
    );
    this.name = "DomUnavailableError";
  }
}

/** Rethrow `err` when it is a {@link DomUnavailableError}; a no-op otherwise. The
 *  first line of every catch on a workspace load path. */
export function rethrowIfDomUnavailable(err: unknown): void {
  if (err instanceof DomUnavailableError) throw err;
}
