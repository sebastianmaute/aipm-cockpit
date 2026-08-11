// src/app/use-action-center-handlers.ts
//
// The Action-Center CTA handler cluster (assign-owner, create-task, mark-done,
// clear-blocker, draft-message, escalate, rebaseline, reschedule), extracted
// from task-manager as a hook factory. Follows the use-storage-file-ops
// pattern: called unconditionally with the live closure values via a typed
// `deps` object; the inline `useCallback`/`useMemo` below preserve the exact
// memoization the handlers had inline. Move-only — the bodies are verbatim.
//
// Ordering note: `handleDraftMessageFromAction` reads `onSendInquiry` (produced
// by `useTaskRowHandlers`), so this hook is called AFTER that one in
// task-manager. The pre-existing early handlers (assign/create/mark/clear) are
// only consumed later in the ActionHandlers bundle, so moving them down here is
// behavior-preserving.
import { type Dispatch, type SetStateAction, type MutableRefObject, useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import type { Resource, Task, RaidItem, Milestone, ProjectMeta, Stakeholder } from "./types";
import type { SuggestedAction } from "./next-actions";
import type { OutcomeType } from "./action-learning";
import type { AssignOwnerBundle } from "./action-cta-controls";
import type { EscalateBundle } from "./escalate-popover";
import type { RebaselineBundle } from "./rebaseline-popover";
import type { RescheduleBundle } from "./reschedule-popover";
import { applyOwnerAssignment } from "./action-assign-owner";
import { applyStatusChange } from "./task-status";
import { buildTaskSeedFromAction } from "./action-task-seed";
import { emptyForm } from "./task-form-context";
import { resolveDraftRecipient, buildMailtoUrl } from "./mailto";
import { isValidEmail } from "./sanitize";
import { htmlToPlainText } from "./html-to-text";
import { renderTemplate, buildStakeholderUpdateVars, type CommTemplateCategory } from "./comm-templates";
import { sanitizeRichHtml } from "./sanitize-html";
import { plainTextToHtml } from "./comm-send";
import { planEscalation, applyEscalation, buildEscalationMail } from "./action-escalate";
import { applyMilestoneRebaseline, isValidIsoDate } from "./action-rebaseline";

/** Live render-scope values the Action-Center handlers read each render. */
export interface ActionCenterHandlerDeps {
  isPopout: boolean;
  lang: Lang;
  today: string;
  resources: readonly Resource[];
  tasks: readonly Task[];
  stakeholders: readonly Stakeholder[];
  raid: readonly RaidItem[];
  milestones: readonly Milestone[];
  project: ProjectMeta | undefined;
  trendsActive: boolean;
  snapshots: { rebaselineNow: () => Promise<void> | void; busy: boolean };
  commSend: { send: (msg: { to: string; subject: string; html: string; plain: string }) => void };
  onSendInquiry: (task: Task) => void;
  resolveCommBody: (category: CommTemplateCategory) => string | null;
  handleCreateResource: (name: string, email: string) => number;
  handleCancelEdit: () => void;
  setForm: Dispatch<SetStateAction<ReturnType<typeof emptyForm>>>;
  setTaskModalOpen: Dispatch<SetStateAction<boolean>>;
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  setMilestones: Dispatch<SetStateAction<readonly Milestone[]>>;
  pendingLinkRaidIdRef: MutableRefObject<number | null>;
  recordLearning: (action: SuggestedAction, type: OutcomeType) => Promise<void>;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useActionCenterHandlers(deps: ActionCenterHandlerDeps) {
  const {
    isPopout,
    lang,
    today,
    resources,
    tasks,
    stakeholders,
    raid,
    milestones,
    project,
    trendsActive,
    snapshots,
    commSend,
    onSendInquiry,
    resolveCommBody,
    handleCreateResource,
    handleCancelEdit,
    setForm,
    setTaskModalOpen,
    setTasks,
    setRaid,
    setMilestones,
    pendingLinkRaidIdRef,
    recordLearning,
    showToast,
  } = deps;

  const assignOwnerBundle = useMemo<AssignOwnerBundle | undefined>(
    () =>
      isPopout
        ? undefined
        : {
            resources,
            onCreateResource: handleCreateResource,
            onAssign: (
              action: SuggestedAction,
              v: { name: string; email: string; resourceId: number | null },
            ) => {
              if (action.cta.kind !== "open") return;
              const id = Number(action.cta.id);
              if (action.cta.view === "open-points") {
                setTasks((prev) => prev.map((tk) =>
                  tk.id === id
                    ? { ...tk, assignee: v.name, assigneeEmail: v.email, resourceId: v.resourceId ?? undefined }
                    : tk));
                void recordLearning(action, "acted");
                showToast("info", t(lang, "actionOwnerAssigned", id));
                return;
              }
              const next = applyOwnerAssignment(raid, id, v);
              if (next === raid) return; // no matching item → no write, no toast
              setRaid(next as RaidItem[]);
              void recordLearning(action, "acted");
              showToast("info", t(lang, "actionOwnerAssigned", id));
            },
          },
    [isPopout, resources, handleCreateResource, raid, setRaid, setTasks, showToast, lang, recordLearning],
  );

  const handleCreateTaskFromAction = useCallback(
    (action: SuggestedAction) => {
      void recordLearning(action, "acted");
      handleCancelEdit(); // reset editor (clears editingId, form, and the pending ref)
      const seed = buildTaskSeedFromAction(action, lang);
      setForm(() => ({ ...emptyForm(), taskName: seed.taskName, notes: seed.description }));
      pendingLinkRaidIdRef.current =
        action.source === "raid" && action.cta.kind === "open"
          ? Number(action.cta.id)
          : null;
      setTaskModalOpen(true);
    },
    [handleCancelEdit, lang, setForm, setTaskModalOpen, pendingLinkRaidIdRef, recordLearning],
  );

  const handleMarkDoneFromAction = useCallback((action: SuggestedAction) => {
    if (action.cta.kind !== "open" || action.cta.view !== "open-points") return;
    const id = Number(action.cta.id);
    setTasks((prev) => prev.map((tk) => (tk.id === id ? applyStatusChange(tk, "Done", today) : tk)));
    void recordLearning(action, "acted");
    showToast("info", t(lang, "actionTaskCompleted"));
  }, [setTasks, today, recordLearning, showToast, lang]);

  const handleClearBlockerFromAction = useCallback((action: SuggestedAction) => {
    if (action.cta.kind !== "open" || action.cta.view !== "open-points") return;
    const id = Number(action.cta.id);
    setTasks((prev) => prev.map((tk) => (tk.id === id ? { ...tk, blockers: "" } : tk)));
    void recordLearning(action, "acted");
    showToast("info", t(lang, "actionBlockerCleared"));
  }, [setTasks, recordLearning, showToast, lang]);

  const handleDraftMessageFromAction = useCallback(
    (action: SuggestedAction) => {
      const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
      if (action.source === "task-due") {
        const task = tasks.find((t) => t.id === id);
        if (task) { onSendInquiry(task); void recordLearning(action, "acted"); }
        return;
      }
      if (action.source === "stakeholder-comms") {
        const sh = stakeholders.find((s) => s.id === id);
        if (!sh) return;
        const email = resolveDraftRecipient(
          sh,
          resources,
          () => window.prompt(t(lang, "promptEmail", sh.name), ""),
          isValidEmail,
          () => showToast("error", t(lang, "errorInvalidEmail")),
        );
        if (!email) return;
        const subject = t(lang, "commsEmailSubject", project?.name ?? "");
        const tplBody = resolveCommBody("stakeholder-update");
        const body = tplBody != null
          ? htmlToPlainText(renderTemplate(tplBody, "stakeholder-update", buildStakeholderUpdateVars(sh, project?.name ?? "")))
          : t(lang, "commsEmailBodyTemplate", sh.name);
        const html = tplBody != null
          ? sanitizeRichHtml(renderTemplate(tplBody, "stakeholder-update", buildStakeholderUpdateVars(sh, project?.name ?? "")))
          : plainTextToHtml(body);
        commSend.send({ to: email, subject, html, plain: body });
        void recordLearning(action, "acted");
      }
    },
    [tasks, onSendInquiry, stakeholders, resources, project, lang, resolveCommBody, commSend, recordLearning, showToast],
  );

  const handleEscalate = useCallback(
    (
      action: SuggestedAction,
      recipient: { name: string; email: string; resourceId: number | null },
    ) => {
      if (action.cta.kind !== "open") return;
      const id = Number(action.cta.id);
      const item = raid.find((r) => r.id === id);
      if (!item) return; // deleted-source safe
      if (!isValidEmail(recipient.email)) { showToast("error", t(lang, "errorInvalidEmail")); return; }
      const plan = planEscalation(item);
      if (plan.to) {
        const next = applyEscalation(raid, id, plan.to);
        if (next !== raid) setRaid(next as RaidItem[]);
      }
      const { subject, body } = buildEscalationMail(lang, item, plan, project?.name ?? "");
      window.location.href = buildMailtoUrl(recipient.email, subject, body);
      void recordLearning(action, "acted");
    },
    [raid, setRaid, lang, project, recordLearning, showToast],
  );

  const escalateBundle = useMemo<EscalateBundle | undefined>(
    () =>
      isPopout
        ? undefined
        : {
            resources,
            onCreateResource: handleCreateResource,
            raid,
            onEscalate: handleEscalate,
          },
    [isPopout, resources, handleCreateResource, raid, handleEscalate],
  );

  const handleRebaselineMilestone = useCallback(
    (action: SuggestedAction, id: number, newDate: string) => {
      if (!isValidIsoDate(newDate)) { showToast("error", t(lang, "errorInvalidDate")); return; }
      const next = applyMilestoneRebaseline(milestones, id, newDate);
      if (next !== milestones) {
        setMilestones(next as Milestone[]);
        void recordLearning(action, "acted");
      }
    },
    [milestones, setMilestones, lang, recordLearning, showToast],
  );

  const snapshotsRebaselineNow = snapshots.rebaselineNow;
  const handleRebaselineSnapshot = useCallback((action: SuggestedAction) => {
    void recordLearning(action, "acted");
    void snapshotsRebaselineNow();
  }, [snapshotsRebaselineNow, recordLearning]);

  const rebaselineBundle = useMemo<RebaselineBundle | undefined>(
    () =>
      isPopout
        ? undefined
        : {
            milestones,
            tasks,
            onRebaselineMilestone: handleRebaselineMilestone,
            snapshotActive: trendsActive,
            onRebaselineSnapshot: handleRebaselineSnapshot,
            busy: snapshots.busy,
          },
    [isPopout, milestones, tasks, handleRebaselineMilestone, handleRebaselineSnapshot, trendsActive, snapshots.busy],
  );

  const rescheduleBundle = useMemo<RescheduleBundle | undefined>(
    () =>
      isPopout
        ? undefined
        : {
            onReschedule: (action: SuggestedAction, isoDate: string) => {
              if (action.cta.kind !== "open" || action.cta.view !== "open-points" || !isValidIsoDate(isoDate)) return;
              const id = Number(action.cta.id);
              setTasks((prev) => prev.map((tk) => (tk.id === id ? { ...tk, dueDate: isoDate } : tk)));
              void recordLearning(action, "acted");
              showToast("info", t(lang, "actionRescheduled"));
            },
            currentDueDate: (action: SuggestedAction) => {
              if (action.cta.kind !== "open" || action.cta.view !== "open-points") return undefined;
              const id = Number(action.cta.id);
              return tasks.find((tk) => tk.id === id)?.dueDate || undefined;
            },
          },
    [isPopout, setTasks, tasks, recordLearning, showToast, lang],
  );

  return {
    assignOwnerBundle,
    handleCreateTaskFromAction,
    handleMarkDoneFromAction,
    handleClearBlockerFromAction,
    handleDraftMessageFromAction,
    escalateBundle,
    rebaselineBundle,
    rescheduleBundle,
  };
}
