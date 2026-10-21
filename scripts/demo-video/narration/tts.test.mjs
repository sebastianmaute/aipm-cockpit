// §715 narration rendering: the cache key, the render plan, one ElevenLabs call, and the spend cap.
// No network: every call goes through a fake fetch. The cache lives in a temp dir (DEMO_VIDEO_DIR is set before the import).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-tts-'));
process.env.DEMO_VIDEO_DIR = TMP;
let tts;
beforeAll(async () => {
  tts = await import('./tts.mjs');
});

const voice = (over = {}) => ({
  voiceId: 'voice-a',
  modelId: 'eleven_multilingual_v2',
  settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speakerBoost: true },
  ...over,
});
const KEY = 'sk-secret-key-123';
const okFetch = (calls = []) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
};
const probe = () => 2.4;

describe('beatKey (§715)', () => {
  it('is stable for equal inputs and changes with each of lang, voice, model, a setting and the text', () => {
    const base = tts.beatKey('en', voice(), 'Hello');
    expect(tts.beatKey('en', voice(), 'Hello')).toBe(base);
    expect(tts.beatKey('de', voice(), 'Hello')).not.toBe(base);
    expect(tts.beatKey('en', voice({ voiceId: 'voice-b' }), 'Hello')).not.toBe(base);
    expect(tts.beatKey('en', voice({ modelId: 'other' }), 'Hello')).not.toBe(base);
    expect(tts.beatKey('en', voice({ settings: { ...voice().settings, stability: 0.6 } }), 'Hello')).not.toBe(base);
    expect(tts.beatKey('en', voice(), 'Hello!')).not.toBe(base);
  });
});

describe('planRender (§715)', () => {
  it('counts a text shared by two videos once, and skips a beat that is already cached', async () => {
    const v = voice({ voiceId: 'plan-voice' });
    await tts.renderBeat('en', v, 'cached text', { apiKey: KEY, fetchImpl: okFetch(), probe });
    const beats = new Map([
      ['v1', new Map([['a', 'shared text'], ['b', 'cached text']])],
      ['v2', new Map([['a', 'shared text'], ['c', 'own']])],
    ]);
    const plan = tts.planRender('en', v, beats);
    expect(plan.todo.map((t) => t.text)).toEqual(['shared text', 'own']);
    expect(plan.chars).toBe('shared text'.length + 'own'.length);
  });
});

describe('renderBeat (§715)', () => {
  it('writes the mp3 and a duration sidecar, sending the voice in the URL and the key in a header', async () => {
    const v = voice({ voiceId: 'render-voice' });
    const calls = [];
    const out = await tts.renderBeat('en', v, 'Say this', { apiKey: KEY, fetchImpl: okFetch(calls), probe });
    const key = tts.beatKey('en', v, 'Say this');
    expect(out.file).toBe(tts.cachePath('en', key));
    expect([...fs.readFileSync(out.file)]).toEqual([1, 2, 3]);
    expect(JSON.parse(fs.readFileSync(out.file.replace(/\.mp3$/, '.json'), 'utf8'))).toEqual({ duration: 2.4 });
    expect(tts.audioFor('en', v, 'Say this')).toEqual({ file: out.file, duration: 2.4 });
    expect(calls[0].url).toContain('/v1/text-to-speech/render-voice');
    expect(calls[0].url).toContain('output_format=mp3_44100_128');
    expect(calls[0].init.headers['xi-api-key']).toBe(KEY);
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({
      text: 'Say this',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
    });
  });

  it('rejects a 401 without the key in the message and writes nothing', async () => {
    const v = voice({ voiceId: 'fail-voice' });
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => `bad key ${KEY}` });
    const err = await tts.renderBeat('en', v, 'Nope', { apiKey: KEY, fetchImpl, probe, id: 'b1' }).catch((e) => e);
    expect(err.message).toContain('ElevenLabs 401 for beat');
    expect(err.message).not.toContain(KEY);
    expect(tts.audioFor('en', v, 'Nope')).toBeNull();
    expect(fs.existsSync(tts.cachePath('en', tts.beatKey('en', v, 'Nope')))).toBe(false);
  });

  it('names the beat when the network fails, without the cause or the key', async () => {
    const v = voice({ voiceId: 'net-voice' });
    const reject = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error(`ECONNRESET ${KEY}`) }); };
    const badBody = async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error(`aborted ${KEY}`); } });
    for (const fetchImpl of [reject, badBody]) {
      const err = await tts.renderBeat('en', v, 'Net', { apiKey: KEY, fetchImpl, probe, id: 'b7' }).catch((e) => e);
      expect(err.message).toBe('ElevenLabs network error for beat b7');
      expect(err.cause).toBeUndefined();
      expect(tts.audioFor('en', v, 'Net')).toBeNull();
    }
  });

  it('refuses a voice with no id before any call', async () => {
    let called = false;
    const fetchImpl = async () => ((called = true), okFetch()());
    await expect(tts.renderBeat('en', voice({ voiceId: '' }), 'x', { apiKey: KEY, fetchImpl, probe })).rejects.toThrow(/voiceId/);
    expect(called).toBe(false);
  });
});

describe('renderAll (§715)', () => {
  it('keeps the beats rendered before a failure', async () => {
    const v = voice({ voiceId: 'all-voice' });
    let n = 0;
    const fetchImpl = async (...a) => (++n === 2 ? { ok: false, status: 500, text: async () => '' } : okFetch()(...a));
    const todo = ['one', 'two', 'three'].map((text, i) => ({ videoId: 'v', id: `b${i}`, text }));
    await expect(tts.renderAll(todo, { lang: 'en', voice: v, apiKey: KEY, fetchImpl, probe })).rejects.toThrow('ElevenLabs 500 for beat b1');
    expect(tts.audioFor('en', v, 'one')).not.toBeNull();
    expect(tts.audioFor('en', v, 'two')).toBeNull();
    expect(n).toBe(2);
  });
});

describe('checkCap (§715)', () => {
  it('refuses above the cap unless --yes is given', () => {
    expect(() => tts.checkCap(25000, 20000, false)).toThrow('would send 25000 characters (cap 20000); pass --yes');
    expect(() => tts.checkCap(25000, 20000, true)).not.toThrow();
    expect(() => tts.checkCap(20000, 20000, false)).not.toThrow();
  });
});
