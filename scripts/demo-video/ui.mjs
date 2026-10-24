// §715 demo recorder: on-screen helpers — the cursor and caption overlay, the host blur, and paced
// clicks, typing and navigation. Every helper takes the take's `ctx` ({ page, rehearse, log, … }).
// Lifted from the first recorder. A narrated take (`ctx.narration`) paces its captions by their beats' audio.
// See README.md.
// The reserved beat ids (narration/beats.mjs TITLE, CLOSING) arrive as arguments from take.mjs: beats.mjs
// imports videos.mjs, which imports the step modules, which import this file, so importing it here is a cycle.
import * as L from './lib.mjs';

// Installed in every page before it loads: an arrow cursor that follows the mouse, the caption bar, and a blur
// over any text that shows the database host. Sized for the 1920x1080 frame (L.VIEWPORT): the cursor 36 px, the
// caption 24 px in a centred box that ends 32 px above the bottom edge, so the app's footer tagline stays readable
// under it. Serialised into the page, so self-contained.
export const OVERLAY = (host) => {
  const install = () => {
    if (!document.body || document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="36" height="36" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:36px;height:36px;left:-60px;top:-60px;transition:left .1s,top .1s;filter:drop-shadow(1px 1px 2px rgba(0,0,0,.3))';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    const b = document.createElement('div');
    b.id = 'demo-subtitle';
    b.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);width:max-content;max-width:1500px;border-radius:8px;z-index:2147483646;text-align:center;padding:14px 32px;background:rgba(0,0,0,.75);color:#fff;font:500 24px/1.35 -apple-system,"Segoe UI",sans-serif;pointer-events:none;opacity:0;transition:opacity .3s';
    document.body.appendChild(b);
    const s = document.createElement('style');
    s.textContent = 'input[placeholder^="libsql://"]{filter:blur(6px)}';
    document.head.appendChild(s);
    const blur = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeValue && n.nodeValue.includes(host) && n.parentElement && n.parentElement.id !== 'demo-subtitle') n.parentElement.style.filter = 'blur(5px)';
      }
    };
    blur();
    new MutationObserver(blur).observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
};

/** Pause `ms`, or a token 150 ms in a rehearsal. */
export const pace = (ctx, ms) => ctx.page.waitForTimeout(ctx.rehearse ? Math.min(ms, 150) : ms);

/** The pause after a beat's audio before the next beat may start. */
export const PAUSE_MS = 400;

/** On camera: the take has started (`ctx.onCamera`, set by take.mjs in both modes) or the recording runs.
 *  Off camera (the replay of earlier days, setup) a caption is never held, checked or logged. */
const onCamera = (ctx) => ctx.onCamera === true || ctx.recordingStartedAt != null;

/** The beat `id` names, or null off camera or without narration. A missing beat fails a recorded take;
 *  a rehearsal logs it and counts a warning (`ctx.narrationMissing`). A found beat is marked used. */
function beatFor(ctx, id) {
  if (!ctx.narration || !id || !onCamera(ctx)) return null;
  const beat = ctx.narration.get(id);
  if (!beat) {
    if (!ctx.rehearse) throw new Error(`no narration for beat ${id}`);
    ctx.log(`NARRATION missing ${id}`);
    ctx.narrationMissing = (ctx.narrationMissing ?? 0) + 1;
    return null;
  }
  (ctx.beatsUsed ??= new Set()).add(id);
  return beat;
}

/** A beat id already shown in this take: a later show keeps its caption but speaks nothing, and holds only
 *  this long (the rehearsal's token pace), so a branch that shows one caption twice sounds right. */
const REPEAT_MS = 150; // long enough to see the caption change, short enough to add no dead air to the take
const shownBefore = (ctx, id) => ctx.beatsUsed?.has(id) === true;

/** A beat with audio, in a running recording (a rehearsal's beats have no duration). */
const voiced = (ctx, beat) => beat != null && beat.duration != null && ctx.recordingStartedAt != null;

