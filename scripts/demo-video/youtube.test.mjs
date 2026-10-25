// §715 the YouTube details page: what to paste for each video, built from the defs, the narration files and the
// sidecar each mix writes. Pure: a fixture of two videos, one on a music tier.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYLISTS, TAGLINE, buildDetailsPage, chaptersFor, descriptionFor, playlistDescription, writeDetailsPage } from './youtube.mjs';
import { VIDEOS } from './videos.mjs';

/** The page's escaping, for checking that a text appears in it. */
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  narration: new Map([['title', 'A short guide to the board.'], ['opening', 'One column per status.'], ['closing', 'It\'s "done" & dusted.']]),
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

  it('escapes every text it inserts, and drops the angle brackets YouTube rejects in a title', () => {
    expect(html).toContain('Monday — a milestone &amp; more | AI PM Cockpit');
    expect(html).not.toContain('<milestone>');
    expect(html).not.toContain('&lt;milestone&gt;');
    expect(html).toContain('It&#39;s &quot;done&quot; &amp; dusted.');
  });

  it('carries the music credit once: only the music-tier video needs it', () => {
    expect(html.split('Music: Made with ElevenMusic').length - 1).toBe(1);
  });

  it('opens with a playlist for the chapters, the AI clips and the features, each named and described', () => {
    const playlists = html.indexOf('<h2>Playlists</h2>');
    expect(playlists).toBeGreaterThan(-1);
    expect(playlists).toBeLessThan(html.indexOf('<h2>ch3-monday</h2>'));
    expect(Object.keys(PLAYLISTS)).toEqual(['chapters', 'ai', 'features']);
    for (const [tier, { label, name }] of Object.entries(PLAYLISTS)) {
      expect(html).toContain(`<h3>${escape(label)}</h3>`);
      expect(html).toContain(escape(name));
      expect(html).toContain(escape(playlistDescription(tier, [monday.def, board.def])));
    }
  });

  it('warns on the page, not in the pasted text, that the full-video link is a placeholder', () => {
    expect(html).toContain(`<p class="note">${escape(PLAYLISTS.chapters.note)}</p>`);
    expect(playlistDescription('chapters', [])).not.toContain(PLAYLISTS.chapters.note);
  });
});

describe('playlistDescription (§715)', () => {
  // Mutation: a hand-written list (the first version) missed four of the fifteen AI clips; listing the defs cannot.
  // The tagline closes it: the intro leads into the list ("Watch in order. …:"), so it cannot sit between them.
  it("lists the tier's videos by title, in order, hand-recorded ones too, between its intro and outro, then the tagline", () => {
    const defs = [
      { id: 'ch1', tier: 'chapters', title: 'Install', handRecorded: true },
      { id: 'f1', tier: 'features', title: 'The board' },
      { id: 'ch2', tier: 'chapters', title: 'Monday — a <milestone>' },
    ];
    const d = playlistDescription('chapters', defs);
    expect(d).toBe(`${PLAYLISTS.chapters.intro}\n\n• Install\n• Monday — a milestone\n\n${PLAYLISTS.chapters.outro}\n\n${TAGLINE}`);
  });
});

describe("YouTube's playlist limits (§715)", () => {
  it('keeps each playlist name within 150 characters and its description, built from the real videos, within 5000, with no angle brackets', () => {
    for (const [tier, { name }] of Object.entries(PLAYLISTS)) {
      const description = playlistDescription(tier, VIDEOS);
      expect(description.split('\n• ').length - 1).toBe(VIDEOS.filter((v) => v.tier === tier).length);
      expect(name.length).toBeLessThanOrEqual(150);
      expect(description.length).toBeLessThanOrEqual(5000);
      expect(`${name}${description}`).not.toMatch(/[<>]/);
    }
  });
});

