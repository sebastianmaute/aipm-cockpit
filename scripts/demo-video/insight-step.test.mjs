// §715 Friday's insight-recommendation step, driven through the take's AI runner on a fake Insights view
// (fake-dom.mjs) that renders the controls insight-recommendation-controls.tsx does: Generate with no
// recommendation or a rejected one, Apply and Reject on a proposed one, a note once applied. An empty plan fails
// the check, and the one retry must reject the suggestion before Generate can be clicked again.
import { describe, expect, it } from 'vitest';
import { button, el, fakePage, text } from './fake-dom.mjs';
import { runAi } from './take.mjs';
import { DAYS } from './steps/week.mjs';
import { en } from '../../src/app/i18n.ts';

const B = 'Budget off plan';
// The app's own lines, so a rewording in i18n.ts breaks this test as it would break the step.
const EMPTY_PLAN = en.insightRecommendationEmptyPlan;
const APPLIED = en.insightRecommendationApplied;
const STALE = en.insightRecommendationStale;
// §782's toast naming the failure, its {0} filled with a reason.
const DETAIL_FILLED = en.insightRecommendationApplyFailedDetail.replace('{0}', 'create_task: taskName, assignee required');

/** What the review's confirm does: applies the plan (the card's note and a toast), applies it with a change that
 *  threw, writes nothing (the card stays proposed; only a toast says so), or writes nothing while another card
 *  shows an outcome line. */
const OUTCOMES = {
  applied: (s) => { s.rec = 'applied'; s.toast = APPLIED; },
  stale: (s) => { s.toast = STALE; },
  // A change threw: the card still reads applied, the toast says some changes couldn't be applied.
  threw: (s) => { s.rec = 'applied'; s.toast = en.insightRecommendationApplyFailed; },
  elsewhere: (s) => { s.otherNote = en.insightRecommendationAppliedPartial; },
  // Applied, but the page fails the read of its outcome lines.
  unreadable: (s) => { s.rec = 'applied'; s.unreadable = 'Target page, context or browser has been closed'; },
  // A change threw, and its toast lags the card's note: it shows from the second wait after the confirm on.
  lagging: (s) => { s.rec = 'applied'; s.toast = en.insightRecommendationApplyFailed; s.toastAfterWaits = 2; s.waits = 0; },
  // §782's toast naming the failure: its {0} filled with the reason.
  detail: (s) => { s.rec = 'applied'; s.toast = DETAIL_FILLED; },
};

/** The Insights view for `s`: { rec: null | 'proposed' | 'rejected' | 'applied', review, empty, toast, otherNote,
 *  plans, outcome }, where each Generate takes the next of `plans` (true: an empty plan). */
function insights(s) {
  return () => {
    const controls = [];
    if (s.rec === null || s.rec === 'rejected') {
      if (s.rec === 'rejected') controls.push(text(en.insightRecommendationRejected));
      controls.push(button(`Generate recommendation – ${B}`, { on: () => { s.rec = 'proposed'; s.empty = s.plans.shift(); } }));
    } else if (s.rec === 'proposed') {
      controls.push(text('AI suggests: move budget to the pilot.'));
      controls.push(button(`Apply recommendation – ${B}`, { on: () => { s.review = true; } }));
      controls.push(button(`Reject – ${B}`, { on: () => { s.rec = 'rejected'; } }));
    } else controls.push(el({ text: APPLIED, unreadable: s.unreadable }));
    const cards = [el({ tag: 'li' }, text(B), ...controls, button(`Dismiss – ${B}`))];
    if (s.otherNote) cards.push(el({ tag: 'li' }, text('Schedule slipping'), text(s.otherNote)));
    const body = [el({ tag: 'main' }, el({ tag: 'ul' }, ...cards))];
    if (s.review) {
      body.push(el({ role: 'dialog', name: 'Review recommendation' },
        ...(s.empty ? [text(EMPTY_PLAN)] : []),
        button('Cancel', { on: () => { s.review = false; } }),
        button('Apply recommendation', { enabled: !s.empty, on: () => { s.review = false; OUTCOMES[s.outcome ?? 'applied'](s); } })));
    }
    if (s.toast && (s.waits ?? 0) >= (s.toastAfterWaits ?? 0)) body.push(el({ role: 'status' }, text(s.toast)));
    return el({ tag: 'body' }, ...body);
  };
}

