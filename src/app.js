import {
  ALIASES, fieldSuggestion, validatePerimeter, buildAddressIndex,
  resolveAddress, classifyPoint, numeric,
} from './core.js';

const $ = id => document.getElementById(id);
const ADDRESS_URL = 'https://data.bs.ch/api/explore/v2.1/catalog/datasets/100259/exports/json?limit=-1';
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));
const state = {
  map: null, perimeter: null, perimeterLayer: null, index: null, records: null,
  imported: null, results: [], unresolved: [], busy: false, pendingWorkbook: null,
};
let L, turf, XLSX, layers, insideLayer, outsideLayer, triangleIcon;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function updateButtons() {
  const busy = state.busy;
  for (const id of ['perimeter-button', 'excel-button', 'addresses-button', 'address-fields-button', 'reset-button']) $(id).disabled = busy;
  $('export-button').disabled = busy || !state.results.some(result => result.inside);
  $('unresolved-export').disabled = busy || !state.unresolved.length;
  $('fit-button').disabled = busy || !state.perimeterLayer;
}

async function work(message, action) {
  if (state.busy) return;
  state.busy = true;
  updateButtons();
  status(message);
  try { await action(); }
  catch (error) { status(error.message || 'Die Verarbeitung ist fehlgeschlagen.', true); }
  finally { state.busy = false; updateButtons(); }
}

function clearResults() {
  state.results = [];
  state.unresolved = [];
  insideLayer.clearLayers();
  outsideLayer.clearLayers();
  $('inside-count').textContent = '–';
  $('outside-count').textContent = '–';
  $('unresolved-count').textContent = '0';
  $('unresolved-list').replaceChildren();
  $('unresolved-intro').textContent = 'Unvollständige, unbekannte oder mehrdeutige Adressen erscheinen hier.';
}

function displayAddress(row) {
  const columns = state.imported.columns;
  return `${row[columns.street] ?? ''} ${row[columns.house] ?? ''}, ${row[columns.postcode] ?? ''}`.trim();
}

function addMarkers() {
  const points = new Map();
  for (const result of state.results) {
    const key = JSON.stringify(result.coordinates);
    const point = points.get(key);
    if (point) point.count++;
    else points.set(key, { ...result, count: 1 });
  }
  for (const result of points.values()) {
    const [lon, lat] = result.coordinates;
    const marker = result.inside
      ? L.circleMarker([lat, lon], { radius: 6, color: '#075c35', weight: 1.5, fillColor: '#1aaf66', fillOpacity: 0.9 })
      : L.marker([lat, lon], { icon: triangleIcon, keyboard: true, title: 'Adresse ausserhalb des Perimeters' });
    const popup = document.createElement('div');
    popup.className = 'popup-content';
    const heading = document.createElement('strong');
    heading.textContent = displayAddress(result.row);
    const detail = document.createElement('span');
    detail.textContent = `${result.inside ? 'Innerhalb' : 'Ausserhalb'} · ${result.count} Excel-${result.count === 1 ? 'Zeile' : 'Zeilen'}`;
    popup.append(heading, detail);
    marker.bindPopup(popup).addTo(result.inside ? insideLayer : outsideLayer);
  }
  return points.size;
}

function showUnresolved() {
  $('unresolved-count').textContent = state.unresolved.length.toLocaleString('de-CH');
  const fragment = document.createDocumentFragment();
  for (const result of state.unresolved.slice(0, 200)) {
    const item = document.createElement('div');
    item.className = 'unresolved-item';
    item.append(document.createTextNode(`Zeile ${result.excelRow}: ${displayAddress(result.row)}`));
    const reason = document.createElement('span');
    reason.textContent = result.reason;
    item.append(reason);
    fragment.append(item);
  }
  $('unresolved-list').replaceChildren(fragment);
  $('unresolved-intro').textContent = state.unresolved.length > 200
    ? 'Die ersten 200 Einträge werden angezeigt. Der Download enthält alle nicht zugeordneten Zeilen.'
    : state.unresolved.length ? 'Diese Zeilen wurden weder als innerhalb noch als ausserhalb gezählt.' : 'Keine ungeklärten Adressen.';
}

