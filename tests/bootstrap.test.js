import { initializeApplication } from '../src/bootstrap.js';

const messages = [];
let passed = 0, failed = 0;
function assert(value, message = 'Bedingung nicht erfüllt') { if (!value) throw new Error(message); }
async function test(name, callback) {
  try { await callback(); passed++; messages.push(`OK  ${name}`); }
  catch (error) { failed++; messages.push(`FEHLER  ${name}: ${error.message}`); }
}
function environment(mode) {
  const nodes = {
    'analysis-status': { textContent: '', classList: { add() {} } },
    'library-status': { textContent: '', classList: { add() {} } },
  };
  const scope = {}, modules = [], scripts = [], libraries = [];
  Object.defineProperty(scope, 'turf', { get() { throw new Error('Turf darf nicht gelesen werden'); } });
  let starts = 0;
  const viewer = { analysis: { setLibraries(xlsx) { libraries.push(xlsx); } } };
  const document = { getElementById: id => nodes[id], createElement: tag => ({ tag, remove() {} }),
    head: { append(element) {
      const url = element.src || element.href;
      scripts.push(url);
      if (url.includes('turf') || url.includes('cdn.jsdelivr.net')) throw new Error('Unnötige GIS-Bibliothek angefordert');
      if (url.includes('leaflet.js')) scope.L = {};
      if (url.includes('xlsx.full') && mode !== 'no-excel') scope.XLSX = { read() {}, utils: { sheet_to_json() {} } };
      Promise.resolve().then(() => element.onload());
    } } };
  async function loadModule(url) {
    modules.push(url);
    if (url !== './app.js') throw new Error('Unerwartetes Modul angefordert');
    if (mode === 'missing-app') throw new Error('synthetischer Modulfehler HTTP 404');
    if (mode === 'old-app') return {};
    return { startViewer() {
      starts++;
      if (mode === 'broken-viewer') throw new Error('synthetischer Kartenfehler');
      return viewer;
    } };
  }
  return { nodes, scope, modules, scripts, libraries, viewer, starts: () => starts,
    initialize: () => initializeApplication({ document, scope, loadModule }) };
}
await test('Start benötigt nur Karte und Excel, kein Turf und kein eval', async () => {
  const env = environment('local'), result = await env.initialize();
  assert(!result.failed && result.viewer === env.viewer && env.starts() === 1);
  assert(env.modules.join(',') === './app.js');
  assert(env.libraries.some(xlsx => xlsx === env.scope.XLSX));
  assert(env.scripts.every(url => !url.includes('turf') && !url.includes('cdn.jsdelivr.net')));
});
await test('Fehlendes Anwendungsmodul meldet den Fehler über der Karte', async () => {
  const env = environment('missing-app'), result = await env.initialize();
  assert(result.failed && result.viewer === null && env.scripts.length === 0);
  assert(env.nodes['analysis-status'].textContent.includes('HTTP 404'));
});
await test('Ungültigen Anwendungsexport verständlich ablehnen', async () => {
  const env = environment('old-app'), result = await env.initialize();
  assert(result.failed && env.scripts.length === 0);
  assert(env.nodes['analysis-status'].textContent.includes('unterschiedliche Versionen'));
});
await test('Excel-Ladefehler sichtbar melden; Karte kann trotzdem starten', async () => {
  const env = environment('no-excel'), result = await env.initialize();
  assert(result.failed && result.viewer === env.viewer);
  assert(env.nodes['analysis-status'].textContent.includes('SheetJS'));
  assert(env.libraries.length === 0);
});
await test('Kartenstartfehler sichtbar behandeln', async () => {
  const env = environment('broken-viewer'), result = await env.initialize();
  assert(result.failed && env.nodes['analysis-status'].textContent.includes('synthetischer Kartenfehler'));
});
document.getElementById('bootstrap-results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');
document.documentElement.dataset.bootstrapTestResult = failed ? 'failed' : 'passed';
