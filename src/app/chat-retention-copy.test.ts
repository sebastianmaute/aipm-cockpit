// The user-facing texts that describe saved AI chats: who can read them, how long they are kept,
// what a factory reset does to them, and the warning after a project delete whose cleanup must be
// retried. EN and DE are checked separately; DE is loaded first.
import { describe, it, expect, beforeAll } from "vitest";
import { loadI18n, t, type TranslationKey } from "./i18n";

const HELP_BODIES: readonly TranslationKey[] = [
  "helpSecAiBody", "helpSecAiBodyGateway", "helpSecAiBodyGatewayRestricted", "helpSecAiBodyRelay",
];
const GATEWAY_BODIES: readonly TranslationKey[] = ["helpSecAiBodyGateway", "helpSecAiBodyGatewayRestricted"];

beforeAll(async () => {
  await loadI18n("de");
});

describe("saved-chat disclosure texts", () => {
  it.each(["aiDataChat", ...HELP_BODIES] as TranslationKey[])("%s names the reader, the recovery key and the retention (EN)", (key) => {
    const en = t("en-US", key);
    expect(en).toContain("only the person who wrote them");
    expect(en).toContain("recovery key");
    expect(en).toContain("30 days");
    expect(en).toContain("earlier version of the app");
  });

  it.each(["aiDataChat", ...HELP_BODIES] as TranslationKey[])("%s names the reader, the recovery key and the retention (DE)", (key) => {
    const de = t("de", key);
    expect(de).toContain("nur die Person, die sie geschrieben hat");
    expect(de).toContain("Wiederherstellungsschlüssel");
    expect(de).toContain("30 Tage");
    expect(de).toContain("früheren Version der App");
  });

  it("names the AI gateway's own logs as an exception wherever a gateway is in the route", () => {
    for (const key of ["aiDataChat", ...GATEWAY_BODIES] as TranslationKey[]) {
      expect(t("en-US", key)).toMatch(/AI gateway['’]s own logs/);
      expect(t("de", key)).toContain("eigenen Protokolle des KI-Gateways");
    }
    for (const key of ["helpSecAiBody", "helpSecAiBodyRelay"] as TranslationKey[]) {
      expect(t("en-US", key)).not.toMatch(/AI gateway['’]s own logs/);
      expect(t("de", key)).not.toContain("eigenen Protokolle des KI-Gateways");
    }
  });

  it("help says a Turso chat is saved only once a recovery key is set", () => {
    for (const key of HELP_BODIES) {
      expect(t("en-US", key)).toContain("once the operator has set a recovery key");
      expect(t("de", key)).toContain("sobald der Administrator einen Wiederherstellungsschlüssel festgelegt hat");
    }
  });
});

describe("factory reset message", () => {
  it("says this browser's saved chats become unreadable at once and expire later (EN)", () => {
    const en = t("en-US", "settingsResetDialogMessage");
    expect(en).toContain("saved AI chats become unreadable to it at once");
    expect(en).toContain("deleted when their retention period ends");
    expect(en).toContain("Files and databases are NOT deleted.");
  });

  it("says this browser's saved chats become unreadable at once and expire later (DE)", () => {
    const de = t("de", "settingsResetDialogMessage");
    expect(de).toContain("sofort nicht mehr lesen");
    expect(de).toContain("Aufbewahrungsfrist");
    expect(de).toContain("Dateien und Datenbanken werden NICHT gelöscht.");
  });
});

describe("pending project sweep warning", () => {
  it("is the agreed text in EN and a formal German translation", () => {
    expect(t("en-US", "projectSweepPending")).toBe(
      "Some data of a deleted project could not be removed yet. The app will try again the next time it starts.",
    );
    expect(t("de", "projectSweepPending")).toBe(
      "Einige Daten eines gelöschten Projekts konnten noch nicht entfernt werden. Die App versucht es beim nächsten Start erneut.",
    );
  });
});