async function evaluate() {
  clearResults();
  const missing = [];
  if (!state.perimeter) missing.push('Perimeter');
  if (!state.imported) missing.push('Excel');
  if (!state.index) missing.push('offizielle Adressdaten');
  if (missing.length) {
    $('summary').textContent = `Noch laden: ${missing.join(', ')}.`;
    status('Bereit. Die vorhandenen Importe bleiben bis zum Schliessen der Seite im Arbeitsspeicher.');
    return;
  }
  const results = [], unresolved = [];
  for (let i = 0; i < state.imported.rows.length; i++) {
    const item = state.imported.rows[i];
    const match = resolveAddress(item.row, state.imported.columns, state.index);
    if (match.reason) unresolved.push({ ...item, reason: match.reason });
    else results.push({ ...item, coordinates: match.coordinates, inside: classifyPoint(match.coordinates, state.perimeter, turf) });
    if (i % 500 === 0) {
      status(`Lokaler Adressabgleich: ${i.toLocaleString('de-CH')} / ${state.imported.rows.length.toLocaleString('de-CH')} Zeilen …`);
      await nextFrame();
    }
  }
  state.results = results;
  state.unresolved = unresolved;
  const inside = results.filter(result => result.inside).length;
  $('inside-count').textContent = inside.toLocaleString('de-CH');
  $('outside-count').textContent = (results.length - inside).toLocaleString('de-CH');
  const distinct = addMarkers();
  showUnresolved();
  $('summary').textContent = `${state.imported.rows.length.toLocaleString('de-CH')} Excel-Zeilen · ${distinct.toLocaleString('de-CH')} unterschiedliche Adresspunkte. Die Zähler und Exporte zählen Excel-Zeilen, einschliesslich Duplikaten.`;
  status(`Auswertung abgeschlossen. ${inside} innerhalb, ${results.length - inside} ausserhalb, ${unresolved.length} nicht zugeordnet.`);
  fitAll();
}

function fitAll() {
  const bounds = L.latLngBounds([]);
  if (state.perimeterLayer) bounds.extend(state.perimeterLayer.getBounds());
  for (const group of [insideLayer, outsideLayer]) if (group.getLayers().length) bounds.extend(group.getBounds());
  if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17 });
}

function checkTopology(perimeter) {
  for (const feature of perimeter.features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of polygons) {
      const polygon = turf.polygon(rings);
      if (turf.area(polygon) <= 0 || turf.kinks(polygon).features.length) throw new Error('Der Perimeter enthält eine leere Fläche oder sich kreuzende Kanten. Bitte das GeoJSON korrigieren.');
      const outer = turf.polygon([rings[0]]);
      for (let i = 1; i < rings.length; i++) {
        const hole = turf.polygon([rings[i]]);
        if (!turf.booleanContains(outer, hole)) throw new Error('Ein Polygonloch liegt nicht vollständig im Aussenring.');
        for (let j = 1; j < i; j++) {
          const previous = turf.polygon([rings[j]]);
          if (turf.booleanIntersects(hole, previous)) throw new Error('Polygonlöcher dürfen sich nicht überlappen oder berühren.');
        }
      }
    }
  }
}

async function loadPerimeter(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('GeoJSON zu gross: maximal 10 MB.');
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('Die Datei ist kein gültiges JSON.'); }
  const perimeter = validatePerimeter(parsed);
  checkTopology(perimeter);
  const bounds = turf.bbox(perimeter);
  if (bounds[0] < 7.4 || bounds[2] > 7.8 || bounds[1] < 47.45 || bounds[3] > 47.7) {
    throw new Error('Der Perimeter liegt ausserhalb der Region Basel. WGS84 und die Reihenfolge [Längengrad, Breitengrad] prüfen.');
  }
  const replacement = L.geoJSON(perimeter, { style: { color: '#a18408', weight: 2, fillColor: '#f6df3c', fillOpacity: 0.3 } });
  if (state.perimeterLayer) {
    state.map.removeLayer(state.perimeterLayer);
    layers.removeLayer(state.perimeterLayer);
  }
  state.perimeter = perimeter;
  state.perimeterLayer = replacement;
  replacement.addTo(state.map);
  layers.addOverlay(replacement, '<span class="legend-swatch"></span>Perimeter');
  $('perimeter-caption').textContent = `${file.name} · eigener Perimeter`;
  await evaluate();
  fitAll();
}

