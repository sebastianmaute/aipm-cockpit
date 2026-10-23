// §715 the post-render check: a silent stretch between two voices, a long silent tail, and a caption whose
// voice comes late, found on the finished video's timeline. Pure functions, plain numbers.
import { describe, expect, it } from 'vitest';
import { checkRender } from './check-render.mjs';
import { MAX_DESYNC_S, MAX_GAP_S, MAX_TAIL_S, desyncFindings, gapFindings, parseSrt, renderFindings, tailFinding } from './render-check.mjs';

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

  it('leaves a silence alone when a marked AI wait overlaps it', () => {
    expect(gapFindings([span('a', 0, 10), span('b', 30, 32)], [{ start: 12, end: 15 }])).toEqual([]);
    // A wait that ends before the silence starts does not excuse it.
    expect(gapFindings([span('a', 0, 10), span('b', 30, 32)], [{ start: 2, end: 9 }])).toHaveLength(1);
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

describe('checkRender, an old render from its .srt and length (§715)', () => {
  const srt = '1\n00:00:01,000 --> 00:00:05,000\nA\n\n2\n00:00:05,000 --> 00:00:20,100\nB\n\n3\n00:00:49,000 --> 00:00:52,000\nC\n';

  it('flags the stall and the tail of a feature clip', () => {
    expect(checkRender({ srt, duration: 54.6, ai: false })).toEqual([
      'RENDER gap 28.9 s at 0:20.1 (after cue 2)',
      'RENDER tail 2.6 s after the last voice (video 54.6 s)',
    ]);
  });

  it("lists an AI clip's long silence as unverified: its waits are not in the files", () => {
    expect(checkRender({ srt, duration: 53.9, ai: true })).toEqual(['RENDER unverified (AI wait?) gap 28.9 s at 0:20.1 (after cue 2)']);
  });
});

describe('parseSrt (§715)', () => {
  it('reads each cue as { at, end } in seconds', () => {
    const srt = '1\r\n00:00:01,212 --> 00:00:05,809\r\nA short guide\r\n\r\n2\r\n00:01:39,187 --> 00:01:43,924\r\nWhen time off\r\nis on the plan\r\n';
    expect(parseSrt(srt)).toEqual([{ id: 'cue 1', at: 1.212, end: 5.809 }, { id: 'cue 2', at: 99.187, end: 103.924 }]);
  });
});
