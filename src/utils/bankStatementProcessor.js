import * as XLSX from "xlsx";
import Papa from "papaparse";
import { convertToINR } from "./currencyUtils";

const CURRENCY_ALIASES = ["currency", "curr", "ccy"];

// ─── Ref number patterns ───────────────────────────────────────────────────────
const REF_PATTERNS = [
  /\b(INV-\d+)\b/i,
  /\b(PAY-\d+)\b/i,
  /\b(EMP-\d+)\b/i,
  /\b(ORD-\d+)\b/i,
  /\b(TXN-\d+)\b/i,
  /\b(NEFT[\/\-]?\w{6,20})\b/i,
  /\b(IMPS[\/\-]?\w{6,20})\b/i,
  /\b(RTGS[\/\-]?\w{6,20})\b/i,
  /\b(UPI[\/\-]?\w{6,20})\b/i,
  /\b(CHQ[\/\-\s]?\d{4,9})\b/i,
  /\b(REF[\/\-\s]?\w{4,20})\b/i,
  /\b(\d{10,20})\b/,
];

// ─── Amount parsing ────────────────────────────────────────────────────────────
function parseAmount(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  let str = String(val).trim();
  let negative = false;
  if (str.startsWith("(") && str.endsWith(")")) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str.replace(/[$,€£₹\s]/g, "");
  if (str === "" || isNaN(Number(str))) return null;
  const n = Number(str);
  return negative ? -Math.abs(n) : n;
}

// ─── Date normalization ────────────────────────────────────────────────────────
function normalizeDate(val) {
  if (!val && val !== 0) return null;

  if (typeof val === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + val * 86400000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }

  const str = String(val).trim();

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;

  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    const d = new Date(Date.UTC(Number(y), Number(b) - 1, Number(a)));
    if (!isNaN(d.getTime()) && d.getUTCMonth() === Number(b) - 1) {
      return `${y}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
    }
  }

  m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mo = months[m[2].toLowerCase()];
    if (mo) {
      let yr = Number(m[3]);
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      return `${yr}-${String(mo).padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    }
  }

  return null;
}

// ─── Description normalization ─────────────────────────────────────────────────
function normalizeDescription(desc) {
  if (!desc) return "";
  return String(desc)
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "")
    .trim();
}

function normalizeDescriptionForFingerprint(desc) {
  return normalizeDescription(desc)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Ref number extraction ─────────────────────────────────────────────────────
function extractRefNumber(description) {
  if (!description) return null;
  const str = String(description);
  for (const pattern of REF_PATTERNS) {
    const match = str.match(pattern);
    if (match) return match[1].toUpperCase().replace(/\s/g, "");
  }
  return null;
}

// ─── SHA-256 fingerprint ───────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildFingerprint(txnDate, amount, refNumber, descNorm, direction) {
  const parts = [
    txnDate || "",
    amount !== null ? String(amount) : "",
    refNumber || "",
    descNorm ? descNorm.slice(0, 100) : "",
    direction || "",
  ];
  return sha256(parts.join("|"));
}

// ─── Header aliases ────────────────────────────────────────────────────────────
const DATE_ALIASES      = ["date", "txn date", "transaction date", "value date", "posting date", "entry date"];
const DESC_ALIASES      = ["description", "particulars", "narration", "details", "remarks", "transaction details", "note"];
const DEBIT_ALIASES     = ["debit", "withdrawal", "dr", "debit amount", "debit (₹)", "debit(₹)"];
const CREDIT_ALIASES    = ["credit", "deposit", "cr", "credit amount", "credit (₹)", "credit(₹)"];
const BALANCE_ALIASES   = ["balance", "running balance", "closing balance", "balance (₹)", "balance(₹)"];
const AMOUNT_ALIASES    = ["amount", "amt", "value", "transaction amount", "amount (₹)"];
const REF_ALIASES       = ["ref", "ref no", "reference", "reference number", "chq no", "cheque no", "transaction id", "txn id", "utr"];
const VALUEDATE_ALIASES = ["value date", "val date"];

