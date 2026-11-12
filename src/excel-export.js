// Add standard OOXML controls to a freshly generated, uncompressed SheetJS XLSX.
// Unsupported ZIP/XML layouts fail before download instead of losing the rules.
const excelEncoder = new TextEncoder(), excelDecoder = new TextDecoder('utf-8', { fatal: true });
const excelCrcTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function excelCrc(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = excelCrcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function readExcelZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw new Error('Excel-Export: unerwartetes ZIP-Format. Keine Datei erstellt.'); };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end < bytes.length - 65557 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || end + 22 + view.getUint16(end + 20, true) !== bytes.length) invalid();
  const count = view.getUint16(end + 10, true), entries = new Map();
  let offset = view.getUint32(end + 16, true);
  const centralEnd = offset + view.getUint32(end + 12, true);
  if (centralEnd !== end || count !== view.getUint16(end + 8, true)) invalid();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) invalid();
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true), expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true), next = offset + 46 + nameLength + extra + comment;
    if (next > centralEnd || method !== 0 || flags & 1 || size !== expanded || local + 30 > view.getUint32(end + 16, true)
      || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== 0) invalid();
    const name = excelDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > view.getUint32(end + 16, true) || entries.has(name)) invalid();
    const data = bytes.slice(start, start + size);
    if (excelCrc(data) !== view.getUint32(offset + 16, true)) invalid();
    entries.set(name, data); offset = next;
  }
  if (offset !== centralEnd) invalid();
  return entries;
}
function writeExcelZip(entries) {
  const locals = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const [name, data] of entries) {
    const filename = excelEncoder.encode(name), crc = excelCrc(data);
    const local = new Uint8Array(30 + filename.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint16(12, 0x21, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, filename.length, true);
    local.set(filename, 30); locals.push(local, data);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, filename.length, true);
    cv.setUint32(42, offset, true); central.set(filename, 46); directory.push(central);
    offset += local.length + data.length; directorySize += central.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.size, true); ev.setUint16(10, entries.size, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + end.length);
  let position = 0;
  for (const part of [...locals, ...directory, end]) { output.set(part, position); position += part.length; }
  return output;
}
export function addFeedbackControls(bytes, ranges) {
  const entries = readExcelZip(bytes);
  const get = name => {
    if (!entries.has(name)) throw new Error(`Excel-Export: ${name} fehlt. Keine Datei erstellt.`);
    return excelDecoder.decode(entries.get(name));
  };
  let styles = get('xl/styles.xml');
  if (!/<styleSheet\b/.test(styles) || !styles.includes('</styleSheet>')) throw new Error('Excel-Formatvorlagen nicht unterstützt.');
  const fonts = styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/);
  const cellFormats = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const fontList = fonts ? fonts[1].match(/<font\b[^>]*>[\s\S]*?<\/font>/g) : null;
  const formatList = cellFormats ? cellFormats[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g) : null;
  if (!fontList || !formatList) throw new Error('Excel-Kopfzeilenformat nicht unterstützt.');
  const boldFont = fontList[0].replace(/<b\b[^>]*(?:\/>|>[\s\S]*?<\/b>)/g, '').replace('</font>', '<b/></font>');
  const headerStyle = formatList.length;
  const boldStyle = formatList[0].replace(/^<xf\b[^>]*>/, tag => tag.replace(/\s(?:fontId|applyFont)="[^"]*"/g, '')
    .replace(/\/?>$/, end => ` fontId="${fontList.length}" applyFont="1"${end}`));
  styles = styles.replace(fonts[0], `<fonts count="${fontList.length + 1}">${fonts[1]}${boldFont}</fonts>`)
    .replace(cellFormats[0], `<cellXfs count="${headerStyle + 1}">${cellFormats[1]}${boldStyle}</cellXfs>`);
  const existing = styles.match(/<dxfs\b[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/);
  const oldFormats = existing ? (existing[0].match(/<dxf\b/g) || []).length : 0;
  // Differential fills use the background colour; normal cell fills use fgColor.
  const format = fill => `<dxf><font><color rgb="FF000000"/></font><fill><patternFill><bgColor rgb="${fill}"/></patternFill></fill></dxf>`;
  const newFormats = format('FFFFC7CE') + format('FFC6EFCE');
  const contents = existing && !existing[0].endsWith('/>') ? existing[0].replace(/^<dxfs\b[^>]*>|<\/dxfs>$/g, '') : '';
  const dxfs = `<dxfs count="${oldFormats + 2}">${contents}${newFormats}</dxfs>`;
  styles = existing ? styles.replace(existing[0], dxfs) : styles.replace(/<(?:tableStyles|colors|extLst)\b|<\/styleSheet>/, match => dxfs + match);
  entries.set('xl/styles.xml', excelEncoder.encode(styles));
  ranges.forEach(({ column, rows }, i) => {
    if (!/^[A-Z]+$/.test(column) || !Number.isInteger(rows) || rows < 0 || rows > 1048575) throw new Error('Ungültiger Rückmeldungsbereich.');
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    let xml = get(path);
    if (!/<worksheet\b/.test(xml) || !xml.includes('</sheetData>') && !xml.includes('<sheetData/>')
      || /<(?:conditionalFormatting|dataValidations)\b/.test(xml)) throw new Error('Excel-Tabellenformat für Rückmeldungen nicht unterstützt.');
    const headerRow = /<row\b(?=[^>]*\br="1")[^>]*>[\s\S]*?<\/row>/;
    if (!headerRow.test(xml)) throw new Error('Excel-Kopfzeile fehlt.');
    xml = xml.replace(headerRow, row => row.replace(/^<row\b[^>]*>/, tag => tag.replace(/\s(?:s|customFormat)="[^"]*"/g, '')
      .replace(/>$/, ` s="${headerStyle}" customFormat="1">`))
      .replace(/<c\b[^>]*>/g, tag => tag.replace(/\ss="[^"]*"/g, '').replace(/\/?>$/, end => ` s="${headerStyle}"${end}`)));
    const range = `${column}2:${column}${Math.max(2, rows + 1)}`;
    const rules = `<conditionalFormatting sqref="${range}"><cfRule type="expression" dxfId="${oldFormats}" priority="1" stopIfTrue="1"><formula>LOWER(TRIM($${column}2))="ausstehend"</formula></cfRule><cfRule type="expression" dxfId="${oldFormats + 1}" priority="2" stopIfTrue="1"><formula>LOWER(TRIM($${column}2))="erfolgt"</formula></cfRule></conditionalFormatting>`
      + `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showDropDown="0" showErrorMessage="1" errorStyle="stop" errorTitle="Ungültige Rückmeldung" error="Bitte ausstehend oder erfolgt auswählen." sqref="${range}"><formula1>"ausstehend,erfolgt"</formula1></dataValidation></dataValidations>`;
    const tail = /<(?:hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/;
    if (!tail.test(xml)) throw new Error('Excel-Tabellenabschluss fehlt.');
    xml = xml.replace(tail, match => rules + match);
    entries.set(path, excelEncoder.encode(xml));
  });
  return writeExcelZip(entries);
}

export function saveFeedbackWorkbook(XLSX, workbook, ranges, environment = globalThis) {
  const bytes = addFeedbackControls(XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: false }), ranges);
  const url = environment.URL.createObjectURL(new environment.Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = environment.document.createElement('a');
  link.href = url; link.download = 'fasnacht_perimeter_gebaeude.xlsx';
  try { environment.document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => environment.URL.revokeObjectURL(url), 1000); }
}
