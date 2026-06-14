/**
 * expenseProcessor.js
 * Parses an expense report XLSX/CSV, extracts expense records,
 * normalizes all fields, generates SHA-256 fingerprints,
 * and returns structured expense objects ready for Appwrite.
 */

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { convertToINR } from "./currencyUtils";
// ─── Column aliases ────────────────────────────────────────────────────────────
const EXP_ID_ALIASES   = [
  "exp id", "expense id", "expid", "exp no", "expense no",
  "expense number", "voucher no", "voucher number",
  "receipt no", "receipt number", "sl no", "sr no", "s.no", "id",
];
const EXP_DATE_ALIASES = [
  "expense date", "expensedate", "date", "exp date",
  "transaction date", "txn date", "entry date", "bill date",
];
const VENDOR_ALIASES   = [
  "vendor", "vendor name", "vendorname", "payee", "merchant",
  "supplier", "paid to", "party", "party name",
];
const CATEGORY_ALIASES = [
  "category", "expense category", "type", "expense type",
  "head", "account head", "cost head", "gl account",
];
const DESC_ALIASES     = [
  "description", "particulars", "details", "narration",
  "remarks", "notes", "purpose", "reason", "service description",
];
const AMOUNT_ALIASES   = [
  "amount", "amt", "expense amount", "amount paid",
  "net amount", "base amount", "cost", "value",
];
const TAX_ALIASES      = [
  "tax", "gst", "vat", "tax amount", "gst amount",
  "cgst", "sgst", "igst", "tds",
];
const TOTAL_ALIASES    = [
  "total amount", "total", "gross amount",
  "invoice amount", "bill amount", "grand total", "total cost",
];
const PAYMENT_ALIASES  = [
  "payment mode", "payment method", "mode of payment",
  "paid via", "pay mode", "mode",
];
const REF_ALIASES      = [
  "reference", "ref no", "reference no", "reference number",
  "cheque no", "utr", "transaction id", "txn id",
  "bill no", "invoice no", "notes / match tag",
];
const APPROVED_ALIASES = [
  "approved by", "approver", "authorised by", "authorized by", "manager",
];
const DEPT_ALIASES     = [
  "department", "dept", "cost center", "division", "team",
];
const PROJECT_ALIASES  = [
  "project", "project code", "project id", "job code",
];
const CURRENCY_ALIASES = ["currency", "curr"];

// ─── Known expense categories for normalization ────────────────────────────────
const CATEGORY_MAP = {
  "travel":            ["travel", "travelling", "conveyance", "transport", "cab", "uber", "ola", "flight", "train", "bus"],
  "meals":             ["meals", "food", "lunch", "dinner", "breakfast", "canteen", "restaurant", "swiggy", "zomato"],
  "software":          ["software", "saas", "subscription", "license", "tool", "app", "cloud", "aws", "azure", "gcp"],
  "office supplies":   ["office supplies", "stationery", "stationary", "printing", "paper", "pen", "office material"],
  "utilities":         ["utilities", "electricity", "water", "electricity board", "tneb", "bescom", "power", "generator", "diesel", "fuel"],
  "rent":              ["rent", "office rent", "lease", "rental"],
  "marketing":         ["marketing", "advertising", "ads", "google ads", "facebook", "linkedin", "promotion", "campaign"],
  "professional fees": ["professional", "professional fees", "consultant", "consulting", "legal", "audit", "ca", "chartered"],
  "internet":          ["internet", "broadband", "wifi", "bsnl", "jio", "airtel", "leased line", "bandwidth"],
  "training":          ["training", "education", "course", "udemy", "coursera", "workshop", "seminar", "learning"],
  "repairs":           ["repair", "maintenance", "amc", "service", "hardware repair"],
  "insurance":         ["insurance", "premium", "health insurance", "vehicle insurance"],
  "miscellaneous":     ["miscellaneous", "misc", "other", "general", "petty cash"],
};

