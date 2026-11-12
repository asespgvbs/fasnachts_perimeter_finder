import { normalize, suggestField, FIELD_NAMES, addressKey, addressCoordinates, buildAddressIndex, detectAddressMapping, importWorkbook,
  matchAddress, perimeterArea, pointInPerimeter, classifyAddress, exportRows, createPerimeterBuffer } from '../src/analysis-core.js';

const messages = [];
let passed = 0, failed = 0;
function assert(value, message = 'Bedingung nicht erfüllt') { if (!value) throw new Error(message); }
function equal(a, b) { assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function rejects(callback, pattern) {
  try { callback(); } catch (error) { if (pattern) assert(pattern.test(error.message), error.message); return error; }
  throw new Error('Fehlermeldung erwartet');
}
function test(name, callback) {
  try { callback(); passed++; messages.push(`OK  ${name}`); }
  catch (error) { failed++; messages.push(`FEHLER  ${name}: ${error.message}`); }
}
// All addresses, rows and points are synthetic; no live data or external libraries.
const columns = { street: 0, house: 1, zip: 2 };
const mapping = { street: 'street', house: 'house', zip: 'zip', point: 'point', mode: 'point' };
const fakeRecord = (house, coords = { lon: 7.6, lat: 47.55 }) => ({ street: 'Kunstgasse', house, zip: 4000, point: coords });
const ring = [[7.59, 47.54], [7.61, 47.54], [7.61, 47.56], [7.59, 47.56], [7.59, 47.54]];
const feature = geometry => ({ type: 'Feature', properties: {}, geometry });
const collection = geometry => ({ type: 'FeatureCollection', features: [feature(geometry)] });

test('Adressnormalisierung und passende Feldnamen', () => {
  equal(addressKey(' Kunststr. ', '12 A', 4000), addressKey('Kunststrasse', '12a', '4000'));
  equal(suggestField(['Strasse', 'Nummer', 'PLZ', 'Kommentar'], FIELD_NAMES.house), 'Nummer');
  equal(suggestField(['Strasse', 'STRASSE'], ['strasse']), '');
  equal(normalize('Straße'), 'strasse');
});
test('Amtliche GWR-Felder automatisch ohne Bedienoberfläche erkennen', () => {
  const records = [{ strname: 'Kunstgasse', deinr: '1a', dplz4: 4000, geo_point_2d: { lon: 7.6, lat: 47.55 } }];
  const detected = detectAddressMapping(records);
  equal(detected, { street: 'strname', house: 'deinr', zip: 'dplz4', mode: 'point', point: 'geo_point_2d' });
  equal(buildAddressIndex(records, detected).validPoints, 1);
});
test('Separate WGS84-Felder erkennen und unklare GWR-Schemas ablehnen', () => {
  const records = [{ Strasse: 'Kunstgasse', Nummer: 1, PLZ: 4000, longitude: 7.6, latitude: 47.55 }];
  equal(detectAddressMapping(records).mode, 'wgs84');
  rejects(() => detectAddressMapping([{ irgendetwas: 'unbekannt' }]));
});
test('Excel-Spalten und passendes Tabellenblatt automatisch erkennen', () => {
  const row = ['Kunstgasse', 1, 4000, 'synthetischer Kommentar', 'A', 'B'];
  const values = [['Strasse', 'Nummer', 'PLZ', 'Kommentar', 'Zusatz', 'Zusatz'], row, [], row];
  const workbook = { SheetNames: ['Deckblatt', 'Gebäude'], Sheets: {
    Deckblatt: { '!ref': 'A1', values: [['Deckblatt']] }, Gebäude: { '!ref': 'A1:F4', values },
  } };
  const XLSX = { utils: { decode_range: () => ({ e: { r: 3, c: 5 } }), sheet_to_json: sheet => sheet.values } };
  const imported = importWorkbook(workbook, XLSX);
  equal(imported.columns, columns); equal(imported.comment, 3);
  equal(imported.header, values[0]); equal(imported.rows.map(item => item.excelRow), [2, 4]);
  equal(imported.rows.map(item => item.row), [row, row]);
});
test('Excel ohne erforderliche Adressspalten verständlich ablehnen', () => {
  const workbook = { SheetNames: ['Test'], Sheets: { Test: { '!ref': 'A1', values: [['Kommentar'], ['synthetisch']] } } };
  const XLSX = { utils: { decode_range: () => ({ e: { r: 1, c: 0 } }), sheet_to_json: sheet => sheet.values } };
  rejects(() => importWorkbook(workbook, XLSX), /Strassenname, Nummer und PLZ/);
});
test('Keine fehlenden PLZ/Nummern ergänzen oder Hausnummerzusätze entfernen', () => {
  equal(addressKey('Kunstgasse', '', 4000), null);
  equal(addressKey('Kunstgasse', 1, 400), null);
  assert(addressKey('Kunstgasse', 1, 4000) !== addressKey('Kunstgasse', '1a', 4000));
});
test('Amtliche Punktformate und separate WGS84-Felder', () => {
  for (const point of [{ lon: 7.6, lat: 47.55 }, { type: 'Point', coordinates: [7.6, 47.55] }, '[7.6,47.55]']) {
    equal(addressCoordinates({ point }, mapping), [7.6, 47.55]);
  }
  equal(addressCoordinates({ x: '7,6', y: '47,55' }, { mode: 'wgs84', x: 'x', y: 'y' }), [7.6, 47.55]);
});
test('Fehlende, vertauschte und unplausible Koordinaten ablehnen', () => {
  for (const point of [null, [47.55, 7.6], { lon: '', lat: null }, { lon: 0, lat: 0 }, [7.6]]) equal(addressCoordinates({ point }, mapping), null);
});
test('LV95- und LV03-Kunstpunkte liefern dieselbe Position', () => {
  const lv95 = addressCoordinates({ x: 2610000, y: 1267000 }, { mode: 'lv95', x: 'x', y: 'y' });
  const lv03 = addressCoordinates({ x: 610000, y: 267000 }, { mode: 'lv03', x: 'x', y: 'y' });
  assert(lv95 !== null); equal(lv95, lv03);
  equal(addressCoordinates({ x: 610000, y: 267000 }, { mode: 'lv95', x: 'x', y: 'y' }), null);
});
test('Identische Doppelzeilen bleiben eindeutig; unbekannte Adressen ungeklärt', () => {
  const { index } = buildAddressIndex([fakeRecord(1), fakeRecord(1)], mapping);
  equal(matchAddress(['Kunstgasse', 1, 4000], columns, index).coordinates, [7.6, 47.55]);
  assert(matchAddress(['Kunstgasse', 2, 4000], columns, index).reason);
});
test('Mehrdeutige amtliche Treffer und defekte Doppelzeilen nicht raten', () => {
  for (const records of [[fakeRecord(1), fakeRecord(1, { lon: 7.62, lat: 47.55 })], [fakeRecord(1), fakeRecord(1, null)]]) {
    const { index } = buildAddressIndex(records, mapping);
    assert(matchAddress(['Kunstgasse', 1, 4000], columns, index).reason);
  }
});
test('Geschlossene Linie als Fläche; Eingabe bleibt unverändert', () => {
  const source = collection({ type: 'LineString', coordinates: ring }), before = JSON.stringify(source);
  const result = perimeterArea(source);
  equal(result.area.features[0].geometry, { type: 'Polygon', coordinates: [ring] });
  equal(result.closedRings, 0); equal(JSON.stringify(source), before);
});

test('Offene Linie immer mit dem ersten Punkt schliessen', () => {
  const open = ring.slice(0, -1), source = collection({ type: 'LineString', coordinates: open });
  const result = perimeterArea(source);
  equal(result.area.features[0].geometry.coordinates[0], ring);
  equal(result.closedRings, 1);
  equal(source.features[0].geometry.coordinates.length, 4);
});

test('Offene 190-Punkte-Linie ohne Bibliothek als Perimeter verwenden', () => {
  const points = Array.from({ length: 190 }, (_, i) => [7.6 + .01 * Math.cos(i * 2 * Math.PI / 190), 47.55 + .01 * Math.sin(i * 2 * Math.PI / 190)]);
  const result = perimeterArea(collection({ type: 'LineString', coordinates: points }));
  equal(result.area.features[0].geometry.coordinates[0].length, 191);
  equal(result.closedRings, 1);
  assert(pointInPerimeter([7.6, 47.55], result.area));
  assert(!pointInPerimeter([7.65, 47.55], result.area));
});

test('Polygonlöcher aussparen; Aussen- und Lochrand zählen als innen', () => {
  const outer = [[0, 0], [5, 0], [5, 5], [0, 5]];
  const hole = [[1, 1], [2, 1], [2, 2], [1, 2]];
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [outer, hole] })).area;
  assert(pointInPerimeter([.5, .5], area));
  assert(!pointInPerimeter([1.5, 1.5], area));
  assert(pointInPerimeter([1, 1.5], area));
  assert(pointInPerimeter([0, 2], area));
  assert(pointInPerimeter([0, 0], area));
});

