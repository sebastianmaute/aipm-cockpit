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
5. **Recording.** The video's title in the caption bar for the first 3 s (`titleCard`), then the opening caption when it says more than the title (a chapter's opening is its title), then the steps. A `{ banner: <view> }` opening is that view's own hint text, read from the page; a sub-view names its path (`Resources>Planning`).
6. **The closing beat**: the last frame held about 1.5 s with no caption.

`ch2-connect` and `big` record the setup wizard itself, so their recording starts before step 3. `ch2-connect` is the first run (`firstRun`, `steps/first-run.mjs`): it also shows the first screen and the optional wizard steps and Review, lets Claude propose the first project and creates it, shows the empty project, then opens the demo from Projects. `big` keeps the short prologue, which cancels at the last step.

An AI step waits for its result by the UI's state, never by its text, then checks the result's structure (a merge pair, an Apply button, a narrative of some length). An empty result gets one more call; a second empty one fails the take. An AI step's `replay` applies a fixed outcome by hand, so every chapter opens on the same state whatever Claude wrote the day before.

## Output

`<out>/<tier>/<NN>-<id>.webm`, with `NN` the video's position in its tier (`ch1-install` counts). `<out>` is `.superpowers/tmp/demo-video/`, which git ignores; set `DEMO_VIDEO_DIR` to write somewhere else. A take that does not end `ok` leaves `warn-<id>.png` in `<out>`.

Every video shows about three seconds of each wait for Claude (a wait under four seconds is kept whole) (`MAX_AI_WAIT_S` in `trim.mjs`). The take notes when each AI wait starts and ends; afterwards a wait longer than that by more than a second keeps its first and last 1.5 seconds, the busy state and the result arriving, and ffmpeg cuts the rest (`ffmpeg` and `ffprobe` must be on the PATH). A trim that fails prints `TRIM FAILED` with ffmpeg's message, counts a warning and keeps the take untrimmed. The untrimmed take is kept as `<out>/untrimmed/<tier>/<NN>-<id>.webm`. A wait off camera (a chapter's replay of earlier days) is not timed, and a clip with no AI wait is left as it is.

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

## Narration

A video with a narration file (`narration/en/<id>.md`) gets a voice. `narrate.mjs` renders each spoken part with ElevenLabs into a cache; `record.mjs` then paces the take by the audio and writes an MP4 with subtitles beside the WebM. A video without a file is recorded as before, silent.

### What it needs

- `ELEVENLABS_API_KEY` in `.env.local`. `narrate.mjs` reads it with `readEnv` only when a render has work to do, and never prints it. `record.mjs` reads it too, only so its output scan can mask it.
- A voice id in `VOICE.voiceId` (`narration/tts.mjs`). It is empty until the voice is chosen, and a render with no id stops with an error. `VOICE` also fixes the model, `eleven_multilingual_v2`, and the voice settings. Changing the id, the model or a setting changes every cache key, so everything renders again.
- For the big video and the chapters, a music bed at `<out>/music/bed.mp3` with `bed.licence.txt` beside it. Nothing is checked in; the bed is the owner's file.
  - The current bed was generated with ElevenMusic on the Free plan. Its terms (section 1(b)) allow commercial use, YouTube included, only with a reasonably prominent "Made with ElevenMusic" attribution, so **every published video that carries the bed (the big video and the chapters) credits "Music: Made with ElevenMusic" in its YouTube description**. A bed made on the Pro plan needs no credit.
  - `bed.licence.txt` records where the bed came from: the generator and plan, the date, the prompt, the terms URL (`https://elevenmusic.io/terms-of-use`) and the attribution line it requires. Rights follow the plan at the time a track is made, and do not lapse when the plan changes.
  - Replacing the bed means replacing both files; the AI and feature clips never use it.
- `ffmpeg` and `ffprobe` on the PATH. `<out>` is the same folder as above (`DEMO_VIDEO_DIR` moves it).

### Commands

```bash
node scripts/demo-video/narrate.mjs --video ch3-monday      # render one video's beats (also --tier <tier>, --all)
node scripts/demo-video/narrate.mjs --all --yes             # render everything, over the cap
node scripts/demo-video/narrate.mjs --audition "<id>,<id>"  # the title beat of ch3-monday, once per voice
node scripts/demo-video/record.mjs --video ch3-monday       # the narrated take (render first)
```

