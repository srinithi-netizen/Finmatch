import { mapHeaders } from "./columnMapper";

const TODAY = new Date();
TODAY.setHours(23, 59, 59, 999); // end of today, for future-date comparisons

const VALID_EXPENSE_CATEGORIES = [
  "travel",
  "meals",
  "software",
  "office supplies",
  "utilities",
  "rent",
  "marketing",
  "professional fees",
  "insurance",
  "other",
];

// ---------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------

function isEmpty(val) {
  return val === null || val === undefined || String(val).trim() === "";
}

/**
 * Parses a date value that may be:
 * - Excel serial number
 * - "YYYY-MM-DD"
 * - "DD/MM/YYYY"
 * - "MM/DD/YYYY"
 * - JS Date object
 * Returns a Date object or null if invalid.
 */
function parseFlexibleDate(val) {
  if (val === null || val === undefined || val === "") return null;

  // Already a Date object (from XLSX parsing with cellDates)
  if (val instanceof Date && !isNaN(val.getTime())) return val;

  // Excel serial date number
  if (typeof val === "number") {
    // Excel epoch starts 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + val * 86400000);
    if (!isNaN(date.getTime())) return date;
    return null;
  }

  const str = String(val).trim();

  // ISO format YYYY-MM-DD
  let match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match.map(Number);
    return validateAndBuildDate(y, m, d);
  }

  // DD/MM/YYYY or MM/DD/YYYY (try DD/MM/YYYY first, common in financial docs)
  match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, a, b, y] = match.map(Number);

    // Try DD/MM/YYYY first
    let date = validateAndBuildDate(y, b, a);
    if (date) return date;

    // Fallback: MM/DD/YYYY
    date = validateAndBuildDate(y, a, b);
    if (date) return date;

    return null;
  }

  // DD-MM-YYYY
  match = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const [, a, b, y] = match.map(Number);
    let date = validateAndBuildDate(y, b, a);
    if (date) return date;
    date = validateAndBuildDate(y, a, b);
    if (date) return date;
    return null;
  }

  return null;
}

function validateAndBuildDate(year, month, day) {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  // Check the date didn't "roll over" (e.g. Feb 30 -> Mar 2)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function isFutureDate(date) {
  return date.getTime() > TODAY.getTime();
}

/**
 * Parses a numeric/currency value.
 * Handles: "1,250.50", "$1250.50", "(500)" for negatives, plain numbers.
 * Returns Number or null if not numeric.
 */
function parseAmount(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;

  let str = String(val).trim();
  if (str === "") return null;

  let isNegative = false;

  // Parentheses denote negative in accounting: (500) -> -500
  if (str.startsWith("(") && str.endsWith(")")) {
    isNegative = true;
    str = str.slice(1, -1);
  }

  // Remove currency symbols, commas, spaces
  str = str.replace(/[$,€£₹\s]/g, "");

  if (str === "" || isNaN(Number(str))) return null;

  let num = Number(str);
  if (isNegative) num = -Math.abs(num);

  return num;
}

function getField(row, fieldMap, fieldName) {
  const header = fieldMap[fieldName];
  if (!header) return undefined;
  return row[header];
}

