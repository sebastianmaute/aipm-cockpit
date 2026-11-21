# KI-Kurzinformation für die Geschäftsführung (CEO)

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (diese Kurzinformationen nennen keinen Test
und keinen Lauf dafür), *geschätzt* oder *nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen
[Register](../../open-followups.md) (englisch) des Projekts, aufgeführt unter
[Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Die KI der App entwirft und schlägt Projektarbeit in 17 Funktionen vor, drei davon laufen im Hintergrund (E1,
*im Code gelesen*). Alle Nutzenden bringen ihren eigenen Anthropic-API-Schlüssel mit, und Anfragen an das
Modell gehen an Anthropic, direkt aus dem Browser (der direkte Weg) oder über den eigenen Server der App (der
Relay-Weg; siehe das [Diagramm](appendix.md#zwei-wege-zum-modell)) (E2, *getestet (Unit)*; E4,
*getestet (Unit)*); diktierte Sprache geht nicht an Anthropic, sondern an den Sprachdienst, den die nutzende
Person einrichtet, oder an die eingebaute Spracherkennung des Browsers (E1, *im Code gelesen*). Wie viel
Arbeitszeit die KI spart, hat niemand gemessen; diese
Kurzinformationen behaupten daher keinen Nutzen (§811; E26, *nicht belegt*). Zur Entscheidung steht keine
Einführung, sondern ein begrenzter Pilot, der das misst.

## Was hinausgeht und wer es freigibt

- **An Anthropic:** je nach Funktion Aufgaben, RAID-Einträge, Meilensteine, Stakeholder, Personen im
  Ressourcenverzeichnis, Abwesenheiten sowie angehängte Dateien und E-Mails
  ([KI-Pfade](appendix.md#ki-pfade); E1, *im Code gelesen*).
- **Personen:** Der *Personenschutz* ersetzt im Browser vor dem Senden die Namen der Personen, die das Projekt
  kennt (einen einwortigen Namen nur dort, wo er großgeschrieben ist), sowie jede E-Mail-Adresse, jede
  gültige IBAN und
  jede Zahl in Form einer Telefonnummer durch Platzhalter (E14, *getestet (Unit)*; E15, *im Code gelesen*).
  Namen, die das Projekt nicht kennt, in getipptem Text, angehängten E-Mails und Dateien oder in der
  Beschreibung eines neuen Projekts, werden so gesendet, wie sie dastehen (E35, *im Code gelesen*).
- **Region:** Alle 96 gemessenen Anfragen meldeten für Anthropics inference_geo den Wert `global` (E22,
  *gemessen*); was das für Übermittlungen bedeutet, ist eine Frage für die oder den DSB.
- **Freigabe in der App:** Alle Nutzenden akzeptieren den Datenhinweis zur KI auf jedem Gerät und erneut, wenn
  sich sein Text oder der Weg ändert (E31, *getestet (Unit)*).

Die Freigabe in der Organisation liegt bei Ihnen: Rechtsgrundlage, Ihr Vertrag und Ihre
Auftragsverarbeitungsvereinbarung mit Anthropic, Übermittlungen und eine Betriebsvereinbarung sind Fragen, die
nur Ihre Organisation beantworten kann.

## Was Sie steuern

- **Abschalten:** Die Installation kann die KI abschalten oder den Personenschutz in jedem Projekt erzwingen
  (E19, *getestet (Unit)*). Beides wirkt nur auf diese Installation, und der Schutz läuft im Browser; eine
  veränderte Kopie oder ein anderer Client mit demselben Schlüssel kann also ohne ihn senden (E52,
  *im Code gelesen*; E15, *im Code gelesen*).
- **Schlüssel:** Anfragen über diese Installation lassen sich auf Schlüssel Ihrer eigenen
  Anthropic-Organisation beschränken; andere Schlüssel werden abgelehnt, bevor irgendetwas weitergeleitet wird
  (E7, *getestet (Unit)*; E52, *im Code gelesen*), ein Schlüssel, der die Bedingung nicht mehr erfüllt, bleibt
  aber bis zu 15 Minuten angenommen (E9, *getestet (Unit)*).
- **Weg:** Der KI-Verkehr kann über Ihr eigenes Gateway laufen (E5, *getestet (Unit)*), noch nicht gegen ein
  echtes Gateway betrieben (§802; E12, *nicht belegt*).
- **Aufbewahrung:** Gespeicherte Chats gibt es nur mit einer Turso-Datenbank und dem Wiederherstellungsschlüssel
  des Betreibers (E28, *im Code gelesen*). Der Browser löscht sie 30 Tage nach ihrer letzten Änderung (der Betreiber
  kann 1 bis 3650 einstellen), ebenso der Server, wo eingerichtet (E29, *im Code gelesen*). Die
  Datenbankanweisungen sind auf einer Live-Datenbank getestet (E30, *getestet (Live-Datenbank)*), und je ein
  Live-Lauf beider Löschungen entfernte genau die erwarteten Chats (E74, *gemessen*); der Datenbankanbieter kann
  einen gelöschten Chat in den Standardtarifen von Turso noch 1 bis 90 Tage wiederherstellen (E75, *vom Anbieter angegeben*). Das Ende des Piloten löscht keinen Chat:
  Sie verschwinden, wenn die Frist abläuft oder der Betreiber sie löscht (E29, *im Code gelesen*; E57,
  *im Code gelesen*).

## Noch nicht belegt / offene Lücken

1. **§811:** Die Zeit, die die KI spart, ist nicht gemessen (E26, *nicht belegt*).
2. **§802:** Der Gateway-Weg lief noch nie gegen ein echtes Gateway (E12, *nicht belegt*).
3. **§814:** Diktat und Sprachbefehle haben weder gemessene Kosten noch beobachtetes Verhalten (E76,
   *nicht belegt*); die wöchentliche harte Obergrenze wurde gemessen und hielt die Hintergrund-KI an (E39,
   *gemessen*).
4. **Sicherungen:** Ein gelöschter Chat bleibt für die Frist des Tarifs, in den Standardtarifen von Turso 1 bis 90 Tage, aus dem
   Verlauf des Datenbankanbieters wiederherstellbar (E75, *vom Anbieter angegeben*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Bitten Sie die oder den DSB und den Betriebsrat, die
  [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md) zu prüfen und die Fragen oben zu
  beantworten, und fragen Sie den CIO, welche [Betriebsschalter](appendix.md#betriebsschalter) der Pilot setzt.
- **Pilot, als Vorlage:**
  - *Umfang:* Personenschutz erzwingen, gleich was ein Projekt gespeichert hat (E19, *getestet (Unit)*; E41,
    *getestet (Unit)*); das blendet den Vorschlag für die Ressourcenplanung und den RACI-Vorschlag aus und
    schaltet das Diktat ab (E18, *getestet (Unit)*). Den Vorschlag für ein neues Projekt auslassen, dessen
    Namen sich nicht schützen lassen: Kein Schalter erledigt das, informieren Sie die Nutzenden daher selbst
    (E35, *im Code gelesen*; E42, *getestet (Unit)*). Ressourcenplanung und RACI erst, wenn Betriebsrat und DSB
    zustimmen; wird die Sperre aufgehoben, gilt wieder die eigene Einstellung jedes Projekts, prüfen Sie diese
    daher vorher (E43, *im Code gelesen*).
  - *Dauer und Größe:* nach Ihrer Wahl, etwa 6–12 Wochen und 10–30 Projektleitungen.
  - *Budget:* etwa 5 $, 13 $ oder 33 $ je nutzender Person und Monat bei leichter, typischer oder intensiver
    Nutzung, nur Modellkosten, aus angenommener Nutzung (E25, *geschätzt*) und 2 bis 6 Aufrufen je Funktion in
    einem Demoprojekt mit einem Modell (E37, *gemessen*; E33, *gemessen*); nichts in der App setzt es durch (E38,
    *im Code gelesen*).
  - *Messen:* Ausgaben je nutzender Person und Woche; Zeit je Aufgabe gegenüber einer Ausgangsbasis; Annahme- und
    Nacharbeitsquote der KI-Vorschläge; wie stark der Vorschlag für den Projektstrukturplan in Ihren eigenen
    Projekten schwankt (§812; E27, *gemessen*).
  - *Abbruch und Freigabe:* abbrechen, wenn Ausgaben, Nacharbeit oder ein Befund zum Personenschutz eine vorher
    von Ihnen festgelegte Grenze überschreiten (die Kurzinformationen nennen keine Werte; keiner ist gemessen);
    Freigabe durch Betriebsrat, DSB, CISO und die Budgetverantwortlichen.

## Weiterlesen

- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- [Compliance-Paket](../../compliance/de/README.md), darunter der
  [Hinweis zur KI-Verordnung](../../compliance/de/ai-act-readiness.md).
- Die anderen Kurzinformationen: [CIO](cio.md), [CISO](ciso.md), [COO](coo.md), [DSB](dpo.md).
