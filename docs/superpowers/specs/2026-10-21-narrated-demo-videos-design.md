# Narrated demo videos — design (piece 1 of 4)

Status: draft for the owner's approval, 2026-10-21.

Builds on [the video guides recorder](2026-10-16-video-guides-recorder-design.md) and [the demo week story](2026-10-16-demo-week-story-design.md). The recorder is `scripts/demo-video/`; read its README first.

## Why

The recorded demo videos (the big video, 6 recorded chapters, 15 AI clips, 20 feature clips; about 48 minutes) carry short on-screen captions and no sound. The videos go on YouTube, and the app embeds them, so each one has to explain itself to a viewer who arrives on it alone. The owner wants a spoken narration voiced with ElevenLabs.

**Audience (owner, 2026-10-21):** anyone with project-management responsibility, including people with no training in project management. The narration says in plain words what a term means (RAID, RACI, baseline, milestone slip) and why it matters, then shows the app handling it.

## The whole programme, and where this document sits

The owner split the work into four pieces and set their order on 2026-10-21: **1 → 4 → 2 → 3**.

1. **Narration pipeline and English scripts** (this document).
2. **German demo project:** the demo dataset and the week-story fixtures in German.
3. **German recordings:** the recorder finds controls by language-neutral keys, the German app and the German demo project are recorded, and the narration is translated from the English beats. Each language is its own take and its own YouTube upload, because the narration sets the pace and German runs longer.
4. **YouTube in the app:** embedded players with a link out to YouTube, and the CSP allowlist this needs.

This document designs piece 1 only, but it must not block piece 3. Script files and audio caches are keyed by language from the start.

## Goals

- **The mix (owner decision):**
  - The **big video and the chapters** get full narration: what the user does, why, and what the app does for them. It fills about 70–80% of the runtime.
  - Each **AI and feature clip** gets its caption spoken, plus one "why" sentence. Each clip opens with a context line, so it stands alone when found on YouTube.
- **The narration sets the pace (owner decision):**
  - Every beat is rendered to audio before the take.
  - During the take, a caption stays up until its audio has finished, plus a short pause.
  - A scene runs as long as its narration needs and never cuts into the next one.
  - A re-take stays in sync on its own.
- **Voice:** an ElevenLabs stock voice (owner decision). The owner picks it by ear from an audition of three or four candidates (see "Voice audition"). The same voice is used for every English video.
- **Music (owner decision):** a quiet royalty-free bed under the big video and the chapters, ducked under the voice. The AI and feature clips are voice only.
- **One finished file per video**, ready for YouTube: picture, narration, and music where it applies.
- **Editable scripts:** the narration lives in the repo as one plain-text file per video, so the owner can read and change it without touching code.
- **A small re-render after an edit:** after a script edit, only the changed beats are regenerated.

## Non-goals

- German narration, German recordings and the German demo project. These are pieces 2 and 3. The design only keeps a `lang` dimension open.
- Uploading to YouTube, or anything in the app (piece 4).
- Narrating `ch1-install`. It is hand-recorded and has no captions; see "Open for the owner".
- Changing what the videos show. Steps, data and the week story stay as they are. Only how long each caption is held changes.

## Anti-goals (a failure even if it technically works)

- **Narration that sounds like marketing.** The tone is a calm colleague showing you the ropes, not a pitch.
- **Jargon left unexplained.** A PM term that goes unexplained the first time a video uses it is a script defect.
- **Narration out of step with the picture:** a voice describing a screen that has already gone, or audio that drifts across the trims.
- **Silent narration loss:** a beat with no audio that the take quietly holds for a default time. A missing or stale beat fails the take, except in a rehearsal.
- **Overspend:** a run that renders all 48 minutes because a cache key changed by accident.
- **The API key printed, or written anywhere other than `.env.local`.**

## Constraints (carried from the recorder)

- **Recording setup:** the recorder runs in a browser on the throwaway Turso database, cleans up before each take, and trims AI waits (`trim.mjs`, `MAX_AI_WAIT_S`). All of that stays.
- **API key:** `ELEVENLABS_API_KEY` is read from `.env.local` by the narration step only. It is never printed, logged, or passed on a command line.
- **Public repo:** script text uses the demo's fictional names only.
- **Rehearsals stay free:** `--rehearse` renders no audio and spends no credits.
- **Plan:** the owner has no ElevenLabs plan yet. The design must let the scripts and pipeline be written and rehearsed without a key. The recommended plan is Creator, because the English narration needs about 40,000 characters plus auditions and re-renders. Starter's 30,000 does not cover that.

## How it works

### Beats

