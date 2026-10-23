// §772 — a per-device label a scheduled report carries as `claimed_by`, so the Scheduled reports view can
// say "this device". Minted once (first 8 chars of a UUID) and kept in localStorage; never identifying.
const KEY = "aipm-cockpit:device-label";
const LABEL_LENGTH = 8;

export function getDeviceLabel(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
    const minted = crypto.randomUUID().slice(0, LABEL_LENGTH);
    localStorage.setItem(KEY, minted);
    return minted;
  } catch {
    return "unknown";
  }
}
