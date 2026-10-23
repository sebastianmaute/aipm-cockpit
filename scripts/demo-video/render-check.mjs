// §715 the post-render check: on the finished video's timeline, a silence between two voices longer than
// MAX_GAP_S (a stall: nothing said while the take waited), a tail after the last voice longer than MAX_TAIL_S,
// and a caption whose voice starts more than MAX_DESYNC_S after it appeared. Pure: narrated.mjs runs it on every
// take after the mix, check-render.mjs on a finished .mp4 and its .srt. Each finding is one `RENDER …` line,
// counted as a take warning. See README.md.

/** No stretch longer than this without a voice (owner, 2026-10-24), the seconds of a marked AI wait aside. */
export const MAX_GAP_S = 8;
/** The standard outro is 1.9 s (ui.PAUSE_MS and the closing hold): a longer tail than this is dead air. */
export const MAX_TAIL_S = 2.5;
/** A caption's voice starts with it (ui.caption); later than this, picture and voice have come apart. ui.caption
 *  logs the caption and starts the voice in the same call, so today this only guards against a future change
 *  that separates the two; a late voice after a stall shows as a gap instead. */
export const MAX_DESYNC_S = 1;

/** m:ss.s on the video's timeline. */
function clock(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

/** The seconds of [a, b] that the waits ({ start, end }) cover, overlapping waits counted once. */
function covered(a, b, waits) {
  const parts = waits.map((w) => [Math.max(a, w.start), Math.min(b, w.end)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let upTo = a;
  for (const [x, y] of parts) {
    if (y <= upTo) continue;
    total += y - Math.max(x, upTo);
    upTo = y;
  }
  return total;
}

/** Each silence between consecutive voices ({ id, at, end }, any order) that is longer than MAX_GAP_S once the
 *  seconds a marked AI wait ({ start, end }) covers are taken out: a wait shown is not a stall, but it excuses
 *  only its own seconds. `unverified`: the waits are not known (an old render), so a long silence is reported
 *  as unverified rather than as a stall. */
export function gapFindings(spans, waits = [], { unverified = false } = {}) {
  const sorted = [...spans].sort((x, y) => x.at - y.at);
  const found = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1].end;
    const to = sorted[i].at;
    const wait = covered(from, to, waits);
    if (to - from - wait <= MAX_GAP_S) continue;
    const what = unverified ? 'unverified (AI wait?) gap' : 'gap';
    const rest = wait > 0 ? `, ${(to - from - wait).toFixed(1)} s of it not an AI wait` : '';
    found.push(`RENDER ${what} ${(to - from).toFixed(1)} s at ${clock(from)} (after ${sorted[i - 1].id})${rest}`);
  }
  return found;
}

/** The tail after the last voice, when longer than MAX_TAIL_S; else null. */
export function tailFinding(lastEnd, duration) {
  const tail = duration - lastEnd;
  return tail > MAX_TAIL_S ? `RENDER tail ${tail.toFixed(1)} s after the last voice (video ${duration.toFixed(1)} s)` : null;
}

/** Each caption ({ id, at }) whose beat's voice ({ id, at }) starts more than MAX_DESYNC_S after it. A caption
 *  with no voice (a repeat, a clear) is not checked. */
export function desyncFindings(captions, beats) {
  const voiceAt = new Map(beats.map((b) => [b.id, b.at]));
  return captions
    .filter((c) => voiceAt.has(c.id) && voiceAt.get(c.id) - c.at > MAX_DESYNC_S)
    .map((c) => `RENDER desync ${c.id}: voice ${(voiceAt.get(c.id) - c.at).toFixed(1)} s after its caption at ${clock(c.at)}`);
}

/** Every finding for a finished take: its beats ({ id, at, duration }), captions ({ id, at }) and AI waits
 *  ({ start, end }), all on the finished video's timeline, and its length in seconds. */
export function renderFindings({ beats, captions = [], waits = [], duration }) {
  const spans = beats.map((b) => ({ id: b.id, at: b.at, end: b.at + b.duration }));
  const lastEnd = Math.max(...spans.map((s) => s.end));
  return [...gapFindings(spans, waits), tailFinding(lastEnd, duration), ...desyncFindings(captions, beats)].filter(Boolean);
}

const STAMP = String.raw`(\d+):(\d+):(\d+),(\d+)`;
const seconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

/** The cues of an .srt as { id: 'cue N', at, end } in seconds. */
export function parseSrt(text) {
  const re = new RegExp(`^(\\d+)\\r?\\n${STAMP} --> ${STAMP}`, 'gm');
  return [...String(text).matchAll(re)].map((m) => ({
    id: `cue ${m[1]}`,
    at: seconds(m[2], m[3], m[4], m[5]),
    end: seconds(m[6], m[7], m[8], m[9]),
  }));
}