A **beat** is one unit of narration. Most beats belong to an on-screen caption; a few are voice-only (see below). Each video's narration file lists its beats in take order, and each beat carries:

- **a beat id.** The step that shows the caption names the same id (`caption(ctx, text, 'mon-hero')`, for example). The recorder matches beats by **id, not by caption text**. Captions built at take time (filled-in names, `ctx.newFromEmpty` variants, `{ banner: <view> }` openings read from the page) still match, and the German captions of piece 3 will match the same ids. *(My call.)*
- **the spoken text.**

A missing beat, or a beat id no step shows, fails the take. The exception is a rehearsal, which reports it and carries on.

**Voice-only beats** (my call): a clip's **context line** is spoken over the title card. Each video also carries an optional **closing beat** over its closing frame. These beats have no caption on screen.

**Clips** (my call): every caption in a clip is spoken (f-gantt has about 8), and the one "why" sentence is a beat of its own. It is placed after the caption it explains, or spoken over the closing frame. Clip beats are short: the caption's words, lightly smoothed into speech.

**The big video** (my call): it reuses the chapter beats by id, and may **override** any of them with a variant of its own. That lets it drop a term already explained earlier in the same video, or bridge two days. It owns its prologue beats outright, because it runs `PROLOGUE` and not ch2's `FIRST_RUN`, and its opening and `goTo` day transitions. Each chapter explains its terms on its own; the big video's overrides remove the repeats.

### Rendering (before the take)

A render step reads a video's narration file. For each beat whose audio is not cached, it calls ElevenLabs and stores the audio with its measured duration.

- **Cache key:** hash of (language, voice id, model id, voice settings, spoken text). Changing one sentence re-renders one beat.
- **Cost estimate:** before any call, the step prints the number of characters it will render, and refuses above a cap unless told to proceed.
- **Cache location:** under the recorder's output directory, git-ignored. Audio is never committed.

### Taking (the pace)

**The voice plays over the action; it does not freeze it** (my call). `caption()` (in `ui.mjs`) shows the caption as today and notes, on the recording's timeline, the moment the caption appeared and its beat's audio length. That works the same way `timedAiWait` notes AI waits (`ctx.recordingStartedAt`). The step then carries on clicking while the voice plays. Before the **next** beat starts, the take waits until the previous beat's audio has ended, plus a short pause. So a scene lasts as long as the longer of its action and its narration. When the action ends first, the frame is held on the result while the voice finishes.

The scripts are written for that: the voice describes what is happening and has just happened on screen, in the present tense.

A rehearsal keeps today's token pace and needs no audio. Off-camera replays of earlier days (`replayThrough`) are not held.

### Trimming

AI waits are still cut down to `MAX_AI_WAIT_S`. Each beat's start time is mapped through the same keep-ranges as the picture. Because the voice plays over the action, a beat can run into an AI wait. **A cut never falls inside a beat's audio span**: the trim keeps the overlapping part of the wait, and only the silent rest of a long wait is cut.

### Mixing (after the take)

ffmpeg places each beat's audio at its mapped start. Where music applies, it adds the bed, ducked under the voice. It normalizes loudness for YouTube and writes the finished file as MP4 (H.264 video, AAC audio), next to today's WebM. It also writes an `.srt` subtitle file from the beats, which YouTube can take as captions.

### Voice audition

A one-off command renders one representative beat in three or four candidate stock voices into the output directory, so the owner can listen and pick. The chosen voice id goes into the recorder's config, not into the scripts.

## Writing the scripts

- **Speaking rate:** about 2.5 words per second. A beat that needs longer than its scene simply lengthens the scene, but the full narration should not double a chapter's length.
- **Plain words:**
  - Each PM term is explained the first time it appears in a video, because each video may be watched alone.
  - The narration never reads the caption back word for word in the full-narration videos. The caption is the headline, and the voice adds what and why.
- **Clips:** the context line, the caption spoken, and one "why" sentence. Nothing more.
- **Owner review:** the English scripts are drafted from the steps and captions, then reviewed by the owner before any audio is rendered.

## Open for the owner

1. `ch1-install` is hand-recorded, with no captions. Should it get narration (a script the owner reads while recording, or a voice-over added to the hand recording), or stay silent?

## Left to the builder

- The narration file format and where the files live, within "plain text, one file per video, editable by the owner".
- The pause length after a beat, the ducking and loudness settings, and the character cap.
- The ElevenLabs model, as long as it is good enough to publish and uses one credit per character or less.
- Which music track, as long as it comes from YouTube's Audio Library or has an equally clear licence, and its licence is recorded next to it.
