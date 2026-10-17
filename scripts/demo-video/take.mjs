// §715 demo recorder: one take of one video. Off camera, in the same page: connect Turso and the key,
// Explore the demo, seed the device state, replay the earlier days (chapters), run setup steps, check
// the preconditions. Then record: the opening caption, the steps, the closing beat. Every collaborator
// arrives in `deps`, so take.test.mjs drives it without a browser. See README.md.
import { findSecrets } from './cli.mjs';
import { DAYS } from './steps/week.mjs';

export { waitForAi } from './ai-wait.mjs';

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** An AI step: run, then check the structure of its result; an empty structure gets one more call. */
async function runAi(ctx, s) {
  await s.run(ctx);
  if (s.check && (await s.check(ctx)) !== null) {
    await s.run(ctx);
    const missing = await s.check(ctx);
    if (missing !== null) throw new Error(`${ctx.clipId}: AI step ${s.id} returned ${missing} twice`);
  }
  // Runs only after a result that passed its check (e.g. closing the panel that showed it).
  if (s.after) await s.after(ctx);
}

async function runStep(ctx, s, opts) {
  if (!s.ai) return s.run(ctx);
  if (opts.rehearse && !opts.withAi) {
    // A rehearsal makes no AI call: it only proves the trigger is there and usable.
    // A trigger may navigate to its view first, so it is awaited.
    const trigger = s.trigger ? await s.trigger(ctx) : null;
    if (trigger && !(await trigger.isEnabled({ timeout: 30000 }).catch(() => false))) {
      throw new Error(`${ctx.clipId}: AI trigger ${s.id} is missing or not enabled`);
    }
    return;
  }
  return runAi(ctx, s);
}

/** Replays the days before a chapter, off camera: manual steps run, AI steps apply their fixed outcome. */
async function replayDays(ctx, def, deps) {
  const days = deps.days ?? DAYS;
  for (const day of WEEK.slice(0, WEEK.indexOf(def.replayThrough) + 1)) {
    await deps.setup.goToDay(ctx, day);
    for (const s of days[day] ?? []) await (s.replay ?? s.run)(ctx);
    if (deps.afterDay) await deps.afterDay(ctx, day);
  }
}

export async function runTake(def, deps) {
  const { ctx, setup, ui, opts } = deps;
  const resolveOpening = deps.resolveOpening ?? (async (_c, o) => o);
  const recording = !opts.rehearse;
  let warnings = 0;
  let started = false;
  const start = async () => {
    if (!recording) return;
    await ctx.page.screencast.start({ path: opts.outFile, size: { width: 1280, height: 720 } });
    started = true;
  };
  const openDemo = async () => {
    await setup.exploreDemo(ctx);
    await setup.seedDeviceState(ctx, await setup.currentProjectId(ctx));
    await setup.enableDigest(ctx);
    await setup.enableChat(ctx);
  };
  const result = (status, extra = {}) => {
    if (findSecrets(ctx.lines.join('\n'), opts.secrets ?? []) > 0) warnings++;
    return { status, warnings, ...(recording && started ? { file: opts.outFile } : {}), ...extra };
  };

  try {
    if (def.prologueOnCamera) {
      await start();
      await ui.caption(ctx, await resolveOpening(ctx, def.opening));
      await setup.connect(ctx, { onCamera: true });
      for (const s of def.prologue ?? []) await runStep(ctx, s, opts);
      await openDemo();
    } else {
      await setup.connect(ctx, { onCamera: false });
      await openDemo();
      if (def.replayThrough) {
        await replayDays(ctx, def, deps);
        await setup.goToDay(ctx, def.clock);
      }
    }
    for (const s of def.steps.filter((x) => x.setup)) await s.run(ctx);
    const missing = [];
    for (const p of def.preconditions) if (!(await p.check(ctx))) missing.push(p.what);
    if (missing.length) return result('skipped', { missing });
    if (!def.prologueOnCamera) {
      // Resolved off camera: a banner opening navigates to its view, which the recording then opens on.
      const opening = await resolveOpening(ctx, def.opening);
      await start();
      await ui.caption(ctx, opening);
    }
    for (const s of def.steps.filter((x) => !x.setup)) await runStep(ctx, s, opts);
    await ui.closingBeat(ctx, def.title);
    return result('ok');
  } catch (e) {
    // The first lines of a Playwright error name the locator and what it waited for.
    ctx.log(`FAILED ${def.id}: ${String(e?.message ?? e).split('\n').slice(0, 6).join(' | ')}`);
    return result('failed', { error: String(e?.message ?? e).split('\n')[0] });
  } finally {
    if (started) await ctx.page.screencast.stop();
  }
}
