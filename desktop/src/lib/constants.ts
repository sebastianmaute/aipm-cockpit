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
// GitLab project is `internal`: it serves nothing to an unauthenticated
// caller, so nothing the app could poll on its own would ever get a reply.
// Giving it one would mean shipping a credential to every laptop, and that
// credential (or the ACL on whatever share replaced it) would then be the
// only integrity control over code that executes on all of them -- the
// installer is unsigned, so there is no second check behind it. A link the
// user clicks keeps the authentication where it already is: in their browser,
// as themselves.
export const RELEASES_URL =
  "https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/releases";