- `--lang` picks the language folder (`en` is the default and the only one recorded for now). `--max-chars` and `--yes` are the cost cap, below.
- `--audition` writes `<out>/voice-audition/<voiceId>.mp3`, one file per voice, and counts against the cap like a render. Auditions are not cached under the beat's key, so they cost characters again.
- A recorded take needs the audio of every beat of its video. Without it the take stops before it starts with `no audio for beat <id> — run narrate.mjs --video <id>`.
- `record.mjs --rehearse` renders no audio and spends no credits. It keeps the token pace of a rehearsal (a pause is capped at 150 ms) and checks the beat ids: a caption whose beat is missing logs `NARRATION missing <id>` and counts a warning, a beat that no step shows logs `NARRATION unused <id>`. Without `--with-ai` a rehearsal runs no AI step, so it also exempts the beats those steps would have shown.

### Cost, cap and cache

- `narrate.mjs` prints `NARRATE <n> beats, <c> characters` before any call. It refuses above `--max-chars` (default 20000) with `would send <c> characters (cap <m>); pass --yes`, and sends nothing. `--yes` lifts the cap.
- Only beats missing from the cache count, and identical texts count once.
- Before any audio is rendered, the scripts are 287 beats and 29,219 characters (`node scripts/demo-video/narrate.mjs --all --max-chars 0` prints the count, then refuses and sends nothing). That is over the default cap, so the first full render needs `--yes`, and it is beyond the 30,000 characters a month of ElevenLabs' Starter plan once auditions and re-renders are added. Plan for a higher tier.
- The cache is `<out>/narration-cache/<lang>/<key>.mp3` with a `<key>.json` beside it holding the duration. The key is a sha256 over the language, voice id, model, voice settings and the beat's text. Editing a beat's words re-renders that beat only; changing the voice, model or settings re-renders all of them. A beat with an mp3 but no valid sidecar counts as missing. A failed render keeps the beats before it, so a re-run continues.
- Audio and the cache stay under `<out>`, which git ignores. Never commit them.

### How a take is paced

- The voice plays over the action. A caption with a beat starts its voice at once and the take carries on; the next caption, the next step and the closing beat wait until that voice has finished plus a 400 ms pause (`PAUSE_MS`). So a step that opens another view before its first caption starts only once the last beat is spoken, and a voice never runs on over a view it does not describe. A step that leaves the view its beat describes, in the middle of the step, waits for the voice first (`holdVoice` in `ui.mjs`). A rehearsal has no voice and never waits.
- A caption's beat id must be in the video's file. A recorded take fails with `no narration for beat <id>` on a missing one, and fails at the end with `narration beats never shown: ...` when a beat of the video's own file was never shown. A step lists the beats it may legitimately not show in `mayNotShow` (a wizard path, an optional branch); those are exempt.
- A beat id shown twice in one take speaks the first time only. The later caption still changes, and holds 150 ms.
- `title`, `opening` and `closing` are reserved ids for the title card, the opening caption and the closing frame. The closing frame is held until its voice is done.
- Beats are never cut by the AI-wait trim. Because the voice can run into the wait, the trim keeps the narrated spans and cuts around them.

### Outputs

- `<name>.mp4` and `<name>.srt` next to the trimmed WebM, which stays. The `.srt` is timed on the trimmed video. A short beat is one cue; a longer one is split into cues of at most two lines of 42 characters (`SRT_LINE`), at sentences, then clauses, then words, and the beat's time is shared out among them by their length.
- Audio is 48 kHz AAC, loudness-normalised to -14 LUFS (true peak -1.5 dB).
- Music goes under the big video and the chapters only (`MUSIC_TIERS`): the bed loops, sits at 35 % and ducks under the voice, fades in over 2 s and out over the last 2 s (`MUSIC_FADE_S`). Clips and features are voice only.
- If the bed is missing on a tier that wants music, the video is mixed voice only, the run prints `MUSIC missing <path> (mixed voice only)` and counts a warning.
- If the mix fails, it prints `MIX FAILED ...`, keeps the WebM, removes any partial MP4 and `.srt`, and counts a warning.

