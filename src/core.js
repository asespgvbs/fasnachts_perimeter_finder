// Validation only: no I/O, projection changes, or swapping coordinate axes.
const WGS84_ERROR = 'GeoJSON muss WGS84 enthalten: [Längengrad, Breitengrad]. LV95 / EPSG:2056 bitte vorab transformieren.';

export function prepareGeoJSON(input, maxPositions = 100000) {
  let positionCount = 0;
  let emptyCount = 0;

  function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ein GeoJSON-Objekt wird erwartet.');
    if (Object.hasOwn(value, 'crs')) {
      const name = value.crs && value.crs.properties && value.crs.properties.name;
      if (!value.crs || value.crs.type !== 'name' || typeof name !== 'string'
        || !/^(?:EPSG:4326|urn:ogc:def:crs:OGC:1\.3:CRS84|urn:ogc:def:crs:EPSG::4326|urn:ogc:def:crs:EPSG:6\.6:4326)$/i.test(name)) {
        throw new Error(WGS84_ERROR);
      }
    }
  }

  function array(value) {
    if (!Array.isArray(value)) throw new Error('Die Geometrie enthält kein gültiges Koordinaten-Array.');
  }

  function position(value) {
    array(value);
    if (value.length < 2 || !value.every(Number.isFinite)) throw new Error('Eine Position braucht mindestens zwei endliche Zahlen: [Längengrad, Breitengrad].');
    if (Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error(WGS84_ERROR);
    if (++positionCount > maxPositions) throw new Error(`Datei zu komplex: höchstens ${maxPositions.toLocaleString('de-CH')} Positionen.`);
  }

  function line(value, ring = false) {
    array(value);
    if (value.length < (ring ? 3 : 2)) throw new Error(ring ? 'Ein Polygonring braucht mindestens drei Positionen.' : 'Eine Linie braucht mindestens zwei Positionen.');
    value.forEach(position);
    if (ring) {
      if (new Set(value.map(point => JSON.stringify(point.slice(0, 2)))).size < 3) throw new Error('Ein Polygonring braucht mindestens drei unterschiedliche Eckpunkte.');
    }
  }

  function polygon(value) {
    array(value);
    if (!value.length) throw new Error('Ein Polygon braucht einen Aussenring.');
    value.forEach(ring => line(ring, true));
  }

  function geometry(value, depth = 0) {
    if (depth > 32) throw new Error('Die Geometrie ist zu tief verschachtelt.');
    if (value === null) { emptyCount++; return null; }
    object(value);
    if (value.type === 'GeometryCollection') {
      array(value.geometries);
      const children = value.geometries.map(child => geometry(child, depth + 1)).filter(Boolean);
      if (!children.length) { emptyCount++; return null; }
      return { type: 'GeometryCollection', geometries: children };
    }
    if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(value.type)) {
      throw new Error(`Nicht unterstützter Geometrietyp: ${String(value.type == null ? '(fehlt)' : value.type).slice(0, 60)}.`);
    }
    const coords = value.coordinates;
    array(coords);
    if (!coords.length) { emptyCount++; return null; }
    switch (value.type) {
      case 'Point': position(coords); break;
      case 'MultiPoint': coords.forEach(position); break;
      case 'LineString': line(coords); break;
      case 'MultiLineString': coords.forEach(part => line(part)); break;
      case 'Polygon': polygon(coords); break;
      case 'MultiPolygon': coords.forEach(polygon); break;
    }
    // Properties and foreign members are not needed for this minimal viewer.
    const close = ring => ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring : ring.concat([ring[0].slice()]);
    const coordinates = value.type === 'Polygon' ? coords.map(close)
      : value.type === 'MultiPolygon' ? coords.map(rings => rings.map(close)) : coords;
    return { type: value.type, coordinates };
  }

  function feature(value) {
    object(value);
    if (value.type !== 'Feature' || !Object.hasOwn(value, 'geometry')) throw new Error('Ein Eintrag der FeatureCollection ist kein gültiges Feature.');
    const shape = geometry(value.geometry);
    return shape ? { type: 'Feature', properties: {}, geometry: shape } : null;
  }

  object(input);
  let features;
  if (input.type === 'FeatureCollection') {
    array(input.features);
    features = input.features.map(feature).filter(Boolean);
  } else if (input.type === 'Feature') {
    features = [feature(input)].filter(Boolean);
  } else {
    const shape = geometry(input);
    features = shape ? [{ type: 'Feature', properties: {}, geometry: shape }] : [];
  }
  if (!features.length) throw new Error('Die Datei enthält keine darstellbaren Geometrien.');
  return { geojson: { type: 'FeatureCollection', features }, emptyCount, positionCount };
}

