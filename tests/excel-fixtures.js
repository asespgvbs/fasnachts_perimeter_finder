// Entirely synthetic OOXML and ZIP fixtures; no SheetJS, files or network.
export function syntheticExcelZip(files) {
  const encode = value => new TextEncoder().encode(value), output = [], directory = [];
  const u16 = (out, value) => out.push(value & 255, value >>> 8 & 255);
  const u32 = (out, value) => { u16(out, value); u16(out, value >>> 16); };
  for (const [name, content] of Object.entries(files)) {
    const bytes = typeof content === 'string' ? encode(content) : content, filename = encode(name), start = output.length;
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ -1) >>> 0;
    u32(output, 0x04034b50); u16(output, 20); u16(output, 0); u16(output, 0); u16(output, 0); u16(output, 33);
    u32(output, crc); u32(output, bytes.length); u32(output, bytes.length); u16(output, filename.length); u16(output, 0);
    for (const byte of filename) output.push(byte);
    for (const byte of bytes) output.push(byte);
    u32(directory, 0x02014b50); u16(directory, 20); u16(directory, 20); u16(directory, 0); u16(directory, 0); u16(directory, 0); u16(directory, 33);
    u32(directory, crc); u32(directory, bytes.length); u32(directory, bytes.length); u16(directory, filename.length);
    for (let i = 0; i < 4; i++) u16(directory, 0);
    u32(directory, 0); u32(directory, start);
    for (const byte of filename) directory.push(byte);
  }
  const end = [], offset = output.length, count = Object.keys(files).length;
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, count); u16(end, count);
  u32(end, directory.length); u32(end, offset); u16(end, 0);
  return new Uint8Array([...output, ...directory, ...end]);
}

export function syntheticWorkbookFiles(book) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relns = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const files = {
    '_rels/.rels': `<Relationships xmlns="${relns}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${ns}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><dxfs count="0"/><tableStyles count="0"/></styleSheet>`,
  };
  const types = [], sheets = [], relationships = [];
  book.SheetNames.forEach((name, i) => {
    const id = i + 1;
    types.push(`<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    sheets.push(`<sheet name="${escape(name)}" sheetId="${id}" r:id="rId${id}"/>`);
    relationships.push(`<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${id}.xml"/>`);
    const rows = book.Sheets[name].map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      if (value == null) return '';
      let column = '', index = c + 1;
      while (index) { index--; column = String.fromCharCode(65 + index % 26) + column; index = Math.floor(index / 26); }
      const ref = `${column}${r + 1}`;
      return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>`
        : typeof value === 'boolean' ? `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${id}.xml`] = `<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData><ignoredErrors><ignoredError sqref="A1" numberStoredAsText="1"/></ignoredErrors></worksheet>`;
  });
  relationships.push('<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
  files['xl/workbook.xml'] = `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<Relationships xmlns="${relns}">${relationships.join('')}</Relationships>`;
  files['[Content_Types].xml'] = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${types.join('')}</Types>`;
  return files;
}

export function syntheticWorkbookBytes(book) { return syntheticExcelZip(syntheticWorkbookFiles(book)); }