/** Holds until the previous beat's audio and its pause are over. */
async function waitForVoice(ctx) {
  const left = (ctx.voiceFreeAt ?? 0) - performance.now();
  if (left > 0) await ctx.page.waitForTimeout(left);
}

/** On camera, holds the frame until the pending voice and its pause are over. take.mjs calls it at the end of
 *  the intro and of every on-camera step, and a step calls it before it leaves a view its last beat describes,
 *  so a voice never runs on into the next view. A rehearsal has no voice, so it never waits. */
export async function holdVoice(ctx) {
  if (onCamera(ctx)) await waitForVoice(ctx);
}

/** Notes the beat on the recording's timeline; the next beat waits for its audio and the pause. */
function startVoice(ctx, id, duration) {
  const t = performance.now();
  (ctx.beatLog ??= []).push({ id, at: (t - ctx.recordingStartedAt) / 1000, duration });
  ctx.voiceFreeAt = t + duration * 1000 + PAUSE_MS;
}

/** Shows `text` in the caption bar ('' clears it). `id` names its narration beat: in a narrated recording
 *  the caption waits for the previous beat's voice, then returns at once, so its voice plays over the next
 *  action. Without narration, or off camera, it holds 1.2 s as before. */
export async function caption(ctx, text, id) {
  const again = shownBefore(ctx, id);
  const beat = beatFor(ctx, id);
  const voice = !again && voiced(ctx, beat);
  // A repeat starts no voice but still waits for any pending one: it must not replace a caption mid-sentence.
  if (onCamera(ctx)) await waitForVoice(ctx);
  await ctx.page.evaluate((t) => {
    const b = document.getElementById('demo-subtitle');
    if (!b) return;
    b.textContent = t || '';
    b.style.opacity = t ? '1' : '0';
  }, text);
  ctx.log('CAPTION ' + (text || '(clear)'));
  // On the recording's timeline, a beat's first caption: the render check compares it with the beat's voice.
  if (id && !again && ctx.recordingStartedAt != null) {
    (ctx.captionLog ??= []).push({ id, at: (performance.now() - ctx.recordingStartedAt) / 1000, text });
  }
  if (voice) startVoice(ctx, id, beat.duration);
  else if (text) await pace(ctx, again ? REPEAT_MS : 1200);
}

/** A voice-only beat: the same pace as a caption's, with no caption change. */
export async function speak(ctx, id) {
  const again = shownBefore(ctx, id);
  const beat = beatFor(ctx, id);
  if (again || !voiced(ctx, beat)) return;
  await waitForVoice(ctx);
  startVoice(ctx, id, beat.duration);
}

/** The app's splash (public/), served by the dev server. Shown as it is: never re-saved (it carries a C2PA manifest). */
export const SPLASH = '/splash-aipm-cockpit.svg';
/** How long every video opens on the splash, before its title card, counted from the recording's first frame. */
export const SPLASH_MS = 3000;
/** How long the splash image may take to load before the splash goes up without it. */
export const SPLASH_LOAD_MS = 5000;

/** Puts the splash over the whole frame, before the recording starts, so its first frame is the splash: the image
 *  is loaded first (at most `loadTimeoutMs`), then shown centred at 1.5x (960x600) on the SVG's own #003459, as
 *  the last element at the top z-index, so it covers the caption bar and the cursor. Returns whether the image
 *  loaded; without it the splash shows its background only, and the take counts a warning. */
export async function showSplash(ctx, { loadTimeoutMs = SPLASH_LOAD_MS } = {}) {
  const loaded = await ctx.page.evaluate(({ src, timeout }) => new Promise((resolve) => {
    const img = new Image();
    let timer = null;
    const show = (ok) => {
      if (!timer) return; // shown already
      clearTimeout(timer);
      timer = null;
      const s = document.createElement('div');
      s.id = 'demo-splash';
      s.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#003459;display:flex;align-items:center;justify-content:center';
      img.alt = '';
      img.style.cssText = 'width:960px;height:600px';
      s.appendChild(img);
      document.body.appendChild(s);
      resolve(ok);
    };
    timer = setTimeout(() => show(false), timeout);
    img.onload = () => show(true);
    img.onerror = () => show(false);
    img.src = src;
  }), { src: SPLASH, timeout: loadTimeoutMs });
  if (!loaded) ctx.log(`SPLASH ${SPLASH} did not load: the splash shows its background only`);
  return loaded;
}

