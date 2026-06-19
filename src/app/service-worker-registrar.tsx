"use client";

import { useEffect } from "react";

/** Registers the minimal service worker (`/sw.js`) for PWA installability.
 *  Renders nothing. Must be a CLIENT component: the registration call ships in
 *  the nonce-trusted app bundle, whereas an inline <script> could not carry the
 *  per-request CSP nonce (src/proxy.ts). Registration is best-effort — the app
 *  works identically without it (the SW does no caching). */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* best-effort: installability is a progressive enhancement */
    });
  }, []);
  return null;
}
