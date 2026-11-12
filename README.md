# Fasnachtsperimeter Basel

1. **Perimeter laden:** CSV oder GeoJSON auswählen. Offene Punktfolgen werden
   automatisch geschlossen: letzter Punkt wird mit dem ersten verbunden.
2. **Gebäude importieren:** Excel mit **Strasse, Nummer, PLZ, Kommentar**
   auswählen. Die App gleicht die Adressen mit dem amtlichen GWR-Adressbestand ab.
3. **Auswahl anpassen:** Auf ein Gebäudedreieck klicken, um zwischen innerhalb
   und ausserhalb zu wechseln. Beliebig oft und für jedes gefundene Gebäude möglich.
4. **Alle Kategorien exportieren:** Eine Excel-Datei mit den Tabellenblättern
   **Innerhalb**, **Ausserhalb** und **Ungeklärt**, einschliesslich aller
   ursprünglichen Spalten und Kommentare. Ungeklärte Zeilen enthalten zusätzlich
   den Klärungsgrund. Leere Kategorien erhalten ein Blatt mit Kopfzeile.

Gefundene Gebäude erscheinen als **Dreiecke**: grün innerhalb, rot ausserhalb.
Der Kartenausschnitt wird auf die Treffer gesetzt. Nicht zuordenbare Adressen
stehen mit dem Grund in der Klärungsliste; sie bekommen keine erfundene Position.

Ein Klick auf ein Dreieck wechselt dessen Status, Farbe, Gebäudeebene und
Tabellenblatt im Export; die Zähler und das Popup werden sofort aktualisiert.
So lassen sich Gebäude zwischen «Innerhalb» und «Ausserhalb» verschieben.
Alle Excel-Zeilen desselben Adresspunkts wechseln gemeinsam. Ein weiterer Klick
wechselt den Status zurück, ohne den Kartenausschnitt zu verändern.

Die manuelle Auswahl gilt nur bis zur Bedienung des Bufferreglers, zum
Seitenreload oder zum erfolgreichen Laden eines neuen Perimeters bzw. einer
Gebäudeliste. Dann wird der Status wieder anhand der tatsächlichen Lage im
Perimeter einschliesslich der aktuellen Metererweiterung berechnet. Beim
Seitenreload müssen Perimeter und Gebäude erneut geladen werden.