/** Holds the splash SPLASH_MS (the rehearsal pace in a rehearsal), then takes it away. Throws when it is still
 *  on the page: a splash left up would cover the whole video. Every later time on the take's timeline (beats,
 *  captions, AI waits) includes it. */
export async function endSplash(ctx) {
  await pace(ctx, SPLASH_MS);
  const gone = await ctx.page.evaluate(() => {
    document.getElementById('demo-splash')?.remove();
    return document.getElementById('demo-splash') == null;
  });
  if (!gone) throw new Error('the splash is still on the page after its 3 s');
}

/** At the start of a take: the Next.js dev indicator (the "N" badge, in a nextjs-portal's shadow root) must not
 *  be in the picture. Its dev server is started with DEMO_RECORDER=1 (next.config.ts). Returns the warnings to
 *  count; a probe that fails counts one too, so the check never passes silently. */
export async function checkDevBadge(ctx) {
  let shown;
  try {
    shown = await ctx.page.evaluate(() => [...document.querySelectorAll('nextjs-portal')]
      .some((p) => p.shadowRoot?.querySelector('[data-nextjs-dev-tools-button]') != null));
  } catch (e) {
    ctx.log(`DEV BADGE check failed: ${String(e?.message ?? e).split('\n')[0]}`);
    return 1;
  }
  if (!shown) return 0;
  ctx.log('DEV BADGE visible — start the dev server with DEMO_RECORDER=1');
  return 1;
}

/** The video's title in the caption bar for its first 3 s, so it says what it is about before anything moves.
 *  A narrated video may speak its title beat (`beat`, the reserved TITLE id) over it. */
export async function titleCard(ctx, title, beat) {
  await caption(ctx, title);
  if (beat && ctx.narration?.has(beat)) await speak(ctx, beat);
  await pace(ctx, 1800);
}

/** The clip's closing beat. The last caption stays up until its voice is done. A narrated video with a closing
 *  beat (`beat`, the reserved CLOSING id) then shows that beat's own text as its caption and speaks it; the
 *  caption stays on screen to the end of the video. Without one the caption bar is cleared. Either way the last
 *  frame is held until the voice is done, plus its pause and 1.5 s: about 1.9 s after the last voice. */
export async function closingBeat(ctx, beat) {
  await waitForVoice(ctx);
  // The closing caption sits where every video ends it: at the bottom.
  await placeCaption(ctx, null, 'closing');
  const text = beat ? ctx.narration?.get(beat)?.text : null;
  await caption(ctx, text ?? '', text ? beat : undefined);
  await waitForVoice(ctx);
  await pace(ctx, 1500);
}

/** How long a cursor move waits for its target. Short: a step that points at something not on screen
 *  fails at once, instead of holding the frame for Playwright's 30 s default. */
export const MOVE_TIMEOUT_MS = 5000;
/** How long a click, a typed field or a select waits for its control to appear (a dialog opening, a list
 *  rendering after its nav). */
const ACTION_TIMEOUT_MS = 15000;

/** Waits up to `timeout` for `loc` to be visible, and requires it to match exactly one element. */
async function visibleOne(loc, label, timeout) {
  await loc.waitFor({ state: 'visible', timeout }).catch(() => {});
  if (!(await loc.isVisible().catch(() => false))) {
    // isVisible() also fails on a locator that matches several elements: say which it was.
    const n = await loc.count().catch(() => 0);
    throw new Error(n > 1 ? `ambiguous (${n} matches): ${label}` : `not visible: ${label}`);
  }
}

/** Moves the cursor onto `loc`, scrolled into view first (inside its scrolling container too, the sidebar
 *  included). Throws when `loc` is not one visible element: an action the viewer cannot see fails the take. */
