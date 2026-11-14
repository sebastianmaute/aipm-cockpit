# KI-Kurzinformation für die IT-Leitung (CIO)

## Auf einen Blick

Die KI der App läuft mit dem eigenen Anthropic-API-Schlüssel jeder Person (E2, *getestet (Unit)*).
Projektdaten liegen dort, wo die Person oder die Installation es wählt, und der eigene Server der App hält
keine davon (E44, *im Code gelesen*). Anfragen an das Modell gehen direkt aus dem Browser an Anthropic oder
über den Server der App, der sie an das Gateway der Organisation weiterleiten kann (E4, *getestet (Unit)*; E5,
*getestet (Unit)*). Sie entscheiden über den Weg, die angenommenen Schlüssel, die Schalter und
die Beobachtung der Ausgaben: Nichts in der App hält interaktive KI bei einem Ausgabenlimit an (E38,
*im Code gelesen*).

## Was hinausgeht und wer es freigibt

- **Gespeicherte Daten:** in der eigenen Datenbank des Browsers, in einer Datei auf dem Gerät, auf einer
  SharePoint-Website oder in einer Turso-Datenbank; der Server der App läuft dort, wo die Organisation ihn
  betreibt, und in der Desktop-App auf dem Gerät der Person (E44, *im Code gelesen*).
- **An Anthropic oder Ihr Gateway:** die KI-Anfrage mit den Projektinhalten, die jede Funktion sendet
  ([KI-Pfade](appendix.md#ki-pfade); E1, *im Code gelesen*).
- **Vom Server der App:** Arbeitsbereichsdaten gehen nur an Dienste, die die Person oder die Organisation
  einrichtet (Anthropic oder sein Gateway, Atlassian, Timelog, ein Sprachdienst); die Wechselkursanfrage und
  die Update-Prüfung der Desktop-App tragen keine ([Server-Ziele](appendix.md#server-ziele); E34,
  *im Code gelesen*).
- **Freigabe in der App:** Jede Person schaltet die KI ein und akzeptiert den KI-Datenhinweis auf jedem Gerät,
  erneut, wenn sich der Weg ändert (E31, *getestet (Unit)*); die Hintergrund-KI braucht eine eigene Zustimmung
  (E32, *getestet (Unit)*).

## Was Sie steuern

- **Weg:** Ohne Gateway-Adresse und ohne Schlüsselbeschränkung ruft der Browser Anthropic selbst auf; ist eine
  von beiden gesetzt, ruft er das Relay der App auf, das an Ihr Gateway weiterleitet, wenn eines gesetzt ist
  (E4, *getestet (Unit)*; E5, *getestet (Unit)*). Der Gateway-Weg ist eingerichtet, aber nicht live belegt
  (§802; E12, *nicht belegt*).
- **Schlüssel:** Ist `AIPM_AI_ORGANIZATION_ID` gesetzt, nimmt das Relay nur Schlüssel Ihrer
  Anthropic-Organisation an, auf Wunsch nur aus bestimmten Workspaces, und leitet für andere nichts weiter
  (E7, *getestet (Unit)*). Ein Bestehen wird bis zu 15 Minuten gehalten; ein Schlüssel, der die Bedingung
  nicht mehr erfüllt, funktioniert also so lange weiter (E9, *getestet (Unit)*). Schlüssel werden im
  Browser verschlüsselt gespeichert (E46, *getestet (Unit)*).
- **Modell:** Jede Person wählt es aus den Modellen, die Anthropic für ihren Schlüssel auflistet, ohne Auswahl
  Claude Sonnet 5; kein Betriebsschalter legt es fest (E45, *im Code gelesen*). Alle gemessenen Zahlen gelten
  für claude-sonnet-5 (E33, *gemessen*).
- **Schalter:** KI aus oder Personenschutz in jedem Projekt erzwungen (E19, *getestet (Unit)*); kein Schalter
  schaltet eine einzelne KI-Funktion ab (E42, *im Code gelesen*).
- **Kosten im großen Maßstab:** etwa 25 $, 67 $ oder 165 $ im Monat für ein Team von fünf Personen bei
  leichter, typischer oder intensiver Nutzung; die Rechnung multipliziert mit der Zahl der Personen, und die
  Aufrufe je Person sind angenommen (E25, *geschätzt*). Die Nutzung wird nur im Browser jeder Person gezählt
  (E38, *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§802:** Der Gateway-Weg lief noch nie gegen ein echtes Gateway (E12, *nicht belegt*).
2. **§805:** Das Relay fügt das Gateway-Token für jeden Aufrufer hinzu, der den Server erreicht; die
   Server-Routen authentifizieren ihre Aufrufer nicht (E13, *im Code gelesen*).
3. **§798:** Die meisten KI-Aufrufe haben kein eigenes Zeitlimit; das Relay bricht eine Antwort ab, die
   15 Minuten lang nichts sendet, und eine Antwort mit Ratenlimit oder Überlastung wird nicht wiederholt (E40,
   *im Code gelesen*).
4. **§814:** Sechs Pfade haben weder gemessene Kosten noch beobachtetes Verhalten, darunter ein abgelehnter
   Schlüssel (E39, *nicht belegt*).
5. **§813:** Das Löschen gespeicherter Chats ist live nur für seine Datenbankanweisungen belegt (E30,
   *getestet (Live-Datenbank)*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Legen Sie den Weg fest und halten Sie fest, welche [Betriebsschalter](appendix.md#betriebsschalter) Sie
  setzen. Mit einem Gateway stellen Sie den Server der App hinter Ihre eigene Zugangskontrolle, weil das Relay
  keinen Aufrufer prüft (E13, *im Code gelesen*).
- Bevor Sie sich auf das Gateway verlassen, lassen Sie den geschriebenen Live-Nachweis gegen Ihres laufen
  (E12, *nicht belegt*).
- Fragen Sie, ob sich Ausgabenlimits und Nutzungsberichte für die Anthropic-Organisation oder die Workspaces
  der Schlüssel einrichten lassen; die App kann interaktive Ausgaben nicht anhalten (E38, *im Code gelesen*).
- Entscheiden Sie, wo die Projektdaten liegen (E44, *im Code gelesen*), und, falls Chats gespeichert werden
  sollen, wer den Wiederherstellungsschlüssel hält und welche Aufbewahrungsfrist gilt (E28,
  *im Code gelesen*; E29, *im Code gelesen*).

## Weiterlesen

- [Anhang](appendix.md): [die beiden Wege](appendix.md#zwei-wege-zum-modell), die Belegtabelle und die
  erzeugten Tabellen.
- Der [Betriebsleitfaden](../../RUNBOOK.md) (englisch): KI auf Ihre Schlüssel beschränken, KI über ein Gateway
  leiten, gespeicherte Chats.
- [TOM-Übersicht](../../compliance/de/tom-sheet.md) und
  [Berührungspunkte mit Anbietern](../../compliance/de/vendor-touchpoints.md).
- Die anderen Kurzinformationen: [CEO](ceo.md), [CISO](ciso.md), [COO](coo.md), [DSB](dpo.md).
