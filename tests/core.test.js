import {
  addressKey, streetName, houseNumber, postcode, fieldSuggestion, ALIASES,
  validatePerimeter, recordCoordinates, swissToWgs84, buildAddressIndex,
  resolveAddress, classifyPoint,
} from '../src/core.js';

const messages = [];
let passed = 0, failed = 0;
function assert(condition, message = 'Bedingung nicht erfüllt') { if (!condition) throw new Error(message); }
function equal(actual, expected) { assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function rejects(callback) { let rejected = false; try { callback(); } catch { rejected = true; } assert(rejected, 'Fehler erwartet'); }
function test(name, callback) {
  try { callback(); messages.push(`OK  ${name}`); passed++; }
  catch (error) { messages.push(`FEHLER  ${name}: ${error.message}`); failed++; }
}

// All records and geometry in this file are artificial. No production fixtures.
const ring = [[7.6, 47.5], [7.61, 47.5], [7.61, 47.51], [7.6, 47.51], [7.6, 47.5]];
const polygon = { type: 'Polygon', coordinates: [ring] };
const mapping = { street: 'street', house: 'house', postcode: 'zip', mode: 'point', point: 'point' };
const rowColumns = { street: 0, house: 1, postcode: 2 };
const fake = (house, point = { lon: 7.605, lat: 47.505 }) => ({ street: 'Testgasse', house, zip: '4000', point });

test('Schreibweisen und Hausnummerzusätze normalisieren', () => {
  equal(streetName(' Musterstr. '), streetName('Musterstrasse'));
  equal(houseNumber('12 A'), '12a');
  equal(addressKey('Testgasse', 1, 4000), addressKey(' TESTGASSE ', '1', '4000'));
  equal(postcode('400'), ''); equal(addressKey('', 1, 4000), null);
});
test('Keine unscharfe Strassen- oder Hausnummerzuordnung', () => {
  assert(addressKey('Testgasse', 1, 4000) !== addressKey('Testgasse', '1a', 4000));
  assert(addressKey('Testgasse', 1, 4000) !== addressKey('Testweg', 1, 4000));
});
test('Feldnamen eindeutig erkennen', () => {
  equal(fieldSuggestion(['STRNAME', 'foo'], ALIASES.street), 'STRNAME');
  equal(fieldSuggestion(['str_name', 'STRNAME'], ['strname']), '');
});
test('Polygon, MultiPolygon und FeatureCollection akzeptieren', () => {
  equal(validatePerimeter(polygon).features.length, 1);
  equal(validatePerimeter({ type: 'MultiPolygon', coordinates: [[ring]] }).features.length, 1);
  equal(validatePerimeter({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: polygon }] }).features.length, 1);
});
test('Ungültige Geometrien sicher ablehnen', () => {
  rejects(() => validatePerimeter({ type: 'Point', coordinates: [7.6, 47.5] }));
  rejects(() => validatePerimeter({ type: 'FeatureCollection', features: [] }));
  rejects(() => validatePerimeter({ type: 'Polygon', coordinates: [ring.slice(0, -1)] }));
  rejects(() => validatePerimeter({ type: 'Polygon', coordinates: [[[2600000, 1200000], ...ring.slice(1)]] }));
  rejects(() => validatePerimeter({ type: 'Feature', crs: { properties: { name: 'EPSG:2056' } }, geometry: polygon }));
});
test('Punktformate und Koordinatenreihenfolge', () => {
  equal(recordCoordinates({ point: { lon: 7.6, lat: 47.5 } }, mapping), [7.6, 47.5]);
  equal(recordCoordinates({ point: { type: 'Point', coordinates: [7.6, 47.5] } }, mapping), [7.6, 47.5]);
  equal(recordCoordinates({ point: [47.5, 7.6] }, mapping), null);
  equal(recordCoordinates({ point: { lon: '', lat: null } }, mapping), null);
  equal(recordCoordinates({ point: 'unbekannt' }, mapping), null);
});
test('LV03 und LV95 liefern für denselben Kunstpunkt dasselbe Ergebnis', () => {
  equal(swissToWgs84(2600000, 1200000), swissToWgs84(600000, 200000, false));
  const [lon, lat] = swissToWgs84(2600000, 1200000);
  assert(Math.abs(lon - 7.43863722) < 0.0000001 && Math.abs(lat - 46.95108111) < 0.0000001);
});
test('Fehlende und ausserhalb liegende Koordinaten ablehnen', () => {
  equal(recordCoordinates({ x: null, y: null }, { mode: 'wgs84', x: 'x', y: 'y' }), null);
  equal(recordCoordinates({ x: 600000, y: 200000 }, { mode: 'lv95', x: 'x', y: 'y' }), null);
  equal(recordCoordinates({ point: { lon: 0, lat: 0 } }, mapping), null);
});
test('Identische amtliche Doppelzeilen bleiben eindeutig', () => {
  const { index } = buildAddressIndex([fake(1), fake(1)], mapping);
  equal(resolveAddress(['Testgasse', 1, 4000], rowColumns, index).coordinates, [7.605, 47.505]);
});
test('Mehrdeutige, unvollständige und fehlende Adressen separat behandeln', () => {
  const { index } = buildAddressIndex([fake(1), fake(1, { lon: 7.606, lat: 47.505 }), fake(2, null)], mapping);
  for (const row of [['Testgasse', 1, 4000], ['Testgasse', 2, 4000], ['Testgasse', 3, 4000], ['', 1, 4000]]) {
    assert(Boolean(resolveAddress(row, rowColumns, index).reason));
  }
});
test('Unbekannte Koordinaten neben gültigem Doppelpunkt nicht stillschweigend übergehen', () => {
  const { index } = buildAddressIndex([fake(1), fake(1, null)], mapping);
  assert(Boolean(resolveAddress(['Testgasse', 1, 4000], rowColumns, index).reason));
});