function fillSelect(id, fields, suggested = '', labels = fields) {
  const select = $(id);
  select.replaceChildren(new Option('Bitte auswählen …', ''));
  fields.forEach((field, index) => select.add(new Option(labels[index], field)));
  select.value = suggested;
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) throw new Error('Das Tabellenblatt ist leer.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 50000 || range.e.c > 255) throw new Error('Maximal 50’000 Datenzeilen und 256 Spalten pro Tabellenblatt erlaubt.');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true, range: 0 });
}

function refreshExcelFields() {
  $('excel-mapping-error').textContent = '';
  try {
    const data = sheetRows(state.pendingWorkbook, $('sheet-select').value);
    const header = data[0] ?? [];
    const fields = header.map((_, index) => String(index));
    const labels = header.map((value, index) => `${XLSX.utils.encode_col(index)} · ${String(value ?? '(ohne Überschrift)')}`);
    for (const name of ['street', 'house', 'postcode']) {
      const suggestion = fieldSuggestion(header.map(value => String(value ?? '')), ALIASES[name]);
      const index = suggestion ? header.findIndex(value => String(value) === suggestion) : -1;
      fillSelect(`${name}-select`, fields, index >= 0 ? String(index) : '', labels);
    }
  } catch (error) {
    for (const name of ['street', 'house', 'postcode']) fillSelect(`${name}-select`, []);
    $('excel-mapping-error').textContent = error.message;
  }
}

async function openExcel(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('Bitte eine .xlsx- oder .xls-Datei wählen.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Excel-Datei zu gross: maximal 20 MB.');
  let workbook;
  try { workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, cellFormula: false, bookVBA: false }); }
  catch { throw new Error('Die Excel-Datei konnte nicht gelesen werden. Verschlüsselte Dateien werden nicht unterstützt.'); }
  if (!workbook.SheetNames.length) throw new Error('Die Excel-Datei enthält kein Tabellenblatt.');
  state.pendingWorkbook = workbook;
  fillSelect('sheet-select', workbook.SheetNames, workbook.SheetNames[0]);
  // A sheet is always selected; remove the placeholder.
  $('sheet-select').options[0].remove();
  refreshExcelFields();
  $('excel-dialog').showModal();
  status('Tabellenblatt und Adressspalten zuordnen.');
}

function setCoordinateMode() {
  const point = $('coordinate-mode').value === 'point';
  $('point-fields').hidden = !point;
  $('separate-fields').hidden = point;
  $('official-point').required = point;
  $('official-x').required = !point;
  $('official-y').required = !point;
}

function openOfficialFields() {
  const fields = [...new Set(state.records.slice(0, 100).flatMap(Object.keys))].sort();
  for (const name of ['street', 'house', 'postcode', 'point']) fillSelect(`official-${name}`, fields, fieldSuggestion(fields, ALIASES[name]));
  const lon = fieldSuggestion(fields, ALIASES.lon), lat = fieldSuggestion(fields, ALIASES.lat);
  const east = fieldSuggestion(fields, ALIASES.east), north = fieldSuggestion(fields, ALIASES.north);
  fillSelect('official-x', fields, lon || east);
  fillSelect('official-y', fields, lat || north);
  let mode = 'point';
  if (!$('official-point').value) {
    if (lon && lat) mode = 'wgs84';
    else if (east && north) {
      const sample = state.records.find(row => Number.isFinite(numeric(row[east])));
      mode = numeric(sample?.[east]) > 2000000 ? 'lv95' : 'lv03';
    }
  }
  $('coordinate-mode').value = mode;
  setCoordinateMode();
  $('fields-mapping-error').textContent = '';
  $('fields-dialog').showModal();
}

