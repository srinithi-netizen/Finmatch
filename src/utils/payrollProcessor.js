/**
 * payrollProcessor.js
 * Parses a payroll XLSX/CSV file, extracts payroll records,
 * normalizes all fields, generates SHA-256 fingerprints,
 * and returns structured payroll objects ready for Appwrite.
 */

import * as XLSX from "xlsx";
import Papa from "papaparse";

// ─── Column aliases ────────────────────────────────────────────────────────────
const EMP_ID_ALIASES = [
  "employee id", "emp id", "employee number", "emp number",
  "employee code", "emp code", "staff id", "worker id", "id",
];

const EMP_NAME_ALIASES = [
  "employee name", "emp name", "name", "staff name",
  "full name", "worker name", "employee", "payee",
];

const DEPARTMENT_ALIASES = [
  "department", "dept", "division", "team", "unit", "cost center",
];

const DESIGNATION_ALIASES = [
  "designation", "position", "role", "title", "job title", "post",
];

const PAY_DATE_ALIASES = [
  "pay date", "payment date", "salary date", "paid date",
  "date", "payroll date", "disbursement date",
];

const PAY_PERIOD_ALIASES = [
  "pay period", "period", "month", "salary month", "payroll period",
  "pay month", "for month", "pay period month",
];

const BASIC_ALIASES = [
  "basic", "basic salary", "basic pay", "base salary", "base pay",
  "basic salary", "basic",
];

const HRA_ALIASES = [
  "hra", "house rent allowance", "house rent", "rent allowance",
];

const ALLOWANCES_ALIASES = [
  "allowances", "total allowances", "other allowances", "allowance",
  "special allowance", "conveyance", "transport allowance", "da",
  "dearness allowance",
];

const GROSS_ALIASES = [
  "gross pay", "gross salary", "gross", "gross earnings",
  "total earnings", "gross pay", "gross salary",
  "ctc", "cost to company",
];

const PF_ALIASES = [
  "pf", "provident fund", "epf", "employee pf", "pf deduction",
  "pf contribution",
];

const TAX_ALIASES = [
  "tds", "income tax", "tax", "tax deduction", "it deduction",
  "professional tax", "pt",
];

const OTHER_DEDUCTIONS_ALIASES = [
  "other deductions", "deductions", "other deduction", "loan deduction",
  "advance deduction", "misc deduction",
];

const TOTAL_DEDUCTIONS_ALIASES = [
  "total deductions", "total deduction", "deductions total",
  "net deductions",
];

const NET_PAY_ALIASES = [
  "net pay", "net salary", "take home", "take home pay", "net",
  "net payable", "in hand", "net amount", "salary payable",
  "net pay", "net salary",
];

const BANK_ACCOUNT_ALIASES = [
  "bank account", "account number", "acc no", "account no",
  "bank acc", "a/c number", "account", "bank account number",
];

const BANK_NAME_ALIASES = [
  "bank name", "bank", "bank branch",
];

const IFSC_ALIASES = [
  "ifsc", "ifsc code", "bank ifsc", "rtgs code",
];

const PAN_ALIASES = [
  "pan", "pan number", "pan no", "pan card",
];

