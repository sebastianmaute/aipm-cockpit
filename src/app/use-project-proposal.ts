"use client";

// One-shot Anthropic call for the "Use AI" project-creation fast-path. Forces a
// single propose_project tool call and returns the parsed ProjectProposal. No
// agentic loop. Reuses the live in-memory API key (never logged).

import { AiPeopleProtectedContentError, aiPrivacyForNewProject } from "./ai-privacy";
import { useCallback, useState } from "react";
import { parseProposal, PROPOSAL_TOOL, buildProposalSystemPrompt, withoutProposalPeople, type ProjectProposal } from "./ai-project-proposal";
import { isPeopleProtected } from "./ai-people-protection";
import { type AttachmentBlock } from "./chat-attachments";
import { AiHttpError, aiTransportMessageKey, classifyAiError } from "./ai-errors";
import { runForcedToolCallWithRetry } from "./ai-forced-call";
import { useActionGuideText } from "./action-guides-context";
import { isAbortError } from "./abort-error";
import { browserTimeZone, todayInZone } from "./timezone";

/** The user-message content the proposal call accepts: a plain string (SP3) or
 *  a multimodal block array (text + PDF/image/text attachments) for SP-D. */
export type ProposalContent = string | Array<{ type: "text"; text: string } | AttachmentBlock>;

/** The error token when a forced people protection refused an image or non-text document (step0 names it). */
export const PROPOSAL_PEOPLE_PROTECTED_ERROR = "people-protected-content";

interface AiCreds {
  apiKey: string;
  model: string;
  /** IANA zone whose calendar day the prompt calls "today"; the browser's when omitted. */
  timeZone?: string;
}

export function useProjectProposal(ai: AiCreds) {
  // §701 — read here rather than taken from the caller: the wizard is this
  // hook's only caller and sits inside the root's guide provider.
  const guideText = useActionGuideText("projectProposal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (input: ProposalContent, signal?: AbortSignal): Promise<ProjectProposal | null> => {
      const key = ai.apiKey.trim();
      if (!key) {
        setError("no-key");
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        // Shared one-shot forced-tool envelope: never logs/echoes the key or body. A reply
        // cut at 4096 is asked for once more at 8192 (§764).
        const reply = await runForcedToolCallWithRetry({
          apiKey: key,
          // AI people protection (spec R3): the wizard creates a project, so no workspace and no
          // people exist yet: unprotected, unless the deployment forces protection — then protected with
          // no known people (patterns still redact; ai-privacy.sites.test.ts lists this exemption).
          privacy: aiPrivacyForNewProject(),
          model: ai.model,
          // The user's local day, computed the same way as the one the wizard stamps on the seed
          // (but at call start, so the two can differ across midnight); callback context — lint-safe.
          system: buildProposalSystemPrompt(todayInZone(new Date(), ai.timeZone ?? browserTimeZone())),
          guideText,
          tools: [PROPOSAL_TOOL],
          toolName: "propose_project",
          messages: [{ role: "user", content: input }],
          maxTokens: 4096,
          signal,
        }, 8192);
        // A reply cut at the retry budget too is never read: its input may be partial yet still parse.
        const parsed = reply.stopReason === "max_tokens" ? null : parseProposal(reply.input);
        if (!parsed) throw new Error("parse");
        // AI people protection (R4): the project this creates carries no override yet, so it protects its
        // people (P6) — the proposal reaches the wizard's review with no person in it.
        return withoutProposalPeople(parsed, isPeopleProtected(undefined));
      } catch (e) {
        if (signal?.aborted || isAbortError(e)) return null;
        if (e instanceof AiPeopleProtectedContentError) {
          setError(PROPOSAL_PEOPLE_PROTECTED_ERROR);
          return null;
        }
        if (e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit") {
          setError("limit");
          return null;
        }
        // A switched-off deployment or a refused gateway → its own message key (step0 renders it).
        setError(aiTransportMessageKey(e) ?? (e instanceof Error ? e.message : "error"));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [ai.apiKey, ai.model, ai.timeZone, guideText],
  );

  const reset = useCallback(() => setError(null), []);

  return { generate, busy, error, reset };
}