describe("YouTube's limits (§715)", () => {
  it('keeps a description within 5000 characters: the summary goes first, then the chapters, never the credits', () => {
    const long = 'word '.repeat(1200).trim();
    const chapters = Array.from({ length: 200 }, (_, i) => ({ at: i * 12, label: `Chapter ${i} `.repeat(3) }));
    const d = descriptionFor(monday.def, new Map([['title', long], ['opening', 'Short opening.']]), chapters);
    expect(d.length).toBeLessThanOrEqual(5000);
    expect(d.startsWith('Short opening.')).toBe(true);
    expect(d).toContain('Music: Made with ElevenMusic');
    expect(d).toContain('Narration: AI-generated voice (ElevenLabs)');
    expect(d).toContain(TAGLINE);
  });

  // Mutation: dropping the tagline from the shortest fallback loses the links exactly when a description is long.
  it('keeps the tagline in the shortest fallback too, where only the opening line and the credits are left', () => {
    const d = descriptionFor(monday.def, new Map([['opening', 'word '.repeat(1100).trim()]]), []);
    expect(d.length).toBeLessThanOrEqual(5000);
    expect(d).toContain(TAGLINE);
  });
});

describe('the tagline (§715)', () => {
  it('links the project and its releases, and says what the app is', () => {
    expect(TAGLINE).toContain('https://github.com/sebastianmaute/aipm-cockpit\n');
    expect(TAGLINE).toContain('https://github.com/sebastianmaute/aipm-cockpit/releases');
    expect(TAGLINE).toMatch(/^AI PM Cockpit: /);
    expect(TAGLINE).not.toMatch(/[<>]/);
  });

  it("follows the opening line in every video's description, before its summary and chapters", () => {
    const d = descriptionFor(monday.def, monday.narration, chaptersFor(monday.def, monday.sidecar));
    // The opening line here is the narration's title beat: the fixture's opening repeats its title.
    expect(d.startsWith(`Monday. The MVP target passed.\n\n${TAGLINE}\n\n`)).toBe(true);
    for (const v of VIDEOS) expect(descriptionFor(v, null, []), v.id).toContain(TAGLINE);
  });
});

describe('writeDetailsPage (§715)', () => {
  /** A folder of renders: `files` maps a name under it to its text. */
  function folder(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
    return dir;
  }
  const sidecar = JSON.stringify(monday.sidecar);
  const videos = [
    { id: 'x-rendered', tier: 'features', title: 'Rendered', opening: 'Rendered opening.' },
    { id: 'x-stale', tier: 'features', title: 'Stale', opening: 'Stale opening.' },
    { id: 'x-hand', tier: 'chapters', title: 'By hand', opening: '', handRecorded: true },
  ];

  it('lists every video not recorded by hand; a sidecar with no .mp4 beside it gives no chapters', () => {
    const dir = folder({
      'features/01-x-rendered.mp4': 'MP4', 'features/01-x-rendered.srt': 'SRT', 'features/01-x-rendered.beats.json': sidecar,
      'features/02-x-stale.beats.json': sidecar,
    });
    const file = writeDetailsPage(dir, videos, (def) => path.join(dir, 'features', `0${videos.indexOf(def) + 1}-${def.id}.webm`));
    const html = fs.readFileSync(file, 'utf8');
    expect(file).toBe(path.join(dir, 'youtube-details.html'));
    expect(html).toContain('<h2>x-rendered</h2>');
    expect(html).toContain('<h2>x-stale</h2>');
    expect(html).not.toContain('x-hand');
    const [rendered, stale] = html.split('<h2>x-stale</h2>');
    expect(rendered).toContain('0:00 Intro');
    expect(rendered).toContain(path.join(dir, 'features', '01-x-rendered.mp4'));
    expect(stale).not.toContain('0:00 Intro');
    expect(stale).toContain('not rendered yet');
  });

  it('lists a video with an unreadable sidecar without chapters', () => {
    const dir = folder({ 'features/01-x-rendered.mp4': 'MP4', 'features/01-x-rendered.beats.json': '{not json' });
    const html = fs.readFileSync(writeDetailsPage(dir, videos.slice(0, 1), () => path.join(dir, 'features', '01-x-rendered.webm')), 'utf8');
    expect(html).not.toContain('0:00 Intro');
    expect(html).toContain('No chapters: no beats sidecar for this video yet.');
  });
});
