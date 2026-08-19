"use client";
// The single `next/dynamic` boundary for the rich-text editor.
//
// Tiptap + ProseMirror is browser-only and ~428 kB. EVERY consumer imports the
// editor THROUGH this module so that (a) there is one place that decides the
// loading fallback, and (b) the chunk boundary is visible in one file rather
// than re-derived per call site. Before this module the wrapper was hand-rolled
// verbatim in two consumers and statically imported by six more.
//
// ★★ "EVERY" is load-bearing and cheap to check — one static importer anywhere
//   in the eager graph puts the whole chunk back. Reproduce:
//     grep -rn 'from "\./rich-text-editor"' src/app --include=*.tsx | grep -v '\.test\.'
//   It must return ONLY this file's type-only re-export (erased at build time).
//   Leaving `raid-edit-modal` static was measured to cost the entire win: its
//   panel is one of the two mounted UNCONDITIONALLY (`workspace-section.tsx`),
//   so the chunk was still fetched on the initial dashboard render — off the
//   render-blocking entry chunk, but not off the page load.
//
// ★ `ssr: false` changes WHERE the component renders, not where Tiptap injects
//   its stylesheet. `useEditor` runs with `immediatelyRender: false`, so
//   `injectCSS()` is deferred to mount under both import styles. This module is
//   therefore NOT a fix for the prod-only CSP defect (open-followups §54, now
//   CLOSED — do not read this line as evidence it is open), and
//   it does not let `csp-nonce.ts`'s `typeof document` guard go away.
// ★★ The editor's imperative handle travels as the ORDINARY prop `editorRef`
//   because `rich-text-editor.tsx` DECLARES it that way — and for no other
//   reason. This comment used to say `next/dynamic` "does not forward `ref`",
//   which was true for Next ≤14 / React ≤18 and is FALSE at the installed
//   versions: `node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js`
//   renders `jsx(Lazy, {...props})` from a plain function component, and React
//   19 passes `ref` as an ordinary prop — so `ref` WOULD forward. Reproduce:
//     node -e "console.log(require('next/package.json').version, require('react/package.json').version)"
//   Renaming still buys nothing and touches two files, so don't.
import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

/** Placeholder shown while the editor chunk loads. Exported so it can be tested
 *  directly, and because a consumer's test may need to name it.
 *
 *  ★★★ THE FALLBACK **IS** OBSERVABLE THROUGH A RENDERED CONSUMER, and an
 *  earlier version of this comment claimed the opposite. The `dynamic()` import
 *  does resolve in a microtask under vitest, but React still needs a re-render
 *  to swap the fallback for the editor — so a SYNCHRONOUS `getByRole` on the
 *  line after `render()` sees this skeleton and no editor at all. Only an
 *  `await findByRole` (or any awaited query) sees the real thing.
 *
 *  That false claim cost a shipped commit: `task-form-fields.test.tsx` was
 *  reported green after its conversion when it was in fact 1 failed / 14 passed.
 *  A consumer test asserting the editor MUST await it. */
export function RichTextEditorFallback() {
  // ★ `border border-line` is NOT decoration: the two consumers that had a
  //   hand-rolled fallback before this module drew one, and `Skeleton` emits no
  //   border, so dropping it made the placeholder stop reading as a field.
  return <Skeleton className="min-h-40 border border-line" />;
}

export const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false, loading: RichTextEditorFallback },
);

// Type-only re-export (erased at build time, so it pulls nothing into this
// module's runtime graph). Consumers that use the imperative handle — today only
// `note-log-panel.tsx` — take both names from here rather than importing the
// heavy module for a type.
export type { RichTextEditorHandle } from "./rich-text-editor";
