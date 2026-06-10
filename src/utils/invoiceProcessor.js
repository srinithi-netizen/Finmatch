/**
 * invoiceProcessor.js
 */

import * as XLSX from "xlsx";
import Papa from "papaparse";

// ─── Invoice number patterns ───────────────────────────────────────────────────
const INVOICE_NUMBER_PATTERNS = [
  /\b(INV[-\/]?\d{2,10})\b/i,
  /\b(INVOICE[-\/\s]?\d{2,10})\b/i,
  /\b(INV[#\s]?\d{2,10})\b/i,
  /\b(SI[-\/]?\d{2,10})\b/i,
  /\b(PI[-\/]?\d{2,10})\b/i,
  /\b(RI[-\/]?\d{2,10})\b/i,
  /\b(TAX[-\/]?\d{2,10})\b/i,
  /\b([A-Z]{2,5}[-\/]\d{4,10})\b/,
  /\b(\d{4,10})\b/,
];

// ─── Column aliases ────────────────────────────────────────────────────────────
const INV_NUMBER_ALIASES = [
  "invoice number", "invoice no", "invoice #", "inv no", "inv number",
  "invoice id", "bill number", "bill no", "voucher no", "voucher number",
  "doc no", "document number", "invoice no.", "inv no.",
];

const INV_DATE_ALIASES = [
  "invoice date", "bill date", "date", "inv date", "document date",
  "txn date", "transaction date",
];

const DUE_DATE_ALIASES = [
  "due date", "payment due", "due by", "pay by", "expiry date",
];

const VENDOR_ALIASES = [
  "vendor", "vendor name", "supplier", "supplier name",
  "from", "billed from", "seller", "party name",
];

const CUSTOMER_ALIASES = [
  "customer", "customer name", "client", "client name",
  "buyer", "billed to", "bill to", "to", "party",
];

const DESC_ALIASES = [
  "description", "particulars", "details", "narration", "service",
  "item description", "remarks", "notes", "service description",
];

const SUBTOTAL_ALIASES = [
  "subtotal", "sub total", "net amount", "taxable amount",
  "base amount", "amount before tax", "subtotal",  // normalizeH strips (₹)
];

const TAX_ALIASES = [
  "tax", "gst", "vat", "tax amount", "gst amount",
  "tax", "gst", "cgst", "sgst", "igst",  // normalizeH strips (₹) and 18%
];

const TOTAL_ALIASES = [
  "total", "total amount", "invoice total", "grand total",
  "amount", "net payable", "total", "amount",  // normalizeH strips (₹)
  "payable amount", "invoice amount",
];

const AMOUNT_PAID_ALIASES = ["amount paid", "paid amount", "payment received", "paid"];
const AMOUNT_DUE_ALIASES  = ["amount due", "balance due", "outstanding", "remaining", "balance payable"];
const CURRENCY_ALIASES    = ["currency", "curr"];

// ─── Header normalization (consistent with columnMapper) ──────────────────────
function normalizeH(h) {
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/\s*\d+%\s*/g, " ")        // strip "18%", "28%" etc
    .replace(/[\(（][^)）]*[\)）]/g, "") // strip (₹), (USD) etc
    .replace(/[₹$€£]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Single scoreHeaderRow ─────────────────────────────────────────────────────
function scoreHeaderRow(rowArr) {
  const allAliases = [
    ...INV_NUMBER_ALIASES, ...INV_DATE_ALIASES, ...DUE_DATE_ALIASES,
    ...VENDOR_ALIASES, ...CUSTOMER_ALIASES, ...DESC_ALIASES,
    ...SUBTOTAL_ALIASES, ...TAX_ALIASES, ...TOTAL_ALIASES,
    ...AMOUNT_PAID_ALIASES, ...AMOUNT_DUE_ALIASES,
  ];
  return rowArr.filter((c) => allAliases.includes(normalizeH(String(c)))).length;
}

function findColumn(headers, aliases) {
  return headers.find((h) => aliases.includes(normalizeH(h))) || null;
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
    if (!isNaN(d.getTime()) && d.getUTCMonth() === Number(b) - 1)
      return `${y}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
  }

  m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[m[2].toLowerCase()];
    if (mo) {
      let yr = Number(m[3]);
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      return `${yr}-${String(mo).padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    }
  }

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

function normalizeInvoiceNumber(raw) {
  if (!raw) return "";
  return String(raw).trim().toUpperCase().replace(/\s+/g, "").replace(/[^\w\-\/]/g, "");
}

function extractInvoiceNumber(text) {
  if (!text) return null;
  const str = String(text).trim();
  for (const pattern of INVOICE_NUMBER_PATTERNS) {
    const match = str.match(pattern);
    if (match) return normalizeInvoiceNumber(match[1]);
  }
  return null;
}

// ─── SHA-256 fingerprint ───────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2,"0")).join("");
}

async function buildFingerprint(invoiceNumberNorm, invoiceDate, totalAmount, vendorNorm, customerNorm) {
  const parts = [
    invoiceNumberNorm || "",
    invoiceDate       || "",
    totalAmount !== null ? Number(totalAmount).toFixed(2) : "",
    vendorNorm        || "",
    customerNorm      || "",
  ];
  return sha256(parts.join("|"));
}

// ─── Parse raw rows — scores ALL sheets, picks best ───────────────────────────
async function getRawRows(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: false,
        complete: (r) => resolve(r.data),
        error: reject,
      });
    });
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    if (wb.SheetNames.length === 0) return [];

    let bestRows = null;
    let bestScore = -1;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const scanLimit = Math.min(20, rawRows.length);

      for (let i = 0; i < scanLimit; i++) {
        const score = scoreHeaderRow(rawRows[i].map(String));
        if (score > bestScore) {
          bestScore = score;
          bestRows = rawRows;   // keep the full sheet rows, not just this row
        }
      }
    }

    return bestRows || [];
  }

  throw new Error("Unsupported file type: " + ext);
}