function rowToString(row) {
  // Compact representation for displaying the offending row
  return Object.entries(row)
    .filter(([k]) => k && k.trim() !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
}

// ---------------------------------------------------------------------
// Document-type-specific validators
// Each returns: { errors: [...], summary: {...} }
// Each error object: { rowNumber, severity: 'error'|'warning', field, message, rowData }
// ---------------------------------------------------------------------

function validateBankStatement(rows) {
  const fieldsNeeded = ["date", "description", "amount", "debit", "credit"];
  const errors = [];
  const seen = new Map(); // for duplicate detection

  if (rows.length === 0) {
    return { errors: [{ rowNumber: 0, severity: "error", field: "file", message: "No data rows found in file.", rowData: "" }] };
  }

  const fieldMap = mapHeaders(Object.keys(rows[0]), fieldsNeeded);

  const hasAmountCol = !!fieldMap.amount;
  const hasDebitCreditCols = !!fieldMap.debit || !!fieldMap.credit;

  if (!fieldMap.date) {
    errors.push({ rowNumber: 0, severity: "error", field: "date", message: 'Required column "Date" not found in file headers.', rowData: "" });
  }
  if (!fieldMap.description) {
    errors.push({ rowNumber: 0, severity: "error", field: "description", message: 'Required column "Description" not found in file headers.', rowData: "" });
  }
  if (!hasAmountCol && !hasDebitCreditCols) {
    errors.push({ rowNumber: 0, severity: "error", field: "amount", message: 'File must contain either an "Amount" column or "Debit"/"Credit" columns.', rowData: "" });
  }

  // If headers fundamentally missing, stop here
  if (errors.length > 0 && (!fieldMap.date || !fieldMap.description || (!hasAmountCol && !hasDebitCreditCols))) {
    return { errors };
  }

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // +1 for header row, +1 for 1-based index
    const rowData = rowToString(row);

    const dateVal = getField(row, fieldMap, "date");
    const descVal = getField(row, fieldMap, "description");
    const amountVal = getField(row, fieldMap, "amount");
    const debitVal = getField(row, fieldMap, "debit");
    const creditVal = getField(row, fieldMap, "credit");

    // 1. Date exists & valid
    if (isEmpty(dateVal)) {
      errors.push({ rowNumber, severity: "error", field: "date", message: "Date is empty.", rowData });
    } else {
      const parsedDate = parseFlexibleDate(dateVal);
      if (!parsedDate) {
        errors.push({ rowNumber, severity: "error", field: "date", message: `Invalid date format: "${dateVal}".`, rowData });
      } else if (isFutureDate(parsedDate)) {
        errors.push({ rowNumber, severity: "warning", field: "date", message: `Future-dated transaction: "${dateVal}".`, rowData });
      }
    }

    // 2. Description exists
    if (isEmpty(descVal)) {
      errors.push({ rowNumber, severity: "error", field: "description", message: "Description is empty.", rowData });
    }

    // 3. Amount checks
    if (hasAmountCol) {
      if (isEmpty(amountVal)) {
        errors.push({ rowNumber, severity: "error", field: "amount", message: "Amount is empty.", rowData });
      } else {
        const num = parseAmount(amountVal);
        if (num === null) {
          errors.push({ rowNumber, severity: "error", field: "amount", message: `Amount is not numeric: "${amountVal}".`, rowData });
        }
      }
    } else {
      // Debit/Credit consistency
      const debitNum = isEmpty(debitVal) ? 0 : parseAmount(debitVal);
      const creditNum = isEmpty(creditVal) ? 0 : parseAmount(creditVal);

      if (!isEmpty(debitVal) && debitNum === null) {
        errors.push({ rowNumber, severity: "error", field: "debit", message: `Debit is not numeric: "${debitVal}".`, rowData });
      }
      if (!isEmpty(creditVal) && creditNum === null) {
        errors.push({ rowNumber, severity: "error", field: "credit", message: `Credit is not numeric: "${creditVal}".`, rowData });
      }

      const validDebit = debitNum !== null ? debitNum : 0;
      const validCredit = creditNum !== null ? creditNum : 0;

      if (validDebit > 0 && validCredit > 0) {
        errors.push({ rowNumber, severity: "error", field: "debit/credit", message: "Both Debit and Credit are populated; only one should have a value.", rowData });
      }
      if (validDebit === 0 && validCredit === 0) {
        errors.push({ rowNumber, severity: "error", field: "debit/credit", message: "Both Debit and Credit are empty/zero.", rowData });
      }
      if (validDebit < 0 || validCredit < 0) {
        errors.push({ rowNumber, severity: "error", field: "debit/credit", message: "Debit/Credit values cannot be negative.", rowData });
      }
    }

    // 4. Duplicate transaction (date + amount + description)
    const dupAmount = hasAmountCol
      ? parseAmount(amountVal)
      : (parseAmount(debitVal) || 0) - (parseAmount(creditVal) || 0);

    const dupKey = `${dateVal}|${dupAmount}|${String(descVal).trim().toLowerCase()}`;
    if (seen.has(dupKey)) {
      errors.push({
        rowNumber,
        severity: "warning",
        field: "duplicate",
        message: `Possible duplicate of row ${seen.get(dupKey)} (same date, amount, description).`,
        rowData,
      });
    } else {
      seen.set(dupKey, rowNumber);
    }
  });

  return { errors };
}

