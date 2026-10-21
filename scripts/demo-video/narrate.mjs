// §715 narrate: renders the narration beats of the selected videos with ElevenLabs into the cache.
//   node scripts/demo-video/narrate.mjs --video <id> | --tier <tier> | --all [--lang en] [--max-chars 20000] [--yes]
//   node scripts/demo-video/narrate.mjs --audition "<voiceId,voiceId,...>"   (the title beat of ch3-monday, once per voice)
// Prints the character count before any call; refuses above --max-chars unless --yes. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, selectVideos } from './cli.mjs';
import { OUT, readEnv } from './lib.mjs';
import { TITLE, loadBeats } from './narration/beats.mjs';
import { VOICE, checkCap, planRender, probeDuration, renderAll, synthesize } from './narration/tts.mjs';
import { VIDEOS } from './videos.mjs';

const DEFAULT_MAX_CHARS = 20000;
const AUDITION_VIDEO = 'ch3-monday';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i < 0 ? undefined : argv[i + 1];
};

// Read only when a render has work to do and is past the cap check.
function apiKey() {
  let key = '';
  try {
    key = readEnv('ELEVENLABS_API_KEY');
  } catch {
    // no .env.local: reported below like an empty key
  }
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set in .env.local');
  return key;
}

async function audition(lang, max, yes) {
  const voices = (valueOf('--audition') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (voices.length === 0) throw new Error('--audition needs voice ids, comma-separated');
  const text = loadBeats(lang, VIDEOS.find((d) => d.id === AUDITION_VIDEO)).get(TITLE);
  if (!text) throw new Error(`no "${TITLE}" beat in the ${AUDITION_VIDEO} narration`);
  const chars = text.length * voices.length;
  console.log(`NARRATE ${voices.length} beats, ${chars} characters`);
  checkCap(chars, max, yes);
  const key = apiKey();
  const dir = path.join(OUT, 'voice-audition');
  fs.mkdirSync(dir, { recursive: true });
  for (const voiceId of voices) {
    const bytes = await synthesize({ ...VOICE, voiceId }, text, { apiKey: key, id: TITLE });
    fs.writeFileSync(path.join(dir, `${voiceId}.mp3`), bytes);
  }
  console.log(`RESULT rendered ${voices.length} cached 0`);
}

async function main() {
  const lang = valueOf('--lang') ?? 'en';
  const max = Number(valueOf('--max-chars') ?? DEFAULT_MAX_CHARS);
  if (!Number.isFinite(max) || max < 0) throw new Error('--max-chars needs a number');
  const yes = argv.includes('--yes');
  if (argv.includes('--audition')) return audition(lang, max, yes);

  const defs = selectVideos(VIDEOS, parseArgs(argv));
  const beatsByVideo = new Map(defs.map((d) => [d.id, loadBeats(lang, d)]));
  const total = [...beatsByVideo.values()].reduce((n, m) => n + m.size, 0);
  const { todo, chars } = planRender(lang, VOICE, beatsByVideo);
  console.log(`NARRATE ${todo.length} beats, ${chars} characters`);
  checkCap(chars, max, yes);
  if (todo.length > 0) await renderAll(todo, { lang, voice: VOICE, apiKey: apiKey(), probe: probeDuration });
  console.log(`RESULT rendered ${todo.length} cached ${total - todo.length}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