document.getElementById('results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve; script.onerror = () => reject(new Error(`Bibliothek nicht erreichbar: ${src}`));
    document.head.append(script);
  });
}

document.getElementById('integration').addEventListener('click', async event => {
  event.target.disabled = true;
  const output = document.getElementById('integration-results');
  output.textContent = 'Bibliotheken werden geladen …';
  try {
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js'),
      loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'),
    ]);
    const before = messages.length;
    test('Turf: innen, aussen und Aussenrand', () => {
      const perimeter = validatePerimeter(polygon);
      equal(classifyPoint([7.605, 47.505], perimeter, window.turf), true);
      equal(classifyPoint([7.62, 47.505], perimeter, window.turf), false);
      equal(classifyPoint([7.6, 47.505], perimeter, window.turf), true);
    });
    test('Turf: Polygonloch und Lochrand', () => {
      const hole = [[7.602, 47.502], [7.608, 47.502], [7.608, 47.508], [7.602, 47.508], [7.602, 47.502]];
      const perimeter = validatePerimeter({ type: 'Polygon', coordinates: [ring, hole] });
      equal(classifyPoint([7.605, 47.505], perimeter, window.turf), false);
      equal(classifyPoint([7.602, 47.505], perimeter, window.turf), true);
    });
    test('Turf: mehrere Flächen als Vereinigung', () => {
      const other = { type: 'Polygon', coordinates: [ring.map(([x, y]) => [x + 0.02, y])] };
      const perimeter = { type: 'FeatureCollection', features: [polygon, other].map(geometry => ({ type: 'Feature', geometry, properties: {} })) };
      equal(classifyPoint([7.625, 47.505], perimeter, window.turf), true);
    });
    test('Excel: Werte, Duplikatspalten, Formelsicherheit und Reihenfolge erhalten', () => {
      const XLSX = window.XLSX;
      const data = [['Strasse', 'Hausnummer', 'PLZ', 'Zusatz', 'Zusatz'], ['Testgasse', 1, 4000, '=1+1', 'behalten'], ['Testgasse', 1, 4000, 'Duplikat', 'zweite Zeile']];
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(data);
      assert(!sheet.D2.f && sheet.D2.t === 's');
      XLSX.utils.book_append_sheet(workbook, sheet, 'Test');
      const reread = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
      equal(XLSX.utils.sheet_to_json(reread.Sheets.Test, { header: 1 }), data);
    });
    output.textContent = messages.slice(before).join('\n');
  } catch (error) { output.textContent = error.message; }
  finally { event.target.disabled = false; }
});