function validateInvoices(rows) {
  const errors = [];
  const seenInvoiceNumbers = new Map();

  if (rows.length === 0) {
    return {
      errors: [{ rowNumber: 0, severity: "error", field: "file", message: "No data rows found in file.", rowData: "" }],
    };
  }

  const headers = Object.keys(rows[0]);

  // Try to find invoice number column
  const invNumMap = mapHeaders(headers, ["invoiceNumber"]);
  // Try to find a name column (vendor OR customer — either is fine for invoices)
  const vendorMap = mapHeaders(headers, ["vendor"]);
  const customerMap = mapHeaders(headers, ["customer"]);
  const vendorCustomerMap = mapHeaders(headers, ["vendorCustomer"]);
  // Try to find amount from multiple possible columns
  const totalMap = mapHeaders(headers, ["totalAmount"]);
  const amountMap = mapHeaders(headers, ["amount"]);
  const dateMap = mapHeaders(headers, ["invoiceDate"]);

  // Resolve which columns to actually use
  const invNumCol = invNumMap.invoiceNumber;
  const nameCol = vendorCustomerMap.vendorCustomer || customerMap.customer || vendorMap.vendor;
  const amountCol = totalMap.totalAmount || amountMap.amount;
  const dateCol = dateMap.invoiceDate;

  // Report missing critical columns
  const missingHeaders = [];
  if (!invNumCol) missingHeaders.push("Invoice Number");
  if (!nameCol)   missingHeaders.push("Vendor/Customer Name");
  if (!amountCol) missingHeaders.push("Total Amount");

  if (missingHeaders.length > 0) {
    errors.push({
      rowNumber: 0,
      severity: "error",
      field: "headers",
      message: `Required column(s) not found: ${missingHeaders.join(", ")}.`,
      rowData: `Available headers: ${headers.join(", ")}`,
    });
    return { errors };
  }

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const rowData = rowToString(row);

    const invNum = row[invNumCol];
    const invDate = dateCol ? row[dateCol] : null;
    const nameVal = row[nameCol];
    const amountVal = row[amountCol];

    // Invoice Number required + duplicate check
    if (isEmpty(invNum)) {
      errors.push({ rowNumber, severity: "error", field: "invoiceNumber", message: "Invoice Number is empty.", rowData });
    } else {
      const key = String(invNum).trim().toLowerCase();
      if (seenInvoiceNumbers.has(key)) {
        errors.push({
          rowNumber,
          severity: "error",
          field: "invoiceNumber",
          message: `Duplicate Invoice Number "${invNum}" (also on row ${seenInvoiceNumbers.get(key)}).`,
          rowData,
        });
      } else {
        seenInvoiceNumbers.set(key, rowNumber);
      }
    }

    // Name (vendor or customer) required
    if (isEmpty(nameVal)) {
      errors.push({ rowNumber, severity: "error", field: "vendorCustomer", message: "Vendor/Customer is empty.", rowData });
    }

    // Date valid (warn only if date column exists)
    if (dateCol) {
      if (isEmpty(invDate)) {
        errors.push({ rowNumber, severity: "warning", field: "invoiceDate", message: "Invoice Date is empty.", rowData });
      } else {
        const parsedDate = parseFlexibleDate(invDate);
        if (!parsedDate) {
          errors.push({ rowNumber, severity: "error", field: "invoiceDate", message: `Invalid date: "${invDate}".`, rowData });
        } else if (isFutureDate(parsedDate)) {
          errors.push({ rowNumber, severity: "warning", field: "invoiceDate", message: `Future invoice date: "${invDate}".`, rowData });
        }
      }
    }

    // Amount numeric & not negative
    if (isEmpty(amountVal)) {
      errors.push({ rowNumber, severity: "error", field: "amount", message: "Amount is empty.", rowData });
    } else {
      const num = parseAmount(amountVal);
      if (num === null) {
        errors.push({ rowNumber, severity: "error", field: "amount", message: `Amount is not numeric: "${amountVal}".`, rowData });
      } else if (num < 0) {
        errors.push({ rowNumber, severity: "error", field: "amount", message: `Negative invoice amount: ${num}.`, rowData });
      }
    }
  });

  return { errors };
}

