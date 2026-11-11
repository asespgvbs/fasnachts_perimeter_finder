# Fasnachtsperimeter Basel

Kleine Leaflet-Anwendung ohne Datenbank und ohne Anwendungsbackend. Excel und
GeoJSON werden ausschliesslich im Browser verarbeitet. Der Perimeter wird vom
Benutzer geliefert; es werden keine Grenzkoordinaten vorgegeben oder erfunden.

## Start

Python 3 wird für einen rein lokalen statischen Dateiserver verwendet. Keine
Paketinstallation erforderlich:

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
python serve.py
```

Im Browser **http://127.0.0.1:8000** öffnen. Zum Beenden im Terminal `Strg+C`.
Alternativer Port: `python serve.py --port 8080`.
Die HTML-Datei nicht direkt per `file://` öffnen, da die JavaScript-Module HTTP
benötigen. Der Server nimmt keine Uploads entgegen und stellt nur explizit
freigegebene Quellcodedateien bereit, keine Verzeichnislisten oder Datendateien.

## Bedienung

1. **Perimeter laden:** eigenes GeoJSON auswählen. Unterstützt werden Polygon,
   MultiPolygon, Feature und FeatureCollection mit ausschliesslich diesen
   Flächen. Mehrere Flächen werden als Vereinigung betrachtet; Löcher bleiben
   ausgenommen. Geschlossene Ringe und WGS84 / EPSG:4326 in der Reihenfolge
   **[Längengrad, Breitengrad]** sind erforderlich. Schweizer Landeskoordinaten
   im Perimeter vorher in einem GIS umprojizieren. Flächen ausserhalb der Region
   Basel und sich kreuzende Kanten werden abgelehnt.
