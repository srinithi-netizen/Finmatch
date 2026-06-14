/**
 * salesReportProcessor.js
 * Parses a sales report XLSX/CSV file, extracts sale records,
 * normalizes all fields, generates SHA-256 fingerprints,
 * and returns structured sale objects ready for Appwrite.
 */

import * as XLSX from "xlsx";
import Papa from "papaparse";
import { convertToINR } from "./currencyUtils";

// ─── Column aliases ────────────────────────────────────────────────────────────

const SALE_ID_ALIASES = [
  "sale id", "sales id", "order id", "order number", "order no",
  "sale number", "sale no", "transaction id", "txn id", "receipt no",
  "receipt number", "reference number", "ref no", "ref number",
  "booking id", "deal id", "quotation no", "quote no",
];

const SALE_DATE_ALIASES = [
  "sale date", "sales date", "date", "order date", "transaction date",
  "txn date", "invoice date", "booking date", "delivery date",
];

const CUSTOMER_ALIASES = [
  "customer", "customer name", "client", "client name", "buyer",
  "buyer name", "sold to", "bill to", "billed to", "party",
  "party name", "account name", "debtor", "debtor name",
];

const CUSTOMER_ID_ALIASES = [
  "customer id", "client id", "buyer id", "account id",
  "customer code", "client code",
];

const SALESPERSON_ALIASES = [
  "salesperson", "sales person", "sales rep", "sales representative",
  "agent", "executive", "sales executive", "handled by", "rep",
  "sales agent", "employee", "staff",
];

const PRODUCT_ALIASES = [
  "product", "product name", "item", "item name", "service",
  "service name", "description", "particulars", "goods",
  "product description", "item description", "sku", "product code",
];

const CATEGORY_ALIASES = [
  "category", "product category", "item category", "type",
  "segment", "product type", "service type",
];

const QUANTITY_ALIASES = [
  "quantity", "qty", "units", "count", "nos", "number of units",
  "quantity sold", "units sold",
];

const UNIT_PRICE_ALIASES = [
  "unit price", "price", "rate", "unit rate", "per unit",
  "selling price", "sale price", "mrp", "price per unit",
];

const DISCOUNT_ALIASES = [
  "discount", "discount amount", "discount value", "rebate",
  "concession",
];

const DISCOUNT_PCT_ALIASES = [
  "discount percent", "discount pct", "discount rate",
  "discount percentage",
];

const SUBTOTAL_ALIASES = [
  "subtotal", "sub total", "net amount", "taxable amount",
  "base amount", "amount before tax", "net sales",
];

const TAX_ALIASES = [
  "tax", "gst", "vat", "tax amount", "gst amount",
  "cgst", "sgst", "igst", "tax total",
];

const TOTAL_ALIASES = [
  "total", "total amount", "invoice total", "grand total",
  "sale amount", "sales amount", "amount", "net payable",
  "total sale", "total value", "revenue", "billing amount",
];

const PAYMENT_MODE_ALIASES = [
  "payment mode", "payment method", "mode of payment",
  "payment type", "pay mode", "method",
];

const PAYMENT_STATUS_ALIASES = [
  "payment status", "status", "paid status", "collection status",
];

const REGION_ALIASES = [
  "region", "area", "zone", "territory", "location",
  "city", "state", "branch",
];

const CURRENCY_ALIASES = ["currency", "curr"];

