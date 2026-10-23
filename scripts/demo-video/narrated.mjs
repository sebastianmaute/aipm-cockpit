// §715 demo recorder: the narration glue around one take, lifted out of record.mjs so it can be tested. Before
// the take: its narration and the beat ids of its own file (narrationFor). After it: the AI waits trimmed around
// the beats, each beat's time mapped onto the trimmed video, and the mix in the take's language (trimAndMix).
// See README.md.
import { loadBeats, ownBeatIds } from './narration/beats.mjs';
import { mixTake } from './narration/mix.mjs';
import { VOICE, audioFor } from './narration/tts.mjs';
import { takeNarration } from './take.mjs';
import { renderFindings } from './render-check.mjs';
import { MAX_AI_WAIT_S, mapTime, probeDuration, protectSpans, trimAiWaits } from './trim.mjs';

/** The take's narration (take.mjs `takeNarration`) in `lang`, and the beat ids of the video's own file, which
 *  are the ones a take may report unused (for the big video, big.md's, not the chapters' it merges). A recorded
 *  take throws here, before anything starts, when a beat has no rendered audio. `audio`, `read` and `exists`
 *  are overridable for tests. */
export function narrationFor(def, { lang, rehearse, audio = (text) => audioFor(lang, VOICE, text), read, exists }) {
  const narration = takeNarration(def, loadBeats(lang, def, { read, exists }), { rehearse, audio });
  return { narration, ownBeatIds: narration ? ownBeatIds(lang, def.id, { read, exists }) : [] };
}

/** Caps each wait for Claude in a finished take at MAX_AI_WAIT_S (trim.mjs), never cutting inside a narrated
 *  beat; a narrated take is then mixed (narration/mix.mjs) in `lang` into an MP4 with its subtitles, its beats
 *  mapped through the same kept ranges as the picture. A failed trim keeps the untrimmed take and counts a
 *  warning, so the take's own warnings still reach the tally; a failed mix keeps the WebM and counts one too.
 *  The trim also cuts the take's off-camera spans (`r.cuts`) and everything after the take ended (`r.endAt`).
 *  Once mixed, the MP4 is checked (render-check.mjs): each finding is logged as a RENDER line and counts a warning.
 *  `log` must mask secrets (record.mjs passes its masking logger); `trim`, `mix` and `probe` (an MP4's length in
 *  seconds) are overridable for tests. */
export function trimAndMix(def, r, { lang, log, outRoot, trim = trimAiWaits, mix = mixTake, probe = probeDuration }) {
  if (r.status !== 'ok' || !r.file) return r;
  let ranges;
  try {
    const t = trim(r.file, r.aiWaits, outRoot, { protect: protectSpans(r.beats), cuts: r.cuts, end: r.endAt });
    ranges = t.ranges;
    if (t.capped) log(`[${def.id}]`, `TRIM ${t.capped} AI wait(s) capped at ${MAX_AI_WAIT_S} s, ${t.cut.toFixed(1)} s cut`);
  } catch (e) {
    log(`[${def.id}]`, `TRIM FAILED ${String(e?.message ?? e).split('\n')[0]} (the untrimmed take is kept)`);
    return { ...r, warnings: r.warnings + 1 };
  }
  if (!r.narration || !r.beats?.length) return r;
  const mapped = r.beats.map((b) => ({ ...b, at: mapTime(b.at, ranges) }));
  const duration = ranges.reduce((sum, [a, b]) => sum + (b - a), 0);
  const m = mix(r.file, mapped, r.narration, def, { duration, lang, log });
  let warnings = r.warnings + (m.warning ? 1 : 0);
  if (m.mp4) {
    let findings;
    try {
      findings = renderFindings({
        beats: mapped,
        captions: (r.captions ?? []).map((c) => ({ ...c, at: mapTime(c.at, ranges) })),
        waits: (r.aiWaits ?? []).map((w) => ({ start: mapTime(w.start, ranges), end: mapTime(w.end, ranges) })),
        duration: probe(m.mp4),
      });
    } catch (e) {
      findings = [`RENDER check failed: ${String(e?.message ?? e).split('\n')[0]}`];
    }
    for (const f of findings) log(`[${def.id}]`, f);
    warnings += findings.length;
  }
  return warnings === r.warnings ? r : { ...r, warnings };
}
