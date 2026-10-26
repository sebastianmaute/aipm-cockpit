// Side-effect import for tests that drive a request path directly (callClaude, runForcedToolCall and their
// callers) with no settings provider: publishes a current interactive consent, as `useSettings` would, so the
// consent gate (ai-consent.ts) lets the request reach the mocked fetch. A test of the gate itself publishes its
// own state instead and does not import this.
import { newConsent, publishAiConsentState } from "../app/ai-consent";
import { defaultAiConfig } from "../app/settings-types";

publishAiConsentState({ ...defaultAiConfig, consent: newConsent(new Date(0)) });
