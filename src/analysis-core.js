// Pure address, perimeter, and export logic; all data arrives from the browser.
export function normalize(value) {
  return String(value == null ? '' : value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/ß/g, 'ss').trim();
}

export function suggestField(fields, aliases) {
  const simple = value => normalize(value).replace(/[^a-z0-9]/g, '');
  for (const alias of aliases) {
    const matches = fields.filter(field => simple(field) === simple(alias));
    if (matches.length === 1) return matches[0];
  }
  return '';
}

export const FIELD_NAMES = {
  street: ['Strasse', 'Straße', 'Strassenname', 'street', 'street_name', 'strname', 'str_name', 'strbez'],
  house: ['Nummer', 'Hausnummer', 'Strassennummer', 'Nr', 'deinr', 'house_number', 'housenumber', 'hausnr', 'strnr'],
  zip: ['PLZ', 'Postleitzahl', 'postcode', 'postal_code', 'zip', 'dplz4', 'plz4'],
  comment: ['Kommentar', 'Bemerkung', 'comment'],
  point: ['geo_point_2d', 'geopoint', 'geopos', 'wgs84', 'geo_shape', 'geometry', 'coordinates'],
  lon: ['longitude', 'lon', 'lng', 'laengengrad'],
  lat: ['latitude', 'lat', 'breitengrad'],
  east: ['gkode', 'e', 'east', 'easting', 'lv95_e', 'koord_e'],
  north: ['gkodn', 'n', 'north', 'northing', 'lv95_n', 'koord_n'],
};

