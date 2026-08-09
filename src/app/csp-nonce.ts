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
 *  ★★ The `typeof document` guard is REQUIRED, not defensive padding. Six of the
 *  eight call sites of RichTextEditor import it STATICALLY, and a "use client"
 *  component still renders on the server, so the `useEditor({...})` options
 *  object — and therefore this function — is evaluated during SSR. Only
 *  meeting-report-panel.tsx and comm-templates-section.tsx use `ssr: false`.
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
