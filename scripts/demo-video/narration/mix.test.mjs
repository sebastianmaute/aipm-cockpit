// §715 narration mix: the ffmpeg arguments that lay each beat's audio on the trimmed take (and duck a music
// bed under it), the subtitle text, and the mix step's failure handling. No test runs ffmpeg.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MUSIC_TIERS, mixArgs, mixTake, srtText } from './mix.mjs';

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

  it('mixes voice only and warns when a music tier has no bed', () => {
    expect(MUSIC_TIERS).toEqual(['big', 'chapters']);
    const calls = [];
    const exec = (cmd, args) => { calls.push(args); return ''; };
    const r = mixTake(webm, mapped, narration, { id: 'v', tier: 'big' }, { exec, audio: () => ({ file: 'a.mp3' }), musicFile: path.join(dir, 'nope.mp3') });
    expect(r.warning).toBe(true);
    expect(r.mp4).toBe(path.join(dir, 'v.mp4'));
    expect(filterOf(calls[0])).not.toContain('sidechaincompress');
  });
});
