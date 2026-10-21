// §715 narration mix: the ffmpeg arguments that lay each beat's audio on the trimmed take (and duck a music
// bed under it), the subtitle text, and the mix step's failure handling. No test runs ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MUSIC_TIERS, mixArgs, mixTake, srtText } from './mix.mjs';
import { VOICE, beatKey, cachePath } from './tts.mjs';

const beats = [{ file: 'a.mp3', at: 1.5 }, { file: 'b.mp3', at: 4 }];
const filterOf = (args) => args[args.indexOf('-filter_complex') + 1];

describe('mixArgs', () => {
  it('delays each beat to its time', () => {
    const f = filterOf(mixArgs({ video: 'v.webm', beats, music: null, out: 'v.mp4' }));
    expect(f).toContain('adelay=1500|1500');
    expect(f).toContain('adelay=4000|4000');
    expect(f).toContain('amix=inputs=2:normalize=0');
  });

  it('has no ducking without music', () => {
    const args = mixArgs({ video: 'v.webm', beats, music: null, out: 'v.mp4' });
    expect(filterOf(args)).not.toContain('sidechaincompress');
    expect(args).not.toContain('-stream_loop');
  });

  it('loops the music and ducks it under the voice', () => {
    const args = mixArgs({ video: 'v.webm', beats, music: 'bed.mp3', out: 'v.mp4' });
    expect(filterOf(args)).toContain('sidechaincompress');
    const i = args.indexOf('-stream_loop');
    expect(args.slice(i, i + 4)).toEqual(['-stream_loop', '-1', '-i', 'bed.mp3']);
  });

  it('pads the voice in both modes, so the video sets the length', () => {
    for (const music of [null, 'bed.mp3']) {
      expect(filterOf(mixArgs({ video: 'v.webm', beats, music, out: 'v.mp4' }))).toMatch(/amix=inputs=2:normalize=0[^;[,]*,apad/);
    }
  });

  it('resamples to 48 kHz after loudnorm', () => {
    for (const music of [null, 'bed.mp3']) {
      expect(filterOf(mixArgs({ video: 'v.webm', beats, music, out: 'v.mp4' }))).toContain('loudnorm=I=-14:TP=-1.5,aresample=48000[aout]');
    }
  });

  it('fades the bed in over 2 s and out over the last 2 s, and never the voice', () => {
    const f = filterOf(mixArgs({ video: 'v.webm', beats, music: 'bed.mp3', out: 'v.mp4', duration: 10 }));
    expect(f).toContain('afade=t=in:st=0:d=2,afade=t=out:st=8:d=2[bed]');
    expect(f.match(/afade/g)).toHaveLength(2);
  });

  it('has no fade without music', () => {
    expect(filterOf(mixArgs({ video: 'v.webm', beats, music: null, out: 'v.mp4', duration: 10 }))).not.toContain('afade');
  });

  it('clamps the fades of a video shorter than twice the fade', () => {
    const f = filterOf(mixArgs({ video: 'v.webm', beats, music: 'bed.mp3', out: 'v.mp4', duration: 3 }));
    expect(f).toContain('afade=t=in:st=0:d=1.5,afade=t=out:st=1.5:d=1.5[bed]');
  });

  it('fades only in when the length is unknown', () => {
    const f = filterOf(mixArgs({ video: 'v.webm', beats, music: 'bed.mp3', out: 'v.mp4' }));
    expect(f).toContain('afade=t=in:st=0:d=2[bed]');
    expect(f).not.toContain('t=out');
  });

  it('normalizes loudness and encodes H.264 plus AAC into an mp4', () => {
    const args = mixArgs({ video: 'v.webm', beats, music: null, out: 'v.mp4' });
    expect(filterOf(args)).toContain('loudnorm=I=-14:TP=-1.5');
    expect(args).toEqual(expect.arrayContaining(['libx264', '-crf', '20', 'yuv420p', 'aac', '192k']));
    expect(args.at(-1)).toBe('v.mp4');
  });
});

describe('srtText', () => {
  it('writes one numbered cue', () => {
    expect(srtText([{ at: 1.5, duration: 2.25, text: 'Hi.' }])).toBe('1\n00:00:01,500 --> 00:00:03,750\nHi.\n');
  });

  it('separates several cues with a blank line', () => {
    const s = srtText([{ at: 0, duration: 1, text: 'One.' }, { at: 3725.5, duration: 2, text: 'Two.' }]);
    expect(s).toBe('1\n00:00:00,000 --> 00:00:01,000\nOne.\n\n2\n01:02:05,500 --> 01:02:07,500\nTwo.\n');
  });
});

describe('mixTake', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-'));
  const webm = path.join(dir, 'v.webm');
  fs.writeFileSync(webm, 'x');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mapped = [{ id: 'a', at: 1, duration: 2 }];
  const narration = new Map([['a', { text: 'Hi.', duration: 2 }]]);

  it('keeps the webm and warns when ffmpeg fails', () => {
    const exec = () => { throw new Error('boom'); };
    const r = mixTake(webm, mapped, narration, { id: 'v', tier: 'ai' }, { exec, audio: () => ({ file: 'a.mp3' }) });
    expect(r).toEqual({ warning: true });
    expect(fs.existsSync(webm)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'v.srt'))).toBe(false);
  });

  it('writes the mp4 call and the srt beside the webm', () => {
    const calls = [];
    const exec = (cmd, args) => { calls.push([cmd, args]); return ''; };
    const r = mixTake(webm, mapped, narration, { id: 'v', tier: 'ai' }, { exec, audio: () => ({ file: 'a.mp3' }) });
    expect(r.warning).toBe(false);
    expect(calls[0][0]).toBe('ffmpeg');
    expect(calls[0][1].at(-1)).toBe(path.join(dir, 'v.mp4'));
    expect(fs.readFileSync(path.join(dir, 'v.srt'), 'utf8')).toBe('1\n00:00:01,000 --> 00:00:03,000\nHi.\n');
  });

  it('logs through the given logger', () => {
    const lines = [];
    mixTake(webm, mapped, narration, { id: 'v', tier: 'ai' }, { exec: () => { throw new Error('boom'); }, audio: () => ({ file: 'a.mp3' }), log: (...a) => lines.push(a.join(' ')) });
    expect(lines.join(String.fromCharCode(10))).toContain('MIX FAILED boom');
  });

  it('mixes voice only and warns when a music tier has no bed', () => {
    expect(MUSIC_TIERS).toEqual(['big', 'chapters']);
    const calls = [];
    const exec = (cmd, args) => { calls.push(args); return ''; };
    const r = mixTake(webm, mapped, narration, { id: 'v', tier: 'big' }, { exec, audio: () => ({ file: 'a.mp3' }), musicFile: path.join(dir, 'nope.mp3') });
    expect(r.warning).toBe(true);
    expect(r.mp4).toBe(path.join(dir, 'v.mp4'));
    expect(filterOf(calls[0])).not.toContain('sidechaincompress');
  });

  // M1: the take's narration language finds its audio; a German take never looks under English.
  it("finds each beat's audio under the take's language", () => {
    const text = 'Ein Beat nur im Mix-Test (§715).';
    const mp3 = cachePath('de', beatKey('de', VOICE, text));
    const sidecar = mp3.replace(/\.mp3$/, '.json');
    fs.mkdirSync(path.dirname(mp3), { recursive: true });
    fs.writeFileSync(mp3, 'x');
    fs.writeFileSync(sidecar, JSON.stringify({ duration: 2 }));
    try {
      const de = new Map([['a', { text, duration: 2 }]]);
      const calls = [];
      const exec = (cmd, args) => { calls.push(args); return ''; };
      expect(mixTake(webm, mapped, de, { id: 'v', tier: 'ai' }, { exec, lang: 'de' }).warning).toBe(false);
      expect(calls[0]).toContain(mp3);
      const lines = [];
      const en = mixTake(webm, mapped, de, { id: 'v', tier: 'ai' }, { exec, lang: 'en', log: (...a) => lines.push(a.join(' ')) });
      expect(en).toEqual({ warning: true });
      expect(lines.join(' ')).toContain('no audio for beat a');
    } finally {
      fs.rmSync(mp3, { force: true });
      fs.rmSync(sidecar, { force: true });
    }
  });

  it('fails the mix when it is given no language and no audio lookup', () => {
    const lines = [];
    const r = mixTake(webm, mapped, narration, { id: 'v', tier: 'ai' }, { exec: () => '', log: (...a) => lines.push(a.join(' ')) });
    expect(r).toEqual({ warning: true });
    expect(lines.join(' ')).toContain('no narration language');
  });
});
