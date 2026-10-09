// src/app/demo-intent.ts
//
// The demo's two one-shot boot notices. Each survives a reload the app triggers itself, so each
// lives in localStorage under `aipm-cockpit:*` (which `clearAppConfig` already wipes):
//
//   • the INTENT: the demo card's "Set up Turso first" stores it before the wizard's portfolio
//     switch reloads the app; the next boot offers the demo with its Trends history.
//   • the CREATED-LOCALLY notice: when the Turso create fails, the local fallback switches the
//     portfolio to file mode and reloads, so a toast shown before the reload is never seen. The
//     next boot shows it instead.
//
// ★★ Both are READ in a `useState` initializer and CLEARED in an effect. StrictMode double-invokes
// the initializer, so a read-and-clear there hands the second call an empty slot and the note
// never shows. The effects run their one-shot work behind a ref, because StrictMode re-runs them.

import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "./i18n";
import type { ToastAction } from "./use-toast";

export const DEMO_INTENT_KEY = "aipm-cockpit:demo-intent";
export const DEMO_CREATED_LOCALLY_KEY = "aipm-cockpit:demo-created-locally";
const INTENT_VALUE = "turso-setup";
const CREATED_LOCALLY_VALUE = "1";

function readSlot(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // no storage (SSR, privacy mode): there is no notice to show
  }
}

function writeSlot(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Best-effort by design: without storage the notice is simply not carried across the reload.
  }
}

export function readDemoIntent(): "turso-setup" | null {
  return readSlot(DEMO_INTENT_KEY) === INTENT_VALUE ? INTENT_VALUE : null;
}
export function setDemoIntent(): void { writeSlot(DEMO_INTENT_KEY, INTENT_VALUE); }
export function clearDemoIntent(): void { writeSlot(DEMO_INTENT_KEY, null); }

export function readDemoCreatedLocally(): boolean {
  return readSlot(DEMO_CREATED_LOCALLY_KEY) === CREATED_LOCALLY_VALUE;
}
export function setDemoCreatedLocally(): void { writeSlot(DEMO_CREATED_LOCALLY_KEY, CREATED_LOCALLY_VALUE); }
export function clearDemoCreatedLocally(): void { writeSlot(DEMO_CREATED_LOCALLY_KEY, null); }

export interface DemoBootDeps {
  lang: Lang;
  /** The number of seeded Trends weeks, for the note's copy. */
  weeks: number;
  /** The empty state is up. Once it shows, the intent has its answer. */
  showEmptyState: boolean;
  /** The main tree is up (hydrated, no load hold, no Turso list fetch in flight), so a toast
   *  shown now is seen, and a Turso portfolio with projects has been told apart from an empty one. */
  settled: boolean;
  /** `isTursoUsable(portfolioMode, tursoConfig)` — the note is only true with a usable config. */
  tursoUsable: boolean;
  showToast: (kind: "info", text: string) => void;
  showToastAction: (kind: "info", text: string, action: ToastAction) => void;
  loadDemo: () => Promise<void>;
}

/** Reads both notices once per boot and acts on each when its answer is known: the intent becomes
 *  the empty state's connected note, or (projects present) a toast offering the demo; the
 *  created-locally notice becomes a toast. */
export function useDemoIntentOnBoot(deps: DemoBootDeps): { connectedNote: boolean } {
  const { lang, weeks, showEmptyState, settled, tursoUsable, showToast, showToastAction, loadDemo } = deps;
  const [intent] = useState(readDemoIntent);
  const [createdLocally] = useState(readDemoCreatedLocally);
  const intentHandled = useRef(false);
  const createdLocallyHandled = useRef(false);

  useEffect(() => {
    if (intent === null || intentHandled.current || !(showEmptyState || settled)) return;
    intentHandled.current = true;
    clearDemoIntent();
    if (showEmptyState || !tursoUsable) return; // the empty state shows the note itself
    showToastAction("info", t(lang, "demoTursoConnectedNote", weeks), {
      labelKey: "tourLoadDemo",
      run: () => { void loadDemo(); },
    });
  }, [intent, showEmptyState, settled, tursoUsable, lang, weeks, showToastAction, loadDemo]);

  useEffect(() => {
    if (!createdLocally || createdLocallyHandled.current || !settled) return;
    createdLocallyHandled.current = true;
    clearDemoCreatedLocally();
    showToast("info", t(lang, "demoCreatedLocallyToast"));
  }, [createdLocally, settled, lang, showToast]);

  return { connectedNote: intent !== null && tursoUsable && showEmptyState };
}
