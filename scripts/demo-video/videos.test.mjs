// §715 A — the shape of the 43 video definitions: ids, tiers, texts, and what each take relies on.
import { describe, expect, it } from 'vitest';
import { TIERS, VIDEOS } from './videos.mjs';

const byId = (id) => VIDEOS.find((d) => d.id === id);
const inTier = (t) => VIDEOS.filter((d) => d.tier === t).map((d) => d.id);
const CHAPTERS = ['ch2-connect', 'ch3-monday', 'ch4-tuesday', 'ch5-wednesday', 'ch6-thursday', 'ch7-friday'];

describe('the video definitions (§715)', () => {
  it('43 videos, ids unique, tiers 1/7/15/20', () => {
    expect(VIDEOS).toHaveLength(43);
    expect(new Set(VIDEOS.map((d) => d.id)).size).toBe(43);
    expect(TIERS).toEqual(['big', 'chapters', 'ai', 'features']);
    expect(TIERS.map((t) => inTier(t).length)).toEqual([1, 7, 15, 20]);
  });

  it("ids are the spec's", () => {
    expect(inTier('big')).toEqual(['big']);
    expect(inTier('chapters')).toEqual(['ch1-install', ...CHAPTERS]);
    expect(inTier('ai')).toEqual([
      'ai-proposal', 'ai-chat', 'ai-dedup', 'ai-wbs', 'ai-inline-task', 'ai-inline-entity', 'ai-next-actions',
      'ai-insight', 'ai-digest', 'ai-alloc', 'ai-raci', 'ai-steering', 'ai-forecast-import', 'ai-weights', 'ai-scheduled',
    ]);
    expect(inTier('features')).toEqual([
      'f-open-points', 'f-board', 'f-swimlanes', 'f-gantt', 'f-milestones', 'f-changes', 'f-directory', 'f-absences',
      'f-planning', 'f-workload', 'f-raid', 'f-modules', 'f-budget', 'f-trends', 'f-stakeholders', 'f-raci',
      'f-influence', 'f-knowledge', 'f-activity', 'f-history',
    ]);
  });

  it('ch1-install is the one playback chapter, played from its cut source; no video is left hand-recorded', () => {
    expect(VIDEOS.filter((d) => d.playback).map((d) => [d.id, d.playback])).toEqual([['ch1-install', 'sources/01-ch1-install.webm']]);
    expect(VIDEOS.filter((d) => d.handRecorded)).toEqual([]);
  });

  it('every video has an opening text, a title and at least one step', () => {
    for (const d of VIDEOS.filter((v) => !v.handRecorded)) {
      expect(d.title, d.id).toBeTruthy();
      expect(d.opening, d.id).toBeTruthy();
      expect(d.steps.length, d.id).toBeGreaterThan(0);
      for (const s of d.steps) expect(typeof s.run, `${d.id}/${s.id}`).toBe('function');
      expect(Array.isArray(d.preconditions), d.id).toBe(true);
    }
  });

  it('every AI step in a chapter or the big video has a replay', () => {
    for (const d of VIDEOS.filter((v) => v.tier === 'chapters' || v.tier === 'big')) {
      for (const s of d.steps.filter((x) => x.ai)) expect(typeof s.replay, `${d.id}/${s.id}`).toBe('function');
    }
  });

  it('only ch2-connect and big show the prologue on camera', () => {
    expect(VIDEOS.filter((d) => d.prologueOnCamera).map((d) => d.id)).toEqual(['big', 'ch2-connect']);
  });

  it('ch2-connect is the first run: it creates a project; big keeps the short prologue that cancels', () => {
    expect(VIDEOS.filter((d) => d.firstRun).map((d) => d.id)).toEqual(['ch2-connect']);
    expect(byId('ch2-connect').prologue.map((s) => s.id)).toEqual(['wizard-create', 'first-project-lands']);
    expect(byId('big').prologue.map((s) => s.id)).toEqual(['wizard-proposal']);
    expect(byId('ch2-connect').prologue[0].ai).toBe(true);
    expect(typeof byId('ch2-connect').prologue[0].check).toBe('function');
  });

  it('chapters replay the days before them', () => {
    expect(byId('ch3-monday').replayThrough).toBeUndefined();
    expect(byId('ch3-monday').clock).toBe('mon');
    const later = { 'ch4-tuesday': ['mon', 'tue'], 'ch5-wednesday': ['tue', 'wed'], 'ch6-thursday': ['wed', 'thu'], 'ch7-friday': ['thu', 'fri'] };
    for (const [id, [through, clock]] of Object.entries(later)) {
      expect(byId(id).replayThrough, id).toBe(through);
      expect(byId(id).clock, id).toBe(clock);
    }
  });

  it("f-gantt follows the owner's script", () => {
    expect(byId('f-gantt').steps.map((s) => s.id)).toEqual([
      'dedup', 'drag-bar-move', 'drag-bar-end', 'drag-bar-start', 'drag-milestone', 'filter-completed',
      'view-dependencies', 'view-absences', 'view-critical-path', 'view-milestones', 'view-inline-milestones',
      // Off camera, before the clip starts (a setup step runs first wherever it stands).
      'gantt-layers-off',
    ]);
  });

  it('a step written once is the same object everywhere it is used', () => {
    const dedup = byId('ch4-tuesday').steps.find((s) => s.id === 'dedup');
    expect(dedup).toBeDefined();
    expect(byId('f-gantt').steps[0]).toBe(dedup);
    expect(byId('ai-dedup').steps.find((s) => s.id === 'dedup')).toBe(dedup);
    expect(byId('big').steps).toContain(dedup);
  });

  it("opening texts are the spec's", () => {
    expect(byId('f-gantt').opening).toBe(
      'The Gantt chart shows tasks and milestones on a timeline. Link dependencies to see what must finish before what.',
    );
    expect(byId('ai-dedup').opening).toBe('Deduplicate & unify finds tasks that say the same thing and merges them.');
    expect(byId('f-open-points').opening).toEqual({ banner: 'Open Points' });
    expect(byId('ch3-monday').title).toBe('Monday — a milestone slipped');
  });
});
