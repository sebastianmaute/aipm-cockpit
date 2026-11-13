# Compliance-Paket

## Über dieses Paket

Dieses Paket richtet sich an Organisationen, die AI PM Cockpit einsetzen möchten und die App dafür zuerst
selbst prüfen müssen. Es ist für vier Lesergruppen geschrieben: Datenschutzbeauftragte, Betriebsrat,
Informationssicherheitsbeauftragte und die für KI verantwortliche Person. Es liefert ihnen die Fakten
über die App und die Fragen, die sie beantworten müssen. Die Antworten, die nur die Organisation oder
ihre Rechtsberatung geben kann, liefert es nicht.

Dieses Paket ist Material für Ihre eigene Arbeit. Es ist keine Rechtsberatung und trifft keine
rechtliche Schlussfolgerung über die App oder über Ihre Nutzung der App.

**Wer es bereitstellt.** AI PM Cockpit ist ein kostenloses, nicht kommerzielles Open-Source-Projekt.
Bereitgestellt wird dieses Paket von seinem Maintainer, dem Eigentümer des Repositorys, der in der
Richtlinie zur Code-Signierung in der README genannt ist. Zwischen dem Maintainer und Ihnen besteht kein
Vertrag, es gibt kein Service-Level und keinen Supportzeitraum. Die einzige Pflicht, die der Maintainer
übernimmt, ist die Bearbeitung von Schwachstellenmeldungen, wie [`SECURITY.md`](../../../SECURITY.md) sie
beschreibt: vertraulich über GitHub gemeldet, mit einer ersten Antwort innerhalb einer Woche, und
Korrekturen nur im jeweils neuesten Release. [Aussage des Maintainers]

## Stand des Textes

Text zuletzt geprüft für Version 1.20.1 am 2026-11-13.

