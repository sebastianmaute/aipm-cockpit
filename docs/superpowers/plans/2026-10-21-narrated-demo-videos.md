# Narrated demo videos (piece 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every recorded demo video an English ElevenLabs narration. The narration sets the pace of each take, and the take ends as one YouTube-ready MP4 with an `.srt` subtitle file.

**Architecture:**
- **Narration files.** The narration lives in plain-text files, one per video. Each file is a list of beats, keyed by beat ids that the step code passes to `caption()`.
- **Rendering.** A render command turns beats into cached audio files, each with its measured duration.
- **Recording.** During a recorded take, `caption()` waits for the previous beat's audio to end, then shows its caption and notes the beat on the recording's timeline.
- **Trimming and mixing.** After the take, the existing AI-wait trim protects narrated spans. A mix step then lays the audio, plus a ducked music bed for the big video and the chapters, onto the trimmed video.

**Tech Stack:**
- Node ESM scripts in `scripts/demo-video/`.
- Playwright, as already used by the recorder.
- ffmpeg and ffprobe, already used by `trim.mjs`.
- The ElevenLabs text-to-speech HTTP API, called through `fetch`.
- Tests run with vitest in `*.test.mjs` beside each module.

**Spec:** `docs/superpowers/specs/2026-10-21-narrated-demo-videos-design.md`. Read it first. It builds on `docs/superpowers/specs/2026-10-16-video-guides-recorder-design.md` and on `scripts/demo-video/README.md`.

## Global Constraints

- **The key.** `ELEVENLABS_API_KEY` is read only through `readEnv` (`lib.mjs`), and only by the render code. It is never printed, never logged, and never passed as a command-line argument. Add it to `SECRETS`/`findSecrets` so a take's output is scanned for it.
- **Rehearsals.** `--rehearse` renders no audio, spends no credits, and keeps today's token pace (`pace` caps at 150 ms).
- **Missing audio.** A beat with no rendered audio fails a recorded take. It never falls back to a silent default hold. In a rehearsal it is a warning (`NARRATION missing <id>`).
- **Cost cap.** Before calling ElevenLabs, the render command prints the characters it will send. It refuses above `--max-chars` (default 20000) unless `--yes` is given.
- **Audio storage.** Audio and its cache live under `OUT` (`lib.mjs`, git-ignored). Never commit audio.
- **Language.** Every narration path and cache key carries a language. Piece 1 uses only `en`, but `lang` is a parameter everywhere so that piece 3 adds `de` without changing the format.
- **Line endings.** `scripts/**/*.mjs` are CRLF in the working tree; new `.mjs` files must be CRLF too. Narration `.md` files are LF.
- **Vitest.** Run it only under the lock: `bash C:/Projects/aipm-cockpit-2/.superpowers/sdd/2026-10-17-video-guides-recorder/vt.sh <log> <files>`. Read `Test Files N` from the log. Never run two at once.
- **Commits.**
  - Before each commit, run `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, both with 0 errors.
  - Use `git commit --only <paths>`, with `git add --` first for new files. Never `--amend`.
  - Messages cite §715 only. No URLs or session trailers.
- **Public repo.** Script text uses the demo's fictional names only.
- **Live Turso.** Never run any live-Turso e2e spec.

## Review Focus

1. **A re-take whose AI waits differ from the last take's.** The narration must still land on its captions, because beat times are noted per take and are never reused. Tested in Task 4 (`mapTime` over a fresh `keepRanges`).
2. **A beat that starts during a long AI wait.** The trim must keep the narrated part of the wait and cut only silence. Tested in Task 4.
3. **An edited sentence in one beat.** Only that beat re-renders, and the voice, model or settings stay unchanged. Tested in Task 2 (`beatKey` changes only with its inputs).
4. **A caption id with no beat in a narrated video, or a beat id that no step shows.** A rehearsal reports both. A recorded take fails when the caption with the missing beat runs, and warns after the take about an unused beat. Tested in Task 3.
5. **An API error, such as a 401, quota exhausted or a network failure.** The render command stops with the HTTP status and the beat id, prints no key or response headers, and leaves the beats already cached intact. Tested in Task 2.

---

### Task 1: Narration files and beat lookup

**Files:**
- Create: `scripts/demo-video/narration/beats.mjs`
- Create: `scripts/demo-video/narration/beats.test.mjs`
- Create: `scripts/demo-video/narration/en/README.md` (explains the format to the owner, in plain words)

**Interfaces:**
- Produces:
  - `parseNarration(text: string): Beat[]`, where `Beat = { id: string, text: string }`.
  - `narrationPath(lang: string, videoId: string): string`, which returns `scripts/demo-video/narration/<lang>/<videoId>.md`.
  - `loadBeats(lang: string, def: Def, { read = fs.readFileSync, exists = fs.existsSync } = {}): Map<string, string>`, mapping beat id to spoken text.
  - Reserved ids: `TITLE = 'title'` (spoken over the title card), `OPENING = 'opening'` (the opening caption), `CLOSING = 'closing'` (spoken over the closing frame).

**File format** (my call within the spec's "plain text, one file per video"):

```markdown
# Monday — a milestone slipped

