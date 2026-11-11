import { setupBuildingAnalysis } from '../src/analysis.js';
import { startViewer } from '../src/app.js';

// Isolated UI, file, map and HTTP adapters. No real files, requests or libraries.
const messages = [];
let passed = 0, failed = 0;
function assert(value, message = 'Bedingung nicht erfüllt') { if (!value) throw new Error(message); }
async function test(name, callback) {
  try { await callback(); passed++; messages.push(`OK  ${name}`); }
  catch (error) { failed++; messages.push(`FEHLER  ${name}: ${error.message}`); }
}
function element() {
  return { textContent: '', hidden: false, open: false, disabled: false, value: '', files: [], handlers: {},
    classList: { toggle() {}, add() {}, remove() {} }, append() {}, replaceChildren() {},
    addEventListener(name, callback) { this.handlers[name] = callback; }, click() { this.clicks = (this.clicks || 0) + 1; } };
}
function layer(children = []) {
  return { children: [...children], addTo(target) { if (target.addLayer) target.addLayer(this); return this; },
    addLayer(child) { this.children.push(child); }, removeLayer() {}, clearLayers() { this.children = []; },
    bindPopup() { return this; }, getBounds() {
      let valid = this.children.some(child => child.marker || child.getBounds().isValid());
      return { isValid: () => valid, extend(other) { valid = valid || other.isValid(); return this; } };
    } };
}
const ring = [[7.59, 47.54], [7.61, 47.54], [7.61, 47.56], [7.59, 47.56], [7.59, 47.54]];
const perimeter = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
] };

function environment({ records, responseOK = true, badWorkbook = false, useViewer = false } = {}) {
  const nodes = Object.fromEntries(['analysis-status', 'excel-button', 'export-button', 'excel-input',
    'inside-count', 'outside-count', 'unresolved-count', 'unresolved-list', 'unresolved-panel',
    'file-button', 'file-input', 'status', 'tile-status', 'map'].map(id => [id, element()]));
  const fakeDocument = { getElementById: id => nodes[id], createElement: element, createDocumentFragment: element };
  const values = [['Strasse', 'Nummer', 'Plz', 'Kommentar'], ['Kunstgasse', 1, 4000, 'synthetisch'], ['Kunstgasse', 2, 4000, 'synthetisch']];
  const workbook = { SheetNames: ['Tabelle1'], Sheets: { Tabelle1: { '!ref': 'A1:D3', values } } };
  const exported = [];
  const XLSX = { read() { if (badWorkbook) throw new Error('synthetic read failure'); return workbook; }, utils: {
    decode_range: () => ({ e: { r: 2, c: 3 } }), sheet_to_json: sheet => sheet.values,
    book_new: () => ({}), aoa_to_sheet: data => data, book_append_sheet(book, sheet) { book.sheet = sheet; },
  }, writeFile(book) { exported.push(book.sheet); } };
  let requests = 0, zooms = 0;
  const fetch = async () => {
    requests++;
    return { ok: responseOK, status: responseOK ? 200 : 503, json: async () => records != null ? records : [
      { strname: 'Kunstgasse', deinr: 1, dplz4: 4000, geo_point_2d: { lon: 7.6, lat: 47.55 } },
      { strname: 'Kunstgasse', deinr: 2, dplz4: 4000, geo_point_2d: { lon: 7.62, lat: 47.55 } },
    ] };
  };
  const markers = [], drawn = [];
  const marker = (coordinates, options) => {
    const result = Object.assign(layer(), { marker: true, coordinates, options });
    markers.push(result); return result;
  };
  const map = { setView() { return this; }, fitBounds() { zooms++; }, addLayer() {}, removeLayer() {}, hasLayer() { return true; }, invalidateSize() {} };
  const controls = { addOverlay() {}, addBaseLayer() {}, removeLayer() {}, addTo() { return this; } };
  const L = { featureGroup: layer, divIcon: options => options, circleMarker: marker, marker, CRS: { EPSG3857: {} },
    map: () => map, control: { layers: () => controls, scale: () => controls },
    tileLayer: () => Object.assign(layer(), { on() { return this; } }),
    geoJSON(geometry) { drawn.push(geometry); return layer([Object.assign(layer(), { marker: true })]); } };
  const dependencies = { document: fakeDocument, fetch, ResizeObserver: class { observe() {} } };
  const analysis = useViewer ? startViewer(L, dependencies).analysis : setupBuildingAnalysis(L, map, controls, dependencies);
  async function upload() {
    nodes['excel-input'].files = [{ name: 'synthetisch.xlsx', size: 100, arrayBuffer: async () => new ArrayBuffer(0) }];
    await nodes['excel-input'].handlers.change();
  }
  async function loadPerimeter(name, text) {
    nodes['file-input'].files = [{ name, size: text.length, text: async () => text }];
    await nodes['file-input'].handlers.change();
  }
  return { nodes, analysis, XLSX, upload, loadPerimeter, exported, markers, drawn, requests: () => requests, zooms: () => zooms };
}

await test('Vollständiger Ablauf: Knopf, offene 190-Punkte-CSV, GWR-Abgleich, Dreiecke, Export', async () => {
  const env = environment({ useViewer: true });
  await env.analysis.setLibraries(env.XLSX);
  assert(env.requests() === 0 && env.drawn.length === 0, 'Keinen Standardperimeter laden');
  env.nodes['file-button'].handlers.click();
  assert(env.nodes['file-input'].clicks === 1);
  const points = Array.from({ length: 190 }, (_, i) => [7.6 + .01 * Math.cos(i * 2 * Math.PI / 190), 47.55 + .01 * Math.sin(i * 2 * Math.PI / 190)]);
  await env.loadPerimeter('synthetisch.csv', 'Longitude,Latitude\n' + points.map(point => point.join(',')).join('\n'));
  const boundary = env.drawn[0].features[0].geometry;
  assert(boundary.type === 'Polygon' && boundary.coordinates[0].length === 191);
  assert(JSON.stringify(boundary.coordinates[0][0]) === JSON.stringify(boundary.coordinates[0][190]));
  assert(env.nodes.status.textContent.includes('letzter Punkt mit erstem verbunden'));
  await env.upload();
  assert(env.nodes['inside-count'].textContent === '1' && env.nodes['outside-count'].textContent === '1');
  assert(env.markers.length === 2 && env.markers.every(marker => marker.options.icon.html.includes('<svg')));
  assert(env.markers[0].options.icon.html.includes('#1aaa62') && env.markers[1].options.icon.html.includes('#dc3b30'));
  env.nodes['export-button'].handlers.click();
  assert(env.exported[0].length === 2 && env.exported[0][1][3] === 'synthetisch');
});

await test('Offenes GeoJSON-Polygon schliessen und vorhandene Excel danach auswerten', async () => {
  const env = environment({ useViewer: true });
  await env.analysis.setLibraries(env.XLSX);
  await env.upload();
  assert(env.requests() === 0 && env.nodes['analysis-status'].textContent.includes('Perimeter laden'));
  await env.loadPerimeter('synthetisch.geojson', JSON.stringify({ type: 'Polygon', coordinates: [ring.slice(0, -1)] }));
  const boundary = env.drawn[0].features[0].geometry.coordinates[0];
  assert(boundary.length === ring.length);
  assert(env.nodes['inside-count'].textContent === '1' && env.markers.length === 2);
});

await test('Upload, GWR-Abgleich, Dreiecke und Export ohne GIS-Bibliothek', async () => {
  const env = environment();
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  await env.upload();
  assert(env.nodes['inside-count'].textContent === '1');
  assert(env.nodes['outside-count'].textContent === '1');
  assert(env.nodes['analysis-status'].textContent.includes('synthetisch.xlsx: 2 Excel-Zeilen eingelesen.'));
  assert(env.nodes['analysis-status'].textContent.includes('Adressabgleich abgeschlossen'));
  assert(env.zooms() === 1, 'Gebäudemarker in den sichtbaren Kartenausschnitt nehmen');
  assert(!env.nodes['export-button'].disabled);
  env.nodes['export-button'].handlers.click();
  assert(env.exported[0].length === 2, 'Nur Kopfzeile und Innen-Adresse exportieren');
  assert(env.exported[0][1][3] === 'synthetisch', 'Kommentar erhalten');
});

await test('Fehlende Treffer erklären die leere Karte und öffnen die Klärungsliste', async () => {
  const env = environment({ records: [
    { strname: 'Andere Kunstgasse', deinr: 3, dplz4: 4000, geo_point_2d: { lon: 7.6, lat: 47.55 } },
  ] });
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  await env.upload();
  assert(env.nodes['unresolved-count'].textContent === '2');
  assert(env.nodes['unresolved-panel'].open && !env.nodes['unresolved-panel'].hidden);
  assert(env.nodes['analysis-status'].textContent.includes('deshalb erscheinen keine Gebäudemarker'));
  assert(env.zooms() === 0);
});

await test('Sobald SheetJS bereit ist, sofort ohne GIS-Ladephase auswerten', async () => {
  const env = environment();
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  assert(!env.nodes['excel-button'].disabled);
  await env.upload();
  assert(env.nodes['inside-count'].textContent === '1');
  assert(env.nodes['analysis-status'].textContent.includes('Adressabgleich abgeschlossen'));
  assert(env.requests() === 1);
});

await test('Ohne Perimeter importierte Datei erhalten und nach Perimeterwahl auswerten', async () => {
  const env = environment();
  await env.analysis.setLibraries(env.XLSX);
  await env.upload();
  assert(env.nodes['analysis-status'].textContent.includes('Perimeter laden'));
  assert(env.requests() === 0);
  await env.analysis.setPerimeter(perimeter);
  assert(env.nodes['inside-count'].textContent === '1');
});

await test('Dienstausfall sichtbar melden und erneuten Import ermöglichen', async () => {
  const env = environment({ responseOK: false });
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  await env.upload();
  assert(env.nodes['analysis-status'].textContent.includes('2 Excel-Zeilen eingelesen'));
  assert(env.nodes['analysis-status'].textContent.includes('HTTP 503'));
  assert(!env.nodes['excel-button'].disabled && env.nodes['export-button'].disabled);
  await env.upload();
  assert(env.requests() === 2, 'Fehlgeschlagenen Adressdownload erneut versuchen');
});

await test('Unbekanntes GWR-Schema sichtbar melden statt Treffer zu erfinden', async () => {
  const env = environment({ records: [{ unbekannt: 'synthetisch' }] });
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  await env.upload();
  assert(env.nodes['analysis-status'].textContent.includes('nicht automatisch erkannt'));
  assert(env.nodes['export-button'].disabled);
});

await test('Nicht lesbare Datei klar ablehnen', async () => {
  const env = environment({ badWorkbook: true });
  await env.analysis.setLibraries(env.XLSX);
  await env.upload();
  assert(env.nodes['analysis-status'].textContent.includes('Neue Datei nicht importiert: Excel nicht lesbar'));
  assert(env.requests() === 0);
});

document.getElementById('building-flow-results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');
document.documentElement.dataset.buildingFlowTestResult = failed ? 'failed' : 'passed';
