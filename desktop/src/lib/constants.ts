// The desktop app's origin. Both values are FIXED and deliberately not
// configurable: they compose the browser origin, and IndexedDB is scoped to
// scheme+host+port. A configurable port would let a user (or a future
// "helpful" fallback) silently swap their own data store.
//
// 17300 avoids 3000 (dev server), 3100 (isolated axe runs) and 3200
// (e2e:smoke:prod), and sits below the Windows ephemeral range (49152+) so
// the OS will not hand it to an unrelated process as a temporary port.
export const APP_HOST = "127.0.0.1";
export const APP_PORT = 17300;
export const APP_ORIGIN = `http://${APP_HOST}:${APP_PORT}`;

// Where a person goes to get a newer build. This is a PAGE for a human to
// open in their own browser -- where they are already signed in -- and NOT a
// machine-readable update feed.
//
// ★★ That distinction is the whole reason the app has no in-app updater. The
// installer is unsigned, so there is no second integrity check behind
// whatever a machine-readable feed handed back -- an unattended poller would
// be exactly the thing that needed one. A link the user clicks keeps the
// authentication (and the judgment call) where it already is: in their
// browser, as themselves.
export const RELEASES_URL =
  "https://github.com/sebastianmaute/aipm-cockpit/releases";
