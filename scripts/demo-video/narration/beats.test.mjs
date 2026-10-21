// §715 narration files: the format parser and the beat lookup.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNarration, narrationPath, loadBeats, TITLE, OPENING, CLOSING } from './beats.mjs';
import { VIDEOS } from '../videos.mjs';

const CHAPTERS = VIDEOS.filter((v) => v.tier === 'chapters' && !v.handRecorded).map((v) => v.id);

describe('parseNarration', () => {
  it('reads each heading as a beat and joins its lines with single spaces', () => {
    const text = '# T\n\n## title\nA b.\n\n## mon-hero\nC d\ne.\n';
    expect(parseNarration(text)).toEqual([{ id: 'title', text: 'A b.' }, { id: 'mon-hero', text: 'C d e.' }]);
  });
  it('ignores the text above the first heading and tolerates CRLF', () => {
    expect(parseNarration('# Owner title\r\nnotes\r\n\r\n## x\r\nHi\r\n')).toEqual([{ id: 'x', text: 'Hi' }]);
  });
  it('throws on an invalid id', () => {
    expect(() => parseNarration('## Mon Hero\ntext')).toThrow('narration: bad beat id "Mon Hero"');
  });
  it('throws on a duplicate id', () => {
    expect(() => parseNarration('## x\na\n## x\nb')).toThrow('narration: duplicate beat id "x"');
  });
  it('throws on an empty beat', () => {
    expect(() => parseNarration('## x\n\n## y\nb')).toThrow('narration: empty beat "x"');
  });
});

describe('narrationPath and reserved ids', () => {
  it('points at narration/<lang>/<id>.md', () => {
    expect(narrationPath('en', 'ch3-monday').replaceAll('\\', '/').endsWith('scripts/demo-video/narration/en/ch3-monday.md')).toBe(true);
  });
  it('reserves title, opening and closing', () => {
    expect([TITLE, OPENING, CLOSING]).toEqual(['title', 'opening', 'closing']);
  });
});

function fakeFs(files) {
  const byName = new Map(Object.entries(files));
  const key = (p) => path.basename(p);
  return { exists: (p) => byName.has(key(p)), read: (p) => byName.get(key(p)) };
}

describe('loadBeats', () => {
  const files = {
    'ch3-monday.md': '## a\nchapter a\n## b\nchapter b\n',
    'ch4-tuesday.md': '## c\nchapter c\n',
    'big.md': '## a\nbig a\n## d\nbig d\n',
    'f-x.md': '## only\nfeature\n',
  };
  it('lets big.md override chapter beats and add its own', () => {
    const m = loadBeats('en', { id: 'big' }, fakeFs(files));
    expect(Object.fromEntries(m)).toEqual({ a: 'big a', b: 'chapter b', c: 'chapter c', d: 'big d' });
  });
  it('reads chapter files in order and derives them from the video list', () => {
    expect(CHAPTERS).toEqual(['ch2-connect', 'ch3-monday', 'ch4-tuesday', 'ch5-wednesday', 'ch6-thursday', 'ch7-friday']);
    const read = [];
    loadBeats('en', { id: 'big' }, { exists: () => true, read: (p) => { read.push(path.basename(p)); return '## x\ny'; } });
    expect(read).toEqual([...CHAPTERS, 'big'].map((c) => c + '.md'));
  });
  it('reads only its own file for any other video', () => {
    expect(Object.fromEntries(loadBeats('en', { id: 'f-x' }, fakeFs(files)))).toEqual({ only: 'feature' });
  });
  it('returns an empty map when the video has no file', () => {
    const m = loadBeats('en', { id: 'f-board' }, fakeFs(files));
    expect(m).toBeInstanceOf(Map);
    expect(m.size).toBe(0);
  });
});
