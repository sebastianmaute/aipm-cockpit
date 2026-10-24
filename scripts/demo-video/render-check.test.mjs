// §715 the post-render check: a silent stretch between two voices, a long silent tail, and a caption whose
// voice comes late, found on the finished video's timeline. Pure functions, plain numbers.
import { describe, expect, it } from 'vitest';
import { checkFiles, checkRender, exitCodeFor } from './check-render.mjs';
import { MAX_DESYNC_S, MAX_GAP_S, MAX_TAIL_S, MIN_TAIL_S, SPLASH_S, desyncFindings, gapFindings, parseSrt, parseWaits, renderFindings, tailFinding } from './render-check.mjs';
import { SPLASH_MS } from './ui.mjs';

const span = (id, at, end) => ({ id, at, end });

describe('gapFindings (§715)', () => {
  it('flags a silence longer than MAX_GAP_S between one voice and the next', () => {
    expect(MAX_GAP_S).toBe(8);
    const found = gapFindings([span('a', 0, 20.1), span('b', 49, 52)]);
    expect(found).toEqual(['RENDER gap 28.9 s at 0:20.1 (after a)']);
  });

  it('leaves a silence of MAX_GAP_S or less alone', () => {
    expect(gapFindings([span('a', 0, 10), span('b', 18, 20)])).toEqual([]);
  });

  it('does not count the seconds a marked AI wait covers', () => {
    // 20 s of silence, 15 of them the (trimmed) wait: 5 s left.
    expect(gapFindings([span('a', 0, 10), span('b', 30, 32)], [{ start: 12, end: 27 }])).toEqual([]);
    // Overlapping waits (a retry inside a wait) are counted once.
    expect(gapFindings([span('a', 0, 10), span('b', 30, 32)], [{ start: 12, end: 27 }, { start: 14, end: 20 }])).toEqual([]);
    // A wait that ends before the silence starts covers none of it.
    expect(gapFindings([span('a', 0, 10), span('b', 30, 32)], [{ start: 2, end: 9 }])).toHaveLength(1);
  });

  it('a short AI wait inside a long silence does not excuse the rest of it', () => {
    expect(gapFindings([span('a', 0, 10), span('b', 40, 42)], [{ start: 12, end: 15 }]))
      .toEqual(['RENDER gap 30.0 s at 0:10.0 (after a), 27.0 s of it not an AI wait']);
  });

  it('marks a silence it cannot judge as unverified instead of a failure', () => {
    expect(gapFindings([span('a', 0, 10), span('b', 30, 32)], [], { unverified: true }))
      .toEqual(['RENDER unverified (AI wait?) gap 20.0 s at 0:10.0 (after a)']);
  });

  it('reads the voices in time order whatever order they come in', () => {
    expect(gapFindings([span('b', 30, 32), span('a', 0, 10)])).toEqual(['RENDER gap 20.0 s at 0:10.0 (after a)']);
  });
});

describe('tailFinding (§715)', () => {
  it('flags a tail longer than MAX_TAIL_S after the last voice', () => {
    expect(MAX_TAIL_S).toBe(2.5);
    expect(tailFinding(40, 42.6)).toBe('RENDER tail 2.6 s after the last voice (video 42.6 s)');
  });

  it('leaves the standard 1.9 s outro alone', () => {
    expect(tailFinding(40, 41.9)).toBeNull();
  });
});

describe('desyncFindings (§715)', () => {
  it('flags a caption whose voice starts more than MAX_DESYNC_S after it appears', () => {
    expect(MAX_DESYNC_S).toBe(1);
    expect(desyncFindings([{ id: 'f-modules-nav', at: 26 }], [{ id: 'f-modules-nav', at: 27.2, duration: 2 }]))
      .toEqual(['RENDER desync f-modules-nav: voice 1.2 s after its caption at 0:26.0']);
  });

  it('leaves a voice 0.2 s after its caption alone, and a caption with no voice', () => {
    expect(desyncFindings([{ id: 'a', at: 26 }, { id: 'quiet', at: 30 }], [{ id: 'a', at: 26.2, duration: 2 }])).toEqual([]);
  });
});

describe('renderFindings (§715)', () => {
  it('runs every check on beats ({ at, duration }), captions and waits', () => {
    const beats = [{ id: 'a', at: 1, duration: 4 }, { id: 'b', at: 20, duration: 2 }];
    const found = renderFindings({ beats, captions: [{ id: 'b', at: 18 }], waits: [], duration: 25 });
    expect(found).toEqual([
      'RENDER gap 15.0 s at 0:05.0 (after a)',
      'RENDER tail 3.0 s after the last voice (video 25.0 s)',
      'RENDER desync b: voice 2.0 s after its caption at 0:18.0',
    ]);
  });

  it('finds nothing in a take that is fine', () => {
    const beats = [{ id: 'a', at: 1, duration: 4 }, { id: 'b', at: 6, duration: 2 }];
    expect(renderFindings({ beats, captions: [{ id: 'a', at: 1 }, { id: 'b', at: 5.9 }], duration: 9.9 })).toEqual([]);
  });
});

const srt = '1\n00:00:01,000 --> 00:00:05,000\nA\n\n2\n00:00:05,000 --> 00:00:20,100\nB\n\n3\n00:00:49,000 --> 00:00:52,000\nC\n';

describe('checkRender, a finished render from its .srt and length (§715)', () => {
  it('flags the stall and the tail of a feature clip', () => {
    expect(checkRender({ srt, duration: 54.6, waits: [] })).toEqual([
      'RENDER gap 28.9 s at 0:20.1 (after cue 2)',
      'RENDER tail 2.6 s after the last voice (video 54.6 s)',
    ]);
  });

  it('judges the gaps by the AI waits the take wrote beside the render', () => {
    expect(checkRender({ srt, duration: 53.9, waits: [{ start: 21, end: 47 }] })).toEqual([]);
  });

  it('lists a long silence as unverified when the waits are unknown (an old render with AI steps)', () => {
    expect(checkRender({ srt, duration: 53.9, waits: null })).toEqual(['RENDER unverified (AI wait?) gap 28.9 s at 0:20.1 (after cue 2)']);
  });
});

describe('checkFiles (§715)', () => {
  /** Fake files: path -> text; a .mp4 is "probed" from `lengths`. */
  function deps(files, lengths) {
    return {
      exists: (p) => p in files,
      read: (p) => files[p],
      probe: (p) => { if (!(p in lengths)) throw new Error(`no duration for ${p}`); return lengths[p]; },
    };
  }

  it('uses the waits file beside a render; without one, an AI clip, a chapter or big is unverified, a feature clip is not', () => {
    const files = { 'out/chapters/04-ch4.srt': srt, 'out/features/05-f.srt': srt, 'out/big/01-big.srt': srt, 'out/big/01-big.waits.json': '[{"start":21,"end":47}]' };
    const lengths = { 'out/chapters/04-ch4.mp4': 53.9, 'out/features/05-f.mp4': 53.9, 'out/big/01-big.mp4': 53.9 };
    const r = checkFiles(['out/chapters/04-ch4.mp4', 'out/features/05-f.mp4', 'out/big/01-big.mp4'], deps(files, lengths));
    expect(r.lines).toEqual([
      'out/chapters/04-ch4.mp4: RENDER unverified (AI wait?) gap 28.9 s at 0:20.1 (after cue 2)',
      'out/features/05-f.mp4: RENDER gap 28.9 s at 0:20.1 (after cue 2)',
      'out/big/01-big.mp4: ok',
    ]);
    expect(r.failed).toBe(true);
  });

  it('a render it cannot probe is reported, and the files after it are still checked', () => {
    const r = checkFiles(['a.mp4', 'b.mp4'], deps({ 'a.srt': srt, 'b.srt': srt }, { 'b.mp4': 53.9 }));
    expect(r.lines).toEqual(['a.mp4: probe failed: no duration for a.mp4', 'b.mp4: RENDER gap 28.9 s at 0:20.1 (after cue 2)']);
    expect(r.failed).toBe(true);
  });
});

