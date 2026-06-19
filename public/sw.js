// Minimal service worker — enables PWA installability ONLY.
//
// Deliberately does NOT precache app assets: this app ships frequently and uses
// content-hashed Next.js bundles, so a cache layer would risk serving stale
// JS/CSS. There is no `fetch` handler — every request goes straight to the
// network (always fresh). install/activate just take control immediately so the
// SW is active without a reload. Background analysis (Periodic Background Sync)
// is intentionally NOT implemented here (deferred).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
