import * as XLSX from "xlsx";
import Papa from "papaparse";

/**
 * Parses a File (CSV or XLSX) into { headers: string[], rows: object[] }
 * Each row object is keyed by the original header string.
 */
export async function parseFileToRows(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "csv") {
    return parseCsv(file);
  }

  if (ext === "xlsx" || ext === "xls") {
    return parseExcel(file);
  }

  if (ext === "pdf") {
    // PDFs are not row-parseable in browser without OCR/text extraction.
    // Return null to signal: skip row-validation, only file-level checks apply.
    return null;
  }

  throw new Error(`Unsupported file type for row parsing: ${ext}`);
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields || [];
        resolve({ headers, rows: results.data });
      },
      error: (err) => reject(err),
    });
  });
}

async function parseExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  // Get raw 2D array first to extract headers
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rawRows[0].map((h) => String(h).trim());

  // Convert remaining rows to objects keyed by header
  const rows = [];
  for (let i = 1; i < rawRows.length; i++) {
    const rowArr = rawRows[i];
    // Skip fully empty rows
    if (rowArr.every((cell) => cell === "" || cell === null || cell === undefined)) {
      continue;
    }
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = rowArr[idx] !== undefined ? rowArr[idx] : "";
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}