test('Konkave Perimeter und umgekehrte Ringreihenfolge korrekt prüfen', () => {
  const boundary = [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4]];
  for (const points of [boundary, boundary.slice().reverse()]) {
    const area = perimeterArea(collection({ type: 'Polygon', coordinates: [points] })).area;
    assert(pointInPerimeter([1, 1], area));
    assert(!pointInPerimeter([2, 3], area));
    assert(pointInPerimeter([2, 2], area));
  }
});

test('Mehrere Flächen als Vereinigung; Lücken bleiben ausserhalb', () => {
  const first = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const second = [[3, 0], [5, 0], [5, 2], [3, 2]];
  const area = perimeterArea(collection({ type: 'MultiPolygon', coordinates: [[first], [second]] })).area;
  assert(pointInPerimeter([1, 1], area)); assert(pointInPerimeter([4, 1], area));
  assert(!pointInPerimeter([2.5, 1], area));
});

test('Unbrauchbare Punktfolgen verständlich ablehnen', () => {
  for (const coordinates of [[[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [1, 0], [NaN, 1]]]) {
    rejects(() => perimeterArea(collection({ type: 'LineString', coordinates })));
  }
  rejects(() => perimeterArea(collection({ type: 'Point', coordinates: [7.6, 47.55] })));
});

test('Innen/Aussen/Ungeklärt ohne Turf klassifizieren', () => {
  const { index } = buildAddressIndex([fakeRecord(1), fakeRecord(2, { lon: 7.62, lat: 47.55 })], mapping);
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [ring] })).area;
  equal(classifyAddress({ row: ['Kunstgasse', 1, 4000] }, columns, index, area).status, 'inside');
  equal(classifyAddress({ row: ['Kunstgasse', 2, 4000] }, columns, index, area).status, 'outside');
  equal(classifyAddress({ row: ['Kunstgasse', 3, 4000] }, columns, index, area).status, 'unresolved');
});

