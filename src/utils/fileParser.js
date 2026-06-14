import * as XLSX from "xlsx";
import Papa from "papaparse";
import { HEADER_ALIASES, normalizeHeader } from "./columnMapper";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── PDF ───────────────────────────────────────────────────────────────────────

async function extractPdfRows(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const allRawRows = [];
  const Y_TOLERANCE = 3;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const rowsByY = {};

    for (const item of textContent.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
      if (!rowsByY[y]) rowsByY[y] = [];
      rowsByY[y].push({ x: item.transform[4], text: item.str.trim() });
    }

    const sortedRows = Object.keys(rowsByY)
      .map(Number)
      .sort((a, b) => b - a)
      .map((y) =>
        rowsByY[y]
          .sort((a, b) => a.x - b.x)
          .map((c) => c.text)
      );

    allRawRows.push(...sortedRows);
  }

  return allRawRows;
}

function rawRowsToHeadersAndRows(rawRows) {
  if (rawRows.length === 0) return { headers: [], rows: [] };

  const scanLimit = Math.min(15, rawRows.length);
  let bestScore = -1;
  let bestHeaderIdx = 0;

  for (let i = 0; i < scanLimit; i++) {
    const score = scoreHeaderRow(rawRows[i]);
    if (score > bestScore) {
      bestScore = score;
      bestHeaderIdx = i;
    }
  }

  const headers = rawRows[bestHeaderIdx].map((h) => String(h).trim()).filter(Boolean);
  const rows = [];

  for (let i = bestHeaderIdx + 1; i < rawRows.length; i++) {
    const rowArr = rawRows[i];
    if (rowArr.every((cell) => cell === "" || cell == null)) continue;
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = rowArr[idx] !== undefined ? rowArr[idx] : "";
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

async function parsePdf(file) {
  const ab = await file.arrayBuffer();
  const buffer = new Uint8Array(ab);
  const rawRows = await extractPdfRows(buffer);

  if (rawRows.length === 0) {
    return { headers: [], rows: [], sheetName: "PDF" };
  }

  const { headers, rows } = rawRowsToHeadersAndRows(rawRows);
  return { headers, rows, sheetName: "PDF" };
}

// ── Shared ────────────────────────────────────────────────────────────────────

function scoreHeaderRow(rowArr) {
  const allAliases = Object.values(HEADER_ALIASES).flat();
  let score = 0;
  for (const cell of rowArr) {
    const normalized = normalizeHeader(String(cell));
    if (normalized && allAliases.includes(normalized)) score++;
  }
  return score;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

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

// ── Excel ─────────────────────────────────────────────────────────────────────

async function parseExcel(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  if (workbook.SheetNames.length === 0) {
    return { headers: [], rows: [], sheetName: null };
  }

  let bestSheetName = workbook.SheetNames[0];
  let bestScore = -1;
  let bestHeaderRowIndex = 0;
  let bestRawRows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rawRows.length === 0) continue;

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

  if (bestRawRows.length === 0) {
    return { headers: [], rows: [], sheetName: bestSheetName };
  }

  const headers = bestRawRows[bestHeaderRowIndex]
    .map((h) => String(h).trim())
    .filter(Boolean);

  const rows = [];
  for (let i = bestHeaderRowIndex + 1; i < bestRawRows.length; i++) {
    const rowArr = bestRawRows[i];
    if (rowArr.every((cell) => cell === "" || cell === null || cell === undefined)) continue;
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = rowArr[idx] !== undefined ? rowArr[idx] : "";
    });
    rows.push(rowObj);
  }

  return { headers, rows, sheetName: bestSheetName };
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

export async function parseFileToRows(file) {
  const ext = file.name
    ? file.name.split(".").pop().toLowerCase()
    : (file.path || "").split(".").pop().toLowerCase();

  if (ext === "csv")                   return parseCsv(file);
  if (ext === "xlsx" || ext === "xls") return parseExcel(file);
  if (ext === "pdf")                   return parsePdf(file);
  throw new Error(`Unsupported file type for row parsing: ${ext}`);
}