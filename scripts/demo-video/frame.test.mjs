// §715 the frame of every video: 1920x1080 in both the browser and the screencast, the splash before the title
// card, the version label of the demo, and the check that the Next.js dev badge stays out of the picture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VIEWPORT, appVersionLabel } from './lib.mjs';
import { SPLASH_MS, checkDevBadge, splash } from './ui.mjs';

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

describe('appVersionLabel (§715)', () => {
  const fixture = '// header\nexport const APP_VERSION = "1.19.0";\nexport const APP_BUILD_DATE = "2026-10-20";\n'
    + '/** APP_MILESTONE in prose: "Wrong" */\nexport const APP_MILESTONE = "Nesbø";\n';

  it('reads the version and the milestone from the declarations, not from prose', () => {
    expect(appVersionLabel(fixture)).toBe('v1.19.0 Nesbø');
  });

  it('throws when either declaration is missing', () => {
    expect(() => appVersionLabel('export const APP_VERSION = "1.19.0";')).toThrow(/APP_MILESTONE/);
    expect(() => appVersionLabel('export const APP_MILESTONE = "X";')).toThrow(/APP_VERSION/);
  });

  it('reads the real version.ts', () => {
    expect(appVersionLabel(src('../../src/app/version.ts'))).toMatch(/^v\d+\.\d+\.\d+ \S/);
  });
});

/** A page that records what the take asks of it; `badge` is what the in-page dev-badge probe answers. */
function fakeCtx({ rehearse = false, badge = false } = {}) {
  const calls = [];
  const lines = [];
  const page = {
    evaluate: async (fn, arg) => {
      const what = String(fn);
      if (what.includes('nextjs-portal')) return badge;
      calls.push(what.includes('demo-splash') && arg ? `splash(${arg})` : 'evaluate');
    },
    waitForTimeout: async (ms) => { calls.push(`wait(${ms})`); },
  };
  return { ctx: { page, rehearse, log: (l) => lines.push(l) }, calls, lines };
}

describe('splash (§715)', () => {
  it('shows the splash for 3 s, then takes it away', async () => {
    const { ctx, calls } = fakeCtx();
    await splash(ctx);
    expect(SPLASH_MS).toBe(3000);
    expect(calls).toEqual(['splash(/splash-aipm-cockpit.svg)', `wait(${SPLASH_MS})`, 'evaluate']);
  });

  it('is there in a rehearsal too, at the rehearsal pace', async () => {
    const { ctx, calls } = fakeCtx({ rehearse: true });
    await splash(ctx);
    expect(calls).toEqual(['splash(/splash-aipm-cockpit.svg)', 'wait(150)', 'evaluate']);
  });
});

describe('checkDevBadge (§715)', () => {
  it('logs and counts a warning when the Next.js dev badge is on the page', async () => {
    const { ctx, lines } = fakeCtx({ badge: true });
    expect(await checkDevBadge(ctx)).toBe(1);
    expect(lines).toEqual(['DEV BADGE visible — start the dev server with DEMO_RECORDER=1']);
  });

  it('is quiet when it is not', async () => {
    const { ctx, lines } = fakeCtx({ badge: false });
    expect(await checkDevBadge(ctx)).toBe(0);
    expect(lines).toEqual([]);
  });
});