// WGS84 metres/degree at the equator; independent reference coordinates.
const metricPoint = (x, y) => [x / 111319.49079327357, y / 110574.27582159435];
const metricSquare = (left, bottom, right, top) => [metricPoint(left, bottom), metricPoint(right, bottom), metricPoint(right, top), metricPoint(left, top)];

test('0 Meter behält die ursprüngliche Fläche unverändert', () => {
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [metricSquare(-100, -100, 100, 100)] })).area;
  const before = JSON.stringify(area), buffer = createPerimeterBuffer(area, 0);
  assert(buffer.area === area);
  assert(buffer.contains(metricPoint(0, 0)));
  assert(!buffer.contains(metricPoint(101, 0)));
  equal(JSON.stringify(area), before);
});

test('Metererweiterung gilt für Kanten und runde Ecken, nicht für ein Rechteck', () => {
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [metricSquare(-100, -100, 100, 100)] })).area;
  const buffer = createPerimeterBuffer(area, 100);
  assert(buffer.contains(metricPoint(200, 0)), '100 m ausserhalb eingeschlossen');
  assert(!buffer.contains(metricPoint(201, 0)), '101 m ausserhalb ausgeschlossen');
  assert(buffer.contains(metricPoint(170, 170)), 'Runde Ecke innerhalb 100 m');
  assert(!buffer.contains(metricPoint(180, 180)), 'Diagonale über 100 m ausgeschlossen');
  const display = perimeterArea(buffer.area).area;
  for (const point of [metricPoint(0, 0), metricPoint(199, 0), metricPoint(170, 170), metricPoint(201, 0), metricPoint(180, 180)]) {
    equal(pointInPerimeter(point, display), buffer.contains(point));
  }
});

