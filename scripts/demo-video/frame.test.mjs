// §715 the frame of every video: 1920x1080 in both the browser and the screencast, the splash as the first thing
// on screen, and the check that the Next.js dev badge stays out of the picture. The in-page code of the overlay
// and the splash runs against the test's own DOM (jsdom), so what makes the splash a splash is pinned: on top,
// #003459, centred, 960x600, and gone after its 3 s.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEWPORT } from './lib.mjs';
import { OVERLAY, SPLASH, SPLASH_MS, checkDevBadge, endSplash, showSplash } from './ui.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');

describe('the 1080p frame (§715)', () => {
  it('is one constant, used by the browser viewport and the screencast', () => {
    expect(VIEWPORT).toEqual({ width: 1920, height: 1080 });
    expect(src('record.mjs')).toContain('viewport: L.VIEWPORT');
    expect(src('take.mjs')).toContain('size: L.VIEWPORT');
    for (const f of ['record.mjs', 'take.mjs', 'discover.mjs']) expect(src(f)).not.toMatch(/width: 1280|height: 720/);
  });
});

describe('next.config.ts (§715)', () => {
  it('hides the dev indicator only behind DEMO_RECORDER=1', () => {
    const config = src('../../next.config.ts');
    expect(config).toContain('...(process.env.DEMO_RECORDER === "1" ? { devIndicators: false as const } : {}),');
    expect(config.match(/devIndicators/g)).toHaveLength(1);
  });
});

/** A page whose evaluate runs the in-page function here, in the test's DOM; its waits are recorded. */
function domCtx({ rehearse = false } = {}) {
  const calls = [];
  const lines = [];
  const page = {
    evaluate: async (fn, arg) => fn(arg),
    waitForTimeout: async (ms) => { calls.push(`wait(${ms})`); },
  };
  return { ctx: { page, rehearse, log: (l) => lines.push(l) }, calls, lines };
}

/** An Image (a real <img>) that loads, or never does, once its src is set, as a served SVG would. */
function imageThat(event) {
  return function FakeImage() {
    const img = document.createElement('img');
    Object.defineProperty(img, 'src', {
      get: () => img.getAttribute('src'),
      set: (v) => { img.setAttribute('src', v); if (event) setTimeout(() => img[`on${event}`]?.(), 0); },
    });
    return img;
  };
}

describe('the splash (§715)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    OVERLAY('db.example');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('goes up over everything: the whole frame on #003459, the image centred at 960x600, above the caption and the cursor', async () => {
    vi.stubGlobal('Image', imageThat('load'));
    const { ctx } = domCtx();
    expect(await showSplash(ctx)).toBe(true);
    const s = document.getElementById('demo-splash');
    expect(s).not.toBeNull();
    expect(document.body.lastElementChild).toBe(s);
    expect(s.style.position).toBe('fixed');
    expect(['0', '0px']).toContain(s.style.inset);
    expect(s.style.background).toContain('rgb(0, 52, 89)');
    expect([s.style.display, s.style.alignItems, s.style.justifyContent]).toEqual(['flex', 'center', 'center']);
    const top = Number(s.style.zIndex);
    for (const id of ['demo-cursor', 'demo-subtitle']) expect(top).toBeGreaterThanOrEqual(Number(document.getElementById(id).style.zIndex));
    const img = s.firstElementChild;
    expect(img.src).toBe(SPLASH);
    expect([img.style.width, img.style.height]).toEqual(['960px', '600px']);
  });

  it('is held SPLASH_MS, then taken away', async () => {
    vi.stubGlobal('Image', imageThat('load'));
    const { ctx, calls } = domCtx();
    await showSplash(ctx);
    await endSplash(ctx);
    expect(SPLASH_MS).toBe(3000);
    expect(calls).toEqual([`wait(${SPLASH_MS})`]);
    expect(document.getElementById('demo-splash')).toBeNull();
  });

  it('is there in a rehearsal too, at the rehearsal pace', async () => {
    vi.stubGlobal('Image', imageThat('load'));
    const { ctx, calls } = domCtx({ rehearse: true });
    await showSplash(ctx);
    await endSplash(ctx);
    expect(calls).toEqual(['wait(150)']);
    expect(document.getElementById('demo-splash')).toBeNull();
  });

  it('goes up without its image after a bounded wait when the image does not load, and says so', async () => {
    vi.stubGlobal('Image', imageThat(null));
    const { ctx, lines } = domCtx();
    expect(await showSplash(ctx, { loadTimeoutMs: 5 })).toBe(false);
    expect(document.getElementById('demo-splash')).not.toBeNull();
    expect(lines).toEqual([`SPLASH ${SPLASH} did not load: the splash shows its background only`]);
  });

  it('a splash that stays up fails the take', async () => {
    vi.stubGlobal('Image', imageThat('load'));
    const { ctx } = domCtx();
    await showSplash(ctx);
    ctx.page.evaluate = async () => false;
    await expect(endSplash(ctx)).rejects.toThrow('the splash is still on the page');
  });
});

/** A page whose dev-badge probe answers `badge`, or throws. */
function badgeCtx(badge) {
  const lines = [];
  const page = { evaluate: async () => { if (badge instanceof Error) throw badge; return badge; } };
  return { ctx: { page, log: (l) => lines.push(l) }, lines };
}

describe('checkDevBadge (§715)', () => {
  it('logs and counts a warning when the Next.js dev badge is on the page', async () => {
    const { ctx, lines } = badgeCtx(true);
    expect(await checkDevBadge(ctx)).toBe(1);
    expect(lines).toEqual(['DEV BADGE visible — start the dev server with DEMO_RECORDER=1']);
  });

  it('is quiet when it is not', async () => {
    const { ctx, lines } = badgeCtx(false);
    expect(await checkDevBadge(ctx)).toBe(0);
    expect(lines).toEqual([]);
  });

  it('counts a warning when the probe itself fails, rather than passing silently', async () => {
    const { ctx, lines } = badgeCtx(new Error('Execution context was destroyed'));
    expect(await checkDevBadge(ctx)).toBe(1);
    expect(lines).toEqual(['DEV BADGE check failed: Execution context was destroyed']);
  });
});
