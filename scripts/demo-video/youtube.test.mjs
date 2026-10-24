// §715 the YouTube details page: what to paste for each video, built from the defs, the narration files and the
// sidecar each mix writes. Pure: a fixture of two videos, one on a music tier.
import { describe, expect, it } from 'vitest';
import { buildDetailsPage, chaptersFor, descriptionFor } from './youtube.mjs';

const monday = {
  def: { id: 'ch3-monday', tier: 'chapters', title: 'Monday — a <milestone> & more', opening: 'Monday — a <milestone> & more' },
  mp4: 'out/chapters/03-ch3-monday.mp4',
  srt: 'out/chapters/03-ch3-monday.srt',
  narration: new Map([['title', 'Monday. The MVP target passed.'], ['mon-a', 'Do this first.'], ['closing', 'Monday is under control.']]),
  sidecar: {
    duration: 120,
    beats: [
      { id: 'title', at: 3.2, caption: null },
      { id: 'mon-a', at: 15.4, caption: 'Do this first: the MVP target is overdue.' },
      { id: 'mon-b', at: 20, caption: 'Since Friday: one RAID item.' },
      { id: 'mon-c', at: 40, caption: 'Next actions: now, soon, and later.' },
      { id: 'closing', at: 100, caption: 'Monday is under control.' },
    ],
  },
};
const board = {
  def: { id: 'f-board', tier: 'features', title: 'The board', opening: { banner: 'Open Points' } },
  mp4: null,
  srt: null,
  narration: new Map([['title', 'A short guide to the board.'], ['opening', 'One column per status.'], ['closing', 'Work piles up where you can see it.']]),
  sidecar: null,
};

describe('chaptersFor (§715)', () => {
  it('starts at 0:00 and keeps only chapters at least 10 s long, merging a shorter one into the one before', () => {
    expect(chaptersFor(monday.def, monday.sidecar)).toEqual([
      { at: 0, label: 'Intro' },
      { at: 15.4, label: 'Do this first: the MVP target is overdue.' },
      { at: 40, label: 'Next actions: now, soon, and later.' },
    ]);
  });

  it('gives none without a sidecar, and none when fewer than three would remain', () => {
    expect(chaptersFor(board.def, null)).toEqual([]);
    expect(chaptersFor(board.def, { duration: 30, beats: [{ id: 'a', at: 12, caption: 'A' }] })).toEqual([]);
  });

  it('drops a last chapter that is shorter than 10 s', () => {
    const sidecar = { duration: 45, beats: [{ id: 'a', at: 12, caption: 'A' }, { id: 'b', at: 25, caption: 'B' }, { id: 'c', at: 40, caption: 'C' }] };
    expect(chaptersFor(board.def, sidecar).map((c) => c.label)).toEqual(['Intro', 'A', 'B']);
  });

  it('splits the big video at its days', () => {
    const def = { id: 'big', tier: 'big', title: 'A week' };
    const sidecar = {
      duration: 900,
      beats: [{ id: 'prologue-describe', at: 20, caption: 'A new project' }, { id: 'mon-do-first', at: 120, caption: 'Do this first' },
        { id: 'mon-since-friday', at: 130, caption: 'Since Friday' }, { id: 'tue-dedup', at: 300, caption: 'Dedup' }, { id: 'wed-x', at: 500, caption: 'W' }],
    };
    expect(chaptersFor(def, sidecar)).toEqual([{ at: 0, label: 'Intro' }, { at: 120, label: 'Monday' }, { at: 300, label: 'Tuesday' }, { at: 500, label: 'Wednesday' }]);
  });
});

describe('descriptionFor (§715)', () => {
  it('credits the music only on a music tier, and the voice on every narrated video', () => {
    const ch = descriptionFor(monday.def, monday.narration, chaptersFor(monday.def, monday.sidecar));
    expect(ch).toContain('Music: Made with ElevenMusic');
    expect(ch).toContain('Narration: AI-generated voice (ElevenLabs)');
    expect(ch).toContain('0:00 Intro\n0:15 Do this first: the MVP target is overdue.\n0:40 Next actions: now, soon, and later.');
    const f = descriptionFor(board.def, board.narration, []);
    expect(f).not.toContain('ElevenMusic');
    expect(f).toContain('Narration: AI-generated voice (ElevenLabs)');
    expect(f.startsWith('One column per status.')).toBe(true);
  });
});

describe('buildDetailsPage (§715)', () => {
  const html = buildDetailsPage([monday, board]);

  it('lists every video with its file, or says it is not rendered yet', () => {
    expect(html).toContain('out/chapters/03-ch3-monday.mp4');
    expect(html).toContain('not rendered yet');
    expect(html).toContain('Science &amp; Technology');
    expect(html).toContain('No, it&#39;s not made for kids');
  });

  it('escapes every text it inserts', () => {
    expect(html).toContain('Monday — a &lt;milestone&gt; &amp; more');
    expect(html).not.toContain('<milestone>');
  });

  it('carries the music credit once: only the music-tier video needs it', () => {
    expect(html.split('Music: Made with ElevenMusic').length - 1).toBe(1);
  });
});
