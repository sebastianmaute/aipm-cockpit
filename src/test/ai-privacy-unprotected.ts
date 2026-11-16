// src/test/ai-privacy-unprotected.ts — a stand-in for `src/app/ai-privacy-context.tsx` in tests of a
// feature's own mechanics, which render the feature without task-manager's privacy provider. Outside
// the provider the real getter throws (fail closed), so such a test mocks the module with this:
//
//   vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
//
// It answers every request with the privacy of NO project (unprotected). What the privacy does to a
// request is pinned elsewhere: `ai-transport.privacy.test.ts`, `scheduled-job-privacy.test.tsx`,
// `chat-panel.people-protected.test.tsx`, and the site scan `ai-privacy.sites.test.ts`.
import { aiPrivacyFor, type AiPrivacy } from "../app/ai-privacy";
import { isRatesWithheld, isReviewAllWrites } from "../app/ai-project-switches";

const UNPROTECTED = aiPrivacyFor([]);
const getUnprotected = (): AiPrivacy => UNPROTECTED;

/** Stable, like the real getter, so a feature's callbacks and effects do not churn on it. */
export function useOpenProjectAiPrivacy(): () => AiPrivacy {
  return getUnprotected;
}

// AI people protection: the same "no project" answer for the people gates — never protected, so a
// feature's own tests see its people controls and tools. What protection does is pinned in
// `ai-people-gates.test.tsx` and `chat-tool-defs.people.test.ts`, under the real provider.
const notProtected = (): boolean => false;

export function useOpenProjectPeopleProtected(): () => boolean {
  return notProtected;
}

export function usePeopleProtected(): boolean {
  return false;
}

// §794: no project, so only the deployment lock (`ai-direct-writes`) can ask for every write to be reviewed.
// ★ Deliberately NOT the real getter's answer: with no project source registered the real
// `useOpenProjectReviewAllWrites` fails CLOSED (review every write). This stand-in serves feature tests of a lone
// write's own mechanics, so it answers like an open project that has not switched review on.
const noReview = (): boolean => isReviewAllWrites(undefined);

export function useOpenProjectReviewAllWrites(): () => boolean {
  return noReview;
}

// §804: no project, so only the deployment lock (`ai-rates`) can keep hourly rates out of a request.
// ★ Deliberately NOT the real getter's answer: with no project source registered the real
// `useOpenProjectRatesWithheld` fails CLOSED (withhold). This stand-in serves feature tests that need the rate in
// the request, so it answers like an open project that has not switched the rates switch on.
const noRatesWithheld = (): boolean => isRatesWithheld(undefined);

export function useOpenProjectRatesWithheld(): () => boolean {
  return noRatesWithheld;
}

// Final review F4: a scope that never moves, so a feature's own tests see every awaited write land.
const stillScope = (): number => 0;

export function useOpenProjectScopeEpoch(): () => number {
  return stillScope;
}
