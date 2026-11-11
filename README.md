# Fasnachtsperimeter Basel

1. **Perimeter laden:** CSV oder GeoJSON auswählen. Offene Punktfolgen werden
   automatisch geschlossen: letzter Punkt wird mit dem ersten verbunden.
2. **Gebäude importieren:** Excel mit **Strasse, Nummer, PLZ, Kommentar**
   auswählen. Die App gleicht die Adressen mit dem amtlichen GWR-Adressbestand ab.
3. **Perimeter-Gebäude exportieren:** Excel mit den Zeilen innerhalb des
   Perimeters, einschliesslich aller ursprünglichen Spalten und Kommentare.

Gefundene Gebäude erscheinen als **Dreiecke**: grün innerhalb, rot ausserhalb.
Der Kartenausschnitt wird auf die Treffer gesetzt. Nicht zuordenbare Adressen
stehen mit dem Grund in der Klärungsliste; sie bekommen keine erfundene Position.

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
- Maximal 20 MB pro Import und 5’000 Perimeterpositionen.
- Excel: erste Zeile enthält die Überschriften. Übliche Varianten wie
  `Strassenname`, `Hausnummer` und `Plz` werden automatisch erkannt.
  Hausnummerzusätze bleiben erhalten; PLZ ist vierstellig.
  Maximal 50’000 Datenzeilen und 256 Spalten. Leerzeilen werden ignoriert.
- Zähler und Export zählen Excel-Zeilen einschliesslich Duplikaten.
  Derselbe Adresspunkt wird nur einmal markiert. Klick zeigt Adresse und Kommentar.
- Beim Perimeterwechsel werden bereits importierte Gebäude neu ausgewertet.
  Ein fehlerhafter Dateiimport behält den bisherigen Stand.
- Der Export enthält nur die Innen-Zeilen in ursprünglicher Reihenfolge,
  mit sämtlichen ursprünglichen Spalten. Formatierungen, Makros und weitere
  Tabellenblätter werden nicht übernommen; Formeln werden als gespeicherte Werte
  behandelt.

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

**60 JavaScript-Tests und acht Python-Tests bestehen.** Der optionale
JavaScript-Läufer verwendet unter Windows die bereits vorhandene `Chakra.dll`.
Er bündelt den tatsächlichen Anwendungsquellcode, ohne dessen Logik zu ersetzen.
Nur Browser-, Datei-, Modul- und HTTP-Zugriffe sowie Timer sind synthetische Adapter;
fehlende Standardmethoden der älteren Testlaufzeit werden ergänzt.

Geprüft werden unter anderem der komplette Ablauf vom Dateiknopf über eine offene
190-Punkte-CSV bis zu GWR-Zuordnung, Dreiecken und Excel-Export, offene
GeoJSON-Polygone, Innen-/Aussenpunkte, Randpunkte, Löcher und konkave Grenzen.
Die gleichen Tests stehen unter **http://127.0.0.1:8000/tests/index.html** bereit.

Es wurden keine echten Datendateien, Geheimnisse oder Live-Dienste abgefragt,
keine Software installiert und keine Downloads ausgeführt. Die tatsächliche
Live-Verfügbarkeit und Feldstruktur des GWR-Dienstes sind damit nicht bestätigt.

## Git-Befehle zum selbst Ausführen

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
git add -p -- README.md index.html serve.py src/app.js src/core.js tests/core.test.js tests/index.html tests/test_static.py
git add -- src/analysis.js src/analysis-core.js src/bootstrap.js tests/analysis.test.js tests/building-flow.test.js tests/bootstrap.test.js tests/markers.test.js tests/run_loader_checks.py vendor/README.md vendor/leaflet/README.md
git diff --cached
git commit -m "Remove Turf dependency and close perimeters automatically"
```