test('250 Meter als Obergrenze; Werte ausserhalb des Reglers ablehnen', () => {
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [metricSquare(-100, -100, 100, 100)] })).area;
  const buffer = createPerimeterBuffer(area, 250);
  assert(buffer.contains(metricPoint(350, 0)));
  assert(!buffer.contains(metricPoint(350.1, 0)));
  for (const invalid of [-1, 251, NaN, Infinity]) rejects(() => createPerimeterBuffer(area, invalid), /0 und 250/);
});

test('Polygonlöcher werden bei Erweiterung kleiner und können verschwinden', () => {
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [metricSquare(-500, -500, 500, 500), metricSquare(-100, -100, 100, 100)] })).area;
  const small = createPerimeterBuffer(area, 50), large = createPerimeterBuffer(area, 150);
  assert(!small.contains(metricPoint(0, 0)));
  assert(small.contains(metricPoint(75, 0)));
  assert(large.contains(metricPoint(0, 0)));
  assert(pointInPerimeter(metricPoint(0, 0), perimeterArea(large.area).area));
});

test('Mehrere Perimeterteile dürfen durch die Erweiterung zusammenwachsen', () => {
  const area = perimeterArea(collection({ type: 'MultiPolygon', coordinates: [
    [metricSquare(-300, -100, -100, 100)], [metricSquare(100, -100, 300, 100)],
  ] })).area;
  assert(!createPerimeterBuffer(area, 99).contains(metricPoint(0, 0)));
  assert(createPerimeterBuffer(area, 100).contains(metricPoint(0, 0)));
});

test('Konkave Aussparungen werden nur um den gewählten Meterabstand erweitert', () => {
  const boundary = [[-100, -100], [100, -100], [100, 0], [0, 0], [0, 100], [-100, 100]].map(point => metricPoint(point[0], point[1]));
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [boundary] })).area;
  const buffer = createPerimeterBuffer(area, 40), display = perimeterArea(buffer.area).area;
  assert(!pointInPerimeter(metricPoint(20, 20), area));
  assert(buffer.contains(metricPoint(20, 20)));
  assert(!buffer.contains(metricPoint(50, 50)));
  assert(pointInPerimeter(metricPoint(20, 20), display));
  assert(!pointInPerimeter(metricPoint(50, 50), display));
});

test('Erweiterung hängt weder von Ringrichtung noch von vorherigen Reglerwerten ab', () => {
  const boundary = metricSquare(-100, -100, 100, 100);
  const area = perimeterArea(collection({ type: 'Polygon', coordinates: [boundary] })).area;
  const before = JSON.stringify(area), first = createPerimeterBuffer(area, 25);
  createPerimeterBuffer(area, 250);
  const repeated = createPerimeterBuffer(area, 25);
  equal(first.area, repeated.area); equal(JSON.stringify(area), before);
  const reverse = perimeterArea(collection({ type: 'Polygon', coordinates: [boundary.slice().reverse()] })).area;
  const buffer = createPerimeterBuffer(reverse, 25);
  assert(buffer.contains(metricPoint(124, 0)) && !buffer.contains(metricPoint(126, 0)));
  assert(pointInPerimeter(metricPoint(124, 0), perimeterArea(buffer.area).area));
});
test('Export bewahrt Kommentar, Originalspalten, Duplikate und Reihenfolge', () => {
  const imported = { header: ['Strasse', 'Nummer', 'PLZ', 'Kommentar', 'Zusatz', 'Zusatz'] };
  const row = ['Kunstgasse', 1, 4000, '=synthetischer Text', 'A', 'B'];
  const results = [{ row, status: 'inside' }, { row, status: 'outside' }, { row, status: 'inside' }];
  const before = JSON.stringify(results);
  const exported = exportRows(imported, results, 'inside');
  const expected = [...row.slice(0, 3), 'ausstehend', ...row.slice(3)];
  equal(exported.header, [...imported.header.slice(0, 3), 'Rückmeldung', ...imported.header.slice(3)]); equal(exported.rows, [expected, expected]);
  equal(exportRows(imported, results, 'outside').rows, [expected]); equal(JSON.stringify(results), before);
});
test('Klärungsliste bekommt eindeutige Grundspalte, keine ungeklärten Innen-Treffer', () => {
  const imported = { header: ['Strasse', 'Nummer', 'PLZ', 'Kommentar', 'Klärungsgrund'] };
  const results = [{ row: ['Kunstgasse', 3, 4000, 'synthetisch'], status: 'unresolved', reason: 'unbekannt' }];
  const data = exportRows(imported, results, 'unresolved');
  equal(data.header[6], 'Klärungsgrund_'); equal(data.rows[0][6], 'unbekannt');
  equal(exportRows(imported, results, 'inside').rows.length, 0);
  rejects(() => exportRows(imported, results, 'all'));
});

