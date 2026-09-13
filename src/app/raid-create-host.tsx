"use client";

// "Log as RAID" host (§515). ONE floating RaidEditModal over whatever view is
// active, fed by next actions (and, from the insights slice, by insights).
// ★ The draft lives HERE, not in the RAID panel: that panel is mounted
//   unconditionally and never remounts, so a create request routed through it
//   would need an explicit consume/clear. Owning the draft beside the modal
//   removes the request channel entirely.
// ★★ Save passes the create INTENT (`isNew = true`) so a row a concurrent writer
//   committed under the open-time id is never replaced, and every on-saved
//   effect uses the id the save RETURNS — re-minted in exactly that case.

import { useCallback, useState } from "react";
import { type Lang, t } from "./i18n";
import { RaidEditModal } from "./raid-edit-modal";
import { applyMatrix, applyStatus, buildNewRaidDraft, buildRaidSeedFromSignal } from "./raid-draft";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import type { SuggestedAction } from "./next-actions";
import type { Insight } from "./insights/insight";
import { insightDetail, insightTitle } from "./insights/insight-text";
import type { OutcomeType } from "./action-learning";
import type { RaidItem, RaidStatus, Resource, RiskScale, Stakeholder, Task } from "./types";
import type { Contact } from "./contacts";

export type RaidCreateOrigin =
  | { kind: "insight"; insightId: number }
  | { kind: "action"; action: SuggestedAction };

export interface RaidCreateRequest {
  draft: RaidItem;
  origin: RaidCreateOrigin;
}

export interface RaidCreateDeps {
  isPopout: boolean;
  lang: Lang;
  today: string;
  raid: readonly RaidItem[];
  handleSaveRaidItem: (item: RaidItem, isNew?: boolean) => number | undefined;
  recordLearning: (action: SuggestedAction, type: OutcomeType) => Promise<void>;
  /** Insight on-saved writer: acted + actedAt + loggedRaidId (task-manager). */
  onInsightLogged: (insightId: number, raidId: number) => void;
}

export interface RaidCreateController {
  request: RaidCreateRequest | null;
  /** Undefined in popouts — every action CTA is. */
  openFromAction: ((action: SuggestedAction) => void) | undefined;
  openFromInsight: ((insight: Insight) => void) | undefined;
  setDraft: (next: RaidItem) => void;
  applyDraftStatus: (status: RaidStatus) => void;
  applyDraftMatrix: (probability: RiskScale, impact: RiskScale) => void;
  commit: (item: RaidItem) => void;
  cancel: () => void;
}

export function useRaidCreate(deps: RaidCreateDeps): RaidCreateController {
  const { isPopout, lang, today, raid, handleSaveRaidItem, recordLearning, onInsightLogged } = deps;
  const [request, setRequest] = useState<RaidCreateRequest | null>(null);

  const open = useCallback(
    (seed: { title: string; description: string }, origin: RaidCreateOrigin) => {
      const base = buildNewRaidDraft(raid, "R", today);
      setRequest({ draft: { ...base, title: seed.title, description: seed.description }, origin });
    },
    [raid, today],
  );

  const openFromAction = useCallback(
    (action: SuggestedAction) => {
      open(
        buildRaidSeedFromSignal({
          title: t(lang, action.title.key, ...(action.title.params ?? [])),
          note: t(
            lang,
            "actionCreatedFromNote",
            t(lang, ACTION_SOURCE_LABEL[action.source]),
            t(lang, action.why.key, ...(action.why.params ?? [])),
          ),
        }),
        { kind: "action", action },
      );
    },
    [open, lang],
  );

  const openFromInsight = useCallback(
    (insight: Insight) => {
      open(
        buildRaidSeedFromSignal({
          title: insightTitle(insight, lang),
          note: t(lang, "actionCreatedFromNote", t(lang, "insightsCardTitle"), insightDetail(insight, lang)),
        }),
        { kind: "insight", insightId: insight.id },
      );
    },
    [open, lang],
  );

  const setDraft = useCallback((next: RaidItem) => {
    setRequest((r) => (r ? { ...r, draft: next } : r));
  }, []);
  const applyDraftStatus = useCallback(
    (status: RaidStatus) => setRequest((r) => (r ? { ...r, draft: applyStatus(r.draft, status, today) } : r)),
    [today],
  );
  const applyDraftMatrix = useCallback(
    (probability: RiskScale, impact: RiskScale) =>
      setRequest((r) => (r ? { ...r, draft: applyMatrix(r.draft, probability, impact) } : r)),
    [],
  );
  const cancel = useCallback(() => setRequest(null), []);

  const commit = useCallback(
    (item: RaidItem) => {
      if (!request || !item.title.trim()) return;
      const id = handleSaveRaidItem(item, true);
      // Defensive only: the host receives the UNGUARDED `handleSaveRaidItem`, and a create
      // never returns undefined (the editVanished refusal needs !create). Read-only
      // protection is structural — popouts never mount the host and get no openers.
      if (id === undefined) return;
      // ★★ `id` is the COMMITTED id — never `request.draft.id`, which is stale
      //   whenever the save re-minted (the id-mint race).
      if (request.origin.kind === "insight") onInsightLogged(request.origin.insightId, id);
      else void recordLearning(request.origin.action, "acted");
      setRequest(null);
    },
    [request, handleSaveRaidItem, recordLearning, onInsightLogged],
  );

  return {
    request,
    openFromAction: isPopout ? undefined : openFromAction,
    openFromInsight: isPopout ? undefined : openFromInsight,
    setDraft,
    applyDraftStatus,
    applyDraftMatrix,
    commit,
    cancel,
  };
}

const NOOP = (): void => undefined;

export interface RaidCreateHostProps {
  create: RaidCreateController;
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  stakeholdersEnabled: boolean;
  stakeholders: readonly Stakeholder[];
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
  /** Deep-link to an existing RAID item; the host closes first (no side effects). */
  onJumpToRaid: (id: number) => void;
}

export function RaidCreateHost({
  create,
  lang,
  tasks,
  raid,
  stakeholdersEnabled,
  stakeholders,
  resources,
  contacts,
  onCreateResource,
  onJumpToRaid,
}: RaidCreateHostProps) {
  const { request } = create;
  if (!request) return null;
  return (
    <RaidEditModal
      lang={lang}
      tasks={tasks}
      raid={raid}
      stakeholdersEnabled={stakeholdersEnabled}
      stakeholders={stakeholders}
      resources={resources}
      contacts={contacts}
      onCreateResource={onCreateResource}
      draft={request.draft}
      isNew
      onChange={create.setDraft}
      onApplyStatus={create.applyDraftStatus}
      onApplyMatrix={create.applyDraftMatrix}
      onSave={create.commit}
      onCancel={create.cancel}
      // A new draft has nothing to delete and no saved id to spawn a task from;
      // the modal disables both controls while `isNew`.
      onDelete={NOOP}
      onCreateMitigationTask={NOOP}
      onJumpToRaid={(id) => {
        create.cancel();
        onJumpToRaid(id);
      }}
    />
  );
}