### First real render: check by eye

No rehearsal can show these, because a rehearsal has no audio. Check them on the first recorded and mixed takes:

- **Audio and picture in step.** Beat times count from just after the screencast starts, the video's time from its first frame. In the first MP4, compare one beat's audio onset with the frame where its caption appears. If they are more than about 150 ms apart, correct the offset in `startVoice` (`ui.mjs`).
- **No voice over the next view.** In the big video, `mon-save-version` ends before the reload into Tuesday, and Friday's `fri-trends` and `fri-activity` end before the next view opens.
- **Draft message** (`mon-draft-elena`, and `fri-draft-dpo` in ch7-friday). Both beats say the mail program opens. Check whether the take's browser does anything visible on the `mailto:` link, and whether it starts the mail program (Outlook) outside the page; if it does, block the link in the recorder.
- **f-swimlanes:** the starting state of "Hide finished". If it starts on, the click shows finished work while `f-swimlanes-hide-done` says the opposite.
- **f-board:** the CRM task's status.
- **f-history:** the order of the versions.
- **ai-insight:** what Act shows once clicked (`fri-insight-rec` says it records that you acted).
- **ai-steering:** the report's content.
- **ai-weights:** the view Suggest with AI shows in (`ai-weights-suggest` says Settings).
- **Budget hours follow plan** (`tue-follow-plan-off`, in ch4-tuesday, ai-forecast-import and big): the toggle's starting state. If it is already off, no click shows while the voice says to switch it off.
- **Subtitles:** the split cues read naturally and change with the voice.

### Editing a script

- Edit `narration/en/<id>.md`. The format is in `narration/en/README.md`: a `## <beat-id>` heading, then the spoken text. Line breaks inside a beat do not matter, and the text above the first heading is not spoken.
- A beat id must match the id of a caption in the video's steps (`videos.mjs`, `steps/`). A beat whose id no caption shows fails `ui.test.mjs` (the narration-file check) and fails a recorded take as never shown. A caption with no beat fails a recorded take as missing, and is a warning in a rehearsal.
- `big.md` adds to the six chapter files, and its beats override a chapter beat of the same id.
- Run a script through the `avoid-ai-writing` skill (edit mode) before it goes to the owner for review.
- After an edit, run `narrate.mjs --video <id>`: it prints how many characters it will send, and renders only what changed.

## Files

| File | What it does |
|---|---|
| `record.mjs` | Entry: parses the command, lists the videos, or runs each selected take with a cleanup between, and prints the result. |
| `cli.mjs` | Pure: `parseArgs`, `selectVideos`, `outPath`, `exitCode`, `findSecrets`. |
| `videos.mjs` | The 43 video definitions: tier, title, opening, preconditions, steps. |
| `take.mjs` | `runTake`: one take, setup to closing beat, with the AI retry rule. |
| `narrated.mjs` | The narration glue around a take: `narrationFor` (its beats, and the ids of its own file) and `trimAndMix` (trim around the beats, map each beat onto the trimmed video, mix in the take's language). |
| `ai-wait.mjs` | `waitForAi`: waits for an AI call by its UI state; `timedAiWait` notes each wait on the recording's timeline. |
| `trim.mjs` | Cuts each AI wait in a video down to `MAX_AI_WAIT_S` with ffmpeg; `keepRanges` and `trimArgs` are pure. |
| `setup.mjs` | Off-camera setup: `connect`, `exploreDemo`, `seedDeviceState`, `enableDigest`, `enableChat`, `goToDay`, `currentProjectId`. |
| `ui.mjs` | The cursor and caption overlay, `caption`, `speak`, `holdVoice`, `moveTo`, `click`, `type`, `nav`, `skipTour`, `titleCard`, `closingBeat`. |
| `narrate.mjs` | Entry: renders the narration beats of the selected videos with ElevenLabs into the cache; `--audition` renders voice samples. |
| `narration/` | `beats.mjs` (the narration files), `tts.mjs` (voice, cache, cost cap, rendering), `mix.mjs` (the MP4 and `.srt`), and the scripts in `en/`. |
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
