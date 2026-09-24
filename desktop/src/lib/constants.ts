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

// Where a person goes to get a newer build by hand. The in-app updater
// (updater.ts) reads a SEPARATE, machine-readable feed -- the public GitHub
// Releases `latest.yml`, configured via `publish:` in electron-builder.yml and
// embedded in the packaged app as `resources/app-update.yml` -- and this URL
// is not that feed. It is the page the updater's own error dialog offers (the
// "Open releases page" button, shown when a manual check fails) and the page
// the Version panel links to, for a person to open in their own browser.
//
// ★★ The installer is unsigned, so there is no code-signing check behind what
// the feed hands back. Shipping the updater anyway (rather than requiring this
// manual page forever) is a deliberate call, not an oversight: integrity comes
// from HTTPS, GitHub's immutable releases, and the sha512 in `latest.yml` --
// which is computed from the very release it accompanies, so it guards
// against TRANSFER corruption only (a bad download), not against a malicious
// build. The `release` environment's owner-approval gate is CONFIGURED AT
// FLIP STEP 10A, not before -- GitHub rejects the required-reviewer rule on
// this private repository's plan (measured 2026-09-24) -- so until then what
// stands in front of publishing a release is the tag ruleset (only the
// owner/admin role can create, move or delete a `refs/tags/v*`), the
// `release.yml` `guard` job (tag must equal APP_VERSION, commit reachable
// from `main`) and immutable releases. Nothing here substitutes for code
// signing (fix round 1, review R11 Minor 4). See the spec's auto-update
// section and register §487/§563.
export const RELEASES_URL =
  "https://github.com/sebastianmaute/aipm-cockpit/releases";
