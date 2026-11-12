// Keep this entry point free of static imports so dependency failures reach the UI.
export async function initializeApplication({ document, scope, loadModule }) {
  const libraryStatus = document.getElementById('library-status');
  const analysisStatus = document.getElementById('analysis-status');
  let leafletReady = false, sheetjsReady = false, viewer = null;
  let startViewer;

  function failure(text) {
    libraryStatus.classList.add('error');
    libraryStatus.textContent = text;
    analysisStatus.classList.add('error');
    analysisStatus.hidden = false;
    analysisStatus.textContent = text;
  }

  analysisStatus.textContent = ''; analysisStatus.hidden = true;
  try {
    startViewer = (await loadModule('./app.js')).startViewer;
    if (typeof startViewer !== 'function') {
      throw new Error('Die Anwendungsdateien haben unterschiedliche Versionen.');
    }
  } catch (error) {
    failure(`Anwendung konnte nicht gestartet werden: ${error.message}. Den lokalen Server neu starten und die Seite mit Strg+F5 laden.`);
    return { viewer: null, failed: true };
  }

  function script(url, integrity) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      const timeout = setTimeout(() => {
        element.remove(); reject(new Error('Bibliothek nicht rechtzeitig geladen.'));
      }, 15000);
      if (integrity) { element.integrity = integrity; element.crossOrigin = 'anonymous'; }
      element.onload = () => { clearTimeout(timeout); resolve(); };
      element.onerror = () => { clearTimeout(timeout); element.remove(); reject(new Error('Bibliothek nicht erreichbar.')); };
      element.src = url; document.head.append(element);
    });
  }
  function stylesheet(url, integrity) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('link'); element.rel = 'stylesheet';
      const timeout = setTimeout(() => {
        element.remove(); reject(new Error('Stylesheet nicht rechtzeitig geladen.'));
      }, 15000);
      if (integrity) { element.integrity = integrity; element.crossOrigin = 'anonymous'; }
      element.onload = () => { clearTimeout(timeout); resolve(); };
      element.onerror = () => { clearTimeout(timeout); element.remove(); reject(new Error('Stylesheet nicht erreichbar.')); };
      element.href = url; document.head.append(element);
    });
  }
  function synchronize() {
    if (leafletReady && !viewer) viewer = startViewer(scope.L);
    if (viewer && sheetjsReady) viewer.analysis.setLibraries(scope.XLSX);
  }
  async function leaflet() {
    const local = await Promise.allSettled([
      stylesheet('vendor/leaflet/leaflet.css'), script('vendor/leaflet/leaflet.js'),
    ]);
    if (local.some(result => result.status === 'rejected') || !scope.L) {
      await Promise.all([
        stylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='),
        script('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='),
      ]);
    }
    if (!scope.L) throw new Error('Leaflet fehlt.');
    leafletReady = true; synchronize();
  }
  async function sheetjs() {
    function validate() {
      if (!scope.XLSX || typeof scope.XLSX.read !== 'function' || !scope.XLSX.utils
        || typeof scope.XLSX.utils.sheet_to_json !== 'function') throw new Error('SheetJS wurde nicht vollständig geladen.');
    }
    try { await script('vendor/sheetjs/xlsx.full.min.js'); validate(); }
    catch (error) { await script('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'); validate(); }
    sheetjsReady = true; synchronize();
  }
  const results = await Promise.allSettled([leaflet(), sheetjs()]);
  const failed = results.some(result => result.status === 'rejected');
  if (failed) {
    const names = ['Leaflet', 'SheetJS (Excel)'];
    failure(results.flatMap((result, i) => result.status === 'rejected'
      ? [`${names[i]}: ${result.reason.message}`] : []).join(' ')
      + ' Internetzugang zu unpkg.com und cdn.sheetjs.com prüfen.');
  } else libraryStatus.textContent = '';
  return { viewer, failed };
}

// The synthetic test page has no map and never starts the real application.
if (typeof document !== 'undefined' && document.getElementById('map')) {
  initializeApplication({ document, scope: window, loadModule: url => import(url) });
}
