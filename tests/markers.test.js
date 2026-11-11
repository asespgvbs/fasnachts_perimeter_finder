import { renderBuildingMarkers } from '../src/analysis.js';

// Exercise the production marker renderer with a synthetic Leaflet adapter.
const messages = [];
let passed = 0, failed = 0;
function assert(value, message = 'Bedingung nicht erfüllt') { if (!value) throw new Error(message); }
function equal(actual, expected) { assert(JSON.stringify(actual) === JSON.stringify(expected), 'Werte unterschiedlich'); }
function test(name, callback) {
  try { callback(); passed++; messages.push(`OK  ${name}`); }
  catch (error) { failed++; messages.push(`FEHLER  ${name}: ${error.message}`); }
}
function environment() {
  function group() {
    return { markers: [], visible: false, addTo(map) { this.visible = true; this.map = map; return this; }, getBounds() {
      return { points: this.markers.map(marker => marker.coordinates), isValid() { return this.points.length > 0; },
        extend(bounds) { this.points = this.points.concat(bounds.points); return this; } };
    } };
  }
  function marker(kind, coordinates, options) {
    return { kind, coordinates, options, bindPopup(value) { this.popup = value; return this; },
      addTo(layer) { layer.markers.push(this); return this; } };
  }
  const zooms = [], map = { fitBounds(bounds, options) { zooms.push({ points: bounds.points, options }); } };
  const L = { circleMarker: (coords, options) => marker('circle', coords, options),
    marker: (coords, options) => marker('triangle', coords, options) };
  const insideLayer = group(), outsideLayer = group(), triangle = { inside: {}, outside: {} };
  const popups = [];
  return { insideLayer, outsideLayer, zooms, map, triangle, popups, render(results) {
    return renderBuildingMarkers({ L, map, insideLayer, outsideLayer, triangle, results,
      popup(result) { popups.push(result); return 'synthetischer Kommentar'; } });
  } };
}

test('Innen- und Aussenmarker erhalten Leaflet-Koordinaten und passende Symbole', () => {
  const env = environment();
  equal(env.render([{ coordinates: [7.6, 47.55], status: 'inside' }, { coordinates: [7.62, 47.56], status: 'outside' }]), 2);
  equal(env.insideLayer.markers[0].coordinates, [47.55, 7.6]);
  equal(env.outsideLayer.markers[0].coordinates, [47.56, 7.62]);
  equal(env.insideLayer.markers[0].kind, 'triangle');
  equal(env.outsideLayer.markers[0].kind, 'triangle');
  assert(env.insideLayer.markers[0].options.icon === env.triangle.inside);
  assert(env.outsideLayer.markers[0].options.icon === env.triangle.outside);
  equal(env.insideLayer.markers[0].popup, 'synthetischer Kommentar');
  equal(env.zooms[0].points, [[47.55, 7.6], [47.56, 7.62]]);
});

test('Versteckte Gebäudeebenen beim Import wieder einblenden', () => {
  const env = environment();
  assert(!env.insideLayer.visible && !env.outsideLayer.visible);
  env.render([{ coordinates: [7.6, 47.55], status: 'inside' }]);
  assert(env.insideLayer.visible && env.outsideLayer.visible);
  assert(env.insideLayer.map === env.map && env.outsideLayer.map === env.map);
});

test('Auch reine Aussentreffer bekommen einen sichtbaren Kartenausschnitt', () => {
  const env = environment();
  env.render([{ coordinates: [7.62, 47.56], status: 'outside' }]);
  equal(env.insideLayer.markers.length, 0);
  equal(env.zooms.length, 1);
  equal(env.zooms[0].points, [[47.56, 7.62]]);
  equal(env.zooms[0].options, { padding: [24, 24], maxZoom: 17 });
});

test('Identische Adresspunkte einmal markieren und Zeilenzahl im Popup erhalten', () => {
  const env = environment(), row = { coordinates: [7.6, 47.55], status: 'inside' };
  const before = JSON.stringify(row);
  equal(env.render([row, row]), 1);
  equal(env.insideLayer.markers.length, 1);
  equal(env.popups[0].count, 2);
  equal(JSON.stringify(row), before);
});

test('Ungeklärte Zeilen erzeugen keine erfundenen Punkte oder Zooms', () => {
  const env = environment();
  equal(env.render([{ status: 'unresolved', reason: 'synthetisch unbekannt' }]), 0);
  equal(env.insideLayer.markers.length + env.outsideLayer.markers.length, 0);
  equal(env.zooms.length, 0);
});

document.getElementById('markers-results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');
document.documentElement.dataset.markersTestResult = failed ? 'failed' : 'passed';
