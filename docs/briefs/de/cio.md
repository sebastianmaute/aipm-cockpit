# KI-Kurzinformation für die IT-Leitung (CIO)

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (diese Kurzinformationen nennen keinen Test
und keinen Lauf dafür), *geschätzt* oder *nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen
[Register](../../open-followups.md) (englisch) des Projekts, aufgeführt unter
[Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Die KI der App läuft mit dem eigenen Anthropic-API-Schlüssel der Nutzenden (E2, *getestet (Unit)*).
Projektdaten liegen dort, wo die nutzende Person oder die Installation es wählt (im Browser, in einer Datei auf
dem Gerät, in SharePoint oder in Turso), und der Server der App, betrieben dort, wo die Organisation ihn
installiert, speichert keine eigenen Projektdaten (E44, *im Code gelesen*). Anfragen an das Modell gehen direkt
aus dem Browser an Anthropic (der direkte Weg) oder über den Server der App (der Relay-Weg), der sie an das
Gateway der Organisation weiterleiten kann ([Diagramm](appendix.md#zwei-wege-zum-modell); E4,
*getestet (Unit)*; E5, *getestet (Unit)*); auf dem Relay-Weg läuft jede Anfrage samt ihren Projektinhalten
durch diesen Server (E34, *im Code gelesen*). Sie entscheiden über den Weg, die angenommenen Schlüssel, die
Schalter und die Beobachtung der Ausgaben: Nichts in der App hält interaktive KI bei einem Ausgabenlimit an
(E38, *im Code gelesen*).

## Was hinausgeht und wer es freigibt

- **An Anthropic oder Ihr Gateway:** die KI-Anfrage mit den Projektinhalten, die jede Funktion sendet
  ([KI-Pfade](appendix.md#ki-pfade); E1, *im Code gelesen*).
- **Vom Server der App:** Arbeitsbereichsdaten gehen nur an Dienste, die die nutzende Person oder die
  Organisation einrichtet (Anthropic oder sein Gateway, Atlassian, Timelog, ein Sprachdienst). Die
  Wechselkursanfrage trägt keine; die Update-Prüfung der Desktop-App trägt keine Arbeitsbereichsdaten, sendet
  aber die IP-Adresse des anfragenden Geräts und eine feste Kennung, die für jede Installation gleich ist
  ([Server-Ziele](appendix.md#server-ziele); E34, *im Code gelesen*). Wo die Löschung von Chats auf dem Server
  eingerichtet ist, hält der Server eine Turso-Adresse und ein Token (E44, *im Code gelesen*; E29,
  *im Code gelesen*).

## Was Sie steuern

- **Weg:** Ohne Gateway-Adresse und ohne Schlüsselbeschränkung ruft der Browser Anthropic selbst auf; ist eine
  von beiden gesetzt, ruft er das Relay der App auf, das an Ihr Gateway weiterleitet, wenn eines gesetzt ist
  (E4, *getestet (Unit)*; E5, *getestet (Unit)*). Der Gateway-Weg ist eingerichtet, aber nicht live belegt
  (§802; E12, *nicht belegt*).
- **Schlüssel:** Ist `AIPM_AI_ORGANIZATION_ID` gesetzt, nimmt das Relay nur Schlüssel Ihrer
  Anthropic-Organisation an, auf Wunsch nur aus bestimmten Workspaces, und leitet für andere nichts weiter
  (E7, *getestet (Unit)*). Eine *bestandene Prüfung* merkt sich der Server bis zu 15 Minuten; ein Schlüssel, der
  die Bedingung nicht mehr erfüllt, funktioniert also so lange weiter (E9, *getestet (Unit)*). Der Server hat
  keine eigenen Anthropic-Zugangsdaten und kann den Schlüssel einer nutzenden Person nicht widerrufen: Das ist
  Sache des Anthropic-Kontos, zu dem der Schlüssel gehört (E52, *im Code gelesen*).
- **Modell:** Alle Nutzenden wählen es aus den Modellen, die Anthropic für ihren Schlüssel auflistet, ohne
  Auswahl Claude Sonnet 5; kein Betriebsschalter legt es fest (E45, *getestet (Unit)*); die Zahlen gelten nur für
  claude-sonnet-5 (E33, *gemessen*).
- **Schalter:** KI aus oder Personenschutz in jedem Projekt erzwungen (E19, *getestet (Unit)*). Kein Schalter
  schaltet eine einzelne KI-Funktion ab (E42, *getestet (Unit)*); `stt` beendet das Diktat nicht, sondern
  verlegt es auf die eingebaute Spracherkennung des Browsers, die in manchen Browsern Audio an den
  Browserhersteller sendet; der Personenschutz schaltet das Diktat ab (E1, *im Code gelesen*; E18,
  *getestet (Unit)*).
- **Beobachtung:** Das Relay schreibt kein eigenes Protokoll, keines mit Schlüssel, Token, Inhalt oder URL,
  abgesehen von einer Warnung, einmal je Serverprozess und Grund, dass die Gateway- oder
  Schlüsselbeschränkungseinstellung ungültig ist; die Löschung der Chats warnt ebenso bei einer ungültigen
  Chat-Einstellung (nur der Grund). Die Nutzung wird nur in jedem Browser gezählt; Zahlen je nutzender Person
  müssen also von Anthropic oder Ihrem Gateway kommen (E65, *getestet (Unit)*; E6, *getestet (Unit)*; E38,
  *im Code gelesen*).
- **Kosten im großen Maßstab:** etwa 5 $, 13 $ oder 33 $ je nutzender Person und Monat bei leichter, typischer
  oder intensiver Nutzung (E25, *geschätzt*), aus 2 bis 6 Aufrufen je Funktion in einem Demoprojekt (E37,
  *gemessen*).

## Noch nicht belegt / offene Lücken

1. **§802:** Der Gateway-Weg lief noch nie gegen ein echtes Gateway (E12, *nicht belegt*).
2. **§814:** Diktat und Sprachbefehle haben weder gemessene Kosten noch beobachtetes Verhalten (E76,
   *nicht belegt*); ein abgelehnter Schlüssel wurde gemessen: Das Relay lehnt ihn mit einer Meldung ab und leitet
   nichts weiter (E39, *gemessen*).
3. **Anfragegrenzen sind geteilt und gelten je Prozess:** Sofern Sie `AIPM_TRUSTED_PROXY_HOPS` nicht setzen,
   teilen sich alle Aufrufer jeder der sechs begrenzten Routen, auch des Relays und des Diktats, eine Zählung
   (Jira und Confluence teilen sich eine gemeinsame), sodass ein Aufrufer sie für alle aufbrauchen kann; nur die
   Grenzen des Relays und des Diktats lassen sich erhöhen, die übrigen liegen fest bei 60 pro Minute; die
   Zählung liegt im Speicher jedes Serverprozesses und beginnt bei einem Neustart von vorn (E54, *getestet (Unit)*; der Speicher *im Code gelesen*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Legen Sie den Weg fest und halten Sie fest, welche [Betriebsschalter](appendix.md#betriebsschalter) Sie
  setzen. Sobald das Relay genutzt wird, stellen Sie den Server der App hinter Ihre eigene Zugangskontrolle: Die
  App authentifiziert ihre Aufrufer nicht (E13, *im Code gelesen*). Die Herkunftsprüfung des Relays beruht auf
  Headern, die der Aufrufer selbst setzen kann, hält also ein einfaches Skript auf, aber keinen entschlossenen
  Aufrufer. Seine Grenze (120 Aufrufe je Minute, sofern Sie keine andere setzen) zählt jeden Aufrufer nur dann
  getrennt, wenn vor dem Server Reverse-Proxys stehen, die die Adresse des Aufrufers an `x-forwarded-for`
  anhängen, und `AIPM_TRUSTED_PROXY_HOPS` auf ihre Anzahl gesetzt ist; sonst teilen sich alle Aufrufer die
  Grenze (E54, *getestet (Unit)*; E69, *getestet (Unit)*).
- Bevor Sie sich auf ein Gateway verlassen, verlangen Sie einen Lauf des Live-Nachweises über ein Test-Gateway
  Ihrer Organisation (§802; E12, *nicht belegt*).
- Fragen Sie Anthropic für das Konto Ihrer Organisation: was es von einer Anfrage aufbewahrt und wie lange, ob
  es damit trainiert, welche Gesellschaft und welche Region sie verarbeiten, welche Bedingungen zur
  Auftragsverarbeitung und welcher Übermittlungsmechanismus gelten, ob es eine Option ohne Aufbewahrung gibt und
  welche Ausgabenlimits und Nutzungsberichte es bietet, da die App keine hat (E38, *im Code gelesen*).
- Entscheiden Sie, wo die Projektdaten liegen (E44, *im Code gelesen*), und, falls Chats gespeichert werden
  sollen, wer den Wiederherstellungsschlüssel hält und welche Aufbewahrungsfrist gilt (E28,
  *im Code gelesen*; E29, *im Code gelesen*).

## Weiterlesen

- [Anhang](appendix.md): [die beiden Wege](appendix.md#zwei-wege-zum-modell), die Belegtabelle und die
  erzeugten Tabellen.
- Das [Betriebshandbuch](../../RUNBOOK.md) (englisch): KI auf Ihre Schlüssel beschränken, KI über ein Gateway
  leiten, gespeicherte Chats.
- [TOM-Übersicht](../../compliance/de/tom-sheet.md) und
  [Berührungspunkte mit dem Maintainer](../../compliance/de/vendor-touchpoints.md).
- Die anderen Kurzinformationen: [CEO](ceo.md), [CISO](ciso.md), [COO](coo.md), [DSB](dpo.md).