const UAN_ALIASES = [
  "uan", "uan number", "universal account number",
];

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
    ...EMP_ID_ALIASES, ...EMP_NAME_ALIASES, ...DEPARTMENT_ALIASES,
    ...DESIGNATION_ALIASES, ...PAY_DATE_ALIASES, ...PAY_PERIOD_ALIASES,
    ...BASIC_ALIASES, ...HRA_ALIASES, ...ALLOWANCES_ALIASES,
    ...GROSS_ALIASES, ...PF_ALIASES, ...TAX_ALIASES,
    ...OTHER_DEDUCTIONS_ALIASES, ...TOTAL_DEDUCTIONS_ALIASES,
    ...NET_PAY_ALIASES, ...BANK_ACCOUNT_ALIASES, ...BANK_NAME_ALIASES,
    ...IFSC_ALIASES, ...PAN_ALIASES, ...UAN_ALIASES,
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
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
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

  // "May 2026" or "May-26" → first day of month
  m = str.match(/^([A-Za-z]{3,9})[- ](\d{2,4})$/);
  if (m) {
    const months = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[m[1].toLowerCase()];
    if (mo) {
      let yr = Number(m[2]);
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      return `${yr}-${String(mo).padStart(2,"0")}-01`;
    }
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

async function buildFingerprint(empIdNorm, payDate, netPay, empNameNorm) {
  const parts = [
    empIdNorm   || "",
    payDate     || "",
    netPay !== null ? Number(netPay).toFixed(2) : "",
    empNameNorm || "",
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
 * @returns {Promise<{ payrollRecords: object[], warnings: string[] }>}
 */
export async function processPayrollFile(file, clientId, documentRecordId, uploadBatchId) {
  const rawRows = await getRawRows(file);
  const warnings = [];

  if (rawRows.length === 0) {
    return { payrollRecords: [], warnings: ["No rows found in file."] };
  }

  // Find best header row
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
  const colEmpId          = findColumn(headers, EMP_ID_ALIASES);
  const colEmpName        = findColumn(headers, EMP_NAME_ALIASES);
  const colDepartment     = findColumn(headers, DEPARTMENT_ALIASES);
  const colDesignation    = findColumn(headers, DESIGNATION_ALIASES);
  const colPayDate        = findColumn(headers, PAY_DATE_ALIASES);
  const colPayPeriod      = findColumn(headers, PAY_PERIOD_ALIASES);
  const colBasic          = findColumn(headers, BASIC_ALIASES);
  const colHra            = findColumn(headers, HRA_ALIASES);
  const colAllowances     = findColumn(headers, ALLOWANCES_ALIASES);
  const colGross          = findColumn(headers, GROSS_ALIASES);
  const colPf             = findColumn(headers, PF_ALIASES);
  const colTax            = findColumn(headers, TAX_ALIASES);
  const colOtherDed       = findColumn(headers, OTHER_DEDUCTIONS_ALIASES);
  const colTotalDed       = findColumn(headers, TOTAL_DEDUCTIONS_ALIASES);
  const colNetPay         = findColumn(headers, NET_PAY_ALIASES);
  const colBankAccount    = findColumn(headers, BANK_ACCOUNT_ALIASES);
  const colBankName       = findColumn(headers, BANK_NAME_ALIASES);
  const colIfsc           = findColumn(headers, IFSC_ALIASES);
  const colPan            = findColumn(headers, PAN_ALIASES);
  const colUan            = findColumn(headers, UAN_ALIASES);

  console.log("[payrollProcessor] Headers:", headers);
  console.log("[payrollProcessor] Mapped:", {
    colEmpId, colEmpName, colDepartment, colDesignation,
    colPayDate, colPayPeriod, colBasic, colHra, colAllowances,
    colGross, colPf, colTax, colOtherDed, colTotalDed, colNetPay,
    colBankAccount, colBankName, colIfsc, colPan, colUan,
  });

  // Warn on missing critical columns
  if (!colEmpId)   warnings.push("Employee ID column not detected.");
  if (!colEmpName) warnings.push("Employee Name column not detected.");
  if (!colNetPay)  warnings.push("Net Pay column not detected — will attempt from gross minus deductions.");
  if (!colPayDate && !colPayPeriod) warnings.push("Pay Date and Pay Period columns not detected.");

  const payrollRecords = [];
  const seenFingerprints = new Map();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;

    const r = {};
    headers.forEach((h, idx) => { r[h] = row[idx] !== undefined ? row[idx] : ""; });

    const rawEmpId       = colEmpId       ? r[colEmpId]       : null;
    const rawEmpName     = colEmpName     ? r[colEmpName]     : null;
    const rawDept        = colDepartment  ? r[colDepartment]  : null;
    const rawDesig       = colDesignation ? r[colDesignation] : null;
    const rawPayDate     = colPayDate     ? r[colPayDate]     : null;
    const rawPayPeriod   = colPayPeriod   ? r[colPayPeriod]   : null;
    const rawBasic       = colBasic       ? r[colBasic]       : null;
    const rawHra         = colHra         ? r[colHra]         : null;
    const rawAllowances  = colAllowances  ? r[colAllowances]  : null;
    const rawGross       = colGross       ? r[colGross]       : null;
    const rawPf          = colPf          ? r[colPf]          : null;
    const rawTax         = colTax         ? r[colTax]         : null;
    const rawOtherDed    = colOtherDed    ? r[colOtherDed]    : null;
    const rawTotalDed    = colTotalDed    ? r[colTotalDed]    : null;
    const rawNetPay      = colNetPay      ? r[colNetPay]      : null;
    const rawBankAccount = colBankAccount ? r[colBankAccount] : null;
    const rawBankName    = colBankName    ? r[colBankName]    : null;
    const rawIfsc        = colIfsc        ? r[colIfsc]        : null;
    const rawPan         = colPan         ? r[colPan]         : null;
    const rawUan         = colUan         ? r[colUan]         : null;

    // Skip rows with no employee id AND no name (blank/summary rows)
    const hasEmpId   = rawEmpId   !== null && String(rawEmpId).trim()   !== "";
    const hasEmpName = rawEmpName !== null && String(rawEmpName).trim() !== "";
    if (!hasEmpId && !hasEmpName) continue;

    // ── Employee fields ──────────────────────────────────────────────────────
    const employeeId           = normalizeText(rawEmpId);
    const employeeIdNormalized = normalizeForFingerprint(rawEmpId);
    const employeeName         = normalizeText(rawEmpName);
    const employeeNameNorm     = normalizeForFingerprint(rawEmpName);
    const department           = normalizeText(rawDept);
    const designation          = normalizeText(rawDesig);

    // ── Date fields ──────────────────────────────────────────────────────────
    const payDate   = normalizeDate(rawPayDate);
    const payPeriod = normalizeDate(rawPayPeriod) || normalizeText(rawPayPeriod);

    if (rawPayDate && !payDate)
      warnings.push(`Row ${i + 1}: Could not parse pay date "${rawPayDate}".`);

    // ── Amount fields ────────────────────────────────────────────────────────
    const basicSalary    = parseAmount(rawBasic)      ?? 0;
    const hra            = parseAmount(rawHra)         ?? 0;
    const allowances     = parseAmount(rawAllowances)  ?? 0;
    const pfDeduction    = parseAmount(rawPf)          ?? 0;
    const taxDeduction   = parseAmount(rawTax)         ?? 0;
    const otherDeductions= parseAmount(rawOtherDed)    ?? 0;

    // Gross pay: use column or compute from components
    let grossPay = parseAmount(rawGross);
    if (grossPay === null) {
      grossPay = basicSalary + hra + allowances;
      if (grossPay > 0)
        warnings.push(`Row ${i + 1}: Gross Pay not found. Computed as basic + HRA + allowances = ${grossPay}.`);
    }

    // Total deductions: use column or compute from components
    let totalDeductions = parseAmount(rawTotalDed);
    if (totalDeductions === null) {
      totalDeductions = pfDeduction + taxDeduction + otherDeductions;
    }

    // Net pay: use column or compute from gross - deductions
    let netPay = parseAmount(rawNetPay);
    if (netPay === null && grossPay !== null) {
      netPay = parseFloat((grossPay - totalDeductions).toFixed(2));
      warnings.push(`Row ${i + 1}: Net Pay not found. Computed as gross - deductions = ${netPay}.`);
    }

    // Skip rows with no usable net pay
    if (netPay === null) {
      warnings.push(`Row ${i + 1}: Skipped — no net pay found.`);
      continue;
    }

    // ── Bank / compliance fields ─────────────────────────────────────────────
    const bankAccount = normalizeText(rawBankAccount);
    const bankName    = normalizeText(rawBankName);
    const ifscCode    = normalizeText(rawIfsc).toUpperCase();
    const panNumber   = normalizeText(rawPan).toUpperCase();
    const uanNumber   = normalizeText(rawUan);

    // ── Fingerprint (empId + payDate + netPay + empName) ─────────────────────
    const fingerprint = await buildFingerprint(
      employeeIdNormalized,
      payDate || payPeriod || "",
      netPay,
      employeeNameNorm
    );

    const isDuplicate = seenFingerprints.has(fingerprint);
    if (!isDuplicate) seenFingerprints.set(fingerprint, i + 1);

    payrollRecords.push({
      clientId,
      documentRecordId,
      uploadBatchId,
      fingerprint,

      // Employee info
      employeeId,
      employeeIdNormalized,
      employeeName,
      employeeNameNormalized: employeeNameNorm,
      department,
      designation,

      // Pay period
      payDate:    payDate    || "",
      payPeriod:  typeof payPeriod === "string" ? payPeriod : (payPeriod || ""),

      // Earnings
      basicSalary,
      hra,
      allowances,
      grossPay:   grossPay ?? 0,

      // Deductions
      pfDeduction,
      taxDeduction,
      otherDeductions,
      totalDeductions: totalDeductions ?? 0,

      // Net
      netPay,

      // Bank / compliance
      bankAccount,
      bankName,
      ifscCode,
      panNumber,
      uanNumber,

      // Meta
      payrollRowIndex:      i + 1,
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
      documentType:         "payroll",
    });
  }

  return { payrollRecords, warnings };
}