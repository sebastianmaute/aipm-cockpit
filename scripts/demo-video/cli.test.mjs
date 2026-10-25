// §715 A — the recorder's command line: which videos a run selects, where each lands, how it exits.
import { describe, expect, it } from 'vitest';
import { exitCode, findSecrets, outPath, parseArgs, selectVideos } from './cli.mjs';
import { VIDEOS } from './videos.mjs';

const ids = (defs) => defs.map((d) => d.id);
const byId = (id) => VIDEOS.find((d) => d.id === id);

describe('the recorder command line (§715)', () => {
  it('--video picks one', () => {
    expect(ids(selectVideos(VIDEOS, parseArgs(['--video', 'f-gantt'])))).toEqual(['f-gantt']);
  });

  it('an unknown video is an error', () => {
    expect(() => selectVideos(VIDEOS, parseArgs(['--video', 'nope']))).toThrow('unknown video nope');
  });

  it('--all takes every video, the played-back install chapter included', () => {
    const all = selectVideos(VIDEOS, parseArgs(['--all']));
    expect(all).toHaveLength(43);
    expect(ids(all)).toContain('ch1-install');
  });

  it('--all and --tier still skip a video recorded by hand that is not played back', () => {
    const defs = [{ id: 'by-hand', tier: 'chapters', handRecorded: true }, { id: 'taken', tier: 'chapters' }];
    expect(ids(selectVideos(defs, parseArgs(['--all'])))).toEqual(['taken']);
    expect(ids(selectVideos(defs, parseArgs(['--tier', 'chapters'])))).toEqual(['taken']);
  });

  it('--tier ai is the 15 AI clips in order', () => {
    expect(ids(selectVideos(VIDEOS, parseArgs(['--tier', 'ai'])))).toEqual([
      'ai-proposal', 'ai-chat', 'ai-dedup', 'ai-wbs', 'ai-inline-task', 'ai-inline-entity', 'ai-next-actions',
      'ai-insight', 'ai-digest', 'ai-alloc', 'ai-raci', 'ai-steering', 'ai-forecast-import', 'ai-weights', 'ai-scheduled',
    ]);
  });

  it('exactly one selector', () => {
    expect(() => parseArgs(['--all', '--video', 'x'])).toThrow('choose one of --video, --tier, --all, --list');
    expect(() => parseArgs([])).toThrow('choose one of --video, --tier, --all, --list');
    expect(() => parseArgs(['--tier', 'clips'])).toThrow('unknown tier clips');
  });

  it('reads the flags', () => {
    expect(parseArgs(['--video', 'big', '--rehearse', '--with-ai'])).toMatchObject({ video: 'big', rehearse: true, withAi: true, probe: false, list: false, all: false });
    expect(parseArgs(['--list'])).toMatchObject({ list: true });
  });

  it('output path numbers within the tier', () => {
    expect(outPath('/o', byId('f-open-points'), VIDEOS).replace(/\\/g, '/')).toBe('/o/features/01-f-open-points.webm');
    expect(outPath('/o', byId('ch3-monday'), VIDEOS).replace(/\\/g, '/')).toBe('/o/chapters/03-ch3-monday.webm');
    expect(outPath('/o', byId('big'), VIDEOS).replace(/\\/g, '/')).toBe('/o/big/01-big.webm');
  });

  it('exit code', () => {
    expect(exitCode({ warnings: 0, skipped: 0, failed: 0 })).toBe(0);
    expect(exitCode({ warnings: 1, skipped: 0, failed: 0 })).toBe(1);
    expect(exitCode({ warnings: 0, skipped: 1, failed: 0 })).toBe(1);
    expect(exitCode({ warnings: 0, skipped: 0, failed: 1 })).toBe(1);
  });

  it('findSecrets counts every occurrence and ignores an empty secret', () => {
    expect(findSecrets('a TOKEN b', ['TOKEN', ''])).toBe(1);
    expect(findSecrets('KEY KEY', ['KEY'])).toBe(2);
    expect(findSecrets('nothing here', ['', 'TOKEN'])).toBe(0);
  });
});
