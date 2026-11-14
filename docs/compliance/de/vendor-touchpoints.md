# Berührungspunkte mit dem Maintainer

## Über dieses Dokument

Dieses Dokument sagt, was beim Maintainer von AI PM Cockpit ankommt, wenn Ihre Organisation die App
nutzt, und führt jeden externen Host auf, den die App kontaktiert. Es richtet sich an Datenschutzbeauftragte,
die entscheiden müssen, ob der Maintainer personenbezogene Daten erhält, und an
Informationssicherheitsbeauftragte, die wissen müssen, wohin die App Verbindungen aufbaut. Wann der
handgeschriebene Text zuletzt geprüft wurde, steht in der [Prüfzeile](README.md#stand-des-textes) der README.

Dieses Dokument ist Material für Ihre eigene Arbeit. Es ist keine Rechtsberatung.

## Was beim Maintainer ankommt

Nichts, was die App zur Laufzeit tut, sendet Daten an den Maintainer. Der Maintainer betreibt für die
App keinen Server, kein KI-Gateway, keinen Telemetrie- oder Analysedienst und keinen Dienst für
Absturzberichte. [Aussage des Maintainers]

Der Code bestätigt das. Die Hosts, zu denen eine Browserseite der App Verbindungen aufbauen darf, legt
ihre Content Security Policy fest; sie stehen in der ersten Tabelle unten, und keiner von ihnen wird vom
Maintainer betrieben. [geprüft: `src/proxy.ts`, festgeschrieben durch `src/proxy.test.ts`] Alles, was der
eigene Server der App und die Desktop-App kontaktieren, steht in der zweiten Tabelle. Ein Test durchläuft
den ausgelieferten Quellcode und schlägt fehl, wenn ein Verzeichnis einer Server-Route oder eine Datei der
Desktop-App, die Netzwerkaufrufe macht, in dieser Liste fehlt; keines der aufgeführten Ziele wird vom
Maintainer betrieben. [geprüft: `src/app/outbound-destinations.ts`,
`src/app/outbound-destinations.test.ts`]

Die README des Projekts sagt in ihrer Datenschutzerklärung dasselbe für die Desktop-App: kein Konto, kein
Backend, das Ihre Daten speichert, keine Telemetrie, keine Nutzungsanalyse und keine Absturzberichte.
[Aussage des Maintainers]

### Updates

Die Desktop-App sucht in den GitHub-Releases des Projekts nach Updates. Die Anfrage geht an GitHub, nicht
an den Maintainer. [geprüft: `desktop/src/updater.ts`]

- **Wann.** In einer paketierten (installierbaren) Desktop-App 10 Sekunden nach dem Start und jedes Mal, wenn der Nutzer
  den Menüpunkt „Check for updates“ wählt. Wird die Umgebungsvariable `AIPM_DISABLE_UPDATE_CHECK` auf `1`
  gesetzt, unterbleiben alle Prüfungen. [geprüft: `STARTUP_CHECK_DELAY_MS` in
  `desktop/src/lib/update-policy.ts`, verwendet in `desktop/src/main.ts`; `desktop/src/updater.ts`;
  `src/app/deployment-variables.ts`]
- **Was GitHub sieht.** Die Anfrage selbst, die die IP-Adresse des Computers, den User-Agent der
  Update-Bibliothek (electron-builder) und eine feste Kennung im Header `x-user-staging-id` trägt. Diese
  Kennung hat für jede Installation denselben Wert und unterscheidet Installationen daher nicht. Die
  Update-Bibliothek speichert zudem eine eigene Zufallskennung im Datenordner der App; die App sendet sie
  nicht. Projektdaten werden nicht gesendet. [geprüft: `desktop/src/updater.ts`; der Test „sends one fixed
  staging id, never a per-installation one“ in `desktop/src/updater.test.ts`]
- **Downloads.** Ein Installer wird erst heruntergeladen, nachdem der Nutzer das Update angenommen hat.
  [geprüft: `desktop/src/updater.ts`]
- **Was der Maintainer sehen kann.** GitHub führt für jede Release-Datei einen Download-Zähler und stellt
  ihn als Zahl je Datei bereit (`download_count`). [extern: GitHub REST API, „Release assets“,
  https://docs.github.com/en/rest/releases/assets, gelesen am 2026-11-13] Darüber hinaus erhält der
  Maintainer nichts darüber, wer geprüft oder heruntergeladen hat. [Aussage des Maintainers]
- **Signaturprüfung.** Eine aus einem signierten Release installierte Kopie lehnt ein Update ab, dessen
  Installer nicht von der SignPath Foundation signiert ist. Bisher ist kein Release signiert (§487), daher
  schützt diese Prüfung noch keine installierte Kopie. [geprüft: `README.md`, Abschnitt „Code signing
  policy“; `.github/workflows/release.yml`]

Eine Web-Bereitstellung der App hat keinen Updater. Neue Versionen stellt Ihre Organisation selbst bereit.
[geprüft: `src/app/outbound-destinations.ts` führt den Updater nur für `desktop/src/updater.ts` auf]

Was GitHub mit den empfangenen Anfragen tut, regeln die eigenen Bedingungen von GitHub, nicht der
Maintainer. [Aussage des Maintainers] Ob diese Bedingungen für die Update-Prüfungen Ihrer Computer
annehmbar sind oder ob Sie die Prüfungen abschalten, entscheiden Sie. [Frage an Sie]

### Support und Schwachstellenmeldungen

Support findet öffentlich statt, über die GitHub-Issues des Repositorys. Eine Schwachstelle wird
vertraulich über die GitHub-Funktion „Report a vulnerability“ gemeldet, wie `SECURITY.md` es beschreibt.
[geprüft: `SECURITY.md`]

Beide enthalten nur, was die meldende Person hineinschreibt. Die App hat keine Funktion, die Protokolle,
Projektdaten oder Diagnosedaten an den Maintainer sendet. [Aussage des Maintainers] Das Diagnoseprotokoll,
das die App führt, wird im Browser gespeichert (begrenzt auf 200 Ereignisse) und nirgendwohin gesendet.
[geprüft: `src/app/diagnostics.ts`] Hängen Ihre Beschäftigten Screenshots, Protokolle oder exportierte
Dateien an ein Issue an, ist dieser Inhalt öffentlich. Legen Sie fest, ob Beschäftigte Probleme öffentlich
melden dürfen und was sie dabei angeben dürfen. [Frage an Sie]

Der Maintainer hat keinen Fernzugriff auf irgendeine Installation und verlangt keinen. [Aussage des
Maintainers]

## Hosts, die der Browser kontaktieren darf

Die Tabelle unten führt jeden externen Host auf, den die Content Security Policy der App einer Seite der
App zu kontaktieren erlaubt. Sie wird aus denselben Konstanten gelesen, aus denen der Server die Richtlinie
aufbaut. [geprüft: `src/proxy.ts`] So lesen Sie sie:

- **Direktive.** „Verbindungen“ sind Anfragen, die die Seite selbst stellt (Daten, Anmelde-Tokens).
  „Eingebettete Frames“ sind Seiten, die die App in sich selbst laden darf; hier nur die
  Microsoft-Anmeldeseite, die Tokens in einem verborgenen Frame erneuert. [geprüft: `src/proxy.ts`]
- **Bedingung.** „Immer erlaubt“ heißt, dass die Richtlinie den Host in jeder Bereitstellung zulässt. Die
  Seite kontaktiert ihn nur, wenn der Nutzer die passende Funktion einrichtet: Turso-Speicher,
  Microsoft-365-Anmeldung oder, für die beiden lokalen Adressen, eine Turso-Datenbank auf dem eigenen
  Computer des Nutzers. [Aussage des Maintainers; wofür jeder Host genutzt wird, beschreibt
  `src/proxy.ts`]
- **Wer jeden Host betreibt.** `api.anthropic.com` ist Anthropic. `*.turso.io` ist Turso und enthält eine
  Datenbank in einem Konto, das der Nutzer oder Ihre Organisation angelegt hat. `graph.microsoft.com`,
  `*.sharepoint.com`, `*.files.1drv.com` und `login.microsoftonline.com` sind Microsoft, tätig für den
  Microsoft-365-Mandanten, bei dem sich der Nutzer anmeldet. `localhost` und `127.0.0.1` sind der eigene
  Computer des Nutzers. [geprüft: `src/proxy.ts`]
- **Nicht in der Tabelle.** Jede Seite darf außerdem ihren eigenen Ursprung kontaktieren: den Server Ihrer
  Bereitstellung oder, in der Desktop-App, den lokalen Server, den die Desktop-App auf dem Computer des
  Nutzers startet. [geprüft: `src/proxy.ts` (`connect-src 'self'`)] Nicht erfasst von der Richtlinie wird
  das Browser-Diktat, das die im Browser eingebaute Spracherkennung nutzt und in manchen Browsern das
  Audio an den Browserhersteller sendet. Ebenso wenig erfasst sie Fenster, die die App öffnet, etwa das
  Microsoft-Anmeldefenster, oder Links, denen der Nutzer folgt. [geprüft: `src/proxy.ts`, Kommentar zu
  `frame-src`; `docs/security.md`]

<!-- PACK:browser-hosts:BEGIN -->
| Host | Direktive | Bedingung |
|---|---|---|
| https://api.anthropic.com | Verbindungen (connect-src) | Nur wenn alle drei Bedingungen zutreffen: Die Bereitstellung sendet KI-Anfragen direkt an Anthropic (kein KI-Gateway), sie beschränkt KI nicht auf die Schlüssel ihrer Organisation, und die KI-Integration ist nicht abgeschaltet |
| https://*.turso.io | Verbindungen (connect-src) | Immer erlaubt |
| https://graph.microsoft.com | Verbindungen (connect-src) | Immer erlaubt |
| https://*.sharepoint.com | Verbindungen (connect-src) | Immer erlaubt |
| https://*.files.1drv.com | Verbindungen (connect-src) | Immer erlaubt |
| https://login.microsoftonline.com | Verbindungen (connect-src) | Immer erlaubt |
| http://localhost:* | Verbindungen (connect-src) | Immer erlaubt |
| http://127.0.0.1:* | Verbindungen (connect-src) | Immer erlaubt |
| https://login.microsoftonline.com | Eingebettete Frames (frame-src) | Immer erlaubt |
<!-- PACK:browser-hosts:END -->

Die Platzhaltereinträge erlauben jede Turso-Datenbank und jeden SharePoint- oder OneDrive-Dateihost, nicht
nur Ihre (§800). [geprüft: `src/proxy.ts`; der Registereintrag §800 in `docs/open-followups.md`]

## Ziele des Servers und der Desktop-App

Manche Anfragen kommen nicht von der Browserseite, sondern vom eigenen Server der App (in einer
Web-Bereitstellung oder als lokaler Server in der Desktop-App) oder von der Desktop-App selbst. Die
Content Security Policy sieht diese nicht, daher sind sie gesondert aufgeführt. [geprüft:
`src/app/outbound-destinations.ts`] So lesen Sie die Tabelle:

- **Betrieben von** nennt, wer den empfangenden Dienst betreibt. „Die bereitstellende Organisation“ ist
  Ihr eigenes KI-Gateway. „Ein vom Nutzer eingetragener Dienst“ ist jeder Speech-to-Text-Endpunkt, den ein
  Nutzer in die Einstellungen einträgt.
- **Code, der sendet** ist die Server-Route oder das Desktop-Modul, das die Anfrage stellt, damit Ihre
  Prüfer sie lesen können.
- **Was gesendet wird** und **Auslöser** beschreiben die Anfrage so, wie der Code sie aufbaut. Dort
  aufgeführte Zugangsdaten (API-Schlüssel, Tokens) gehören dem Nutzer oder Ihrer Organisation; der Server
  leitet sie weiter und speichert sie nicht. [geprüft: `src/app/outbound-destinations.ts`; für das
  KI-Relay `docs/security.md`, Abschnitt „AI features“]

<!-- PACK:server-destinations:BEGIN -->
| Betrieben von | Code, der sendet | Was gesendet wird | Auslöser |
|---|---|---|---|
| Anthropic | src/app/api/ai/_relay.ts | Der eigene Anthropic-API-Schlüssel des Aufrufers und die KI-Anfrage selbst (die Unterhaltung samt Projektinhalten, die dem Assistenten mitgegeben wurden), weitergeleitet an api.anthropic.com, dazu die Modelllisten-Anfrage und, wenn dem Server für diesen Schlüssel kein aktuelles Ergebnis vorliegt, eine Modelllisten-Anfrage mit einem Eintrag und demselben Schlüssel, die prüft, zu welcher Organisation der Schlüssel gehört; eine bestandene Prüfung behält der Server im Arbeitsspeicher, eine Ablehnung bis zu fünf Minuten, sodass spätere Anfragen mit demselben Schlüssel meist nicht erneut geprüft werden. | Wenn die Bereitstellung KI-Schlüssel auf eine Anthropic-Organisation beschränkt (AIPM_AI_ORGANIZATION_ID), keine Gateway-Adresse gesetzt ist und ein Nutzer eine KI-Anfrage sendet; ohne diese Beschränkung ruft der Browser Anthropic selbst auf, was die Liste der Browser-Hosts abdeckt. |
| Die bereitstellende Organisation | src/app/api/ai/_relay.ts | Dieselben Anfragen, die das Anthropic-Relay senden würde (der Anthropic-API-Schlüssel des Aufrufers, die KI-Anfrage selbst und die Modelllisten-Anfrage), adressiert an das Gateway der Bereitstellung, mit dem Gateway-Token, sofern eines gesetzt ist; sind Schlüssel auf eine Organisation beschränkt, geht einer Anfrage, für deren Schlüssel dem Server kein aktuelles Ergebnis vorliegt, eine Modelllisten-Anfrage mit einem Eintrag und demselben Schlüssel voraus, die die Organisation des Schlüssels prüft; eine bestandene Prüfung behält der Server im Arbeitsspeicher, eine Ablehnung bis zu fünf Minuten, sodass spätere Anfragen mit demselben Schlüssel meist nicht erneut geprüft werden. | Wenn die Bereitstellung eine Gateway-Adresse setzt (AIPM_AI_GATEWAY_URL) und ein Nutzer eine KI-Anfrage sendet. |
| Turso | src/app/api/ai/_chat-sweep.ts | Anweisungen, die die Tabelle der gespeicherten Chats anlegen, falls sie fehlt, und gespeicherte Chats löschen, die älter als die Aufbewahrungsdauer sind, gesendet an die Turso-Datenbank, mit der der Server konfiguriert ist, zusammen mit ihrem Turso-Auth-Token; die Anweisungen enthalten die Anzahl der Tage und lesen keine Chat-Inhalte. | Einmal beim Start des Servers und danach alle 24 Stunden, solange Turso-Zugangsdaten für die Löschung (oder die öffentliche Turso-Adresse der App) gesetzt sind und die Aufbewahrungseinstellung gültig ist. |
| Atlassian | src/app/api/jira | Die Jira-E-Mail-Adresse und das API-Token des Nutzers als Basic-Authentifizierung sowie die vom Nutzer ausgelöste Anfrage (zum Beispiel eine Suchabfrage oder die Felder eines Vorgangs, der angelegt, geändert oder weitergeschaltet wird, und die zugehörigen Abfragen wie Projekte, Vorgangstypen und Benutzer), gesendet an die eigene Atlassian-Cloud-Site des Nutzers (eine Adresse unter atlassian.net). | Wenn Jira in den Projekteinstellungen aktiviert ist, die Integration für die Bereitstellung nicht abgeschaltet wurde und ein Nutzer eine Jira-Funktion wie Suche, Import oder Abgleich verwendet. |
| Atlassian | src/app/api/confluence | Die Atlassian-E-Mail-Adresse und das API-Token des Nutzers als Basic-Authentifizierung sowie die ID der einen Confluence-Seite, die der Nutzer angefordert hat, gesendet an die eigene Atlassian-Cloud-Site des Nutzers (eine Adresse unter atlassian.net). | Wenn ein Nutzer eine Confluence-Seite importiert und die Integration für die Bereitstellung nicht abgeschaltet wurde. |
| Timelog | src/app/api/timelog | Das Timelog-Zugriffstoken des Nutzers als Bearer-Token, der Timelog-Mandantenname in der Adresse und die vom Nutzer ausgelöste Anfrage (ein Pfad, eine Abfrage und bei Schreibzugriffen die Zeitbuchungsdaten), gesendet an den eigenen Timelog-Host des Nutzers (eine Adresse unter timelog.com). | Wenn Timelog in den Einstellungen konfiguriert ist, die Integration für die Bereitstellung nicht abgeschaltet wurde und ein Nutzer eine Timelog-Funktion wie Zeitbuchung oder das Laden von Buchungen verwendet. |
| Ein vom Nutzer eingetragener Dienst | src/app/api/stt | Die aufgenommene Audiodatei des Diktats (als webm-Datei), der Name des Sprachmodells und der Speech-to-Text-API-Schlüssel des Nutzers als Bearer-Token, gesendet per https an die Endpunktadresse, die der Nutzer in den Diktat-Einstellungen eingetragen hat, sofern sie keine private IP-Adresse ist. | Wenn ein Nutzer diktiert und ein Speech-to-Text-Endpunkt konfiguriert ist, weder die Diktat-Integration, die KI-Integration noch die Personenschutz-Sperre für die Bereitstellung abgeschaltet ist und die KI-Gateway-Einstellung der Bereitstellung nicht ungültig ist. |
| Europäische Zentralbank | src/app/api/ecb | Eine einfache Anfrage nach den täglichen Euro-Referenzkursen der Europäischen Zentralbank, ohne Arbeitsbereichsdaten und ohne Zugangsdaten. | Wenn die App Wechselkurse lädt oder aktualisiert und die Integration ecb für die Bereitstellung nicht abgeschaltet wurde. |
| GitHub | desktop/src/updater.ts | Anfragen an github.com nach dem Releases-Feed der App (releases.atom), dem neuesten Release-Tag und dessen Update-Informationsdatei (latest.yml) und, wenn der Nutzer ein Update annimmt, ein Download des Installers (und seiner Block-Map, falls das Release eine hat) von den Release-Asset-Hosts von GitHub; die Update-Prüfungen und Downloads enthalten die IP-Adresse des Anfragenden, den User-Agent der Update-Bibliothek (electron-builder) und eine feste Kennung (Header x-user-staging-id), die für jede Installation gleich ist, jedoch keine Arbeitsbereichsdaten; die Bibliothek speichert weiterhin eine zufällige Kennung je Installation im Datenordner der App, sie bleibt aber auf dem Gerät und wird nicht gesendet. | In einer installierten Desktop-App 10 Sekunden nach dem Start und jedes Mal, wenn der Nutzer Nach Updates suchen wählt, außer AIPM_DISABLE_UPDATE_CHECK ist auf 1 gesetzt; der Download des Installers beginnt erst, wenn der Nutzer das Update annimmt. |
<!-- PACK:server-destinations:END -->

Die Prüfung auf private Adressen beim Speech-to-Text beurteilt die Adresse so, wie sie eingegeben wurde,
und löst keinen Hostnamen auf (§803). [Aussage des Maintainers; Register §803]

**Der Server prüft nicht, wer ihn aufruft.** Keine der Server-Routen der App authentifiziert ihren
Aufrufer; serverseitig gibt es keine Anmeldung. [geprüft: die 15 Routendateien unter `src/app/api`] Jeder,
der den Server erreicht, kann diese Routen daher nutzen: KI-Anfragen unter dem Token Ihres Gateways
über dieses senden (§805) und Anfragen an die Integrationen mit Zugangsdaten senden, über die er
selbst verfügt. Die Routen für KI und Diktat haben keine Anfragebegrenzung (§806), und die Begrenzung der
übrigen Routen lässt sich umgehen (§562). [Aussage des Maintainers; Register §805, §806 und §562]
Stellen Sie den Server hinter der eigenen Zugangskontrolle Ihrer Organisation bereit, etwa einem Reverse
Proxy mit Anmeldung, Single Sign-on oder einer Netzwerkbeschränkung.
[Aussage des Maintainers; wie Sie das umsetzen: Frage an Sie]

Ein Administrator kann jede serverseitige Integration mit `AIPM_DISABLED_INTEGRATIONS` abschalten; das
[TOM-Blatt](tom-sheet.md#schalter-für-den-betrieb) führt die Schalter auf. [geprüft:
`src/app/deployment-variables.ts`, `src/app/api/_shared/integration-switch.ts`]

## Rollen

**Der Maintainer.** AI PM Cockpit ist ein kostenloses, nicht kommerzielles Open-Source-Projekt. Der
Maintainer stellt es ohne Vertrag, ohne Service-Level und ohne Supportzeitraum bereit. Korrekturen fließen
nur in das jeweils neueste Release ein. Schwachstellenmeldungen bearbeitet der Maintainer, wie
`SECURITY.md` es beschreibt. [Aussage des Maintainers; `SECURITY.md`]

**Ihre Organisation.** Sie entscheiden, wo die App läuft, welchen Speicher und welche Integrationen sie
nutzt, welche KI-Route und welche Schlüssel sie verwendet und wer sie nutzen darf. Ob Ihre Organisation
dadurch Verantwortlicher für die Daten in der App ist und auf welcher Rechtsgrundlage sie diese
verarbeitet, entscheiden Sie. [Frage an Sie]

**Die Dienste, mit denen die App verbunden ist.** Anthropic, Microsoft, Turso, Atlassian, Timelog, ein
Speech-to-Text-Dienst und ein KI-Gateway erhalten Daten nur über Konten, die der Nutzer oder Ihre
Organisation einrichtet, mit Schlüsseln oder Anmeldungen, die dem Nutzer oder Ihrer Organisation gehören.
Der Vertrag für jeden dieser Dienste besteht zwischen dem Dienst und dem Inhaber des Kontos, nicht über
den Maintainer. [geprüft: die Zugangsdaten in jeder Zeile der Tabelle oben,
`src/app/outbound-destinations.ts`; Vertragsrollen: Frage an Sie]

Für Anthropic gilt: Seine Commercial Terms beziehen sein Data Processing Addendum durch Verweis ein.
[extern: Anthropic Commercial Terms of Service, https://www.anthropic.com/legal/commercial-terms, gültig
ab 17. Juni 2025, gelesen am 2026-11-13] Dieses Addendum legt fest, dass für personenbezogene Daten des
Kunden der Kunde Verantwortlicher und Anthropic Auftragsverarbeiter des Kunden ist. [extern: Anthropic
Data Processing Addendum, https://www.anthropic.com/legal/data-processing-addendum, gültig ab
24. Februar 2025, gelesen am 2026-11-13] Wer der „Kunde“ ist, hängt davon ab, zu wessen Anthropic-Konto
der API-Schlüssel gehört: zu dem Ihrer Organisation oder zum eigenen Konto eines Beschäftigten. Ein
Administrator kann die App so einstellen, dass sie nur Schlüssel des Anthropic-Kontos Ihrer Organisation
annimmt (`AIPM_AI_ORGANIZATION_ID`). [geprüft: `src/app/ai-key-restriction-config.ts`] Ob Sie das
einstellen und ob Ihr Vertrag mit Anthropic diese Nutzung abdeckt, prüfen Sie. [Frage an Sie]

**GitHub.** GitHub hostet den Code, die Releases und die Issues und empfängt die oben beschriebenen
Update-Prüfungen. [geprüft: `desktop/src/updater.ts`] Der Maintainer hat keine Vereinbarung mit GitHub in
Ihrem Namen. [Aussage des Maintainers]
