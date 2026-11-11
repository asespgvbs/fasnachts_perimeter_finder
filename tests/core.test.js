import { prepareGeoJSON, parsePerimeterCSV } from '../src/core.js';

const messages = [];
let passed = 0, failed = 0;
function assert(value, message = 'Bedingung nicht erfüllt') { if (!value) throw new Error(message); }
function equal(a, b) { assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function rejects(callback, pattern) {
  try { callback(); } catch (error) {
    if (pattern) assert(pattern.test(error.message), error.message);
    return;
  }
  throw new Error('Fehlermeldung erwartet');
}
function test(name, callback) {
  try { callback(); passed++; messages.push(`OK  ${name}`); }
  catch (error) { failed++; messages.push(`FEHLER  ${name}: ${error.message}`); }
}

// Synthetic geometries, intentionally unrelated to a real perimeter.
const point = { type: 'Point', coordinates: [7.61, 47.55] };
const ring = [[7.6, 47.5], [7.61, 47.5], [7.61, 47.51], [7.6, 47.5]];
const feature = geometry => ({ type: 'Feature', properties: {}, geometry });

test('Alle sechs Koordinatengeometrietypen', () => {
  const shapes = [point,
    { type: 'MultiPoint', coordinates: [[7.6, 47.5], [7.61, 47.51]] },
    { type: 'LineString', coordinates: [[7.6, 47.5], [7.61, 47.51]] },
    { type: 'MultiLineString', coordinates: [[[7.6, 47.5], [7.61, 47.51]]] },
    { type: 'Polygon', coordinates: [ring] },
    { type: 'MultiPolygon', coordinates: [[ring]] },
  ];
  for (const shape of shapes) equal(prepareGeoJSON(shape).geojson.features[0].geometry, shape);
});

test('Koordinaten weder vertauschen noch umprojizieren', () => {
  equal(prepareGeoJSON(point).geojson.features[0].geometry.coordinates, [7.61, 47.55]);
  const point3d = { type: 'Point', coordinates: [7.61, 47.55, 250] };
  equal(prepareGeoJSON(point3d).geojson.features[0].geometry.coordinates, point3d.coordinates);
});

test('Feature und gemischte FeatureCollection', () => {
  equal(prepareGeoJSON(feature(point)).geojson.features.length, 1);
  const mixed = { type: 'FeatureCollection', features: [feature(point), feature({ type: 'Polygon', coordinates: [ring] })] };
  const result = prepareGeoJSON(mixed);
  equal(result.geojson.features.length, 2);
  equal(result.positionCount, 5);
});

test('Verschachtelte GeometryCollection; leere Geometrien überspringen', () => {
  const result = prepareGeoJSON({ type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [] },
    { type: 'GeometryCollection', geometries: [point] },
  ] });
  equal(result.emptyCount, 1);
  equal(result.positionCount, 1);
});

test('Feature mit null-Geometrie neben gültigem Feature', () => {
  const result = prepareGeoJSON({ type: 'FeatureCollection', features: [feature(null), feature(point)] });
  equal(result.emptyCount, 1);
  equal(result.geojson.features.length, 1);
});

test('Leere Dateien und reine Leer-Geometrien verständlich ablehnen', () => {
  for (const value of [
    { type: 'FeatureCollection', features: [] }, feature(null),
    { type: 'Point', coordinates: [] }, { type: 'GeometryCollection', geometries: [] },
  ]) rejects(() => prepareGeoJSON(value), /keine darstellbaren/);
});

test('Falsche Objekte und Geometriestrukturen ablehnen', () => {
  for (const value of [null, [], {}, { type: 'Point' }, { type: 'Feature' },
    { type: 'FeatureCollection', features: [point] },
    { type: 'LineString', coordinates: [[7.6, 47.5]] },
    { type: 'Polygon', coordinates: [[]] },
  ]) rejects(() => prepareGeoJSON(value));
});

test('Strings, nicht endliche Zahlen und Landeskoordinaten ablehnen', () => {
  for (const coordinates of [['7.6', 47.5], [NaN, 47.5], [7.6, Infinity], [2600000, 1200000], [7.6, 91]]) {
    rejects(() => prepareGeoJSON({ type: 'Point', coordinates }));
  }
});

test('Explizite CRS prüfen, ohne stillschweigend zu transformieren', () => {
  rejects(() => prepareGeoJSON(Object.assign({}, point, { crs: { type: 'name', properties: { name: 'EPSG:2056' } } })), /LV95/);
  equal(prepareGeoJSON(Object.assign({}, point, { crs: { type: 'name', properties: { name: 'EPSG:4326' } } })).positionCount, 1);
  rejects(() => prepareGeoJSON(Object.assign({}, point, { crs: null })));
});

