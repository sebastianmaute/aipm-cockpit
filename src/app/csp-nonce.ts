// src/app/csp-nonce.ts — the per-request CSP nonce, for code that must hand it
// to a third-party library rather than let Next.js apply it.
//
// Today that is exactly one caller: rich-text-editor.tsx passes it to Tiptap's
// `injectNonce`, because @tiptap/core injects its ProseMirror base stylesheet at
// runtime with document.createElement("style") and the prod CSP is
// `style-src-elem 'self' 'nonce-…'` (src/proxy.ts). See open-followups §54.

/** The per-request CSP nonce, or `undefined` when there is none to read.
 *
 *  ★★★ READS THE IDL PROPERTY, NOT THE ATTRIBUTE VALUE, AND THAT IS THE WHOLE
 *  POINT. The HTML spec EMPTIES the `nonce` content attribute once the element
 *  is inserted ("nonce hiding") and moves the value to an internal slot exposed
 *  as the `.nonce` IDL property — specifically so a CSS or selector-based attack
 *  cannot exfiltrate it. The PRESENCE selector `[nonce]` still matches (the
 *  attribute is there, its value emptied); only the IDL property still carries
 *  the value. Never rewrite this as `getAttribute("nonce")`: it returns "" in a
 *  real browser while passing every jsdom test, because jsdom does not implement
 *  nonce hiding.
 *
 *  ★★ Corollary: a green unit test does NOT prove the browser path. The only
 *  check that can is a real-browser one — see `npm run e2e:smoke:prod` and the
 *  verification recorded in open-followups §54.
 *
 *  ★★ KEEP the `typeof document` guard — but its justification INVERTED, and the
 *  old one is preserved here because a reader who finds only the new state will
 *  delete the guard. UNTIL 2026-08-19 it was required by a live path: six of the
 *  eight RichTextEditor call sites imported the editor STATICALLY, a "use client"
 *  component still renders on the server, so the `useEditor({...})` options object
 *  — and therefore this function — really was evaluated during SSR. Every call
 *  site now loads through `rich-text-editor-lazy.tsx`, which is `ssr: false`, so
 *  NOTHING reaches this function on the server today. Reproduce both halves:
 *    grep -rnE "(from|import|require).{0,4}[\"'][^\"']*rich-text-editor[\"']" src e2e scripts
 *      → FOUR lines, and none of them is a consumer: three in
 *        `rich-text-editor-lazy.tsx` (a type-only import, the dynamic import, a
 *        type-only re-export) plus `rich-text-editor.test.tsx`, which exercises
 *        the raw module deliberately. ★ A `--include=*.tsx` sweep rooted at `./`
 *        misses a `../rich-text-editor` import from a subdirectory, which is why
 *        this one is rooted at `src e2e scripts` and admits `../`.
 *    grep -rn 'readCspNonce(' src --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -v csp-nonce.ts
 *      → exactly ONE line: `rich-text-editor.tsx`. The trailing `grep -v` is not
 *        tidying — without it THIS comment matches its own command. ★★ Keep the
 *        whole pipeline on ONE line: the previous spelling wrapped it across two
 *        comment lines with a trailing backslash, which the shell read as a file
 *        named `r` (`grep: r: No such file or directory`, exit 2). A reproduce
 *        command that does not run is worse than none — it reads as evidence.
 *  ★★★ That makes the guard defensive, NOT dead, and the difference is one word in
 *  one file: flip `ssr` to true in `rich-text-editor-lazy.tsx` — or add a second
 *  caller that is not behind a `dynamic` boundary — and the SSR path is armed
 *  again with no other edit. A guard whose live path was removed is the guard
 *  most likely to be tidied away by whoever removes the NEXT one.
 *
 *  ★ `document.querySelector("script[nonce]")` is not specific to the one
 *  hand-authored nonced tag in `layout.tsx` — it also matches Next.js's own
 *  auto-nonced framework/page `<script>` elements. That is fine: every nonced
 *  element on a given request shares the SAME nonce, the one minted once per
 *  request in `src/proxy.ts`, so whichever nonced script this selector reaches
 *  first yields an identical string.
 *
 *  ★ Deliberately NOT threaded down as a prop or React context from layout.tsx,
 *  which already reads the `x-nonce` header: that would put the real value back
 *  into readable DOM, which is strictly worse than reading it where the platform
 *  already keeps it.
 *
 *  ★ An empty value returns `undefined`, not "", so a caller can pass the result
 *  straight through to an option whose "absent" case is `undefined`. */
export function readCspNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.querySelector<HTMLScriptElement>("script[nonce]");
  return el?.nonce || undefined;
}