export function addressKey(street, house, zip) {
  const s = normalize(street).replace(/str\.$/, 'strasse').replace(/[\s.'’\-]/g, '');
  const h = normalize(house).replace(/\s/g, '');
  const z = String(zip == null ? '' : zip).trim();
  if (!s || !/^\d+[a-z]?(?:[-/]\d+[a-z]?)?$/.test(h) || !/^\d{4}$/.test(z)) return null;
  return JSON.stringify([s, h, z]);
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  return Number(String(value).replace(',', '.'));
}

export function addressCoordinates(record, mapping) {
  let coords;
  if (mapping.mode === 'point') {
    let point = record[mapping.point];
    if (typeof point === 'string') { try { point = JSON.parse(point); } catch (error) { return null; } }
    if (point && point.type === 'Feature') point = point.geometry;
    if (point && point.geometry && point.geometry.type === 'Point') point = point.geometry;
    if (point && point.type === 'Point') coords = point.coordinates;
    else if (Array.isArray(point)) coords = point.map(number);
    else if (point) coords = [number(point.lon == null ? point.lng : point.lon), number(point.lat)];
  } else {
    const east = number(record[mapping.x]), north = number(record[mapping.y]);
    if (mapping.mode === 'wgs84') coords = [east, north];
    else {
      const lv95 = mapping.mode === 'lv95';
      if (!Number.isFinite(east) || !Number.isFinite(north)
        || (lv95 && !(east >= 2400000 && east <= 2900000 && north >= 1000000 && north <= 1400000))
        || (!lv95 && !(east >= 400000 && east <= 900000 && north >= 0 && north <= 400000))) return null;
      const e = (east - (lv95 ? 2600000 : 600000)) / 1000000;
      const n = (north - (lv95 ? 1200000 : 200000)) / 1000000;
      // Approximate swisstopo CH1903 polynomial, approximately 1 m accuracy.
      coords = [
        (2.6779094 + 4.728982 * e + 0.791484 * e * n + 0.1306 * e * n * n - 0.0436 * e * e * e) * 100 / 36,
        (16.9023892 + 3.238272 * n - 0.270978 * e * e - 0.002528 * n * n - 0.0447 * e * e * n - 0.0140 * n * n * n) * 100 / 36,
      ];
    }
  }
  if (!Array.isArray(coords) || coords.length < 2 || !coords.slice(0, 2).every(Number.isFinite)
    || coords[0] < 7.4 || coords[0] > 7.8 || coords[1] < 47.45 || coords[1] > 47.7) return null;
  return coords.slice(0, 2);
}

export function buildAddressIndex(records, mapping) {
  const index = new Map();
  let validPoints = 0;
  for (const record of records) {
    const key = addressKey(record[mapping.street], record[mapping.house], record[mapping.zip]);
    if (!key) continue;
    const coords = addressCoordinates(record, mapping);
    const match = index.get(key) || { points: [], invalid: false };
    if (!coords) match.invalid = true;
    else if (!match.points.some(point => point[0] === coords[0] && point[1] === coords[1])) {
      match.points.push(coords); validPoints++;
    }
    index.set(key, match);
  }
  return { index, validPoints };
}

export function detectAddressMapping(records) {
  const sample = records.slice(0, 200);
  const fields = [...new Set(sample.flatMap(Object.keys))];
  const common = Object.fromEntries(['street', 'house', 'zip'].map(key => [key, suggestField(fields, FIELD_NAMES[key])]));
  if (Object.values(common).some(field => !field) || new Set(Object.values(common)).size !== 3) {
    throw new Error('Die Strassen-, Nummern- und PLZ-Felder des amtlichen Adressdienstes konnten nicht automatisch erkannt werden.');
  }
  const candidates = [];
  for (const alias of FIELD_NAMES.point) {
    const point = suggestField(fields, [alias]);
    if (point) candidates.push(Object.assign({}, common, { mode: 'point', point }));
  }
  const lon = suggestField(fields, FIELD_NAMES.lon), lat = suggestField(fields, FIELD_NAMES.lat);
  if (lon && lat) candidates.push(Object.assign({}, common, { mode: 'wgs84', x: lon, y: lat }));
  const east = suggestField(fields, FIELD_NAMES.east), north = suggestField(fields, FIELD_NAMES.north);
  if (east && north) for (const mode of ['lv95', 'lv03']) candidates.push(Object.assign({}, common, { mode, x: east, y: north }));
  for (const candidate of candidates) {
    if (sample.some(record => addressKey(record[common.street], record[common.house], record[common.zip]) && addressCoordinates(record, candidate))) return candidate;
  }
  throw new Error('Die Koordinatenfelder des amtlichen Adressdienstes konnten nicht automatisch erkannt werden.');
}

export function importWorkbook(workbook, XLSX) {
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r > 50000 || range.e.c > 255) throw new Error('Maximal 50’000 Datenzeilen und 256 Spalten pro Tabellenblatt.');
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true, range: 0 });
    const names = (data[0] || []).map(value => String(value == null ? '' : value));
    const columns = Object.fromEntries(['street', 'house', 'zip'].map(key => {
      const field = suggestField(names, FIELD_NAMES[key]);
      return [key, field ? names.indexOf(field) : -1];
    }));
    if (Object.values(columns).some(index => index < 0) || new Set(Object.values(columns)).size !== 3) continue;
    const width = Math.max(...data.map(row => row.length));
    const header = Array.from({ length: width }, (_, i) => data[0][i] == null ? null : data[0][i]);
    const rows = data.slice(1).map((row, i) => ({ row, excelRow: i + 2 })).filter(item => item.row.some(value => value != null && String(value).trim() !== ''));
    if (!rows.length) throw new Error('Die Gebäude-Excel enthält keine Datenzeilen.');
    const comment = suggestField(names, FIELD_NAMES.comment);
    return { header, rows, columns, comment: comment ? names.indexOf(comment) : -1 };
  }
  throw new Error('Die erste Zeile eines Tabellenblatts muss die Spalten Strasse, Nummer und PLZ enthalten. Kommentar und weitere Spalten bleiben erhalten.');
}

export function matchAddress(row, columns, index) {
  const key = addressKey(row[columns.street], row[columns.house], row[columns.zip]);
  if (!key) return { reason: 'Strasse, Hausnummer oder vierstellige PLZ fehlt / ist ungültig.' };
  const match = index.get(key);
  if (!match) return { reason: 'Keine exakte Adresse im offiziellen Adressbestand.' };
  if (match.invalid) return { reason: 'Amtliche Koordinaten fehlen oder sind unplausibel.' };
  if (match.points.length !== 1) return { reason: 'Mehrere unterschiedliche amtliche Adresspunkte: manuell klären.' };
  return { coordinates: match.points[0] };
}