// ─── Main export ───────────────────────────────────────────────────────────────
export async function processInvoiceFile(file, clientId, documentRecordId, uploadBatchId) {
  const rawRows = await getRawRows(file);
  const warnings = [];

  if (rawRows.length === 0) {
    return { invoices: [], warnings: ["No rows found in file."] };
  }

  // Find best header row (scan first 20 rows)
  const scanLimit = Math.min(20, rawRows.length);
  let headerRowIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < scanLimit; i++) {
    const score = scoreHeaderRow(rawRows[i].map(String));
    if (score > bestScore) { bestScore = score; headerRowIdx = i; }
  }
  if (bestScore === 0) {
    warnings.push("Could not confidently detect header row. Using row 1 as fallback.");
    headerRowIdx = 0;
  }

  const headers = rawRows[headerRowIdx].map(String);

  // Map columns
  const colInvNum   = findColumn(headers, INV_NUMBER_ALIASES);
  const colInvDate  = findColumn(headers, INV_DATE_ALIASES);
  const colDueDate  = findColumn(headers, DUE_DATE_ALIASES);
  const colVendor   = findColumn(headers, VENDOR_ALIASES);
  const colCustomer = findColumn(headers, CUSTOMER_ALIASES);
  const colDesc     = findColumn(headers, DESC_ALIASES);
  const colSubtotal = findColumn(headers, SUBTOTAL_ALIASES);
  const colTax      = findColumn(headers, TAX_ALIASES);
  const colTotal    = findColumn(headers, TOTAL_ALIASES);
  const colAmtPaid  = findColumn(headers, AMOUNT_PAID_ALIASES);
  const colAmtDue   = findColumn(headers, AMOUNT_DUE_ALIASES);
  const colCurrency = findColumn(headers, CURRENCY_ALIASES);

  // Log what was detected (helps debug future issues)
  console.log("[invoiceProcessor] Sheet headers:", headers);
  console.log("[invoiceProcessor] Mapped columns:", {
    colInvNum, colInvDate, colDueDate, colVendor, colCustomer,
    colDesc, colSubtotal, colTax, colTotal, colAmtPaid, colAmtDue,
  });

  if (!colInvNum)  warnings.push("Invoice Number column not detected — will attempt extraction from description.");
  if (!colInvDate) warnings.push("Invoice Date column not detected.");
  if (!colTotal)   warnings.push("Total Amount column not detected — will attempt from subtotal+tax.");

  const invoices = [];
  const seenFingerprints = new Map();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;

    const r = {};
    headers.forEach((h, idx) => { r[h] = row[idx] !== undefined ? row[idx] : ""; });

    const rawInvNum   = colInvNum   ? r[colInvNum]   : null;
    const rawInvDate  = colInvDate  ? r[colInvDate]  : null;
    const rawDueDate  = colDueDate  ? r[colDueDate]  : null;
    const rawVendor   = colVendor   ? r[colVendor]   : null;
    const rawCustomer = colCustomer ? r[colCustomer] : null;
    const rawDesc     = colDesc     ? r[colDesc]     : null;
    const rawSubtotal = colSubtotal ? r[colSubtotal] : null;
    const rawTax      = colTax      ? r[colTax]      : null;
    const rawTotal    = colTotal    ? r[colTotal]    : null;
    const rawAmtPaid  = colAmtPaid  ? r[colAmtPaid]  : null;
    const rawAmtDue   = colAmtDue   ? r[colAmtDue]   : null;
    const rawCurrency = colCurrency ? r[colCurrency] : null;

    const hasInvNum = rawInvNum !== null && String(rawInvNum).trim() !== "";
    const hasTotal  = rawTotal  !== null && String(rawTotal).trim()  !== "";
    if (!hasInvNum && !hasTotal) continue;

    // Invoice number resolution
    let invoiceNumber = null;
    if (hasInvNum) {
      invoiceNumber = extractInvoiceNumber(String(rawInvNum))
                   || normalizeInvoiceNumber(String(rawInvNum));
    }
    if (!invoiceNumber && rawDesc) {
      invoiceNumber = extractInvoiceNumber(String(rawDesc));
    }
    if (!invoiceNumber) {
      invoiceNumber = `UNKNOWN-ROW${i + 1}`;
      warnings.push(`Row ${i + 1}: Could not extract invoice number. Assigned placeholder.`);
    }
    const invoiceNumberNormalized = normalizeForFingerprint(invoiceNumber);

    const invoiceDate = normalizeDate(rawInvDate);
    const dueDate     = normalizeDate(rawDueDate);
    if (rawInvDate && !invoiceDate)
      warnings.push(`Row ${i + 1}: Could not parse invoice date "${rawInvDate}".`);

    const vendorName             = normalizeText(rawVendor);
    const vendorNameNormalized   = normalizeForFingerprint(rawVendor);
    const customerName           = normalizeText(rawCustomer);
    const customerNameNormalized = normalizeForFingerprint(rawCustomer);

    const subtotal  = parseAmount(rawSubtotal);
    const taxAmount = parseAmount(rawTax);
    let totalAmount = parseAmount(rawTotal);

    if (totalAmount === null && subtotal !== null) {
      totalAmount = subtotal + (taxAmount || 0);
      warnings.push(`Row ${i + 1}: Total not found. Computed as subtotal + tax = ${totalAmount}.`);
    }

    let taxRate = null;
    if (subtotal && taxAmount && subtotal > 0)
      taxRate = parseFloat(((taxAmount / subtotal) * 100).toFixed(2));

    const amountPaid = parseAmount(rawAmtPaid);
    const amountDue  = parseAmount(rawAmtDue) ??
                       (totalAmount !== null && amountPaid !== null
                         ? parseFloat((totalAmount - amountPaid).toFixed(2))
                         : totalAmount);

    if (totalAmount === null) {
      warnings.push(`Row ${i + 1}: Skipped — no total amount found.`);
      continue;
    }

    const description = normalizeText(rawDesc);
    const currency    = rawCurrency ? String(rawCurrency).trim().toUpperCase() : "INR";

    const fingerprint = await buildFingerprint(
      invoiceNumberNormalized, invoiceDate, totalAmount,
      vendorNameNormalized, customerNameNormalized
    );

    const isDuplicate = seenFingerprints.has(fingerprint);
    if (!isDuplicate) seenFingerprints.set(fingerprint, i + 1);

    invoices.push({
      clientId,
      documentRecordId,
      uploadBatchId,
      fingerprint,
      invoiceNumber,
      invoiceNumberNormalized,
      invoiceDate:             invoiceDate  || "",
      dueDate:                 dueDate      || "",
      vendorName:              vendorName   || "",
      vendorNameNormalized:    vendorNameNormalized   || "",
      customerName:            customerName || "",
      customerNameNormalized:  customerNameNormalized || "",
      description:             description  || "",
      subtotal:                subtotal     ?? 0,
      taxAmount:               taxAmount    ?? 0,
      taxRate:                 taxRate      ?? 0,
      totalAmount,
      amountPaid:              amountPaid   ?? 0,
      amountDue:               amountDue    ?? totalAmount,
      currency,
      lineItems:               "",
      invoiceRowIndex:         i + 1,
      matchStatus:             "unmatched",
      matchedBankTxnId:        "",
      reconciliationStatus:    "pending",
      processingStatus:        isDuplicate ? "duplicate" : "processed",
      processingNotes:         isDuplicate
                                 ? `Duplicate of row ${seenFingerprints.get(fingerprint)}`
                                 : "",
      isDuplicate,
      duplicateOfFingerprint:  isDuplicate ? fingerprint : "",
      sourceFileName:          file.name,
      documentType:            "invoice",
    });
  }

  return { invoices, warnings };
}