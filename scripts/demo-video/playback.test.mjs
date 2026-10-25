// §715 a playback chapter: the source plays to where a stretch ends and pauses there; a rehearsal seeks; the
// install chapter's steps name their own beats and run forward through the source. A fake page runs the page
// functions against a stub document, so no browser runs here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPlayback, playTo } from './playback.mjs';
import { INSTALL } from './steps/install.mjs';

// The page's video and caption bar, as stand-ins in jsdom's document (jsdom plays no media).
let video;
beforeEach(() => {
  document.body.innerHTML = '<div id="pb"></div><div id="demo-subtitle"></div>';
  video = Object.assign(document.getElementById('pb'), {
    currentTime: 0, ended: false, calls: [],
    play() { this.calls.push('play'); },
    pause() { this.calls.push('pause'); },
  });
});
afterEach(() => { document.body.innerHTML = ''; });

/** A page whose waitForFunction advances the video in 0.5 s steps until the condition holds. */
function fakeCtx({ rehearse = false } = {}) {
  const lines = [];
  const page = {
    evaluate: async (fn, arg) => fn(arg),
    waitForFunction: async (fn, arg) => {
      for (let i = 0; i < 1000 && !fn(arg); i++) video.currentTime += 0.5;
      if (!fn(arg)) throw new Error('never');
    },
    waitForTimeout: async () => {},
  };
  return { page, rehearse, log: (l) => lines.push(l), lines };
}

describe('playTo (§715)', () => {
  it('plays the source until the stretch ends, then pauses on that frame', async () => {
    await playTo(fakeCtx(), 17);
    expect(video.calls).toEqual(['play', 'pause']);
    expect(video.currentTime).toBeGreaterThanOrEqual(17);
  });

  it('a rehearsal seeks to the end of the stretch at once and never plays', async () => {
    await playTo(fakeCtx({ rehearse: true }), 35.5);
    expect(video.calls).toEqual([]);
    expect(video.currentTime).toBe(35.5);
  });
});

describe('openPlayback (§715)', () => {
  it('fails at once, naming the file, when the source is missing', async () => {
    await expect(openPlayback(fakeCtx(), 'C:/nowhere/01-ch1-install.webm')).rejects.toThrow('playback source missing: C:/nowhere/01-ch1-install.webm');
  });
});

describe('the install chapter (§715)', () => {
  // Its beat ids are pinned where every caption's is: ui.test.mjs reads them from the step modules.
  it('each step shows one caption, and the stretches run forward to the end of the source', async () => {
    const ctx = fakeCtx({ rehearse: true });
    const ends = [];
    for (const s of INSTALL) {
      await s.run(ctx);
      ends.push(video.currentTime);
    }
    expect(INSTALL.map((s) => s.id)).toEqual(['install-releases', 'install-download', 'install-keep', 'install-run', 'install-progress', 'install-finish']);
    expect(ctx.lines.filter((l) => l.startsWith('CAPTION ')).length).toBe(INSTALL.length);
    expect(ends).toEqual([17, 21, 35.5, 47, 56.5, 68.4]);
  });
});