## title
Monday. The MVP target passed on Friday, and nothing moved it.

## mon-hero
Before you open a single list, the dashboard puts one thing on top: ...
```

- Each `## <id>` heading starts a beat, and the paragraph text under it is the beat's spoken text. Lines are joined with single spaces.
- Text above the first heading is a title for the owner and is ignored.
- Ids match `/^[a-z0-9][a-z0-9-]*$/`.

**`loadBeats` for the big video:** first the beats of every chapter file (`ch2-connect` … `ch7-friday`, in order), then `big.md`, whose beats override the chapter beats with the same id and add its own. For any other video, only its own file is read. A video without a file returns an empty map.

- [ ] **Step 1: Write the failing tests** in `beats.test.mjs`:
  - `parseNarration` returns `[{id:'title',text:'A b.'},{id:'mon-hero',text:'C d e.'}]` for a two-heading sample whose second beat spans two lines.
  - It ignores the text above the first heading.
  - It throws `narration: bad beat id "Mon Hero"` on an invalid id.
  - It throws `narration: duplicate beat id "x"` on a repeated id.
  - It throws `narration: empty beat "x"` on a heading with no text.
  - `loadBeats('en', {id:'big'}, fakeFs)` gives `big.md`'s text for an id present in both a chapter file and `big.md`, keeps the chapter text for ids only in the chapter, and includes `big.md`-only ids.
  - `loadBeats('en', {id:'f-board'}, fakeFs)` with no file returns an empty `Map`.
- [ ] **Step 2: Run them, expect FAIL** (module not found): `bash …/vt.sh <scratch>/narr-t1.log scripts/demo-video/narration/beats.test.mjs`.
- [ ] **Step 3: Implement `beats.mjs`** with the signatures above.
- [ ] **Step 4: Run them, expect PASS** (`Test Files 1 passed`).
- [ ] **Step 5: Commit**: `feat: narration files and beat lookup for the demo videos (§715)`.

### Task 2: Rendering beats with ElevenLabs, cached

**Files:**
- Create: `scripts/demo-video/narration/tts.mjs`
- Create: `scripts/demo-video/narration/tts.test.mjs`
- Create: `scripts/demo-video/narrate.mjs` (the command)
- Modify: `scripts/demo-video/cli.mjs` (only to reuse `selectVideos`; no change if it already fits)