function validateSalesReport(rows) {
  const fieldsNeeded = ["saleDate", "customer", "amount"];
  const errors = [];
  const seen = new Map();

  if (rows.length === 0) {
    return { errors: [{ rowNumber: 0, severity: "error", field: "file", message: "No data rows found in file.", rowData: "" }] };
  }

  const fieldMap = mapHeaders(Object.keys(rows[0]), fieldsNeeded);

  const missingHeaders = [];
  if (!fieldMap.saleDate) missingHeaders.push("Sale Date");
  if (!fieldMap.customer) missingHeaders.push("Customer");
  if (!fieldMap.amount) missingHeaders.push("Amount");

  if (missingHeaders.length > 0) {
    errors.push({ rowNumber: 0, severity: "error", field: "headers", message: `Required column(s) not found: ${missingHeaders.join(", ")}.`, rowData: "" });
    return { errors };
  }

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const rowData = rowToString(row);

    const saleDate = getField(row, fieldMap, "saleDate");
    const customer = getField(row, fieldMap, "customer");
    const amount = getField(row, fieldMap, "amount");

    // Date valid
    if (isEmpty(saleDate)) {
      errors.push({ rowNumber, severity: "error", field: "saleDate", message: "Sale Date is empty.", rowData });
    } else {
      const parsedDate = parseFlexibleDate(saleDate);
      if (!parsedDate) {
        errors.push({ rowNumber, severity: "error", field: "saleDate", message: `Invalid date: "${saleDate}".`, rowData });
      }
    }

    // Customer required
    if (isEmpty(customer)) {
      errors.push({ rowNumber, severity: "error", field: "customer", message: "Customer is empty.", rowData });
    }

    // Amount > 0
    if (isEmpty(amount)) {
      errors.push({ rowNumber, severity: "error", field: "amount", message: "Amount is empty.", rowData });
    } else {
      const num = parseAmount(amount);
      if (num === null) {
        errors.push({ rowNumber, severity: "error", field: "amount", message: `Amount is not numeric: "${amount}".`, rowData });
      } else if (num <= 0) {
        errors.push({ rowNumber, severity: "error", field: "amount", message: `Amount must be greater than 0 (found ${num}).`, rowData });
      }
    }

    // Duplicate (date + customer + amount)
    if (!isEmpty(saleDate) && !isEmpty(customer) && !isEmpty(amount)) {
      const num = parseAmount(amount);
      const key = `${saleDate}|${String(customer).trim().toLowerCase()}|${num}`;
      if (seen.has(key)) {
        errors.push({ rowNumber, severity: "warning", field: "duplicate", message: `Possible duplicate of row ${seen.get(key)} (same date, customer, amount).`, rowData });
      } else {
        seen.set(key, rowNumber);
      }
    }
  });

  return { errors };
}