// Close each imported boundary using its own first point. No GIS dependency.
export function perimeterArea(geojson) {
  const features = [];
  let positions = 0, closedRings = 0;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  function closeRing(points) {
    if (!Array.isArray(points) || points.length < 3
      || points.some(point => !Array.isArray(point) || point.length < 2
        || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
        || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) {
      throw new Error('Ein Perimeter braucht mindestens drei gültige WGS84-Punkte.');
    }
    const ring = points.map(point => point.slice(0, 2));
    if (new Set(ring.map(point => JSON.stringify(point))).size < 3) {
      throw new Error('Ein Perimeter braucht mindestens drei unterschiedliche Eckpunkte.');
    }
    const a = ring[0], b = ring.find(point => !same(a, point));
    if (!ring.some(point => Math.abs((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) > 1e-14)) {
      throw new Error('Die Perimeterpunkte liegen alle auf einer Geraden.');
    }
    if (!same(ring[0], ring[ring.length - 1])) { ring.push(ring[0].slice()); closedRings++; }
    positions += ring.length;
    if (positions > 5000) throw new Error('Der Perimeter darf höchstens 5’000 Positionen enthalten.');
    return ring;
  }
  function polygon(rings) {
    if (!Array.isArray(rings) || !rings.length) throw new Error('Der Perimeter enthält keine Fläche.');
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings.map(closeRing) } });
  }
  function visit(shape) {
    if (!shape) throw new Error('Der Perimeter enthält keine Geometrie.');
    if (shape.type === 'Feature') visit(shape.geometry);
    else if (shape.type === 'FeatureCollection') {
      if (shape.features.length && shape.features.every(item => item.geometry && item.geometry.type === 'Point')) {
        polygon([shape.features.map(item => item.geometry.coordinates)]);
      } else shape.features.forEach(visit);
    }
    else if (shape.type === 'GeometryCollection') shape.geometries.forEach(visit);
    else if (shape.type === 'Polygon') polygon(shape.coordinates);
    else if (shape.type === 'MultiPolygon') shape.coordinates.forEach(polygon);
    else if (shape.type === 'LineString' || shape.type === 'MultiPoint') polygon([shape.coordinates]);
    else if (shape.type === 'MultiLineString') shape.coordinates.forEach(line => polygon([line]));
    else throw new Error('Mindestens drei Punkte als Linie, Punktfolge oder Polygon für den Perimeter laden.');
  }
  visit(geojson);
  if (!features.length) throw new Error('Keine Perimeterfläche vorhanden.');
  return { area: { type: 'FeatureCollection', features }, closedRings };
}

// Ray casting in WGS84. 0 = boundary, 1 = inside, -1 = outside.
// Boundary points count as inside, including boundaries of polygon holes.
function ringLocation(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1], [bx, by] = ring[i], dx = bx - ax, dy = by - ay;
    const cross = (x - ax) * dy - (y - ay) * dx;
    if (Math.abs(cross) <= 1e-10 * Math.max(Math.abs(dx), Math.abs(dy))
      && x >= Math.min(ax, bx) - 1e-10 && x <= Math.max(ax, bx) + 1e-10
      && y >= Math.min(ay, by) - 1e-10 && y <= Math.max(ay, by) + 1e-10) return 0;
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
  }
  return inside ? 1 : -1;
}

export function pointInPerimeter(point, area) {
  return area.features.some(feature => {
    const rings = feature.geometry.coordinates, outer = ringLocation(point, rings[0]);
    if (outer < 0) return false;
    if (outer === 0) return true;
    for (let i = 1; i < rings.length; i++) {
      const hole = ringLocation(point, rings[i]);
      if (hole === 0) return true;
      if (hole === 1) return false;
    }
    return true;
  });
}

export function classifyAddress(item, columns, index, area) {
  const match = matchAddress(item.row, columns, index);
  if (match.reason) return Object.assign({}, item, { status: 'unresolved', reason: match.reason });
  return Object.assign({}, item, { coordinates: match.coordinates, status: pointInPerimeter(match.coordinates, area) ? 'inside' : 'outside' });
}

export function exportRows(imported, results, filter) {
  if (!['inside', 'outside', 'unresolved'].includes(filter)) throw new Error('Ungültiger Exportfilter.');
  const header = [...imported.header];
  if (filter === 'unresolved') {
    let name = 'Klärungsgrund';
    while (header.includes(name)) name += '_';
    header.push(name);
  }
  const rows = results.filter(result => result.status === filter).map(result => {
    const row = Array.from({ length: imported.header.length }, (_, index) => result.row[index] == null ? null : result.row[index]);
    return filter === 'unresolved' ? [...row, result.reason] : row;
  });
  return { header, rows };
}
