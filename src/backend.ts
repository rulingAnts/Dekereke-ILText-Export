import { invoke } from "@tauri-apps/api/core";

export interface ParsedData {
  columns: string[];
  rows: Record<string, string>[];
}

export interface SortKey {
  column: string;
  direction: "asc" | "desc";
}

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ── Browser helpers ──────────────────────────────────────────────────────────

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function decodeDekerekeBytes(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // UTF-16 LE BOM: FF FE
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.slice(2));
  }
  // UTF-16 BE BOM: FE FF
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.slice(2));
  }
  // UTF-8 BOM or plain UTF-8
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8").decode(buffer.slice(start));
}

function parseBrowserXml(xml: string): ParsedData {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error(parseErr.textContent ?? "XML parse error");

  const allColumns: string[] = [];
  const rows: Record<string, string>[] = [];

  for (const rowEl of Array.from(doc.documentElement.children)) {
    const row: Record<string, string> = {};
    for (const cell of Array.from(rowEl.children)) {
      const tag = cell.tagName;
      if (!allColumns.includes(tag)) allColumns.push(tag);
      const text = cell.textContent?.trim() ?? "";
      if (text) row[tag] = text;
    }
    rows.push(row);
  }

  return { columns: allColumns, rows };
}

function sortRows(
  rows: Record<string, string>[],
  sortConfig: SortKey[]
): Record<string, string>[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const key of sortConfig) {
      const av = a[key.column] ?? "";
      const bv = b[key.column] ?? "";
      const cmp = av.localeCompare(bv);
      if (cmp !== 0) return key.direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function buildOutput(
  rows: Record<string, string>[],
  columnOrder: string[],
  exportType: "flex" | "excel"
): string {
  let out = "";
  for (const row of rows) {
    for (const col of columnOrder) {
      const text = row[col]?.trim();
      if (text) {
        if (exportType === "flex") {
          out += text + "\n";
        } else {
          out += text.replace(/ /g, "\t") + "\n\n";
        }
      }
    }
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function openXmlFile(): Promise<ParsedData> {
  if (isTauri()) {
    return invoke<ParsedData>("open_xml_file");
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("No file selected"));
      try {
        const buffer = await readFileAsArrayBuffer(file);
        const xml = decodeDekerekeBytes(buffer);
        resolve(parseBrowserXml(xml));
      } catch (err) {
        reject(err);
      }
    };
    input.oncancel = () => reject(new Error("No file selected"));
    input.click();
  });
}

export interface ExportResult {
  text: string;
  summary: string;
}

export async function exportData(
  rows: Record<string, string>[],
  columnOrder: string[],
  sortConfig: SortKey[],
  exportType: "flex" | "excel"
): Promise<ExportResult> {
  if (isTauri()) {
    const summary = await invoke<string>("export_data", {
      rows,
      columnOrder,
      sortConfig,
      exportType,
    });
    // In Tauri mode the file is written to disk; also return the text for the textarea
    const sorted = sortRows(rows, sortConfig);
    const text = buildOutput(sorted, columnOrder, exportType);
    return { text, summary };
  }

  const sorted = sortRows(rows, sortConfig);
  const text = buildOutput(sorted, columnOrder, exportType);
  return { text, summary: `${sorted.length} rows ready — copy from the box below.` };
}
