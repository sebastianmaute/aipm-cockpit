import { emptyWorkspace, type Workspace } from "./workspace";
import { applyTemplate, appendSeed, remapSeed } from "./template-apply";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { ProjectMeta } from "./types";
import type { FeatureModuleId } from "./feature-modules";
import { emailWriteRefusal, summarizeUnsafeEmailRecords } from "./sanitize";

export interface NewProjectOpts {
  template?: ProjectTemplate;
  features?: readonly FeatureModuleId[];
  includeSeed?: boolean;
  /** AI fast-path starter content. Applied only when no stored template is
   *  chosen (a template replaces it) and includeSeed is set. */
  aiSeed?: TemplateSeed;
  /** Routing discriminator only: when "turso" the host create handler routes to
   *  the Turso backend regardless of the global portfolio mode. Ignored by
   *  buildNewProjectWorkspace (it has no effect on the assembled Workspace). */
  storage?: "file" | "turso";
  /** A native workspace the user imported in the create wizard. When set it IS
   *  the new project's content: template, AI seed and features are ignored, and
   *  only the wizard's `meta` replaces the file's own project meta. */
  importedWorkspace?: Workspace;
}

/** Assemble a new project's Workspace: base + meta, optionally apply a template
 *  (field-visibility + optional seed), then set per-project features if configured.
 *
 *  When `opts` is empty this reproduces today's create behavior exactly:
 *  `{ ...emptyWorkspace(), project: meta }` with no field-visibility override
 *  (undefined) and no features override (undefined). */
export function buildNewProjectWorkspace(meta: ProjectMeta, opts: NewProjectOpts): Workspace {
  if (opts.importedWorkspace) return { ...opts.importedWorkspace, project: meta };
  let ws: Workspace = { ...emptyWorkspace(), project: meta };
  if (opts.template) {
    ws = applyTemplate(ws, opts.template, { includeSeed: !!opts.includeSeed });
  } else if (opts.aiSeed && opts.includeSeed) {
    ws = appendSeed(ws, remapSeed(ws, withoutUnsafeSeedEmails(opts.aiSeed)));
  }
  if (opts.features !== undefined) ws = { ...ws, features: opts.features };
  return ws;
}

/** ★★★ M5 — the AI seed INTRODUCES every value it carries, so under the batch's
 *  write rule each address is CHANGED, and one that is not write-safe
 *  (`emailWriteRefusal` against no stored value) is NOT stored: the field is left
 *  blank, exactly as ResourcePicker "+ Add" does (`creatableResourceEmail`).
 *  Stripped BEFORE `remapSeed`, so an unsafe address can never pick a link either.
 *  ★ A TEMPLATE seed never comes through here: it is a copy from a stored source,
 *  exempt by the copy-source rule, and stays notice-only (§533). */
function withoutUnsafeSeedEmails(seed: TemplateSeed): TemplateSeed {
  const isSafe = (v: string | undefined): boolean => v === undefined || emailWriteRefusal(v, undefined) === null;
  const out: TemplateSeed = { ...seed };
  if (seed.tasks) out.tasks = seed.tasks.map((r) => (isSafe(r.assigneeEmail) ? r : { ...r, assigneeEmail: "" }));
  if (seed.raid) out.raid = seed.raid.map((r) => (isSafe(r.ownerEmail) ? r : { ...r, ownerEmail: undefined }));
  if (seed.stakeholders) out.stakeholders = seed.stakeholders.map((r) => (isSafe(r.email) ? r : { ...r, email: undefined }));
  if (seed.resources) {
    out.resources = seed.resources.map((r) => {
      const emails = r.emails?.filter((e) => isSafe(e));
      if (isSafe(r.email) && emails?.length === r.emails?.length) return r;
      return { ...r, email: isSafe(r.email) ? r.email : undefined, ...(emails ? { emails } : {}) };
    });
  }
  return out;
}

/** The notice for an AI seed (M5): the records whose address the seed introduced
 *  unsafely, which `buildNewProjectWorkspace` therefore left blank — judged on
 *  the seed as supplied, since the built workspace no longer holds the address.
 *  Null when the AI seed is not applied (no `includeSeed`, or a template replaces it). */
export function aiSeedUnsafeEmails(opts: NewProjectOpts): { count: number; names: string } | null {
  return !opts.template && opts.aiSeed && opts.includeSeed ? summarizeUnsafeEmailRecords(opts.aiSeed) : null;
}
