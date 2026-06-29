// src/app/chat-models.ts
//
// Pure, i18n-free helpers for the AI model picker + API-key validation.
// `buildModelOptions` merges the live Anthropic /v1/models result onto the
// curated CHAT_MODELS registry (augment mode: show every live claude-* model,
// newest first, registry as the offline fallback). `isValidAnthropicApiKey` is
// a pure FORMAT check — empty-is-allowed policy lives in the caller.

export interface ModelOption {
  id: string;
  label: string;
}

/** Subset of an Anthropic /v1/models entry we consume. */
export interface LiveModel {
  id: string;
  display_name?: string;
  created_at?: string;
}

function createdAtMs(m: LiveModel): number {
  const t = m.created_at ? Date.parse(m.created_at) : NaN;
  return Number.isNaN(t) ? -Infinity : t; // missing/invalid sort last
}

/** Build the dropdown option list. Live claude-* models (newest first) when
 *  present, else the registry; the current selection is always included. */
export function buildModelOptions(
  registry: ReadonlyArray<{ id: string; label: string }>,
  liveModels: readonly LiveModel[],
  currentId: string,
): ModelOption[] {
  const claude = liveModels.filter((m) => m.id.startsWith("claude-"));
  const base: ModelOption[] =
    claude.length > 0
      ? [...claude]
          .sort((a, b) => createdAtMs(b) - createdAtMs(a) || a.id.localeCompare(b.id))
          .map((m) => ({ id: m.id, label: m.display_name || m.id }))
      : registry.map((r) => ({ id: r.id, label: r.label }));

  const seen = new Set<string>();
  const out: ModelOption[] = [];
  // Ensure the current selection is present (prepended if the live list lacks it).
  if (currentId && !base.some((o) => o.id === currentId)) {
    const known = registry.find((r) => r.id === currentId);
    out.push({ id: currentId, label: known ? known.label : currentId });
    seen.add(currentId);
  }
  for (const o of base) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

/** FORMAT-only validity of an Anthropic API key (sk-ant-… + >=16 id chars). */
export function isValidAnthropicApiKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key.trim());
}
