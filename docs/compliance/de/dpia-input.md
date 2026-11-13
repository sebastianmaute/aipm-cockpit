# Angaben für die Datenschutz-Folgenabschätzung

## Über dieses Dokument

Dieses Dokument beschreibt die Verarbeitung in AI PM Cockpit in der Reihenfolge, in der eine
Datenschutz-Folgenabschätzung sie durchgeht: was verarbeitet wird, über wen, wer es erhält, wohin es geht,
die Risiken und die Maßnahmen, die ihnen begegnen. Es richtet sich an Datenschutzbeauftragte und alle, die
bei der Abschätzung mitwirken. Wann der handgeschriebene Text zuletzt geprüft wurde, steht in der
[Prüfzeile](README.md#stand-des-textes) der README.

Dieses Dokument ist Material für Ihre eigene Arbeit. Es ist keine Rechtsberatung und keine fertige
Abschätzung. Ob Ihre Nutzung der App eine Abschätzung erfordert und zu welchem Ergebnis die Abschätzung
kommt, entscheiden Sie. [Frage an Sie]

Eine Abschätzung enthält zumindest eine Beschreibung der Verarbeitung und ihrer Zwecke, eine Bewertung
ihrer Notwendigkeit und Verhältnismäßigkeit, eine Bewertung der Risiken für die betroffenen Personen und
die zur Bewältigung dieser Risiken geplanten Abhilfemaßnahmen. [extern: Verordnung (EU) 2016/679, Art. 35
Abs. 7, Amtsblatt L 119 vom 4. Mai 2016, gelesen beim Amt für Veröffentlichungen der EU unter
http://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1 am 2026-11-13] Dieses
Dokument liefert Material für die Beschreibung, die Risiken und die Maßnahmen. Notwendigkeit und
Verhältnismäßigkeit hängen von Ihren Zwecken ab und sind von Ihnen zu bewerten. [Frage an Sie]

## Zwecke

Die App ist ein Projektmanagement-Werkzeug. Sie enthält Aufgaben, Risiken, Probleme und Entscheidungen
(RAID), Meilensteine, Änderungen, Stakeholder, ein Ressourcenverzeichnis mit Auslastungs- und
Abwesenheitsplanung, Budgets, aus Timelog importierte Zeitbuchungen und Dokumente. [geprüft:
`src/app/types.ts`, `src/app/nav-config.ts`] Ihre KI-Funktionen, alle optional, entwerfen und analysieren:
ein Chat-Assistent, Bearbeitungen einzelner Zeilen, Berichtsentwürfe, Vorschläge für Zuteilungen und
RACI, Vorschläge für den Projektstrukturplan, Dublettenprüfungen und Zusammenfassungen. Jede ist
[unten](#was-die-ki-funktionen-senden) mit dem aufgeführt, was sie sendet. [geprüft:
`src/app/ai-disclosure.ts`] KI ist ausgeschaltet, bis ein Nutzer sie einschaltet und einen Hinweis darauf
annimmt, was jede Funktion sendet. [geprüft: `isInteractiveAiAllowed` in `src/app/ai-consent.ts`]

Welche dieser Funktionen Ihre Organisation nutzt, zu welchen Zwecken und auf welcher Rechtsgrundlage,
haben Sie anzugeben. Sagen Sie insbesondere, ob ein Zweck die Planung, Überwachung oder Bewertung von
Beschäftigten einschließt, denn mehrere Funktionen lassen sich so nutzen (siehe die [Anlage für den
Betriebsrat](works-council-annex.md)). [Frage an Sie]

## Datenkategorien

Die vollständige Liste der personenbezogenen Daten, die die App enthält, mit dem Code, der jede davon
festlegt, steht in den [Angaben für das Verzeichnis von
Verarbeitungstätigkeiten](record-of-processing-input.md#felder-des-verzeichnisses), Zeile „c) Kategorien
personenbezogener Daten“. Sie wird hier nicht wiederholt. [geprüft: siehe diese Zeile] Für die
Abschätzung verdienen diese Kategorien Aufmerksamkeit:

- **Abwesenheiten mit ihrer Art.** Eine Abwesenheit hält die Person, die Daten und eine Art (Urlaub,
  Krankheit, Schulung oder Sonstiges) fest, dazu eine Notiz. [geprüft: `Absence` und `AbsenceType` in
  `src/app/types.ts`] Ob eine Abwesenheit der Art „Krankheit“ bei Ihrer Nutzung Gesundheitsdaten
  darstellt, entscheiden Sie. [Frage an Sie]
- **Erfasste Arbeitszeit.** Mit der Timelog-Integration importiert die App die erfassten Stunden jeder
  Person und prüft sie anhand von Regeln: ein einzelner Eintrag oder die Tagessumme über einem Grenzwert,
  mehr Stunden als die festgelegten Stunden der Person, Zeit an einem arbeitsfreien Tag oder an einem Tag,
  an dem die Person abwesend war, und Änderungen in einem abgeschlossenen Monat. Jede Regel, die
  anschlägt, wird zu einem Insight, das die Person nennt. [geprüft: `INSIGHT_TYPES` in
  `src/app/insights/insight.ts`, `src/app/timelog-policy.ts`] Solange ein Projekt seine Timelog-Funktion
  ausblendet oder der Administrator die Integration `timelog` abschaltet, enden die Prüfungen, und kein
  Timelog-Befund erreicht die KI; der Schalter des Administrators wird beim nächsten Laden der Seite wirksam
  und gilt für die Bereitstellung, nicht für das Projekt. Die importierten Zahlen bleiben auf dem Gerät
  zwischengespeichert. [geprüft: `src/app/use-insight-lifecycle.ts`, `withTimelog` in
  `src/app/insights/insight-prompt.ts`, `src/app/integration-switches.ts`]
- **Aufgabenzahlen je Person.** Die Berichtsansicht enthält eine Tabelle je zugewiesener Person: Aufgaben
  insgesamt, offen, erledigt und überfällig, pünktlich oder verspätet gelieferte Aufgaben und gesendete
  Statusanfragen. Berichte gehören zu jedem Projekt und lassen sich nicht abschalten. [geprüft:
  `byAssignee` in `src/app/reports-stats.ts`; `CORE_VIEWS` in `src/app/feature-modules.ts`]
- **Verfasser von Notizen und Blockern.** Hat ein Nutzer auf seinem Gerät festgelegt, welche Person er
  ist, speichern die Einträge in Notiz- und Blocker-Verläufen, die er schreibt, den Namen und die
  Ressourcen-ID dieser Person mit dem Zeitpunkt. [geprüft: `NoteLogEntry`, `BlockerEntry` in
  `src/app/types.ts`; `selfResourceId` in `src/app/settings-types.ts`]
- **Bewertungen von Personen.** Stakeholder tragen eine Bewertung von Einfluss und Interesse sowie
  RACI-Rollen. [geprüft: `Stakeholder` in `src/app/types.ts`]
- **Stundensätze.** Stundensätze werden je Rolle geführt, nicht je Person, aber eine Person mit einer
  Rolle ist mit deren Satz verknüpft, und der Zuteilungsvorschlag sendet ihn (§804). [geprüft: `Role` in
  `src/app/types.ts`; die Zeile „Vorschlag für die Ressourcenplanung“ in der Tabelle unten]
- **Freitext.** Aufgabenbeschreibungen, Notizverläufe, RAID-Einträge, Änderungen, Dokumente, angehängte
  Dateien und E-Mails können alles enthalten, was Nutzer schreiben oder anhängen. [geprüft:
  `src/app/types.ts`] Was Beschäftigte dort schreiben dürfen, entscheiden Sie. [Frage an Sie]
- **Das Aktivitätsprotokoll.** Es bewahrt die alten und neuen Werte geänderter Felder auf, die auch Namen
  von Personen enthalten können, und hält fest, ob ein Nutzer, die KI oder eine Integration eine Änderung
  vorgenommen hat, nicht aber, welcher Nutzer. [geprüft: `ActivityActor` und `ACTIVITY_MAX_ENTRIES` in
  `src/app/activity-log.ts`]

## Betroffene Personen

- **Beschäftigte.** Personen im Ressourcenverzeichnis, Zugewiesene und Zuständige von Aufgaben,
  Zuständige von RAID-Einträgen, Personen mit Abwesenheiten und mit erfasster Arbeitszeit. [geprüft:
  `Resource`, `Task`, `RaidItem`, `Absence` in `src/app/types.ts`]
- **Externe Personen.** Externe Personen im Ressourcenverzeichnis, Stakeholder wie Mitglieder des
  Lenkungsausschusses sowie Absender und Empfänger von E-Mails, die an einen Chat oder an den
  Projektassistenten angehängt werden. [geprüft: `Resource` und `Stakeholder` in `src/app/types.ts`; die
  Zeilen zum Chat und zum Projektassistenten in der Tabelle unten]
- **Nutzer der App.** Ihre gespeicherten KI-Chats, die statt eines Namens eine zufällige Eigentümer-ID
  tragen, und die Einstellungen auf ihrem Gerät. [geprüft: `src/app/chat-crypto.ts`; die Angaben für das
  Verzeichnis von Verarbeitungstätigkeiten, „Gespeicherte KI-Chats“] Die App hat keine Benutzerkonten.
  [Aussage des Maintainers; `docs/security.md`, Abschnitt „Security model“]

Welche Gruppen bei Ihrer Nutzung vorkommen und ob eine von ihnen gegenüber Ihrer Organisation in einer
schwächeren Position ist, bewerten Sie. [Frage an Sie]

## Empfänger

Die meisten Empfänger sind Dienste, die ein Nutzer oder Ihr Administrator einrichtet, jeweils mit einem
Schlüssel oder einer Anmeldung, die dem Nutzer oder Ihrer Organisation gehört. Drei werden ohne einen
solchen erreicht: der Kurs-Feed der Europäischen Zentralbank, GitHub für die Update-Prüfung der
Desktop-App und, beim Browser-Diktat, der Browserhersteller. [geprüft: `src/app/outbound-destinations.ts`,
`desktop/src/updater.ts`; die Zeile zum Diktat in der Tabelle unten] Die Empfänger:

- **Anthropic**, für die KI-Funktionen, direkt aus dem Browser oder über den Server der App und, wo Ihr
  Administrator eines einrichtet, über das KI-Gateway Ihrer Organisation. [geprüft:
  `src/app/ai-disclosure.ts`, `src/app/outbound-destinations.ts`]
- **Der Speech-to-Text-Dienst**, den ein Nutzer für das Diktat einrichtet. [geprüft: die Zeile zum Diktat
  in der Tabelle unten]
- **Microsoft 365, Turso, Atlassian (Jira, Confluence) und Timelog**, wenn Nutzer oder Ihr Administrator diese
  Integrationen einrichten. [geprüft: `src/proxy.ts`, `src/app/outbound-destinations.ts`]
- **Die Europäische Zentralbank**, für Wechselkurse. Sie erhält keine Projektdaten, sieht aber die
  IP-Adresse des Servers, in der Desktop-App die des Computers des Nutzers. Ein Schlüssel ist nicht
  beteiligt. [geprüft: `src/app/outbound-destinations.ts`]
- **GitHub**, für die Update-Prüfungen der Desktop-App: Die Anfrage trägt die IP-Adresse des Computers und
  eine feste Kennung, die für jede Installation gleich ist, und keine Projektdaten. Ein Administrator kann die
  Prüfungen mit `AIPM_DISABLE_UPDATE_CHECK=1` abstellen. [geprüft: `desktop/src/updater.ts`,
  `desktop/src/updater.test.ts`, `src/app/deployment-variables.ts`; siehe [Berührungspunkte mit dem
  Maintainer](vendor-touchpoints.md#updates)]
- **Der Browserhersteller**, wenn ein Nutzer das Browser-Diktat wählt: Die eingebaute Spracherkennung des
  Browsers sendet in manchen Browsern Audio an den Dienst des Browserherstellers. Die App hat darauf
  keinen Einfluss. [geprüft: die Zeile zum Diktat in der Tabelle unten; `docs/security.md`]

Der Maintainer erhält zur Laufzeit nichts aus der App und ist kein Empfänger; siehe [Berührungspunkte mit
dem Maintainer](vendor-touchpoints.md#was-beim-maintainer-ankommt). [Aussage des Maintainers; die Hosts:
geprüft, `src/proxy.ts`, `src/app/outbound-destinations.ts`]

Das Data Processing Addendum von Anthropic legt fest, dass für personenbezogene Daten des Kunden der Kunde
Verantwortlicher und Anthropic Auftragsverarbeiter des Kunden ist. [extern: Anthropic Data Processing
Addendum, https://www.anthropic.com/legal/data-processing-addendum, gültig ab 24. Februar 2025, gelesen am
2026-11-13] Die Commercial Terms von Anthropic legen fest, dass Anthropic keine Modelle mit
Kundeninhalten aus seinen Diensten trainieren darf. [extern: Anthropic Commercial Terms of Service,
Abschnitt B, https://www.anthropic.com/legal/commercial-terms, gültig ab 17. Juni 2025, gelesen am
2026-11-13] Zu wessen Anthropic-Konto ein Schlüssel gehört, entscheidet, wer dieser Kunde ist; die
[Berührungspunkte mit dem Maintainer](vendor-touchpoints.md#rollen) erklären, wie ein Administrator die App auf
die Schlüssel Ihrer Organisation beschränken kann. [geprüft: `src/app/ai-key-restriction-config.ts`]
Welcher Vertrag jeden Empfänger abdeckt und in welcher Rolle, stellen Sie fest. [Frage an Sie]

## Übermittlungen außerhalb der EU

**KI-Anfragen.** Die App legt nicht fest, wo Anthropic eine Anfrage verarbeitet: Sie sendet keinen
Parameter `inference_geo`. [geprüft: keine Verwendung von `inference_geo` in `src/`] Anthropic
dokumentiert für diesen Parameter zwei Werte, `global` (die Voreinstellung; die Inferenz kann in jeder
verfügbaren Geografie laufen) und `us`, sowie eine Workspace-Einstellung, die die Voreinstellung und die
erlaubten Werte festlegt. Davon getrennt bestimmt die Workspace-Geo, wo Daten gespeichert werden und wo
Verarbeitung am Endpunkt stattfindet, und `us` ist derzeit die einzige verfügbare Workspace-Geo. [extern:
Claude Platform Docs, „Data residency“, https://platform.claude.com/docs/en/manage-claude/data-residency,
gelesen am 2026-11-13] Eine KI-Anfrage aus der App wird also in den Vereinigten Staaten oder, unter
`global`, in jeder Geografie verarbeitet, die Anthropic nutzt, und in den Vereinigten Staaten gespeichert.
[die Seite der App: geprüft wie oben; die Seite von Anthropic: extern, dieselbe Seite, gelesen am
2026-11-13]

Das Data Processing Addendum von Anthropic bezieht die Standardvertragsklauseln, Modul Zwei und/oder
Drei, ein, soweit das Datenschutzrecht sie verlangt. [extern: Anthropic Data Processing Addendum,
https://www.anthropic.com/legal/data-processing-addendum, gültig ab 24. Februar 2025, gelesen am
2026-11-13]

**Wie lange Anthropic Anfragen aufbewahrt.** Das Privacy Center von Anthropic sagt, dass Anthropic Ein-
und Ausgaben in seinem Backend innerhalb von 30 Tagen nach Eingang oder Erzeugung löscht, sofern nichts
anderes vereinbart ist (sein Beispiel ist eine Vereinbarung über Zero Data Retention); dass Ein- und
Ausgaben, die seine Trust-and-Safety-Systeme markieren, bis zu 2 Jahre und ihre Klassifizierungswerte bis
zu sieben Jahre aufbewahrt werden; und dass Daten länger aufbewahrt werden können, wo das Gesetz es
verlangt oder um seine Nutzungsrichtlinie durchzusetzen. [extern: Anthropic Privacy Center, „How long do
you store my organization's data?“,
https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data, zuletzt
aktualisiert am 1. Juli 2026, gelesen am 2026-11-13] Ein KI-Gateway, das Ihre Organisation betreibt,
bewahrt auf, was seine eigenen Einstellungen vorsehen. [Aussage des Maintainers]

**Andere Dienste.** Wo Microsoft 365, Turso, Atlassian, Timelog und ein Speech-to-Text-Dienst Daten
verarbeiten und speichern, hängt von Ihren Konten und Verträgen mit ihnen ab. [Frage an Sie]

Welche Inferenz-Einstellung Ihr Anthropic-Workspace verwendet, welche Garantie für die Übermittlung bei
jedem Dienst gilt und ob das für Ihre Daten annehmbar ist, entscheiden und dokumentieren Sie. [Frage an
Sie]

## Was die KI-Funktionen senden

Die Tabelle ist die eigene Liste der App mit jeder Funktion, die Daten an einen KI- oder Sprachdienst
sendet. Der Zustimmungsdialog zeigt dieselben Zeilen, und ein Test schlägt fehl, wenn eine in
`src/test/ai-activation-sites.ts` aufgeführte KI-Aufrufstelle keine Zeile hat. [geprüft:
`src/app/ai-disclosure.ts`, `src/app/ai-disclosure.test.ts`] Die letzte Spalte sagt, was der
Personenschutz ändert. Der Schutz ist in jedem Projekt standardmäßig eingeschaltet; ein Nutzer kann ihn
für ein Projekt in den Einstellungen ausschalten, und ein Administrator kann ihn mit
`AIPM_DISABLED_INTEGRATIONS=ai-people` für jedes Projekt erzwingen. [geprüft:
`src/app/ai-people-protection.ts`, `src/app/settings-sections/ai-people-protection-control.tsx`,
`src/app/deployment-variables.ts`] Die drei Zeilen, deren Zustimmung „gesondert“ abgefragt wird, laufen
im Hintergrund, solange die App geöffnet ist, ohne dass eine Person jeden Lauf startet (§795). [geprüft:
`level: "background"` in `src/app/ai-disclosure.ts`; `src/app/use-scheduled-job-runner.ts`,
`src/app/use-insight-recommend-runner.ts`, `src/app/use-digest.ts`]

<!-- PACK:ai-paths:BEGIN -->
| Funktion | Zustimmung | Was gesendet wird | Bei aktivem Personenschutz |
|---|---|---|---|
| Chat mit dem KI-Assistenten | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Nachrichten; die Dateien und E-Mails, die Sie anhängen (eine E-Mail mit ihrem Text sowie Namen und Adressen von Absender und Empfängern); Ihre Betriebsleitfäden; und die Projektdaten, die der Assistent zum Antworten liest: Aufgaben mit Beschreibungen und Notizverläufen, Meilensteine, RAID-Einträge, Änderungen, Stakeholder, Personen im Ressourcenverzeichnis, Abwesenheiten (nur als „absent“, mit Person und Datum), Budgetzahlen, Kalendertermine, Dokumente und Projektangaben sowie, wenn er darin sucht, den Aktivitätsverlauf und Ihre anderen Chats in diesem Projekt. Mit jeder Nachricht erhält er außerdem die Anzahl Ihrer anderen Chats in diesem Projekt sowie Titel und Zeitpunkt der letzten Aktivität von bis zu drei der zuletzt geführten (ein unbenannter Chat erhält den Anfang seiner ersten Nachricht als Titel; Chats werden nur mit einer Turso-Datenbank gespeichert) und die offenen Insights des Projekts: bis zu zehn aktuelle und bis zu fünf, auf die Sie reagiert haben, mit ihrem gemessenen Ergebnis, je eine Zeile. Ein Insight aus Timelog nennt eine Person (oder ihre Timelog-Benutzernummer, wenn keine Person im Ressourcenverzeichnis verknüpft ist) mit ihrer erfassten Arbeitszeit: an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung. Namen von Personen sind enthalten. Listenergebnisse enthalten keine E-Mail-Adressen: Der Assistent liest jeweils eine Adresse und nur, wenn er sie braucht; in Anhängen, Dokumenten und protokollierten Änderungen können Adressen dennoch vorkommen. Bei jeder neuen Nachricht wird die gesamte Unterhaltung erneut gesendet. Gespeicherte Chats sind verschlüsselt, sodass nur die Person, die sie geschrieben hat, und der Administrator mit dem Wiederherstellungsschlüssel sie lesen können; jeder Chat wird gelöscht, wenn seit seiner letzten Änderung die Aufbewahrungsfrist vergangen ist (30 Tage, sofern der Administrator nichts anderes festlegt). Ausnahmen: Chats aus einer früheren Version der App, die andere im Projekt bis zu ihrem Ablauf lesen können, sowie die eigenen Protokolle des KI-Gateways, sofern Ihre Organisation eines nutzt. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt, und der Assistent kann niemanden zuweisen, verschieben oder bewerten. Bilder und PDFs werden abgelehnt, solange der Schutz eingeschaltet ist. Namen, die das Projekt nicht kennt und die im Freitext oder in Textanhängen stehen, können weiterhin gesendet werden. |
| KI-Bearbeitung einer Zeile | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anweisung, die eine Zeile, die Sie bearbeiten, und ein kurzer Projektkontext (heutiges Datum, Anzahl der Aufgaben, Gruppen und Labels sowie dieselben Zeilen zu offenen Insights, die der Chat erhält, sodass ein Timelog-Insight eine Person mit ihrer erfassten Arbeitszeit nennen kann), dazu Ihr Betriebsleitfaden für die KI-Bearbeitung, falls vorhanden. Die Zeile enthält Namen, Datumsangaben und Beschreibungen, bei einer Aufgabe ihr Blockerprotokoll mit dem Namen der Person, die den jeweiligen Eintrag erfasst hat; bei einer Person im Ressourcenverzeichnis Name, Berufsbezeichnung, Abteilung, Firma, Rolle, ob sie extern ist, ob sie aktiv ist, sowie ihre geplante Auslastung je Periode und ob diese in Prozent oder in Stunden geplant ist. Nie gesendet: E-Mail-Adressen, Notizverläufe, Telefonnummer, Standort, Geburtstag, Notizen und Abwesenheitsstunden einer Person, Notizen, Einfluss und Interesse eines Stakeholders sowie Art und Notiz einer Abwesenheit. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Entwurf des Lenkungsausschuss-Berichts | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Die Tagesordnung, die Sie eingegeben haben, Ihr Betriebsleitfaden für diesen Bericht, falls vorhanden, eine Statusübersicht: Gesamtstatus (RAG), Aufgabenzahlen, Anzahl überfälliger und bald fälliger Aufgaben, Anzahl der RAID-Einträge und Änderungen, bis zu fünf Änderungstitel sowie Namen und Termine überfälliger, gefährdeter und bald fälliger Meilensteine; und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit. Keine E-Mail-Adressen und keine weiteren Namen von Personen, außer sie stehen in einem Titel oder in der Tagesordnung. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Text der Zusammenfassung, auf Anfrage | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Gesamtstatus (RAG), die Anzahl überfälliger Aufgaben, die Anzahl offener und hoch eingestufter RAID-Einträge sowie Namen und Termine bald fälliger Meilensteine, dazu Ihr Betriebsleitfaden für die Zusammenfassung, falls vorhanden. Keine Namen von Personen, keine Notizen und keine E-Mail-Adressen, außer sie stehen im Namen eines Meilensteins. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Prognose-Import aus einer Tabelle | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Das Blatt, das Sie auswählen, mit seinem Namen (bei einer CSV-Datei der Dateiname ohne Endung), als Tabelle seiner nicht leeren Zellen (ein Blatt, das für eine Anfrage zu groß ist, wird nicht gesendet), dazu Ihr Betriebsleitfaden für den Import, falls vorhanden. Gesendet wird alles, was das Blatt enthält: meist Namen von Personen und geplante Stunden, dazu ihre E-Mail-Adressen und Stundensätze, wenn das Blatt sie enthält. Keine weiteren Projektdaten. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Insight-Empfehlung, auf Anfrage | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Der Projektname, das heutige Datum, Art, Schweregrad und Kennzahlen des Insights, die Titel von bis zu 30 Aufgaben, die Namen von bis zu 30 Personen (aktive Ressourcen und Zuständige offener Aufgaben) und der Eintrag, um den es geht: ein Meilenstein mit Beschreibung, ein RAID-Eintrag mit Zuständigem und Gegenmaßnahme oder Berufsbezeichnung, Abteilung und Firma einer Person. Bei einem Arbeitszeit-Insight aus Timelog betreffen die Kennzahlen eine Person: ihren Namen und ihre Timelog-Benutzernummer, an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung, sowie das erste und das letzte betroffene Datum. Außerdem wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit, und Ihr Betriebsleitfaden für Empfehlungen, falls vorhanden. Keine E-Mail-Adressen und keine Notizen zu Ressourcen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Nächste Schritte mit KI analysieren | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Der Projektname, das heutige Datum, Projektmodus und aktivierte Module, geplantes, tatsächliches und prognostiziertes Budget, die Liste der nächsten Schritte (Titel und Gründe), offene Aufgaben (Titel, Status, Priorität, Zuständige, Fälligkeit), aktive RAID-Einträge (Kategorie, Schweregrad, Status, Zuständige, Zieldatum, Datum der letzten Änderung), Meilensteine, offene Änderungen, Namen von Stakeholdern mit Titel, Organisation oder Kategorie und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit; dazu Ihr Betriebsleitfaden für Analysen, falls vorhanden. Keine Beschreibungen, Notizen oder E-Mail-Adressen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Vorschlag für die Ressourcenplanung | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anfrage, Ihr Betriebsleitfaden, falls vorhanden, Planungszeitraum und Perioden, die Länge eines Arbeitstags und die Planwährung sowie für jede Person im Ressourcenverzeichnis: ihr Name (oder ihre Nummer im Ressourcenverzeichnis, wenn kein Name eingetragen ist), Rolle, ob sie extern ist, ob ihre Auslastung in Prozent oder in Stunden geplant ist, geplante und verfügbare Stunden je Periode und bei einer internen Person mit Rolle der interne Stundensatz dieser Rolle. Abwesenheiten fließen in die verfügbaren Stunden ein und werden nicht gesendet. Außerdem bis zu 150 offene Aufgaben, jeweils mit Titel, zuständiger Person (als Name, wenn sie nicht zu den aufgeführten Personen gehört), Restschätzung, Start- und Fälligkeitsdatum, Status, ob sie aus Jira synchronisiert ist, den offenen Aufgaben, auf die sie wartet, ihren Meilensteinen und ihren Stunden je Periode; bis zu 40 Meilensteine mit Name, Datum und ob sie erreicht sind; und welche der aufgeführten Personen für jeden Meilenstein verantwortlich (R) oder rechenschaftspflichtig (A) sind. Teilt das Projekt eine Turso-Datenbank mit anderen Projekten und ist eine Person hier einer Person in einem anderen Projekt zugeordnet, das seine Personen nicht vor der KI schützt, werden zusätzlich der Name dieses Projekts, die dort für die Person gebuchten Stunden je Zeitraum sowie ihre Anzahl offener Aufgaben und die Reststunden dort gesendet (keine Aufgabentitel). Die Namen anderer Projekte, die nicht gelesen werden konnten oder wegen ihres Personenschutzes ausgelassen wurden, werden ebenfalls gesendet. | Nicht verfügbar: Die Funktion ist ausgeblendet, solange der Schutz aktiv ist. Wo sie verfügbar ist, werden andere Projekte, die ihre Personen schützen, bei den von dort gezählten Stunden ausgelassen. |
| RACI-Vorschlag | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Namen, Titel, Organisationen, Kategorien, Einfluss und Interesse der Stakeholder; Namen, Termine und Beschreibungen der Meilensteine; die bestehenden RACI-Zuordnungen; und Ihr Betriebsleitfaden, falls vorhanden. Keine E-Mail-Adressen. | Nicht verfügbar: Die Funktion ist bei eingeschaltetem Schutz ausgeblendet. |
| Prüfung auf doppelte Aufgaben | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Für jede Aufgabe: Nummer, Status, Fälligkeit, Titel, Zuständige und die ersten 200 Zeichen der Beschreibung, dazu Ihr Betriebsleitfaden, falls vorhanden. Keine E-Mail-Adressen und keine Notizverläufe. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Vorschlag für den Projektstrukturplan (PSP) | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anweisung, Ihr Betriebsleitfaden, falls vorhanden, Projektname und -zeitraum, Gruppen, Meilensteine, für jede Aufgabe: Name, Gruppe, Status, Start- und Fälligkeitsdatum, Schätzung, Abhängigkeiten, Zuständige und eine gekürzte Beschreibung; und wer im Projektzeitraum abwesend ist (ab heute oder ab Projektbeginn, wenn dieser später liegt, bis zum Projektende; die nächsten 28 Tage ab heute, wenn das Projekt kein Enddatum hat oder sein Enddatum vor heute oder vor dem Projektbeginn liegt): der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit. Keine E-Mail-Adressen und keine Notizverläufe. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Gewichtungsvorschlag für die nächsten Schritte | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Der Projektname, die Titel von Aufgaben, RAID-Einträgen, Meilensteinen und Änderungen, die Liste der nächsten Schritte, Ihre aktuellen Gewichtungen und Lernzähler, eine Trendübersicht und Namen von Stakeholdern, dazu Ihr Betriebsleitfaden für Gewichtungsvorschläge, falls vorhanden. Keine Beschreibungen, Notizen oder E-Mail-Adressen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Vorschlag für ein neues Projekt (Projektassistent) | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Nur, was Sie dem Assistenten geben: die Beschreibung, die Sie eingeben, die Dateien, die Sie anhängen (eine E-Mail mit ihrem Text sowie Namen und Adressen von Absender und Empfängern), und die SharePoint-Dateien und Confluence-Seiten, die Sie auswählen, dazu Ihr Betriebsleitfaden, falls vorhanden. Keine Daten aus bestehenden Projekten. | E-Mail-Adressen, Telefonnummern und IBANs werden immer durch Platzhalter ersetzt. Namen können nicht ersetzt werden: Ein neues Projekt kennt noch keine Personen, daher werden Namen in Ihrer Beschreibung und in Dateien, die Sie dem Assistenten hinzufügen, gesendet. Bilder sowie gescannte oder PDF-Dokumente werden ebenfalls gesendet, sofern Ihre Organisation den Schutz nicht erzwingt; dann werden sie abgelehnt. Der Vorschlag der KI wird ohne Personen übernommen: kein Sponsor, keine Projektleitung, keine Stakeholder, Ressourcen und keine Zuständigen für Aufgaben oder RAID-Einträge. |
| Diktat per Spracherkennung | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Wählen Sie einen Spracherkennungsdienst, gehen das aufgenommene Audio und der API-Schlüssel dieses Dienstes über eine Server-Route dieser App an den von Ihnen eingerichteten Sprachdienst, nicht an Anthropic. Ohne diese Zustimmung, solange die KI ausgeschaltet ist oder solange Adresse oder Schlüssel dieses Dienstes fehlen oder auf diesem Gerät nicht gelesen werden können, ist das Diktat über diesen Dienst nicht verfügbar; es wechselt nie von selbst zu einer anderen Engine. Nur wenn Sie stattdessen das Browser-Diktat wählen oder diese Installation die Spracherkennung abgeschaltet hat, verwendet es die eingebaute Spracherkennung des Browsers, die in manchen Browsern Audio an einen Dienst des Browserherstellers sendet. | Nicht verfügbar: Die Funktion ist bei eingeschaltetem Schutz ausgeschaltet. |
| Analyse durch geplante Aufträge | Wird auf jedem Gerät gesondert abgefragt und zählt nur zusammen mit der interaktiven Zustimmung; bei denselben Änderungen erneut abgefragt | Die Anweisung des Auftrags und für das Projekt, das er abdeckt, dieselbe Übersicht wie bei „Nächste Schritte mit KI analysieren“: der Projektname, das heutige Datum, Projektmodus und aktivierte Module, geplantes, tatsächliches und prognostiziertes Budget, die Liste der nächsten Schritte (Titel und Gründe), offene Aufgaben (Titel, Status, Priorität, Zuständige, Fälligkeit), aktive RAID-Einträge (Kategorie, Schweregrad, Status, Zuständige, Zieldatum, Datum der letzten Änderung), Meilensteine, offene Änderungen, Namen von Stakeholdern mit Titel, Organisation oder Kategorie und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit; dazu Ihr Betriebsleitfaden für Analysen, falls vorhanden. Keine Beschreibungen, Notizen oder E-Mail-Adressen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Automatische Insight-Empfehlungen | Wird auf jedem Gerät gesondert abgefragt und zählt nur zusammen mit der interaktiven Zustimmung; bei denselben Änderungen erneut abgefragt | Der Projektname, das heutige Datum, Art, Schweregrad und Kennzahlen des Insights, die Titel von bis zu 30 Aufgaben, die Namen von bis zu 30 Personen (aktive Ressourcen und Zuständige offener Aufgaben) und der Eintrag, um den es geht: ein Meilenstein mit Beschreibung, ein RAID-Eintrag mit Zuständigem und Gegenmaßnahme oder Berufsbezeichnung, Abteilung und Firma einer Person. Bei einem Arbeitszeit-Insight aus Timelog betreffen die Kennzahlen eine Person: ihren Namen und ihre Timelog-Benutzernummer, an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung, sowie das erste und das letzte betroffene Datum. Außerdem wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit, und Ihr Betriebsleitfaden für Empfehlungen, falls vorhanden. Keine E-Mail-Adressen und keine Notizen zu Ressourcen. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Text der Zusammenfassung, geplant | Wird auf jedem Gerät gesondert abgefragt und zählt nur zusammen mit der interaktiven Zustimmung; bei denselben Änderungen erneut abgefragt | Gesamtstatus (RAG), die Anzahl überfälliger Aufgaben, die Anzahl offener und hoch eingestufter RAID-Einträge sowie Namen und Termine bald fälliger Meilensteine, dazu Ihr Betriebsleitfaden für die Zusammenfassung, falls vorhanden. Keine Namen von Personen, keine Notizen und keine E-Mail-Adressen, außer sie stehen im Namen eines Meilensteins. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
<!-- PACK:ai-paths:END -->

## Risiken und Maßnahmen

Die Risiken unten sind die, die der Maintainer in der App selbst sieht. Ihre Abschätzung wird Risiken aus
Ihren Zwecken, Ihren Beschäftigten und Ihrem Umfeld hinzufügen. [Aussage des Maintainers; Ihre Risiken:
Frage an Sie] Jede Maßnahme ist mit ihrem Nachweis und ihren Grenzen im [TOM-Blatt](tom-sheet.md#maßnahmen)
beschrieben; die Spalte „Zeile im TOM-Blatt“ nennt die Zeile. Was offen bleibt, ist mit seinem
Registereintrag aufgeführt und in der [README](README.md#offene-lücken) erläutert. [geprüft: die genannten
Zeilen des TOM-Blatts und Registereinträge]

| Risiko | Was die App tut | Zeile im TOM-Blatt | Was bleibt |
|---|---|---|---|
| Personenbezogene Daten von Beschäftigten und externen Personen gelangen zum KI-Dienstleister, außerhalb der EU | KI ist ausgeschaltet, bis ein Nutzer einen Hinweis je Funktion annimmt. Der Personenschutz, standardmäßig eingeschaltet, ersetzt Namen, E-Mail-Adressen und Telefonnummern bekannter Personen durch Platzhalter und blendet die Funktionen für Zuteilung und RACI aus. Ein Administrator kann KI auf die Anthropic-Schlüssel der Organisation beschränken, über ein Gateway leiten oder abschalten. [geprüft: `src/app/ai-consent.ts`, `src/app/ai-people-protection.ts`, `src/app/ai-key-restriction-config.ts`, `src/app/api/_shared/integration-switch.ts`] | KI-Zustimmung je Gerät; Personenschutz; Schlüsselbeschränkung auf die Organisation; Route über das KI-Gateway; Schalter für Integrationen und KI | Namen, die das Projekt nicht kennt, in Freitext oder Anhängen, werden weiterhin gesendet. Der Projektassistent sendet die Namen in dem, was der Nutzer ihm gibt. Der Schutz wird im Browser durchgesetzt, daher könnte ein veränderter Client ihn umgehen. Interne Stundensätze gehen mit jeder Zuteilungsanfrage mit (§804). Die Gateway-Route wurde nie mit einem echten Gateway erprobt (§802). [geprüft: `src/app/ai-disclosure.ts`; TOM-Blatt] |
| Eine nicht berechtigte Person nutzt den Server der App oder über ihn Ihr KI-Gateway | Nichts in der App: Ihre Server-Routen authentifizieren Aufrufer nicht. [geprüft: die 15 Routendateien unter `src/app/api`] | Zugriff auf Projektdaten regelt Ihr Speicher; Was diese Maßnahmen nicht abdecken | Das KI-Relay fügt das Gateway-Token für jeden Aufrufer hinzu (§805); die Routen für KI und Diktat haben keine Anfragebegrenzung (§806); die Begrenzung der übrigen Routen lässt sich umgehen (§562). Betreiben Sie den Server hinter Ihrer eigenen Zugangskontrolle. [Aussage des Maintainers; wie: Frage an Sie] |
| Eine nicht berechtigte Person liest oder ändert Projektdaten | Über den Zugriff entscheidet der Speicher, den Sie wählen; in den Einstellungen eingegebene Geheimnisse werden auf dem Gerät verschlüsselt gespeichert. [geprüft: `src/app/secrets.ts`; `docs/security.md`, Abschnitt „Security model“] | Geheimnisse verschlüsselt gespeichert; Zugriff auf Projektdaten regelt Ihr Speicher | Innerhalb eines Projekts sieht jeder mit Zugriff alles und kann alles ändern; die App hat keine Rollen. Wer das Turso-Token besitzt, kann jedes Projekt in dieser Datenbank lesen. [Aussage des Maintainers; `docs/security.md`] |
| Die KI ändert Projektdaten, ohne dass eine Person es freigibt | Der Chat hält eine vorgeschlagene Änderung auf einer Prüfkarte zurück, wenn sie etwas löscht, Besprechungsteilnehmern eine E-Mail sendet, den Projektdatensatz bearbeitet, mehr als einen Eintrag ändert, ein Datum auf die Abwesenheit einer Person legt oder solange eine Datei angehängt ist. Die übrigen KI-Funktionen, die Projektdaten ändern, zeigen ihr Ergebnis zuerst (eine Vorschau Eintrag für Eintrag oder ein vorausgefülltes Formular im Projektassistenten) und ändern nichts, bis eine Person es übernimmt. Änderungen durch den Chat werden als Änderungen der KI protokolliert. [geprüft: `shouldStage` in `src/app/chat-proposal.ts`; `src/app/activity-log.ts`; die Nachweise je Funktion stehen in der [Anlage für den Betriebsrat](works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf)] | Prüfung vor KI-Änderungen; Aktivitätsprotokoll | Eine einzelne Chat-Änderung außerhalb dieser Fälle wird sofort ausgeführt (§794). Fremder Text, der über die Werkzeuge des Chats gelesen wird, löst das Zurückhalten nicht aus (§797). Aufgaben, die durch einen übernommenen Projektstrukturplan angelegt wurden, lassen sich nicht rückgängig machen (§796). Das Protokoll verknüpft eine KI-Änderung nicht mit der Chat-Nachricht dahinter (§799). |
| Falsche oder erfundene KI-Ausgaben fließen in Entscheidungen über Personen ein | Vorschläge für Zuteilung und RACI werden Zelle für Zelle mit dem aktuellen und dem vorgeschlagenen Wert angezeigt und lassen sich vor „Übernehmen“ einzeln abwählen; beide sind ausgeblendet, solange der Personenschutz eingeschaltet ist. [geprüft: `src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`, `src/app/use-alloc-plan.tsx`] | Personenschutz; Prüfung vor KI-Änderungen | Die App kann nicht prüfen, ob ein Vorschlag richtig oder fair ist. Dieselbe Anfrage kann von Lauf zu Lauf unterschiedliche Vorschläge ergeben: Die App legt keine Sampling-Temperatur fest. [geprüft: keine Verwendung von `temperature` in `src/app`] Wie Menschen geschult werden, KI-Ausgaben zu beurteilen, ist Ihre Sache (siehe [KI-Kompetenz](ai-literacy.md)). [Frage an Sie] |
| Beschäftigte werden über die App überwacht oder bewertet | Die Funktionen Timelog und Ressourcen lassen sich je Projekt ausblenden; ein Administrator kann die Timelog-Integration für die Bereitstellung abschalten. Ist Timelog aus, enden seine Prüfungen und seine Befunde bleiben von der KI fern. [geprüft: `src/app/feature-modules.ts`, `src/app/deployment-variables.ts`, `src/app/use-insight-lifecycle.ts`] | Schalter für Integrationen und KI | Das Aktivitätsprotokoll, die Notiz- und Blocker-Verläufe mit ihren Verfassern und die Tabelle je Person in den Berichten (Aufgaben offen, erledigt, überfällig, pünktlich, verspätet, Anfragen) lassen sich nicht abschalten. Das Ausblenden der Ressourcen-Funktion hält weder den KI-Chat von Personen und Abwesenheiten noch die Liste, wer abwesend ist, von fünf KI-Funktionen fern (§810). Wer Auslastung, Abwesenheiten und erfasste Arbeitszeit sehen darf, ist innerhalb eines Projekts nicht eingeschränkt. Siehe die [Anlage für den Betriebsrat](works-council-annex.md). [geprüft: `CORE_VIEWS` in `src/app/feature-modules.ts`, `byAssignee` in `src/app/reports-stats.ts`] |
| KI-Läufe senden Projektdaten, ohne dass jemand sie startet | Läufe im Hintergrund brauchen auf jedem Gerät eine zweite Zustimmung, wenden den Personenschutz an und beraten nur: Eine Empfehlung wird erst ausgeführt, wenn eine Person sie bestätigt. [geprüft: `src/app/ai-consent.ts`, `src/app/use-insight-recommendations.ts`, `src/app/scheduled-job-run.ts`] | KI-Zustimmung je Gerät | Läufe werden nicht einzeln freigegeben (§795). |
| Daten werden länger als nötig aufbewahrt | Gespeicherte KI-Chats werden nach einer Aufbewahrungsdauer gelöscht (30 Tage, sofern der Administrator keine andere festlegt), und Nutzer wie Administratoren haben Löschwerkzeuge. [geprüft: `src/app/ai-chat-retention-config.ts`, `scripts/chat-erasure.mjs`] | Gespeicherte KI-Chats: Verschlüsselung, Aufbewahrung, Löschung; Aktivitätsprotokoll | Projektdaten, von Hand gespeicherte Versionen im Versionsverlauf und an andere Dienste gesendete Daten werden nicht nach Alter gelöscht. Siehe die Angaben für das Verzeichnis von Verarbeitungstätigkeiten, [Aufbewahrung und Löschung](record-of-processing-input.md#aufbewahrung-und-löschung). |
| In einer Datei oder in fremdem Text versteckte Anweisungen bringen die KI dazu, gegen die Absicht des Nutzers zu handeln | Solange eine Datei an die Unterhaltung angehängt ist, wartet jede Änderung, die der Chat vorschlägt, auf der Prüfkarte. [geprüft: `stagesWhenUntrusted` in `src/app/chat-send-record.ts`, `shouldStage` in `src/app/chat-proposal.ts`] | Prüfung vor KI-Änderungen | Fremder Text, der über die Werkzeuge des Chats gelesen wird, etwa aus Jira synchronisierte Inhalte, löst das Zurückhalten nicht aus (§797). |
| Ein manipulierter Installer gelangt auf die Computer der Nutzer | Releases tragen eine prüfbare GitHub-Build-Provenienz und eine SBOM-Attestierung. [geprüft: `.github/workflows/release.yml`; `SECURITY.md`] | Integrität der Releases | Kein bisher veröffentlichter Installer ist code-signiert (§487), und das Deinstallationsprogramm wird nicht signiert sein (§793). |
| Menschen können von der KI geschriebenen Text nicht von Text unterscheiden, den eine Person geschrieben hat | Die Bildschirme der App nennen die KI dort, wo ihre Ausgabe angezeigt wird, und das Aktivitätsprotokoll hält Änderungen der KI als solche fest. [geprüft: `actionAiDisclaimer` und `chatProposalTitle` in `src/app/i18n.ts`; `src/app/activity-log.ts`] | Aktivitätsprotokoll | Text, den die KI in Aufgaben, Dokumente und Exporte schreibt, trägt keine maschinenlesbare Markierung (§801). |

Ob diese Maßnahmen für Ihre Risiken ausreichen, beurteilen Sie. [Frage an Sie]

## Fragen für Ihre Bewertung

Die DSFA-Leitlinien der Artikel-29-Datenschutzgruppe nennen neun Kriterien für Verarbeitungen, die
wahrscheinlich ein hohes Risiko mit sich bringen, und sagen, dass in den meisten Fällen eine Verarbeitung,
die zwei davon erfüllt, eine Abschätzung erfordert. [extern: Artikel-29-Datenschutzgruppe, „Guidelines on
Data Protection Impact Assessment (DPIA) and determining whether processing is likely to result in a high
risk“, WP 248 rev.01, angenommen am 4. April 2017, zuletzt überarbeitet und angenommen am 4. Oktober 2017,
https://ec.europa.eu/newsroom/just/document.cfm?doc_id=47711, gelesen am 2026-11-13] Sie sind hier als
Fragen aufgeführt, jeweils mit den Fakten über die App, die dafür von Belang sind. Der Maintainer bewertet
sie nicht: Die Antworten hängen von Ihrer Nutzung ab. [Aussage des Maintainers]

1. **Bewerten oder Einstufen.** Nutzen Sie die Timelog-Regeln, die die erfasste Arbeitszeit einer Person
   markieren, die Auslastungsansicht, die Tabelle je Person in den Berichten oder die Bewertungen von
   Einfluss und Interesse der Stakeholder, um Personen zu bewerten? [Frage an Sie]
   Die Fakten: Diese Funktionen gibt es; sie sind in der [Anlage für den Betriebsrat](works-council-annex.md)
   beschrieben. [geprüft: siehe diese Anlage]
2. **Automatisierte Entscheidungsfindung mit Rechtswirkung oder ähnlich bedeutsamer Wirkung.** Beruhen
   Entscheidungen über Personen auf KI-Ausgaben? [Frage an Sie] Die Fakten: Die KI-Funktionen der App
   schlagen vor; eine Person übernimmt, mit Ausnahme einer einzelnen Chat-Änderung außerhalb der
   Prüfregeln (§794). [geprüft: `shouldStage` in `src/app/chat-proposal.ts`]
3. **Systematische Überwachung.** Kommt das Importieren erfasster Arbeitszeit und ihre Prüfung anhand von
   Regeln bei Ihrer Nutzung einer Überwachung gleich? [Frage an Sie] Die Fakten: Die Prüfungen laufen,
   solange die App geöffnet und die Timelog-Funktion eingeschaltet ist, auf den auf dem Gerät
   zwischengespeicherten Zahlen. [geprüft: `src/app/timelog-policy.ts`, `src/app/use-insight-lifecycle.ts`,
   `src/app/timelog-actuals-store.ts`]
4. **Sensible Daten oder Daten höchst persönlicher Art.** Erfassen Sie krankheitsbedingte Abwesenheiten,
   oder lassen Sie Beschäftigte Gesundheitsangaben oder andere sensible Angaben in Freitext schreiben?
   [Frage an Sie]
5. **Datenverarbeitung in großem Umfang.** Wie viele Personen, Projekte und Geräte sind beteiligt? [Frage
   an Sie]
6. **Abgleichen oder Zusammenführen von Datensätzen.** Die Timelog-Zahlen werden Personen im
   Ressourcenverzeichnis zugeordnet, und in einer gemeinsam genutzten Turso-Datenbank lassen sich Personen
   projektübergreifend verknüpfen, wobei die anderswo für sie gebuchten Stunden in Zuteilungsanfragen
   gesendet werden. [geprüft: `src/app/person-links-schema.ts`; die Zeile „Vorschlag für die
   Ressourcenplanung“ in der Tabelle oben] Geht das über das hinaus, was die betroffenen Personen
   erwarten? [Frage an Sie]
7. **Daten zu schutzbedürftigen Betroffenen.** Die Leitlinien nennen Beschäftigte als Beispiel, wegen des
   Ungleichgewichts zwischen ihnen und dem Verantwortlichen. [extern: WP 248 rev.01, wie oben, gelesen am
   2026-11-13] Wie trifft das auf die Beschäftigten in Ihren Projekten zu? [Frage an Sie]
8. **Innovative Nutzung oder Anwendung neuer technologischer Lösungen.** Die KI-Funktionen nutzen ein
   großes Sprachmodell. [geprüft: `src/app/ai-disclosure.ts`] Werten Sie das in Ihrer Abschätzung als neue
   Technologie? [Frage an Sie]
9. **Verarbeitung, die Personen an der Ausübung eines Rechts oder der Nutzung einer Dienstleistung
   hindert.** Entscheidet irgendeine Nutzung der App in Ihrer Organisation über den Zugang zu Arbeit,
   Vergütung oder einer Dienstleistung? [Frage an Sie]

Weitere Fragen, die nur Sie beantworten können: [Frage an Sie]

- Welche Rechtsgrundlage deckt jeden Zweck ab, und spielt die KI-Zustimmung eines Nutzers auf einem Gerät
  dabei eine Rolle? (Die App hält fest, dass ein Nutzer den Hinweis gesehen hat; siehe die Zeile
  „KI-Zustimmung je Gerät“ im TOM-Blatt.)
- Werden Sie den Personenschutz für jedes Projekt erzwingen, und wer darf ihn für ein einzelnes Projekt
  ausschalten?
- Welche Inferenz- und Speichereinstellungen verwendet Ihr Anthropic-Workspace, und unter wessen Konto
  laufen die Schlüssel Ihrer Nutzer?
- Wer darf den Server der App nutzen, und wie wird das vor ihm durchgesetzt?
- Wer informiert Beschäftigte und externe Personen, und wie? Die [Musterhinweise](model-notices.md) sind
  Vorlagen.
- Wer prüft KI-geschriebene Inhalte, bevor sie das Projekt verlassen, zum Beispiel in Exporten oder
  Berichten?
- Müssen Sie den Betriebsrat vor der Einführung der App beteiligen? Siehe die [Anlage für den
  Betriebsrat](works-council-annex.md).
