"use client";
// The single `next/dynamic` boundary for the rich-text editor.
//
// Tiptap + ProseMirror is browser-only and large. Every consumer imports the
// editor THROUGH this module so that (a) there is one place that decides the
// loading fallback, and (b) the chunk boundary is visible in one file rather
// than re-derived per call site. Before this module the wrapper was hand-rolled
// verbatim in two consumers and statically imported by six more.
//
// ★ `ssr: false` changes WHERE the component renders, not where Tiptap injects
//   its stylesheet. `useEditor` runs with `immediatelyRender: false`, so
//   `injectCSS()` is deferred to mount under both import styles. This module is
//   therefore NOT a fix for the prod-only CSP defect (open-followups §54), and
//   it does not let `csp-nonce.ts`'s `typeof document` guard go away.
// ★ The editor's imperative handle is passed as the ORDINARY prop `editorRef`,
//   not React's `ref`. That is what makes this wrapper safe: `next/dynamic` does
//   not forward `ref`, so a handle wired the conventional way would break here
//   silently. Do not "tidy" `editorRef` into `ref`.
import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

/** Placeholder shown while the editor chunk loads. Exported so it can be tested
 *  directly — the `dynamic()` boundary resolves in a microtask under vitest, so
 *  the fallback is never observed through a rendered consumer. */
export function RichTextEditorFallback() {
  return <Skeleton className="min-h-40" />;
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
