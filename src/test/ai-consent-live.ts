// Side-effect import for tests that drive a request path directly (callClaude, runForcedToolCall and their
// callers) with no settings provider: publishes AI switched on with a current interactive AND background consent,
// as `useSettings` would, so the consent gate (ai-consent.ts) lets a request of either level reach the mocked
// fetch. A test of the gate itself publishes its own state instead and does not import this.
import { newConsent, publishAiConsentState } from "../app/ai-consent";
import { defaultAiConfig } from "../app/settings-types";

publishAiConsentState({
  ...defaultAiConfig,
  enabled: true,
  consent: newConsent(new Date(0)),
  backgroundConsent: newConsent(new Date(0)),
});
