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
//   It must return FIVE lines: THIS file's three (a type-only import, the dynamic
//   import, a type-only re-export) plus the two tests that exercise the raw
//   module. ★★ FIVE IS NOT THE NUMBER OF REFERENCES — SEVERAL test suites name the
//   raw module inside a `vi.mock(…)` and this sweep CANNOT see any of them, because
//   there is no `from`/`import`/`require` before the string. That is harmless for the
//   bundle (a mock is not a static import) and worth knowing before you conclude the
//   sweep enumerates every mention. ★★ NO NUMBER IS WRITTEN HERE ON PURPOSE: this note
//   named two files (`*.stall`, `*.refused`) and was ALREADY wrong when written —
//   `meeting-report-panel.test.tsx` was a third — and a fourth (`*.strictmode`) landed
//   after. Enumerate them instead, never from a number here:
//     grep -rn 'vi.mock("./rich-text-editor"' src --include=*.test.tsx
//   (scoped to test files, so the command cannot match this comment). ★★ This said "the dynamic import and type-only re-export, plus the two
//   tests" — four — while `csp-nonce.ts` carried a DIFFERENT, also-wrong enumeration
//   of the SAME command. Two files, two mutually inconsistent counts, neither run.
//   Run it; do not trust the five either.
//   A --include=*.tsx filter rooted at ./ cannot see a ../rich-text-editor import
//   from `settings-sections/` or `dashboard-sections/`. Both hold consumers, but they
//   reach the editor through THIS module, so no sweep for the RAW module finds
//   them today — the narrower form is a hazard waiting on the next raw importer,
//   not a difference you can currently measure.
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
import { useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { logDiag } from "./diagnostics";
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

/** How long a queued append may wait for the chunk before the wait is
 *  REPORTED. Deliberately generous: the queue exists BECAUSE the chunk can be
 *  slow, so a threshold tight enough to fire on an ordinary slow connection
 *  produces a warning nobody reads.
 *
 *  ★ Exported so `rich-text-editor-lazy.stall.test.tsx` can drive its fake clock
 *  from THIS number. A test that retypes the threshold passes for the wrong
 *  reason the moment the threshold moves. */
export const QUEUE_STALL_MS = 15_000;

/** Replay `queued` into `handle`, pushing whatever is still outstanding into
 *  `sink`: both the items the handle REFUSED (a falsy return) and — this is the
 *  point — the items a THROW never reached.
 *
 *  ★★ A THROW MID-FLUSH MUST NOT TAKE THE TRANSCRIPTS BEHIND IT. The caller has
 *  already swapped `queued` out of its pending array before calling (re-pushing a
 *  failure into the array being iterated is an infinite loop, not a retry), so
 *  without the `finally` the items after the failing one are simply GONE — one bad
 *  append discards every LATER one, which is the same class of loss the queue
 *  exists to close.
 *
 *  ★★★ WHAT "KEPT" MEANS HERE, PRECISELY, BECAUSE THE OBVIOUS READING IS WRONG:
 *  the remainder survives IN THE QUEUE. It does NOT mean some later attach
 *  replays it. Measured with a stub editor whose `appendText` throws, rendered
 *  under an error boundary: the throw propagates out of the callback ref into
 *  React's commit phase, the boundary catches it, and the editor is UNMOUNTED —
 *  in the app the nearest boundary is the top-level one in `page.tsx`, so the
 *  whole tree goes to the crash page and this component's `pending` dies with it.
 *  Requeueing is still the only shape that could ever be right (a caller that
 *  contains the throw finds the text where it left it, and losing it is
 *  unrecoverable either way), but do not read it as a recovery path that exists
 *  today. Containing and reporting the throw instead is a real option and is
 *  deliberately NOT taken here — it would change what a failed insert does to the
 *  app, which is a bigger decision than this fix.
 *
 *  ★★ The item at `i` is re-queued TOO, not skipped: a Tiptap command dispatches
 *  ONE transaction, so a throw means it never applied and re-queueing it cannot
 *  duplicate it. Skipping it would trade a duplicate risk that does not exist for
 *  a loss that does.
 *
 *  ★ It RETHROWS — a `finally`, never a `catch`. Swallowing here would leave the
 *  editor in a state nothing reported. The sink is correct on both paths; on the
 *  normal one `i === queued.length` makes the slice empty.
 *
 *  ★ A module-scope function rather than a closure so the throw path is reachable
 *  from a test with a fake handle. Driving it through React would mean making a
 *  real ProseMirror transaction fail on demand. */
export function flushPending(
  handle: RichTextEditorHandle,
  queued: readonly string[],
  sink: string[],
): void {
  let i = 0;
  try {
    for (; i < queued.length; i++) {
      // `focus: false` — this runs when the chunk resolves, a moment chosen by the
      // network. Focusing then steals the caret from wherever the user has moved.
      if (!handle.appendText(queued[i], { focus: false })) sink.push(queued[i]);
    }
  } finally {
    if (i < queued.length) sink.push(...queued.slice(i));
  }
}

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
  // ★★ THE QUEUE IS UNBOUNDED BY DESIGN, AND THE TIMER BELOW IS WHY THAT IS SAFE
  //   TO SHIP. A cap can only be enforced by DROPPING, which is the exact silent
  //   data loss this module exists to prevent — so the answer to "what if the
  //   chunk never arrives?" is to REPORT, never to discard. Growth is bounded in
  //   practice by how much a person can dictate while one chunk is in flight.
  const stall = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reported = useRef(false);

  const clearStall = useCallback(() => {
    if (stall.current === null) return;
    clearTimeout(stall.current);
    stall.current = null;
  }, []);

  // ★ Armed by the FIRST queued append and never re-armed once it has fired: one
  //   report per mounted editor. Re-arming would emit a fresh warning every
  //   QUEUE_STALL_MS for as long as the user keeps talking, and the diagnostic
  //   ring is capped — a stall that reports itself 40 times evicts everything
  //   else that mattered, which is a worse outcome than not reporting at all.
  const armStall = useCallback(() => {
    if (stall.current !== null || reported.current) return;
    stall.current = setTimeout(() => {
      stall.current = null;
      reported.current = true;
      logDiag("warn", "richText.appendQueueStalled", { queued: pending.current.length });
    }, QUEUE_STALL_MS);
  }, []);

  // ★ Unmount must DISARM. A queue discarded by unmount is CORRECT — Cancel on a
  //   note row does exactly that, deliberately (see the queue's ★★★ block) — so a
  //   report fired afterwards would name a loss the user had asked for.
  useEffect(() => clearStall, [clearStall]);

  const attach = useCallback((handle: RichTextEditorHandle | null) => {
    inner.current = handle;
    if (!handle) return;
    const queued = pending.current;
    if (queued.length === 0) return;
    // Swap in a fresh array BEFORE iterating: re-pushing a failure into the array
    // being iterated is an infinite loop, not a retry.
    pending.current = [];
    try {
      flushPending(handle, queued, pending.current);
    } finally {
      // Disarm only once the queue is genuinely empty. A refused item, or one a
      // throw never reached, is still outstanding and still worth reporting.
      if (pending.current.length === 0) clearStall();
    }
  }, [clearStall]);

  useImperativeHandle(
    editorRef,
    () => ({
      appendText(text: string, opts?: { focus?: boolean }) {
        // Empty is nothing to do — queueing it would make the flush a no-op that
        // still reports work.
        if (!text) return true;
        const handle = inner.current;
        // ★★ `opts` is FORWARDED on the live path. This wrapper is the only editor
        // any consumer can reach, so an arity-1 signature here left the `opts` the
        // handle type advertises unreachable from the entire app — and it
        // typechecks, because arity-1 is assignable to `(text, opts?) => boolean`.
        // ★ The REPLAY deliberately does NOT forward it: see `attach`, which always
        // passes `focus: false` because the moment of replay is chosen by the
        // network rather than by the caller.
        if (!handle || !handle.appendText(text, opts)) {
          pending.current.push(text);
          armStall();
        }
        return true;
      },
    }),
    [armStall],
  );

  return <LazyEditor {...rest} editorRef={attach} />;
}

// Type-only re-export (erased at build time, so it pulls nothing into this
// module's runtime graph). Consumers that use the imperative handle take both
// names from here rather than importing the heavy module for a type.
export type { RichTextEditorHandle } from "./rich-text-editor";
