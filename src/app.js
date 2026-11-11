import { prepareGeoJSON, parsePerimeterCSV } from './core.js';
import { setupBuildingAnalysis } from './analysis.js';
import { perimeterArea } from './analysis-core.js';

const MAX_BYTES = 20 * 1024 * 1024;

export function startViewer(L, environment = globalThis) {
  const { document, ResizeObserver } = environment;
  const status = document.getElementById('status');
  const tileStatus = document.getElementById('tile-status');
  const fileButton = document.getElementById('file-button');
  const input = document.getElementById('file-input');
  const map = L.map('map', { crs: L.CRS.EPSG3857, preferCanvas: true, maxZoom: 19 })
    .setView([47.5596, 7.62], 13);
  const layerControl = L.control.layers({}, {}, { position: 'topright' }).addTo(map);
  let currentLayer = null;
  const analysis = setupBuildingAnalysis(L, map, layerControl, environment);

  function basemap(style) {
    // GeoBS WMTS explicitly uses z / y / x, with the standard XYZ tile grid.
    const layer = L.tileLayer(`https://wmts.geo.bs.ch/wmts/1.0.0/${style}/default/3857/{z}/{y}/{x}.png`, {
      attribution: 'GeoBS - Kanton Basel-Stadt', maxZoom: 19, maxNativeZoom: 19,
    });
    let failed = false;
    layer.on('loading', () => { failed = false; });
    layer.on('tileerror', () => {
      failed = true;
      if (map.hasLayer(layer)) tileStatus.textContent = 'GeoBS-Hintergrund nicht vollständig erreichbar. Internetzugang und Kartendienst prüfen.';
    });
    layer.on('load', () => {
      if (!failed && map.hasLayer(layer)) tileStatus.textContent = '';
    });
    return layer;
  }

  const gray = basemap('BaseMap_grau');
  const color = basemap('BaseMap_farbig');
  layerControl.addBaseLayer(gray, 'GeoBS grau');
  layerControl.addBaseLayer(color, 'GeoBS farbig');
  gray.addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  async function showGeometry(result, name) {
    let candidate;
    try {
      const perimeter = perimeterArea(result.geojson);
      candidate = L.geoJSON(perimeter.area, {
        style: { color: '#196b8a', weight: 3, fillColor: '#4f9dba', fillOpacity: 0.22 },
      });
      const bounds = candidate.getBounds();
      if (!bounds.isValid()) throw new Error('Es konnten keine darstellbaren Geometrien gefunden werden.');
      candidate.addTo(map);
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 19 });
      if (currentLayer) {
        map.removeLayer(currentLayer);
        layerControl.removeLayer(currentLayer);
      }
      currentLayer = candidate;
      layerControl.addOverlay(currentLayer, 'Perimeter');
      await analysis.setPerimeter(perimeter.area);
      status.textContent = `${name} · ${result.positionCount.toLocaleString('de-CH')} Positionen · Perimeterfläche${perimeter.closedRings ? ' · letzter Punkt mit erstem verbunden' : ''}${result.emptyCount ? ` · ${result.emptyCount} leere Geometrien ausgelassen` : ''}`;
    } catch (error) {
      if (candidate && candidate !== currentLayer) map.removeLayer(candidate);
      throw error;
    }
  }

  async function loadText(text, name) {
    const isCSV = /\.csv$/i.test(name);
    let result;
    if (isCSV) result = parsePerimeterCSV(text);
    else {
      let json;
      try { json = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch (error) { throw new Error('Die Datei enthält kein gültiges JSON.'); }
      result = prepareGeoJSON(json);
    }
    await showGeometry(result, name);
  }

  async function load(action) {
    fileButton.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Perimeter wird geladen und geprüft …';
    try {
      await action();
    } catch (error) {
      status.classList.add('error');
      status.textContent = `${error.message || 'Die Geometrien konnten nicht geladen werden.'} Bisher geladene Geometrien bleiben erhalten.`;
    } finally {
      fileButton.disabled = false;
    }
  }

  fileButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    await load(async () => {
      if (!/\.(csv|geojson|gjson|json)$/i.test(file.name)) throw new Error('Bitte eine .csv-, .geojson-, .gjson- oder .json-Datei auswählen.');
      if (file.size > MAX_BYTES) throw new Error('Die Datei ist zu gross. Maximal 20 MB sind erlaubt.');
      await loadText(await file.text(), file.name);
    });
  });
  new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
  fileButton.disabled = false;
  status.textContent = 'Kein Perimeter geladen. Bitte über «Perimeter laden» eine Datei auswählen.';
  return { analysis };
}
