// §715 the video thumbnails: one approved headline per video (owner, 2026-10-25), the series tag, the page that
// renders it, and the frame of the video it shows. Pure; make-thumbnails.mjs grabs the frames and renders the pages.
// See README.md.

/** Each video's headline: two to four words, the red part in braces. `tag` names a chapter's place in the series
 *  (a clip's tag comes from its tier). `beat` or `at` (seconds) picks the frame when the default one is not right. */
export const THUMBNAILS = {
  big: { headline: '{RESCUE} THE MVP', beat: 'mon-do-first' },
  'ch1-install': { headline: 'GET IT {RUNNING}', tag: 'INSTALL 1/7', beat: 'install-download' },
  'ch2-connect': { headline: 'YOUR {FIRST} PROJECT', tag: 'GET STARTED 2/7', beat: 'first-project-lands' },
  'ch3-monday': { headline: 'MILESTONE {SLIPPED}', tag: 'MONDAY 3/7' },
  'ch4-tuesday': { headline: 'TIME TO {RE-PLAN}', tag: 'TUESDAY 4/7' },
  'ch5-wednesday': { headline: '{STAFF} THE FIX', tag: 'WEDNESDAY 5/7' },
  'ch6-thursday': { headline: 'MANAGE THE {RISK}', tag: 'THURSDAY 6/7' },
  'ch7-friday': { headline: '{CLOSE} THE WEEK', tag: 'FRIDAY 7/7' },
  'ai-proposal': { headline: '{ONE-SENTENCE} SETUP', beat: 'prologue-gdpr' },
  'ai-chat': { headline: 'ASK. IT {ACTS.}', beat: 'ai-chat-change' },
  'ai-dedup': { headline: 'DUPLICATES {MERGED}' },
  'ai-wbs': { headline: 'PLAN {RESTRUCTURED}' },
  'ai-inline-task': { headline: 'ASK ON {ANY TASK}' },
  'ai-inline-entity': { headline: 'ASK ON {ANY RECORD}' },
  'ai-next-actions': { headline: 'WHAT NEEDS YOU {FIRST}', at: 42 },
  'ai-insight': { headline: 'FROM INSIGHT TO {ACTION}' },
  'ai-digest': { headline: 'STATUS, {SUMMED UP}' },
  'ai-alloc': { headline: 'ALLOCATIONS {PLANNED}' },
  'ai-raci': { headline: 'RACI {SUGGESTED}' },
  'ai-steering': { headline: 'STEERING REPORT {DRAFTED}' },
  'ai-forecast-import': { headline: 'FORECAST {IMPORTED}' },
  'ai-weights': { headline: '{TUNE} YOUR PRIORITIES' },
  'ai-scheduled': { headline: 'AI ON A {SCHEDULE}' },
  'f-open-points': { headline: 'EVERY {OPEN POINT}' },
  'f-board': { headline: 'DRAG, STATUS {FOLLOWS}' },
  'f-swimlanes': { headline: 'A LANE PER {PERSON}' },
  'f-gantt': { headline: 'DRAG TO {RESCHEDULE}' },
  'f-milestones': { headline: 'MILESTONES {ON TRACK?}' },
  'f-changes': { headline: 'CHANGE {CONTROL}' },
  'f-directory': { headline: 'YOUR {TEAM} DIRECTORY' },
  'f-absences': { headline: "WHO'S {OUT}" },
  'f-planning': { headline: '{CAPACITY} PLANNED' },
  'f-workload': { headline: "WHO'S {OVERLOADED}" },
  'f-raid': { headline: '{RAID} UNDER CONTROL' },
  'f-modules': { headline: 'ONLY WHAT YOU {NEED}', beat: 'f-modules-nav' },
  'f-budget': { headline: 'BUDGET VS {ACTUAL}' },
  'f-trends': { headline: 'TRENDS, {WEEK BY WEEK}' },
  'f-stakeholders': { headline: 'KNOW YOUR {STAKEHOLDERS}' },
  'f-raci': { headline: "WHO'S {ACCOUNTABLE}" },
  'f-influence': { headline: 'INFLUENCE {MAPPED}', beat: 'f-influence-drag' },
  'f-knowledge': { headline: 'EVERY LINK, {ONE PLACE}', beat: 'f-knowledge-links' },
  'f-activity': { headline: '{WHO} CHANGED WHAT' },
  'f-history': { headline: 'COMPARE & {RESTORE}', beat: 'f-history-compare' },
};