test('Strassenname, Nummer und PLZ genügen; beliebige weitere Spalten und Werttypen unverändert übernehmen', () => {
  const header = ['Strassenname', 'Nummer', 'PLZ', ' Kennung ', 'Zusatz', 'Zusatz', null, 'Datum', 'Zahl', 'Text'];
  const date = new Date('2026-01-02T00:00:00Z');
  const row = ['Kunstgasse', '01a', '4000', '000001', false, 0, null, date, 12.345, '  Ä & < >\n=kein Formelauftrag  '];
  const workbook = { SheetNames: ['Test'], Sheets: { Test: { '!ref': 'A1:J2', values: [header, row] } } };
  const XLSX = { utils: { decode_range: () => ({ e: { r: 1, c: 9 } }), sheet_to_json: sheet => sheet.values } };
  const imported = importWorkbook(workbook, XLSX), before = JSON.stringify(imported);
  equal(imported.comment, -1); equal(imported.columns, columns);
  for (const status of ['inside', 'outside', 'unresolved']) {
    const data = exportRows(imported, [{ row, status, reason: 'Testgrund' }], status);
    equal(data.header.slice(0, 4), ['Strassenname', 'Nummer', 'PLZ', 'Rückmeldung']);
    equal(data.header.slice(4, 11), header.slice(3));
    const exported = data.rows[0];
    for (let i = 3; i < row.length; i++) assert(exported[i + 1] === row[i], 'Zusatzwerte ohne Umwandlung übernehmen');
    equal(exported.slice(0, 4), [...row.slice(0, 3), 'ausstehend']);
  }
  equal(JSON.stringify(imported), before);
});

test('Vorhandene Rückmeldung erhalten und bei erneutem Export keine doppelte Spalte einfügen', () => {
  const imported = { header: ['Notiz', 'PLZ', 'Nummer', 'Strassenname', 'Rückmeldung', 'Zusatz'], columns: { street: 3, house: 2, zip: 1 } };
  for (const feedback of ['erfolgt', 'ausstehend', '', null, 'eigener bisheriger Wert']) {
    const row = [' Notiz ', '4000', '01a', 'Kunstgasse', feedback, false];
    const data = exportRows(imported, [{ row, status: 'inside' }], 'inside');
    equal(data.header, ['Strassenname', 'Nummer', 'PLZ', 'Rückmeldung', 'Notiz', 'Zusatz']);
    equal(data.rows[0], ['Kunstgasse', '01a', '4000', feedback, ' Notiz ', false]);
    const repeated = exportRows({ header: data.header, columns }, [{ row: data.rows[0], status: 'inside' }], 'inside');
    equal(repeated, data);
  }
  rejects(() => exportRows({ header: ['Strassenname', 'Nummer', 'PLZ', 'Rückmeldung', 'Rückmeldung'] }, [], 'inside'), /Mehrere Spalten/);
});

document.getElementById('analysis-results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');
document.documentElement.dataset.analysisTestResult = failed ? 'failed' : 'passed';
