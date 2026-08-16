// RENDER LAYER for ActivityEntry → model-facing English lines.
//
// ★★ This file may import `t`; `history-search.ts` may NOT. That split is what
//    keeps AGENTS.md's "engines stay i18n-free" rule intact while letting the
//    model read the same EN message the Activity panel renders.
//    `insight-text.ts` carries the same render-layer classification for the
//    same reason.
//
// ★★ THE SUMMARY MATCHES THE PANEL'S WORDING; THE DETAIL DELIBERATELY DOES NOT.
//    `activity-log-panel.tsx` labels a diff row with `humanizeFieldName(field)`
//    because a human reads it. This layer emits the RAW entity field key,
//    because the model WRITES with those exact names — they are the field
//    names in the tool schemas, so `dueDate` is actionable to it.
//    ★★ `humanizeFieldName` is LOSSY and would have to be reversed by the
//    model: it splits camelCase AND lowercases, so `dueDate` renders as
//    "due date" (lowercase — `activity-log.ts`, pinned by a test in
//    `activity-log.test.ts`). That destroys the casing a tool call needs and
//    is not uniquely invertible — "due date" could be `dueDate` or `due_date`.
//    Do NOT "align" the two renderers.
//
// ★★ Always "en-US", never the user's language: the model-facing view must not
//    change when the UI switches to German. The EN dict is static (only DE is
//    lazily loaded), so no loadI18n call is needed.
//
// ★★★ Rendering goes through `activityMessageKey`, NEVER a bare
//     ACTIVITY_KIND_TO_KEY[kind] index. `sanitizeActivityEntry` deliberately
//     KEEPS an unrecognised string kind (forward-compat with newer releases),
//     so kind: "toString" reaches here — and a bare index resolves it to a
//     Function.prototype method, after which t() throws on undefined.replace
//     and takes the app down through the top-level ErrorBoundary.
import {
  type ActivityEntry,
  MAX_FIELD_CHANGES,
  activityMessageKey,
} from "./activity-log";
import { t } from "./i18n";

export interface RenderedActivity {
  /** The entry's ISO timestamp, verbatim. */
  at: string;
  /** English message with positional args interpolated. */
  summary: string;
  /** Field-diff suffix; omitted when the entry carries no changes. */
  detail?: string;
}

export function renderActivityEntry(entry: ActivityEntry): RenderedActivity {
  const key = activityMessageKey(entry.kind);
  const summary = key
    ? t("en-US", key, ...entry.args)
    : t("en-US", "activityUnknownKind", entry.kind);

  const changes = entry.changes ?? [];
  if (changes.length === 0) return { at: entry.timestamp, summary };

  // ★ `||`, not `??`, mirroring the panel's `c.from || "—"`: the EMPTY STRING
  //   is the case being caught (a field set from blank), and `??` passes it
  //   through — leaving `status:  → Done`, which reads to a model as though
  //   the renderer dropped a value rather than the value having been blank.
  const detail = changes
    .slice(0, MAX_FIELD_CHANGES)
    .map((c) => `${c.field}: ${c.from || "—"} → ${c.to || "—"}`)
    .join("; ");
  return { at: entry.timestamp, summary, detail };
}