export async function moveTo(ctx, loc, label) {
  await visibleOne(loc, label, MOVE_TIMEOUT_MS);
  await loc.scrollIntoViewIfNeeded({ timeout: MOVE_TIMEOUT_MS });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`not visible: ${label}`);
  await placeCaption(ctx, box, label);
  await ctx.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: ctx.rehearse ? 2 : 12 });
  await pace(ctx, 350);
}

/** In the page: the caption box at the bottom of the frame (where it sits), measured; when it would cover the
 *  target `box`, it goes to the top of the frame instead. Measured and moved in one task, so no frame shows it
 *  in between. Returns its bottom rectangle and whether it went to the top. */
const CAPTION_PLACE = (box) => {
  const b = document.getElementById('demo-subtitle');
  if (!b) return null;
  b.style.top = 'auto';
  b.style.bottom = '32px';
  const r = b.getBoundingClientRect();
  const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  const covers = !!box && box.x < rect.x + rect.width && box.x + box.width > rect.x && box.y < rect.y + rect.height && box.y + box.height > rect.y;
  if (covers) {
    b.style.bottom = 'auto';
    b.style.top = '32px';
  }
  return { rect, top: covers };
};

/** No on-camera target may sit under the caption box: for a target (`box`) it would cover, the caption goes to
 *  the top of the frame for that action, and returns to the bottom with the next target that is clear of it (or
 *  with `box` null). Works for any target, a fixed wizard button included, since nothing is scrolled. */
export async function placeCaption(ctx, box, label) {
  const r = await ctx.page.evaluate(CAPTION_PLACE, box);
  if (r?.top) ctx.log(`CAPTION at the top for ${label}: target ${JSON.stringify(box)}, caption ${JSON.stringify(r.rect)}`);
}

/** Whether a select holds `option`, matched the way it was asked for: a string matches the value or the
 *  label (as Playwright's selectOption does), else { label }, { value } or { index }. */
const holds = (got, option) => (typeof option === 'string' ? got.value === option || got.label === option
  : option.label != null ? got.label === option.label
    : option.value != null ? got.value === option.value
      : got.index === option.index);

/** The state of a <select> element, read in the page. */
const selectState = (s) => ({ value: s.value, label: s.selectedOptions[0]?.label ?? '', index: s.selectedIndex, connected: s.isConnected });

/** Picks `option` in a native <select> where the viewer sees it: the cursor moves to the select, which takes
 *  focus, then the option is selected (the native popup is not in the recording, so the choice shows as the
 *  select's new value). Throws when the select is not one visible element, or does not hold the option: read
 *  at once (a controlled select the app rejects is reset in the same event) and again once the page settled.
 *  A select whose row goes away with the change (a reassigned task leaving a person's list) is read at once only.
 *  `resets`: an action select that returns to its placeholder by design once picked ("Add person lane"); the
 *  step checks what it did instead. */
export async function choose(ctx, loc, option, label, { resets = false } = {}) {
  await visibleOne(loc, label, ACTION_TIMEOUT_MS);
  await moveTo(ctx, loc, label);
  await loc.focus();
  const select = await loc.elementHandle();
  try {
    await loc.selectOption(option);
    if (resets) {
      await L.settle(ctx.page);
      await pace(ctx, 600);
      return;
    }
    const check = (got) => { if (!holds(got, option)) throw new Error(`did not take: ${label} (holds "${got.label}")`); };
    check(await select.evaluate(selectState));
    await L.settle(ctx.page);
    await pace(ctx, 600);
    const after = await select.evaluate(selectState);
    if (after.connected) check(after);
    else ctx.log(`choose: ${label} left the page with the change`);
  } finally {
    await select.dispose();
  }
}

export async function click(ctx, loc, label, after = 900) {
  await visibleOne(loc, label, ACTION_TIMEOUT_MS);
  await moveTo(ctx, loc, label);
  await loc.click();
  await L.settle(ctx.page);
  await pace(ctx, after);
}