## Start

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
python serve.py
```

**http://127.0.0.1:8000** öffnen. Beenden mit **Strg+C**.
Nach Quellcodeänderungen den laufenden Server beenden, neu starten und im
Browser **Strg+F5** drücken. Keine Paketinstallation nötig.

Bei jedem Seitenstart ist der Perimeter leer. Er muss ausdrücklich per Knopf
ausgewählt werden. Ein gewählter Perimeter bleibt bis zum nächsten Seitenstart
oder zur Auswahl eines anderen Perimeters aktiv.

Der Regler **«Perimeter nach aussen erweitern»** erweitert den gewählten
Perimeter um **0 bis 250 Meter**, in Schritten von einem Meter. Er startet bei
0 m und wird nach dem Laden eines Perimeters verfügbar. Kartenfläche, Dreiecke,
Zähler und Excel-Export verwenden die eingestellte Erweiterung. Das Ziehen
verändert den Kartenausschnitt nicht und lädt den GWR-Bestand nicht erneut.
Alle Einstellungen beziehen sich auf die Originalgrenze; 0 m stellt diese wieder
her. Bei Auswahl eines anderen Perimeters bleibt der eingestellte Meterwert aktiv.

## Perimeter und Gebäude

- CSV benötigt `Longitude` und `Latitude`; Komma, Semikolon und Tabulator
  werden erkannt. Die Zeilenreihenfolge bestimmt die Grenze.
- GeoJSON benötigt WGS84, Koordinaten als **[Längengrad, Breitengrad]**.
  Linien und Punktfolgen werden zu Polygonen; offene Polygonringe werden
  ebenfalls geschlossen. Mindestens drei unterschiedliche, nicht auf einer
  Geraden liegende Punkte sind erforderlich.
- Mehrere Flächen werden als Vereinigung geprüft. Polygonlöcher bleiben
  ausgenommen. Randpunkte zählen als innerhalb. Die Innenprüfung verwendet
  lokal das Strahlschnittverfahren; bei sich kreuzenden Grenzen gilt die
  Gerade-/Ungerade-Regel. Es gibt keine zusätzliche Topologie-Bibliothek.
- Die Metererweiterung verwendet eine lokale WGS84-Näherung für die Region Basel.
  Kanten werden um den gewählten Abstand erweitert, Ecken abgerundet. Löcher
  werden kleiner und können verschwinden; benachbarte Flächen können zusammenwachsen.
  Die Punktprüfung nutzt den metrischen Abstand zu den Originalkanten. Die
  gezeichneten Kreisrundungen weichen bei 250 m höchstens etwa 0,31 m von diesen
  Rundungen ab; die Kartenanzeige ist daher eine feine Näherung der Erweiterung.
- Maximal 20 MB pro Import und 5’000 Perimeterpositionen.
- Excel: erste Zeile enthält die Überschriften. Übliche Varianten wie
  `Strassenname`, `Hausnummer` und `Plz` werden automatisch erkannt.
  Hausnummerzusätze bleiben erhalten; PLZ ist vierstellig.
  Maximal 50’000 Datenzeilen und 256 Spalten. Leerzeilen werden ignoriert.
- Zähler und Export zählen Excel-Zeilen einschliesslich Duplikaten.
  Derselbe Adresspunkt wird nur einmal markiert. Klick wechselt den Status und
  zeigt Adresse, Kommentar und das aktuelle Tabellenblatt im Export.
- Beim Perimeterwechsel werden bereits importierte Gebäude neu ausgewertet.
  Ein fehlerhafter Dateiimport behält den bisherigen Stand.
- Der Export enthält alle Zeilen nach aktuellem Status getrennt in den Blättern
  «Innerhalb», «Ausserhalb» und «Ungeklärt». Innerhalb jedes Blatts bleiben die
  ursprüngliche Reihenfolge, Duplikate und sämtliche Originalspalten erhalten.
  Das Blatt «Ungeklärt» enthält zusätzlich den Klärungsgrund und immer alle
  ungeklärten Zeilen, auch wenn die Oberfläche nur die ersten 100 zeigt.
  Formatierungen, Makros und weitere Tabellenblätter der Quelldatei werden nicht
  übernommen; Formeln werden als gespeicherte Werte behandelt.

## Adressabgleich und Browserbibliotheken

Der Browser lädt den amtlichen Adressbestand Basel-Stadt, Datensatz 100259:

```text
https://data.bs.ch/api/explore/v2.1/catalog/datasets/100259/exports/json?limit=-1
```

Strasse, Hausnummer und PLZ werden lokal normalisiert und exakt abgeglichen.
Es werden keine Excel-Adressen oder Kommentare an einen Suchdienst gesendet.
Der Index bleibt nur im Arbeitsspeicher. Mehrdeutige Treffer werden ausgewiesen.
WGS84-Punkte sowie separate WGS84- und LV95/LV03-Koordinaten werden unterstützt.
Die optionale Landeskoordinatenumrechnung ist näherungsweise auf etwa 1 m genau.

Für die Geometrieprüfung ist **kein Turf erforderlich**. Die App lädt nur
Leaflet für die Karte und SheetJS für Excel, bevorzugt lokal:

| Bibliothek | Lokaler Pfad | Ersatzquelle im Browser |
| --- | --- | --- |
| Leaflet 1.9.4 | `vendor/leaflet/leaflet.js`, `leaflet.css`, `images/` | `unpkg.com` |
| SheetJS CE 0.20.3 | `vendor/sheetjs/xlsx.full.min.js` | `cdn.sheetjs.com` |

Die GeoBS-Grundkarte verwendet `wmts.geo.bs.ch`, Pfadreihenfolge **{z}/{y}/{x}**,
EPSG:3857 und die Ebenen `BaseMap_grau` / `BaseMap_farbig`.
Attribution: **GeoBS - Kanton Basel-Stadt**.

Die Sicherheitsrichtlinie erlaubt kein `unsafe-eval`. Der statische Server
liefert ausschliesslich freigegebene Quellcodedateien und optionale Bibliotheken.
Er liefert keine Datenverzeichnisse und nimmt keine Excel-Uploads entgegen.
Importe werden im Browser verarbeitet; keine Datenbank, Telemetrie oder
Speicherung in localStorage.

## Prüfungen mit synthetischen Daten

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
python -m unittest discover -s tests -p "test_*.py" -v
python tests/run_loader_checks.py
```

**74 JavaScript-Tests und acht Python-Tests bestehen.** Der optionale
JavaScript-Läufer verwendet unter Windows die bereits vorhandene `Chakra.dll`.
Er bündelt den tatsächlichen Anwendungsquellcode, ohne dessen Logik zu ersetzen.
Nur Browser-, Datei-, Modul- und HTTP-Zugriffe sowie Timer sind synthetische Adapter;
fehlende Standardmethoden der älteren Testlaufzeit werden ergänzt.

Geprüft werden unter anderem der komplette Ablauf vom Dateiknopf über eine offene
190-Punkte-CSV bis zu GWR-Zuordnung, Dreiecken und Excel-Export, offene
GeoJSON-Polygone, Innen-/Aussenpunkte, Randpunkte, Löcher und konkave Grenzen.
Zusätzlich geprüft: 0/250-m-Grenzen, runde Ecken, schrumpfende Löcher,
zusammenwachsende Teilflächen, Rückkehr zur Originalgrenze und Regleränderungen
einschliesslich Gebäudezuordnung und Export ohne erneuten Adressdownload.
Ebenfalls geprüft: wiederholtes Umschalten aller Marker, gemeinsame Auswahl
mehrfach vorhandener Excel-Zeilen, Farben, Gebäudeebenen, Popup und Export sowie
das Zurücksetzen bei Bufferbedienung, Perimeter-/Gebäudeimport und neuem Seitenstart.
Der Export wird mit allen drei Tabellenblättern, leeren Kategorien, manuellen
Statuswechseln und mehr als 100 ungeklärten Zeilen einschliesslich Klärungsgründen geprüft.
Die gleichen Tests stehen unter **http://127.0.0.1:8000/tests/index.html** bereit.

Es wurden keine echten Datendateien, Geheimnisse oder Live-Dienste abgefragt,
keine Software installiert und keine Downloads ausgeführt. Die tatsächliche
Live-Verfügbarkeit und Feldstruktur des GWR-Dienstes sind damit nicht bestätigt.

## Git-Befehle zum selbst Ausführen

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
git add -- README.md index.html src/analysis.js tests/building-flow.test.js
git diff --cached
git commit -m "Export all building categories to separate Excel worksheets"
```
