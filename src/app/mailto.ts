// src/app/mailto.ts
// Pure mailto: helpers shared by the task status-inquiry flow and the
// stakeholder-comms draft. No React, no side effects.
import type { Resource } from "./types";

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Effective email for a stakeholder: their own, else the linked resource's, else undefined. */
export function stakeholderEmail(
  sh: { email?: string; resourceId?: number | null },
  resources: readonly Resource[],
): string | undefined {
  const direct = sh.email?.trim();
  if (direct) return direct;
  const linked = sh.resourceId != null ? resources.find((r) => r.id === sh.resourceId) : undefined;
  return linked?.email?.trim() || undefined;
}

/** Resolve the recipient email for a stakeholder draft: the stakeholder's
 *  effective email, else a prompted one (validated). Dependency-injected
 *  (prompt/isValid/onInvalid) so it is fully unit-testable. Returns null when
 *  no usable email (cancelled, empty, or invalid). */
export function resolveDraftRecipient(
  sh: { email?: string; resourceId?: number | null },
  resources: readonly Resource[],
  prompt: () => string | null,
  isValid: (email: string) => boolean,
  onInvalid?: () => void,
): string | null {
  const existing = stakeholderEmail(sh, resources);
  if (existing) return existing;
  const provided = prompt();
  if (provided === null) return null;        // cancelled
  const trimmed = provided.trim();
  if (!trimmed) return null;                  // empty
  if (!isValid(trimmed)) { onInvalid?.(); return null; }  // invalid → alert + abort
  return trimmed;
}