Diese Zeile gibt an, wann eine Person den handgeschriebenen Text zuletzt mit der App abgeglichen hat. Die
Tabellen zwischen den `PACK:`-Markierungen erfasst sie nicht: Diese werden aus dem Code erzeugt und bei
jeder Änderung geprüft (siehe [So lesen Sie die Kennzeichnungen](#so-lesen-sie-die-kennzeichnungen)). Das
Paket, das Sie an einem Release-Tag des Repositorys lesen, ist das Paket für dieses Release. An einem
anderen Commit gelesen, beschreibt es den Code ab diesem Commit, der dem neuesten Release voraus sein
kann: Verhaltensänderungen, die im [CHANGELOG](../../../CHANGELOG.md) unter „Unreleased“ stehen,
erreichen die Nutzer mit dem nächsten Release.

## Umfang

Das Paket behandelt die App in diesem Repository in der Version, in der Sie es lesen: die Web-App, ihre
eigenen Server-Routen und die Windows-Desktop-App, die dieselbe Web-App auf dem Computer des Nutzers
ausführt. Es beschreibt, was die App speichert, was sie wohin sendet, was ein Administrator ein- oder
ausschalten kann und welche bekannten Lücken noch offen sind.

Zu den Begriffen: „Administrator“ heißt in diesem Paket, wer die Installation der App betreibt und ihre
Umgebungsvariablen setzt. „Betreiber“ und „Anbieter“ werden nur im Sinne der Verordnung (EU) 2024/1689
(KI-Verordnung) verwendet, dort für „deployer“ und „provider“; siehe den [Hinweis zur
KI-Verordnung](ai-act-readiness.md).

Nicht behandelt werden:

- die Dienste, mit denen die App kommuniziert (Anthropic, Microsoft 365, Turso, Atlassian, Timelog, ein
  Speech-to-Text-Dienst, ein KI-Gateway). Deren Bedingungen und eigene Maßnahmen sind ihre Sache; wo das
  Paket sie zitiert, kennzeichnet es die Aussage und nennt die Quelle.
- die Computer, Browser, Netzwerke und Speicherkonten, auf denen die App läuft.
- Ihre Zwecke, Rechtsgrundlagen, Aufbewahrungsentscheidungen und Betriebsvereinbarungen. Diese sind Ihre
  Sache; die Dokumente kennzeichnen jeden dieser Punkte als **Frage an Sie**.

## Dokumente

| Dokument | Wofür es dient | Hauptlesergruppe |
|---|---|---|
| [Berührungspunkte mit dem Maintainer](vendor-touchpoints.md) | Was beim Maintainer ankommt (zur Laufzeit nichts aus der App), und jeder Host, den der Browser, der Server und die Desktop-App kontaktieren | DSB, CISO |
| [Angaben für das Verzeichnis von Verarbeitungstätigkeiten](record-of-processing-input.md) | Die Felder eines Verzeichnisses von Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO), mit den Angaben, die der Maintainer liefern kann, bereits ausgefüllt | DSB |
| [Angaben für die Datenschutz-Folgenabschätzung](dpia-input.md) | Eine Beschreibung der Verarbeitung in der Gliederung, die eine Datenschutz-Folgenabschätzung erwartet | DSB |
| [Technische und organisatorische Maßnahmen](tom-sheet.md) | Die Sicherheitsmaßnahmen der App, jeweils mit dem, was sie nicht abdecken | CISO, DSB |
| [Anlage für den Betriebsrat](works-council-annex.md) | Welche Funktionen Beschäftigte erfassen oder auswerten und was ein Administrator abschalten kann | Betriebsrat |
| [Hinweis zur KI-Verordnung](ai-act-readiness.md) | Die Rollen nach der Verordnung (EU) 2024/1689 (KI-Verordnung), wie der Maintainer sie liest, und die offenen Fragen | KI-Beauftragte |
| [Musterhinweise](model-notices.md) | Vorlagen zur Information von Beschäftigten und externen Stakeholdern | DSB |
| [KI-Kompetenz](ai-literacy.md) | Material in einfacher Sprache für die Menschen, die die App nutzen | Alle, die die KI nutzen |

## Offene Lücken

Dies sind bekannte Lücken, die noch offen sind. Jede ist ein Eintrag im öffentlichen Register offener
Punkte des Projekts, [`docs/open-followups.md`](../../open-followups.md). Die Tabelle wird aus diesem
Register erzeugt, und die Prüfung des Pakets schlägt fehl, wenn ein aufgeführter Eintrag geschlossen ist
oder fehlt. [geprüft: `scripts/compliance/pack-config.mjs` (die zitierte Liste),
`scripts/check-compliance-pack.mjs` (die Prüfung)] Die Titel in der Tabelle sind die des englischsprachigen
Registers.

<!-- PACK:open-gaps:BEGIN -->
| Register-Eintrag | Titel |
|---|---|
| §487 | The Windows installer is still unsigned: the signing pipeline exists but is switched off, so every install shows an unknown-publisher warning |
| §562 | The shared proxy rate limiter is bypassable by a client-supplied header, and its store is in-memory |
| §793 | The installer's uninstaller is not code-signed |
| §794 | A single AI chat write applies without the review card |
| §795 | Background AI runs are consented once, not approved run by run |
| §796 | Tasks created by Plan with AI's work breakdown cannot be undone |
| §797 | External text that the chat's tools read does not trigger the review hold |
| §798 | Most AI requests have no client time limit, and none is retried on a rate limit or overload |
| §799 | An activity entry written by the AI does not link to the chat message that caused it |
| §800 | The Content Security Policy allows whole host families by wildcard |
| §801 | Text the AI writes carries no machine-readable marking |
| §802 | The AI gateway route has never been run against a real gateway |
| §803 | Dictation's private-address check does not resolve host names |
| §804 | Plan with AI always sends internal hourly rates; there is no option to leave them out |
| §805 | The AI relay attaches the deployment's gateway token for any caller that reaches the server |
| §806 | The AI relay and dictation routes have no request limit |
| §810 | Hiding a project's Resources function keeps neither the chat's people tools nor the absence list from the AI |
<!-- PACK:open-gaps:END -->

Was jede Lücke für Sie bedeutet. Jeder Satz gibt seinen Registereintrag in `docs/open-followups.md` wieder,
wo die Einzelheiten stehen. [geprüft: die Registereinträge in `docs/open-followups.md`]

- **§487** — Keiner der bisher veröffentlichten Installer ist code-signiert, daher kann Windows Ihnen
  nicht anzeigen, wer ihn veröffentlicht hat. Prüfen Sie jeden Download stattdessen mit den
  GitHub-Attestierungsbefehlen in `SECURITY.md`.
- **§562** — Die Anfragebegrenzung der Routen für Jira, Confluence, Timelog und Wechselkurse lässt sich
  von einem Aufrufer umgehen, der einen Weiterleitungs-Header setzt, und sie beginnt bei einem Neustart
  des Servers wieder bei null. (Die Routen für KI und Diktat haben gar keine Begrenzung; siehe §806.)
- **§793** — Auch wenn die Signierung eingeschaltet ist, wird das Deinstallationsprogramm, das die
  Installation auf dem Computer ablegt, nicht signiert sein; ein Werkzeug, das jedes Programm auf dem
  Rechner prüft, wird es daher melden.
- **§794** — Nimmt der KI-Chat genau eine Änderung vor und trifft keine der Bedingungen zu, die eine
  Prüfung erzwingen, wird die Änderung sofort ausgeführt, ohne Prüfkarte. Sie wird als Änderung der KI
  protokolliert, und die meisten solchen Änderungen lassen sich rückgängig machen, aber keine Person hat
  sie vorher freigegeben.
- **§795** — Die drei KI-Hintergrundfunktionen senden bei jedem Lauf Projektdaten, auf Grundlage einer
  einzigen, vorab erteilten Zustimmung. Niemand gibt den einzelnen Lauf frei.
- **§796** — Nachdem eine Person einen KI-Projektstrukturplan übernommen hat, macht „Rückgängig“ die
  Änderungen an bestehenden Aufgaben rückgängig, nicht aber die Aufgaben, die er angelegt hat. Diese
  müssen von Hand gelöscht werden.
- **§797** — Der Chat hält seine vorgeschlagenen Änderungen zur Prüfung zurück, wenn eine Datei angehängt
  ist, nicht aber, wenn er über seine Werkzeuge fremden Text gelesen hat (zum Beispiel aus Jira
  synchronisierte Inhalte), obwohl auch solcher Text Anweisungen enthalten könnte.
- **§798** — Die meisten KI-Anfragen warten, bis der Nutzer abbricht oder die Verbindung abreißt, und
  eine Anfrage, die abgelehnt wird, weil der Dienst ausgelastet ist, wird nicht erneut versucht. Nutzer
  sehen einen Fehler oder warten lange.
- **§799** — Das Aktivitätsprotokoll zeigt, dass die KI etwas geändert hat und was sich geändert hat,
  aber nicht, welche Chat-Nachricht dies verlangt hat. Wer prüft, kann eine KI-Änderung anhand des
  Protokolls nicht bis zu ihrer Anfrage zurückverfolgen.
- **§800** — Die Sicherheitsrichtlinie des Browsers erlaubt jede Turso-Datenbank, jeden SharePoint- oder
  OneDrive-Dateihost und jeden lokalen Port, nicht nur die, die Ihre Bereitstellung nutzt.
- **§801** — Text, den die KI in Aufgaben, Dokumente und Exporte schreibt, trägt keine maschinenlesbare
  Markierung. Einmal kopiert oder exportiert, lässt er sich von Text, den eine Person geschrieben hat,
  nicht mehr unterscheiden.
- **§802** — Die Weiterleitung von KI-Anfragen über das Gateway einer Organisation wurde nur gegen
  Attrappen und einen lokalen Server getestet. Wie sich ein echtes Gateway mit der App verhält, ist durch
  keinen Lauf bestätigt.
- **§803** — Die Prüfung, die das Diktat von privaten Netzwerkadressen fernhält, betrachtet die Adresse
  so, wie sie eingegeben wurde, und löst keinen Hostnamen auf; ein Hostname, der auf eine private Adresse
  zeigt, wird daher nicht erkannt.
- **§804** — „Mit KI planen“ sendet immer den internen Stundensatz der Rolle jeder internen Person. Der
  einzige Weg, Stundensätze von der KI fernzuhalten, ist der Personenschutz, der die Funktion ausblendet.
- **§805** — Der Server der App prüft nicht, wer ihn aufruft. Bei einer Bereitstellung mit KI-Gateway
  kann jeder, der den Server erreicht, KI-Anfragen unter dem Token Ihres Gateways über dieses senden, auf Kosten
  Ihrer Organisation, soweit das Gateway sie abrechnet. Stellen Sie den Server hinter Ihrer eigenen
  Zugangskontrolle bereit.
- **§806** — Die KI-Routen und die Diktat-Route nehmen beliebig viele Anfragen an, und das Diktat leitet
  Audio an jede öffentliche https-Adresse weiter, die der Aufrufer angibt. Begrenzen Sie den Zugang vor
  der App.
- **§810** — Das Ausblenden der Ressourcen-Funktion eines Projekts blendet deren Ansichten aus, hält ihre
  Daten aber nicht von der KI fern. Solange der Personenschutz aus ist, kann der KI-Chat in diesem Projekt
  weiterhin Personen, Abwesenheiten und Zuteilungen lesen sowie Personen und Abwesenheiten ändern. Und fünf
  KI-Funktionen (der Entwurf des Lenkungsausschuss-Berichts, „Nächste Schritte mit KI analysieren“, die
  Analyse durch geplante Aufträge, die Insight-Empfehlungen und der Vorschlag für den Projektstrukturplan)
  senden die Liste, wer abwesend ist, mit Namen und Abwesenheitstagen, unabhängig vom Zustand der
  Funktion. Der Personenschutz schaltet die Personen-Werkzeuge des Chats ab und ersetzt bekannte
  Namen durch Platzhalter; die Abwesenheitstage werden weiterhin gesendet.

## So lesen Sie die Kennzeichnungen

Jede Tatsachenaussage im handgeschriebenen Text trägt eine von vier Kennzeichnungen:

- **[geprüft: `Datei`]** — am Code oder an einem Test in diesem Repository geprüft; die Kennzeichnung
  nennt die Datei oder den Test. Wenn Sie Zweifel haben, lesen Sie diese Datei am Release-Tag, den Sie
  einsetzen.
- **[Aussage des Maintainers]** — das eigene Wort des Maintainers, zum Beispiel darüber, was er mit
  Meldungen tut. Nichts im Code belegt es.
- **[extern: Quelle, gelesen am …]** — die veröffentlichten Bedingungen oder die Dokumentation eines
  Dritten, mit der Adresse und dem Datum, an dem der Maintainer sie gelesen hat. Der Dritte kann sie
  ändern; lesen Sie sie erneut, bevor Sie sich darauf verlassen.
- **[Frage an Sie]** — etwas, das nur Ihre Organisation beantworten kann.

Eine Kennzeichnung am Ende eines Absatzes gilt für jede Aussage in diesem Absatz. Die erzeugten Tabellen,
jeweils von einem Paar `PACK:`-Kommentarmarkierungen eingefasst, tragen keine Kennzeichnung je Zeile. Sie
sind als Ganzes geprüft: Ein Skript erzeugt sie aus dem Code (`src/proxy.ts`,
`src/app/outbound-destinations.ts`, `src/app/deployment-variables.ts`, `src/app/ai-disclosure.ts` und dem
Register), und der Test `src/app/compliance/pack-drift.test.ts` schlägt fehl, wenn eine Tabelle von dem
abweicht, was der Code erzeugen würde. [geprüft: `src/app/compliance/pack-drift.test.ts`]
