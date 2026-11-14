# KI-Kurzinformation für die Betriebsleitung (COO)

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (niemand hat es ausgeführt), *geschätzt* oder
*nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen [Register](../../open-followups.md) (englisch) des
Projekts, aufgeführt unter [Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Für den Betrieb ist die KI laufende Kosten auf dem eigenen Anthropic-Schlüssel der Nutzenden (E2,
*getestet (Unit)*) und ein Nutzen, den niemand gemessen hat; diese Kurzinformationen behaupten daher keinen
Nutzen (§811; E26, *nicht belegt*). Im Demoprojekt kostete ein Chat-Aufruf 0,0668 $ mit Personenschutz und
0,0711 $ ohne, die anderen Funktionen 0,0034 $ bis 0,0314 $ (E24, *gemessen*), bei einer Wartezeit (Median) von
2,0 s bis 24,1 s (E37, *gemessen*); jede Zahl beruht auf 2 bis 6 Aufrufen in einem Demoprojekt mit einem Modell
(E37, *gemessen*; E33, *gemessen*). Mit angenommenen Aufrufen je nutzender Person und Tag sind das etwa 5 $, 13 $ oder
33 $ je nutzender Person und Monat bei leichter, typischer oder intensiver Nutzung, nur für die Modellkosten;
Betrieb, Administration und Schulung sind nicht geschätzt (E25, *geschätzt*). Ein Pilot liefert die Zahl, an der
die Wirtschaftlichkeit hängt.

## Was hinausgeht und wer es freigibt

Was jede Funktion sendet, steht in der Tabelle [KI-Pfade](appendix.md#ki-pfade) (E1, *im Code gelesen*). Der
Text der Zusammenfassung etwa sendet Statuszahlen, die bald fälligen Meilensteine und den Betriebsleitfaden der
nutzenden Person für die Zusammenfassung, aber keine Namen von Personen, außer ein Meilensteinname enthält einen
(E1, *im Code gelesen*). Bei aktivem *Personenschutz* werden die Namen der Personen, die das Projekt kennt
(einwortige Namen nur dort, wo sie großgeschrieben sind), sowie jede E-Mail-Adresse, jede IBAN und jede Zahl in
Form einer Telefonnummer im Browser vor dem Senden durch Platzhalter ersetzt (E14, *getestet (Unit)*; E15,
*im Code gelesen*).

## Was Sie steuern

- **Wessen Schlüssel:** Anfragen über diese Installation lassen sich auf Schlüssel Ihrer eigenen
  Anthropic-Organisation und ihrer Workspaces beschränken, sodass die Nutzung auf diesen Schlüsseln läuft (E7,
  *getestet (Unit)*; E52, *im Code gelesen*); ein Schlüssel, der die Bedingung nicht mehr erfüllt, bleibt bis zu
  15 Minuten angenommen (E9, *getestet (Unit)*).
- **Ausgabenlimits:** Die App zählt die Nutzung nur im Browser der Nutzenden, und ihre Limits sind persönliche
  Einstellungen: Die Limits je Sitzung und je Woche benachrichtigen nur, und die optionale wöchentliche harte
  Obergrenze hält nur die Hintergrund-KI an. Nichts in der App hält interaktive KI bei einem Ausgabenlimit an
  (E38, *im Code gelesen*).
- **Aus:** Die Installation kann die KI ganz abschalten (E19, *getestet (Unit)*).

## Noch nicht belegt / offene Lücken

1. **§811:** Die Zeit, die die KI spart, ist nicht gemessen (E26, *nicht belegt*).
2. **§812:** Ob „Arbeitspakete mit KI optimieren“ sein Ergebnis wiederholt, ist nicht gemessen (E27,
   *nicht belegt*).
3. **§814:** Sechs Pfade haben weder gemessene Kosten noch beobachtetes Verhalten, darunter die wöchentliche
   harte Obergrenze (E39, *nicht belegt*).
4. **§798:** Nur der Text der Zusammenfassung auf Anfrage und der Schlüsseltest im Browser haben ein eigenes
   Zeitlimit. Auf dem Relay-Weg wird eine Antwort abgebrochen, die 15 Minuten lang nichts sendet, und eine
   Antwort mit Ratenlimit oder Überlastung wird den Nutzenden als solche angezeigt und nicht wiederholt (E40,
   *im Code gelesen*).
5. **§795:** Für Hintergrundläufe wird einmal zugestimmt, nicht für jeden Lauf (E32, *getestet (Unit)*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Messen Sie die Zeit je Aufgabe, bevor die KI eingeschaltet wird; ohne diese Ausgangsbasis bleibt die
  Nutzenfrage offen.
- Da die App interaktive Ausgaben nicht anhält (E38, *im Code gelesen*), fragen Sie den CIO, ob sich für die
  Anthropic-Organisation oder die Workspaces, zu denen die Schlüssel gehören, ein Ausgabenlimit und
  Nutzungsberichte einrichten lassen.
- **Pilot, als Vorlage:**
  - *Umfang:* Personenschutz erzwingen, gleich was ein Projekt gespeichert hat (E19, *getestet (Unit)*; E41,
    *getestet (Unit)*); das blendet den Vorschlag für die Ressourcenplanung und den RACI-Vorschlag aus und
    schaltet das Diktat ab (E18, *getestet (Unit)*). Den Vorschlag für ein neues Projekt auslassen, dessen
    Namen sich nicht schützen lassen: Kein Schalter erledigt das, informieren Sie die Nutzenden daher selbst
    (E35, *im Code gelesen*; E42, *im Code gelesen*). Ressourcenplanung und RACI erst, wenn Betriebsrat und DSB
    zustimmen; wird die Sperre aufgehoben, gilt wieder die eigene Einstellung jedes Projekts, prüfen Sie diese
    daher vorher (E43, *im Code gelesen*).
  - *Dauer und Größe:* nach Ihrer Wahl, etwa 6–12 Wochen und 10–30 Projektleitungen.
  - *Messen:* Ausgaben je nutzender Person und Woche; Zeit je Aufgabe gegenüber der Ausgangsbasis; wie viele
    KI-Vorschläge angenommen werden und wie viele Nacharbeit brauchen; Wiederholbarkeit des Vorschlags für den
    Projektstrukturplan (§812; E27, *nicht belegt*).
  - *Abbruch und Freigabe:* abbrechen, wenn Ausgaben, Nacharbeit oder ein Befund zum Personenschutz eine vorher
    von Ihnen festgelegte Grenze überschreiten (die Kurzinformationen nennen keine Werte; keiner ist gemessen);
    Freigabe durch Betriebsrat, DSB, CISO und die Budgetverantwortlichen.

## Weiterlesen

- [Gemessene Zahlen](appendix.md#gemessene-zahlen) und die
  [Teammonat-Schätzung](appendix.md#teammonat-schätzung), mit ihrer Rechnung.
- [Anhang](appendix.md), mit den [Betriebsschaltern](appendix.md#betriebsschalter).
- [Compliance-Paket](../../compliance/de/README.md) und seine
  [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md).
- Die anderen Kurzinformationen: [CEO](ceo.md), [CIO](cio.md), [PM](pm.md).