/** The pause between two typed keys. Each key also costs about 60 ms of page work, so at this pace a 23-letter
 *  name takes under 2 s: typing is seen, and a form filled on camera leaves no long silence (§715). */
export const TYPE_DELAY_MS = 15;

/** Types visibly; `slow: false` fills at once (credentials: never typed character by character). */
export async function type(ctx, loc, text, label, { slow = true } = {}) {
  await click(ctx, loc, label, 200);
  // Replace the old value without ever emptying the field: some fields act on an empty value (a role's
  // rate flips the row to the other basis when cleared). Typed over a selection, or filled at once.
  if (slow && !ctx.rehearse) {
    await loc.press('Control+A');
    await loc.pressSequentially(text, { delay: TYPE_DELAY_MS });
  } else await loc.fill(text);
  await pace(ctx, 300);
}

/** How long a nav waits for its item: the app may still be loading after a reload. */
const NAV_TIMEOUT_MS = 60000;

/** Opens a nav item by its exact name; retries when a reload lands just after the click. */
export async function nav(ctx, name) {
  const page = ctx.page;
  // The visible item: the cursor goes to it before the click, so a nav is never an unseen jump. A sub-item
  // appears once its parent is open, and a reload re-renders the sidebar, so it is waited for.
  const item = page.locator(L.NAV).filter({ hasText: new RegExp('^\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\d*\\s*$') })
    .filter({ visible: true }).first();
  await item.waitFor({ state: 'visible', timeout: NAV_TIMEOUT_MS }).catch(() => { throw new Error(`nav: no visible item "${name}"`); });
  await moveTo(ctx, item, `nav ${name}`);
  const title = async () => (await page.locator('header').first().innerText().catch(() => '')).split('\n')[0].trim();
  for (let attempt = 0; attempt < 3; attempt++) {
    // Matched as L.openView does (a trailing count badge dropped); serialised, so written out here.
    await page.waitForFunction(({ sel, name }) => [...document.querySelectorAll(sel)].some(
      (e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').replace(/\s*\d+$/, '') === name), { sel: L.NAV, name }, { timeout: NAV_TIMEOUT_MS })
      .catch(() => { throw new Error(`nav: no item "${name}"`); });
    const before = await title();
    await L.openView(page, name);
    await pace(ctx, 1500);
    const after = await title();
    if (after !== before || before === name) return;
    ctx.log('nav retry ' + name);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
  }
  throw new Error('nav did not reach ' + name);
}

/** A view's hint callout (view-callout.tsx): its text is the <p> beside the "Dismiss hint" button. */
export const VIEW_HINT = 'main div:has(> button[aria-label="Dismiss hint"]) > p';
const HINT_TRIES = 20;
const HINT_POLL_MS = 250; // with HINT_TRIES, up to 5 s for the view's callout to render after its nav

/** The text of the one visible hint callout of `view`. A hidden panel keeps its callout in the DOM (RAID's is
 *  mounted on every tab, and comes first), so only a visible one counts; none or several visible throw. */
export async function viewHint(ctx, view) {
  let shown = [];
  for (let i = 0; i < HINT_TRIES; i++) {
    shown = [];
    for (const p of await ctx.page.locator(VIEW_HINT).all()) if (await p.isVisible()) shown.push(p);
    if (shown.length) break;
    await ctx.page.waitForTimeout(HINT_POLL_MS);
  }
  if (shown.length !== 1) throw new Error(`${shown.length ? `${shown.length} visible hints` : 'no visible hint'} on ${view}`);
  return (await shown[0].innerText()).trim().replace(/\s+/g, ' ');
}

export async function skipTour(ctx, waitMs = 0) {
  const sk = ctx.page.getByRole('button', { name: 'Skip', exact: true });
  if (waitMs) await sk.first().waitFor({ state: 'visible', timeout: waitMs }).catch(() => {});
  if (await sk.first().isVisible().catch(() => false)) await click(ctx, sk.first(), 'Skip tour');
}
