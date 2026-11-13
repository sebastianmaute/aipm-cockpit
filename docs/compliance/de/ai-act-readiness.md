# Hinweis zur KI-Verordnung

## Über dieses Dokument

Dieser Hinweis legt dar, wie sich die Verordnung (EU) 2024/1689 (KI-Verordnung) auf AI PM Cockpit
auswirken kann: die Rollen,
wie der Maintainer sie liest, die Transparenzpflichten und wo die App bei ihnen steht, die offene Frage,
ob die Zuteilungs- und RACI-Vorschläge unter die Hochrisiko-Liste fallen, und was ein Betreiber schulden
würde, wenn er entscheidet, dass sie darunter fallen. Er richtet sich an die für KI verantwortliche Person
in Ihrer Organisation sowie an Datenschutzbeauftragte und Betriebsrat, soweit sie diese Arbeit teilen.
Wann der handgeschriebene Text zuletzt geprüft wurde, steht in der [Prüfzeile](README.md#stand-des-textes)
der README.

„Betreiber“ und „Anbieter“ stehen hier im Sinne der KI-Verordnung; „Administrator“ ist, wer die
Installation bereitstellt und verwaltet (siehe [Umfang](README.md#umfang) in der README).

Dieser Hinweis ist Material für Ihre eigene Arbeit. Er ist keine Rechtsberatung. Er kommt zu keinem
Ergebnis darüber, wie die App oder eine ihrer Funktionen einzustufen ist; diese Einstufung nehmen Sie vor,
und sie hängt davon ab, wie Sie die App nutzen. [Frage an Sie]

Die KI-Verordnung ist die Verordnung (EU) 2024/1689. [extern: Amtsblatt, Reihe L,
2024/1689 vom 12. Juli 2024, gelesen beim Amt für Veröffentlichungen der EU unter
http://publications.europa.eu/resource/cellar/dc8116a1-3fe6-11ef-865a-01aa75ed71a1 am 2026-11-13] Sie
wurde durch die Verordnung (EU) 2026/1744 („Digital-Omnibus zur KI“) vom 8. Juli 2026 geändert, die am
dritten Tag nach ihrer Veröffentlichung im Amtsblatt am 24. Juli 2026 in Kraft getreten ist. [extern:
Amtsblatt, Reihe L, 2026/1744 vom 24. Juli 2026, gelesen beim Amt für Veröffentlichungen der EU unter
http://publications.europa.eu/resource/cellar/b459c07f-86fb-11f1-bf5e-01aa75ed71a1 am 2026-11-13] Wo
dieser Hinweis ein Datum oder eine Pflicht nennt, nennt er den Artikel; lesen Sie den Artikel selbst,
bevor Sie sich darauf verlassen. [Aussage des Maintainers]

## Rollen

Die Verordnung bestimmt als Anbieter, wer ein KI-System entwickelt und es unter eigenem Namen in Verkehr
bringt oder in Betrieb nimmt, „sei es entgeltlich oder unentgeltlich“ (Art. 3 Nr. 3), und als Betreiber,
wer ein KI-System in eigener Verantwortung verwendet, außer im Rahmen einer persönlichen und nicht
beruflichen Tätigkeit (Art. 3 Nr. 4). Sie gilt nicht für KI-Systeme, die unter freien und quelloffenen
Lizenzen bereitgestellt werden, es sei denn, sie werden als Hochrisiko-KI-Systeme oder als Systeme, die
unter Artikel 5 oder 50 fallen, in Verkehr gebracht oder in Betrieb genommen (Art. 2 Abs. 12). [extern:
Verordnung (EU) 2024/1689, Art. 2 Abs. 12, Art. 3 Nr. 3 und 4, gelesen am 2026-11-13 wie oben; der
Wortlaut in Anführungszeichen aus der deutschen Sprachfassung, gelesen am 2026-11-13 unter derselben
Adresse]

Die Lesart des Maintainers, die keine rechtliche Schlussfolgerung ist: [Aussage des Maintainers]

- **Der Maintainer** bietet die App unentgeltlich unter der European Union Public Licence 1.2 an
  [geprüft: `LICENSE`, `package.json`] und kann als Anbieter eines KI-Systems gelten, das mit Menschen
  interagiert und Text erzeugt. Nach dieser Lesart hebt die Ausnahme für Open Source die
  Transparenzpflichten aus Artikel 50 nicht auf, die unten beschrieben sind.
- **Ihre Organisation** ist Betreiber, wenn ihre Beschäftigten die App in ihrer Verantwortung nutzen.
- **Anthropic** stellt die KI-Modelle mit allgemeinem Verwendungszweck bereit, die die App aufruft. Die
  App sendet ihre Anfragen an die API von Anthropic, direkt oder über das Gateway Ihrer Organisation.
  [geprüft: `src/app/ai-disclosure.ts`, `src/app/outbound-destinations.ts`]

**Zweckbestimmung (Aussage des Maintainers).** Die KI-Funktionen der App sollen einer Projektleitung
helfen, Projektarbeit zu entwerfen und zu planen. Die Zuteilungs- und RACI-Vorschläge sind Vorschläge zur
Prüfung durch die Projektleitung; sie sind nicht dafür gedacht, Beschäftigte zu bewerten, in eine Rangfolge zu
bringen oder über sie zu entscheiden. Diese Aussage legt nicht fest, wie die App eingestuft wird: Das
bestimmt die eigene Nutzung durch einen Betreiber. Der Maintainer hat die App weder als Hochrisiko-System
eingestuft noch als außerhalb dieser Kategorie. [Aussage des Maintainers]

Ein Betreiber, der die Zweckbestimmung eines KI-Systems ohne Einstufung als Hochrisiko-System so ändert,
dass es zu einem Hochrisiko-System wird, gilt als dessen Anbieter und übernimmt die Pflichten des Anbieters
(Art. 25 Abs. 1 Buchst. c). [extern: Verordnung (EU) 2024/1689, Art. 25 Abs. 1, gelesen am 2026-11-13 wie
oben] Wofür Ihre Organisation die App nutzt, ist daher für Ihre Rolle von Bedeutung. [Frage an Sie]

Der Maintainer hat keine Konformitätsbewertung der App vorgenommen, führt keine technische Dokumentation
in der Form, die die Verordnung für Hochrisiko-Systeme vorschreibt, hat die App nicht in der EU-Datenbank
registriert und bietet weder einen Vertrag noch einen Supportzeitraum. [Aussage des Maintainers]

## Transparenz (Artikel 50)

Artikel 50 gilt ab dem 2. August 2026, dem allgemeinen Geltungsbeginn der Verordnung (Art. 113). Er
verlangt von Anbietern, dafür zu sorgen, dass Menschen erfahren, wenn sie direkt mit einem KI-System
interagieren, sofern das nicht offensichtlich ist (Art. 50 Abs. 1), und dass die synthetischen Text-,
Audio-, Bild- oder Videoinhalte, die ihre Systeme erzeugen, in einem maschinenlesbaren Format
gekennzeichnet und als künstlich erzeugt erkennbar sind (Art. 50 Abs. 2). Die Kennzeichnungspflicht gilt
nicht, soweit ein System eine unterstützende Funktion für die Standardbearbeitung ausführt oder die vom
Betreiber bereitgestellten Eingabedaten oder deren Semantik nicht wesentlich verändert. [extern:
Verordnung (EU) 2024/1689, Art. 50 Abs. 1 und 2 und Art. 113, gelesen am 2026-11-13 wie oben] Für Systeme,
die vor dem 2. August 2026 in Verkehr gebracht wurden, müssen die Anbieter die zur Erfüllung von Art. 50
Abs. 2 nötigen Schritte bis zum 2. Dezember 2026 unternehmen. [extern: Verordnung (EU) 2026/1744, der
Absatz, den sie Art. 111 der Verordnung (EU) 2024/1689 anfügt, gelesen am 2026-11-13 wie oben] Betreiber
haben nach Art. 50 Abs. 4 eine eigene Pflicht für Text, der veröffentlicht wird, um die Öffentlichkeit über
Angelegenheiten von öffentlichem Interesse zu informieren; sie gilt nicht, wenn der Text einer
menschlichen Überprüfung oder redaktionellen Kontrolle unterzogen wurde und jemand die redaktionelle
Verantwortung trägt. [extern: Verordnung (EU) 2024/1689, Art. 50 Abs. 4, gelesen am 2026-11-13 wie oben]
Ob Sie KI-geschriebenen Text aus der App auf diese Weise veröffentlichen, entscheiden Sie. [Frage an Sie]

### Was die App den Nutzern mitteilt

- KI ist ausgeschaltet, bis ein Nutzer sie in den Einstellungen einschaltet und einen Hinweis annimmt,
  der jede KI-Funktion und das, was sie sendet, aufführt. [geprüft: `isInteractiveAiAllowed` in
  `src/app/ai-consent.ts`, `src/app/ai-disclosure.ts`]
- Die Bedienelemente und Ausgaben der KI tragen ihren Namen: Der Chat ist der „Chat mit dem
  KI-Assistenten“ (englisch „AI Assistant“), Zeilenbearbeitungen und andere Einstiegspunkte lauten
  „Claude fragen“ („Ask Claude“), und die Analyse der nächsten Schritte ist mit „KI-generiert – vor dem
  Handeln prüfen.“ („AI-generated — review before acting.“) gekennzeichnet. [geprüft: `aiDataChatLabel`, `inlineAiEdit`, `aiAskClaude` und `actionAiDisclaimer` in
  `src/app/i18n.ts` und `src/app/i18n.de.ts`]
- Änderungen, die der Chat vorschlägt, erscheinen im Chat unter „Vorgeschlagene Änderungen“ („Proposed changes“), und Änderungen, die
  der Chat ausführt, werden im Aktivitätsprotokoll mit der KI als Urheber protokolliert. [geprüft:
  `chatProposalTitle` in `src/app/i18n.ts` und `src/app/i18n.de.ts`; `ActivityActor` in `src/app/activity-log.ts`; der
  Registereintrag §794]

Die App hat keinen Gastzugang und keine eigenen Konten: Wer ein Projekt öffnen kann, hängt davon ab, wem
Sie Zugriff auf dessen Speicher geben. [Aussage des Maintainers; `docs/security.md`, Abschnitt „Security
model“] Ob Personen außerhalb Ihrer Organisation, etwa Mitglieder des Lenkungsausschusses, diesen Zugriff
erhalten, entscheiden Sie. [Frage an Sie] Personen ohne Zugriff auf die App sehen die Arbeit der KI nur in
dem, was Ihre Nutzer an sie weitergeben, etwa in Berichten, E-Mails und Exporten. Wie Sie sie informieren,
entscheiden Sie; die [Musterhinweise](model-notices.md) bieten eine Vorlage. [Frage an Sie]

### Kennzeichnung erzeugter Texte

Die App kennzeichnet Text, den die KI schreibt, nicht maschinenlesbar. Steht dieser Text erst einmal in
einer Aufgabe, einem Dokument, einem Bericht oder einem Export, zeigt nichts darin, dass die KI ihn
geschrieben hat (§801). [Aussage des Maintainers; Register §801] Ob einige der
KI-Wege der App unterstützende Bearbeitung im Sinne der obigen Ausnahme sind, zum Beispiel eine vom Nutzer
angeforderte Bearbeitung einer Zeile, ist eine offene Frage; der Maintainer hat sie nicht entschieden.
[Aussage des Maintainers; Frage an Sie]

## Zuteilungs- und RACI-Vorschläge (Anhang III)

Anhang III führt im Bereich Beschäftigung und Personalmanagement „KI-Systeme, die bestimmungsgemäß für
Entscheidungen, die die Bedingungen von Arbeitsverhältnissen, Beförderungen und Kündigungen von
Arbeitsvertragsverhältnissen beeinflussen, für die Zuweisung von Aufgaben aufgrund des individuellen
Verhaltens oder persönlicher Merkmale oder Eigenschaften oder für die Beobachtung und Bewertung der
Leistung und des Verhaltens von Personen in solchen Beschäftigungsverhältnissen verwendet werden soll“
auf (Nummer 4 Buchstabe b). [extern: Verordnung (EU) 2024/1689,
Anhang III Nummer 4 Buchstabe b, deutsche Sprachfassung, gelesen am 2026-11-13 unter der Adresse oben]
Ein System nach Anhang III ist ausgenommen, wenn es kein erhebliches Risiko einer Beeinträchtigung birgt,
auch indem es das Ergebnis der Entscheidungsfindung nicht wesentlich beeinflusst, und eine von vier
Bedingungen erfüllt: eine eng gefasste Verfahrensaufgabe; die Verbesserung des Ergebnisses einer zuvor
abgeschlossenen menschlichen Tätigkeit; das Erkennen von Entscheidungsmustern, ohne die menschliche
Bewertung zu ersetzen; oder eine vorbereitende Aufgabe für eine Bewertung. Ein System, das Profiling
natürlicher Personen vornimmt, gilt stets als Hochrisiko-System. Ein Anbieter, der sich auf diese Ausnahme
stützt, muss seine Bewertung dokumentieren und das System registrieren (Art. 6 Abs. 3 und 4). [extern:
Verordnung (EU) 2024/1689, Art. 6 Abs. 3 und 4, gelesen am 2026-11-13 wie oben]

Zwei Funktionen stehen Nummer 4 Buchstabe b am nächsten: der Zuteilungsvorschlag („Mit KI planen“), der
geplante Stunden von Personen je Zeitraum und das Verschieben offener Aufgaben zwischen Personen
vorschlägt, und der RACI-Vorschlag, der für jeden Meilenstein vorschlägt, wer verantwortlich
(responsible), rechenschaftspflichtig (accountable), zu konsultieren (consulted) oder zu informieren
(informed) ist. [geprüft: `src/app/alloc-plan/alloc-plan.ts`, `src/app/alloc-plan/alloc-ground-moves.ts`,
`src/app/raci-suggest/raci-suggest.ts`] Der Maintainer hat sie nicht eingestuft. [Aussage des
Maintainers]

### Argumente dafür und dagegen

Argumente dafür, dass sie unter Nummer 4 Buchstabe b fallen könnten: [Aussage des Maintainers; die
Fakten: geprüft wie angegeben]

- Sie teilen benannten Personen Arbeit zu: Der Zuteilungsvorschlag verschiebt Aufgaben und setzt geplante
  Stunden, und der RACI-Vorschlag weist Rollen zu. [geprüft: wie oben]
- Außerhalb dieser beiden Funktionen können auch der Chat und die Zeilenbearbeitung Personen Aufgaben
  zuweisen, solange der Personenschutz aus ist. [geprüft: `PERSON_FIELDS_BY_TOOL` in
  `src/app/ai-person-fields.ts`]
- Solange die Timelog-Funktion eingeschaltet ist, wertet die App die erfasste Arbeitszeit je Person über
  ihre Timelog-Regeln aus, und diese Befunde, die die Person nennen, gehen in Chat-Anfragen und
  Insight-Empfehlungen an die KI. [geprüft: die Zeilen zum Chat und zu den Insights in der Tabelle
  [unten](#ki-funktionen-und-die-gesendeten-daten); `src/app/timelog-policy.ts`,
  `src/app/use-insight-lifecycle.ts`]
- Die Einstufung folgt der Zweckbestimmung und der Nutzung. Ein Betreiber, der die Vorschläge nutzt, um
  zu entscheiden, wer welche Arbeit erledigt, kann sich in dem Bereich bewegen, den der Anhang beschreibt,
  gleich welche Eingaben verwendet werden. [Aussage des Maintainers]

Argumente dafür, dass sie möglicherweise nicht darunter fallen: [Aussage des Maintainers; die Fakten:
geprüft wie angegeben]

- Die Zuteilungsanfrage enthält Rolle, externen Status, Planungsmodus, geplante und verfügbare Stunden und
  Stundensätze der Rollen, nicht Verhalten, Leistungsbewertungen oder persönliche Merkmale;
  Abwesenheiten dienen nur der Berechnung der verfügbaren Stunden. Die RACI-Anfrage enthält Titel,
  Organisationen, Kategorien sowie Einfluss- und Interessenbewertungen der Stakeholder. [geprüft: die
  Zeilen „Vorschlag für die Ressourcenplanung“ und „RACI-Vorschlag“ in der Tabelle unten] Ob eine
  Einfluss- oder Interessenbewertung bei Ihrer Nutzung ein persönliches Merkmal ist, ist eine eigene Frage.
  [Frage an Sie]
- Beide Funktionen schlagen vor. Eine Person sieht jede vorgeschlagene Änderung mit ihrem aktuellen und
  neuen Wert, kann jede davon abwählen und übernimmt sie. [geprüft: `src/app/alloc-plan-modal.tsx`,
  `src/app/raci-suggest-modal.tsx`] Das kann die Bedingung der vorbereitenden Aufgabe aus Art. 6 Abs. 3
  stützen, die weiterhin verlangt, dass das System die Entscheidung nicht wesentlich beeinflusst und kein
  Profiling vornimmt.
- Beide sind optional: KI ist ausgeschaltet, bis sie eingeschaltet wird, und beide Funktionen sind
  ausgeblendet, solange der Personenschutz, der standardmäßig eingeschaltet ist, eingeschaltet ist.
  [geprüft: `src/app/ai-consent.ts`, `src/app/use-alloc-plan.tsx`, `src/app/ai-people-protection.ts`]

Was den Ausschlag gibt, sind Ihr Zweck und Ihre Nutzung, die der Maintainer nicht sehen kann. [Frage an
Sie]

### KI-Funktionen mit Personenbezug

Der Personenschutz kann diese Funktionen zwingend abschalten. Ein Administrator, der
`AIPM_DISABLED_INTEGRATIONS=ai-people` setzt, schaltet den Schutz in jedem Projekt ein; damit sind der
Zuteilungsvorschlag und der RACI-Vorschlag ausgeblendet, die KI kann bei keinem Eintrag eine Person
setzen, ändern oder entfernen, und dem Chat werden seine Werkzeuge für Personen, Abwesenheiten und
Zuteilungen entzogen. Wird stattdessen `ai` gesetzt, ist die gesamte KI abgeschaltet. [geprüft:
`src/app/ai-people-protection.ts`, `src/app/use-alloc-plan.tsx`, `src/app/ai-person-fields.ts`,
`PEOPLE_TOOLS` in `src/app/chat-tool-defs.ts`, `src/app/deployment-variables.ts`] Der Schutz wird in der
App im Browser durchgesetzt, daher könnte ein veränderter Client ihn umgehen. [geprüft: die Zeile
„Personenschutz“ im TOM-Blatt] Ein Betreiber, der diese Funktionen gar nicht nutzen will, kann sie daher
für die gesamte Bereitstellung abschalten und das in seiner eigenen Bewertung festhalten. [Frage an Sie]

Die Tabelle führt die KI-Funktionen auf, deren Anfragen Daten über Personen enthalten können, und was der
Schutz bei jeder bewirkt. Nicht aufgeführt sind nur die beiden Zeilen „Text der Zusammenfassung“ (auf Anfrage und geplant), die Namen nur
enthalten, wo jemand sie in einen Meilensteinnamen geschrieben hat. [geprüft: `PEOPLE_PATH_EXCLUDED_IDS` in
`src/app/compliance/pack-blocks.ts`, `src/app/digest/digest-narrative.ts`]

<!-- PACK:ai-paths-people:BEGIN -->
| Funktion | Zustimmung | Was gesendet wird | Bei aktivem Personenschutz |
|---|---|---|---|
| Chat mit dem KI-Assistenten | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Nachrichten; die Dateien und E-Mails, die Sie anhängen (eine E-Mail mit ihrem Text sowie Namen und Adressen von Absender und Empfängern); Ihre Betriebsleitfäden; und die Projektdaten, die der Assistent zum Antworten liest: Aufgaben mit Beschreibungen und Notizverläufen, Meilensteine, RAID-Einträge, Änderungen, Stakeholder, Personen im Ressourcenverzeichnis, Abwesenheiten (nur als „absent“, mit Person und Datum), Budgetzahlen, Kalendertermine, Dokumente und Projektangaben sowie, wenn er darin sucht, den Aktivitätsverlauf und Ihre anderen Chats in diesem Projekt. Mit jeder Nachricht erhält er außerdem die Anzahl Ihrer anderen Chats in diesem Projekt sowie Titel und Zeitpunkt der letzten Aktivität von bis zu drei der zuletzt geführten (ein unbenannter Chat erhält den Anfang seiner ersten Nachricht als Titel; Chats werden nur mit einer Turso-Datenbank gespeichert) und die offenen Insights des Projekts: bis zu zehn aktuelle und bis zu fünf, auf die Sie reagiert haben, mit ihrem gemessenen Ergebnis, je eine Zeile. Ein Insight aus Timelog nennt eine Person (oder ihre Timelog-Benutzernummer, wenn keine Person im Ressourcenverzeichnis verknüpft ist) mit ihrer erfassten Arbeitszeit: an wie vielen Tagen ein einzelner Eintrag oder die Tagessumme über einem Grenzwert lag, sie mehr als ihre festgelegten Stunden erfasst hat, sie Zeit an einem arbeitsfreien Tag oder an einem Tag ihrer Abwesenheit (Urlaub, Krankheit oder Schulung) erfasst hat oder Zeit in einem abgeschlossenen Monat geändert wurde, mit den höchsten Stunden, dem Grenzwert, sofern es einen gibt, und bei einem abgeschlossenen Monat der Nettoänderung. Namen von Personen sind enthalten. Listenergebnisse enthalten keine E-Mail-Adressen: Der Assistent liest jeweils eine Adresse und nur, wenn er sie braucht; in Anhängen, Dokumenten und protokollierten Änderungen können Adressen dennoch vorkommen. Bei jeder neuen Nachricht wird die gesamte Unterhaltung erneut gesendet. Gespeicherte Chats sind verschlüsselt, sodass nur die Person, die sie geschrieben hat, und der Administrator mit dem Wiederherstellungsschlüssel sie lesen können; jeder Chat wird gelöscht, wenn seit seiner letzten Änderung die Aufbewahrungsfrist vergangen ist (30 Tage, sofern der Administrator nichts anderes festlegt). Ausnahmen: Chats aus einer früheren Version der App, die andere im Projekt bis zu ihrem Ablauf lesen können, sowie die eigenen Protokolle des KI-Gateways, sofern Ihre Organisation eines nutzt. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt, und der Assistent kann niemanden zuweisen, verschieben oder bewerten. Bilder und PDFs werden abgelehnt, solange der Schutz eingeschaltet ist. Namen, die das Projekt nicht kennt und die im Freitext oder in Textanhängen stehen, können weiterhin gesendet werden. |
| KI-Bearbeitung einer Zeile | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Ihre Anweisung, die eine Zeile, die Sie bearbeiten, und ein kurzer Projektkontext (heutiges Datum, Anzahl der Aufgaben, Gruppen und Labels sowie dieselben Zeilen zu offenen Insights, die der Chat erhält, sodass ein Timelog-Insight eine Person mit ihrer erfassten Arbeitszeit nennen kann), dazu Ihr Betriebsleitfaden für die KI-Bearbeitung, falls vorhanden. Die Zeile enthält Namen, Datumsangaben und Beschreibungen, bei einer Aufgabe ihr Blockerprotokoll mit dem Namen der Person, die den jeweiligen Eintrag erfasst hat; bei einer Person im Ressourcenverzeichnis Name, Berufsbezeichnung, Abteilung, Firma, Rolle, ob sie extern ist, ob sie aktiv ist, sowie ihre geplante Auslastung je Periode und ob diese in Prozent oder in Stunden geplant ist. Nie gesendet: E-Mail-Adressen, Notizverläufe, Telefonnummer, Standort, Geburtstag, Notizen und Abwesenheitsstunden einer Person, Notizen, Einfluss und Interesse eines Stakeholders sowie Art und Notiz einer Abwesenheit. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
| Entwurf des Lenkungsausschuss-Berichts | Wird auf jedem Gerät vor der ersten Nutzung abgefragt und erneut, wenn sich die Offenlegung, die KI-Route oder die Schlüsselbeschränkung ändert | Die Tagesordnung, die Sie eingegeben haben, Ihr Betriebsleitfaden für diesen Bericht, falls vorhanden, eine Statusübersicht: Gesamtstatus (RAG), Aufgabenzahlen, Anzahl überfälliger und bald fälliger Aufgaben, Anzahl der RAID-Einträge und Änderungen, bis zu fünf Änderungstitel sowie Namen und Termine überfälliger, gefährdeter und bald fälliger Meilensteine; und wer von heute an in den nächsten 28 Tagen abwesend ist: der Name jeder Person (mit ihrer Nummer im Ressourcenverzeichnis, wenn sie dort geführt wird) und die Tage ihrer Abwesenheit, nicht Art oder Grund der Abwesenheit. Keine E-Mail-Adressen und keine weiteren Namen von Personen, außer sie stehen in einem Titel oder in der Tagesordnung. | Namen, E-Mail-Adressen und Telefonnummern von Personen, die das Projekt kennt, werden vor dem Senden durch Platzhalter ersetzt. Namen, die das Projekt nicht kennt und die im Freitext oder in Anhängen stehen, können weiterhin gesendet werden. |
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
<!-- PACK:ai-paths-people:END -->

## KI-Funktionen und die gesendeten Daten

Jede KI-Funktion der App, mit der Zustimmung, die sie braucht, was sie sendet und was der Personenschutz
bewirkt. Die Tabelle wird aus derselben Tabelle erzeugt, die der Zustimmungsdialog der App zeigt.
[geprüft: `src/app/ai-disclosure.ts`] Was jede Funktion ohne Freigabe durch eine Person ändern darf, steht
in der [Anlage für den Betriebsrat](works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf).

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

## Was ein Betreiber ab dem 2. Dezember 2027 schulden würde

Die Pflichten für Hochrisiko-Systeme (Kapitel III Abschnitte 1 bis 3) sollten nach dem ursprünglichen Text
ab dem 2. August 2026 gelten. Die Verordnung (EU) 2026/1744 hat sie für Systeme, die nach Art. 6 Abs. 2 und
Anhang III als Hochrisiko-Systeme eingestuft sind, auf den 2. Dezember 2027 verschoben und für Systeme nach
Art. 6 Abs. 1 und Anhang I auf den 2. August 2028. [extern: Verordnung (EU) 2024/1689, Art. 113, und
Verordnung (EU) 2026/1744, der ersetzte Art. 113 Absatz 3 Buchstabe c, beide gelesen am 2026-11-13 wie
oben] Artikel 111 Abs. 2 in der durch die Verordnung (EU) 2026/1744 ersetzten Fassung legt fest, wie diese
Pflichten Hochrisiko-Systeme erreichen, die vor dem Tag, ab dem Kapitel III für sie gilt (für Systeme nach
Anhang III der 2. Dezember 2027), in Verkehr gebracht oder in Betrieb genommen wurden: nur wenn sich ihre
Konzeption ab diesem Tag erheblich ändert, mit einer gesonderten Frist bis zum 2. August 2030 für Systeme,
die zur Verwendung durch Behörden bestimmt sind. [extern: Verordnung (EU) 2026/1744, der ersetzte Art. 111
Abs. 2, gelesen am 2026-11-13 wie oben] Ob und wie das auf die Version der App zutrifft, die Sie bereitstellen,
ist zu prüfen. [Frage an Sie]

Stuft Ihre Organisation die Zuteilungs- oder RACI-Vorschläge als Hochrisiko-System ein, gälten für sie ab
dem 2. Dezember 2027, dem Datum für Systeme nach Anhang III, die Betreiberpflichten aus Art. 26.
Zusammengefasst: [extern: Verordnung (EU) 2024/1689, Art. 26, gelesen am 2026-11-13 wie oben]

- das System gemäß der Betriebsanleitung des Anbieters verwenden, mit geeigneten technischen und
  organisatorischen Maßnahmen (Art. 26 Abs. 1);
- die menschliche Aufsicht Personen übertragen, die über die nötige Kompetenz, Ausbildung und Befugnis
  verfügen und die nötige Unterstützung erhalten (Art. 26 Abs. 2);
- soweit er die Eingabedaten kontrolliert, dafür sorgen, dass die Daten der Zweckbestimmung entsprechen
  und ausreichend repräsentativ sind (Art. 26 Abs. 4);
- den Betrieb des Systems überwachen, den Anbieter und die Marktüberwachungsbehörde über Risiken und
  schwerwiegende Vorfälle informieren und die Verwendung aussetzen, wenn das System ein Risiko darstellt
  (Art. 26 Abs. 5);
- die vom System automatisch erzeugten Protokolle, soweit sie seiner Kontrolle unterliegen, für einen dem
  Zweck angemessenen Zeitraum von mindestens sechs Monaten aufbewahren, sofern anderes Recht nichts
  anderes bestimmt (Art. 26 Abs. 6);
- vor der Verwendung am Arbeitsplatz die Arbeitnehmervertreter und die betroffenen Arbeitnehmer
  informieren (Art. 26 Abs. 7);
- als Behörde die Registrierungspflichten erfüllen (Art. 26 Abs. 8);
- die Informationen des Anbieters bei der Durchführung einer Datenschutz-Folgenabschätzung verwenden
  (Art. 26 Abs. 9).

Personen, die von einer Entscheidung betroffen sind, die auf Grundlage der Ausgabe eines
Hochrisiko-Systems nach Anhang III getroffen wird und die Rechtswirkungen entfaltet oder sie in ähnlicher
Weise erheblich beeinträchtigt, hätten gegenüber dem Betreiber ein Recht auf Erläuterung (Art. 86).
[extern: Verordnung (EU) 2024/1689, Art. 86 Abs. 1, gelesen am 2026-11-13 wie oben] Die
Grundrechte-Folgenabschätzung nach Art. 27 wird von Betreibern verlangt, die Einrichtungen des
öffentlichen Rechts oder private Einrichtungen sind, die öffentliche Dienste erbringen, sowie von
Betreibern der Systeme nach Anhang III Nummer 5 Buchstaben b und c. [extern: Verordnung (EU) 2024/1689,
Art. 27 Abs. 1, gelesen am 2026-11-13 wie oben] Ob sie für Sie gilt, prüfen Sie. [Frage an Sie]

Was die App heute zu diesen Pflichten beiträgt und wo sie zurückbleibt: [geprüft wie angegeben; die
Bewertung, ob das ausreicht: Frage an Sie]

- **Betriebsanleitung.** Eine Betriebsanleitung in der Form, die die Verordnung für Hochrisiko-Systeme
  vorschreibt, gibt es nicht. Dieses Paket, die Hilfe in der App und `docs/security.md` beschreiben die
  App. [Aussage des Maintainers]
- **Menschliche Aufsicht.** Zuteilungs- und RACI-Vorschläge werden von einer Person übernommen, Änderung
  für Änderung. [geprüft: `src/app/alloc-plan-modal.tsx`, `src/app/raci-suggest-modal.tsx`] Eine einzelne
  Chat-Änderung kann ohne Prüfung ausgeführt werden (§794). [geprüft: `shouldStage` in `src/app/chat-proposal.ts`; Register §794]
- **Protokolle.** Das Aktivitätsprotokoll behält je Projekt die neuesten 500 Einträge, eine Anzahl statt
  eines Zeitraums, und verknüpft eine KI-Änderung nicht mit der Chat-Nachricht, die sie veranlasst hat
  (§799). Gespeicherte KI-Chats werden nach der Aufbewahrungsdauer gelöscht, die der Administrator
  festlegt: standardmäßig 30 Tage, höchstens 3650. Ob eines davon sechs Monate abdeckt, hängt davon ab,
  wie viel im Projekt geschieht und welche Dauer Sie festlegen. [geprüft: `ACTIVITY_MAX_ENTRIES` in
  `src/app/activity-log.ts`, `src/app/ai-chat-retention-config.ts`]
- **Abschalten.** Ein Administrator kann die beiden Funktionen mit `ai-people` zwingend abschalten oder
  mit `ai` die gesamte KI. [geprüft: `src/app/deployment-variables.ts`]
- **Anbieterpflichten.** Wären die Funktionen Hochrisiko-Systeme, fielen die Pflichten des Anbieters
  (Konformitätsbewertung, technische Dokumentation, Registrierung) demjenigen zu, der ihr Anbieter ist;
  der Maintainer hat keine davon erfüllt (siehe [Rollen](#rollen)). [Aussage des Maintainers]

Unabhängig von jeder Einstufung müssen Anbieter und Betreiber Maßnahmen ergreifen, um die KI-Kompetenz
ihres Personals und anderer Personen zu fördern, die in ihrem Auftrag mit dem Betrieb und der Nutzung von
KI-Systemen befasst sind (Art. 4 in der durch die Verordnung (EU) 2026/1744 ersetzten Fassung). [extern:
Verordnung (EU) 2026/1744, der ersetzte Art. 4, gelesen am 2026-11-13 wie oben] Das Material zur
[KI-Kompetenz](ai-literacy.md) ist dafür ein Ausgangspunkt. [Frage an Sie]
