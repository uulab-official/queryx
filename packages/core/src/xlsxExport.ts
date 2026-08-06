import type { QueryColumn } from "@queryx/shared";

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

interface XlsxCell {
  type?: "b" | "inlineStr";
  value?: string;
  text?: string;
}

const xlsxMimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function serializeRowsToXlsx(
  columns: readonly QueryColumn[],
  rows: readonly Record<string, unknown>[],
): Uint8Array {
  const worksheetRows = [
    columns.map((column) => ({
      type: "inlineStr" as const,
      text: column.name,
    })),
    ...rows.map((row) => columns.map((column) => cellValue(row[column.name]))),
  ];
  const sheetData = worksheetRows
    .map(
      (cells, rowIndex) =>
        `<row r="${rowIndex + 1}">${cells
          .map((cell, columnIndex) =>
            cellXml(cell, `${columnLetters(columnIndex)}${rowIndex + 1}`),
          )
          .join("")}</row>`,
    )
    .join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`;
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: encodeXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: encodeXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: encodeXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="QueryX Results" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encodeXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/styles.xml",
      data: encodeXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: encodeXml(worksheet) },
  ];
  return zipStore(entries);
}

export const xlsxContentType = xlsxMimeType;

function cellValue(value: unknown): XlsxCell {
  if (typeof value === "boolean") {
    return { type: "b", value: value ? "1" : "0" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value: String(value) };
  }
  if (value === null || value === undefined) return {};
  if (value instanceof Date) {
    return { type: "inlineStr", text: value.toISOString() };
  }
  if (typeof value === "object") {
    try {
      return { type: "inlineStr", text: JSON.stringify(value) };
    } catch {
      return { type: "inlineStr", text: String(value) };
    }
  }
  return { type: "inlineStr", text: String(value) };
}

function cellXml(cell: XlsxCell, reference: string): string {
  if (cell.text !== undefined) {
    const preserve = /^\s|\s$/.test(cell.text) ? ` xml:space="preserve"` : "";
    return `<c r="${reference}" t="inlineStr"><is><t${preserve}>${xmlEscape(cell.text)}</t></is></c>`;
  }
  if (cell.value === undefined) return `<c r="${reference}"/>`;
  return `<c r="${reference}"${cell.type ? ` t="${cell.type}"` : ""}><v>${xmlEscape(cell.value)}</v></c>`;
}

function columnLetters(index: number): string {
  let current = index + 1;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function encodeXml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encodeXml(entry.name);
    const crc = crc32(entry.data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    localParts.push(local);
    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = concatBytes(centralParts);
  const locals = concatBytes(localParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(locals.length),
    u16(0),
  ]);
  return concatBytes([locals, central, end]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((size, part) => size + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