// ─── Header normalization ──────────────────────────────────────────────────────
function normalizeH(h) {
  return String(h)
    .trim()
    .toLowerCase()
    .replace(/\s*\d+%\s*/g, " ")
    .replace(/[\(（][^)）]*[\)）]/g, "")
    .replace(/[₹$€£]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumn(headers, aliases) {
  return headers.find((h) => aliases.includes(normalizeH(h))) || null;
}

// ─── Score a row to detect which row is the header ────────────────────────────
function scoreHeaderRow(rowArr) {
  const allAliases = [
    ...SALE_ID_ALIASES, ...SALE_DATE_ALIASES, ...CUSTOMER_ALIASES,
    ...CUSTOMER_ID_ALIASES, ...SALESPERSON_ALIASES, ...PRODUCT_ALIASES,
    ...CATEGORY_ALIASES, ...QUANTITY_ALIASES, ...UNIT_PRICE_ALIASES,
    ...DISCOUNT_ALIASES, ...DISCOUNT_PCT_ALIASES, ...SUBTOTAL_ALIASES,
    ...TAX_ALIASES, ...TOTAL_ALIASES, ...PAYMENT_MODE_ALIASES,
    ...PAYMENT_STATUS_ALIASES, ...REGION_ALIASES,
  ];
  return rowArr.filter((c) => allAliases.includes(normalizeH(String(c)))).length;
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

// ─── Sale ID normalization ─────────────────────────────────────────────────────
function normalizeSaleId(raw) {
  if (!raw) return "";
  return String(raw).trim().toUpperCase().replace(/\s+/g, "").replace(/[^\w\-\/]/g, "");
}

// ─── Extract sale ID from free-text ───────────────────────────────────────────
const SALE_ID_PATTERNS = [
  /\b(ORD[-\/]?\d{2,10})\b/i,
  /\b(ORDER[-\/\s]?\d{2,10})\b/i,
  /\b(SALE[-\/]?\d{2,10})\b/i,
  /\b(INV[-\/]?\d{2,10})\b/i,
  /\b(SI[-\/]?\d{2,10})\b/i,
  /\b(TXN[-\/]?\d{2,10})\b/i,
  /\b([A-Z]{2,5}[-\/]\d{4,10})\b/,
  /\b(\d{4,10})\b/,
];

function extractSaleId(text) {
  if (!text) return null;
  const str = String(text).trim();
  for (const pattern of SALE_ID_PATTERNS) {
    const match = str.match(pattern);
    if (match) return normalizeSaleId(match[1]);
  }
  return null;
}

// ─── SHA-256 fingerprint ───────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2,"0")).join("");
}

async function buildFingerprint(saleIdNorm, saleDate, totalAmount, customerNorm, productNorm) {
  const parts = [
    saleIdNorm    || "",
    saleDate      || "",
    totalAmount !== null ? Number(totalAmount).toFixed(2) : "",
    customerNorm  || "",
    productNorm   || "",
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
          bestRows = rawRows;
        }
      }
    }

    return bestRows || [];
  }

  throw new Error("Unsupported file type: " + ext);
}

// ─── Main export ───────────────────────────────────────────────────────────────
/**
 * @param {File}   file
 * @param {string} clientId
 * @param {string} documentRecordId
 * @param {string} uploadBatchId
 * @returns {Promise<{ saleRecords: object[], warnings: string[] }>}
 */
