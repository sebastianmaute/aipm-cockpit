// §715 ch1-install, a playback chapter: each step shows its caption, which starts its narration line, then plays
// the source to where its stretch ends. A line longer than its stretch holds the stretch's last frame, as every
// caption waits for the voice before it. The times are seconds on the cut source (README.md "Playback chapters").
// Each caption names its beat literally, as ui.test.mjs's guard reads them.
import { step } from './step.mjs';
import { caption } from '../ui.mjs';
import { playTo } from '../playback.mjs';

export const INSTALL = [
  step('install-releases', {
    run: async (ctx) => {
      await caption(ctx, 'The installer is on GitHub, under Releases.', 'install-releases');
      await playTo(ctx, 17);
    },
  }),
  step('install-download', {
    run: async (ctx) => {
      await caption(ctx, 'Under Assets: the setup file for Windows.', 'install-download');
      await playTo(ctx, 21);
    },
  }),
  step('install-keep', {
    run: async (ctx) => {
      await caption(ctx, 'A rarely downloaded file: Keep, then Keep anyway.', 'install-keep');
      await playTo(ctx, 35.5);
    },
  }),
  step('install-run', {
    run: async (ctx) => {
      await caption(ctx, 'Open the file: the setup wizard starts.', 'install-run');
      await playTo(ctx, 47);
    },
  }),
  step('install-progress', {
    run: async (ctx) => {
      await caption(ctx, 'Installing takes a minute or two.', 'install-progress');
      await playTo(ctx, 56.5);
    },
  }),
  step('install-finish', {
    run: async (ctx) => {
      await caption(ctx, 'Finish starts the app.', 'install-finish');
      await playTo(ctx, 68.4);
    },
  }),
];
