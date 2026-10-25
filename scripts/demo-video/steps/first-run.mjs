// §715 the first-run chapter (ch2-connect): after the setup wizard, Claude proposes the first project and
// the wizard creates it; the empty project lands, then the take opens the demo. The big video keeps the
// short prologue (week.mjs `wizardProposal`), which cancels instead. See ../README.md.
import { step } from './step.mjs';
import { noteCreatedProject } from '../cleanup.mjs';
import * as L from '../lib.mjs';
import { caption, click, moveTo, pace, skipTour } from '../ui.mjs';
import { PROPOSAL, gdprBox, noop } from './week.mjs';

const DLG = '[role="dialog"]:visible';

/** Claude's proposal, then the wizard's last two steps explained, and Create project. */
export const wizardCreate = step('wizard-create', {
  ...PROPOSAL,
  after: async (ctx) => {
    const d = ctx.page.locator(DLG).last();
    await caption(ctx, 'From the brief, Claude ticks GDPR and fills the other key facts.', 'first-gdpr');
    await moveTo(ctx, gdprBox(d), 'GDPR');
    await pace(ctx, 2500);
    await click(ctx, d.getByRole('button', { name: 'Next', exact: true }), 'Next (template)', 500);
    await caption(ctx, 'Start from a template, or from empty.', 'first-template');
    // The wizard suggests a template; the chapter starts empty (its later beats say so), so it picks Blank
    // and, on the next step, unticks the starter content Claude's proposal would otherwise add.
    await click(ctx, d.getByRole('button', { name: /^Blank/ }), 'Blank', 1500);
    await click(ctx, d.getByRole('button', { name: 'Next', exact: true }), 'Next (functions)', 500);
    await caption(ctx, 'Turn on the features this project needs. The rest stay out of the way.', 'first-functions');
    await pace(ctx, 3000);
    const starter = d.getByRole('checkbox', { name: /starter content/ });
    if (await starter.count() && await starter.isChecked()) await click(ctx, starter, 'No starter content', 800);
    await click(ctx, d.getByRole('button', { name: 'Create project', exact: true }), 'Create project', 1000);
    await caption(ctx, '');
  },
  replay: noop,
});

/** The new project, before the take opens the demo. Its id is noted for the cleanup. */
export const firstProjectLands = step('first-project-lands', {
  run: async (ctx) => {
    // A rehearsal without --with-ai skips wizard-create (an AI step), so no project was made to land on:
    // the project check is skipped (and said so); the captions still show, so their beats are checked.
    if (ctx.rehearse && !ctx.withAi) {
      ctx.log('first-project-lands: project check skipped, wizard-create makes no project without --with-ai');
    } else {
      const page = ctx.page;
      await page.locator(DLG).filter({ has: page.getByRole('button', { name: 'Create project', exact: true }) })
        .waitFor({ state: 'detached', timeout: 60000 });
      await skipTour(ctx, 3000);
      await L.settle(page);
      const id = await page.evaluate(() => localStorage.getItem('aipm-cockpit:turso-current-project'));
      if (!id) throw new Error('no current project after Create project');
      noteCreatedProject(id);
    }
    await caption(ctx, 'The new project: created, connected, and ready to fill.', 'first-project-lands');
    await pace(ctx, 3500);
    await caption(ctx, 'To see a project in full swing, open the demo.', 'first-open-demo');
    await pace(ctx, 1500);
  },
});

export const FIRST_RUN = [wizardCreate, firstProjectLands];
