# KI-Kurzinformation für die Geschäftsführung (CEO)

## Auf einen Blick

Die KI der App entwirft und schlägt Projektarbeit vor: ein Chat-Assistent, Änderungen an Zeilen, Entwürfe für
den Lenkungsausschuss-Bericht, Analysen und Planungsvorschläge, drei davon laufen im Hintergrund; der Anhang
führt alle 17 Funktionen auf und sagt, was jede sendet (E1, *im Code gelesen*). Jede Person bringt ihren eigenen
Anthropic-API-Schlüssel mit, und Anfragen an das Modell gehen an Anthropic, direkt aus dem Browser oder über den
eigenen Server der App (E2, *getestet (Unit)*; E4, *getestet (Unit)*). Wie viel Arbeitszeit die KI spart, hat
niemand gemessen (E26, *nicht belegt*). Zur Entscheidung steht daher keine Einführung, sondern ein begrenzter
Pilot, der das misst.

## Was hinausgeht und wer es freigibt

- **An Anthropic:** je nach Funktion Aufgaben, RAID-Einträge, Meilensteine, Stakeholder, Personen im
  Ressourcenverzeichnis, Abwesenheiten sowie angehängte Dateien und E-Mails
  ([KI-Pfade](appendix.md#ki-pfade); E1, *im Code gelesen*).
- **Personen:** Bei aktivem Personenschutz werden die Namen, E-Mail-Adressen und Telefonnummern der Personen,
  die das Projekt kennt, vor dem Senden durch Platzhalter ersetzt (E14, *getestet (Unit)*). Namen, die es nicht
  kennt, und die Namen in der Beschreibung eines neuen Projekts werden so gesendet, wie sie dastehen (E35,
  *im Code gelesen*).
- **Region:** Alle 96 gemessenen Anfragen meldeten für Anthropics inference_geo den Wert `global` (E22,
  *gemessen*).
- **Andere Dienste,** mit denen die App spricht, sind mit dem aufgeführt, was jeder erhält (E34,
  *im Code gelesen*).
- **Freigabe in der App:** Jede Person akzeptiert den KI-Datenhinweis auf jedem Gerät und erneut, wenn sich sein
  Text oder der Weg ändert (E31, *getestet (Unit)*); die drei Hintergrundfunktionen brauchen eine eigene
  Zustimmung, die einmal gegeben wird (E32, *getestet (Unit)*).

Die Freigabe in der Organisation liegt bei Ihnen: Rechtsgrundlage, Ihr Vertrag und Ihre
Auftragsverarbeitungsvereinbarung mit Anthropic, Übermittlungen und eine Betriebsvereinbarung sind Fragen, die
nur Ihre Organisation beantworten kann.

## Was Sie steuern

- **Abschalten:** Die Installation kann die KI abschalten oder den Personenschutz in jedem Projekt erzwingen
  (E19, *getestet (Unit)*).
- **Schlüssel:** Die KI lässt sich auf Schlüssel Ihrer eigenen Anthropic-Organisation beschränken; andere
  Schlüssel werden abgelehnt, bevor irgendetwas weitergeleitet wird (E7, *getestet (Unit)*).
- **Weg:** Der KI-Verkehr kann über Ihr eigenes Gateway laufen (E5, *getestet (Unit)*).
- **Aufbewahrung:** Gespeicherte Chats gibt es nur mit einer Turso-Datenbank; sie werden 30 Tage nach ihrer
  letzten Änderung gelöscht, sofern der Betreiber nicht 1 bis 3650 Tage einstellt (E28, E29,
  *im Code gelesen*).
- **Grenze:** Der Schutz gilt in der App, wie sie ausgeliefert wird; eine veränderte Kopie oder ein anderer
  Client mit demselben Schlüssel kann ohne ihn senden (E15, *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§811:** Die Zeit, die die KI spart, ist nicht gemessen (E26, *nicht belegt*).
2. **§802:** Der Gateway-Weg lief noch nie gegen ein echtes Gateway (E12, *nicht belegt*).
3. **§814:** Sechs Pfade haben weder gemessene Kosten noch beobachtetes Verhalten, darunter die wöchentliche
   harte Obergrenze (E39, *nicht belegt*).
4. **§813:** Das Löschen von Chats ist auf einer echten Datenbank nur für die Löschanweisungen belegt, nicht für
   die Löschläufe, die Sicherungen des Anbieters oder das, was der Modellanbieter aufbewahrt (E30,
   *getestet (Live-Datenbank)*).
5. **§795:** Der Hintergrund-KI wird einmal zugestimmt; sie wird nicht Lauf für Lauf freigegeben (E32,
   *getestet (Unit)*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Bitten Sie die Datenschutzbeauftragten und den Betriebsrat, die
  [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md) zu prüfen und die Fragen oben zu
  beantworten, und fragen Sie den CIO, welche [Betriebsschalter](appendix.md#betriebsschalter) der Pilot setzt.
- **Pilot, als Vorlage:**
  - *Umfang:* Personenschutz erzwingen (E19, *getestet (Unit)*); das blendet den Vorschlag für die
    Ressourcenplanung und den RACI-Vorschlag aus und schaltet das Diktat ab (E18, *getestet (Unit)*). Den
    Vorschlag für ein neues Projekt auslassen, dessen Namen sich nicht schützen lassen (E35,
    *im Code gelesen*). Ressourcenplanung und RACI erst, wenn Betriebsrat und Datenschutzbeauftragte zustimmen.
  - *Dauer und Größe:* nach Ihrer Wahl, etwa 6–12 Wochen und 10–30 Projektleitungen.
  - *Budget:* etwa 25 $, 67 $ oder 165 $ im Monat je Team von fünf Personen bei leichter, typischer oder
    intensiver Nutzung (E25, *geschätzt*).
  - *Messen:* Ausgaben je Person und Woche; Zeit je Aufgabe gegenüber einer Ausgangsbasis; Annahme- und
    Nacharbeitsquote der KI-Vorschläge; Wiederholbarkeit des Vorschlags für den Projektstrukturplan über
    mehrere Läufe (§812; E27, *nicht belegt*).
  - *Abbruch und Freigabe:* abbrechen, wenn Ausgaben, Nacharbeit oder ein Befund zum Personenschutz eine vorher
    festgelegte Grenze überschreiten; Freigabe durch Betriebsrat, Datenschutzbeauftragte, CISO und die
    Budgetverantwortlichen.

## Weiterlesen

- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- [Compliance-Paket](../../compliance/de/README.md), darunter der
  [Hinweis zur KI-Verordnung](../../compliance/de/ai-act-readiness.md).
- Die anderen Kurzinformationen: [CIO](cio.md), [CISO](ciso.md), [COO](coo.md), [DSB](dpo.md).