const insightStep = DAYS.fri.find((x) => x.id === 'insight-recommendation');
const start = (plans, outcome) => ({ rec: null, review: false, plans, outcome });
// Every locator wait after the confirm counts as time passing (fake-dom onWait).
const onWait = (s) => () => { if (s.waits != null) s.waits++; };
const ctxFor = (s, clicks = [], logs = []) => ({ page: fakePage(insights(s), clicks, { onWait: onWait(s) }), rehearse: true, withAi: true, clipId: 'ch7-friday', log: (l) => logs.push(l) });

describe('the insight-recommendation step (§715)', () => {
  it('applies a recommendation whose plan has changes, without a retry', async () => {
    const s = start([false]);
    const clicks = [];
    await runAi(ctxFor(s, clicks), insightStep);
    expect(clicks).toEqual([`Generate recommendation – ${B}`, `Apply recommendation – ${B}`, 'Apply recommendation']);
    expect(s.rec).toBe('applied');
  });

  it('retries an empty plan: the review is closed, the suggestion rejected, then Generate is clicked again', async () => {
    const s = start([true, false]);
    const clicks = [];
    await runAi(ctxFor(s, clicks), insightStep);
    expect(clicks).toEqual([
      `Generate recommendation – ${B}`, `Apply recommendation – ${B}`,
      'Cancel', `Reject – ${B}`, `Generate recommendation – ${B}`, `Apply recommendation – ${B}`,
      'Apply recommendation',
    ]);
    expect(s.rec).toBe('applied');
  });

  it('fails, naming the step, when the retry is empty too', async () => {
    await expect(runAi(ctxFor(start([true, true])), insightStep))
      .rejects.toThrow('ch7-friday: AI step insight-recommendation returned no applicable changes twice');
  });

  it('reads an outcome that wrote nothing from the toast', async () => {
    await expect(runAi(ctxFor(start([false], 'stale')), insightStep))
      .rejects.toThrow(`ch7-friday: the recommendation was not applied in full: "${STALE}"`);
  });

  it('fails when the card reads applied but the toast says a change could not be applied', async () => {
    await expect(runAi(ctxFor(start([false], 'threw')), insightStep))
      .rejects.toThrow(`ch7-friday: the recommendation was not applied in full: "${en.insightRecommendationApplyFailed}"`);
  });

  it("fails on §782's toast that names the failure in its {0}", async () => {
    await expect(runAi(ctxFor(start([false], 'detail')), insightStep))
      .rejects.toThrow(`ch7-friday: the recommendation was not applied in full: "${DETAIL_FILLED}"`);
  });

  it('waits for a toast that lags the card, and fails on its line', async () => {
    await expect(runAi(ctxFor(start([false], 'lagging')), insightStep))
      .rejects.toThrow(`ch7-friday: the recommendation was not applied in full: "${en.insightRecommendationApplyFailed}"`);
  });

  it('logs why the outcome lines could not be read, and still fails', async () => {
    const logs = [];
    await expect(runAi(ctxFor(start([false], 'unreadable'), [], logs), insightStep))
      .rejects.toThrow('ch7-friday: the recommendation shows no applied status');
    expect(logs).toContain('INSIGHT status read failed: Target page, context or browser has been closed');
  });

  it('does not take another card\'s outcome line for this recommendation\'s', async () => {
    await expect(runAi(ctxFor(start([false], 'elsewhere')), insightStep))
      .rejects.toThrow('ch7-friday: the recommendation shows no applied status');
  });
});