export async function processSalesReportFile(file, clientId, documentRecordId, uploadBatchId) {
  const rawRows = await getRawRows(file);
  const warnings = [];

  if (rawRows.length === 0) {
    return { saleRecords: [], warnings: ["No rows found in file."] };
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

  // Map all columns
  const colSaleId        = findColumn(headers, SALE_ID_ALIASES);
  const colSaleDate      = findColumn(headers, SALE_DATE_ALIASES);
  const colCustomer      = findColumn(headers, CUSTOMER_ALIASES);
  const colCustomerId    = findColumn(headers, CUSTOMER_ID_ALIASES);
  const colSalesperson   = findColumn(headers, SALESPERSON_ALIASES);
  const colProduct       = findColumn(headers, PRODUCT_ALIASES);
  const colCategory      = findColumn(headers, CATEGORY_ALIASES);
  const colQuantity      = findColumn(headers, QUANTITY_ALIASES);
  const colUnitPrice     = findColumn(headers, UNIT_PRICE_ALIASES);
  const colDiscount      = findColumn(headers, DISCOUNT_ALIASES);
  const colDiscountPct   = findColumn(headers, DISCOUNT_PCT_ALIASES);
  const colSubtotal      = findColumn(headers, SUBTOTAL_ALIASES);
  const colTax           = findColumn(headers, TAX_ALIASES);
  const colTotal         = findColumn(headers, TOTAL_ALIASES);
  const colPaymentMode   = findColumn(headers, PAYMENT_MODE_ALIASES);
  const colPaymentStatus = findColumn(headers, PAYMENT_STATUS_ALIASES);
  const colRegion        = findColumn(headers, REGION_ALIASES);
  const colCurrency      = findColumn(headers, CURRENCY_ALIASES);

  console.log("[salesReportProcessor] Headers:", headers);
  console.log("[salesReportProcessor] Mapped:", {
    colSaleId, colSaleDate, colCustomer, colProduct,
    colQuantity, colUnitPrice, colSubtotal, colTax, colTotal,
    colPaymentMode, colPaymentStatus,
  });

  // Warn on missing critical columns
  if (!colSaleDate) warnings.push("Sale Date column not detected.");
  if (!colCustomer) warnings.push("Customer column not detected.");
  if (!colTotal)    warnings.push("Total Amount column not detected — will attempt from subtotal+tax or qty×price.");

  const saleRecords = [];
  const seenFingerprints = new Map();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;

    const r = {};
    headers.forEach((h, idx) => { r[h] = row[idx] !== undefined ? row[idx] : ""; });

    const rawSaleId        = colSaleId        ? r[colSaleId]        : null;
    const rawSaleDate      = colSaleDate      ? r[colSaleDate]      : null;
    const rawCustomer      = colCustomer      ? r[colCustomer]      : null;
    const rawCustomerId    = colCustomerId    ? r[colCustomerId]    : null;
    const rawSalesperson   = colSalesperson   ? r[colSalesperson]   : null;
    const rawProduct       = colProduct       ? r[colProduct]       : null;
    const rawCategory      = colCategory      ? r[colCategory]      : null;
    const rawQuantity      = colQuantity      ? r[colQuantity]      : null;
    const rawUnitPrice     = colUnitPrice     ? r[colUnitPrice]     : null;
    const rawDiscount      = colDiscount      ? r[colDiscount]      : null;
    const rawDiscountPct   = colDiscountPct   ? r[colDiscountPct]   : null;
    const rawSubtotal      = colSubtotal      ? r[colSubtotal]      : null;
    const rawTax           = colTax           ? r[colTax]           : null;
    const rawTotal         = colTotal         ? r[colTotal]         : null;
    const rawPaymentMode   = colPaymentMode   ? r[colPaymentMode]   : null;
    const rawPaymentStatus = colPaymentStatus ? r[colPaymentStatus] : null;
    const rawRegion        = colRegion        ? r[colRegion]        : null;
    const rawCurrency      = colCurrency      ? r[colCurrency]      : null;

    // Skip rows with no customer AND no total (blank/summary rows)
    const hasCustomer = rawCustomer !== null && String(rawCustomer).trim() !== "";
    const hasTotal    = rawTotal    !== null && String(rawTotal).trim()    !== "";
    const hasSaleId   = rawSaleId   !== null && String(rawSaleId).trim()   !== "";
    if (!hasCustomer && !hasTotal && !hasSaleId) continue;

    // ── Sale ID resolution ───────────────────────────────────────────────────
    let saleId = null;
    if (hasSaleId) {
      saleId = extractSaleId(String(rawSaleId)) || normalizeSaleId(String(rawSaleId));
    }
    if (!saleId && rawProduct) {
      saleId = extractSaleId(String(rawProduct));
    }
    if (!saleId) {
      saleId = `SALE-ROW${i + 1}`;
      warnings.push(`Row ${i + 1}: Could not extract Sale ID. Assigned placeholder.`);
    }
    const saleIdNormalized = normalizeForFingerprint(saleId);

    // ── Date ─────────────────────────────────────────────────────────────────
    const saleDate = normalizeDate(rawSaleDate);
    if (rawSaleDate && !saleDate)
      warnings.push(`Row ${i + 1}: Could not parse sale date "${rawSaleDate}".`);

    // ── Text fields ──────────────────────────────────────────────────────────
    const customerName         = normalizeText(rawCustomer);
    const customerNameNorm     = normalizeForFingerprint(rawCustomer);
    const customerId           = normalizeText(rawCustomerId);
    const salesperson          = normalizeText(rawSalesperson);
    const productName          = normalizeText(rawProduct);
    const productNameNorm      = normalizeForFingerprint(rawProduct);
    const category             = normalizeText(rawCategory);
    const paymentMode          = normalizeText(rawPaymentMode);
    const paymentStatus        = normalizeText(rawPaymentStatus) || "unknown";
    const region               = normalizeText(rawRegion);
    const currency             = rawCurrency
                                   ? String(rawCurrency).trim().toUpperCase()
                                   : "INR";

    // ── Numeric fields ───────────────────────────────────────────────────────
    const quantity   = parseAmount(rawQuantity)   ?? 0;
    const unitPrice  = parseAmount(rawUnitPrice)  ?? 0;
    const discount   = parseAmount(rawDiscount)   ?? 0;
    const discountPct= parseAmount(rawDiscountPct)?? 0;
    const subtotal   = parseAmount(rawSubtotal);
    const taxAmount  = parseAmount(rawTax)        ?? 0;

    // Total resolution cascade:
    // 1. Direct column
    // 2. subtotal + tax
    // 3. (qty × unitPrice) - discount + tax
    let totalAmount = parseAmount(rawTotal);

    if (totalAmount === null && subtotal !== null) {
      totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));
      warnings.push(`Row ${i + 1}: Total not found. Computed as subtotal + tax = ${totalAmount}.`);
    }

    if (totalAmount === null && quantity > 0 && unitPrice > 0) {
      const base = quantity * unitPrice - discount;
      totalAmount = parseFloat((base + taxAmount).toFixed(2));
      warnings.push(`Row ${i + 1}: Total computed as (qty × price) - discount + tax = ${totalAmount}.`);
    }

    // Skip rows with no usable total
    if (totalAmount === null) {
      warnings.push(`Row ${i + 1}: Skipped — no total amount found.`);
      continue;
    }

    // Compute subtotal if missing
    const finalSubtotal = subtotal ?? parseFloat((totalAmount - taxAmount).toFixed(2));

    // Tax rate
    let taxRate = null;
    if (finalSubtotal > 0 && taxAmount > 0) {
      taxRate = parseFloat(((taxAmount / finalSubtotal) * 100).toFixed(2));
    }
        const fx = await convertToINR(totalAmount, currency, saleDate);


    // ── Fingerprint ──────────────────────────────────────────────────────────
    const fingerprint = await buildFingerprint(
      saleIdNormalized,
      saleDate,
      totalAmount,
      customerNameNorm,
      productNameNorm
    );

    const isDuplicate = seenFingerprints.has(fingerprint);
    if (!isDuplicate) seenFingerprints.set(fingerprint, i + 1);

    saleRecords.push({
      clientId,
      documentRecordId,
      uploadBatchId,
      fingerprint,

      // Sale identity
      saleId,
      saleIdNormalized,
      saleDate:       saleDate || "",

      // Customer
      customerName,
      customerNameNormalized: customerNameNorm,
      customerId,

      // Product / service
      productName,
      productNameNormalized: productNameNorm,
      category,
      salesperson,
      region,

      // Quantities
      quantity,
      unitPrice,
      discount,
      discountPct,

      // Amounts
      subtotal:       finalSubtotal,
      taxAmount,
      taxRate:        taxRate ?? 0,
      totalAmount,

      // Payment
      paymentMode,
      paymentStatus,
      currency,
      originalAmount:   fx.originalAmount,
      originalCurrency: fx.originalCurrency,
      exchangeRate:     fx.exchangeRate,
      exchangeRateDate: fx.rateDate,
      amountINR:        fx.amountINR,
      // Meta
      saleRowIndex:         i + 1,
      matchStatus:          "unmatched",
      matchedBankTxnId:     "",
      reconciliationStatus: "pending",
      processingStatus:     isDuplicate ? "duplicate" : "processed",
      processingNotes:      isDuplicate
                              ? `Duplicate of row ${seenFingerprints.get(fingerprint)}`
                              : "",
      isDuplicate,
      duplicateOfFingerprint: isDuplicate ? fingerprint : "",
      sourceFileName:       file.name,
      documentType:         "sales_report",
    });
  }

  return { saleRecords, warnings };
}