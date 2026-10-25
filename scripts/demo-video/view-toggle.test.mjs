// §715 the Gantt clip's View-layer steps, on a fake Gantt (fake-dom.mjs): the View button opens a menu of
// toggle buttons (aria-pressed). A layer starts off (the gantt-layers-off seed) and is switched on; milestones
// start on and are switched off and on again; any other layer found on fails the take, naming the seed.
import { describe, expect, it } from 'vitest';
import { button, el, fakePage } from './fake-dom.mjs';
import { FEATURE_STEPS } from './steps/features.mjs';

const LAYERS = { 'view-dependencies': 'Dependencies', 'view-critical-path': 'Critical path', 'view-milestones': 'Milestones' };

/** The Gantt for `on` (label -> pressed): the View menu while `s.menu`, and a milestone slider while they show. */
function gantt(s) {
  return () => {
    const chart = s.on.Milestones ? [el({ role: 'slider', name: 'Move milestone – Go-live' })] : [];
    const body = [el({ tag: 'main' }, button('View', { on: () => { s.menu = true; } }), ...chart)];
    if (s.menu) {
      body.push(el({ role: 'dialog', name: 'View' }, ...Object.values(LAYERS).map((label) =>
        button(label, { pressed: !!s.on[label], on: () => { s.on[label] = !s.on[label]; } }))));
    }
    return el({ tag: 'body' }, ...body);
  };
}

const stepOf = (id) => FEATURE_STEPS['f-gantt'].find((x) => x.id === id);
const run = (id, on) => {
  const s = { on: { ...on }, menu: false };
  const clicks = [];
  return { s, clicks, done: stepOf(id).run({ page: fakePage(gantt(s), clicks), rehearse: true, clipId: 'f-gantt', log: () => {} }) };
};

describe('the Gantt View-layer steps (§715)', () => {
  it('switches a layer that starts off on', async () => {
    const { s, clicks, done } = run('view-critical-path', {});
    await done;
    expect(clicks).toEqual(['View', 'Critical path', 'key Escape']);
    expect(s.on['Critical path']).toBe(true);
  });

  it('switches milestones, which start on, off and on again', async () => {
    const { s, clicks, done } = run('view-milestones', { Milestones: true });
    await done;
    expect(clicks).toEqual(['View', 'Milestones', 'Milestones', 'key Escape']);
    expect(s.on.Milestones).toBe(true);
  });

  it('fails when any other layer is already on, naming the seed', async () => {
    const { s, clicks, done } = run('view-dependencies', { Dependencies: true });
    await expect(done).rejects.toThrow('View: Dependencies was already on (the gantt-layers-off seed did not apply)');
    expect(clicks).toEqual(['View']);
    expect(s.on.Dependencies).toBe(true);
  });
});
