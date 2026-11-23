// src/app/activity-summary-kinds.ts — which activity kinds could have written a stored English summary.
//
// A chat saved before the history search left withheld fields out keeps each event as {at, summary, detail}, with no
// activity kind. The old-chat clean-up (`chat-threads.ts`) needs the event's entity to drop only the fields withheld
// for it, so it asks which kinds' English templates the summary could have come from. Each template (and its "One"
// plural sibling) becomes a regex: its literal text, with every placeholder as a wildcard, matched from the start (a
// trailing " — detail" is allowed). ★ The answer may name kinds that did NOT write it (a template such as "{0} …"
// matches widely); that only widens what is dropped. It must never miss the kind that did: the test renders every
// kind's summary and checks it is matched. An empty answer means "unknown", and the caller drops as before.
import { ACTIVITY_KIND_TO_KEY, type ActivityKind } from "./activity-log";
import { t, type TranslationKey } from "./i18n";

const SLOT_MARK = String.fromCharCode(1);
const SLOTS = Array.from({ length: 16 }, (_, i) => `${SLOT_MARK}${i}${SLOT_MARK}`);
const SLOT = new RegExp(`${SLOT_MARK}\\d+${SLOT_MARK}`);
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function templateRegExp(key: TranslationKey): RegExp | null {
  if (typeof t("en-US", key) !== "string") return null;
  const parts = t("en-US", key, ...SLOTS).split(SLOT).map(escapeRegExp);
  return new RegExp(`^${parts.join("[\\s\\S]*?")}`);
}

let matchers: readonly [ActivityKind, readonly RegExp[]][] | null = null;

function allMatchers(): readonly [ActivityKind, readonly RegExp[]][] {
  matchers ??= (Object.entries(ACTIVITY_KIND_TO_KEY) as [ActivityKind, TranslationKey][]).map(([kind, key]) => [
    kind,
    [templateRegExp(key), templateRegExp(`${key}One` as TranslationKey)].filter((r): r is RegExp => r !== null),
  ]);
  return matchers;
}

/** Every activity kind whose English summary template could have produced `summary`; empty when none could. */
export function kindsThatCouldWrite(summary: string): ActivityKind[] {
  return allMatchers().filter(([, res]) => res.some((re) => re.test(summary))).map(([kind]) => kind);
}