// CSV inputs are supplied at runtime by the browser, never read during development.
function csvRows(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const finishField = () => { row.push(field); field = ''; closed = false; };
  const finishRow = () => {
    finishField();
    if (row.some(value => value.trim() !== '')) rows.push(row);
    row = [];
    if (rows.length > 100001) throw new Error('Die CSV enthält mehr als 100’000 Positionen.');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === delimiter) finishField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else if (closed) {
      if (!/\s/.test(char)) throw new Error('Ungültige CSV: unerwarteter Text nach einem Anführungszeichen.');
    } else if (char === '"') {
      if (field.trim()) throw new Error('Ungültige Anführungszeichen in der CSV.');
      field = '';
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error('Die CSV enthält ein nicht geschlossenes Anführungszeichen.');
  if (field || closed || row.length) finishRow();
  return rows;
}

export function parsePerimeterCSV(text) {
  text = text.replace(/^\uFEFF/, '').trim();
  // Some spreadsheet CSV exports declare their separator on the first line.
  text = text.replace(/^sep=[;,\t]\r?\n/i, '');
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0];
  const normalizedHeader = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '').toLowerCase().replace(/[^a-z]/g, '');
  let delimiter, longitudeIndex, latitudeIndex;
  for (const candidate of [',', ';', '\t']) {
    let header;
    try { header = (csvRows(firstLine, candidate)[0] || []).map(normalizedHeader); }
    catch (error) { continue; }
    const lon = header.map((name, index) => ['longitude', 'lon', 'lng', 'langengrad', 'laengengrad'].includes(name) ? index : -1).filter(index => index >= 0);
    const lat = header.map((name, index) => ['latitude', 'lat', 'breitengrad'].includes(name) ? index : -1).filter(index => index >= 0);
    if (lon.length > 1 || lat.length > 1) throw new Error('Die CSV enthält mehrdeutige Longitude-/Latitude-Spalten.');
    if (lon.length === 1 && lat.length === 1) {
      delimiter = candidate; longitudeIndex = lon[0]; latitudeIndex = lat[0]; break;
    }
  }
  if (!delimiter) throw new Error('CSV-Spalten Longitude und Latitude fehlen. Easting / Northing (LV95) werden nicht automatisch umgerechnet.');
  const rows = csvRows(text, delimiter);
  const number = value => {
    const raw = String(value == null ? '' : value).trim();
    return /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  };
  const coordinates = rows.slice(1).map((row, index) => {
    if (row.length !== rows[0].length) throw new Error(`CSV-Datenzeile ${index + 1}: Die Spaltenanzahl stimmt nicht mit der Kopfzeile überein.`);
    const lon = number(row[longitudeIndex]), lat = number(row[latitudeIndex]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new Error(`CSV-Datenzeile ${index + 1}: Longitude / Latitude fehlt oder enthält keine gültigen WGS84-Koordinaten.`);
    }
    return [lon, lat];
  });
  if (coordinates.length < 2 || !coordinates.some(point => point[0] !== coordinates[0][0] || point[1] !== coordinates[0][1])) {
    throw new Error('Für die Perimeter-Linie werden mindestens zwei unterschiedliche Positionen benötigt.');
  }
  // The row order defines the line; do not sort or invent a closing segment.
  return prepareGeoJSON({ type: 'LineString', coordinates });
}
