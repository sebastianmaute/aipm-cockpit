// §715 the narration glue around a take: which beats it carries and which are its own (narrationFor), and
// the trim -> map -> mix order once it is recorded (trimAndMix). Fakes stand in for the files, trim and mix.
import { describe, expect, it } from 'vitest';
import { narrationPath } from './narration/beats.mjs';
import { narrationFor, trimAndMix } from './narrated.mjs';

/** Fake narration files: video id -> file text; `read`/`exists` see only these. */
function files(byId, lang = 'en') {
  const map = new Map(Object.entries(byId).map(([id, text]) => [narrationPath(lang, id), text]));
  return { read: (p) => map.get(p), exists: (p) => map.has(p) };
}

describe('narrationFor (§715)', () => {
  it("big carries the chapters' beats and its own, but only its own count as its beats", () => {
    const fs = files({ 'ch3-monday': '## mon-a\nChapter text.\n## mon-b\nTwo.\n', big: '## mon-b\nBig says it shorter.\n## week-x\nOwn.\n' });
    const r = narrationFor({ id: 'big' }, { lang: 'en', rehearse: true, ...fs });
    expect([...r.narration.keys()]).toEqual(['mon-a', 'mon-b', 'week-x']);
    expect(r.narration.get('mon-b')).toEqual({ text: 'Big says it shorter.', duration: null });
    expect(r.ownBeatIds).toEqual(['mon-b', 'week-x']);
  });

  it('reads the files of the language it is given', () => {
    const fs = files({ 'ch3-monday': '## mon-a\nAuf Deutsch.\n' }, 'de');
    expect(narrationFor({ id: 'ch3-monday' }, { lang: 'en', rehearse: true, ...fs }).narration).toBeNull();
    const de = narrationFor({ id: 'ch3-monday' }, { lang: 'de', rehearse: true, ...fs });
    expect(de.narration.get('mon-a').text).toBe('Auf Deutsch.');
    expect(de.ownBeatIds).toEqual(['mon-a']);
  });

  it('a recorded take takes each duration from the audio, looked up by text', () => {
    const fs = files({ 'ai-chat': '## ai-a\nHello.\n' });
    const asked = [];
    const r = narrationFor({ id: 'ai-chat' }, { lang: 'en', rehearse: false, audio: (t) => { asked.push(t); return { duration: 1.5 }; }, ...fs });
    expect(asked).toEqual(['Hello.']);
    expect(r.narration.get('ai-a')).toEqual({ text: 'Hello.', duration: 1.5 });
  });

  it('a recorded take without audio fails before it starts', () => {
    const fs = files({ 'ai-chat': '## ai-a\nHello.\n' });
    expect(() => narrationFor({ id: 'ai-chat' }, { lang: 'en', rehearse: false, audio: () => null, ...fs })).toThrow('no audio for beat ai-a');
  });

  it('a video without a narration file has no narration and no beats of its own', () => {
    expect(narrationFor({ id: 'f-board' }, { lang: 'en', rehearse: true, ...files({}) })).toEqual({ narration: null, ownBeatIds: [] });
  });
});

describe('trimAndMix (§715)', () => {
  const def = { id: 'v', tier: 'chapters' };
  const narration = new Map([['a', { text: 'A.' }], ['b', { text: 'B.' }]]);
  const take = (extra = {}) => ({
    status: 'ok', warnings: 0, file: 'v.webm', aiWaits: [{ start: 5, end: 20 }],
    beats: [{ id: 'a', at: 2, duration: 1 }, { id: 'b', at: 18, duration: 2 }], narration, ...extra,
  });
  /** A trim that keeps `ranges` and records what it was given; a mix that records its call. */
  function fakes({ ranges = [[0, 6.5], [16, 30]], capped = 1, mixWarning = false, trimThrows = false } = {}) {
    const calls = [];
    const lines = [];
    const trim = (file, waits, outRoot, opts) => {
      calls.push({ trim: { file, waits, outRoot, protect: opts.protect } });
      if (trimThrows) throw new Error('ffmpeg broke');
      return { ranges, capped, cut: 9.5 };
    };
    const mix = (file, mapped, n, d, opts) => { calls.push({ mix: { file, mapped, n, d, opts } }); return { warning: mixWarning }; };
    return { calls, lines, deps: { lang: 'de', outRoot: 'OUT', log: (...p) => lines.push(p.join(' ')), trim, mix } };
  }

  it('trims around the beats, maps each beat through the kept ranges, then mixes in the take language', () => {
    const f = fakes();
    const r = trimAndMix(def, take(), f.deps);
    expect(r.warnings).toBe(0);
    expect(f.calls.map((c) => Object.keys(c)[0])).toEqual(['trim', 'mix']);
    expect(f.calls[0].trim).toEqual({ file: 'v.webm', waits: [{ start: 5, end: 20 }], outRoot: 'OUT', protect: [[2, 3], [18, 20]] });
    const { mapped, n, d, opts } = f.calls[1].mix;
    // b at 18 s lies 2 s into the second range, which starts after 6.5 s kept.
    expect(mapped).toEqual([{ id: 'a', at: 2, duration: 1 }, { id: 'b', at: 8.5, duration: 2 }]);
    expect(n).toBe(narration);
    expect(d).toBe(def);
    expect(opts.lang).toBe('de');
    expect(opts.duration).toBe(6.5 + 14);
    expect(opts.log).toBe(f.deps.log);
    expect(f.lines).toEqual(['[v] TRIM 1 AI wait(s) capped at 3 s, 9.5 s cut']);
  });

  it('a failed trim keeps the take, counts a warning and mixes nothing', () => {
    const f = fakes({ trimThrows: true });
    const r = trimAndMix(def, take({ warnings: 2 }), f.deps);
    expect(r.warnings).toBe(3);
    expect(f.calls.map((c) => Object.keys(c)[0])).toEqual(['trim']);
    expect(f.lines).toEqual(['[v] TRIM FAILED ffmpeg broke (the untrimmed take is kept)']);
  });

  it('a failed mix counts a warning', () => {
    const f = fakes({ mixWarning: true });
    expect(trimAndMix(def, take(), f.deps).warnings).toBe(1);
  });

  it('a take that is not ok, or has no file (a rehearsal), is neither trimmed nor mixed', () => {
    const f = fakes();
    const failed = take({ status: 'failed' });
    expect(trimAndMix(def, failed, f.deps)).toBe(failed);
    const rehearsal = take({ file: undefined });
    expect(trimAndMix(def, rehearsal, f.deps)).toBe(rehearsal);
    expect(f.calls).toEqual([]);
  });

  it('a take without narration, or without beats, is trimmed but not mixed', () => {
    const f = fakes({ capped: 0 });
    trimAndMix(def, take({ narration: null }), f.deps);
    trimAndMix(def, take({ beats: [] }), f.deps);
    expect(f.calls.map((c) => Object.keys(c)[0])).toEqual(['trim', 'trim']);
    expect(f.lines).toEqual([]);
  });
});