const BRAND = 'AI PM COCKPIT';
const TIER_TAGS = { big: 'FULL WEEK', ai: 'AI', features: 'FEATURE' };
/** Seconds after a beat starts: by then its view is on screen and the cursor has moved. */
const AFTER_BEAT_S = 2.5;
const RESERVED = new Set(['title', 'opening', 'closing']);

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A headline's runs, in order: `{…}` is red, the rest plain. */
export function headlineParts(headline) {
  return headline.split(/(\{[^{}]+\})/).filter(Boolean)
    .map((s) => (s.startsWith('{') ? { text: s.slice(1, -1), red: true } : { text: s, red: false }));
}

/** The series tag shown in the corner: the brand, then a chapter's place or a clip's kind. */
export function tagFor(def) {
  return `${BRAND} · ${THUMBNAILS[def.id]?.tag ?? TIER_TAGS[def.tier] ?? def.tier.toUpperCase()}`;
}

/** The frame's time in seconds: the entry's `at`, else a little after its `beat` (or the first captioned beat past
 *  the reserved ones), kept inside the video; null without a sidecar to read the beats from. */
export function defaultFrameTime(sidecar, { at, beat } = {}) {
  if (at != null) return at;
  if (!sidecar) return null;
  const pick = beat ? sidecar.beats.find((b) => b.id === beat) : sidecar.beats.find((b) => !RESERVED.has(b.id) && b.caption);
  const t = (pick?.at ?? sidecar.duration / 2) + AFTER_BEAT_S;
  return Math.min(t, Math.max(0, sidecar.duration - 0.5));
}

/** The page a thumbnail is rendered from, laid out at 1920×1080 (make-thumbnails.mjs renders it at 1280×720): the
 *  headline (fitted by `fitHeadline`), the tag, and the frame, tilted, below. */
export function thumbnailHtml({ tag, headline, frame }) {
  const runs = headlineParts(headline).map(({ text, red }) => (red ? `<span class="red">${escapeHtml(text)}</span>` : escapeHtml(text))).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
body{width:1920px;height:1080px;overflow:hidden;position:relative;background:radial-gradient(ellipse at 50% 35%,#13284a 0%,#081427 55%,#040a14 100%);font-family:Impact,'Arial Narrow Bold',sans-serif}
.tag{position:absolute;top:39px;left:51px;font:600 33px/1 system-ui,'Segoe UI',sans-serif;letter-spacing:4px;color:#9fc3ff}
h1{position:absolute;top:84px;left:60px;right:60px;margin:0;text-align:center;color:#fff;font-weight:400;font-size:255px;line-height:1.02;letter-spacing:1px;text-transform:uppercase;text-shadow:0 6px 24px rgba(0,0,0,.6)}
.red{color:#ff1f2d}
.stage{position:absolute;left:180px;top:450px;width:1500px;perspective:2400px}
.stage img{display:block;width:1500px;border-radius:15px;transform:rotateX(14deg) rotateY(-16deg) rotateZ(-2deg);transform-origin:50% 0;box-shadow:0 0 90px rgba(70,130,255,.35),0 45px 90px rgba(0,0,0,.7)}
</style></head><body>
<div class="tag">${escapeHtml(tag)}</div>
<div class="stage" id="s"><img src="${escapeHtml(frame)}" alt=""></div>
<h1 id="h"><span id="t">${runs}</span></h1>
</body></html>
`;
}

/** Runs IN the thumbnail page (Playwright `page.evaluate`), once its font has loaded: one line when the headline fits
 *  at a readable size, else two, shrinking until it fits; then the frame moves down below it. Returns the size and
 *  line count. ★ Not an inline script: that measured before Impact had loaded, against a wider fallback font. The
 *  text is measured, not the box: at a fractional device scale the box's scrollWidth rounds up past its own width. */
export function fitHeadline() {
  const h = document.getElementById('h');
  const t = document.getElementById('t');
  const fits = (lines, size) => t.getBoundingClientRect().width <= h.clientWidth + 1 && h.getBoundingClientRect().height <= lines * size * 1.02 + 6;
  const setSize = (s) => { h.style.fontSize = `${s}px`; };
  let size = 255;
  h.style.whiteSpace = 'nowrap';
  setSize(size);
  while (size > 150 && !fits(1, size)) setSize(size -= 5);
  let lines = 1;
  if (!fits(1, size)) {
    lines = 2;
    h.style.whiteSpace = 'normal';
    size = 200;
    setSize(size);
    while (size > 90 && !fits(2, size)) setSize(size -= 5);
  }
  document.getElementById('s').style.top = `${Math.max(450, Math.ceil(h.getBoundingClientRect().bottom) + 40)}px`;
  return { size, lines };
}
