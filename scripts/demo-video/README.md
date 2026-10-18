# Video guides recorder (§715)

These scripts take the 43 video guides of the getting-started set, one command per video, on the app's own demo project and a throwaway Turso database. Each video is a WebM recorded with Playwright, with an injected cursor and a caption bar. The parts outside the browser are recorded by hand: chapter 1 (download and install, `ch1-install`), creating the Turso database and creating the Anthropic key.

The videos and their steps are data (`videos.mjs`, `steps/`). The specs they follow are `docs/superpowers/specs/2026-10-16-video-guides-recorder-design.md` (the clips) and `docs/superpowers/specs/2026-10-16-demo-week-story-design.md` (the big video and the chapters).

## What it needs

- `.env.local` in the repo root with `TURSO_THROWAWAY_DATABASE_URL`, `TURSO_THROWAWAY_AUTH_TOKEN` and `ANTHROPIC_API_KEY`. Use a throwaway key: a recording, or a rehearsal with `--with-ai`, makes real, billed Claude calls. The scripts never print these values. Do not run them with `DEBUG=pw:api`: Playwright then logs every `fill()` argument, the token and the key included.
- The throwaway database must hold no other projects. If it holds one, the start screen is not empty and the connect step fails. Every take cleans the database first.
- A dev server on port 3300 with the deployment defaults blanked, so the setup wizard starts empty (Git Bash):

  ```bash
  NEXT_PUBLIC_TURSO_DATABASE_URL= NEXT_PUBLIC_TURSO_AUTH_TOKEN= \
  NEXT_PUBLIC_MSAL_TENANT_ID= NEXT_PUBLIC_MSAL_CLIENT_ID= NEXT_PUBLIC_TIMELOG_TENANT= \
  NEXT_PUBLIC_EXPORT_FOOTER= NEXT_PUBLIC_AI_POLICY_URL= NEXT_PUBLIC_AI_POLICY_ORG= ANTHROPIC_API_KEY= \
  node node_modules/next/dist/bin/next dev -p 3300
  ```

  `QA_BASE_URL` points the scripts at another address.

## Commands

```bash
node scripts/demo-video/record.mjs --list                # the 43 videos: tier, number, id, title
node scripts/demo-video/record.mjs --video f-gantt       # one video
node scripts/demo-video/record.mjs --tier ai             # one tier: big | chapters | ai | features
node scripts/demo-video/record.mjs --all                 # every video but the hand-recorded one
node scripts/demo-video/cleanup.mjs                      # clear the throwaway database by hand
node scripts/demo-video/discover.mjs "Resources>Planning" # list a view's controls, to write a selector
```

- `--rehearse` runs the same takes with no recording and no AI call: each AI step only checks that its trigger is there and enabled. A rehearsal also checks each finished day of the week against `DAY_FACTS` (`week-story.mjs`).
- `--with-ai` makes a rehearsal run the AI steps for real, so their checks run too. The 15 AI clips make about 15 to 25 calls.
- `--probe` stops once the demo is open, prints the nav items and saves `probe-after-demo.png`. It ends with `failed 1` by design.
- `discover.mjs` sets the demo up as a take does, then for each path prints the nav items and every visible control with its accessible name. A path joins views and actions with `>`: a nav item, `@button`, `~radio`, `!checkbox` or `#row text`, for example `"Settings>!Expert mode>@Next actions"`. It cleans the throwaway database first, so never run it while a take is running.

## What a take does

1. **Cleanup.** The throwaway database is cleared of projects and of the global rows a take writes (`scheduled_jobs`, `action_learning`).
2. **A fresh browser context**, 1280 × 720, `en-US`, Europe/Berlin, with the page clock installed at Monday 08:30.
3. **Setup, off camera.** The setup wizard connects Turso and the key; Finish switches the portfolio to Turso and reloads. Then **Explore the demo**, the device state for the new project (below), the weekly digest and the AI Assistant's consent. A chapter then replays the days before it. A clip's `setup` steps run last (for example `ai-scheduled` creates its job).
4. **Preconditions.** Each one checks that the data shows what the video needs (a duplicate pair, an over-allocated person, two saved versions). A missing one skips the take before anything is recorded.
5. **Recording.** The opening caption, then the steps. A `{ banner: <view> }` opening is that view's own hint text, read from the page; a sub-view names its path (`Resources>Planning`).
6. **The closing beat**, with the video's title.

`ch2-connect` and `big` record the setup wizard itself, so their recording starts before step 3.

An AI step waits for its result by the UI's state, never by its text, then checks the result's structure (a merge pair, an Apply button, a narrative of some length). An empty result gets one more call; a second empty one fails the take. An AI step's `replay` applies a fixed outcome by hand, so every chapter opens on the same state whatever Claude wrote the day before.

## Output

`<out>/<tier>/<NN>-<id>.webm`, with `NN` the video's position in its tier (`ch1-install` counts). `<out>` is `.superpowers/tmp/demo-video/`, which git ignores; set `DEMO_VIDEO_DIR` to write somewhere else. A take that does not end `ok` leaves `warn-<id>.png` in `<out>`.

A short AI clip (tier `ai`) shows at most three seconds of each wait for Claude (`MAX_AI_WAIT_S` in `trim.mjs`). The take notes when each AI wait starts and ends; afterwards a wait longer than that keeps its first and last 1.5 seconds, the busy state and the result arriving, and ffmpeg cuts the rest (`ffmpeg` and `ffprobe` must be on the PATH). The untrimmed take is kept as `<out>/untrimmed/ai/<NN>-<id>.webm`. The big video and the chapters are not trimmed.

