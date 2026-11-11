# Optionale lokale Browserbibliotheken

Bereits vorhandene Distributionen können inklusive ihrer Lizenzen hier liegen:

- `leaflet/leaflet.js`, `leaflet/leaflet.css`, `leaflet/images/` (Leaflet 1.9.4).
- `sheetjs/xlsx.full.min.js` (SheetJS CE 0.20.3).

Die App probiert zuerst diese lokalen Dateien. Fehlen Bibliotheken, lädt der
Browser sie automatisch von `unpkg.com` und `cdn.sheetjs.com`.
Die Perimeterprüfung benötigt keine zusätzliche Browserbibliothek.
Codex hat keine Distribution heruntergeladen und nichts installiert.