test('Offene Polygonringe schliessen und degenerierte ablehnen', () => {
  equal(prepareGeoJSON({ type: 'Polygon', coordinates: [ring.slice(0, -1)] }).geojson.features[0].geometry.coordinates, [ring]);
  rejects(() => prepareGeoJSON({ type: 'Polygon', coordinates: [[[7.6, 47.5], [7.6, 47.5], [7.6, 47.5], [7.6, 47.5]]] }));
});

test('Positionen begrenzen und Eingabe unverändert lassen', () => {
  const source = { type: 'Feature', properties: { name: '<script>synthetisch</script>' }, geometry: point };
  const before = JSON.stringify(source);
  const result = prepareGeoJSON(source);
  equal(JSON.stringify(source), before);
  equal(result.geojson.features[0].properties, {});
  rejects(() => prepareGeoJSON({ type: 'MultiPoint', coordinates: [[7.6, 47.5], [7.6, 47.5]] }, 1), /komplex/);
});

test('Tiefe GeometryCollections begrenzen', () => {
  let shape = point;
  for (let i = 0; i < 40; i++) shape = { type: 'GeometryCollection', geometries: [shape] };
  rejects(() => prepareGeoJSON(shape), /verschachtelt/);
});

test('CSV: WGS84-Spalten verwenden, Distanz und Landeskoordinaten ignorieren', () => {
  const result = parsePerimeterCSV('Distance,Altitude,Easting,Northing,Longitude,Latitude\n0,999,1111111,2222222,8.1,46.1\n10,888,3333333,4444444,8.2,46.2');
  equal(result.geojson.features[0].geometry, { type: 'LineString', coordinates: [[8.1, 46.1], [8.2, 46.2]] });
});

test('CSV: Semikolon, Dezimalkomma und zitierte Felder', () => {
  const result = parsePerimeterCSV('"Longitude";"Latitude"\r\n"8,1";"46,1"\r\n"8,2";"46,2"');
  equal(result.geojson.features[0].geometry.coordinates, [[8.1, 46.1], [8.2, 46.2]]);
});

test('CSV: Tabulatoren, BOM, Einheiten und Leerzeilen', () => {
  const result = parsePerimeterCSV('\uFEFFLongitude [deg]\tLatitude (deg)\n8.1\t46.1\n\n8.2\t46.2\n');
  equal(result.positionCount, 2);
  equal(parsePerimeterCSV('sep=;\nLongitude;Latitude\n8.1;46.1\n8.2;46.2').positionCount, 2);
});

test('CSV: Reihenfolge erhalten, Linie nicht automatisch schliessen', () => {
  const result = parsePerimeterCSV('Distance,Latitude,Longitude\n99,46.2,8.2\n0,46.1,8.1');
  equal(result.geojson.features[0].geometry.coordinates, [[8.2, 46.2], [8.1, 46.1]]);
  equal(result.geojson.features[0].geometry.type, 'LineString');
});

test('CSV: Fremdspalten mit Kommas, Anführungszeichen und Zeilenumbrüchen', () => {
  const result = parsePerimeterCSV('Note,Longitude,Latitude\n"x,""y""\nz",8.1,46.1\nplain,8.2,46.2');
  equal(result.positionCount, 2);
});

test('CSV: fehlende, doppelte und unplausible WGS84-Spalten ablehnen', () => {
  for (const text of [
    'Easting,Northing\n1111111,2222222\n3333333,4444444',
    'Longitude,Longitude,Latitude\n8.1,8.1,46.1\n8.2,8.2,46.2',
    'Longitude,Latitude\n,46.1\n8.2,46.2',
    'Longitude,Latitude\n1111111,2222222\n3333333,4444444',
    'Longitude,Latitude\nInfinity,46.1\n8.2,46.2',
  ]) rejects(() => parsePerimeterCSV(text));
});

test('CSV: Fehlerhafte Zeilen nicht stillschweigend überspringen', () => {
  for (const text of [
    'Longitude,Latitude\n8.1,46.1,extra\n8.2,46.2',
    'Longitude,Latitude\n"8.1,46.1\n8.2,46.2',
    'Longitude,Latitude\n"8.1"x,46.1\n8.2,46.2',
  ]) rejects(() => parsePerimeterCSV(text));
});

test('CSV: Leere Tabelle und Linien ohne zwei unterschiedliche Positionen', () => {
  for (const text of ['', 'Longitude,Latitude', 'Longitude,Latitude\n8.1,46.1', 'Longitude,Latitude\n8.1,46.1\n8.1,46.1']) {
    rejects(() => parsePerimeterCSV(text));
  }
});

document.getElementById('results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');
document.documentElement.dataset.testResult = failed ? 'failed' : 'passed';
