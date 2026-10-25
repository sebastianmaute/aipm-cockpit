// §715 narration files: one plain-text file per video and language, and the lookup from beat id to spoken text.
// Format: each "## <id>" heading starts a beat; the lines under it are its spoken text. See en/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIDEOS } from '../videos.mjs';

export const TITLE = 'title'; // spoken over the title card
export const OPENING = 'opening'; // the opening caption
export const CLOSING = 'closing'; // the last caption, spoken over the closing frame and kept to the end

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEADING_RE = /^##\s+(.*?)\s*$/;

/** Parse a narration file into [{ id, text }]. Text above the first heading is ignored. */
export function parseNarration(text) {
  const beats = [];
  const seen = new Set();
  let current = null;
  const close = () => {
    if (!current) return;
    const spoken = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    if (!spoken) throw new Error(`narration: empty beat "${current.id}"`);
    beats.push({ id: current.id, text: spoken });
  };
  for (const line of String(text).split(/\r?\n/)) {
    const m = HEADING_RE.exec(line);
    if (!m) {
      if (current) current.lines.push(line);
      continue;
    }
    close();
    const id = m[1];
    if (!ID_RE.test(id)) throw new Error(`narration: bad beat id "${id}"`);
    if (seen.has(id)) throw new Error(`narration: duplicate beat id "${id}"`);
    seen.add(id);
    current = { id, lines: [] };
  }
  close();
  return beats;
}

/** The narration file of a video: scripts/demo-video/narration/<lang>/<videoId>.md. */
export function narrationPath(lang, videoId) {
  return path.join(HERE, lang, `${videoId}.md`);
}

/** The beat ids of a video's own file, in file order; none when it has no file. */
export function ownBeatIds(lang, videoId, { read = fs.readFileSync, exists = fs.existsSync } = {}) {
  const file = narrationPath(lang, videoId);
  return exists(file) ? parseNarration(read(file, 'utf8')).map((b) => b.id) : [];
}

// The chapters the big video tells: a playback chapter (the install) is not part of its week.
const CHAPTER_IDS = VIDEOS.filter((v) => v.tier === 'chapters' && !v.handRecorded && !v.playback).map((v) => v.id);

/**
 * Beat id -> spoken text for a video. The big video takes every chapter file first, in order, then its own
 * file, whose beats override a chapter beat of the same id. A video without a file yields an empty map.
 */
export function loadBeats(lang, def, { read = fs.readFileSync, exists = fs.existsSync } = {}) {
  const ids = def.id === 'big' ? [...CHAPTER_IDS, 'big'] : [def.id];
  const beats = new Map();
  for (const id of ids) {
    const file = narrationPath(lang, id);
    if (!exists(file)) continue;
    for (const b of parseNarration(read(file, 'utf8'))) beats.set(b.id, b.text);
  }
  return beats;
}