async function loadOfficialAddresses() {
  $('address-status').textContent = 'Offizieller Bestand wird geladen …';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(ADDRESS_URL, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Der offizielle Adressdienst antwortet mit HTTP ${response.status}. Bitte später erneut versuchen.`);
    const payload = await response.json();
    // Explore API v2.1 exports use a JSON array, not a paged records response.
    if (!Array.isArray(payload) || !payload.length || payload.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Unerwartetes Format des offiziellen Exports. Erwartet wird eine JSON-Liste von Adressdatensätzen.');
    }
    state.records = payload;
    $('address-fields-button').hidden = false;
    $('address-status').textContent = `${payload.length.toLocaleString('de-CH')} Datensätze geladen. Feldzuordnung bestätigen.`;
    openOfficialFields();
    status('Amtliche Datenfelder kontrollieren und übernehmen.');
  } catch (error) {
    $('address-status').textContent = state.index ? 'Bisheriger Adressindex bleibt aktiv.' : 'Nicht geladen. Internetzugang und Verfügbarkeit von data.bs.ch prüfen.';
    if (error.name === 'AbortError') throw new Error('Adressdownload nach drei Minuten abgebrochen. Bitte erneut versuchen.');
    if (error instanceof TypeError) throw new Error('Adressdienst nicht erreichbar (Netzwerk oder CORS). Es wurden keine Adressen ausgewertet.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function exportExcel(unresolved = false) {
  if (!state.imported) return;
  const selected = unresolved ? state.unresolved : state.results.filter(result => result.inside);
  if (!selected.length) return;
  const headers = [...state.imported.header];
  if (unresolved) {
    let name = 'Klärungsgrund';
    while (headers.includes(name)) name += '_';
    headers.push(name);
  }
  const rows = selected.map(result => {
    const row = Array.from({ length: state.imported.header.length }, (_, index) => result.row[index] ?? null);
    return unresolved ? [...row, result.reason] : row;
  });
  // Arrays preserve duplicate column names and column order. String values remain
  // string cells, including strings beginning with '=', '+', '-' or '@'.
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows], { cellDates: true });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, unresolved ? 'Nicht zugeordnet' : 'Innerhalb Perimeter');
  XLSX.writeFile(workbook, unresolved ? 'fasnacht_klaerungsliste.xlsx' : 'fasnacht_in_perimeter.xlsx', { bookType: 'xlsx', compression: true });
  status(`${selected.length} Excel-Zeilen exportiert.`);
}

function bindEvents() {
  $('perimeter-button').addEventListener('click', () => $('perimeter-file').click());
  $('excel-button').addEventListener('click', () => $('excel-file').click());
  for (const [id, handler, message] of [
    ['perimeter-file', loadPerimeter, 'Perimeter wird geprüft …'],
    ['excel-file', openExcel, 'Excel wird lokal gelesen …'],
  ]) {
    $(id).addEventListener('change', event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (file) work(message, () => handler(file));
    });
  }
  $('addresses-button').addEventListener('click', () => work('Offizielle Adressdaten werden geladen …', loadOfficialAddresses));
  $('address-fields-button').addEventListener('click', openOfficialFields);
  $('coordinate-mode').addEventListener('change', setCoordinateMode);
  $('sheet-select').addEventListener('change', refreshExcelFields);
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('excel-dialog').addEventListener('close', () => { state.pendingWorkbook = null; });
  $('excel-form').addEventListener('submit', event => {
    event.preventDefault();
    const values = ['street', 'house', 'postcode'].map(name => $(`${name}-select`).value);
    if (values.some(value => value === '') || new Set(values).size !== 3) {
      $('excel-mapping-error').textContent = 'Drei unterschiedliche Adressspalten auswählen.';
      return;
    }
    let data;
    try { data = sheetRows(state.pendingWorkbook, $('sheet-select').value); }
    catch (error) { $('excel-mapping-error').textContent = error.message; return; }
    const width = Math.max(...data.map(row => row.length));
    const header = Array.from({ length: width }, (_, index) => data[0][index] ?? null);
    const rows = data.slice(1).map((row, index) => ({ row, excelRow: index + 2 }))
      .filter(item => item.row.some(value => value !== null && value !== undefined && String(value).trim() !== ''));
    if (!rows.length) { $('excel-mapping-error').textContent = 'Keine Datenzeilen im gewählten Blatt.'; return; }
    state.imported = { header, rows, columns: { street: +values[0], house: +values[1], postcode: +values[2] } };
    $('excel-dialog').close();
    work('Excel wird ausgewertet …', evaluate);
  });
  $('fields-form').addEventListener('submit', event => {
    event.preventDefault();
    const mapping = Object.fromEntries(['street', 'house', 'postcode', 'point', 'x', 'y'].map(name => [name, $(`official-${name}`).value]));
    mapping.mode = $('coordinate-mode').value;
    const addressFields = [mapping.street, mapping.house, mapping.postcode];
    if (addressFields.some(value => !value) || new Set(addressFields).size !== 3 || (mapping.mode !== 'point' && mapping.x === mapping.y)) {
      $('fields-mapping-error').textContent = 'Unterschiedliche, vollständige Adress- und Koordinatenfelder auswählen.';
      return;
    }
    const built = buildAddressIndex(state.records, mapping);
    if (!built.usable) {
      $('fields-mapping-error').textContent = 'Keine plausiblen Adresspunkte in Basel gefunden. Feldzuordnung und Koordinatenformat prüfen.';
      return;
    }
    state.index = built.index;
    $('address-status').textContent = `${built.usable.toLocaleString('de-CH')} Adresspunkte indexiert · Sitzung ${new Date().toLocaleDateString('de-CH')}${mapping.mode.startsWith('lv') ? ' · Koordinatenumrechnung ca. 1 m Genauigkeit' : ''}`;
    $('fields-dialog').close();
    work('Adressbestand wird abgeglichen …', evaluate);
  });
  $('export-button').addEventListener('click', () => work('Excel wird erstellt …', () => exportExcel()));
  $('unresolved-export').addEventListener('click', () => work('Klärungsliste wird erstellt …', () => exportExcel(true)));
  $('fit-button').addEventListener('click', fitAll);
  $('reset-button').addEventListener('click', () => work('Excel wird aus der Sitzung entfernt …', async () => {
    state.imported = null;
    state.pendingWorkbook = null;
    await evaluate();
  }));
}

function start() {
  L = window.L; turf = window.turf; XLSX = window.XLSX;
  if (!L || !turf || !XLSX) {
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    status('Bibliotheken konnten nicht geladen werden. Internetzugang zu unpkg.com, cdn.jsdelivr.net und cdn.sheetjs.com prüfen und die Seite neu laden.', true);
    return;
  }
  state.map = L.map('map', { preferCanvas: true }).setView([47.5596, 7.5886], 14);
  const basemap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · Adressen: <a href="https://data.bs.ch/explore/dataset/100259/" target="_blank" rel="noopener noreferrer">Kanton Basel-Stadt, 100259</a>',
  }).addTo(state.map);
  let tileErrorShown = false;
  basemap.on('tileerror', () => {
    if (!tileErrorShown) { tileErrorShown = true; status('Hintergrundkarte nicht erreichbar. Internetzugang zu tile.openstreetmap.org prüfen; die lokale Auswertung bleibt möglich.', true); }
  });
  insideLayer = L.featureGroup().addTo(state.map);
  outsideLayer = L.featureGroup().addTo(state.map);
  triangleIcon = L.divIcon({ className: 'building-triangle', html: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1L17 16H1Z" fill="#dd3e34" stroke="#8d221e" stroke-width="1.3"/></svg>', iconSize: [18, 18], iconAnchor: [9, 9] });
  layers = L.control.layers({ OpenStreetMap: basemap }, { 'Innerhalb · grüne Kreise': insideLayer, 'Ausserhalb · rote Dreiecke': outsideLayer }, { position: 'topright', collapsed: true }).addTo(state.map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);
  bindEvents();
  updateButtons();
}

if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });
