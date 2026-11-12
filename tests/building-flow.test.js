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
    addLayer(child) { this.children.push(child); }, removeLayer(child) { this.children = this.children.filter(item => item !== child); }, clearLayers() { this.children = []; },
    handlers: {}, on(name, callback) { this.handlers[name] = callback; return this; },
    bindPopup(value) { this.popup = value; return this; },
    setPopupContent(value) { this.popup = value; return this; }, openPopup() { this.popupOpen = true; return this; },
    setIcon(icon) { this.options.icon = icon; return this; }, getBounds() {
      let valid = this.children.some(child => child.marker || child.getBounds().isValid());
      return { isValid: () => valid, extend(other) { valid = valid || other.isValid(); return this; } };
    } };
}
const ring = [[7.59, 47.54], [7.61, 47.54], [7.61, 47.56], [7.59, 47.56], [7.59, 47.54]];
const perimeter = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
] };

function environment({ records, responseOK = true, badWorkbook = false, useViewer = false, workbookRows } = {}) {
  const nodes = Object.fromEntries(['analysis-status', 'excel-button', 'export-button', 'excel-input',
    'inside-count', 'outside-count', 'unresolved-count', 'unresolved-list', 'unresolved-panel',
    'file-button', 'file-input', 'status', 'tile-status', 'map', 'perimeter-offset', 'perimeter-offset-value'].map(id => [id, element()]));
  const fakeDocument = { getElementById: id => nodes[id], createElement: element, createDocumentFragment: element };
  const values = [['Strasse', 'Nummer', 'Plz', 'Kommentar'], ...(workbookRows || [['Kunstgasse', 1, 4000, 'synthetisch'], ['Kunstgasse', 2, 4000, 'synthetisch']])];
  const workbook = { SheetNames: ['Tabelle1'], Sheets: { Tabelle1: { '!ref': `A1:D${values.length}`, values } } };
  const exported = [];
  const XLSX = { read() { if (badWorkbook) throw new Error('synthetic read failure'); return workbook; }, utils: {
    decode_range: () => ({ e: { r: values.length - 1, c: 3 } }), sheet_to_json: sheet => sheet.values,
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
  const markers = [], drawn = [], drawnStyles = [], groups = [];
  const marker = (coordinates, options) => {
    const result = Object.assign(layer(), { marker: true, coordinates, options });
    markers.push(result); return result;
  };
  const map = { setView() { return this; }, fitBounds() { zooms++; }, addLayer() {}, removeLayer() {}, hasLayer() { return true; }, invalidateSize() {} };
  const controls = { addOverlay() {}, addBaseLayer() {}, removeLayer() {}, addTo() { return this; } };
  const L = { featureGroup() { const group = layer(); groups.push(group); return group; }, divIcon: options => options, circleMarker: marker, marker, CRS: { EPSG3857: {} },
    map: () => map, control: { layers: () => controls, scale: () => controls },
    tileLayer: () => Object.assign(layer(), { on() { return this; } }),
    geoJSON(geometry, options) { drawn.push(geometry); drawnStyles.push(options.style); return layer([Object.assign(layer(), { marker: true })]); } };
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
  async function setOffset(meters) {
    nodes['perimeter-offset'].value = String(meters);
    nodes['perimeter-offset'].handlers.input();
    await nodes['perimeter-offset'].handlers.change();
  }
  return { nodes, analysis, XLSX, upload, loadPerimeter, setOffset, exported, markers, groups, drawn, drawnStyles, requests: () => requests, zooms: () => zooms };
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

await test('Regler aktualisiert Fläche, Gebäude und Export ohne erneuten GWR-Download oder Zoomsprung', async () => {
  const env = environment({ useViewer: true, records: [
    { strname: 'Kunstgasse', deinr: 1, dplz4: 4000, geo_point_2d: { lon: 7.6, lat: 47.55 } },
    { strname: 'Kunstgasse', deinr: 2, dplz4: 4000, geo_point_2d: { lon: 7.6105, lat: 47.55 } },
  ] });
  assert(env.nodes['perimeter-offset'].disabled && env.nodes['perimeter-offset'].value === '0');
  await env.analysis.setLibraries(env.XLSX);
  await env.loadPerimeter('synthetisch.geojson', JSON.stringify(perimeter));
  assert(!env.nodes['perimeter-offset'].disabled);
  const original = JSON.stringify(env.drawn[0]);
  await env.upload();
  assert(env.nodes['inside-count'].textContent === '1' && env.nodes['outside-count'].textContent === '1');
  const zooms = env.zooms();
  await env.setOffset(50);
  assert(env.nodes['perimeter-offset-value'].textContent === '50 m');
  assert(env.nodes['inside-count'].textContent === '2' && env.nodes['outside-count'].textContent === '0');
  assert(env.requests() === 1 && env.zooms() === zooms);
  assert(env.drawnStyles[1].fillRule === 'nonzero' && env.drawnStyles[1].stroke === false);
  assert(env.nodes.status.textContent.includes('Erweiterung 50 m'));
  env.nodes['export-button'].handlers.click();
  assert(env.exported[0].length === 3, 'Beide Zeilen aus dem erweiterten Perimeter exportieren');
  const fifty = JSON.stringify(env.drawn[1]);
  await env.setOffset(250);
  await env.setOffset(50);
  assert(JSON.stringify(env.drawn[3]) === fifty, 'Keine kumulierte Erweiterung');
  await env.setOffset(0);
  assert(JSON.stringify(env.drawn[4]) === original);
  assert(env.nodes['inside-count'].textContent === '1' && env.nodes['outside-count'].textContent === '1');
  assert(env.requests() === 1 && env.zooms() === zooms);
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

await test('Beliebig oft alle Gebäude umschalten: Farben, Ebenen, Popup, Zähler und Export folgen', async () => {
  const env = environment();
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  await env.upload();
  const [inside, outside] = env.markers, zooms = env.zooms();
  for (let i = 0; i < 7; i++) {
    inside.handlers.click(); outside.handlers.click();
    const reversed = i % 2 === 0;
    assert(inside.options.icon.html.includes(reversed ? '#dc3b30' : '#1aaa62'));
    assert(outside.options.icon.html.includes(reversed ? '#1aaa62' : '#dc3b30'));
    assert(env.groups[0].children.length === 1 && env.groups[0].children[0] === (reversed ? outside : inside));
    assert(env.groups[1].children.length === 1 && env.groups[1].children[0] === (reversed ? inside : outside));
    assert(outside.options.title === (reversed ? 'Gebäude innerhalb' : 'Gebäude ausserhalb'));
    assert(outside.popup.textContent.includes(reversed ? 'Innerhalb · im Export enthalten' : 'Ausserhalb · vom Export ausgeschlossen'));
    assert(env.nodes['inside-count'].textContent === '1' && env.nodes['outside-count'].textContent === '1');
    env.nodes['export-button'].handlers.click();
    assert(env.exported[i].length === 2 && env.exported[i][1][1] === (reversed ? 2 : 1));
    assert(env.exported[i][1][3] === 'synthetisch');
  }
  assert(env.requests() === 1 && env.zooms() === zooms && env.markers.length === 2);
});

await test('Alle Excel-Zeilen desselben Gebäudepunkts gemeinsam umschalten, ungeklärte Zeilen erhalten', async () => {
  const env = environment({ workbookRows: [
    ['Kunstgasse', 1, 4000, 'Innen'], ['Kunstgasse', 2, 4000, 'Aussen A'],
    ['Kunstgasse', 2, 4000, 'Aussen B'], ['Unbekannte Testgasse', 9, 4000, 'ungeklärt'],
  ] });
  await env.analysis.setLibraries(env.XLSX);
  await env.analysis.setPerimeter(perimeter);
  await env.upload();
  assert(env.markers.length === 2);
  env.markers[1].handlers.click();
  assert(env.nodes['inside-count'].textContent === '3' && env.nodes['outside-count'].textContent === '0');
  assert(env.nodes['unresolved-count'].textContent === '1');
  assert(env.markers[1].popup.textContent.includes('2 Excel-Zeile(n)'));
  env.nodes['export-button'].handlers.click();
  assert(JSON.stringify(env.exported[0].slice(1).map(row => row[3])) === JSON.stringify(['Innen', 'Aussen A', 'Aussen B']));
  env.markers[1].handlers.click(); env.markers[0].handlers.click();
  assert(env.nodes['inside-count'].textContent === '0' && env.nodes['outside-count'].textContent === '3');
  env.nodes['export-button'].handlers.click();
  assert(env.exported[1].length === 1, 'Leere Auswahl exportiert nur die Kopfzeile');
});

await test('Bufferbedienung verwirft manuelle Auswahl und klassifiziert anhand der aktuellen Erweiterung', async () => {
  const env = environment({ useViewer: true, records: [
    { strname: 'Kunstgasse', deinr: 1, dplz4: 4000, geo_point_2d: { lon: 7.6, lat: 47.55 } },
    { strname: 'Kunstgasse', deinr: 2, dplz4: 4000, geo_point_2d: { lon: 7.6105, lat: 47.55 } },
  ] });
  await env.analysis.setLibraries(env.XLSX);
  await env.loadPerimeter('synthetisch.geojson', JSON.stringify(perimeter));
  await env.upload();
  env.markers[0].handlers.click();
  assert(env.nodes['inside-count'].textContent === '0');
  await env.setOffset(50);
  assert(env.nodes['inside-count'].textContent === '2' && env.nodes['outside-count'].textContent === '0');
  env.nodes['export-button'].handlers.click(); assert(env.exported[0].length === 3);
  env.markers[3].handlers.click();
  await env.setOffset(0);
  assert(env.nodes['inside-count'].textContent === '1' && env.nodes['outside-count'].textContent === '1');
  env.nodes['export-button'].handlers.click(); assert(env.exported[1][1][1] === 1);
  assert(env.requests() === 1);
});

await test('Perimeter- und Gebäudeimport setzen Auswahl zurück; alte Marker können sie nicht verändern', async () => {
  const env = environment({ useViewer: true });
  await env.analysis.setLibraries(env.XLSX);
  await env.loadPerimeter('synthetisch.geojson', JSON.stringify(perimeter));
  await env.upload();
  const oldOutside = env.markers[1];
  oldOutside.handlers.click(); assert(env.nodes['inside-count'].textContent === '2');
  const shifted = { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [lon + .02, lat])] };
  await env.loadPerimeter('anderer-testperimeter.geojson', JSON.stringify(shifted));
  assert(env.nodes['inside-count'].textContent === '1');
  env.nodes['export-button'].handlers.click(); assert(env.exported[0][1][1] === 2, 'Neuer Perimeter bestimmt die tatsächliche Auswahl');
  oldOutside.handlers.click();
  assert(env.nodes['inside-count'].textContent === '1', 'Entfernte Marker ignorieren');
  env.markers[2].handlers.click(); assert(env.nodes['inside-count'].textContent === '2');
  await env.upload();
  assert(env.nodes['inside-count'].textContent === '1' && env.nodes['outside-count'].textContent === '1');
  env.nodes['export-button'].handlers.click(); assert(env.exported[1][1][1] === 2);
});

await test('Neuer Seitenstart übernimmt keine manuellen Änderungen', async () => {
  const previous = environment({ useViewer: true });
  await previous.analysis.setLibraries(previous.XLSX);
  await previous.loadPerimeter('synthetisch.geojson', JSON.stringify(perimeter));
  await previous.upload();
  previous.markers[1].handlers.click(); assert(previous.nodes['inside-count'].textContent === '2');
  const fresh = environment({ useViewer: true });
  await fresh.analysis.setLibraries(fresh.XLSX);
  assert(fresh.markers.length === 0 && fresh.nodes['export-button'].disabled && fresh.nodes['perimeter-offset'].value === '0');
  await fresh.loadPerimeter('synthetisch.geojson', JSON.stringify(perimeter));
  await fresh.upload();
  assert(fresh.nodes['inside-count'].textContent === '1' && fresh.nodes['outside-count'].textContent === '1');
  fresh.nodes['export-button'].handlers.click(); assert(fresh.exported[0][1][1] === 1);
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