**Interfaces:**
- Consumes: `loadBeats` and `parseNarration` from Task 1; `readEnv` and `OUT` from `lib.mjs`.
- Produces:
  - `VOICE = { voiceId: string, modelId: 'eleven_multilingual_v2', settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true } }` in `tts.mjs`. `voiceId` starts as `''` until the owner picks one.
  - `beatKey(lang, voice, text): string`, a sha256 hex over `JSON.stringify([lang, voice.voiceId, voice.modelId, voice.settings, text])`.
  - `cachePath(lang, key): string`, which returns `OUT/narration-cache/<lang>/<key>.mp3`.
  - `audioFor(lang, voice, text): { file: string, duration: number } | null`. It returns null when not rendered. The duration is read from a sidecar `<key>.json` written at render time.
  - `renderBeat(lang, voice, text, { apiKey, fetchImpl = fetch, probe }): Promise<{ file, duration }>`. It POSTs to `https://api.elevenlabs.io/v1/text-to-speech/<voiceId>?output_format=mp3_44100_128` with header `xi-api-key` and body `{ text, model_id, voice_settings }`, writes the mp3 and the sidecar, and measures the duration with ffprobe (`probe` is injectable).
  - `planRender(lang, voice, beatsByVideo: Map<string, Map<string,string>>): { todo: {videoId, id, text}[], chars: number }`. It lists only beats not yet cached and dedupes identical texts.
- **`narrate.mjs` CLI:**
  - Selection: `--video <id> | --tier <tier> | --all` (as `record.mjs`), plus `--lang en` (the default), `--max-chars <n>` (default 20000) and `--yes`.
  - `--audition "<voiceId,voiceId,…>"` renders the beat `title` of `ch3-monday` once per voice into `OUT/voice-audition/<voiceId>.mp3`, ignoring the cache. It is capped by the same `--max-chars`.
  - The command prints `NARRATE <n> beats, <chars> characters` before any call, and `RESULT rendered <n> cached <m>` at the end.

> ★ Check the ElevenLabs request shape against their current API reference before Step 3. If the endpoint or field names differ, follow the docs and adjust the test to match. Keep the key in the header only.

- [ ] **Step 1: Write the failing tests** in `tts.test.mjs`:
  - `beatKey` is stable for equal inputs and changes when any one of `lang`, `voiceId`, `modelId`, a setting or `text` changes. That makes 5 assertions.
  - `planRender` with two videos sharing one beat text counts its characters once, and skips a beat whose cache file and sidecar exist.
  - `renderBeat` with a fake `fetchImpl` returning 200 and bytes writes `<key>.mp3` and `<key>.json` with `{ duration: 2.4 }` from a fake `probe`. The request URL contains the voice id, and the headers carry `xi-api-key`.
  - `renderBeat` with a fake 401 response rejects with `ElevenLabs 401 for beat` and writes no file. The error message does not contain the api key string.
  - A render that fails on the second of three beats leaves the first beat's cache files in place (drive it through the loop helper `renderAll(todo, opts)`, also exported).
  - The cap: `narrate`'s `checkCap(chars, max, yes)` throws `would send 25000 characters (cap 20000); pass --yes` for `(25000, 20000, false)` and passes for `yes: true`.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement `tts.mjs` and `narrate.mjs`.** Never log the response headers. Log errors as `ElevenLabs <status> for beat <id>`.
- [ ] **Step 4: Run them, expect PASS.**
- [ ] **Step 5: Commit**: `feat: render narration beats with ElevenLabs, cached by text and voice (§715)`.

### Task 3: Beat ids on every caption, and the pace during a take

**Files:**
- Modify: `scripts/demo-video/ui.mjs` (`caption`, `titleCard`, `closingBeat`)
- Modify: `scripts/demo-video/take.mjs` (`intro`, `start`, `result`)
- Modify: `scripts/demo-video/steps/week.mjs`, `steps/ai.mjs`, `steps/features.mjs`, `steps/first-run.mjs`, `scripts/demo-video/setup.mjs` (a beat id on every `caption(...)` call; about 137 calls today)
- Modify: `scripts/demo-video/record.mjs` (load the beats and audio before a take, pass them in `ctx`)
- Test: `scripts/demo-video/take.test.mjs` (extend), `scripts/demo-video/ui.test.mjs` (create)

**Interfaces:**
- Consumes:
  - `loadBeats` from Task 1. The reserved ids `TITLE`, `OPENING` and `CLOSING`.
  - `audioFor` from Task 2.
- Produces:
  - **`caption(ctx, text, id?)`.** When `ctx.narration` is set and `id` is given:
    1. wait until `ctx.voiceFreeAt` (performance-time ms);
    2. show the caption;
    3. push `{ id, at: secondsSinceRecordingStart, duration }` onto `ctx.beatLog`;
    4. set `ctx.voiceFreeAt = now + duration*1000 + PAUSE_MS`, where `PAUSE_MS = 400`;
    5. return without waiting for the audio. The voice plays over the following action.

    Without narration (a rehearsal, or a video without a file), it behaves exactly as today. ★ It also behaves as today **before the recording starts** (`ctx.recordingStartedAt == null`). That covers the off-camera replay of earlier days (`replayThrough`) and the off-camera setup: they are never held and never logged.
  - **`speak(ctx, id)`.** A voice-only beat: the same pace, no caption change. `titleCard` calls `speak(ctx, TITLE)` after showing the title. `closingBeat` calls `speak(ctx, CLOSING)` if that beat exists, then waits for `ctx.voiceFreeAt` before its 1.5 s hold.
  - **`ctx.narration`.** A `Map<id, { text, duration }>` built by `record.mjs` before the take. It is set only for a recorded take.
  - **Missing beats.** A recorded take of any video that has a narration file fails when a caption id that runs on camera has no beat. Because steps are code, this is enforced at run time: `caption` throws `no narration for beat <id>`. In a rehearsal the same check logs `NARRATION missing <id>` and counts a warning instead. A video without a narration file is not checked: it is recorded silent, as today.
  - **Result.** `runTake`'s result gains `beats: ctx.beatLog` (recorded takes only) and `unusedBeats: string[]`, the beat ids of the video's **own** file that no caption or `speak` used. Each unused beat counts as one warning. For `big`, only `big.md`'s ids count: chapter beats it never shows, such as ch2's first-run ones, are not unused.
  - **The opening caption** is `caption(ctx, opening, OPENING)`.
  - **Beat ids in steps.** These are lower-case and unique across all step modules. Prefix them by day for the week (`mon-…`, `tue-…`), with `setup-…` for `setup.mjs`, `first-…` for `first-run.mjs`, `ai-<clip>-…` and `f-<clip>-…` for the clips.

- [ ] **Step 1: Write the failing tests:**
  - **`ui.test.mjs`, with a fake `ctx`** (a fake page whose `evaluate` and `waitForTimeout` record calls, and a controllable clock):
    1. Two narrated captions 2.0 s and 1.0 s long: the second one shows no earlier than 2.4 s after the first.
    2. `caption` returns before the audio ends.
    3. Without `ctx.narration`, the calls match today's (`waitForTimeout(1200)`).
    4. A caption whose id has no beat throws `no narration for beat mon-x` in a recorded take, and logs `NARRATION missing mon-x` in a rehearsal.
    5. Before the recording starts (`recordingStartedAt` null), a narrated caption neither waits nor logs a beat.
    6. `closingBeat` waits for `voiceFreeAt` before its 1500 ms hold.
  - **`take.test.mjs`:**
    1. A recorded take returns `beats` in caption order with increasing `at`.
    2. An unused beat id gives one warning and appears in `unusedBeats`. For `big`, an unshown chapter beat is not listed.
    3. A rehearsal returns no `beats`.
  - **A guard test in `ui.test.mjs`:**
    1. Read the step modules' source and assert that every `caption(ctx,` call passes a third argument. Use the regex `caption\(ctx,[^;]*?,\s*['\`]` counted against `caption\(ctx,` (counted equal).
    2. Assert that all literal beat ids are unique.

    This guard is how a later caption without an id is caught.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement** `ui.mjs`, `take.mjs` and the `record.mjs` loading. Then add the ids to every caption call in the step modules and `setup.mjs`. Change only the call sites: no caption text, step or wait.
