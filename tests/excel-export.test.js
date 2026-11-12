import { addFeedbackControls, saveFeedbackWorkbook } from '../src/excel-export.js';
import { syntheticExcelZip, syntheticWorkbookFiles } from './excel-fixtures.js';

const messages = [];
let passed = 0, failed = 0;
function assert(value, message = 'Bedingung nicht erfüllt') { if (!value) throw new Error(message); }
function test(name, callback) {
  try { callback(); passed++; messages.push(`OK  ${name}`); }
  catch (error) { failed++; messages.push(`FEHLER  ${name}: ${error.message}`); }
}
function rejects(callback) { let rejected = false; try { callback(); } catch (error) { rejected = true; } assert(rejected, 'Fehlermeldung erwartet'); }
// Read local entries independently of the production ZIP reader/writer.
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = {};
  let position = 0;
  while (view.getUint32(position, true) === 0x04034b50) {
    const size = view.getUint32(position + 18, true), length = view.getUint16(position + 26, true);
    const start = position + 30 + length + view.getUint16(position + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(position + 30, position + 30 + length));
    files[name] = new TextDecoder().decode(bytes.subarray(start, start + size)); position = start + size;
  }
  return files;
}
const header = ['Strassenname', 'Nummer', 'PLZ', 'Rückmeldung', 'Freier Zusatz'];
const book = { SheetNames: ['Innerhalb', 'Ausserhalb', 'Ungeklärt'], Sheets: {
  Innerhalb: [header, ['Kunstgasse', '01a', 4000, 'ausstehend', '  Ä & < >\n=Text  '], ['Kunstgasse', 2, 4000, 'erfolgt', false]],
  Ausserhalb: [header], 'Ungeklärt': [[...header, 'Klärungsgrund'], ['Testgasse', 9, 4000, 'ausstehend', '00001', 'Testgrund']],
} };
const ranges = [{ column: 'D', rows: 2 }, { column: 'D', rows: 0 }, { column: 'D', rows: 1 }];

test('XLSX enthält echte Dropdowns und bedingte Formatierung in allen drei Blättern', () => {
  const source = syntheticWorkbookFiles(book), bytes = addFeedbackControls(syntheticExcelZip(source), ranges), files = unzip(bytes);
  ranges.forEach((_, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`, xml = files[path], range = i === 0 ? 'D2:D3' : 'D2:D2';
    assert(xml.includes(`<conditionalFormatting sqref="${range}">`));
    assert(xml.includes('type="cellIs" dxfId="0" priority="1" operator="equal"><formula>"ausstehend"</formula>'));
    assert(xml.includes('type="cellIs" dxfId="1" priority="2" operator="equal"><formula>"erfolgt"</formula>'));
    assert(xml.includes('type="list"') && xml.includes('showDropDown="0"') && xml.includes('errorStyle="stop"'));
    assert(xml.includes('<formula1>"ausstehend,erfolgt"</formula1>'));
    assert(xml.indexOf('</conditionalFormatting>') < xml.indexOf('<dataValidations') && xml.indexOf('</dataValidations>') < xml.indexOf('<ignoredErrors>'));
    assert(xml.match(/<sheetData>[\s\S]*?<\/sheetData>/)[0] === source[path].match(/<sheetData>[\s\S]*?<\/sheetData>/)[0], 'Zellinhalte unverändert lassen');
  });
  assert(files['xl/styles.xml'].includes('<dxfs count="2">'));
  for (const color of ['FFFFC7CE', 'FF9C0006', 'FFC6EFCE', 'FF006100']) assert(files['xl/styles.xml'].includes(color));
  for (const name of Object.keys(source)) if (name !== 'xl/styles.xml' && !name.startsWith('xl/worksheets/')) assert(files[name] === source[name]);
  globalThis.syntheticFeedbackXlsx = Array.from(bytes);
});

test('Vorhandene differentielle Formate erhalten und neue Formatnummern korrekt referenzieren', () => {
  for (const replacement of ['<dxfs count="0"></dxfs>', '', '<dxfs count="1"><dxf><font><b/></font></dxf></dxfs>']) {
    const source = syntheticWorkbookFiles(book);
    source['xl/styles.xml'] = source['xl/styles.xml'].replace('<dxfs count="0"/>', replacement);
    const files = unzip(addFeedbackControls(syntheticExcelZip(source), ranges));
    const previous = replacement.includes('<b/>') ? 1 : 0;
    assert(files['xl/styles.xml'].includes(`<dxfs count="${previous + 2}">`));
    assert(files['xl/worksheets/sheet1.xml'].includes(`dxfId="${previous}"`));
    if (previous) assert(files['xl/styles.xml'].includes('<dxf><font><b/></font></dxf>'));
  }
});

test('Beschädigte, komprimierte oder unerwartete Dateien vor dem Download ablehnen', () => {
  rejects(() => addFeedbackControls(new Uint8Array(4), ranges));
  const damaged = syntheticExcelZip(syntheticWorkbookFiles(book)); damaged[50] ^= 1;
  rejects(() => addFeedbackControls(damaged, ranges));
  const compressed = syntheticExcelZip(syntheticWorkbookFiles(book)); compressed[8] = 8;
  rejects(() => addFeedbackControls(compressed, ranges));
  const missing = syntheticWorkbookFiles(book); delete missing['xl/styles.xml'];
  rejects(() => addFeedbackControls(syntheticExcelZip(missing), ranges));
  const existing = syntheticWorkbookFiles(book);
  existing['xl/worksheets/sheet1.xml'] = existing['xl/worksheets/sheet1.xml'].replace('</worksheet>', '<dataValidations count="0"/></worksheet>');
  rejects(() => addFeedbackControls(syntheticExcelZip(existing), ranges));
  rejects(() => addFeedbackControls(syntheticExcelZip(syntheticWorkbookFiles(book)), [{ column: 'D1', rows: 2 }]));
});

test('Download enthält die geprüften Regeln; bei Exportfehler keinen Download starten', () => {
  let clicked = 0, removed = 0, appended = 0, blob = null;
  const link = { click() { clicked++; }, remove() { removed++; } };
  const env = { document: { createElement: () => link, body: { append() { appended++; } } },
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options; } },
    URL: { createObjectURL(value) { blob = value; return 'blob:synthetic'; }, revokeObjectURL() {} } };
  const XLSX = { write(value, options) {
    assert(value === book && options.compression === false && options.type === 'array');
    return syntheticExcelZip(syntheticWorkbookFiles(book));
  } };
  saveFeedbackWorkbook(XLSX, book, ranges, env);
  assert(clicked === 1 && removed === 1 && appended === 1 && link.download === 'fasnacht_perimeter_gebaeude.xlsx');
  assert(unzip(blob.parts[0])['xl/worksheets/sheet1.xml'].includes('<dataValidations'));
  rejects(() => saveFeedbackWorkbook({ write: () => new Uint8Array(0) }, book, ranges, env));
  assert(clicked === 1);
});

document.getElementById('excel-export-results').textContent = [...messages, `\n${passed} erfolgreich, ${failed} fehlgeschlagen.`].join('\n');
document.documentElement.dataset.excelExportTestResult = failed ? 'failed' : 'passed';
