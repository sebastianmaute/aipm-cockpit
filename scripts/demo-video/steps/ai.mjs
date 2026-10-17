// §715 demo recorder: the steps of the 15 AI clips (A's spec, tier 3). A clip reuses the week's step
// object where it shows the same action (dedup, the digest, the wizard's proposal). See ../README.md.
import { step } from './step.mjs';
import { dedup, digestGenerate, wizardProposal } from './week.mjs';

export const AI_STEPS = Object.freeze({
  'ai-proposal': [wizardProposal],
  'ai-chat': [step('chat-question', { ai: true }), step('chat-create-task', { ai: true }), step('chat-task-in-open-points')],
  'ai-dedup': [step('open-points'), dedup],
  'ai-wbs': [step('wbs-optimize', { ai: true })],
  'ai-inline-task': [step('inline-task-description', { ai: true })],
  'ai-inline-entity': [step('inline-raid-mitigation', { ai: true })],
  'ai-next-actions': [step('next-actions-analyze', { ai: true })],
  'ai-insight': [step('insight-recommend', { ai: true })],
  'ai-digest': [digestGenerate],
  'ai-alloc': [step('alloc-plan', { ai: true })],
  'ai-raci': [step('raci-suggest', { ai: true })],
  'ai-steering': [step('steering-report', { ai: true })],
  'ai-forecast-import': [step('forecast-import-clip', { ai: true })],
  'ai-weights': [step('weights-history', { setup: true }), step('weights-suggest', { ai: true })],
  'ai-scheduled': [step('scheduled-job', { setup: true }), step('scheduled-run', { ai: true })],
});
