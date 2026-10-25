// §715 the video thumbnails: one approved headline per video, its red part, the page that renders it, and the frame
// time picked from the video's beats. Pure; the rendering itself is make-thumbnails.mjs.
import { describe, expect, it } from 'vitest';
import { THUMBNAILS, defaultFrameTime, headlineParts, tagFor, thumbnailHtml } from './thumbnails.mjs';
import { VIDEOS } from './videos.mjs';

describe('THUMBNAILS (§715)', () => {
  it('has one headline for every video, and none for a video that does not exist', () => {
    expect(Object.keys(THUMBNAILS).sort()).toEqual(VIDEOS.map((v) => v.id).sort());
  });

  it('marks exactly one red part in every headline, and keeps it short enough to read on a phone', () => {
    for (const [id, { headline }] of Object.entries(THUMBNAILS)) {
      expect(headline.match(/\{[^{}]+\}/g), id).toHaveLength(1);
      expect(headline.replace(/[{}]/g, '').split(/\s+/).length, id).toBeLessThanOrEqual(4);
    }
  });

  it('keeps the approved Monday headline', () => {
    expect(THUMBNAILS['ch3-monday'].headline).toBe('MILESTONE {SLIPPED}');
  });
});

describe('headlineParts (§715)', () => {
  it('splits a headline into plain and red runs, in order', () => {
    expect(headlineParts('ASK. IT {ACTS.}')).toEqual([{ text: 'ASK. IT ', red: false }, { text: 'ACTS.', red: true }]);
    expect(headlineParts('{RESCUE} THE MVP')).toEqual([{ text: 'RESCUE', red: true }, { text: ' THE MVP', red: false }]);
  });
});

describe('tagFor (§715)', () => {
  it('names the series: a chapter its day and place, a clip its kind', () => {
    expect(tagFor(VIDEOS.find((v) => v.id === 'ch3-monday'))).toBe('AI PM COCKPIT · MONDAY 3/7');
    expect(tagFor(VIDEOS.find((v) => v.id === 'ai-chat'))).toBe('AI PM COCKPIT · AI');
    expect(tagFor(VIDEOS.find((v) => v.id === 'f-board'))).toBe('AI PM COCKPIT · FEATURE');
    expect(tagFor(VIDEOS.find((v) => v.id === 'big'))).toBe('AI PM COCKPIT · FULL WEEK');
  });
});

describe('thumbnailHtml (§715)', () => {
  const html = thumbnailHtml({ tag: 'A & B', headline: 'WHO\'S {<OUT>}', frame: 'data:image/png;base64,AAAA' });

  it('escapes the tag and the headline, and sets the red part apart', () => {
    expect(html).toContain('A &amp; B');
    expect(html).toContain('WHO&#39;S ');
    expect(html).toContain('<span class="red">&lt;OUT&gt;</span>');
    expect(html).not.toContain('<OUT>');
  });

  it('shows the frame it is given, and renders at 1920×1080 (Full HD)', () => {
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toMatch(/width:\s*1920px/);
    expect(html).toMatch(/height:\s*1080px/);
  });
});

describe('defaultFrameTime (§715)', () => {
  const sidecar = {
    duration: 60,
    beats: [
      { id: 'title', at: 3, caption: null },
      { id: 'mon-hero', at: 12, caption: 'The dashboard.' },
      { id: 'mon-b', at: 30, caption: 'Next.' },
      { id: 'closing', at: 55, caption: 'Done.' },
    ],
  };

  it('is a little after the first captioned beat past the title, when the view is on screen', () => {
    expect(defaultFrameTime(sidecar)).toBe(14.5);
  });

  it('uses a beat named by the headline entry instead, when there is one', () => {
    expect(defaultFrameTime(sidecar, { beat: 'mon-b' })).toBe(32.5);
  });

  it('uses a fixed time when the entry gives one, and none without a sidecar', () => {
    expect(defaultFrameTime(sidecar, { at: 20 })).toBe(20);
    expect(defaultFrameTime(null)).toBeNull();
    expect(defaultFrameTime(null, { at: 7 })).toBe(7);
  });

  it('never picks a time past the end of the video', () => {
    expect(defaultFrameTime({ duration: 13, beats: [{ id: 'a', at: 12, caption: 'x' }] })).toBeLessThan(13);
  });
});
