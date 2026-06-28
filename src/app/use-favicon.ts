"use client";
// Apply a configurable favicon (per-device `settings.branding.favicon`, a
// data:image URL) to the document's <link rel="icon">. A null/empty value
// restores the original favicon captured on first apply.
import { useEffect } from "react";

let originalHref: string | null = null;
let captured = false;

/** Set (or restore) the document favicon. Safe to call with no DOM (SSR). */
export function applyFavicon(dataUrl: string | null): void {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  // Capture the build-time default ONCE so a later remove can restore it.
  if (!captured) {
    originalHref = link.getAttribute("href");
    captured = true;
  }
  const next = dataUrl || originalHref;
  if (next) link.setAttribute("href", next);
}

/** Effect wrapper: re-applies whenever the configured favicon changes. */
export function useApplyFavicon(dataUrl: string | null): void {
  useEffect(() => {
    applyFavicon(dataUrl);
  }, [dataUrl]);
}
