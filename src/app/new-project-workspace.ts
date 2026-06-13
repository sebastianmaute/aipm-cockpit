import { emptyWorkspace, type Workspace } from "./workspace";
import { applyTemplate } from "./template-apply";
import type { ProjectTemplate } from "./templates";
import type { ProjectMeta } from "./types";
import type { FeatureModuleId } from "./feature-modules";

export interface NewProjectOpts {
  template?: ProjectTemplate;
  features?: readonly FeatureModuleId[];
  includeSeed?: boolean;
  /** Routing discriminator only: when "turso" the host create handler routes to
   *  the Turso backend regardless of the global portfolio mode. Ignored by
   *  buildNewProjectWorkspace (it has no effect on the assembled Workspace). */
  storage?: "file" | "turso";
}

/** Assemble a new project's Workspace: base + meta, optionally apply a template
 *  (field-visibility + optional seed), then set per-project features if configured.
 *
 *  When `opts` is empty this reproduces today's create behavior exactly:
 *  `{ ...emptyWorkspace(), project: meta }` with no field-visibility override
 *  (undefined) and no features override (undefined). */
export function buildNewProjectWorkspace(meta: ProjectMeta, opts: NewProjectOpts): Workspace {
  let ws: Workspace = { ...emptyWorkspace(), project: meta };
  if (opts.template) ws = applyTemplate(ws, opts.template, { includeSeed: !!opts.includeSeed });
  if (opts.features !== undefined) ws = { ...ws, features: opts.features };
  return ws;
}
