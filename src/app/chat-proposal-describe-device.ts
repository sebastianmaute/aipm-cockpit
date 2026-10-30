// src/app/chat-proposal-describe-device.ts — the review card's detail for a staged language, filter or
// device-settings change (AI-02).
//
// Pure, i18n-free. `set_language`, `set_filters` and an `update_settings` without `enabledModules` change
// this device's language, the task list's filters or its settings, not an entity, so the descriptor engine
// has nothing to diff. In an untrusted send they stage (`stagesWhenUntrusted`), so the card must say what
// each one does. Each change is read from the same input the write reads: `filtersFromInput` for the
// filters, the dispatcher's `previewSettings` for the settings.
import { carriesEnabledModules, type ProposedCall } from "./chat-proposal";
import { filtersFromInput, type Filters } from "./chat-tools";
import { previewedSettings, type PreviewSettings } from "./chat-proposal-describe-functions";

/** What a staged device or view write changes. */
export type DeviceChange =
  | { readonly kind: "language"; readonly language: string }
  | { readonly kind: "filters"; readonly filters: Filters }
  | { readonly kind: "settings"; readonly settings: readonly { readonly key: string; readonly value: string }[] };

/** The change a `set_language`, `set_filters` or device-only `update_settings` call makes, or null for any other
 *  call (an `update_settings` carrying `enabledModules` is described by `describeFunctionsCall`). */
export function describeDeviceCall(call: ProposedCall, preview?: PreviewSettings): DeviceChange | null {
  switch (call.name) {
    case "set_language": {
      const language = call.input.language;
      return { kind: "language", language: typeof language === "string" ? language : String(language ?? "") };
    }
    case "set_filters":
      return { kind: "filters", filters: filtersFromInput(call.input) };
    case "update_settings":
      return carriesEnabledModules(call) ? null : { kind: "settings", settings: previewedSettings(call.input, preview) };
    default:
      return null;
  }
}