describe('parseSrt (§715)', () => {
  it('reads each cue as { at, end } in seconds', () => {
    const srt = '1\r\n00:00:01,212 --> 00:00:05,809\r\nA short guide\r\n\r\n2\r\n00:01:39,187 --> 00:01:43,924\r\nWhen time off\r\nis on the plan\r\n';
    expect(parseSrt(srt)).toEqual([{ id: 'cue 1', at: 1.212, end: 5.809 }, { id: 'cue 2', at: 99.187, end: 103.924 }]);
  });
});

describe('review round (§715): the cut-off voice, the silence before the first voice, the waits file', () => {
  it('flags a closing voice that the end of the video cuts off, or nearly so', () => {
    expect(MIN_TAIL_S).toBe(1);
    expect(tailFinding(40, 40)).toBe('RENDER voice cut off: the video ends 0.0 s after the last voice (under 1 s)');
    expect(tailFinding(40, 38.5)).toBe('RENDER voice cut off: the video ends 1.5 s before the last voice does');
    expect(tailFinding(40, 41.9)).toBeNull();
  });

  it('measures the silence from the end of the splash to the first voice', () => {
    expect(SPLASH_S).toBe(SPLASH_MS / 1000);
    const late = [{ id: 'title', at: 12.5, duration: 3 }, { id: 'a', at: 16, duration: 2 }];
    expect(renderFindings({ beats: late, duration: 19.9 })).toEqual(['RENDER gap 9.5 s at 0:03.0 (after the splash)']);
    const usual = [{ id: 'title', at: 4.2, duration: 3 }, { id: 'a', at: 8, duration: 2 }];
    expect(renderFindings({ beats: usual, duration: 11.9 })).toEqual([]);
  });

  it('says there are no voices rather than reporting an infinite tail', () => {
    expect(renderFindings({ beats: [], duration: 30 })).toEqual(['RENDER no voices']);
  });

  it('reads cue 1 of an .srt that starts with a byte-order mark', () => {
    expect(parseSrt('\uFEFF1\n00:00:01,000 --> 00:00:02,000\nA\n')).toEqual([{ id: 'cue 1', at: 1, end: 2 }]);
  });

  it('accepts a waits file of { start, end } seconds on the finished video', () => {
    expect(parseWaits('[{"start":5,"end":10.5}]', 60)).toEqual([{ start: 5, end: 10.5 }]);
    expect(parseWaits('[]', 60)).toEqual([]);
  });

  it('rejects a waits file that is not JSON, not an array, or holds a malformed entry', () => {
    expect(() => parseWaits('[{"start":5,', 60)).toThrow(/^waits file invalid: not JSON/);
    expect(() => parseWaits('{"start":5}', 60)).toThrow('waits file invalid: not an array');
    expect(() => parseWaits('null', 60)).toThrow('waits file invalid: not an array');
    expect(() => parseWaits('[{"start":"5","end":10}]', 60)).toThrow('waits file invalid: entry 1 is not { start, end } in seconds');
    expect(() => parseWaits('[{"start":10,"end":5}]', 60)).toThrow('waits file invalid: entry 1 ends before it starts');
  });

  it('rejects a wait outside the video, so it cannot excuse every gap', () => {
    expect(() => parseWaits('[{"start":0,"end":99999}]', 60)).toThrow('waits file invalid: entry 1 runs past the video (60.0 s)');
    expect(() => parseWaits('[{"start":-2,"end":5}]', 60)).toThrow('waits file invalid: entry 1 starts before the video');
  });

  it('checkFiles reports a bad waits file, a missing .srt, a render with no subtitles and a non-.mp4 for that file only', () => {
    const files = {
      'out/ai/01-a.srt': srt, 'out/ai/01-a.waits.json': '[{"start":0,"end":99999}]',
      'out/features/02-b.srt': '', 'out/features/04-d.srt': srt,
    };
    const deps = {
      exists: (p) => p in files,
      read: (p) => files[p],
      probe: () => 53.9,
    };
    const r = checkFiles(['out/ai/01-a.mp4', 'out/features/02-b.mp4', 'out/features/03-c.mp4', 'out/features/03-c.webm', 'out/features/04-d.mp4'], deps);
    expect(r.lines).toEqual([
      'out/ai/01-a.mp4: waits file invalid: entry 1 runs past the video (53.9 s)',
      'out/features/02-b.mp4: RENDER no subtitles',
      'out/features/03-c.mp4: no .srt beside it',
      'out/features/03-c.webm: not an .mp4',
      'out/features/04-d.mp4: RENDER gap 28.9 s at 0:20.1 (after cue 2)',
    ]);
    expect(r.failed).toBe(true);
  });

  it('checkFiles reports a file it cannot read and goes on', () => {
    const deps = { exists: (p) => !p.endsWith('.waits.json'), read: (p) => { if (p.startsWith('a')) throw new Error('EACCES: permission denied'); return srt; }, probe: () => 53.9 };
    expect(checkFiles(['a.mp4', 'b.mp4'], deps).lines).toEqual(['a.mp4: read failed: EACCES: permission denied', 'b.mp4: RENDER gap 28.9 s at 0:20.1 (after cue 2)']);
  });

  it('checkFiles tells an all-unverified batch apart from a clean one (exit 3, not 0)', () => {
    const deps = { exists: (p) => p.endsWith('.srt'), read: () => srt, probe: () => 53.9 };
    const r = checkFiles(['out/chapters/04-ch4.mp4'], deps);
    expect(r.failed).toBe(false);
    expect(r.unverified).toBe(true);
  });

  // The exit code itself, here as well as in check-render.cli.test.mjs, which needs ffmpeg and so skips on CI.
  it('exitCodeFor: 1 on any failure, else 3 for unverified findings only, else 0', () => {
    expect(exitCodeFor({ failed: false, unverified: false })).toBe(0);
    expect(exitCodeFor({ failed: true, unverified: false })).toBe(1);
    expect(exitCodeFor({ failed: true, unverified: true })).toBe(1);
    expect(exitCodeFor({ failed: false, unverified: true })).toBe(3);
  });
});

describe('check-render and the splash (§715)', () => {
  // The first voice at 9.5 s: 6.5 s after a splash, 9.5 s of silence from the start of a render without one.
  const late = '1\n00:00:09,500 --> 00:00:12,000\nA\n\n2\n00:00:12,400 --> 00:00:15,000\nB\n';

  it('measures the first silence from the end of the splash only for a render that has one', () => {
    expect(checkRender({ srt: late, duration: 16.9, waits: [], splash: true })).toEqual([]);
    expect(checkRender({ srt: late, duration: 16.9, waits: [] })).toEqual(['RENDER gap 9.5 s at 0:00.0 (after the start)']);
  });

  it('checkFiles reads a splash from the beats sidecar the take wrote beside the render', () => {
    const deps = (withBeats) => ({ exists: (p) => p.endsWith('.srt') || (withBeats && p.endsWith('.beats.json')), read: () => late, probe: () => 16.9 });
    expect(checkFiles(['out/features/01-a.mp4'], deps(true)).lines).toEqual(['out/features/01-a.mp4: ok']);
    expect(checkFiles(['out/features/01-a.mp4'], deps(false)).lines).toEqual(['out/features/01-a.mp4: RENDER gap 9.5 s at 0:00.0 (after the start)']);
  });
});
