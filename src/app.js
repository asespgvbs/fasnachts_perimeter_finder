import { prepareGeoJSON, parsePerimeterCSV } from './core.js';
import { setupBuildingAnalysis } from './analysis.js';
import { perimeterArea, createPerimeterBuffer } from './analysis-core.js';

const MAX_BYTES = 20 * 1024 * 1024;

export function startViewer(L, environment = globalThis) {
  const { document, ResizeObserver } = environment;
  const status = document.getElementById('status');
  const tileStatus = document.getElementById('tile-status');
  const fileButton = document.getElementById('file-button');
  const input = document.getElementById('file-input');
  const offset = document.getElementById('perimeter-offset');
  const offsetValue = document.getElementById('perimeter-offset-value');
  const map = L.map('map', { crs: L.CRS.EPSG3857, preferCanvas: true, maxZoom: 19 })
    .setView([47.5596, 7.62], 13);
  if (map.attributionControl) map.attributionControl.setPrefix(false);
  const layerControl = L.control.layers({}, {}, { position: 'topright' }).addTo(map);
  let currentLayer = null;
  let source = null, offsetTimer = null;
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

  async function showGeometry(result, name, fitView = true) {
    let candidate;
    try {
      const perimeter = perimeterArea(result.geojson);
      const buffer = createPerimeterBuffer(perimeter.area, Number(offset.value));
      candidate = L.geoJSON(buffer.area, {
        // A single nonzero path paints the union once, including overlapping caps.
        style: { color: '#196b8a', weight: 3, stroke: buffer.meters === 0,
          fillColor: '#4f9dba', fillOpacity: 0.28, fillRule: buffer.meters ? 'nonzero' : 'evenodd' },
      });
      const bounds = candidate.getBounds();
      if (!bounds.isValid()) throw new Error('Es konnten keine darstellbaren Geometrien gefunden werden.');
      candidate.addTo(map);
      if (fitView) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 19 });
      if (currentLayer) {
        map.removeLayer(currentLayer);
        layerControl.removeLayer(currentLayer);
      }
      currentLayer = candidate;
      source = { result, name };
      offset.disabled = false;
      layerControl.addOverlay(currentLayer, 'Perimeter');
      await analysis.setPerimeter(perimeter.area, buffer, fitView);
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
    status.textContent = ''; status.hidden = true;
    try {
      await action();
    } catch (error) {
      status.classList.add('error');
      status.hidden = false;
      status.textContent = `${error.message || 'Die Geometrien konnten nicht geladen werden.'} Bisher geladene Geometrien bleiben erhalten.`;
    } finally {
      fileButton.disabled = false;
    }
  }

  fileButton.addEventListener('click', () => input.click());
  function adjustPerimeter() {
    clearTimeout(offsetTimer);
    if (!source) return Promise.resolve();
    return load(() => showGeometry(source.result, source.name, false));
  }
  offset.addEventListener('input', () => {
    offsetValue.textContent = `${offset.value} m`;
    clearTimeout(offsetTimer);
    offsetTimer = setTimeout(adjustPerimeter, 120);
  });
  offset.addEventListener('change', () => {
    offsetValue.textContent = `${offset.value} m`;
    return adjustPerimeter();
  });
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
  offset.value = '0'; offset.disabled = true; offsetValue.textContent = '0 m';
  status.textContent = ''; status.hidden = true;
  return { analysis };
}
