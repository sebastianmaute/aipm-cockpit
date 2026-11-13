# KI-Kompetenz

## Über dieses Dokument

Dies ist ein kurzer Leitfaden für alle, die die KI-Funktionen von AI PM Cockpit nutzen: was die KI zu sehen
bekommt, was sie tun darf, wie Sie ihre Arbeit prüfen, wo sie typischerweise danebenliegt und wie Sie sie
ausschalten. Ihre Organisation kann ihn unverändert weitergeben oder um eigene Regeln ergänzen. Wann der
Text zuletzt geprüft wurde, steht in der [Prüfzeile](README.md#stand-des-textes) der README.

Dieser Leitfaden ist Material für die eigene Schulung Ihrer Organisation. Er ist keine Rechtsberatung, und
die Regeln Ihrer Organisation zur Nutzung von KI haben Vorrang. [Frage an Sie]

Die KI in der App ist Claude, ein Sprachmodell von Anthropic. [geprüft: `src/app/ai-disclosure.ts`; die
Beschriftungen „Ask Claude“ in `src/app/i18n.ts` und `src/app/i18n.de.ts`] Die Kennzeichnungen in eckigen Klammern sagen, woher
jede Aussage stammt; die [README](README.md#so-lesen-sie-die-kennzeichnungen) erklärt sie.

## Was die KI sieht und was nicht

Die KI sieht nur, was eine Funktion ihr sendet, und nur dann, wenn Sie diese Funktion nutzen. Bevor Sie
KI einschalten konnten, hat Ihnen die App eine Liste aller Funktionen gezeigt und was jede davon sendet;
dieselbe Liste finden Sie in den [Angaben für das Verzeichnis von
Verarbeitungstätigkeiten](record-of-processing-input.md#ki-verarbeitung). [geprüft:
`src/app/ai-disclosure.ts`, `aiConsentDataIntro` in `src/app/i18n.ts` und `src/app/i18n.de.ts`]

- **Der Chat** sieht Ihre Nachrichten, die Dateien, die Sie anhängen, und die Projektdaten, die er zum
  Antworten nachschlägt: Aufgaben, Meilensteine, Risiken, Änderungen, Stakeholder, Personen,
  Budgetzahlen, Dokumente und mehr. Mit jeder neuen Nachricht erhält er die gesamte Unterhaltung erneut.
  [geprüft: die Zeile zum Chat in der Tabelle in `src/app/ai-disclosure.ts`]
- **Die übrigen Funktionen** sehen viel weniger. „Claude fragen“ an einer Zeile sieht diese eine Zeile und
  eine kurze Projektzusammenfassung; der Text der Zusammenfassung sieht Zahlen und Meilensteinnamen.
  [geprüft: die Zeilen zur Zeilenbearbeitung und zum Text der Zusammenfassung in derselben Tabelle]
- **Die KI sieht nicht** andere Projekte, außer dass der Zuteilungsvorschlag Stunden mitzählt, die eine
  Person in anderen Projekten derselben Turso-Datenbank hat, und zwar nur aus Projekten, die ihre Personen
  nicht schützen. [geprüft: die Zeile „Vorschlag für die Ressourcenplanung“ in derselben Tabelle] Sie
  sieht weder Ihren Bildschirm noch andere Programme oder Ihr E-Mail-Postfach, nur E-Mails, die Sie selbst
  anhängen. [Aussage des Maintainers]
- **Im Hintergrund** senden drei Funktionen nach Zeitplan Projektdaten, solange die App geöffnet ist:
  geplante Analysen, automatische Empfehlungen zu Insights und der geplante Text der Zusammenfassung. Sie
  laufen nur, wenn Sie unter Einstellungen → KI erlaubt haben, dass KI im Hintergrund läuft. [geprüft:
  `aiBackgroundConsentHelp` in `src/app/i18n.ts` und `src/app/i18n.de.ts`, `src/app/ai-consent.ts`]
- **Das Diktat** sendet Ihre Stimme an den Sprachdienst, den Sie in den Einstellungen gewählt haben, nicht
  an Claude. [geprüft: die Zeile zum Diktat in derselben Tabelle]

Schreiben Sie in die App so, als könnte eine Kollegin oder ein Kollege außerhalb des Projekts mitlesen:
Alles, was Sie in eine Aufgabe, eine Notiz oder einen Anhang schreiben, kann die KI erreichen, wenn jemand
eine Funktion nutzt, die es sendet. [Aussage des Maintainers]

## Was die KI selbst ändern darf

Die KI schlägt vor; Sie entscheiden. Die meisten Funktionen zeigen Ihnen, was sie ändern wollen, und
ändern nichts, bis Sie „Übernehmen“ oder „Anwenden“ wählen oder bestätigen. [geprüft: die Liste in der
[Anlage für den Betriebsrat](works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf)]

Kennen Sie die Ausnahmen:

- **Eine Änderung im Chat.** Bitten Sie den Chat um eine einzelne Änderung, etwa das Verschieben eines
  Fälligkeitsdatums, kann er sie sofort vornehmen, ohne Prüfkarte. Er fragt immer vorher, wenn er etwas
  löschen, Besprechungsteilnehmer einladen, die eigenen Angaben des Projekts bearbeiten, mehr als eine
  Sache ändern oder Arbeit auf einen Tag legen will, an dem jemand abwesend ist, und immer dann, wenn eine
  Datei an die Unterhaltung angehängt ist. [geprüft: `shouldStage` in `src/app/chat-proposal.ts`; Register
  §794]
- **Von außen gelesener Text.** Hat der Chat Text von außerhalb der App gelesen, zum Beispiel aus Jira
  synchronisierte Inhalte, fragt er allein aus diesem Grund nicht vorher. [geprüft: `untrusted` in `SendRecord`, `src/app/chat-send-record.ts`; Register §797]
- **Läufe im Hintergrund.** Die oben genannten Hintergrundfunktionen senden bei jedem Lauf Daten, ohne
  jedes Mal zu fragen. Ihre Ergebnisse sind nur Ratschläge: Eine Empfehlung ändert nichts, bis eine Person
  sie bestätigt. [geprüft: `src/app/use-insight-recommendations.ts`, `src/app/scheduled-job-run.ts`;
  Register §795]

Was der Chat ändert, wird im Aktivitätsprotokoll als Änderung der KI festgehalten, und die meisten
Änderungen lassen sich mit „Rückgängig“ zurücknehmen. Aufgaben, die durch einen von Ihnen übernommenen
Projektstrukturplan angelegt wurden, lassen sich nicht rückgängig machen; löschen Sie sie von Hand.
[geprüft: `src/app/activity-log.ts`; Register §796]

Sie bleiben verantwortlich für das, was Sie übernehmen, und für das, was Sie weitergeben, etwa einen
Bericht oder eine E-Mail, die die KI entworfen hat. [Aussage des Maintainers; die Regeln Ihrer
Organisation: Frage an Sie]

## Prüfkarten und Änderungsansichten lesen

**Die Prüfkarte des Chats** („Vorgeschlagene Änderungen“) führt jede Änderung auf, die der Chat vornehmen
will. [geprüft: `chatProposalTitle` in `src/app/i18n.ts` und `src/app/i18n.de.ts`]

- Lesen Sie jede Zeile, nicht nur die Anzahl. Nutzen Sie „Alle anzeigen“, wenn die Liste gekürzt ist.
- Entfernen Sie das Häkchen bei einer Zeile, um sie auszulassen. Eine Zeile, die von einer ausgelassenen
  Zeile abhängt, wird mit „Benötigt eine von Ihnen abgelehnte Änderung“ markiert und ebenfalls
  ausgelassen.
- Eine Warnung an einer Zeile bedeutet, dass ein Datum auf die Abwesenheit einer Person fällt. Prüfen Sie
  das, bevor Sie übernehmen.
- „Übernehmen“ führt die angehakten Änderungen aus; „Verwerfen“ verwirft sie alle.

[geprüft: `chatProposalShowMore`, `chatProposalRowToggle`, `chatProposalCascaded`, `chatProposalApply`,
`chatProposalDiscard` in `src/app/i18n.ts` und `src/app/i18n.de.ts`; `src/app/absence-clash-notes.tsx`]

**„Claude fragen“ an einer Zeile** zeigt „Claude nimmt diese Änderungen vor:“ mit dem neuen Wert jedes
Felds und den Werten, die abgelehnt wurden, bevor Sie „Anwenden“ wählen. [geprüft: `inlineAiEditPreview`,
`inlineAiEditRejected` und `inlineAiEditApply` in `src/app/i18n.ts` und `src/app/i18n.de.ts`]

**„Mit KI planen“, RACI-Vorschläge, der Projektstrukturplan und die Dublettenprüfung** führen jede
vorgeschlagene Änderung einzeln auf. Wo sich ein Wert ändert, sehen Sie den aktuellen und den
vorgeschlagenen Wert. Bei jedem Eintrag lässt sich das Häkchen entfernen. [geprüft:
`src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`, `src/app/wbs-plan-modal.tsx`,
`src/app/task-dedup-modal.tsx`]

Fragen Sie sich beim Lesen eines Vorschlags: Kenne ich jeden Namen, jedes Datum und jede Zahl aus dem
Projekt? Ändert er etwas, worum ich nicht gebeten habe? Würde ich diese Änderung vornehmen, wenn eine
Kollegin oder ein Kollege sie vorschlüge? [Aussage des Maintainers]

## Typische Fehler

- **Erfundene Fakten.** Die KI kann Namen, Daten, Zahlen oder Begründungen nennen, die nicht im Projekt
  stehen, und dabei sicher klingen. Prüfen Sie alles, worauf es ankommt, am Projekt selbst. [Aussage des
  Maintainers]
- **Fehlender Kontext.** Die KI weiß nur, was gesendet wurde. Der Zuteilungsvorschlag sieht höchstens 150
  offene Aufgaben und 40 Meilensteine; eine Tabelle, die für eine Anfrage zu groß ist, wird gar nicht
  gesendet; „Claude fragen“ an einer Zeile sieht diese Zeile und wenig sonst. Eine Antwort kann falsch
  sein, weil etwas fehlte. [geprüft: `ALLOC_CONTEXT_MAX_TASKS` und `ALLOC_CONTEXT_MAX_MILESTONES` in
  `src/app/alloc-plan/alloc-project-digest.ts`; die Zeilen zum Prognose-Import und zur Zeilenbearbeitung in
  der Tabelle in `src/app/ai-disclosure.ts`]
- **Jedes Mal andere Antworten.** Wer dasselbe zweimal fragt, kann zwei verschiedene Pläne erhalten. Die
  App macht die KI nicht wiederholbar. Behandeln Sie einen Plan als eine Möglichkeit, nicht als die
  Antwort. [geprüft: keine Einstellung `temperature` in `src/app`; der Rest: Aussage des Maintainers]
- **In Text versteckte Anweisungen.** Eine Datei, eine E-Mail oder synchronisierter Text kann
  Anweisungen enthalten, die sich an die KI richten. Deshalb fragt der Chat vor jeder Änderung, solange
  eine Datei angehängt ist; bei Text, den er über seine Werkzeuge von außen liest, tut er das nicht.
  [geprüft: `stagesWhenUntrusted` in `src/app/chat-send-record.ts`; Register §797]
- **Lange Wartezeiten und Fehler.** Die meisten KI-Anfragen haben in der App kein Zeitlimit, und eine
  Anfrage, die abgelehnt wird, weil der Dienst ausgelastet ist, wird nicht erneut versucht. Brechen Sie ab
  und versuchen Sie es später noch einmal. [Aussage des Maintainers; Register §798]
- **Unbekannte Namen.** Der Personenschutz verbirgt Namen, die das Projekt kennt, nicht aber Namen, die
  Sie eingeben und die es nicht kennt. [geprüft: `aiPeopleProtectionHelp` in `src/app/i18n.ts` und `src/app/i18n.de.ts`]

## Was der Personenschutz ändert

Der Personenschutz ist eine Einstellung je Projekt, und er ist eingeschaltet, sofern ihn niemand für
dieses Projekt ausgeschaltet hat. Er wird mit dem Projekt gespeichert und ist daher für alle gleich, die
darin arbeiten. Ihre Organisation kann ihn für alle Projekte eingeschaltet haben; dann lässt er sich nicht
ausschalten. [geprüft: `src/app/ai-people-protection.ts`, `aiPeopleProtectionLocked` in
`src/app/i18n.ts`]

Solange er eingeschaltet ist:

- werden die Namen, E-Mail-Adressen und Telefonnummern der Personen, die das Projekt kennt, durch
  Platzhalter ersetzt, bevor etwas gesendet wird;
- kann die KI niemanden zuweisen, verschieben oder bewerten und bei keinem Eintrag eine Person setzen oder
  ändern;
- sind „Mit KI planen“, RACI-Vorschläge, Diktat und Sprachbefehle nicht verfügbar;
- nimmt der Chat keine Bilder oder PDF-Dokumente an, weil Text darin nicht auf Namen geprüft werden kann.

[geprüft: `aiPeopleProtectionHelp`, `chatPeopleProtectedAttachment` in `src/app/i18n.ts` und `src/app/i18n.de.ts`;
`src/app/ai-person-fields.ts`]

Namen, die er nicht kennt und die in Freitext eingegeben werden oder in Anhängen stehen, können weiterhin
gesendet werden. Fügen Sie daher keine persönlichen Angaben in den Chat ein, die die Aufgabe nicht
braucht. [geprüft: `aiPeopleProtectionHelp` in `src/app/i18n.ts` und `src/app/i18n.de.ts`; der Rat: Aussage des Maintainers]

## KI ausschalten

- **Für sich selbst:** Schalten Sie unter Einstellungen → KI „KI-Assistent aktivieren“ aus, oder wählen
  Sie „Zustimmung widerrufen“. Die KI-Funktionen ruhen, bis Sie KI wieder einschalten und erneut
  zustimmen. [geprüft: `aiEnable` und `aiConsentRevoke` in `src/app/i18n.ts` und `src/app/i18n.de.ts`,
  `src/app/settings-sections/ai-section.tsx`, `src/app/ai-consent.ts`]
- **Nur die Läufe im Hintergrund:** Schalten Sie an derselben Stelle „KI darf im Hintergrund laufen“ aus.
  [geprüft: `aiBackgroundConsentToggle` in `src/app/i18n.ts` und `src/app/i18n.de.ts`]
- **Nur Personen, für ein Projekt:** Lassen Sie den Personenschutz eingeschaltet, oder schalten Sie ihn in
  den Einstellungen wieder ein. [geprüft: `src/app/settings-sections/ai-people-protection-control.tsx`]
- **Für alle:** Ihr Administrator kann die gesamte KI für die ganze Installation abschalten. [geprüft:
  `AIPM_DISABLED_INTEGRATIONS` in `src/app/deployment-variables.ts`]

Das Ausschalten beendet neue Anfragen. Was bereits gesendet wurde, bleibt, wo es hingegangen ist.
[geprüft: die Zeile „Schalter für Integrationen und KI“ im TOM-Blatt] Die Einstellungen wirken für
unterschiedliche Personen:

- Das Ein- und Ausschalten der KI, Ihre Zustimmung und die Hintergrundeinstellung gelten für das Gerät und
  den Browser, auf dem Sie sie festgelegt haben; auf einem anderen Computer oder in einem anderen Browser
  legen Sie sie dort ebenfalls fest. [geprüft: `src/app/ai-consent.ts` (Zustimmung auf diesem Gerät
  festgehalten)]
- Der Personenschutz wird mit dem Projekt gespeichert; wer ihn ein- oder ausschaltet, ändert ihn also für
  alle, die in diesem Projekt arbeiten. [geprüft: `settingsOverrides` in `src/app/workspace.ts`,
  `src/app/ai-people-protection.ts`]
- Der Schalter des Administrators gilt für die ganze Installation. [geprüft:
  `src/app/integration-switches.ts`]
