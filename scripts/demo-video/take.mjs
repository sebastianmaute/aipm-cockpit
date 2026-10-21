// §715 demo recorder: one take of one video. Off camera, in the same page: connect Turso and the key,
// Explore the demo, seed the device state, replay the earlier days (chapters), run setup steps, check
// the preconditions. Then record: the opening caption, the steps, the closing beat. Every collaborator
// arrives in `deps`, so take.test.mjs drives it without a browser. A narrated take (`ctx.narration`) also
// returns its beats on the recording's timeline and the beats of its own file it never used. See README.md.
import { findSecrets } from './cli.mjs';
import { CLOSING, OPENING, TITLE } from './narration/beats.mjs';
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

/** The beat ids (of `ids`) an AI step shows: those it declares (`beats`) and those it names as a quoted literal. */
function beatsNamedBy(s, ids) {
  if (s.inner) return [...new Set([...beatsNamedBy(s.inner, ids), ...ids.filter((id) => s.beats?.includes(id))])];
  const src = [s.run, s.after, s.replay].filter(Boolean).map(String).join(' ');
  return ids.filter((id) => s.beats?.includes(id) || src.includes(`'${id}'`) || src.includes(`"${id}"`));
}

async function runStep(ctx, s, opts, mayNotShow) {
  for (const id of s.mayNotShow ?? []) mayNotShow.add(id);
  if (!s.ai) return s.run(ctx);
  if (opts.rehearse && !opts.withAi) {
    // A rehearsal makes no AI call: it only proves the trigger is there and usable. Its captions never show,
    // so their beats are not unused (a recorded take and a --with-ai rehearsal still count them).
    for (const id of beatsNamedBy(s, opts.ownBeatIds ?? [])) mayNotShow.add(id);
    // A trigger may navigate to its view first, so it is awaited.
    const trigger = s.trigger ? await s.trigger(ctx) : null;
    if (trigger && !(await trigger.isEnabled({ timeout: 30000 }).catch(() => false))) {
      throw new Error(`${ctx.clipId}: AI trigger ${s.id} is missing or not enabled`);
    }
    return;
  }
  return runAi(ctx, s);
}

/**
 * The take's narration, id -> { text, duration }, from the video's beats (id -> text). A recorded take needs
 * every beat's audio (`audio(text)` -> { duration } | null) and fails before it starts without it; a
 * rehearsal needs none, so its durations are null. A video without beats has no narration (null).
 */
export function takeNarration(def, beats, { rehearse, audio }) {
  if (!beats.size) return null;
  const narration = new Map();
  for (const [id, text] of beats) {
    if (rehearse) {
      narration.set(id, { text, duration: null });
      continue;
    }
    const a = audio(text);
    if (!a) throw new Error(`no audio for beat ${id} — run narrate.mjs --video ${def.id}`);
    narration.set(id, { text, duration: a.duration });
  }
  return narration;
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
  // Beat ids the steps that ran declared they may not show (step.mjs `mayNotShow`), plus the setup's own when
  // it ran on camera: exempt from the unused-beat failure and warning.
  const mayNotShow = new Set();
  const start = async () => {
    // From here on, captions are on camera: a narrated one is checked against its beat (ui.mjs).
    ctx.onCamera = true;
    if (!recording) return;
    await ctx.page.screencast.start({ path: opts.outFile, size: { width: 1280, height: 720 } });
    started = true;
    // The AI waits are timed from here (ai-wait.mjs), so the take can trim them (trim.mjs).
    ctx.recordingStartedAt = performance.now();
    ctx.aiWaits = [];
    if (ctx.narration) ctx.beatLog = [];
  };
  const openDemo = async () => {
    await setup.exploreDemo(ctx);
    await setup.seedDeviceState(ctx, await setup.currentProjectId(ctx));
    await setup.enableDigest(ctx);
    await setup.enableChat(ctx);
  };
  // The title first (3 s), then the opening line when it says more than the title (a chapter's is its title).
  const intro = async (opening) => {
    await ui.titleCard(ctx, def.title, TITLE);
    if (opening && opening !== def.title) await ui.caption(ctx, opening, OPENING);
  };
  // The beats of the video's own file (`opts.ownBeatIds`) that no caption or voice-only beat used: one
  // warning each, and they fail a recorded take (a rehearsal only reports them). The big video's chapter
  // beats are not its own, so a chapter beat it never shows is fine. A beat the steps that ran declare they
  // may not show (`mayNotShow`) is neither a warning nor a failure.
  const narrationResult = (status) => {
    if (!ctx.narration) return {};
    warnings += ctx.narrationMissing ?? 0;
    const out = recording && started ? { beats: ctx.beatLog } : {};
    if (status !== 'ok') return out;
    const unusedBeats = (opts.ownBeatIds ?? []).filter((id) => !ctx.beatsUsed?.has(id) && !mayNotShow.has(id));
    for (const id of unusedBeats) ctx.log(`NARRATION unused ${id}`);
    warnings += unusedBeats.length;
    return { ...out, unusedBeats };
  };
  const result = (status, extra = {}) => {
    const narration = narrationResult(status);
    if (recording && narration.unusedBeats?.length) {
      status = 'failed';
      extra = { ...extra, error: `narration beats never shown: ${narration.unusedBeats.join(', ')}` };
    }
    if (findSecrets(ctx.lines.join('\n'), opts.secrets ?? []) > 0) warnings++;
    return { status, warnings, ...(recording && started ? { file: opts.outFile, aiWaits: ctx.aiWaits } : {}), ...narration, ...extra };
  };

  try {
    if (def.prologueOnCamera) {
      await start();
      // Review and the optional Jira step show on the first-run walk-through only.
      if (def.firstRun) for (const id of setup.MAY_NOT_SHOW ?? []) mayNotShow.add(id);
      await intro(await resolveOpening(ctx, def.opening));
      await setup.connect(ctx, def.firstRun ? { onCamera: true, firstRun: true } : { onCamera: true });
      for (const s of def.prologue ?? []) await runStep(ctx, s, opts, mayNotShow);
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
      await intro(opening);
    }
    for (const s of def.steps.filter((x) => !x.setup)) await runStep(ctx, s, opts, mayNotShow);
    await ui.closingBeat(ctx, CLOSING);
    return result('ok');
  } catch (e) {
    // The first lines of a Playwright error name the locator and what it waited for.
    ctx.log(`FAILED ${def.id}: ${String(e?.message ?? e).split('\n').slice(0, 6).join(' | ')}`);
    return result('failed', { error: String(e?.message ?? e).split('\n')[0] });
  } finally {
    if (started) await ctx.page.screencast.stop();
  }
}
