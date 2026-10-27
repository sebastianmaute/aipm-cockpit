import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n, t } from "./i18n";
import { de } from "./i18n.de";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AI-20: wrong AI copy corrected. Each row pins a phrase the corrected EN text must carry and a
// fragment of the OLD German text that must be gone. Prose is never proof of behaviour; these only
// stop the old wording from coming back.
type Row = { key: keyof typeof de; enHas: string[]; oldDe: string };
const ROWS: Row[] = [
  { key: "disclaimerIntro", enHas: ["runs with your credentials", "actor \"AI assistant\""], oldDe: "Protokollspur" },
  { key: "disclaimerResponsibility", enHas: ["activity log marks the assistant"], oldDe: "nicht davon zu unterscheiden, als hätten Sie es manuell getan" },
  { key: "aiGuideBudgetWarning", enHas: ["without a view scope is sent with every message", "only on its view"], oldDe: "nur die Übersicht und der Leitfaden der aktuellen Ansicht" },
  { key: "settingsAiHistorySearchHelp", enHas: ["sent with every chat request", "only when the assistant uses it"], oldDe: "Verursacht erst bei Nutzung Kosten" },
  { key: "aiPolicyOrgHint", enHas: ["owner name is optional", "policy link alone"], oldDe: "tragen Sie beides hier ein" },
  { key: "helpSecAiBody", enHas: ["accept the AI data disclosure", "Every interactive AI feature listed in that disclosure"], oldDe: "im KI-Assistenten-Tab die Einwilligung akzeptieren" },
  { key: "aiConsentBullet4", enHas: ["into any field while AI is enabled"], oldDe: "solange der Chat aktiviert ist" },
  { key: "aiConsentBullet5", enHas: ["switches off every AI feature"], oldDe: "und der API-Schlüssel erhalten" },
  { key: "aiConsentReviewPrompt", enHas: ["disclosure is not accepted"], oldDe: "geändert" },
];

describe("corrected AI copy (AI-20)", () => {
  beforeAll(async () => { await loadI18n("de"); });

  for (const row of ROWS) {
    it(`${String(row.key)}: EN states the corrected fact`, () => {
      const text = t("en-US", row.key);
      for (const frag of row.enHas) expect(text).toContain(frag);
    });
    it(`${String(row.key)}: DE no longer carries the old wording and stays formal`, () => {
      const text = t("de", row.key);
      expect(text).not.toContain(row.oldDe);
      expect(text).not.toMatch(/\b(deaktiviere|tragt|schalte|klicke)\b/);
    });
  }

  it("aiConsentBullet4/5 and the review prompt no longer talk about the chat alone", () => {
    expect(t("en-US", "aiConsentBullet4")).not.toMatch(/\bchat\b/i);
    expect(t("en-US", "aiConsentBullet5")).not.toMatch(/\bchat\b/i);
  });

  it("aiConsentRequired is gone from both dictionaries", () => {
    for (const file of ["i18n.ts", "i18n.de.ts"]) {
      expect(readFileSync(join(__dirname, file), "utf8")).not.toContain("aiConsentRequired");
    }
  });
});

// Fix round 1: sentences the first correction still got wrong for this branch.
type Fix = { key: keyof typeof de; enHas: string[]; enNot: string[]; deHas: string[]; deNot: string[] };
const FIXES: Fix[] = [
  { key: "disclaimerIntro", enHas: ["through its chat tools", "are not"], enNot: ["every AI write"], deHas: ["Chat-Werkzeuge"], deNot: ["jeder KI-Schreibvorgang"] },
  { key: "disclaimerResponsibility", enHas: ["chat-tool changes"], enNot: ["marks AI writes"], deHas: ["Chat-Werkzeuge"], deNot: ["KI-Schreibvorgänge mit dem Akteur"] },
  { key: "helpSecAiBody", enHas: ["master switch, accept the disclosure, key", "run on their own"], enNot: ["master switch, key, accept the disclosure", "and only when you use it"], deHas: ["Hauptschalter, Datenhinweis, Schlüssel", "von selbst"], deNot: ["Hauptschalter, Schlüssel, Datenhinweis", "nur bei Nutzung"] },
  { key: "aiGuideBudgetWarning", enHas: ["no cache marker of its own"], enNot: ["Both are cached"], deHas: ["keine eigene Cache-Markierung"], deNot: ["Beide werden nach dem ersten Senden zwischengespeichert"] },
];

describe("corrected AI copy, fix round 1", () => {
  beforeAll(async () => { await loadI18n("de"); });
  for (const fx of FIXES) {
    it(`${String(fx.key)}: EN`, () => {
      const text = t("en-US", fx.key);
      for (const x of fx.enHas) expect(text).toContain(x);
      for (const x of fx.enNot) expect(text).not.toContain(x);
    });
    it(`${String(fx.key)}: DE`, () => {
      const text = t("de", fx.key);
      for (const x of fx.deHas) expect(text).toContain(x);
      for (const x of fx.deNot) expect(text).not.toContain(x);
    });
  }
});
