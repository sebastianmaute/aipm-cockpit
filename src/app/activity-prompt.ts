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
  type ActivityActor,
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
  /** Who caused the entry. OMITTED — not defaulted — when the entry carries no
   *  actor, so a pre-B2b entry's rendered shape is byte-unchanged and costs the
   *  model nothing. ★★ Load-bearing rather than decoration: the kinds are the
   *  SAME for a user write and a model write, so without this a `search_history`
   *  result cannot tell the model its own edits from the user's, and it can read
   *  its own work back as new information and act on it twice. */
  actor?: ActivityActor;
  /** Field-diff suffix; omitted when the entry carries no changes. */
  detail?: string;
}

/** ★★★ A `Record<ActivityActor, …>`, NOT a string array, and that is the point:
 *  a member added to the union makes this object literal a TYPE ERROR, so the
 *  projection cannot silently start dropping a new actor. `hasOwnProperty`, never
 *  a bare index — `sanitizeActivityEntry` KEEPS an unknown-but-string actor, so
 *  `actor: "toString"` reaches here and a bare lookup resolves a
 *  Function.prototype method (the same trap `activityMessageKey` guards for
 *  `kind`, and `summarizeRecentActivity` for its own buckets). */
const KNOWN_ACTORS: Record<ActivityActor, true> = {
  user: true,
  ai: true,
  integration: true,
};

/**
 * An actor this release recognises, or `undefined`.
 *
 * ★★ AN UNRECOGNISED STRING IS OMITTED, NOT PASSED THROUGH, and the reason is
 *    agreement with the other surface rather than distrust of the value:
 *    `summarizeRecentActivity` already folds both the ABSENT and the
 *    unknown-but-string actor into its `unknown` bucket, so passing the raw
 *    string through here would let the recap and the read path describe the same
 *    entry differently. It also keeps this field a closed set of one-word values
 *    — it rides every one of up to MAX_HISTORY_LIMIT results.
 *
 * ★ STORAGE IS UNTOUCHED. The sanitizer still keeps the string and an older
 *   client's load+save round trip still preserves it; only the model-facing
 *   PROJECTION narrows. Do not read this as licence to drop it at rest.
 *
 * ★ Takes `unknown` deliberately: the declared type is the closed union, but the
 *   runtime value is whatever the sanitizer let through, and a parameter typed
 *   `ActivityActor` would make the guard below look redundant to a future reader.
 */
function knownActor(raw: unknown): ActivityActor | undefined {
  return typeof raw === "string" &&
    Object.prototype.hasOwnProperty.call(KNOWN_ACTORS, raw)
    ? (raw as ActivityActor)
    : undefined;
}

export function renderActivityEntry(entry: ActivityEntry): RenderedActivity {
  const key = activityMessageKey(entry.kind);
  const summary = key
    ? t("en-US", key, ...entry.args)
    : t("en-US", "activityUnknownKind", entry.kind);

  // ★ Conditional spread, mirroring `appendActivityEntry`: `{ actor }` with an
  //   undefined value puts an `actor: undefined` KEY on every rendered entry,
  //   which `toBeUndefined()` cannot tell from an omitted one.
  const actor = knownActor(entry.actor);
  const base: RenderedActivity = {
    at: entry.timestamp,
    summary,
    ...(actor ? { actor } : {}),
  };

  const changes = entry.changes ?? [];
  if (changes.length === 0) return base;

  // ★ `||`, not `??`, mirroring the panel's `c.from || "—"`: the EMPTY STRING
  //   is the case being caught (a field set from blank), and `??` passes it
  //   through — leaving `status:  → Done`, which reads to a model as though
  //   the renderer dropped a value rather than the value having been blank.
  const detail = changes
    .slice(0, MAX_FIELD_CHANGES)
    .map((c) => `${c.field}: ${c.from || "—"} → ${c.to || "—"}`)
    .join("; ");
  return { ...base, detail };
}
