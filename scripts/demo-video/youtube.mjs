// §715 the YouTube details page: one local HTML file, <OUT>/youtube-details.html, with what to paste for each
// video when uploading it (file, title, description with chapters and credits, captions file, tags, category,
// audience, language). Built from the video defs, the narration files and the `<name>.beats.json` sidecar each
// mix writes (narrated.mjs); rewritten after every record.mjs run. The builders are pure. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { loadBeats } from './narration/beats.mjs';
import { MUSIC_TIERS } from './narration/mix.mjs';

const TITLE_MAX = 100; // YouTube's limit
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
  const credits = [MUSIC_TIERS.includes(def.tier) ? MUSIC_CREDIT : null, narration?.size ? VOICE_CREDIT : null].filter(Boolean);
  return [lead, summary, chapters.map((c) => `${stamp(c.at)} ${c.label}`).join('\n'), credits.join('\n')].filter(Boolean).join('\n\n');
}

/** The YouTube title: the video's own, with the product name when it fits. */
function titleFor(def) {
  const full = `${def.title} | AI PM Cockpit`;
  return (full.length <= TITLE_MAX ? full : def.title).slice(0, TITLE_MAX);
}

const tagsFor = (def) => [...TAGS, ...(TIER_TAGS[def.tier] ?? [])].join(', ');

/** One copyable field: its label, its value (escaped), a copy button. */
function field(label, value, { block = false } = {}) {
  const v = escapeHtml(value);
  return `<div class="f"><div class="l">${escapeHtml(label)} <button type="button" class="copy">Copy</button></div>${block ? `<pre class="v">${v}</pre>` : `<div class="v">${v}</div>`}</div>`;
}

/** The whole page for `entries` ([{ def, mp4, srt, narration, sidecar }]), in their order. */
export function buildDetailsPage(entries) {
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
${sections.join('\n')}
<script>document.addEventListener('click',(e)=>{const b=e.target.closest('button.copy');if(!b)return;const v=b.closest('.f').querySelector('.v');navigator.clipboard.writeText(v.textContent).then(()=>{b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1200)})});</script>
</body></html>
`;
}

/** Rewrites `<out>/youtube-details.html` for every video not recorded by hand, in `videos` order. `pathOf(def)` is
 *  the video's WebM path (cli.mjs outPath); its .mp4, .srt and .beats.json sit beside it. */
export function writeDetailsPage(out, videos, pathOf, { lang = 'en' } = {}) {
  const sibling = (def, ext) => {
    const p = pathOf(def).replace(/\.webm$/, ext);
    return fs.existsSync(p) ? p : null;
  };
  const entries = videos.filter((v) => !v.handRecorded).map((def) => {
    const beatsFile = sibling(def, '.beats.json');
    const narration = loadBeats(lang, def);
    return {
      def,
      mp4: sibling(def, '.mp4'),
      srt: sibling(def, '.srt'),
      narration: narration.size ? narration : null,
      sidecar: beatsFile ? JSON.parse(fs.readFileSync(beatsFile, 'utf8')) : null,
    };
  });
  const file = path.join(out, 'youtube-details.html');
  fs.writeFileSync(file, buildDetailsPage(entries));
  return file;
}