function normalizeCategoryToStandard(raw) {
  if (!raw) return "";
  const lower = String(raw).trim().toLowerCase();
  for (const [standard, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) return standard;
  }
  return String(raw).trim().toLowerCase();
}

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
  if (str.startsWith("-")) { negative = true; str = str.slice(1); }
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

  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;

  // DD/MM/YYYY or DD-MM-YYYY
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    const d = new Date(Date.UTC(Number(y), Number(b) - 1, Number(a)));
    if (!isNaN(d.getTime()) && d.getUTCMonth() === Number(b) - 1)
      return `${y}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
  }

  // DD-Mon-YY e.g. 01-May-26
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

  // MM/DD/YYYY
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, day, yr] = m;
    const d = new Date(Date.UTC(Number(yr), Number(mo) - 1, Number(day)));
    if (!isNaN(d.getTime()))
      return `${yr}-${mo.padStart(2,"0")}-${day.padStart(2,"0")}`;
  }

  return null;
}

// ─── Text normalization ────────────────────────────────────────────────────────
function normalizeText(val) {
  if (!val) return "";
  return String(val).replace(/\s+/g, " ").replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "").trim();
}

function normalizeForFingerprint(val) {
  if (!val) return "";
  return String(val).toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

// ─── SHA-256 fingerprint ───────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2,"0")).join("");
}

async function buildFingerprint(expenseDate, amount, vendorNorm, categoryNorm, refNumber) {
  const parts = [
    expenseDate   || "",
    amount !== null ? Number(amount).toFixed(2) : "",
    vendorNorm    || "",
    categoryNorm  || "",
    refNumber     || "",
  ];
  return sha256(parts.join("|"));
}

// ─── Header normalization ──────────────────────────────────────────────────────
function normalizeH(h) {
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/[\(（][^)）]*[\)）]/g, "")
    .replace(/[₹$€£%#@]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Find column ───────────────────────────────────────────────────────────────
function findColumn(headers, aliases) {
  const exact = headers.find((h) => aliases.includes(normalizeH(h)));
  if (exact) return exact;
  const partial = headers.find((h) => {
    const hn = normalizeH(h);
    return aliases.some((a) => hn.includes(a) || a.includes(hn));
  });
  return partial || null;
}

// ─── Score row to detect header ────────────────────────────────────────────────
function scoreHeaderRow(rowArr) {
  const allAliases = [
    ...EXP_ID_ALIASES, ...EXP_DATE_ALIASES, ...VENDOR_ALIASES,
    ...CATEGORY_ALIASES, ...DESC_ALIASES, ...AMOUNT_ALIASES,
    ...TAX_ALIASES, ...TOTAL_ALIASES, ...PAYMENT_ALIASES,
    ...REF_ALIASES, ...APPROVED_ALIASES, ...DEPT_ALIASES,
  ];
  return rowArr.filter((c) => {
    const hn = normalizeH(String(c));
    return allAliases.some((a) => a === hn || hn.includes(a) || a.includes(hn));
  }).length;
}

// ─── Parse raw rows from file ──────────────────────────────────────────────────
// FIX: getRawRows now returns { rows, detectedHeaderRowIdx } for XLSX,
//      so headerRowIdx is never referenced from outer scope.
// ─── Parse raw rows from file ──────────────────────────────────────────────────
async function getRawRows(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "csv") {
    const rows = await new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: false,
        complete: (r) => resolve(r.data),
        error: reject,
      });
    });
    return { rows, detectedHeaderRowIdx: null };
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    if (wb.SheetNames.length === 0) return { rows: [], detectedHeaderRowIdx: null };

    let bestRows = null;
    let bestScore = -1;
    let bestHeaderRowIdx = 0;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const scanLimit = Math.min(20, rawRows.length);

      for (let i = 0; i < scanLimit; i++) {
        const row = rawRows[i];
        if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === "")) {
          continue;
        }
        const score = scoreHeaderRow(row.map(String));
        if (score > bestScore) {
          bestScore = score;
          bestHeaderRowIdx = i;
          bestRows = rawRows; // ← fix: capture the rows for this sheet
        }
      }
    }

    return {
      rows: bestRows || [],
      detectedHeaderRowIdx: bestScore > 0 ? bestHeaderRowIdx : null,
    };
  }

  throw new Error("Unsupported file type: " + ext);
}

// ─── Main export ───────────────────────────────────────────────────────────────
export async function processExpenseFile(file, clientId, documentRecordId, uploadBatchId) {
  const { rows: rawRows, detectedHeaderRowIdx } = await getRawRows(file);
  console.log("===== FIRST 20 ROWS =====");

rawRows.slice(0, 20).forEach((row, index) => {
  console.log(`ROW ${index}:`, row);
});

console.log("=========================");
  const warnings = [];

  if (rawRows.length === 0) {
    return { expenses: [], warnings: ["No rows found in file."] };
  }

  // ── Find best header row ────────────────────────────────────────────────────
  // For XLSX: use the idx already found during sheet scanning.
  // For CSV: scan up to row 20 and pick the highest-scoring row.
  let headerRowIdx = 0;
  if (detectedHeaderRowIdx !== null) {
    headerRowIdx = detectedHeaderRowIdx;
  } else {
    // CSV path — scan for best header row
    const scanLimit = Math.min(20, rawRows.length);
    let bestScore = -1;
    for (let i = 0; i < scanLimit; i++) {
      const row = rawRows[i];
      if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
      const score = scoreHeaderRow(row.map(String));
      if (score > bestScore) {
        bestScore = score;
        headerRowIdx = i;
      }
    }
    if (bestScore === 0) {
      warnings.push("Could not confidently detect header row. Using row 1 as fallback.");
      headerRowIdx = 0;
    }
  }

  const headers = rawRows[headerRowIdx].map(String);
  console.log("===== DETECTED HEADERS =====");
  headers.forEach((h, i) => console.log(i, JSON.stringify(h)));
  console.log(`[expenseProcessor] Header row index: ${headerRowIdx}`);
  console.log("============================");

  // ── Content mismatch guard ─────────────────────────────────────────────────
  const BANK_SIGNALS    = ["debit", "credit", "balance", "withdrawal", "deposit"];
  const EXPENSE_SIGNALS = ["vendor", "category", "expense", "payee", "merchant",
                           "amount", "description", "purpose", "approved"];
  const normalizedHeaders = headers.map((h) => normalizeH(h));
  const bankScore    = normalizedHeaders.filter((h) => BANK_SIGNALS.some((s) => h.includes(s))).length;
  const expenseScore = normalizedHeaders.filter((h) => EXPENSE_SIGNALS.some((s) => h.includes(s))).length;

  if (bankScore >= 2 && expenseScore === 0) {
    return {
      expenses: [],
      warnings: [
        `This file appears to be a Bank Statement (detected headers: ${headers.filter(Boolean).join(", ")}). ` +
        `Please re-upload and select "Bank Statement" as the document type.`,
      ],
    };
  }

  // ── Also guard against invoice files uploaded as expense reports ───────────
  const INVOICE_SIGNALS = ["invoice no", "invoice number", "invoice date", "customer", "client name",
                           "due date", "amount due", "balance due", "billed to"];
  const invoiceScore = normalizedHeaders.filter((h) =>
    INVOICE_SIGNALS.some((s) => h.includes(s))
  ).length;

  if (invoiceScore >= 2 && expenseScore === 0) {
    return {
      expenses: [],
      warnings: [
        `This file appears to be a Customer Invoice file (detected headers: ${headers.filter(Boolean).join(", ")}). ` +
        `Please re-upload and select "Invoice" as the document type.`,
      ],
    };
  }

  // ── Map columns ────────────────────────────────────────────────────────────
  const colExpId    = findColumn(headers, EXP_ID_ALIASES);
  const colExpDate  = findColumn(headers, EXP_DATE_ALIASES);
  const colVendor   = findColumn(headers, VENDOR_ALIASES);
  const colCategory = findColumn(headers, CATEGORY_ALIASES);
  const colDesc     = findColumn(headers, DESC_ALIASES);
  const colAmount   = findColumn(headers, AMOUNT_ALIASES);
  const colTax      = findColumn(headers, TAX_ALIASES);
  const colTotal    = findColumn(headers, TOTAL_ALIASES);
  const colPayMode  = findColumn(headers, PAYMENT_ALIASES);
  const colRef      = findColumn(headers, REF_ALIASES);
  const colApproved = findColumn(headers, APPROVED_ALIASES);
  const colDept     = findColumn(headers, DEPT_ALIASES);
  const colProject  = findColumn(headers, PROJECT_ALIASES);
  const colCurrency = findColumn(headers, CURRENCY_ALIASES);

  console.log("[expenseProcessor] Mapped columns:", {
    colExpId, colExpDate, colVendor, colCategory, colDesc,
    colAmount, colTax, colTotal, colPayMode, colRef,
    colApproved, colDept, colProject, colCurrency,
  });
  console.log("[expenseProcessor] Total data rows to process:", rawRows.length - headerRowIdx - 1);

  if (!colExpDate)             warnings.push("Expense Date column not detected.");
  if (!colVendor)              warnings.push("Vendor column not detected.");
  if (!colAmount && !colTotal) warnings.push("Amount column not detected.");

  // ── Process data rows ──────────────────────────────────────────────────────
  const expenses = [];
  const seenFingerprints = new Map();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;

    const r = {};
    headers.forEach((h, idx) => { r[h] = row[idx] !== undefined ? row[idx] : ""; });

    const rawExpId    = colExpId    ? r[colExpId]    : null;
    const rawExpDate  = colExpDate  ? r[colExpDate]  : null;
    const rawVendor   = colVendor   ? r[colVendor]   : null;
    const rawCategory = colCategory ? r[colCategory] : null;
    const rawDesc     = colDesc     ? r[colDesc]     : null;
    const rawAmount   = colAmount   ? r[colAmount]   : null;
    const rawTax      = colTax      ? r[colTax]      : null;
    const rawTotal    = colTotal    ? r[colTotal]    : null;
    const rawPayMode  = colPayMode  ? r[colPayMode]  : null;
    const rawRef      = colRef      ? r[colRef]      : null;
    const rawApproved = colApproved ? r[colApproved] : null;
    const rawDept     = colDept     ? r[colDept]     : null;
    const rawProject  = colProject  ? r[colProject]  : null;
    const rawCurrency = colCurrency ? r[colCurrency] : null;

    const hasDate   = rawExpDate !== null && String(rawExpDate).trim() !== "";
    const hasAmount = (rawAmount !== null && String(rawAmount).trim() !== "") ||
                      (rawTotal  !== null && String(rawTotal).trim()  !== "");
    if (!hasDate && !hasAmount) continue;

    const expenseDate = normalizeDate(rawExpDate);
    if (rawExpDate && !expenseDate) {
      warnings.push(`Row ${i + 1}: Could not parse expense date "${rawExpDate}".`);
    }

    const expenseId           = rawExpId ? normalizeText(String(rawExpId)) : `EXP-ROW${i + 1}`;
    const expenseIdNormalized = normalizeForFingerprint(expenseId);

    const vendorName           = normalizeText(rawVendor);
    const vendorNameNormalized = normalizeForFingerprint(rawVendor);

    const categoryRaw        = normalizeText(rawCategory);
    const categoryNormalized = normalizeCategoryToStandard(rawCategory);

    const description = normalizeText(rawDesc);

    let amount      = parseAmount(rawAmount);
    let taxAmount   = parseAmount(rawTax);
    let totalAmount = parseAmount(rawTotal);

    if (amount === null && totalAmount !== null) amount = totalAmount;
    if (totalAmount === null && amount !== null) totalAmount = amount + (taxAmount || 0);

    if (amount === null) {
      warnings.push(`Row ${i + 1}: Skipped — no valid amount found.`);
      continue;
    }

    let taxRate = null;
    if (amount && taxAmount && amount > 0) {
      taxRate = parseFloat(((taxAmount / amount) * 100).toFixed(2));
    }

    const paymentMode     = normalizeText(rawPayMode);
    const referenceNumber = rawRef ? String(rawRef).trim().toUpperCase().replace(/\s+/g, "") : "";
    const approvedBy      = normalizeText(rawApproved);
    const department      = normalizeText(rawDept);
    const projectCode     = normalizeText(rawProject);
    const currency        = rawCurrency ? String(rawCurrency).trim().toUpperCase() : "INR";
    const fx = await convertToINR(totalAmount ?? amount, currency, expenseDate);

    const fingerprint = await buildFingerprint(
      expenseDate,
      amount,
      vendorNameNormalized,
      categoryNormalized,
      referenceNumber
    );

    const isDuplicate            = seenFingerprints.has(fingerprint);
    const duplicateOfFingerprint = isDuplicate ? fingerprint : null;
    if (!isDuplicate) seenFingerprints.set(fingerprint, i + 1);

    expenses.push({
      clientId,
      documentRecordId,
      uploadBatchId,
      fingerprint,
      expenseId,
      expenseIdNormalized,
      expenseDate:          expenseDate || "",
      vendorName:           vendorName  || "",
      vendorNameNormalized: vendorNameNormalized || "",
      category:             categoryRaw || "",
      categoryNormalized:   categoryNormalized || "",
      description:          description || "",
      amount,
      taxAmount:            taxAmount   !== null ? taxAmount   : 0,
      taxRate:              taxRate     !== null ? taxRate     : 0,
      totalAmount:          totalAmount !== null ? totalAmount : amount,
      currency,
      originalAmount:   fx.originalAmount,
      originalCurrency: fx.originalCurrency,
      exchangeRate:     fx.exchangeRate,
      exchangeRateDate: fx.rateDate,
      amountINR:        fx.amountINR,
      paymentMode:          paymentMode || "",
      referenceNumber:      referenceNumber || "",
      approvedBy:           approvedBy  || "",
      department:           department  || "",
      projectCode:          projectCode || "",
      expenseRowIndex:      i + 1,
      matchStatus:          "unmatched",
      matchedBankTxnId:     "",
      reconciliationStatus: "pending",
      processingStatus:     isDuplicate ? "duplicate" : "processed",
      processingNotes:      isDuplicate
                              ? `Duplicate of row ${seenFingerprints.get(fingerprint)}`
                              : "",
      isDuplicate,
      duplicateOfFingerprint: duplicateOfFingerprint || "",
      sourceFileName:       file.name,
      documentType:         "expense_report",
    });
  }

  return { expenses, warnings };
}