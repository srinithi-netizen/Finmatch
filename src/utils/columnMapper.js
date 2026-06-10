// Maps incoming header variations -> standard field names per document type

const HEADER_ALIASES = {
  // Common
  date: ["date", "txn date", "transaction date", "value date"],
  description: ["description", "particulars", "narration", "details", "remarks"],
  amount: ["amount", "amt", "value", "total"],
  debit: ["debit", "withdrawal", "dr"],
  credit: ["credit", "deposit", "cr"],

  // Invoice
  invoiceNumber: ["invoice number", "invoice no", "invoice #", "inv no", "invoice id"],
  invoiceDate: ["invoice date", "bill date", "date"],
  vendorCustomer: ["vendor", "customer", "vendor/customer", "client", "supplier"],

  // Sales
  saleDate: ["sale date", "date", "order date"],
  customer: ["customer", "client", "buyer", "customer name"],

  // Expense
  expenseDate: ["expense date", "date"],
  vendor: ["vendor", "payee", "merchant"],
  category: ["category", "expense category", "type"],

  // Payroll
  employeeId: ["employee id", "emp id", "employee number", "emp no", "employee code"],
  employeeName: ["employee name", "name", "emp name"],
  payDate: ["pay date", "payment date", "salary date"],
  grossPay: ["gross pay", "gross salary", "total pay", "salary"],
};

function normalizeHeader(header) {
  return String(header).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Builds a map of { standardField: actualHeaderInFile }
 * by matching normalized headers against alias lists.
 */
export function mapHeaders(rawHeaders, fieldsToFind) {
  const normalizedHeaders = rawHeaders.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
  }));

  const result = {};

  for (const field of fieldsToFind) {
    const aliases = HEADER_ALIASES[field] || [field];
    const match = normalizedHeaders.find((h) =>
      aliases.includes(h.normalized)
    );
    result[field] = match ? match.original : null;
  }

  return result;
}

export { HEADER_ALIASES, normalizeHeader };