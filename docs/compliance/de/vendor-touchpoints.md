# Berührungspunkte mit dem Anbieter

## Über dieses Dokument

## Was beim Maintainer ankommt

### Updates

### Support und Schwachstellenmeldungen

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

## Rollen