function normalizeH(h) {
  return String(h).trim().toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\(（][^)）]*[\)）]/g, "")
    .replace(/[₹$€£]/g, "")
    .trim();
}

function findColumn(headers, aliases) {
  return headers.find((h) => aliases.includes(normalizeH(h))) || null;
}

function scoreRow(rowArr) {
  const allAliases = [
    ...DATE_ALIASES, ...DESC_ALIASES, ...DEBIT_ALIASES,
    ...CREDIT_ALIASES, ...BALANCE_ALIASES, ...AMOUNT_ALIASES, ...REF_ALIASES,
  ];
  return rowArr.filter((c) => allAliases.includes(normalizeH(String(c)))).length;
}

// ─── getRawRows — CSV / XLSX / PDF → string[][] ────────────────────────────────
function parseCsvRaw(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (r) => resolve(r.data.map((row) => row.map((c) => String(c)))),
      error:   (e) => reject(e),
    });
  });
}

async function parseExcelRaw(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  if (!wb.SheetNames.length) return [];
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

async function getRawRows(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "csv")                   return parseCsvRaw(file);
  if (ext === "xlsx" || ext === "xls") return parseExcelRaw(file);

  if (ext === "pdf") {
    // Import fileParser which handles pdfjs-dist (browser-safe)
    const { parseFileToRows } = await import("./fileParser.js");
    const { headers, rows } = await parseFileToRows(file);
    // Convert object[] back to string[][] so the rest of this processor works unchanged
    return [
      headers,
      ...rows.map((r) => headers.map((h) => String(r[h] ?? ""))),
    ];
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

// ─── Main export ───────────────────────────────────────────────────────────────
export async function processBankStatement(file, clientId, documentRecordId, uploadBatchId) {
  const rawRows = await getRawRows(file);
  const warnings = [];

  const scanLimit = Math.min(20, rawRows.length);
  let headerRowIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    const s = scoreRow(rawRows[i].map(String));
    if (s > bestScore) { bestScore = s; headerRowIdx = i; }
  }

  if (bestScore === 0) {
    warnings.push("Could not confidently detect header row. Using row 1 as fallback.");
    headerRowIdx = 0;
  }

  const headers = rawRows[headerRowIdx].map(String);

  const colDate      = findColumn(headers, DATE_ALIASES);
  const colDesc      = findColumn(headers, DESC_ALIASES);
  const colDebit     = findColumn(headers, DEBIT_ALIASES);
  const colCredit    = findColumn(headers, CREDIT_ALIASES);
  const colBalance   = findColumn(headers, BALANCE_ALIASES);
  const colAmount    = findColumn(headers, AMOUNT_ALIASES);
  const colRef       = findColumn(headers, REF_ALIASES);
  const colValueDate = findColumn(headers, VALUEDATE_ALIASES);

  if (!colDate)  warnings.push("Date column not detected.");
  if (!colDesc)  warnings.push("Description column not detected.");
  if (!colDebit && !colCredit && !colAmount) warnings.push("No amount/debit/credit columns detected.");

  const transactions = [];
  const seenFingerprints = new Map();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;

    const r = {};
    headers.forEach((h, idx) => { r[h] = row[idx] !== undefined ? row[idx] : ""; });

    const rawDate    = colDate      ? r[colDate]      : null;
    const rawDesc    = colDesc      ? r[colDesc]      : null;
    const rawDebit   = colDebit     ? r[colDebit]     : null;
    const rawCredit  = colCredit    ? r[colCredit]    : null;
    const rawBalance = colBalance   ? r[colBalance]   : null;
    const rawAmount  = colAmount    ? r[colAmount]    : null;
    const rawRef     = colRef       ? r[colRef]       : null;
    const rawValDate = colValueDate ? r[colValueDate] : null;

    const hasDate   = rawDate !== null && String(rawDate).trim() !== "";
    const hasAmount = (rawDebit  !== null && String(rawDebit).trim()  !== "") ||
                      (rawCredit !== null && String(rawCredit).trim() !== "") ||
                      (rawAmount !== null && String(rawAmount).trim() !== "");
    if (!hasDate && !hasAmount) continue;

    const txnDate   = normalizeDate(rawDate);
    const valueDate = rawValDate ? normalizeDate(rawValDate) : null;
    const desc      = normalizeDescription(rawDesc);
    const descNorm  = normalizeDescriptionForFingerprint(rawDesc);

    let debit     = parseAmount(rawDebit);
    let credit    = parseAmount(rawCredit);
    let balance   = parseAmount(rawBalance);
    let amount    = null;
    let direction = "UNKNOWN";

    if (colDebit || colCredit) {
      debit  = debit  !== null && debit  > 0 ? debit  : null;
      credit = credit !== null && credit > 0 ? credit : null;
      if (debit !== null && credit === null) { amount = debit;  direction = "DR"; }
      if (credit !== null && debit === null) { amount = credit; direction = "CR"; }
      if (debit !== null && credit !== null) {
        amount    = Math.max(debit, credit);
        direction = "DR";
        warnings.push(`Row ${i + 1}: Both debit and credit populated. Check manually.`);
      }
      if (debit === null && credit === null) {
        amount    = parseAmount(rawAmount);
        direction = amount !== null ? (amount < 0 ? "DR" : "CR") : "UNKNOWN";
        if (amount !== null) amount = Math.abs(amount);
      }
    } else if (rawAmount !== null) {
      const raw = parseAmount(rawAmount);
      amount    = raw !== null ? Math.abs(raw) : null;
      direction = raw !== null ? (raw < 0 ? "DR" : "CR") : "UNKNOWN";
    }

    const refFromCol  = rawRef ? String(rawRef).trim().replace(/\s+/g, "") : null;
    const refFromDesc = extractRefNumber(desc);
    const refNumber   = refFromCol && refFromCol !== "" ? refFromCol.toUpperCase() : refFromDesc;

    if (amount === null || amount === 0) {
      warnings.push(`Row ${i + 1}: Skipped — no valid amount found.`);
      continue;
    }

    const fingerprint         = await buildFingerprint(txnDate, amount, refNumber, descNorm, direction);
    const isDuplicate         = seenFingerprints.has(fingerprint);
    const duplicateOfFingerprint = isDuplicate ? fingerprint : null;
    if (!isDuplicate) seenFingerprints.set(fingerprint, i + 1);
    const colCurrency = findColumn(headers, CURRENCY_ALIASES);
    const rawCurrency = colCurrency ? r[colCurrency] : null;
    const currency    = rawCurrency ? String(rawCurrency).trim().toUpperCase() : "INR";
    const fx = await convertToINR(amount, currency, txnDate);

    transactions.push({
      clientId,
      documentRecordId,
      uploadBatchId,
      fingerprint,
      txnDate:               txnDate   || "",
      valueDate:             valueDate || "",
      description:           desc,
      descriptionNormalized: descNorm,
      refNumber:             refNumber || "",
      debit:                 debit   !== null ? debit   : 0,
      credit:                credit  !== null ? credit  : 0,
      balance:               balance !== null ? balance : 0,
      direction,
      amount,
      currency:              currency,
      originalAmount:        fx.originalAmount,
      originalCurrency:      fx.originalCurrency,
      exchangeRate:          fx.exchangeRate,
      exchangeRateDate:      fx.rateDate,
      amountINR:             fx.amountINR,
      bankRowIndex:          i + 1,
      matchStatus:           "unmatched",
      matchedDocumentId:     "",
      reconciliationStatus:  "pending",
      processingStatus:      isDuplicate ? "duplicate" : "processed",
      processingNotes:       isDuplicate
                               ? `Duplicate of row ${seenFingerprints.get(fingerprint)}`
                               : "",
      isDuplicate,
      duplicateOfFingerprint: duplicateOfFingerprint || "",
      sourceFileName:         file.name,
      documentType:           "bank_statement",
    });
  }

  return { transactions, warnings };
}