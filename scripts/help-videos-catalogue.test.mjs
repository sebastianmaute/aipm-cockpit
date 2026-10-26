// The in-app Help links the published video guides by the recorder's ids and titles
// (src/app/help-videos.ts). This pins the two lists together: a video added, removed or
// retitled here must be mirrored there, with its YouTube id read from the channel.
import { describe, expect, it } from 'vitest';
import { VIDEOS } from './demo-video/videos.mjs';
import { HELP_VIDEO_CATALOGUE } from '../src/app/help-videos.ts';

describe('Help video catalogue', () => {
  it('names every recorded video, with the same title, and nothing else', () => {
    const recorded = Object.fromEntries(VIDEOS.map((v) => [v.id, v.title]));
    const help = Object.fromEntries(Object.entries(HELP_VIDEO_CATALOGUE).map(([id, v]) => [id, v.title]));
    expect(help).toEqual(recorded);
  });
});
