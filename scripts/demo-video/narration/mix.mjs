// §715 narration mix: after a take is trimmed, ffmpeg lays each narration beat on it (delayed to the beat's time)
// and, for the big video and the chapters, a music bed ducked under the voice, into a YouTube-ready MP4; an .srt
// of the beats' spoken text is written beside it. The bed is supplied by the owner (OUT/music/bed.mp3, with a
// bed.licence.txt next to it); without it a music tier mixes voice only and counts a warning. See README.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from '../lib.mjs';
import { VOICE, audioFor } from './tts.mjs';

export const MUSIC_TIERS = ['big', 'chapters'];
export const MUSIC_FILE = path.join(OUT, 'music', 'bed.mp3');
// The big video (about 18 minutes) encodes in a few minutes; a hung ffmpeg must not hold the run.
const MIX_TIMEOUT_MS = 30 * 60 * 1000;
// The bed's level before ducking, and the sidechain that pulls it down while a beat speaks.
const MUSIC_GAIN = 0.35;
// The bed fades in over this many seconds at the start and out over the last ones (never the voice).
export const MUSIC_FADE_S = 2;
const DUCK = 'sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400';

/** The bed's fades: in at the start, and out over the last seconds when the finished `duration` is known. Each
 *  is clamped to half the video, so a short one's fades neither overlap nor go negative. */
function fadeFilter(duration) {
  const known = Number.isFinite(duration) && duration > 0;
  const d = known ? Math.min(MUSIC_FADE_S, duration / 2) : MUSIC_FADE_S;
  const fadeIn = `afade=t=in:st=0:d=${d}`;
  return known ? `${fadeIn},afade=t=out:st=${duration - d}:d=${d}` : fadeIn;
}

/** ffmpeg arguments that mix `beats` ({ file, at }) and an optional looped `music` bed onto `video`, into `out`.
 *  `duration` (the finished video's seconds) places the bed's fade-out. The voice is padded with silence, so the
 *  video, not the last beat, sets the length. */
export function mixArgs({ video, beats, music, out, duration }) {
  const inputs = ['-i', video, ...beats.flatMap((b) => ['-i', b.file])];
  if (music) inputs.push('-stream_loop', '-1', '-i', music);
  const delays = beats.map((b, i) => {
    const ms = Math.round(b.at * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms}[b${i}]`;
  });
  const sum = `${beats.map((_, i) => `[b${i}]`).join('')}amix=inputs=${beats.length}:normalize=0:dropout_transition=0,apad`;
  const tail = music
    ? [
        `${sum},asplit=2[v1][v2]`,
        `[${beats.length + 1}:a]volume=${MUSIC_GAIN},${fadeFilter(duration)}[bed]`,
        `[bed][v1]${DUCK}[duck]`,
        '[duck][v2]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-1.5,aresample=48000[aout]',
      ]
    : [`${sum},loudnorm=I=-14:TP=-1.5,aresample=48000[aout]`];
  return [
    '-v', 'error', '-nostats', '-y',
    ...inputs,
    '-filter_complex', [...delays, ...tail].join(';'),
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    // The bed loops without end: the video decides the length.
    '-shortest', '-movflags', '+faststart',
    out,
  ];
}

const pad = (n, w) => String(n).padStart(w, '0');

function stamp(sec) {
  const total = Math.round(sec * 1000);
  return `${pad(Math.floor(total / 3600000), 2)}:${pad(Math.floor(total / 60000) % 60, 2)}:${pad(Math.floor(total / 1000) % 60, 2)},${pad(total % 1000, 3)}`;
}

/** SRT text: one cue per beat, numbered from 1, separated by a blank line. */
export function srtText(beats) {
  return beats.map((b, i) => `${i + 1}\n${stamp(b.at)} --> ${stamp(b.at + b.duration)}\n${b.text}\n`).join('\n');
}

/**
 * Writes `<name>.mp4` and `<name>.srt` beside the trimmed `webmFile`. `beatsMapped` are the take's beats with `at`
 * on the trimmed timeline; `narration` maps id -> { text }. Returns { warning: true } when the mix fails (the WebM
 * stays), else { warning, mp4, srt }, where `warning` is true when a music tier had no bed and mixed voice only.
 * `lang` is the take's narration language: each beat's audio is looked up under it (narration/tts.mjs). `exec`
 * has `execFileSync`'s shape; `audio` (text -> { file } | null) and `musicFile` are overridable for tests.
 */
export function mixTake(webmFile, beatsMapped, narration, def, { exec = execFileSync, log = console.log, duration, lang, audio, musicFile = MUSIC_FILE } = {}) {
  const mp4 = webmFile.replace(/\.webm$/, '.mp4');
  const srt = webmFile.replace(/\.webm$/, '.srt');
  try {
    if (!audio && !lang) throw new Error('no narration language');
    const lookup = audio ?? ((text) => audioFor(lang, VOICE, text));
    const cues = beatsMapped.map((b) => {
      const text = narration.get(b.id)?.text;
      const a = text == null ? null : lookup(text);
      if (!a) throw new Error(`no audio for beat ${b.id}`);
      return { file: a.file, at: b.at, duration: b.duration, text };
    });
    const wantsMusic = MUSIC_TIERS.includes(def.tier);
    const hasMusic = wantsMusic && fs.existsSync(musicFile);
    // `exec` is execFileSync (no shell) and runs only the fixed ffmpeg below, with arguments built here from the
    // recorder's own output paths and numbers: no outside input reaches it.
    // nosemgrep: local-no-dynamic-code-exec
    exec('ffmpeg', mixArgs({ video: webmFile, beats: cues, music: hasMusic ? musicFile : null, out: mp4, duration }), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: MIX_TIMEOUT_MS });
    fs.writeFileSync(srt, srtText(cues));
    if (wantsMusic && !hasMusic) log(`[${def.id}]`, `MUSIC missing ${musicFile} (mixed voice only)`);
    return { warning: wantsMusic && !hasMusic, mp4, srt };
  } catch (e) {
    fs.rmSync(mp4, { force: true });
    fs.rmSync(srt, { force: true });
    log(`[${def.id}]`, `MIX FAILED ${String(e?.stderr ?? '').trim().split('\n').slice(-3).join(' | ') || String(e?.message ?? e).split('\n')[0]} (the WebM is kept)`);
    return { warning: true };
  }
}
