// src/app/demo-banner-state.ts
//
// Per-device memory of "the dashboard's demo suggestion is finished": the user dismissed it, or
// opened the demo once (which also keeps it off the demo itself). Pure and DOM-free so the
// demo orchestrator (`useLoadDemo`) can mark it without importing the banner component.
// localStorage only, every access in try/catch: nothing here enters the persisted Workspace.

export const DEMO_BANNER_DONE_KEY = "aipm-cockpit:demo-banner-done";

export function readDemoBannerDone(): boolean {
  try {
    return window.localStorage.getItem(DEMO_BANNER_DONE_KEY) !== null;
  } catch {
    return false; // storage blocked: the banner stays available rather than vanishing
  }
}

export function markDemoBannerDone(): void {
  try {
    window.localStorage.setItem(DEMO_BANNER_DONE_KEY, "1");
  } catch {
    // best effort: without storage the banner simply reappears next load
  }
}
