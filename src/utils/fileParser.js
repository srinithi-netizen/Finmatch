import * as XLSX from "xlsx";
import Papa from "papaparse";
import { HEADER_ALIASES, normalizeHeader } from "./columnMapper";

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

// Scores a candidate header row by counting how many cells match known aliases
// In fileParser.js, update scoreHeaderRow to use the full alias list
function scoreHeaderRow(rowArr) {
  const allAliases = Object.values(HEADER_ALIASES).flat();
  let score = 0;
  for (const cell of rowArr) {
    const normalized = normalizeHeader(String(cell));
    if (normalized && allAliases.includes(normalized)) score++;
  }
  return score;
}

async function parseExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  if (workbook.SheetNames.length === 0) {
    return { headers: [], rows: [], sheetName: null };
  }

  // ── Score every sheet, pick the one with most recognized headers ──
  let bestSheetName = workbook.SheetNames[0];
  let bestScore = -1;
  let bestHeaderRowIndex = 0;
  let bestRawRows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (rawRows.length === 0) continue;

    // Scan first 15 rows of this sheet for a header row
    const scanLimit = Math.min(15, rawRows.length);
    let sheetBestScore = -1;
    let sheetBestHeaderIdx = 0;

    for (let i = 0; i < scanLimit; i++) {
      const score = scoreHeaderRow(rawRows[i]);
      if (score > sheetBestScore) {
        sheetBestScore = score;
        sheetBestHeaderIdx = i;
      }
    }

    if (sheetBestScore > bestScore) {
      bestScore = sheetBestScore;
      bestSheetName = sheetName;
      bestHeaderRowIndex = sheetBestHeaderIdx;
      bestRawRows = rawRows;
    }
  }

  // ── Parse the best sheet from its detected header row ──
  if (bestRawRows.length === 0) {
    return { headers: [], rows: [], sheetName: bestSheetName };
  }

  const headers = bestRawRows[bestHeaderRowIndex]
    .map((h) => String(h).trim())
    .filter(Boolean);

  const rows = [];
  for (let i = bestHeaderRowIndex + 1; i < bestRawRows.length; i++) {
    const rowArr = bestRawRows[i];
    if (rowArr.every((cell) => cell === "" || cell === null || cell === undefined)) {
      continue;
    }
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = rowArr[idx] !== undefined ? rowArr[idx] : "";
    });
    rows.push(rowObj);
  }

  return { headers, rows, sheetName: bestSheetName };
}