function validateExpenseReport(rows) {
  const fieldsNeeded = ["expenseDate", "vendor", "amount", "category"];
  const errors = [];
  const seen = new Map();

  if (rows.length === 0) {
    return { errors: [{ rowNumber: 0, severity: "error", field: "file", message: "No data rows found in file.", rowData: "" }] };
  }

  const fieldMap = mapHeaders(Object.keys(rows[0]), fieldsNeeded);

  const missingHeaders = [];
  if (!fieldMap.expenseDate) missingHeaders.push("Expense Date");
  if (!fieldMap.vendor) missingHeaders.push("Vendor");
  if (!fieldMap.amount) missingHeaders.push("Amount");
  if (!fieldMap.category) missingHeaders.push("Category");

  if (missingHeaders.length > 0) {
    errors.push({ rowNumber: 0, severity: "error", field: "headers", message: `Required column(s) not found: ${missingHeaders.join(", ")}.`, rowData: "" });
    return { errors };
  }

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const rowData = rowToString(row);

    const expDate = getField(row, fieldMap, "expenseDate");
    const vendor = getField(row, fieldMap, "vendor");
    const amount = getField(row, fieldMap, "amount");
    const category = getField(row, fieldMap, "category");

    // Vendor required
    if (isEmpty(vendor)) {
      errors.push({ rowNumber, severity: "error", field: "vendor", message: "Vendor is empty.", rowData });
    }

    // Amount numeric
    let amountNum = null;
    if (isEmpty(amount)) {
      errors.push({ rowNumber, severity: "error", field: "amount", message: "Amount is empty.", rowData });
    } else {
      amountNum = parseAmount(amount);
      if (amountNum === null) {
        errors.push({ rowNumber, severity: "error", field: "amount", message: `Amount is not numeric: "${amount}".`, rowData });
      }
    }

    // Category exists & is one of allowed values (warning if not in known list)
    if (isEmpty(category)) {
      errors.push({ rowNumber, severity: "error", field: "category", message: "Category is empty.", rowData });
    } else if (!VALID_EXPENSE_CATEGORIES.includes(String(category).trim().toLowerCase())) {
      errors.push({ rowNumber, severity: "warning", field: "category", message: `Category "${category}" is not a recognized category.`, rowData });
    }

    // Future expense
    if (isEmpty(expDate)) {
      errors.push({ rowNumber, severity: "error", field: "expenseDate", message: "Expense Date is empty.", rowData });
    } else {
      const parsedDate = parseFlexibleDate(expDate);
      if (!parsedDate) {
        errors.push({ rowNumber, severity: "error", field: "expenseDate", message: `Invalid date: "${expDate}".`, rowData });
      } else if (isFutureDate(parsedDate)) {
        errors.push({ rowNumber, severity: "warning", field: "expenseDate", message: `Future-dated expense: "${expDate}".`, rowData });
      }
    }

    // Duplicate (date + vendor + amount)
    if (!isEmpty(expDate) && !isEmpty(vendor) && amountNum !== null) {
      const key = `${expDate}|${String(vendor).trim().toLowerCase()}|${amountNum}`;
      if (seen.has(key)) {
        errors.push({ rowNumber, severity: "warning", field: "duplicate", message: `Possible duplicate of row ${seen.get(key)} (same date, vendor, amount).`, rowData });
      } else {
        seen.set(key, rowNumber);
      }
    }
  });

  return { errors };
}

