// §715 the YouTube details page: one local HTML file, <OUT>/youtube-details.html, with each playlist's name and
// description (`PLAYLISTS`), then what to paste for each video when uploading it (file, title, description with
// chapters and credits, captions file, tags, category, audience, language). Built from the video defs, the narration files and the `<name>.beats.json` sidecar each
// mix writes (narrated.mjs); rewritten after every record.mjs run. The builders are pure. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadBeats } from './narration/beats.mjs';
import { MUSIC_TIERS } from './narration/mix.mjs';

const TITLE_MAX = 100; // YouTube's limits
const DESCRIPTION_MAX = 5000;
const CHAPTER_MIN_S = 10; // YouTube: each chapter at least 10 s
const CHAPTERS_MIN = 3; // YouTube: at least three chapters, the first at 0:00
const LABEL_MAX = 70;
const RESERVED = new Set(['title', 'opening', 'closing']);
const DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };

export const MUSIC_CREDIT = 'Music: Made with ElevenMusic';
export const VOICE_CREDIT = 'Narration: AI-generated voice (ElevenLabs)';
const CATEGORY = 'Science & Technology';
const AUDIENCE = "No, it's not made for kids";
const LANGUAGE = 'English';
const TAGS = ['AI PM Cockpit', 'project management', 'project management software', 'tutorial'];
const TIER_TAGS = { big: ['project lead', 'week in the life'], chapters: ['getting started'], ai: ['AI', 'Claude'], features: ['features'] };

/** One YouTube playlist per tier of short videos (YouTube: a name up to 150 characters, a description up to 5000).
 *  A description is `intro`, the tier's video titles in `videos.mjs` order (`playlistDescription`, so a clip added
 *  or renamed is listed without editing this), then `outro`. The big video is not a playlist of its own: it goes
 *  first in the chapters' one, which links to it; `note` is shown on the page, never pasted. */
export const PLAYLISTS = {
  chapters: {
    label: 'Chapters',
    name: 'AI PM Cockpit: One Project, One Week',
    intro: "Follow one project lead through one week on one project, from the first setup to Friday's review. The project is a customer identity platform for Northwind, a retailer. Its MVP missed its date last Friday, and this week puts it right.\n\nWatch in order. Each chapter picks up where the last one ended:",
    outro: 'The app works on its own, with your projects kept in your browser. These videos also connect two optional services: Turso, an online database that syncs projects across devices, and Claude, the AI.\n\nThe whole week is also one video: [link to the full video]',
    note: 'Replace [link to the full video] with the full video\'s link before you paste this.',
  },
  ai: {
    label: 'AI features',
    name: 'AI PM Cockpit: AI Features, One at a Time',
    intro: 'Short clips, one AI feature each, all on the same demo project:',
    outro: 'The AI features use your own Claude API key, stored encrypted on your computer. Without a key, the rest of the app works as usual. Scheduled AI jobs also need Turso, the optional online database.',
  },
  features: {
    label: 'Feature tour',
    name: 'AI PM Cockpit: Feature Tour',
    intro: 'One short clip per part of the app, all on the same demo project:',
    outro: 'Turn on only the functions a project needs; the rest stay out of the way. The Trends and Version history clips need Turso, the optional online database; every other clip here works with your projects kept in your browser.',
  },
};

/** A playlist's description: its intro, one line per video of `tier` in `defs` (hand-recorded ones too: they are
 *  uploaded like the rest), then its outro. */
