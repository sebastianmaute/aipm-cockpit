# Demo video recorder (§715)

These scripts record the web-app part of the getting-started video as one continuous WebM, using Playwright with an injected cursor and a caption bar. The parts outside the browser are recorded by hand and spliced in: chapter 1 (download and install), 2.1 (creating the Turso database) and 2.3 (creating the Anthropic key).

| File | What it does |
|---|---|
| `record.mjs` | Records chapters 2.2, 2.4, 2.5 and 3–8. `--rehearse` runs the same flow quickly with no video. `--probe` stops after 3.1 and prints the nav items; it ends with `DEMO ERROR probe stop` and `WARNINGS 1` by design, and without `--rehearse` it still writes a video. |
| `cleanup.mjs` | Deletes the recording's projects from the throwaway database, matched by name. Run it before and after every take. |
| `lib.mjs` | Shared helpers: the `.env.local` reader, the Turso guard, navigation, the pinned clock. |

## What it needs

- `.env.local` in the repo root with `TURSO_THROWAWAY_DATABASE_URL`, `TURSO_THROWAWAY_AUTH_TOKEN` and `ANTHROPIC_API_KEY`. Use a throwaway key: chapter 2.5 makes one real Claude call. The scripts never print these values. Do not run them with `DEBUG=pw:api`: Playwright then logs every `fill()` argument, the token and the key included.
- The throwaway database must hold no other projects. If it holds one, the start screen is not empty and chapter 2 fails.
- A dev server on port 3300 with the deployment defaults blanked, so the setup wizard starts empty (Git Bash):

  ```bash
  NEXT_PUBLIC_TURSO_DATABASE_URL= NEXT_PUBLIC_TURSO_AUTH_TOKEN= \
  NEXT_PUBLIC_MSAL_TENANT_ID= NEXT_PUBLIC_MSAL_CLIENT_ID= NEXT_PUBLIC_TIMELOG_TENANT= \
  NEXT_PUBLIC_EXPORT_FOOTER= NEXT_PUBLIC_AI_POLICY_URL= NEXT_PUBLIC_AI_POLICY_ORG= ANTHROPIC_API_KEY= \
  node node_modules/next/dist/bin/next dev -p 3300
  ```

  `QA_BASE_URL` points the scripts at another address.

## Taking a video

```bash
node scripts/demo-video/cleanup.mjs
node scripts/demo-video/record.mjs --rehearse   # must end with "WARNINGS 0"
node scripts/demo-video/cleanup.mjs
node scripts/demo-video/record.mjs              # about 7 minutes
node scripts/demo-video/cleanup.mjs
```

The video is written to `.superpowers/tmp/demo-video/aipm-cockpit-getting-started.webm`, which git ignores. Set `DEMO_VIDEO_DIR` to write somewhere else. Each failed scene logs `WARN` and leaves a `warn-<scene>.png` screenshot in the same folder. The run continues, so check the count at the end: the script exits 1 when it is not 0. A request to any Turso host other than the throwaway database is blocked and counts as a warning too.

## On screen

- The database address is blurred wherever it appears. The token and the key are password fields.
- The browser clock is pinned to `T0` in `lib.mjs` (2 November 2026). Chapter 7 moves it three weeks forward and reloads, so the dashboard shows overdue work. If `T0` falls in the past, the dates in the video read as stale, so move it forward before a new take.
- Every Turso request to a host other than the throwaway database is blocked.

## When a re-take breaks

- **A selector no longer matches.** The UI changed. Run `--rehearse`, open the `warn-*.png` screenshot, and fix the label in `record.mjs`.
- **A nav click lands during a reload.** `nav()` clicks again, up to three times, while the page title does not change.
- **A nav item was renamed or removed.** `nav()` waits 60 seconds for it, then the scene fails with a timeout. Fix the name in `record.mjs`.
- **The demo project's tour covers the screen.** `skipTour` waits up to 30 seconds for its Skip button. The tour is visible for about 15 seconds before that, so trim it in the edit.
