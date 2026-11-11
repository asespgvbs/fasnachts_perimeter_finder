// Pure functions. No files, network requests, storage, or access to browser globals.
export function normalized(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/ß/g, 'ss').trim();
}

export function streetName(value) {
  return normalized(value).replace(/str\.$/, 'strasse').replace(/[\s.'’\-]/g, '');
}

export function houseNumber(value) {
  const result = normalized(value).replace(/\s/g, '');
  return /^\d+[a-z]?(?:[-/]\d+[a-z]?)?$/.test(result) ? result : '';
}

export function postcode(value) {
  const result = String(value ?? '').trim();
  return /^\d{4}$/.test(result) ? result : '';
}

export function addressKey(street, house, zip) {
  const parts = [streetName(street), houseNumber(house), postcode(zip)];
  return parts.every(Boolean) ? JSON.stringify(parts) : null;
}

export function fieldSuggestion(fields, aliases) {
  const simplify = value => normalized(value).replace(/[^a-z0-9]/g, '');
  for (const alias of aliases) {
    const matches = fields.filter(field => simplify(field) === simplify(alias));
    if (matches.length === 1) return matches[0];
  }
  return '';
}

export const ALIASES = {
  street: ['Strassenname', 'Strasse', 'Straße', 'street', 'street_name', 'strname', 'str_name', 'strassenbezeichnung', 'strbez'],
  house: ['Strassennummer', 'Hausnummer', 'street_number', 'house_number', 'housenumber', 'deinr', 'hausnr', 'strnr'],
  postcode: ['PLZ', 'Postleitzahl', 'postcode', 'postal_code', 'zip', 'dplz4', 'plz4'],
  point: ['geo_point_2d', 'geopoint', 'geopos', 'wgs84', 'geo_shape', 'geometry', 'coordinates', 'koordinaten'],
  lon: ['longitude', 'lon', 'lng', 'laengengrad'],
  lat: ['latitude', 'lat', 'breitengrad'],
  east: ['gkode', 'e', 'east', 'easting', 'lv95_e', 'koord_e', 'x_koord'],
  north: ['gkodn', 'n', 'north', 'northing', 'lv95_n', 'koord_n', 'y_koord'],
};

export function validatePerimeter(input) {
  const source = input?.type === 'FeatureCollection' ? input.features
    : input?.type === 'Feature' ? [input] : [{ type: 'Feature', properties: {}, geometry: input }];
  if (!Array.isArray(source) || !source.length) throw new Error('Das GeoJSON enthält keine Flächen.');
  let vertexCount = 0;
  const features = source.map(feature => {
    const geometry = feature?.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
      throw new Error('Nur Polygon und MultiPolygon sind als Perimeter erlaubt.');
    }
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) throw new Error('Leere Polygongeometrie.');
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Ein Polygon braucht einen Aussenring.');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Jeder Polygonring braucht mindestens vier Positionen.');
        for (const point of ring) {
          if (++vertexCount > 100000) throw new Error('Perimeter zu gross: höchstens 100’000 Positionen.');
          if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)
            || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) {
            throw new Error('WGS84-Koordinaten als [Längengrad, Breitengrad] erforderlich (EPSG:4326).');
          }
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Ein Polygonring ist nicht geschlossen.');
      }
    }
    // Discard untrusted input properties and CRS. Only standard WGS84 geometries are used.
    return { type: 'Feature', properties: {}, geometry };
  });
  if (input?.crs && !/4326|CRS84/i.test(JSON.stringify(input.crs))) throw new Error('GeoJSON bitte zuerst nach WGS84 / EPSG:4326 umprojizieren.');
  return { type: 'FeatureCollection', features };
}

export function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  return Number(String(value).replace(',', '.'));
}

// swisstopo's published approximate CH1903 -> WGS84 polynomial.
// LV95 is reduced to LV03 first. Accuracy is approximately 1 metre.
export function swissToWgs84(east, north, lv95 = true) {
  const e = (east - (lv95 ? 2600000 : 600000)) / 1000000;
  const n = (north - (lv95 ? 1200000 : 200000)) / 1000000;
  const lon = (2.6779094 + 4.728982 * e + 0.791484 * e * n + 0.1306 * e * n * n - 0.0436 * e * e * e) * 100 / 36;
  const lat = (16.9023892 + 3.238272 * n - 0.270978 * e * e - 0.002528 * n * n - 0.0447 * e * e * n - 0.0140 * n * n * n) * 100 / 36;
  return [lon, lat];
}

export function recordCoordinates(record, mapping) {
  let point;
  if (mapping.mode === 'point') {
    let value = record[mapping.point];
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
    if (value?.type === 'Feature') value = value.geometry;
    if (value?.geometry?.type === 'Point') value = value.geometry;
    if (value?.type === 'Point') point = value.coordinates;
    else if (value && !Array.isArray(value)) point = [numeric(value.lon ?? value.lng), numeric(value.lat)];
    else if (Array.isArray(value)) point = value.map(numeric); // Explicitly longitude, latitude.
  } else {
    const x = numeric(record[mapping.x]);
    const y = numeric(record[mapping.y]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (mapping.mode === 'lv95' && !(x >= 2400000 && x <= 2900000 && y >= 1000000 && y <= 1400000)) return null;
    if (mapping.mode === 'lv03' && !(x >= 400000 && x <= 900000 && y >= 0 && y <= 400000)) return null;
    point = mapping.mode === 'wgs84' ? [x, y] : swissToWgs84(x, y, mapping.mode === 'lv95');
  }
  // This app targets Basel-Stadt. Reject reversed coordinates and implausible data.
  if (!point || !point.slice(0, 2).every(Number.isFinite) || point[0] < 7.4 || point[0] > 7.8 || point[1] < 47.45 || point[1] > 47.7) return null;
  return point.slice(0, 2);
}

export function buildAddressIndex(records, mapping) {
  const index = new Map();
  let usable = 0;
  for (const record of records) {
    const key = addressKey(record[mapping.street], record[mapping.house], record[mapping.postcode]);
    if (!key) continue;
    const coords = recordCoordinates(record, mapping);
    const matches = index.get(key) ?? { points: [], invalid: false };
    if (!coords) matches.invalid = true;
    else if (!matches.points.some(point => point[0] === coords[0] && point[1] === coords[1])) {
      matches.points.push(coords);
      usable++;
    }
    index.set(key, matches);
  }
  return { index, usable };
}

export function resolveAddress(row, columns, index) {
  const street = row[columns.street], house = row[columns.house], zip = row[columns.postcode];
  const key = addressKey(street, house, zip);
  if (!key) return { reason: 'Strassenname, Hausnummer oder vierstellige PLZ fehlt / ist ungültig.' };
  const match = index.get(key);
  if (!match) return { reason: 'Keine exakte Adresse im offiziellen Adressbestand.' };
  if (match.invalid) return { reason: 'Adresse enthält fehlende oder unplausible amtliche Koordinaten.' };
  if (match.points.length !== 1) return { reason: 'Mehrere unterschiedliche Adresspunkte: manuelle Klärung erforderlich.' };
  return { coordinates: match.points[0] };
}

export function classifyPoint(coordinates, perimeter, turf) {
  const point = turf.point(coordinates);
  // Multiple features are combined as a union. Polygon holes remain outside.
  return perimeter.features.some(feature => turf.booleanPointInPolygon(point, feature, { ignoreBoundary: false }));
}
