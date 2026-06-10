const HEADER_ALIASES = {
  // Common
  date: ["date", "txn date", "transaction date", "value date", "invoice date", "bill date"],
  description: ["description", "particulars", "narration", "details", "remarks", "service description", "item description"],
  amount: ["amount", "amt", "value", "total", "total (₹)", "total amount", "grand total", "invoice total", "net payable", "amount (₹)", "payable amount"],
  debit: ["debit", "withdrawal", "dr"],
  credit: ["credit", "deposit", "cr"],

  // Invoice - expanded aliases
  invoiceNumber: [
    "invoice number", "invoice no", "invoice #", "inv no", "invoice id",
    "bill number", "bill no", "voucher no", "doc no", "document number",
    "invoice_no", "inv_no", "inv no.", "invoice no."
  ],
  invoiceDate: [
    "invoice date", "bill date", "date", "inv date", "document date",
    "txn date", "transaction date", "invoice_date"
  ],
  dueDate: [
    "due date", "payment due", "due by", "pay by", "expiry date", "due_date"
  ],
  vendorCustomer: [
    "vendor", "customer", "vendor/customer", "client", "supplier",
    "vendor name", "customer name", "client name", "supplier name",
    "buyer", "billed to", "bill to", "party name", "party",
    "from", "billed from", "seller", "to"
  ],
  // Keep separate vendor/customer for invoice processor
  vendor: [
    "vendor", "vendor name", "supplier", "supplier name",
    "from", "billed from", "seller", "party name"
  ],
  customer: [
    "customer", "customer name", "client", "client name",
    "buyer", "billed to", "bill to", "to", "party"
  ],

  // Amounts
  subtotal: [
    "subtotal", "sub total", "net amount", "taxable amount",
    "base amount", "amount before tax", "subtotal (₹)"
  ],
  taxAmount: [
    "tax", "gst", "vat", "tax amount", "gst amount",
    "tax (₹)", "gst (₹)", "cgst", "sgst", "igst",
    "gst 18%", "gst 18% (₹)", "gst18%", "tax 18%"
  ],
  totalAmount: [
    "total", "total amount", "invoice total", "grand total",
    "amount", "net payable", "total (₹)", "amount (₹)",
    "payable amount", "invoice amount"
  ],
  amountPaid: ["amount paid", "paid amount", "payment received", "paid"],
  amountDue: ["amount due", "balance due", "outstanding", "remaining", "balance payable"],
  currency: ["currency", "curr"],

  // Sales
  saleDate: ["sale date", "date", "order date"],

  // Expense
  expenseDate: ["expense date", "date", "exp date", "expense dt"],
  expenseVendor: ["vendor", "payee", "merchant", "vendor name"],
  category: ["category", "expense category", "type"],

  // Payroll
  employeeId: ["employee id", "emp id", "employee number", "emp no", "employee code"],
  employeeName: ["employee name", "name", "emp name"],
  payDate: ["pay date", "payment date", "salary date"],
  grossPay: ["gross pay", "gross salary", "total pay", "salary", "gross pay (₹)"],
};

export function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/\s*\d+%\s*/g, " ")        // strip "18%", "28%" etc  ← ADD THIS
    .replace(/[\(（][^)）]*[\)）]/g, "") // remove (₹), (USD) etc
    .replace(/[₹$€£]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapHeaders(rawHeaders, fieldsToFind) {
  const normalizedHeaders = rawHeaders.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
  }));

  const result = {};

  for (const field of fieldsToFind) {
    const aliases = HEADER_ALIASES[field] || [field];
    const match = normalizedHeaders.find((h) => aliases.includes(h.normalized));
    result[field] = match ? match.original : null;
  }

  return result;
}




export { HEADER_ALIASES };