## The week's clock and the replay

The demo week runs Monday 21 to Friday 25 September 2026 (`DEMO_WEEK_DATES` in `week-story.mjs`). A take starts at Monday 08:30 in Berlin. A chapter replays each earlier day off camera, moving the clock to 08:30 of that day and reloading first, then moves to its own day. The big video moves the clock between days on camera.

## The device-state fixture

`fixtures/device-state.json` is Friday's "since you last looked" record and the digest's previous run, written for the new project id after the Dashboard's own first save. The Dashboard strip then reads as on Monday after a Friday visit. `device-state.test.ts` checks the strip it produces against the demo data.

## Fixtures

- `fixtures/replan-forecast.csv` is the team's re-plan spreadsheet that the demo week imports into the bucket "Identity Platform – T&M" with **Import forecast…**. Its table sits below an assumptions block, past the ten rows Detect columns scans for a header, so Detect finds nothing and **Ask Claude** maps it; its month headers stay readable, so that mapping imports every hour. `replan-fixture.test.ts` checks both halves.

## On screen

- The database address is blurred wherever it appears. The token and the key are password fields, filled in one event so no frame shows them half typed.
- Every Turso request to a host other than the throwaway database is blocked and counts as a warning.
- Any secret found in a take's log counts as a warning.

## Exit codes

`record.mjs` ends with `RESULT ok N skipped N failed N WARNINGS N` and exits 1 when any of the last three is not 0, else 0. `--list` exits 0.

## Re-recording

Everything a re-take needs is in the repository: these scripts, their fixtures and the demo data (`sample-workspace-small.json`, which Explore the demo loads). Only `.env.local` (the throwaway pair and the key) and the videos themselves stay out of git. After the app changed:

1. Start the dev server above.
2. `node scripts/demo-video/record.mjs --all --rehearse`, then the same with `--with-ai`. Fix what fails (below).
3. `node scripts/demo-video/record.mjs --all`, or `--video <id>` for the videos that changed.

## When a re-take breaks

- **A selector no longer matches.** The UI changed. Run the video with `--rehearse`, open its `warn-<id>.png`, list the view's controls with `discover.mjs`, and fix the label in the step module (`steps/week.mjs`, `steps/ai.mjs` or `steps/features.mjs`).
- **A nav click lands during a reload.** `nav()` tries up to three times while the page title does not change.
- **A nav item was renamed or removed.** `nav()` waits for it, then the take fails with `nav: no item "<name>"`. A sub-view shows in the nav only while its parent is open: name the path.
- **The demo project's tour covers the screen.** `skipTour` waits for its Skip button.
- **A precondition is missing.** The take is skipped and the run prints `NOTE <id>: missing …`. That is the demo data (project E) being short, not a selector: fix the data, or the precondition if the data changed on purpose.
- **An AI step timed out.** The call took longer than two minutes, or its result never appeared. A failed call that the app reports as a toast ends the wait and is retried once; a slow one is not. Re-take the video; if it keeps failing, run it with `--rehearse --with-ai` and read the screenshot.

## Files

| File | What it does |
|---|---|
| `record.mjs` | Entry: parses the command, lists the videos, or runs each selected take with a cleanup between, and prints the result. |
| `cli.mjs` | Pure: `parseArgs`, `selectVideos`, `outPath`, `exitCode`, `findSecrets`. |
| `videos.mjs` | The 43 video definitions: tier, title, opening, preconditions, steps. |
| `take.mjs` | `runTake`: one take, setup to closing beat, with the AI retry rule. |
| `ai-wait.mjs` | `waitForAi`: waits for an AI call by its UI state; `timedAiWait` notes each wait on the recording's timeline. |
| `trim.mjs` | Cuts each AI wait in a short AI clip down to `MAX_AI_WAIT_S` with ffmpeg; `keepRanges` and `trimArgs` are pure. |
| `setup.mjs` | Off-camera setup: `connect`, `exploreDemo`, `seedDeviceState`, `enableDigest`, `enableChat`, `goToDay`, `currentProjectId`. |
| `ui.mjs` | The cursor and caption overlay, `caption`, `moveTo`, `click`, `type`, `nav`, `skipTour`, `closingBeat`. |
| `lib.mjs` | `T0`, `atDay`, the `.env.local` reader, the Turso guard, `settle`, `query`. |
| `cleanup.mjs` | `cleanup()` and the pure `cleanupStatements`; also runnable on its own. |
| `discover.mjs` | Lists the controls of a view on the fresh demo, for writing a step's selectors. |
| `week-story.mjs` | The story's names and dates, shared with project E's tests, and `DAY_FACTS`. |
| `steps/step.mjs` | How a step is declared. |
| `steps/week.mjs` | The prologue and Monday to Friday, each step with its replay. |
| `steps/ai.mjs` | The 15 AI clips and their preconditions. |
| `steps/features.mjs` | The 20 feature clips and their preconditions. |
| `fixtures/` | The device state and the re-plan spreadsheet. |

Tests: `week-story.test.ts`, `cleanup.test.mjs`, `device-state.test.ts`, `cli.test.mjs`, `videos.test.mjs`, `take.test.mjs`, `replan-fixture.test.ts`.