2. **Offizielle Adressdaten laden:** der Browser lädt den JSON-Export von
   [Datensatz 100259](https://data.bs.ch/explore/dataset/100259/).
   Anschliessend die vorgeschlagenen Datenfelder für Strasse, Hausnummer, PLZ
   und Koordinaten kontrollieren und bestätigen. Die genaue Feldstruktur und
   die Live-Verfügbarkeit wurden bei der Entwicklung wegen des Netzwerkverbots
   nicht abgefragt; deshalb ist die Feldzuordnung konfigurierbar.
3. **Excel importieren:** `.xlsx` oder `.xls` öffnen, Tabellenblatt sowie die drei
   Adressspalten wählen. Erste Zeile = Überschriften. Hausnummerzusätze müssen in
   derselben Spalte wie die Nummer stehen, beispielsweise `12a`. PLZ: vierstellig.
   Höchstens 20 MB, 50’000 Datenzeilen und 256 Spalten. Leere Zeilen werden
   ignoriert. Die Reihenfolge der drei Importschritte ist beliebig.
4. Grüne Kreise bedeuten innerhalb, rote Dreiecke ausserhalb. Rechts oben lässt
   sich der **Perimeter** über die Layersteuerung aus- und einschalten. Auch die
   beiden Punktgruppen lassen sich dort schalten. Ausschalten des Layers ändert
   die räumliche Auswertung nicht. Klick auf einen Punkt zeigt die Adresse.
5. **In-Perimeter-Liste:** erzeugt eine neue `.xlsx` mit allen zugehörigen
   Originalzeilen, ursprünglichen Spaltennamen und ursprünglicher Spaltenfolge.
   Mehrfach vorkommende Adressen und doppelte Spaltennamen bleiben erhalten.
   Formatierungen, Makros, Formeln und andere Tabellenblätter werden nicht
   übernommen; bei Formelzellen werden vorhandene gespeicherte Werte verwendet.
6. **Nicht zugeordnet:** unbekannte, unvollständige und mehrdeutige Adressen sowie
   Adressen ohne plausible Koordinaten erscheinen separat. Der Download der
   Klärungsliste ergänzt die ursprünglichen Spalten um den Klärungsgrund.

Die beiden Zähler zählen Excel-Zeilen, nicht eindeutige EGID-Gebäude. Die Zahl
unterschiedlicher Adresspunkte steht zusätzlich in der Zusammenfassung. Am
gleichen Punkt liegende Zeilen teilen sich einen Marker. Ein Adresspunkt auf
einer Perimetergrenze zählt als innerhalb, auch auf einem Lochrand.

## Adressabgleich und Koordinaten

Der Browser lädt den vollständigen amtlichen Bestand über:

```text
https://data.bs.ch/api/explore/v2.1/catalog/datasets/100259/exports/json?limit=-1
```

Es werden keine Excel-Adressen als Suchanfragen übermittelt. Abgleich über
normalisierten Strassennamen, Hausnummer inklusive Zusatz und PLZ. Gross- und
Kleinschreibung, Akzente, `ß`/`ss`, Leerzeichen, Satzzeichen und die Endung
`str.`/`strasse` werden vereinheitlicht. Keine unscharfe Suche und keine
automatische Ergänzung fehlender Hausnummern. Entstehen dabei mehrere
unterschiedliche amtliche Punkte, wird die Adresse zur Klärung ausgewiesen.

Unterstützte amtliche Punktfelder:

- Objekt `{ "lon": …, "lat": … }`, alternativ `lng` statt `lon`.
- GeoJSON Point bzw. Feature mit Point; auch als JSON-String.
- Array `[Längengrad, Breitengrad]`.
- Separate WGS84-Felder.
- Separate LV95 (Ost E / Nord N) oder LV03 (Y / X). Die Umrechnung nutzt die
  näherungsweisen swisstopo-Polynome mit etwa einem Meter Genauigkeit. Für eine
  Auswertung unmittelbar an der Grenze amtliche WGS84-Felder bevorzugen.

Koordinaten werden auf Plausibilität in der Region Basel geprüft. Die
Klassifikation verwendet Turf.js `booleanPointInPolygon` gegen die unveränderten
importierten Flächen. Ergebnisse beziehen sich auf amtliche Adresspunkte,
nicht auf Gebäudegrundrisse oder die Lage sämtlicher Gebäudeteile.

## Internet und Datenschutz

Bei der Entwicklung wurden durch Codex keine Netzwerkzugriffe ausgeführt.
Beim **Benutzen der App** lädt der Browser folgende Ressourcen:

| Zweck | Quelle |
| --- | --- |
| Leaflet 1.9.4 | `unpkg.com` |
| Turf.js 6.5.0 | `cdn.jsdelivr.net` |
| SheetJS CE 0.20.3 | `cdn.sheetjs.com` |
| Hintergrundkarte | `tile.openstreetmap.org` |
| Amtlicher Adressbestand, nach Button-Klick | `data.bs.ch` |

Die App benötigt für diesen Betrieb Internet und ist nicht vollständig offline.
Der Download des Adressbestands kann mehrere Megabyte umfassen. Bei Netzwerk-,
CORS- oder API-Fehlern wird keine Ersatzgeokodierung verwendet. Die Fehlermeldung
erscheint unten. Es gibt keine Speicherung in localStorage, Cookies, Telemetrie
oder automatische Übertragung importierter Dateien. Geladene CDN-Bibliotheken
laufen im Browser mit Zugriff auf den Seitenspeicher; für einen abgeschotteten
Betrieb müssen diese nach gesonderter Freigabe lokal bereitgestellt werden.
Neuladen der Seite entfernt alle Importe aus der Sitzung. Ein Button entfernt
zusätzlich nur die Excel-Daten, ohne Perimeter oder Adressbestand zu verwerfen.

## Prüfungen mit synthetischen Daten

Ohne Netzwerk und ohne laufenden Server:

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
python -m unittest discover -s tests -p "test_*.py" -v
```

Diese Tests prüfen den statischen Server ohne Sockets, Dateifreigaben,
HTTP-Header und die Quellcodedateien. Sie lesen keine produktiven Datendateien.

Nach dem Start des Servers **http://127.0.0.1:8000/tests/index.html** öffnen:
Die JavaScript-Kerntests verwenden ausschliesslich künstliche Adressen und
Polygone und laufen ohne externe Ressourcen. Ein separater Button lädt Turf
und SheetJS für zusätzliche synthetische Geometrie- und Excel-Rundlauftests.
Dabei wird kein amtlicher Adressdienst abgefragt und keine Excel-Datei geöffnet
oder heruntergeladen. Diese Browsertests wurden in der Entwicklungsumgebung
mangels JavaScript-/Browser-Testlaufzeit nicht ausgeführt.

## Git

Codex führt keine Änderungen am Git-Zustand aus. Bei Bedarf selbst ausführen:

```powershell
cd C:\dev\repos\fasnacht_perimeter_check
git add -- .gitignore index.html styles.css serve.py README.md src/app.js src/core.js tests/index.html tests/core.test.js tests/test_static.py
git commit -m "Add browser-based Basel Fasnacht perimeter address checker"
```
