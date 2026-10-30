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

const UNPROTECTED = aiPrivacyFor([]);
const getUnprotected = (): AiPrivacy => UNPROTECTED;

/** Stable, like the real getter, so a feature's callbacks and effects do not churn on it. */
export function useOpenProjectAiPrivacy(): () => AiPrivacy {
  return getUnprotected;
}

// AI people protection, Task 5: the same "no project" answer for the people gates — never protected, so a
// feature's own tests see its people controls and tools. What protection does is pinned in
// `ai-people-gates.test.tsx` and `chat-tool-defs.people.test.ts`, under the real provider.
const notProtected = (): boolean => false;

export function useOpenProjectPeopleProtected(): () => boolean {
  return notProtected;
}

export function usePeopleProtected(): boolean {
  return false;
}