export function playlistDescription(tier, defs) {
  const { intro, outro } = PLAYLISTS[tier];
  const list = defs.filter((d) => d.tier === tier).map((d) => `• ${youtubeText(d.title)}`);
  return [intro, list.join('\n'), outro].join('\n\n');
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** m:ss, or h:mm:ss from an hour on, as YouTube reads a chapter time. */
function stamp(sec) {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const shorten = (s) => (s.length <= LABEL_MAX ? s : `${s.slice(0, s.lastIndexOf(' ', LABEL_MAX - 1))}…`);

/** The candidate chapter starts of a video: its captions (the reserved beats aside); for the big video the
 *  first beat of each day. */
function candidates(def, sidecar) {
  if (def.id === 'big') {
    const seen = new Set();
    return sidecar.beats.flatMap((b) => {
      const day = DAYS[b.id.split('-')[0]];
      if (!day || seen.has(day)) return [];
      seen.add(day);
      return [{ at: b.at, label: day }];
    });
  }
  return sidecar.beats.filter((b) => !RESERVED.has(b.id) && b.caption).map((b) => ({ at: b.at, label: shorten(b.caption) }));
}

/** YouTube chapters ({ at, label }) from the sidecar: the first at 0:00 ("Intro": the splash and the title), each
 *  at least CHAPTER_MIN_S long (a start too close to the one kept before it is merged into it, and so is a last
 *  one too close to the end), at least CHAPTERS_MIN of them. None without a sidecar, or when the rules cannot be met. */
export function chaptersFor(def, sidecar) {
  if (!sidecar?.beats?.length) return [];
  const kept = [{ at: 0, label: 'Intro' }];
  for (const c of candidates(def, sidecar).sort((a, b) => a.at - b.at)) {
    if (c.at - kept.at(-1).at >= CHAPTER_MIN_S) kept.push(c);
  }
  if (kept.length > 1 && sidecar.duration - kept.at(-1).at < CHAPTER_MIN_S) kept.pop();
  return kept.length >= CHAPTERS_MIN ? kept : [];
}

/** The description: the video's opening line, a summary from its own narration (the title and closing beats),
 *  the chapters, and the credits its tier needs. Nothing it says is not in the narration or the defs. */
export function descriptionFor(def, narration, chapters) {
  const n = narration ?? new Map();
  const ownOpening = typeof def.opening === 'string' && def.opening !== def.title ? def.opening : null;
  const lead = n.get('opening') ?? ownOpening ?? n.get('title') ?? def.title;
  const summary = [n.get('title'), n.get('closing')].filter((t) => t && t !== lead).join(' ');
  const credits = [MUSIC_TIERS.includes(def.tier) ? MUSIC_CREDIT : null, narration?.size ? VOICE_CREDIT : null].filter(Boolean).join('\n');
  const list = chapters.map((c) => `${stamp(c.at)} ${c.label}`).join('\n');
  const join = (parts) => youtubeText(parts.filter(Boolean).join('\n\n'));
  // Over YouTube's limit the summary goes first, then the chapters; the opening line and the credits always stay.
  for (const parts of [[lead, summary, list, credits], [lead, list, credits], [lead, credits]]) {
    if (join(parts).length <= DESCRIPTION_MAX) return join(parts);
  }
  return join([lead.slice(0, DESCRIPTION_MAX - 200), credits]);
}

/** YouTube rejects < and > in a title or a description. */
const youtubeText = (s) => s.replace(/[<>]/g, '');

/** The YouTube title: the video's own, with the product name when it fits. */
function titleFor(def) {
  const own = youtubeText(def.title);
  const full = `${own} | AI PM Cockpit`;
  return (full.length <= TITLE_MAX ? full : own).slice(0, TITLE_MAX);
}

const tagsFor = (def) => [...TAGS, ...(TIER_TAGS[def.tier] ?? [])].join(', ');

/** One copyable field: its label, its value (escaped), a copy button. */
function field(label, value, { block = false } = {}) {
  const v = escapeHtml(value);
  return `<div class="f"><div class="l">${escapeHtml(label)} <button type="button" class="copy">Copy</button></div>${block ? `<pre class="v">${v}</pre>` : `<div class="v">${v}</div>`}</div>`;
}

/** The playlists, before the videos: a name and a description to paste for each, listing the videos of `defs`. */
function playlistsSection(defs) {
  const lists = Object.entries(PLAYLISTS).map(([tier, { label, name, note }]) => [
    `<h3>${escapeHtml(label)}</h3>`,
    field('Playlist name', name),
    field('Playlist description', playlistDescription(tier, defs), { block: true }),
    note ? `<p class="note">${escapeHtml(note)}</p>` : '',
  ].join('\n'));
  return ['<section><h2>Playlists</h2>', ...lists, '</section>'].join('\n');
}

/** The whole page for `entries` ([{ def, mp4, srt, narration, sidecar }]), in their order. The playlists list the
 *  videos of `defs`: every video, hand-recorded ones included (writeDetailsPage passes them all). */
export function buildDetailsPage(entries, defs = entries.map((e) => e.def)) {
  const sections = entries.map(({ def, mp4, srt, narration, sidecar }) => {
    const chapters = chaptersFor(def, sidecar);
    return [
      `<section><h2>${escapeHtml(def.id)}</h2>`,
      field('File to upload', mp4 ?? 'not rendered yet'),
      field('Title', titleFor(def)),
      field('Description', descriptionFor(def, narration, chapters), { block: true }),
      chapters.length ? '' : `<p class="note">${escapeHtml(sidecar ? 'No chapters: YouTube needs at least three, each 10 s or longer.' : 'No chapters: no beats sidecar for this video yet.')}</p>`,
      field('Captions (English)', srt ?? 'not rendered yet'),
      field('Tags', tagsFor(def)),
      field('Category', CATEGORY),
      field('Audience', AUDIENCE),
      field('Language', LANGUAGE),
      '</section>',
    ].join('\n');
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>YouTube details</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:960px}section{border-top:1px solid #ccc;padding:12px 0}.f{margin:8px 0}.l{font-weight:600}.v{white-space:pre-wrap;background:#f4f4f4;padding:6px;margin:4px 0}.note{color:#666}</style></head>
<body><h1>YouTube details</h1>
${playlistsSection(defs)}
${sections.join('\n')}
<script>document.addEventListener('click',(e)=>{const b=e.target.closest('button.copy');if(!b)return;const v=b.closest('.f').querySelector('.v');navigator.clipboard.writeText(v.textContent).then(()=>{b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1200)})});</script>
</body></html>
`;
}

/** A `.beats.json` sidecar, or null when it is not one (the video is then listed without chapters). */
function readSidecar(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Number.isFinite(s?.duration) && Array.isArray(s.beats) ? s : null;
  } catch {
    return null;
  }
}

/** Rewrites `<out>/youtube-details.html` for every video not recorded by hand, in `videos` order. `pathOf(def)` is
 *  the video's WebM path (cli.mjs outPath); its .mp4, .srt and .beats.json sit beside it. The playlists list every
 *  video, a hand-recorded one too: it is uploaded by hand into its playlist. */
export function writeDetailsPage(out, videos, pathOf, { lang = 'en' } = {}) {
  const sibling = (def, ext) => {
    const p = pathOf(def).replace(/\.webm$/, ext);
    return fs.existsSync(p) ? p : null;
  };
  const entries = videos.filter((v) => !v.handRecorded).map((def) => {
    const mp4 = sibling(def, '.mp4');
    // A sidecar counts only beside its render: a stale one with no .mp4 gives no chapters.
    const beatsFile = mp4 ? sibling(def, '.beats.json') : null;
    const narration = loadBeats(lang, def);
    return { def, mp4, srt: mp4 ? sibling(def, '.srt') : null, narration: narration.size ? narration : null, sidecar: beatsFile ? readSidecar(beatsFile) : null };
  });
  const file = path.join(out, 'youtube-details.html');
  fs.writeFileSync(file, buildDetailsPage(entries, videos));
  return file;
}