- [ ] **Step 4: Run them, expect PASS** (the recorder's whole test folder, so `take.test.mjs`, `videos.test.mjs` and the others stay green): `vt.sh <log> scripts/demo-video`.
- [ ] **Step 5: Rehearse three videos** with a dev server on 3300 (README): `node scripts/demo-video/record.mjs --video ch3-monday --rehearse`, then `--video f-board --rehearse` and `--video ai-digest --rehearse`. Expected: `RESULT ok 1 … WARNINGS 0` for each. There is no narration yet, so no beats are checked. The point is that the id plumbing breaks nothing.
- [ ] **Step 6: Commit**: `feat: beat ids on every caption, and the narration sets the take's pace (§715)`.

### Task 4: Trimming that keeps narration whole, and mapping beat times

**Files:**
- Modify: `scripts/demo-video/trim.mjs`
- Test: `scripts/demo-video/trim.test.mjs` (extend)

**Interfaces:**
- Consumes: `beats` (`{ id, at, duration }[]`) from Task 3.
- Produces:
  - `keepRanges(waits, duration, max = MAX_AI_WAIT_S, protect: [number, number][] = [])`. A cut `[a, b]` that overlaps a protected span is shrunk so that it doesn't, and it is dropped if less than `MIN_CUT_S` is left.
  - `mapTime(t: number, ranges): number`. It maps a time on the untrimmed recording to the trimmed one. A time inside a cut maps to the cut's start.
  - `trimAiWaits(file, waits, outRoot, { exec, protect })`, which passes `protect` through. It returns `{ cut, capped, ranges }` so the mix can map beat times.

- [ ] **Step 1: Write the failing tests:**
  1. `keepRanges([{start:10,end:30}], 60, 3, [[20,24]])` keeps `[0,11.5]`, `[18.5,…]`: the cut is shrunk to end at 20 and a second cut runs from 24 to 28.5. Assert the exact ranges your algorithm produces, and that no range boundary falls inside `[20,24]`.
  2. A protected span covering the whole wait means no cut.
  3. `mapTime(5, [[0,10],[20,30]]) === 5`.
  4. `mapTime(25, …) === 15`.
  5. `mapTime(15, …) === 10`.
  6. The existing `keepRanges` tests stay unchanged and green (`protect` defaults to `[]`).
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, expect PASS.**
- [ ] **Step 5: Commit**: `feat: the AI-wait trim never cuts inside a narrated beat (§715)`.

### Task 5: Mixing narration and music, and the subtitle file

**Files:**
- Create: `scripts/demo-video/narration/mix.mjs`
- Create: `scripts/demo-video/narration/mix.test.mjs`
- Modify: `scripts/demo-video/record.mjs` (`trimTake`, which passes `protect` from `r.beats` and then calls `mixTake`)

**Interfaces:**
- Consumes:
  - `ranges` and `mapTime` from Task 4.
  - `beats` from Task 3.
  - `audioFor` from Task 2.
- Produces:
  - `MUSIC_TIERS = ['big', 'chapters']`.
  - `MUSIC_FILE = OUT/music/bed.mp3`. The owner supplies this track with a `bed.licence.txt` next to it, because a YouTube Audio Library download needs their login. If it is missing for a music tier, the take mixes voice only and counts one warning (`MUSIC missing`).
  - `mixArgs({ video, beats: {file, at}[], music: string|null, out }): string[]`. It builds the ffmpeg arguments:
    - each beat input is delayed to `at` (`adelay`);
    - the beats are summed (`amix` with `normalize=0`);
    - with music, the bed is looped to the video length and ducked under the voice with `sidechaincompress`;
    - loudness is normalized to `-14 LUFS` (`loudnorm=I=-14:TP=-1.5`);
    - the output is H.264 (`libx264`, `-crf 20`, `-pix_fmt yuv420p`) plus AAC (`-b:a 192k`), MP4.
  - `srtText(beats: {at, duration, text}[]): string`. It writes SRT cues numbered from 1, timestamps `HH:MM:SS,mmm`, with the beat's spoken text.
  - `mixTake(webmFile, beatsMapped, narrationMap, def, { exec })`. It writes `<same name>.mp4` and `<same name>.srt` next to the WebM. A failed mix keeps the WebM and counts a warning, like a failed trim.

- [ ] **Step 1: Write the failing tests:**
  1. `mixArgs` with two beats at 1.5 s and 4.0 s puts `adelay=1500|1500` and `adelay=4000|4000` in the filter.
  2. With `music: null` the filter has no `sidechaincompress`. With music it has it, plus `-stream_loop -1` on the music input.
  3. The output ends in `.mp4` with `libx264` and `aac`.
  4. `srtText([{at:1.5,duration:2.25,text:'Hi.'}])` equals `'1\n00:00:01,500 --> 00:00:03,750\nHi.\n'`.
  5. `mixTake` with a throwing fake `exec` returns `{ warning: true }` and leaves the WebM in place.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement**, then wire it into `record.mjs`. The order is: trim with `protect` = each beat's `[at, at+duration]`, then map each beat's `at` through the returned `ranges`, then `mixTake`. The `.srt` uses the mapped times.
- [ ] **Step 4: Run them, expect PASS.**
- [ ] **Step 5: Commit**: `feat: mix narration and the music bed into a YouTube-ready MP4 with subtitles (§715)`.

### Task 6: The English scripts

**Files:**
- Create: `scripts/demo-video/narration/en/<id>.md` for:
  - `big` (overrides, prologue, opening, day transitions only);
  - `ch2-connect` … `ch7-friday`;
  - the 15 AI clips and the 20 feature clips.

  That is 42 files.

**Interfaces:**
- Consumes: the beat ids from Task 3, and the file format from Task 1.

**Rules (from the spec):**
- **Audience:** anyone with project responsibility, trained or not.
- **Tone:** a calm colleague, never a pitch.
- **Jargon:** explain each PM term the first time a video uses it.
- **Big video and chapters:** full narration, about 2.5 words per second, filling about 70–80% of each scene. Present tense, describing what is on screen. Never read the caption word for word.
- **Clips:** a `title` beat with the context line, a beat per caption (the caption lightly smoothed into speech), and one "why" sentence as the `closing` beat.
- **Big video:**
  - Its file holds only its own beats (`title`, `opening`, the prologue's and the day transitions' ids) and overrides that remove a repeat explanation.
  - Never copy a chapter beat unchanged into `big.md`.

- [ ] **Step 1:** Draft `ch3-monday.md` and `f-gantt.md` first, as samples. Then **stop and send both to the owner for review** before writing the other 40. Their answer may change the tone for all of them.
- [ ] **Step 2:** Draft the remaining 40 files.
- [ ] **Step 3:** Rehearse every video: `node scripts/demo-video/record.mjs --all --rehearse`. Expect 0 `NARRATION missing` and 0 unused-beat warnings. Fix ids or beats until clean.
- [ ] **Step 4:** Count the characters: `node scripts/demo-video/narrate.mjs --all --max-chars 0`. This is expected to refuse, and it prints the total. Report the number to the owner.
- [ ] **Step 5: Commit** the 42 files: `docs: the English narration scripts for the demo videos (§715)`.

### Task 7: Audition, first render, first narrated take, docs

This task needs the owner's ElevenLabs key in `.env.local` and the music bed in `OUT/music/`. Until both exist, stop after Step 4 and report.

**Files:**
- Modify: `scripts/demo-video/README.md` (a "Narration" section covering what it needs, the commands, the cost cap, the files and the music licence)
- Modify: `scripts/demo-video/narration/tts.mjs` (the chosen `voiceId`)

- [ ] **Step 1:** Write the README section.
- [ ] **Step 2: Commit**: `docs: how to narrate the demo videos (§715)`.
- [ ] **Step 3:** Pick candidates. Ask the owner which 3–4 stock voice ids to audition, or propose them from ElevenLabs' voice library: calm, clear, mid-pace English.
- [ ] **Step 4 (needs the key):** Run `node scripts/demo-video/narrate.mjs --audition "<ids>"`. Give the owner the four files' paths. Set `VOICE.voiceId` to their pick and commit: `feat: the narration voice (§715)`.
- [ ] **Step 5:** Render and record one chapter, then check it with the owner:
  1. `node scripts/demo-video/narrate.mjs --video ch3-monday`
  2. `node scripts/demo-video/record.mjs --video ch3-monday`

  The owner watches the MP4 and its `.srt`. Their notes go back into Task 6's files.
- [ ] **Step 6:** Render and record the rest only on the owner's word: `narrate.mjs --all --yes`, then `record.mjs --all`.
