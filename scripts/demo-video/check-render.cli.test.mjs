// §715 check-render.mjs as a process: its exit code for a clean render (0), a render with a real finding (1) and
// one whose only findings are unverified (3). It probes real files, so the fixtures are tiny MP4s made with
// ffmpeg; without ffmpeg on the PATH the suite is skipped (proved by a run with it hidden).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-render.mjs');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/** A `seconds`-long, 64x64 MP4 at `file`, with `srt` beside it. */
function render(file, seconds, srt) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=64x64:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  fs.writeFileSync(file.replace(/\.mp4$/, '.srt'), srt);
}
const cue = (n, a, b) => `${n}\n00:00:${String(a).padStart(2, '0')},000 --> 00:00:${String(b).padStart(2, '0')},000\nText\n`;
const run = (...files) => spawnSync(process.execPath, [CLI, ...files], { encoding: 'utf8' });

describe.skipIf(!hasFfmpeg)('check-render.mjs exit codes (§715)', () => {
  // vitest runs this body to collect the tests even when the suite is skipped: the fixtures are made in
  // beforeAll, which a skipped suite never runs, so a machine without ffmpeg only skips.
  let dir;
  let clean;
  let stall;
  let old;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-render-'));
    clean = path.join(dir, 'features', '01-clean.mp4');
    stall = path.join(dir, 'features', '02-stall.mp4');
    old = path.join(dir, 'chapters', '03-old.mp4');
    render(clean, 6, `${cue(1, 1, 2)}\n${cue(2, 3, 4)}`); // tail 2 s: fine
    render(stall, 26, `${cue(1, 1, 2)}\n${cue(2, 22, 24)}`); // a 20 s gap in a feature clip
    render(old, 26, `${cue(1, 1, 2)}\n${cue(2, 22, 24)}`); // the same in a chapter without a waits file: unverified
  });
  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 when every render is clean', () => {
    const r = run(clean);
    expect(r.stdout.trim()).toBe(`${clean}: ok`);
    expect(r.status).toBe(0);
  });

  it('exits 1 on a real finding, whatever else the batch holds', () => {
    expect(run(clean, stall).status).toBe(1);
    expect(run(old, stall).status).toBe(1);
  });

  it('exits 3 when the only findings are unverified', () => {
    const r = run(clean, old);
    expect(r.stdout).toContain('RENDER unverified (AI wait?) gap');
    expect(r.status).toBe(3);
  });

  it('exits 2 with no files', () => {
    expect(run().status).toBe(2);
  });
});
