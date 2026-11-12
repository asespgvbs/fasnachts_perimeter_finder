import { buildAddressIndex, detectAddressMapping, importWorkbook, perimeterArea, classifyAddress, exportRows } from './analysis-core.js';

const ADDRESS_URL = 'https://data.bs.ch/api/explore/v2.1/catalog/datasets/100259/exports/json?limit=-1';
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

export function renderBuildingMarkers({ L, map, insideLayer, outsideLayer, triangle, results, popup, onToggle, fitView = true }) {
  const unique = new Map();
  for (const result of results) {
    if (result.status === 'unresolved') continue;
    const key = JSON.stringify(result.coordinates), existing = unique.get(key);
    if (existing) { existing.count++; existing.members.push(result); }
    else unique.set(key, Object.assign({}, result, { count: 1, members: [result] }));
  }
  for (const result of unique.values()) {
    const [lon, lat] = result.coordinates, inside = result.status === 'inside';
    const marker = L.marker([lat, lon], { icon: inside ? triangle.inside : triangle.outside,
      title: inside ? 'Gebäude innerhalb' : 'Gebäude ausserhalb', keyboard: true });
    marker.bindPopup(popup(result)).addTo(inside ? insideLayer : outsideLayer);
    if (onToggle) marker.on('click', () => {
      const next = result.status === 'inside' ? 'outside' : 'inside';
      if (onToggle(result.members, next) === false) return;
      const previousLayer = result.status === 'inside' ? insideLayer : outsideLayer;
      const nextLayer = next === 'inside' ? insideLayer : outsideLayer;
      result.status = next;
      previousLayer.removeLayer(marker);
      marker.options.title = next === 'inside' ? 'Gebäude innerhalb' : 'Gebäude ausserhalb';
      marker.setIcon(triangle[next]);
      marker.setPopupContent(popup(result));
      nextLayer.addLayer(marker);
      marker.openPopup();
    });
  }
  // An import should reveal its results even if these overlays were hidden earlier.
  insideLayer.addTo(map); outsideLayer.addTo(map);
  const bounds = insideLayer.getBounds(), outsideBounds = outsideLayer.getBounds();
  if (outsideBounds.isValid()) bounds.extend(outsideBounds);
  if (fitView && bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
  return unique.size;
}

export function setupBuildingAnalysis(L, map, controls, { document, fetch } = globalThis) {
  const $ = id => document.getElementById(id);
  const state = { XLSX: null, source: null, buffer: null,
    imported: null, filename: '', index: null, addressPromise: null, results: null, version: 0, busy: false, evaluating: false };
  const insideLayer = L.featureGroup().addTo(map), outsideLayer = L.featureGroup().addTo(map);
  controls.addOverlay(insideLayer, 'Gebäude innerhalb · grüne Dreiecke');
  controls.addOverlay(outsideLayer, 'Gebäude ausserhalb · rote Dreiecke');
  const triangleIcon = color => L.divIcon({ className: 'building-triangle', iconSize: [18, 18], iconAnchor: [9, 9],
    html: `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1L17 16H1Z" fill="${color}" stroke="#223b40" stroke-width="1.4"/></svg>` });
  const triangle = { inside: triangleIcon('#1aaa62'), outside: triangleIcon('#dc3b30') };

  function message(text, error = false) {
    const imported = state.imported
      ? `${state.filename}: ${state.imported.rows.length.toLocaleString('de-CH')} Excel-Zeilen eingelesen. ` : '';
    $('analysis-status').textContent = imported + text;
    $('analysis-status').classList.toggle('error', error);
  }
  function buttons() {
    $('excel-button').disabled = !state.XLSX || state.busy || state.evaluating;
    $('export-button').disabled = !state.XLSX || state.busy || state.evaluating || state.results === null;
  }
  function clearResults() {
    state.results = null; insideLayer.clearLayers(); outsideLayer.clearLayers();
    for (const id of ['inside-count', 'outside-count', 'unresolved-count']) $(id).textContent = '–';
    $('unresolved-list').replaceChildren(); $('unresolved-panel').hidden = true;
  }
  function address(row) {
    const c = state.imported.columns;
    return `${row[c.street] == null ? '' : row[c.street]} ${row[c.house] == null ? '' : row[c.house]}, ${row[c.zip] == null ? '' : row[c.zip]}`.trim();
  }
  function updateCounts() {
    for (const kind of ['inside', 'outside', 'unresolved']) $(kind + '-count').textContent = state.results.filter(result => result.status === kind).length.toLocaleString('de-CH');
  }
  function renderResults(fitView) {
    const results = state.results;
    updateCounts();
    const unresolved = state.results.filter(result => result.status === 'unresolved');
    renderBuildingMarkers({ L, map, insideLayer, outsideLayer, triangle, results, fitView, onToggle(members, next) {
      // Only change the current evaluation, never markers from a previous import.
      if (state.busy || state.evaluating || state.results !== results) return false;
      for (const member of members) member.status = next;
      updateCounts();
      message(`Gebäudestatus geändert: ${members.length} Excel-Zeile(n) ${next === 'inside' ? 'innerhalb (im Export enthalten)' : 'ausserhalb (vom Export ausgeschlossen)'}. Erneutes Klicken wechselt den Status zurück.`);
    }, popup(result) {
      const popup = document.createElement('div'); popup.className = 'building-popup';
      const comment = state.imported.comment;
      popup.textContent = `${address(result.row)}\n${result.status === 'inside' ? 'Innerhalb · im Export enthalten' : 'Ausserhalb · vom Export ausgeschlossen'} · ${result.count} Excel-Zeile(n)${comment >= 0 && result.row[comment] != null ? `\nKommentar: ${result.row[comment]}` : ''}\nErneut auf das Dreieck klicken: Status wechseln.`;
      return popup;
    } });
    const fragment = document.createDocumentFragment();
    for (const result of unresolved.slice(0, 100)) {
      const item = document.createElement('div'); item.className = 'unresolved-item';
      item.textContent = `Excel-Zeile ${result.excelRow}: ${address(result.row)}`;
      const reason = document.createElement('small'); reason.textContent = result.reason;
      item.append(reason); fragment.append(item);
    }
    $('unresolved-list').replaceChildren(fragment); $('unresolved-panel').hidden = !unresolved.length;
    const noMatches = unresolved.length === state.results.length;
    $('unresolved-panel').open = noMatches;
    message(noMatches
      ? 'Keine Adresse konnte eindeutig zugeordnet werden; deshalb erscheinen keine Gebäudemarker. Details stehen unter «Nicht zugeordnete Adressen anzeigen». Strasse, Hausnummer und PLZ prüfen.'
      : `Adressabgleich abgeschlossen. Grüne Dreiecke: innerhalb, rote Dreiecke: ausserhalb. Klick auf ein Dreieck wechselt Status und Exportauswahl. Export enthält nur Gebäude innerhalb.${unresolved.length > 100 ? ' Die ersten 100 ungeklärten Zeilen werden angezeigt.' : ''}`);
  }
  async function addressIndex() {
    if (state.index) return state.index;
    if (!state.addressPromise) state.addressPromise = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 180000);
      try {
        const response = await fetch(ADDRESS_URL, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`GWR-Adressdienst nicht erreichbar (HTTP ${response.status}). Gebäude später erneut importieren.`);
        const records = await response.json();
        if (!Array.isArray(records) || !records.length || records.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Unerwartetes Format des amtlichen Adressbestands.');
        const mapping = detectAddressMapping(records);
        const built = buildAddressIndex(records, mapping);
        if (!built.validPoints) throw new Error('Im amtlichen Adressbestand wurden keine plausiblen Koordinaten gefunden.');
        state.index = built.index; return state.index;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('Der GWR-Adressabgleich hat zu lange gedauert. Gebäude später erneut importieren.');
        if (error instanceof TypeError) throw new Error('GWR-Adressdienst nicht erreichbar (Netzwerk / CORS). Gebäude später erneut importieren.');
        throw error;
      } finally { clearTimeout(timeout); }
    })();
    try { return await state.addressPromise; }
    catch (error) { state.addressPromise = null; throw error; }
  }
  async function evaluate(fitView = true) {
    const version = ++state.version;
    state.evaluating = true; clearResults(); buttons();
    try {
      if (!state.XLSX) return;
      if (!state.source) { message(state.imported ? 'Perimeter laden, um die Gebäude auszuwerten.' : 'Bereit. Bitte zuerst über «Perimeter laden» eine Datei auswählen.'); return; }
      if (!state.imported) { message('Perimeter bereit. Über «Gebäude importieren» eine Excel-Datei auswählen.'); return; }
      message('Gebäude werden im Hintergrund mit dem amtlichen GWR-Adressbestand abgeglichen …');
      const imported = state.imported, index = await addressIndex();
      if (version !== state.version) return;
      const results = [];
      for (let i = 0; i < imported.rows.length; i++) {
        if (version !== state.version) return;
        results.push(classifyAddress(imported.rows[i], imported.columns, index, state.source, state.buffer));
        if (i % 300 === 0) { message(`Gebäude werden abgeglichen: ${i} / ${imported.rows.length} …`); await pause(); }
      }
      if (version !== state.version) return;
      state.results = results; renderResults(fitView);
    } catch (error) {
      if (version === state.version) {
        clearResults();
        message(error.message || 'Der Gebäudeabgleich ist fehlgeschlagen.', true);
      }
    } finally { if (version === state.version) { state.evaluating = false; buttons(); } }
  }
  $('excel-button').addEventListener('click', () => {
    message('Bitte im Dateidialog eine Gebäude-Excel auswählen.');
    $('excel-input').click();
  });
  $('excel-input').addEventListener('change', async () => {
    const file = $('excel-input').files[0]; $('excel-input').value = '';
    if (!file || state.busy) return;
    state.busy = true; buttons(); message('Gebäude-Excel wird lokal eingelesen …');
    await pause();
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 20 * 1024 * 1024) throw new Error('Bitte eine .xlsx- oder .xls-Datei bis maximal 20 MB wählen.');
      let workbook;
      try { workbook = state.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, cellFormula: false, bookVBA: false }); }
      catch (error) { throw new Error('Excel nicht lesbar. Verschlüsselte Dateien werden nicht unterstützt.'); }
      state.imported = importWorkbook(workbook, state.XLSX);
      state.filename = file.name;
      await evaluate();
    } catch (error) { message(`Neue Datei nicht importiert: ${error.message || 'Excel konnte nicht importiert werden.'}`, true); }
    finally { state.busy = false; buttons(); }
  });
  $('export-button').addEventListener('click', () => {
    if (!state.imported || state.results === null || state.busy || state.evaluating) return;
    try {
      const data = exportRows(state.imported, state.results, 'inside');
      const workbook = state.XLSX.utils.book_new();
      const sheet = state.XLSX.utils.aoa_to_sheet([data.header, ...data.rows], { cellDates: true });
      state.XLSX.utils.book_append_sheet(workbook, sheet, 'Perimeter-Gebäude');
      state.XLSX.writeFile(workbook, 'fasnacht_perimeter_gebaeude.xlsx', { bookType: 'xlsx', compression: true });
      message(`${data.rows.length} Gebäude-Zeilen innerhalb exportiert, mit allen Originalspalten einschliesslich Kommentar.`);
    } catch (error) { message(error.message || 'Excel-Export fehlgeschlagen.', true); }
  });
  buttons();
  return {
    setPerimeter(geojson, buffer = null, fitView = true) {
      state.source = perimeterArea(geojson).area;
      state.buffer = buffer;
      return evaluate(fitView);
    },
    setLibraries(XLSX) {
      if (state.XLSX === XLSX) return;
      state.XLSX = XLSX; return evaluate();
    },
  };
}
