"use client";
// The single `next/dynamic` boundary for the rich-text editor — and the owner of
// the append queue that makes lazy loading safe for dictation.
//
// Tiptap + ProseMirror is browser-only and ~428 kB. EVERY consumer imports the
// editor THROUGH this module so that (a) there is one place that decides the
// loading fallback, (b) the chunk boundary is visible in one file rather than
// re-derived per call site, and (c) no consumer can reintroduce the data-loss
// bug described on the queue below.
//
// ★★ "EVERY" is load-bearing and cheap to check — one static importer anywhere
//   in the eager graph puts the whole chunk back. Reproduce with a sweep that
//   admits ../ paths, .ts files and single quotes, because a narrower one has
//   already been wrong here:
//     grep -rnE "(from|import|require).{0,4}[\"'][^\"']*rich-text-editor[\"']" src e2e scripts
//   It must return only THIS file's dynamic import and type-only re-export, plus
//   the two tests that exercise the raw module. A --include=*.tsx filter rooted
//   at ./ misses a consumer in `settings-sections/` or `dashboard-sections/`
//   importing ../rich-text-editor, and both directories hold consumers today.
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
import { useCallback, useImperativeHandle, useRef } from "react";
import { Skeleton } from "./skeleton";
import type { RichTextEditorHandle, RichTextEditorProps } from "./rich-text-editor";

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

const LazyEditor = dynamic(() => import("./rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: RichTextEditorFallback,
});

/** The editor every consumer renders. Eager (a few hundred bytes), so its
 *  imperative handle exists from the first commit; the ~428 kB editor behind it
 *  is fetched on mount.
 *
 *  ★★★ THE QUEUE IS THE POINT, AND IT LIVES HERE RATHER THAN IN A CONSUMER.
 *  Dictation can outrun the editor: the mic is a SIBLING of the editor, so it
 *  paints and is operable immediately while the editor arrives over the network.
 *  Appending through a raw `editorRef.current?.appendText(txt)` in that window is
 *  SILENT DATA LOSS — no throw, no toast, the transcript simply gone. A first fix
 *  put this queue in `note-log-panel.tsx`; a cold review found two reasons that
 *  was the wrong layer, and both are why it moved:
 *    1. It protected 2 of 8 consumers. Any new dictation surface reproduces the
 *       bug, and `docs/AGENTS/rich-text.md` still described the losing call shape
 *       as the pattern to copy.
 *    2. Queue lifetime was the CONSUMER's, not the editor's. Held at row scope
 *       while the editor lived inside an `editing ?` branch, a transcript queued
 *       before an abandoned edit survived Cancel and was spliced into the stored
 *       note the next time that row was opened.
 *  Here the queue cannot outlive the editor it is for: unmount the editor and the
 *  queue goes with it, which is the correct answer for Cancel.
 *
 *  ★★ "IS THE REF POPULATED?" IS THE WRONG QUESTION — trust only `appendText`'s
 *  RETURN VALUE. `useImperativeHandle` in `rich-text-editor.tsx` has deps
 *  `[editor]` and `editor` is null on the first render, so React attaches a DEAD
 *  handle, detaches with `null`, then attaches the live one. Flushing on first
 *  attach fires into the no-op; clearing on the `null` detach discards the queue
 *  one beat before the handle that could have taken it.
 *
 *  ★ The composer in `note-log-panel.tsx` remounts on `key={composerNonce}` after
 *  an Add, and this queue does NOT survive that. The old consumer-scoped queue
 *  did, and its comment called that a deliberate trade — but the case is
 *  unreachable: a non-empty queue means the editor never mounted, so
 *  `composerHtml` is "" and `handleAdd` returns early without bumping the nonce.
 *
 *  ★ The handle returned here always reports `true`: it has accepted
 *  responsibility for the text, whether it landed now or is queued. */
export function RichTextEditor({ editorRef, ...rest }: RichTextEditorProps) {
  const inner = useRef<RichTextEditorHandle | null>(null);
  const pending = useRef<string[]>([]);

  const attach = useCallback((handle: RichTextEditorHandle | null) => {
    inner.current = handle;
    if (!handle) return;
    const queued = pending.current;
    if (queued.length === 0) return;
    // Swap in a fresh array BEFORE iterating: re-pushing a failure into the array
    // being iterated is an infinite loop, not a retry.
    pending.current = [];
    // `focus: false` — this runs when the chunk resolves, a moment chosen by the
    // network. Focusing then steals the caret from wherever the user has moved.
    for (const txt of queued) if (!handle.appendText(txt, { focus: false })) pending.current.push(txt);
  }, []);

  useImperativeHandle(
    editorRef,
    () => ({
      appendText(text: string) {
        // Empty is nothing to do — queueing it would make the flush a no-op that
        // still reports work.
        if (!text) return true;
        const handle = inner.current;
        if (!handle || !handle.appendText(text)) pending.current.push(text);
        return true;
      },
    }),
    [],
  );

  return <LazyEditor {...rest} editorRef={attach} />;
}

// Type-only re-export (erased at build time, so it pulls nothing into this
// module's runtime graph). Consumers that use the imperative handle take both
// names from here rather than importing the heavy module for a type.
export type { RichTextEditorHandle } from "./rich-text-editor";
