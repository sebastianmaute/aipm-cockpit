# Technische und organisatorische Maßnahmen

## Über dieses Dokument

## Maßnahmen

## Hosts, die der Browser kontaktieren darf

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

## Ziele des Servers und der Desktop-App

<!-- PACK:server-destinations:BEGIN -->
| Betrieben von | Code, der sendet | Was gesendet wird | Auslöser |
|---|---|---|---|
| Anthropic | src/app/api/ai/_relay.ts | Der eigene Anthropic-API-Schlüssel des Aufrufers und die KI-Anfrage selbst (die Unterhaltung samt Projektinhalten, die dem Assistenten mitgegeben wurden), weitergeleitet an api.anthropic.com, dazu die Modelllisten-Anfrage und vor jeder solchen Anfrage eine Modelllisten-Anfrage mit einem Eintrag und demselben Schlüssel, die prüft, zu welcher Organisation der Schlüssel gehört. | Wenn die Bereitstellung KI-Schlüssel auf eine Anthropic-Organisation beschränkt (AIPM_AI_ORGANIZATION_ID), keine Gateway-Adresse gesetzt ist und ein Nutzer eine KI-Anfrage sendet; ohne diese Beschränkung ruft der Browser Anthropic selbst auf, was die Liste der Browser-Hosts abdeckt. |
| Die bereitstellende Organisation | src/app/api/ai/_relay.ts | Dieselben Anfragen, die das Anthropic-Relay senden würde (der Anthropic-API-Schlüssel des Aufrufers, die KI-Anfrage selbst und die Modelllisten-Anfrage), adressiert an das Gateway der Bereitstellung, mit dem Gateway-Token, sofern eines gesetzt ist; sind Schlüssel auf eine Organisation beschränkt, geht jeder eine Modelllisten-Anfrage mit einem Eintrag und demselben Schlüssel voraus, die die Organisation des Schlüssels prüft. | Wenn die Bereitstellung eine Gateway-Adresse setzt (AIPM_AI_GATEWAY_URL) und ein Nutzer eine KI-Anfrage sendet. |
| Turso | src/app/api/ai/_chat-sweep.ts | Anweisungen, die die Tabelle der gespeicherten Chats anlegen, falls sie fehlt, und gespeicherte Chats löschen, die älter als die Aufbewahrungsdauer sind, gesendet an die Turso-Datenbank, mit der der Server konfiguriert ist, zusammen mit ihrem Turso-Auth-Token; die Anweisungen enthalten die Anzahl der Tage und lesen keine Chat-Inhalte. | Einmal beim Start des Servers und danach alle 24 Stunden, solange Turso-Zugangsdaten für die Löschung (oder die öffentliche Turso-Adresse der App) gesetzt sind und die Aufbewahrungseinstellung gültig ist. |
| Atlassian | src/app/api/jira | Die Jira-E-Mail-Adresse und das API-Token des Nutzers als Basic-Authentifizierung sowie die vom Nutzer ausgelöste Anfrage (zum Beispiel eine Suchabfrage oder die Felder eines Vorgangs, der angelegt, geändert oder weitergeschaltet wird, und die zugehörigen Abfragen wie Projekte, Vorgangstypen und Benutzer), gesendet an die eigene Atlassian-Cloud-Site des Nutzers (eine Adresse unter atlassian.net). | Wenn Jira in den Projekteinstellungen aktiviert ist, die Integration für die Bereitstellung nicht abgeschaltet wurde und ein Nutzer eine Jira-Funktion wie Suche, Import oder Abgleich verwendet. |
| Atlassian | src/app/api/confluence | Die Atlassian-E-Mail-Adresse und das API-Token des Nutzers als Basic-Authentifizierung sowie die ID der einen Confluence-Seite, die der Nutzer angefordert hat, gesendet an die eigene Atlassian-Cloud-Site des Nutzers (eine Adresse unter atlassian.net). | Wenn ein Nutzer eine Confluence-Seite importiert und die Integration für die Bereitstellung nicht abgeschaltet wurde. |
| Timelog | src/app/api/timelog | Das Timelog-Zugriffstoken des Nutzers als Bearer-Token, der Timelog-Mandantenname in der Adresse und die vom Nutzer ausgelöste Anfrage (ein Pfad, eine Abfrage und bei Schreibzugriffen die Zeitbuchungsdaten), gesendet an den eigenen Timelog-Host des Nutzers (eine Adresse unter timelog.com). | Wenn Timelog in den Einstellungen konfiguriert ist, die Integration für die Bereitstellung nicht abgeschaltet wurde und ein Nutzer eine Timelog-Funktion wie Zeitbuchung oder das Laden von Buchungen verwendet. |
| Ein vom Nutzer eingetragener Dienst | src/app/api/stt | Die aufgenommene Audiodatei des Diktats (als webm-Datei), der Name des Sprachmodells und der Speech-to-Text-API-Schlüssel des Nutzers als Bearer-Token, gesendet per https an die Endpunktadresse, die der Nutzer in den Diktat-Einstellungen eingetragen hat, sofern sie keine private IP-Adresse ist. | Wenn ein Nutzer diktiert und ein Speech-to-Text-Endpunkt konfiguriert ist, weder die Diktat-Integration, die KI-Integration noch die Personenschutz-Sperre für die Bereitstellung abgeschaltet ist und die KI-Gateway-Einstellung der Bereitstellung nicht ungültig ist. |
| Europäische Zentralbank | src/app/api/ecb | Eine einfache Anfrage nach den täglichen Euro-Referenzkursen der Europäischen Zentralbank, ohne Arbeitsbereichsdaten und ohne Zugangsdaten. | Wenn die App Wechselkurse lädt oder aktualisiert und die Integration ecb für die Bereitstellung nicht abgeschaltet wurde. |
| GitHub | desktop/src/updater.ts | Anfragen an github.com nach dem Releases-Feed der App (releases.atom), dem neuesten Release-Tag und dessen Update-Informationsdatei (latest.yml) und, wenn der Nutzer ein Update annimmt, ein Download des Installers (und seiner Block-Map, falls das Release eine hat) von den Release-Asset-Hosts von GitHub; die Update-Prüfungen und Downloads enthalten die IP-Adresse des Anfragenden, den User-Agent der Update-Bibliothek (electron-builder) und eine feste Kennung (Header x-user-staging-id), die für jede Installation gleich ist, jedoch keine Arbeitsbereichsdaten; die Bibliothek speichert weiterhin eine zufällige Kennung je Installation im Datenordner der App, sie bleibt aber auf dem Gerät und wird nicht gesendet. | In einer installierten Desktop-App 10 Sekunden nach dem Start und jedes Mal, wenn der Nutzer Nach Updates suchen wählt, außer AIPM_DISABLE_UPDATE_CHECK ist auf 1 gesetzt; der Download des Installers beginnt erst, wenn der Nutzer das Update annimmt. |
<!-- PACK:server-destinations:END -->

