# Musterhinweise

## Über dieses Dokument

Zwei Vorlagen, mit denen Sie Menschen darüber informieren, dass Ihre Organisation AI PM Cockpit und seine
KI-Funktionen nutzt: eine für Beschäftigte, eine für externe Personen, die in Ihren Projekten vorkommen,
etwa Mitglieder des Lenkungsausschusses, Ansprechpersonen beim Kunden und Beschäftigte von Lieferanten. Sie
richten sich an Datenschutzbeauftragte, die sie anpassen, und landen am Ende bei den betroffenen Personen.
Wann der handgeschriebene Text zuletzt geprüft wurde, steht in der [Prüfzeile](README.md#stand-des-textes)
der README.

Diese Vorlagen sind Material für Ihre eigene Arbeit. Sie sind keine Rechtsberatung, und sie sind erst
vollständig, wenn Sie jeden Platzhalter ausgefüllt und entfernt haben, was nicht zutrifft. [Frage an Sie]

Ein Hinweis an Personen, deren Daten Sie bei ihnen selbst erheben, muss unter anderem Namen und
Kontaktdaten des Verantwortlichen, die Kontaktdaten des Datenschutzbeauftragten, die Zwecke und die
Rechtsgrundlage, die Empfänger, eine etwaige Übermittlung in ein Drittland mit ihrer Garantie, die
Speicherdauer, die Rechte der Person und das Bestehen einer automatisierten Entscheidungsfindung angeben
(Art. 13 DSGVO). Stammen die Daten aus einer anderen Quelle, muss der Hinweis zusätzlich die
Datenkategorien und ihre Quelle angeben und innerhalb einer angemessenen Frist, spätestens innerhalb eines
Monats, oder bei der ersten Mitteilung an die Person erteilt werden (Art. 14). [extern: Verordnung (EU)
2016/679, Art. 13 und Art. 14, Amtsblatt L 119 vom 4. Mai 2016, gelesen beim Amt für Veröffentlichungen
der EU unter http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1 am
2026-11-13] Beide Vorlagen folgen dieser Reihenfolge. Welcher Artikel für welche Person gilt, entscheiden
Sie. [Frage an Sie]

**So füllen Sie sie aus.** Text in eckigen Klammern ersetzen Sie: `[Organisation]` ist der Name Ihrer
Organisation, und die übrigen sagen, was dort hingehört. Aussagen in den Vorlagen darüber, was die App tut,
stammen aus der Tabelle am Ende dieses Dokuments und aus den anderen Dokumenten dieses Pakets und sind dort
geprüft; die Anmerkungen nach jeder Vorlage nennen die Quelle. Halten Sie sie mit der Tabelle in
Übereinstimmung, wenn Sie Funktionen ein- oder ausschalten. [geprüft: `src/app/ai-disclosure.ts`; die in
den Anmerkungen genannten Quellen]

## Hinweis für Beschäftigte

> **Wie [Organisation] KI im Projektmanagement einsetzt**
>
> **Wer verantwortlich ist.** [Organisation], [Anschrift], ist für die hier beschriebene Verarbeitung
> verantwortlich. Unsere Datenschutzbeauftragte oder unseren Datenschutzbeauftragten erreichen Sie unter
> [Kontaktdaten].
>
> **Was wir einsetzen und warum.** Wir steuern Projekte mit AI PM Cockpit, einem
> Projektmanagement-Werkzeug. Wir nutzen es für [Zwecke, zum Beispiel die Planung von Aufgaben und
> Ressourcen und die Berichterstattung über den Projektstand]. Rechtsgrundlage ist [Rechtsgrundlage].
> [Wenn Sie sich auf berechtigte Interessen stützen: Unser berechtigtes Interesse ist [Interesse].]
>
> **Welche Daten über Sie darin stehen.** Je nach Ihrer Rolle in einem Projekt: Ihr Name, [Ihre
> Berufsbezeichnung, Abteilung, Ihr Unternehmen, Ihre Rolle,] die Ihnen zugewiesenen Aufgaben und Risiken,
> Ihre geplante Auslastung je Zeitraum, [Ihre Abwesenheiten mit ihrer Art (Urlaub, Krankheit, Schulung
> oder Sonstiges),] [Ihre in Timelog erfasste Arbeitszeit und die Prüfungen, die wir darauf anwenden,] und
> was Kolleginnen und Kollegen in Aufgaben, Notizen und Dokumenten über die Arbeit schreiben. Das Werkzeug
> hält Änderungen in einem Aktivitätsprotokoll fest, das zeigt, was sich geändert hat und ob eine Person,
> die KI oder eine Integration es geändert hat, nicht aber, welche Person. [Notizen und Blocker-Einträge
> halten Namen und Zeitpunkt ihres Verfassers fest, wenn dieser im Werkzeug festgelegt hat, welche Person
> er ist.]
>
> **KI-Funktionen.** Wir haben diese KI-Funktionen eingeschaltet: [aus der Tabelle unten aufzählen].
> Nutzt eine Kollegin oder ein Kollege eine davon, werden die Daten, die diese Funktion braucht, an
> [Vertragspartner bei Anthropic, wie in Ihrem Vertrag mit Anthropic genannt] gesendet [, über unser
> KI-Gateway, betrieben von [Organisation, die das Gateway betreibt]]. Die Tabelle unten führt je Funktion auf, was
> gesendet wird. [Der Personenschutz ist in allen unseren Projekten eingeschaltet: Bevor Daten gesendet
> werden, werden die Namen, E-Mail-Adressen und Telefonnummern der Personen, die das Projekt kennt, durch
> Platzhalter ersetzt, die KI kann niemandem Arbeit zuweisen, und die Funktionen, die die Zuteilung von
> Beschäftigten planen und RACI-Rollen vorschlagen, sind nicht verfügbar. Namen, die in Freitext oder
> angehängte Dateien geschrieben sind, können weiterhin gesendet werden.] [Oder, wenn der Schutz in
> einigen Projekten ausgeschaltet ist: In [Projekte] sieht die KI auch Ihren Namen und kann vorschlagen,
> wie Ihnen Arbeit zugeteilt wird.]
>
> **KI im Hintergrund.** [Streichen, wenn nicht genutzt.] [Geplante Analysen, automatische
> Insight-Empfehlungen und der geplante Text der Zusammenfassung] senden Projektdaten nach Zeitplan an die
> KI, ohne dass eine Person jeden Lauf startet.
>
> **Wer entscheidet.** Die KI schlägt vor; eine Person prüft ihre Vorschläge und übernimmt sie. Eine
> Ausnahme: Eine einzelne Änderung, die der KI-Chat vornimmt, kann sofort ausgeführt werden, ohne
> Prüfschritt; sie wird als Änderung der KI festgehalten. [Wir treffen keine Entscheidungen über Sie, die
> ausschließlich auf KI-Ausgaben beruhen. / Beschreiben Sie jede solche Entscheidung.]
>
> **Empfänger.** [Anthropic, als unser Auftragsverarbeiter, für die KI-Funktionen.] [Microsoft 365,
> Turso, Atlassian, Timelog, ein Speech-to-Text-Dienst: Führen Sie die auf, die Sie nutzen, mit ihrer
> Rolle.]
>
> **Übermittlungen außerhalb der EU.** KI-Anfragen werden in den Vereinigten Staaten oder in einer anderen
> Region verarbeitet, die Anthropic nutzt, je nach unseren Einstellungen bei Anthropic: [unsere
> Einstellung]. [Und wo unser KI-Gateway läuft: [Standort].] Die Garantie ist [zum Beispiel die
> Standardvertragsklauseln in unserem Auftragsverarbeitungsvertrag mit Anthropic].
>
> **Wie lange wir Daten aufbewahren.** Projektdaten: [Ihre Aufbewahrungsfrist]. Gespeicherte KI-Chats:
> [Anzahl] Tage nach ihrer letzten Änderung. An Anthropic gesendete Anfragen: [Frist aus Ihrem Vertrag
> oder den aktuellen Bedingungen von Anthropic].
>
> **Ihre Rechte.** Sie können von uns Auskunft über Ihre Daten, deren Berichtigung oder Löschung, die
> Einschränkung ihrer Verarbeitung und ihre Herausgabe in einem übertragbaren Format verlangen, und Sie
> können ihrer Verarbeitung widersprechen. [Wenn wir uns auf eine Einwilligung stützen: Sie können Ihre
> Einwilligung jederzeit widerrufen.] Sie können sich bei [Aufsichtsbehörde] beschweren.
>
> **Betriebsvereinbarung.** [Verweis auf die Betriebsvereinbarung, oder streichen.]
>
> **Fragen.** [Ansprechpartner.]

Anmerkungen zum Hinweis für Beschäftigte: [geprüft wie angegeben]

- Der Satz zum Aktivitätsprotokoll: `ActivityActor` in `src/app/activity-log.ts`.
- Der Satz zu Notizen und Blockern: `NoteLogEntry` und `BlockerEntry` in `src/app/types.ts` sowie
  `selfResourceId` in `src/app/settings-types.ts` (je Gerät festgelegt).
- Der Satz zum Personenschutz: `src/app/ai-people-protection.ts`, `src/app/ai-person-fields.ts` und die
  letzte Spalte der Tabelle unten. Der Schutz ist je Projekt standardmäßig eingeschaltet; prüfen Sie, ob
  ein Projekt ihn ausgeschaltet hat, oder erzwingen Sie ihn mit `AIPM_DISABLED_INTEGRATIONS=ai-people`
  (`src/app/deployment-variables.ts`).
- Der Satz zum Hintergrund: die drei Zeilen der Tabelle unten, deren Zustimmung „gesondert“ abgefragt
  wird (`level: "background"` in `src/app/ai-disclosure.ts`); Register §795.
- Der Satz „Eine Ausnahme“: `shouldStage` in `src/app/chat-proposal.ts`; Register §794. Auch andere
  Bedingungen führen eine Chat-Änderung zur Prüfung; die [Anlage für den
  Betriebsrat](works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf) führt sie auf.
- Der Satz zur Übermittlung: die Angaben für die Datenschutz-Folgenabschätzung, [Übermittlungen außerhalb
  der EU](dpia-input.md#übermittlungen-außerhalb-der-eu), wo die Aussagen von Anthropic mit Quelle und
  Datum gekennzeichnet sind.
- Die Aufbewahrung der Chats: `AIPM_AI_CHAT_RETENTION_DAYS`, 30 Tage, wenn nicht gesetzt
  (`src/app/ai-chat-retention-config.ts`).

## Hinweis für externe Stakeholder

> **Wie [Organisation] Ihre Daten in ihrem Projektmanagement verarbeitet**
>
> **Wer verantwortlich ist.** [Organisation], [Anschrift], ist für die hier beschriebene Verarbeitung
> verantwortlich. Unsere Datenschutzbeauftragte oder unseren Datenschutzbeauftragten erreichen Sie unter
> [Kontaktdaten].
>
> **Warum wir Ihre Daten führen.** Sie sind [Mitglied des Lenkungsausschusses / Ansprechperson /
> Stakeholder] in unserem Projekt [Projekt]. Wir erfassen Sie in unserem Projektmanagement-Werkzeug, AI PM
> Cockpit, um [Zwecke, zum Beispiel die Kommunikation und die Entscheidungen des Projekts zu planen]. Die
> Rechtsgrundlage ist [Rechtsgrundlage]. [Wenn Sie sich auf berechtigte Interessen stützen: Unser
> berechtigtes Interesse ist [Interesse].]
>
> **Welche Daten wir führen und woher sie stammen.** Ihr Name, Ihre Organisation, Ihr Titel, Ihre
> E-Mail-Adresse, [Ihre Kategorie als Stakeholder, unsere Einschätzung Ihres Einflusses auf das Projekt und
> Ihres Interesses daran, Ihre Rolle je Meilenstein (verantwortlich, rechenschaftspflichtig, zu
> konsultieren oder zu informieren), unsere Notizen,] [E-Mails, die Sie uns gesendet haben, soweit wir sie
> im Werkzeug anhängen]. Wir haben sie [von Ihnen / von [Quelle]] erhalten.
>
> **KI-Funktionen.** Einige Funktionen des Werkzeugs nutzen KI. Nutzt eine Kollegin oder ein Kollege eine
> davon, können die Daten, die diese Funktion braucht, an [Vertragspartner bei Anthropic, wie in Ihrem
> Vertrag mit Anthropic genannt] gesendet werden. Bei Ihnen können das Ihr Name, Titel, Ihre Organisation,
> Kategorie, [unsere Einschätzung von Einfluss und Interesse,] [Ihre Rolle je Meilenstein
> (verantwortlich, rechenschaftspflichtig, zu konsultieren oder zu informieren),] die übrigen Angaben, die
> wir im Werkzeug über Sie führen, Ihre E-Mail-Adresse (der KI-Assistent kann sie abrufen, jeweils eine
> Adresse) sowie Inhalt, Absender und Empfänger von E-Mails von Ihnen sein, die wir anhängen. [Der
> Personenschutz ist in allen unseren Projekten eingeschaltet: Bevor Daten gesendet werden, werden die
> Namen, E-Mail-Adressen und Telefonnummern der Personen, die das Projekt kennt, durch Platzhalter
> ersetzt. Namen in Freitext oder in angehängten E-Mails können weiterhin gesendet werden.]
>
> **Wer entscheidet.** Die KI schlägt vor; unsere Beschäftigten prüfen ihre Vorschläge und übernehmen sie.
> Eine Ausnahme: Eine einzelne Änderung, die der KI-Chat vornimmt, kann sofort ausgeführt werden, ohne
> Prüfschritt; sie wird als Änderung der KI festgehalten. [Wir treffen keine Entscheidungen über Sie, die
> ausschließlich auf KI-Ausgaben beruhen.]
>
> **Empfänger.** [Anthropic, als unser Auftragsverarbeiter, für die KI-Funktionen.] [Weitere, die Sie
> nutzen.]
>
> **Übermittlungen außerhalb der EU.** KI-Anfragen werden in den Vereinigten Staaten oder in einer anderen
> Region verarbeitet, die Anthropic nutzt, je nach unseren Einstellungen bei Anthropic: [unsere
> Einstellung]. [Und wo unser KI-Gateway läuft: [Standort].] Die Garantie ist [Garantie].
>
> **Wie lange wir Daten aufbewahren.** [Ihre Aufbewahrungsfrist, zum Beispiel bis zum Projektende
> zuzüglich [Frist].]
>
> **Ihre Rechte.** Sie können von uns Auskunft über Ihre Daten, deren Berichtigung oder Löschung, die
> Einschränkung ihrer Verarbeitung und ihre Herausgabe in einem übertragbaren Format verlangen, und Sie
> können ihrer Verarbeitung widersprechen. Sie können sich bei [Aufsichtsbehörde] beschweren.
>
> **Fragen.** [Ansprechpartner.]

Anmerkungen zum Hinweis für Stakeholder: [geprüft wie angegeben]

- Die Datenliste: `Stakeholder` in `src/app/types.ts` (Name, Organisation, Titel, E-Mail, Kategorie,
  Einfluss, Interesse, Notizen und RACI-Rollen). Streichen Sie, was Sie nicht erfassen.
- Der Satz zur KI: Der RACI-Vorschlag sendet Namen, Titel, Organisationen, Kategorien, Einfluss und
  Interesse der Stakeholder sowie die bestehenden RACI-Zuordnungen je Meilenstein; die Analyse der
  nächsten Schritte und die Analyse durch geplante Aufträge senden Namen von Stakeholdern mit ihrem Titel,
  ihrer Organisation oder ihrer Kategorie; der Gewichtungsvorschlag sendet Namen von Stakeholdern; „Mit KI
  planen“ sendet, welche der aufgeführten Personen für jeden Meilenstein als Stakeholder verantwortlich (R)
  oder rechenschaftspflichtig (A) sind; der Chat kann Stakeholder-Datensätze lesen, bei Bedarf jeweils eine
  E-Mail-Adresse abrufen und angehängte E-Mails mit ihren Absendern und Empfängern lesen. Der Satz darf
  nicht weniger sagen als die Tabelle unten; gleichen Sie ihn beim Ausfüllen mit der Tabelle ab. [geprüft:
  die Zeilen zum RACI-Vorschlag, zur Analyse, zu den geplanten Aufträgen, zu „Mit KI planen“, zum
  Gewichtungsvorschlag und zum Chat in `src/app/ai-disclosure.ts`; `raciSection` in
  `src/app/alloc-plan/alloc-project-digest.ts`; `get_contact_email` in `PEOPLE_TOOLS`,
  `src/app/chat-tool-defs.ts`]
- Bei eingeschaltetem Personenschutz ist der RACI-Vorschlag nicht verfügbar, und der Chat kann keine
  Stakeholder-Datensätze lesen; Namen externer Personen in angehängten E-Mails, die das Projekt nicht
  kennt, werden weiterhin gesendet. [geprüft: `src/app/ai-disclosure.ts`, `PEOPLE_TOOLS` in
  `src/app/chat-tool-defs.ts`]
- Der Satz „Eine Ausnahme“: wie beim Hinweis für Beschäftigte (§794).
- Wann externe Personen zu informieren sind (Art. 14 Abs. 3): innerhalb einer angemessenen Frist,
  spätestens innerhalb eines Monats nach Erlangung ihrer Daten; wenn Sie die Daten zur Kommunikation mit
  ihnen verwenden, spätestens bei der ersten Mitteilung. [extern: wie oben zitiert]

## Was die KI-Funktionen senden

Die eigene Liste der App mit jeder KI-Funktion, dem, was sie sendet, und dem, was der Personenschutz
ändert, erzeugt aus der Tabelle, die der Zustimmungsdialog zeigt. Verwenden Sie sie, um die KI-Sätze der
Hinweise auszufüllen. [geprüft: `src/app/ai-disclosure.ts`]

<!-- PACK:ai-paths:BEGIN -->
| Funktion | Zustimmung | Was gesendet wird | Bei aktivem Personenschutz |
|---|---|---|---|
| Chat mit dem KI-Assistenten | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Nachrichten; die Dateien und E-Mails, die Sie anhängen (eine E-Mail mit ihrem Text sowie Namen und Adressen von Absender und Empfängern); Ihre Betriebsleitfäden; und die Projektdaten, die der Assistent zum Antworten liest: Aufgaben mit Beschreibungen und Notizverläufen, Meilensteine, RAID-Einträge, Änderungen, Stakeholder, Personen im Ressourcenverzeichnis, Abwesenheiten (nur als „absent“, mit Person und Datum), Budgetzahlen, Kalendertermine, Dokumente und Projektangaben sowie, wenn er darin sucht, den Aktivitätsverlauf und Ihre anderen Chats in diesem Projekt. Mit jeder Nachricht erhält er außerdem die Anzahl Ihrer anderen Chats in diesem Projekt sowie Titel und Zeitpunkt der letzten Aktivität von bis zu drei der zuletzt geführten (ein unbenannter Chat erhält den Anfang seiner ersten Nachricht als Titel; Chats werden nur mit einer Turso-Datenbank gespeichert) und die offenen Insights des Projekts: bis zu zehn aktuelle und bis zu fünf, auf die Sie reagiert haben, mit ihrem gemessenen Ergebnis, je eine Zeile. Ein Insight aus Timelog nennt eine Person (oder ihre Timelog-Benutzernummer, wenn keine Person im Ressourcenverzeichnis verknüpft ist) mit ihrer erfassten Arbeitszeit: an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung. Namen von Personen sind enthalten. Listenergebnisse enthalten keine E-Mail-Adressen: Der Assistent liest jeweils eine Adresse und nur, wenn er sie braucht; in Anhängen, Dokumenten und protokollierten Änderungen können Adressen dennoch vorkommen. Bei jeder neuen Nachricht wird die gesamte Unterhaltung erneut gesendet. Gespeicherte Chats sind verschlüsselt, sodass nur die Person, die sie geschrieben hat, und der Administrator mit dem Wiederherstellungsschlüssel sie lesen können; jeder Chat wird gelöscht, wenn seit seiner letzten Änderung die Aufbewahrungsfrist vergangen ist (30 Tage, sofern der Administrator nichts anderes festlegt). Ausnahmen: Chats aus einer früheren Version der App, die andere im Projekt bis zu ihrem Ablauf lesen können, sowie die eigenen Protokolle des KI-Gateways, sofern Ihre Organisation eines nutzt. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt, und der Assistent kann niemanden zuweisen, verschieben oder bewerten. Bilder und PDFs werden abgelehnt, solange der Schutz eingeschaltet ist. Namen, die das Projekt nicht kennt und die im Freitext oder in Textanhängen stehen, können weiterhin gesendet werden. |
| KI-Bearbeitung einer Zeile | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anweisung, die eine Zeile, die Sie bearbeiten, und ein kurzer Projektkontext (heutiges Datum, Anzahl der Aufgaben, Gruppen und Labels sowie dieselben Zeilen zu offenen Insights, die der Chat erhält, sodass ein Timelog-Insight eine Person mit ihrer erfassten Arbeitszeit nennen kann), dazu Ihr Betriebsleitfaden für die KI-Bearbeitung, falls vorhanden. Die Zeile enthält Namen, Datumsangaben und Beschreibungen, bei einer Aufgabe ihr Blockerprotokoll mit dem Namen der Person, die den jeweiligen Eintrag erfasst hat; bei einer Person im Ressourcenverzeichnis Name, Berufsbezeichnung, Abteilung, Firma, Rolle, ob sie extern ist, ob sie aktiv ist, sowie ihre geplante Auslastung je Periode und ob diese in Prozent oder in Stunden geplant ist. Nie gesendet: E-Mail-Adressen, Notizverläufe, Telefonnummer, Standort, Geburtstag, Notizen und Abwesenheitsstunden einer Person, Notizen, Einfluss und Interesse eines Stakeholders sowie Art und Notiz einer Abwesenheit. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Entwurf des Lenkungsausschuss-Berichts | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Die Tagesordnung, die Sie eingegeben haben, Ihr Betriebsleitfaden für diesen Bericht, falls vorhanden, eine Statusübersicht: Gesamtstatus (RAG), Aufgabenzahlen, Anzahl überfälliger und bald fälliger Aufgaben, Anzahl der RAID-Einträge und Änderungen, bis zu fünf Änderungstitel sowie Namen und Termine überfälliger, gefährdeter und bald fälliger Meilensteine; und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit. Keine E-Mail-Adressen und keine weiteren Namen von Personen, außer sie stehen in einem Titel oder in der Tagesordnung. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Text der Zusammenfassung, auf Anfrage | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Gesamtstatus (RAG), die Anzahl überfälliger Aufgaben, die Anzahl offener und hoch eingestufter RAID-Einträge sowie Namen und Termine bald fälliger Meilensteine, dazu Ihr Betriebsleitfaden für die Zusammenfassung, falls vorhanden. Keine Namen von Personen, keine Notizen und keine E-Mail-Adressen, außer sie stehen im Namen eines Meilensteins. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Prognose-Import aus einer Tabelle | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Das Blatt, das Sie auswählen, mit seinem Namen (bei einer CSV-Datei der Dateiname ohne Endung), als Tabelle seiner nicht leeren Zellen (ein Blatt, das für eine Anfrage zu groß ist, wird nicht gesendet), dazu Ihr Betriebsleitfaden für den Import, falls vorhanden. Gesendet wird alles, was das Blatt enthält: meist Namen von Personen und geplante Stunden, dazu ihre E-Mail-Adressen und Stundensätze, wenn das Blatt sie enthält. Keine weiteren Projektdaten. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Insight-Empfehlung, auf Anfrage | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Der Projektname, das heutige Datum, Art, Schweregrad und Kennzahlen des Insights, die Titel von bis zu 30 Aufgaben, die Namen von bis zu 30 Personen (aktive Ressourcen und Zuständige offener Aufgaben) und der Eintrag, um den es geht: ein Meilenstein mit Beschreibung, ein RAID-Eintrag mit Verantwortlichem und Gegenmaßnahme oder Berufsbezeichnung, Abteilung und Firma einer Person. Bei einem Arbeitszeit-Insight aus Timelog betreffen die Kennzahlen eine Person: ihren Namen und ihre Timelog-Benutzernummer, an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung, sowie das erste und das letzte betroffene Datum. Außerdem wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit, und Ihr Betriebsleitfaden für Empfehlungen, falls vorhanden. Keine E-Mail-Adressen und keine Notizen zu Ressourcen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Nächste Schritte mit KI analysieren | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Der Projektname, das heutige Datum, Projektmodus und aktivierte Module, geplantes, tatsächliches und prognostiziertes Budget, die Liste der nächsten Schritte (Titel und Gründe), offene Aufgaben (Titel, Status, Priorität, Zuständige, Fälligkeit), aktive RAID-Einträge (Kategorie, Schweregrad, Status, Verantwortliche, Zieldatum, Datum der letzten Änderung), Meilensteine, offene Änderungen, Namen von Stakeholdern mit Titel, Organisation oder Kategorie und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit; dazu Ihr Betriebsleitfaden für Analysen, falls vorhanden. Keine Beschreibungen, Notizen oder E-Mail-Adressen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Vorschlag für die Ressourcenplanung | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anfrage, Ihr Betriebsleitfaden, falls vorhanden, Planungszeitraum und Perioden, die Länge eines Arbeitstags und die Planwährung sowie für jede Person im Ressourcenverzeichnis: ihr Name (oder ihre Nummer im Ressourcenverzeichnis, wenn kein Name eingetragen ist), Rolle, ob sie extern ist, ob ihre Auslastung in Prozent oder in Stunden geplant ist, geplante und verfügbare Stunden je Periode und bei einer internen Person mit Rolle der interne Stundensatz dieser Rolle. Abwesenheiten fließen in die verfügbaren Stunden ein und werden nicht gesendet. Außerdem bis zu 150 offene Aufgaben, jeweils mit Titel, zuständiger Person (als Name, wenn sie nicht zu den aufgeführten Personen gehört), Restschätzung, Start- und Fälligkeitsdatum, Status, ob sie aus Jira synchronisiert ist, den offenen Aufgaben, auf die sie wartet, ihren Meilensteinen und ihren Stunden je Periode; bis zu 40 Meilensteine mit Name, Datum und ob sie erreicht sind; und welche der aufgeführten Personen für jeden Meilenstein verantwortlich (R) oder rechenschaftspflichtig (A) sind. Teilt das Projekt eine Turso-Datenbank mit anderen Projekten und ist eine Person hier einer Person in einem anderen Projekt zugeordnet, das seine Personen nicht vor der KI schützt, werden zusätzlich der Name dieses Projekts, die dort für die Person gebuchten Stunden je Zeitraum sowie ihre Anzahl offener Aufgaben und die Reststunden dort gesendet (keine Aufgabentitel). Die Namen anderer Projekte, die nicht gelesen werden konnten oder wegen ihres Personenschutzes ausgelassen wurden, werden ebenfalls gesendet. | Nicht verfügbar: Die Funktion ist ausgeblendet, solange der Schutz aktiv ist. Wo sie verfügbar ist, werden andere Projekte, die ihre Personen schützen, bei den von dort gezählten Stunden ausgelassen. |
| RACI-Vorschlag | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Namen, Titel, Organisationen, Kategorien, Einfluss und Interesse der Stakeholder; Namen, Termine und Beschreibungen der Meilensteine; die bestehenden RACI-Zuordnungen; und Ihr Betriebsleitfaden, falls vorhanden. Keine E-Mail-Adressen. | Nicht verfügbar: Die Funktion ist bei eingeschaltetem Schutz ausgeblendet. |
| Prüfung auf doppelte Aufgaben | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Für jede Aufgabe: Nummer, Status, Fälligkeit, Titel, Zuständige und die ersten 200 Zeichen der Beschreibung, dazu Ihr Betriebsleitfaden, falls vorhanden. Keine E-Mail-Adressen und keine Notizverläufe. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Vorschlag für den Projektstrukturplan (PSP) | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anweisung, Ihr Betriebsleitfaden, falls vorhanden, Projektname und -zeitraum, Gruppen, Meilensteine, für jede Aufgabe: Name, Gruppe, Status, Start- und Fälligkeitsdatum, Schätzung, Abhängigkeiten, Zuständige und eine gekürzte Beschreibung; und wer im Projektzeitraum abwesend ist (ab heute oder ab Projektbeginn, wenn dieser später liegt, bis zum Projektende; die nächsten 28 Tage ab heute, wenn das Projekt kein Enddatum hat oder sein Enddatum vor heute oder vor dem Projektbeginn liegt): der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit. Keine E-Mail-Adressen und keine Notizverläufe. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Gewichtungsvorschlag für die nächsten Schritte | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Der Projektname, die Titel von Aufgaben, RAID-Einträgen, Meilensteinen und Änderungen, die Liste der nächsten Schritte, Ihre aktuellen Gewichtungen und Lernzähler, eine Trendübersicht und Namen von Stakeholdern, dazu Ihr Betriebsleitfaden für Gewichtungsvorschläge, falls vorhanden. Keine Beschreibungen, Notizen oder E-Mail-Adressen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Vorschlag für ein neues Projekt (Projektassistent) | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Nur, was Sie dem Assistenten geben: die Beschreibung, die Sie eingeben, die Dateien, die Sie anhängen (eine E-Mail mit ihrem Text sowie Namen und Adressen von Absender und Empfängern), und die SharePoint-Dateien und Confluence-Seiten, die Sie auswählen, dazu Ihr Betriebsleitfaden, falls vorhanden. Keine Daten aus bestehenden Projekten. | E-Mail-Adressen, Telefonnummern und IBANs werden immer durch Platzhalter ersetzt. Namen können nicht ersetzt werden: Ein neues Projekt kennt noch keine Personen, daher werden Namen in Ihrer Beschreibung und in Dateien, die Sie dem Assistenten hinzufügen, gesendet. Bilder sowie gescannte oder PDF-Dokumente werden ebenfalls gesendet, sofern Ihre Organisation den Schutz nicht erzwingt; dann werden sie abgelehnt. Der Vorschlag der KI wird ohne Personen übernommen: kein Sponsor, keine Projektleitung, keine Stakeholder, Ressourcen, Zuständigen oder Verantwortlichen. |
| Diktat per Spracherkennung | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Wählen Sie einen Spracherkennungsdienst, gehen das aufgenommene Audio und der API-Schlüssel dieses Dienstes über eine Server-Route dieser App an den von Ihnen eingerichteten Sprachdienst, nicht an Anthropic. Ohne diese Zustimmung, solange die KI ausgeschaltet ist oder solange Adresse oder Schlüssel dieses Dienstes fehlen oder auf diesem Gerät nicht gelesen werden können, ist das Diktat über diesen Dienst nicht verfügbar; es wechselt nie von selbst zu einer anderen Engine. Nur wenn Sie stattdessen das Browser-Diktat wählen oder diese Installation die Spracherkennung abgeschaltet hat, verwendet es die eingebaute Spracherkennung des Browsers, die in manchen Browsern Audio an einen Dienst des Browserherstellers sendet. | Nicht verfügbar: Die Funktion ist bei eingeschaltetem Schutz ausgeschaltet. |
| Analyse durch geplante Aufträge | Wird auf jedem Gerät gesondert abgefragt und zählt nur zusammen mit der interaktiven Zustimmung; bei denselben Änderungen erneut abgefragt | Die Anweisung des Auftrags und für das Projekt, das er abdeckt, dieselbe Übersicht wie bei „Nächste Schritte mit KI analysieren“: der Projektname, das heutige Datum, Projektmodus und aktivierte Module, geplantes, tatsächliches und prognostiziertes Budget, die Liste der nächsten Schritte (Titel und Gründe), offene Aufgaben (Titel, Status, Priorität, Zuständige, Fälligkeit), aktive RAID-Einträge (Kategorie, Schweregrad, Status, Verantwortliche, Zieldatum, Datum der letzten Änderung), Meilensteine, offene Änderungen, Namen von Stakeholdern mit Titel, Organisation oder Kategorie und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit; dazu Ihr Betriebsleitfaden für Analysen, falls vorhanden. Keine Beschreibungen, Notizen oder E-Mail-Adressen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Automatische Insight-Empfehlungen | Wird auf jedem Gerät gesondert abgefragt und zählt nur zusammen mit der interaktiven Zustimmung; bei denselben Änderungen erneut abgefragt | Der Projektname, das heutige Datum, Art, Schweregrad und Kennzahlen des Insights, die Titel von bis zu 30 Aufgaben, die Namen von bis zu 30 Personen (aktive Ressourcen und Zuständige offener Aufgaben) und der Eintrag, um den es geht: ein Meilenstein mit Beschreibung, ein RAID-Eintrag mit Verantwortlichem und Gegenmaßnahme oder Berufsbezeichnung, Abteilung und Firma einer Person. Bei einem Arbeitszeit-Insight aus Timelog betreffen die Kennzahlen eine Person: ihren Namen und ihre Timelog-Benutzernummer, an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung, sowie das erste und das letzte betroffene Datum. Außerdem wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit, und Ihr Betriebsleitfaden für Empfehlungen, falls vorhanden. Keine E-Mail-Adressen und keine Notizen zu Ressourcen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Text der Zusammenfassung, geplant | Wird auf jedem Gerät gesondert abgefragt und zählt nur zusammen mit der interaktiven Zustimmung; bei denselben Änderungen erneut abgefragt | Gesamtstatus (RAG), die Anzahl überfälliger Aufgaben, die Anzahl offener und hoch eingestufter RAID-Einträge sowie Namen und Termine bald fälliger Meilensteine, dazu Ihr Betriebsleitfaden für die Zusammenfassung, falls vorhanden. Keine Namen von Personen, keine Notizen und keine E-Mail-Adressen, außer sie stehen im Namen eines Meilensteins. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
<!-- PACK:ai-paths:END -->
