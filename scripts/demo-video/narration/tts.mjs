// §715 narration rendering: one ElevenLabs text-to-speech call per beat, cached on disk by language, voice and text.
// A beat is rendered once; the mp3 and a sidecar with its duration live under OUT/narration-cache/<lang>/. The key
// goes in a request header only and never reaches a log or an error. See README.md.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from '../lib.mjs';

/** The narrator. `voiceId` stays empty until the owner picks one (narrate.mjs --audition). */
export const VOICE = {
  voiceId: '',
  modelId: 'eleven_multilingual_v2',
  settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true },
};

const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const FORMAT = 'mp3_44100_128';

/** sha256 over everything that changes the sound: language, voice, model, settings and text. */
export function beatKey(lang, voice, text) {
  return crypto.createHash('sha256').update(JSON.stringify([lang, voice.voiceId, voice.modelId, voice.settings, text])).digest('hex');
}

/** OUT/narration-cache/<lang>/<key>.mp3 */
export function cachePath(lang, key) {
  return path.join(OUT, 'narration-cache', lang, `${key}.mp3`);
}

const sidecarOf = (file) => file.replace(/\.mp3$/, '.json');

/** The rendered beat { file, duration }, or null when the mp3 or its sidecar is missing. */
export function audioFor(lang, voice, text) {
  const file = cachePath(lang, beatKey(lang, voice, text));
  if (!fs.existsSync(file) || !fs.existsSync(sidecarOf(file))) return null;
  try {
    const { duration } = JSON.parse(fs.readFileSync(sidecarOf(file), 'utf8'));
    return Number.isFinite(duration) && duration > 0 ? { file, duration } : null;
  } catch {
    return null;
  }
}

/** The beats still to render, with the characters they cost. Identical texts count once. */
export function planRender(lang, voice, beatsByVideo) {
  const todo = [];
  const seen = new Set();
  let chars = 0;
  for (const [videoId, beats] of beatsByVideo) {
    for (const [id, text] of beats) {
      if (seen.has(text) || audioFor(lang, voice, text)) continue;
      seen.add(text);
      todo.push({ videoId, id, text });
      chars += text.length;
    }
  }
  return { todo, chars };
}

/** Throws `would send N characters (cap M); pass --yes` when a render is over the cap and not confirmed. */
export function checkCap(chars, max, yes) {
  if (chars > max && !yes) throw new Error(`would send ${chars} characters (cap ${max}); pass --yes`);
}

/** The duration in seconds, read with ffprobe (no shell), as trim.mjs does. */
export function probeDuration(file) {
  // nosemgrep: local-no-dynamic-code-exec
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const seconds = Number(String(out).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`no duration for ${path.basename(file)}`);
  return seconds;
}

/** One text-to-speech call: the mp3 bytes. Errors carry the status and beat id only, never the key or the response. */
export async function synthesize(voice, text, { apiKey, fetchImpl = fetch, id = '' }) {
  if (!voice.voiceId) throw new Error('no voiceId set in VOICE (run narrate.mjs --audition and pick one)');
  // A network failure rethrows with the beat id only: the original error and its cause can carry request details.
  const netError = () => new Error(`ElevenLabs network error for beat ${id}`.trim());
  let res;
  try {
    res = await fetchImpl(`${API}/${encodeURIComponent(voice.voiceId)}?output_format=${FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: voice.modelId,
        voice_settings: {
          stability: voice.settings.stability,
          similarity_boost: voice.settings.similarityBoost,
          style: voice.settings.style,
          use_speaker_boost: voice.settings.speakerBoost,
        },
      }),
    });
  } catch {
    throw netError();
  }
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} for beat ${id}`.trim());
  try {
    return Buffer.from(await res.arrayBuffer());
  } catch {
    throw netError();
  }
}

/** Renders one beat into the cache: the mp3, then the sidecar { duration }. `probe(file)` is injectable. */
export async function renderBeat(lang, voice, text, { apiKey, fetchImpl = fetch, probe = probeDuration, id = '' }) {
  const bytes = await synthesize(voice, text, { apiKey, fetchImpl, id });
  const file = cachePath(lang, beatKey(lang, voice, text));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  try {
    const duration = probe(file);
    fs.writeFileSync(sidecarOf(file), JSON.stringify({ duration }));
    return { file, duration };
  } catch (e) {
    fs.rmSync(file, { force: true });
    throw e;
  }
}

/** Renders every todo item in order. A failure rejects with that beat's error; earlier beats stay cached. */
export async function renderAll(todo, { lang, voice, apiKey, fetchImpl, probe, onBeat = () => {} }) {
  let rendered = 0;
  for (const t of todo) {
    await renderBeat(lang, voice, t.text, { apiKey, fetchImpl, probe, id: t.id });
    rendered++;
    onBeat(t, rendered);
  }
  return rendered;
}
