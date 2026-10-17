// §715 demo recorder: how a step is declared. A step is written once and the same object is reused by
// every video that shows it (a chapter, the big video, a clip). See ../README.md.
//
// Step = { id, caption?, ai?, setup?, trigger?, run(ctx), replay?(ctx), check?(ctx) }
// - ai:      makes a real Claude call; skipped by --rehearse unless --with-ai (its trigger is checked instead).
// - setup:   runs off camera, before the preconditions and before recording; never makes an AI call.
// - replay:  what a later chapter's off-camera replay does instead of `run`; an AI step's replay applies
//            a FIXED outcome by hand, so every chapter opens on the same state.
// - check:   after an AI step, the structure of its result (never its wording): null when fine, else
//            what is missing. An empty structure is retried once.

const notYet = (id) => async () => { throw new Error(`step ${id} not written yet`); };

/** A step whose `run` (and, for an AI step, `replay`) is a placeholder until its task writes it. */
export function step(id, opts = {}) {
  const s = { id, run: notYet(id), ...opts };
  if (s.ai && !s.replay) s.replay = notYet(`${id} (replay)`);
  return Object.freeze(s);
}