function validatePayrollReport(rows) {
  const fieldsNeeded = ["employeeId", "employeeName", "payDate", "grossPay"];
  const errors = [];
  const seen = new Map();

  if (rows.length === 0) {
    return { errors: [{ rowNumber: 0, severity: "error", field: "file", message: "No data rows found in file.", rowData: "" }] };
  }

  const fieldMap = mapHeaders(Object.keys(rows[0]), fieldsNeeded);

  const missingHeaders = [];
  if (!fieldMap.employeeId) missingHeaders.push("Employee ID");
  if (!fieldMap.employeeName) missingHeaders.push("Employee Name");
  if (!fieldMap.payDate) missingHeaders.push("Pay Date");
  if (!fieldMap.grossPay) missingHeaders.push("Gross Pay");

  if (missingHeaders.length > 0) {
    errors.push({ rowNumber: 0, severity: "error", field: "headers", message: `Required column(s) not found: ${missingHeaders.join(", ")}.`, rowData: "" });
    return { errors };
  }

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const rowData = rowToString(row);

    const empId = getField(row, fieldMap, "employeeId");
    const empName = getField(row, fieldMap, "employeeName");
    const payDate = getField(row, fieldMap, "payDate");
    const grossPay = getField(row, fieldMap, "grossPay");

    // Employee ID required
    if (isEmpty(empId)) {
      errors.push({ rowNumber, severity: "error", field: "employeeId", message: "Employee ID is empty.", rowData });
    }

    // Employee Name required (implied by required fields list)
    if (isEmpty(empName)) {
      errors.push({ rowNumber, severity: "error", field: "employeeName", message: "Employee Name is empty.", rowData });
    }

    // Pay date valid
    let parsedPayDate = null;
    if (isEmpty(payDate)) {
      errors.push({ rowNumber, severity: "error", field: "payDate", message: "Pay Date is empty.", rowData });
    } else {
      parsedPayDate = parseFlexibleDate(payDate);
      if (!parsedPayDate) {
        errors.push({ rowNumber, severity: "error", field: "payDate", message: `Invalid pay date: "${payDate}".`, rowData });
      }
    }

    // Gross Pay numeric & > 0
    let grossPayNum = null;
    if (isEmpty(grossPay)) {
      errors.push({ rowNumber, severity: "error", field: "grossPay", message: "Gross Pay is empty.", rowData });
    } else {
      grossPayNum = parseAmount(grossPay);
      if (grossPayNum === null) {
        errors.push({ rowNumber, severity: "error", field: "grossPay", message: `Gross Pay is not numeric: "${grossPay}".`, rowData });
      } else if (grossPayNum <= 0) {
        errors.push({ rowNumber, severity: "error", field: "grossPay", message: `Gross Pay must be greater than 0 (found ${grossPayNum}).`, rowData });
      }
    }

    // Duplicate (Employee ID + Pay Date)
    if (!isEmpty(empId) && parsedPayDate) {
      const key = `${String(empId).trim().toLowerCase()}|${parsedPayDate.toISOString().slice(0, 10)}`;
      if (seen.has(key)) {
        errors.push({ rowNumber, severity: "error", field: "duplicate", message: `Duplicate payroll row: Employee ID "${empId}" already has an entry for this Pay Date (row ${seen.get(key)}).`, rowData });
      } else {
        seen.set(key, rowNumber);
      }
    }
  });

  return { errors };
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------

const VALIDATORS = {
  bank_statement: validateBankStatement,
  invoice: validateInvoices,
  sales_report: validateSalesReport,
  expense_report: validateExpenseReport,
  payroll: validatePayrollReport,
};

export const DOCUMENT_TYPES = [
  { value: "bank_statement", label: "Bank Statement" },
  { value: "invoice", label: "Invoices" },
  { value: "sales_report", label: "Sales Report" },
  { value: "expense_report", label: "Expense Report" },
  { value: "revenue_report", label: "Revenue Report" }, // uses sales validator
  { value: "payroll", label: "Payroll Report" },
];

/**
 * Validates parsed rows against the rules for the given document type.
 * @param {string} documentType - one of DOCUMENT_TYPES values
 * @param {object[]} rows - array of row objects (from fileParser)
 * @returns {{ errors: Array, errorCount: number, warningCount: number, totalRows: number }}
 */
export function validateRows(documentType, rows) {
  // Revenue report uses the same rules as sales report
  const type = documentType === "revenue_report" ? "sales_report" : documentType;
  const validator = VALIDATORS[type];

  if (!validator) {
    return {
      errors: [{ rowNumber: 0, severity: "error", field: "documentType", message: `Unknown document type: "${documentType}".`, rowData: "" }],
      errorCount: 1,
      warningCount: 0,
      totalRows: rows ? rows.length : 0,
    };
  }

  const { errors } = validator(rows);

  const errorCount = errors.filter((e) => e.severity === "error").length;
  const warningCount = errors.filter((e) => e.severity === "warning").length;

  return {
    errors,
    errorCount,
    warningCount,
    totalRows: rows.length,
  };
}