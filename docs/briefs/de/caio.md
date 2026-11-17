# KI-Kurzinformation für die KI-Verantwortung (Chief AI Officer)

*So lesen Sie diese Seite:* `E<n>` ist eine Zeile der [Belegtabelle](appendix.md#belegtabelle); ihre
[Belegart](appendix.md#belegarten) ist *gemessen*, *getestet (Unit)* (ein Test mit Attrappen, kein Lauf gegen
echte Dienste), *getestet (Live-Datenbank)*, *im Code gelesen* (diese Kurzinformationen nennen keinen Test
und keinen Lauf dafür), *geschätzt* oder *nicht belegt*. `§N` ist ein offener Eintrag im öffentlichen
[Register](../../open-followups.md) (englisch) des Projekts, aufgeführt unter
[Offene Lücken](appendix.md#offene-lücken).

## Auf einen Blick

Die KI der App entwirft, analysiert und schlägt Projektmanagement-Arbeit in 17 Funktionen vor, drei davon laufen
im Hintergrund (E1, *im Code gelesen*). Außerhalb des Chats wendet eine Funktion, die Änderungen vorschlägt,
nichts an, bevor eine Person es tut, so der Code, ohne dass ein Test es festlegt; der Chat wendet eine einzelne
gewöhnliche Änderung sofort an, sofern nicht das Projekt oder die Bereitstellung jede KI-Änderung prüfen lässt
(E56, *im Code gelesen*; E47, *getestet (Unit)*; E71, *getestet (Unit)*). Zwei Funktionen schlagen
Änderungen an der Arbeit von Personen vor: Der Vorschlag für die Ressourcenplanung („Mit KI planen“) schlägt
geplante Stunden von Personen und Verschiebungen offener Aufgaben zwischen ihnen vor, und der RACI-Vorschlag
schlägt eine Rolle je Person und Meilenstein vor (E56, *im Code gelesen*). Wie sich diese Funktionen und Ihre
Nutzung zu Anhang III der KI-Verordnung verhalten, ordnet Ihre Organisation ein; diese Seite liefert die Fakten
dafür, keine Schlussfolgerung. Nichts in diesen Kurzinformationen misst Genauigkeit, Verzerrung oder
Wiederholbarkeit dieser Vorschläge, und die App tut nichts dafür, dass eine Anfrage zweimal dieselbe Antwort
ergibt (§812; E27, *nicht belegt*; E61, *im Code gelesen*).

## Was hinausgeht und wer es freigibt

- **Die Anfragen mit dem stärksten Personenbezug:** Die Anfrage zur Ressourcenplanung enthält je Person Rolle,
  Status als extern, geplante und verfügbare Stunden und, sofern nicht das Projekt oder die Bereitstellung
  Stundensätze heraushält, den internen Stundensatz ihrer Rolle (E72, *getestet (Unit)*); die RACI-Anfrage
  enthält Einfluss und Interesse der Stakeholder; Insights aus Timelog nennen eine Person mit Befunden zu ihrer
  erfassten Arbeitszeit und gehen bei ausgeschaltetem Personenschutz an den Chat, die Bearbeitung einer Zeile und
  die Insight-Empfehlungen ([KI-Pfade und Personendaten](appendix.md#ki-pfade-und-personendaten); E1,
  *im Code gelesen*); bei aktivem Personenschutz an keinen davon,
  außer dass der Chat die früheren Nachrichten eines Gesprächs unverändert erneut sendet (E67, *getestet (Unit)*;
  das erneute Senden *im Code gelesen*).
- **Wo eine Person freigibt:** Jede Änderung der Ressourcenplanung und des RACI-Vorschlags wird mit ihrem
  bisherigen und dem vorgeschlagenen Wert gezeigt und lässt sich abwählen (E56, *im Code gelesen*). Der Chat
  hält Änderungen in festgelegten Fällen für die nutzende Person auf einer *Prüfkarte* fest, etwa bei einer
  Löschung oder mehr als einer Änderung, und jede Änderung, solange eine Datei angehängt ist, außer der
  Optimierung der Arbeitspakete, die ihre eigene Vorschau öffnet; ein wieder geöffneter gespeicherter Chat behält
  keinen Anhang (E47, *getestet (Unit)*). Ergebnisse der Hintergrund-KI ändern keinen
  Projektdatensatz, bevor jemand bestätigt (E56, *im Code gelesen*).
- **Wo niemand vorher freigibt:** eine einzelne gewöhnliche Änderung im Chat, auch nach dem Lesen fremden Textes
  ohne Kennzeichnung seiner Herkunft, etwa aus einer importierten Datei angelegter Einträge (E47,
  *getestet (Unit)*; E48, *getestet (Unit)*), sofern nicht das Projekt oder die Bereitstellung jede KI-Änderung
  prüfen lässt: Dann wartet jede Änderung an Projektdaten, die der Chat vorschlägt, auf der Prüfkarte, auch
  allein, und ein Lesezugriff wartet nie (E71, *getestet (Unit)*).

## Was Sie steuern

- **Personenbezogene KI aus:** `ai-people` erzwingt den Personenschutz in jedem Projekt (E19,
  *getestet (Unit)*); das blendet den Vorschlag für die Ressourcenplanung und den RACI-Vorschlag aus und
  schaltet das Diktat ab (E18, *getestet (Unit)*), und solange er aktiv ist, übernimmt die App aus einer
  KI-Antwort nichts Personenbezogenes (E17, *getestet (Unit)*).
- **Grenzen dieses Schalters:** Der Schutz läuft im Browser, eine veränderte Kopie kann also ohne ihn senden
  (E15, *im Code gelesen*); Namen, die das Projekt nicht kennt, werden so gesendet, wie sie dastehen, und die
  Namen eines neuen Projekts lassen sich nicht schützen (E35, *im Code gelesen*); wird die Sperre aufgehoben,
  gilt für jedes Projekt wieder seine gespeicherte Einstellung (E43, *im Code gelesen*). Kein Schalter schaltet
  eine einzelne Funktion ab (E42, *getestet (Unit)*).
- **Prüfung und Stundensätze:** `ai-direct-writes` schickt jede Änderung des Chats in jedem Projekt auf die
  Prüfkarte, und `ai-rates` hält Stundensätze aus „Mit KI planen“, der Prognose im Chat und den Dashboard-Zahlen heraus; ohne sie kann jedes Projekt beides in
  Einstellungen → KI festlegen, und beides ist aus, bis es gesetzt wird (E71, *getestet (Unit)*; E72,
  *getestet (Unit)*).
- **KI im Hintergrund:** `ai-background` pausiert die Analyse durch geplante Aufträge, die automatischen
  Insight-Empfehlungen und die geplante Zusammenfassung des Digests in jedem Projekt, und jedes Projekt kann sie in
  Einstellungen → KI pausieren; KI, die eine Person startet, bleibt unberührt, und die Pause zieht niemandes
  Hintergrund-Zustimmung zurück (E32, *getestet (Unit)*).
- **Zu Artikel 50 (Transparenz):** Die Oberflächen benennen die KI („KI-Assistent“, „Claude fragen“,
  „KI-generiert – vor dem Handeln prüfen.“), und das Aktivitätsprotokoll zeigt ihre Änderungen im Chat mit dem
  Akteur „KI-Assistent“; Projektdokumente, die die KI schreibt, und die Digest-Mail mit ihrer Zusammenfassung sind
  gekennzeichnet (E73, *getestet (Unit)*); anderer Text, den sie schreibt, nicht (E55, *im Code gelesen*).
- **KI-Kompetenz nach Artikel 4:** Siehe das [Material zur KI-Kompetenz](../../compliance/de/ai-literacy.md) und
  die [Musterhinweise](../../compliance/de/model-notices.md) im Compliance-Paket.

## Noch nicht belegt / offene Lücken

1. **Die Kennzeichnung ist teilweise:** Nur Projektdokumente, die die KI schreibt, und die Digest-Mail mit ihrer
   Zusammenfassung sind gekennzeichnet (E73, *getestet (Unit)*). Aufgaben, Berichtstext, Chat-Antworten,
   kopierter Text und die Exporte des Arbeitsbereichs sind es nicht; legen Sie also fest, wie sie
   gekennzeichnet werden, sobald sie die App verlassen (E55, *im Code gelesen*).
2. **§812:** Ob die Optimierung der Arbeitspakete ihr Ergebnis wiederholt, ist nicht gemessen (E27,
   *nicht belegt*).
3. **Fremder Text ohne Kennzeichnung:** Fremder Text ohne Kennzeichnung seiner Herkunft löst die Prüfpflicht
   nicht aus; eine aus Jira synchronisierte Aufgabe tut es (E48, *getestet (Unit)*). Nur die Prüfung jeder
   Änderung deckt ihn ab (E71, *getestet (Unit)*).

## Was Sie vor einer Zusage prüfen oder verlangen sollten

- Schreiben Sie auf, wofür Ihre Organisation Ressourcenplanung und RACI nutzen wird, und lesen Sie das, neben der
  [Zweckbestimmung des Maintainers](../../compliance/de/ai-act-readiness.md#rollen), mit dem
  [Hinweis zur KI-Verordnung](../../compliance/de/ai-act-readiness.md#zuteilungs--und-raci-vorschläge-anhang-iii)
  gegen Anhang III Nummer 4 Buchstabe b (im Bereich Beschäftigung unter anderem KI, die Aufgaben aufgrund des
  individuellen Verhaltens oder persönlicher Merkmale zuweist oder Beschäftigte beobachtet und bewertet) und
  Artikel 6 Absatz 3; bis das geklärt ist, erzwingen Sie den Schutz (E18, *getestet (Unit)*; E19,
  *getestet (Unit)*).
- Beantworten Sie für Ihre Organisation: Ist sie Anbieter oder Betreiber dessen, was sie auf der App aufbaut,
  wer beaufsichtigt Ressourcenplanung und RACI, wie lange werden Protokolle aufbewahrt, und wie werden
  Beschäftigte informiert? Das Aktivitätsprotokoll der App nennt die KI als Akteur ihrer Änderungen im Chat,
  ihrer Berichtsentwürfe und übernommener Projektstrukturpläne (E55, *im Code gelesen*; E62, *im Code gelesen*;
  E66, *im Code gelesen*).
- Bitten Sie den Chat in einem Testprojekt um eine einzelne Terminänderung an einer Aufgabe, deren zuständige
  Person dann nicht abwesend ist: Sie wird ohne Karte angewendet, und das Aktivitätsprotokoll zeigt sie als
  Änderung der KI; mit angehängter Datei, oder wenn „Jede KI-Änderung prüfen“ in Einstellungen → KI
  eingeschaltet ist, wartet dieselbe Bitte (E47, *getestet (Unit)*; E55, *im Code gelesen*; E71,
  *getestet (Unit)*).
- Fragen Sie Anthropic, was es von einer Anfrage aufbewahrt, ob es damit trainiert und welche Bedingungen für
  Ihr Konto gelten.

## Weiterlesen

- [Hinweis zur KI-Verordnung](../../compliance/de/ai-act-readiness.md),
  [Musterhinweise](../../compliance/de/model-notices.md) und
  [KI-Kompetenz](../../compliance/de/ai-literacy.md).
- [Anlage für den Betriebsrat](../../compliance/de/works-council-annex.md#was-die-ki-ohne-freigabe-durch-eine-person-tun-darf).
- [Anhang](appendix.md): die Belegtabelle, die beiden Wege und die erzeugten Tabellen.
- Die anderen Kurzinformationen: [CEO](ceo.md), [DSB](dpo.md), [PM](pm.md).
