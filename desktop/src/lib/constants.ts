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