## Schalter für den Betrieb

<!-- PACK:deployment-switches:BEGIN -->
| Variable | Auch akzeptiert als | Gilt für | Erlaubte Werte | Wirkung |
|---|---|---|---|---|
| AIPM_AI_GATEWAY_URL | - | Server | - | Leitet die KI-Anfragen dieser Installation an die angegebene https-Gateway-Adresse statt direkt an Anthropic; ein unbrauchbarer Wert lässt KI-Anfragen scheitern, bis er korrigiert ist. |
| AIPM_AI_GATEWAY_TOKEN | - | Server | - | Token, das der Server mit jeder Anfrage an das KI-Gateway sendet; er erreicht den Browser nie, und ohne Gateway-Adresse ist die Einstellung ungültig. |
| AIPM_AI_ORGANIZATION_ID | - | Server | - | Beschränkt die KI-Nutzung auf API-Schlüssel dieser Anthropic-Organisation: Der Server prüft vor jeder Weiterleitung die Organisation des Schlüssels und lehnt andere Schlüssel ab; eine gesetzte Variable, deren Name in beliebiger Groß-/Kleinschreibung mit AIPM_AI_ beginnt und ORG oder WORKSPACE enthält, aber nicht genau dieser Name oder der Name der Workspace-IDs ist, lässt KI-Anfragen scheitern. |
| AIPM_AI_WORKSPACE_IDS | - | Server | - | Beschränkt die KI-Nutzung zusätzlich zur Organisations-ID auf Schlüssel der genannten Anthropic-Workspaces (kommagetrennt); ohne Organisations-ID ist die Einstellung ungültig, und eine gesetzte Variable, deren Name in beliebiger Groß-/Kleinschreibung mit AIPM_AI_ beginnt und ORG oder WORKSPACE enthält, aber nicht genau dieser Name oder der Name der Organisations-ID ist, lässt KI-Anfragen scheitern. |
| AIPM_DISABLED_INTEGRATIONS | - | Server | jira, confluence, timelog, ecb, stt, ai, ai-people | Kommagetrennte Integrationen, die diese Installation abschaltet: Der Server lehnt ihre Anfragen ab und die App blendet sie aus; der Wert ai-people erzwingt in jedem Projekt den Schutz von Personendaten. |
| AIPM_AI_CHAT_RETENTION_DAYS | - | Server | - | Tage, die ein gespeicherter KI-Chat aufbewahrt wird, bevor er nach Alter gelöscht wird, durch den Browser und durch das tägliche Löschen des Servers, wo es eingerichtet ist (1 bis 3650, ohne Angabe 30); ein ungültiger Wert pausiert das Löschen nach Alter, bis er korrigiert ist. |
| AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY | - | Server | - | RSA-Public-Key des Betreibers (Base64, mindestens 3072 Bit), für den gespeicherte KI-Chats zusätzlich zur Wiederherstellung verschlüsselt werden; solange er fehlt oder unbrauchbar ist, wird kein Chat gespeichert. |
| AIPM_CHAT_SWEEP_TURSO_URL | - | Server | - | Turso-Datenbankadresse, mit der sich das tägliche Löschen abgelaufener KI-Chats auf dem Server verbindet; ohne Angabe gilt stattdessen die öffentliche Turso-Adresse der App, und eine entfernte Adresse ohne Sweep-Token bedeutet, dass das tägliche Löschen nicht läuft. |
| AIPM_CHAT_SWEEP_TURSO_TOKEN | - | Server | - | Zugangstoken, der nur zusammen mit der Sweep-Datenbankadresse gilt (ohne diese ignoriert, es gilt dann das öffentliche Turso-Paar); eine entfernte Sweep-Adresse ohne ihn bedeutet, dass das tägliche Löschen nicht läuft. |
| AIPM_DISABLE_UPDATE_CHECK | - | Desktop-App | - | Auf 1 gesetzt, prüft die Desktop-App nicht auf Updates und zeigt keinen Update-Dialog. |
<!-- PACK:deployment-switches:END -->

## Was diese Maßnahmen nicht abdecken
