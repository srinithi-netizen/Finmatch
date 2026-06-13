// reconciliationEngine.js
// Deterministic-first reconciliation engine for:
//   Bank Statement <-> Invoices / Payroll / Expenses
// Ollama is only used as a last-resort fallback for transactions that
// remain genuinely unresolved after all deterministic + rule-based stages.

// ============================================================
// CONFIG
// ============================================================
const AMOUNT_TOLERANCE = 1; // ₹ tolerance for "exact" match
const DATE_WINDOW_DAYS_STRICT = 7; // for one-to-one / reference matches
const DATE_WINDOW_DAYS_LOOSE = 15; // for expense <-> bank fuzzy matches
const MAX_COMBO_SIZE = 6; // max items combined in subset-sum search
const SIMILARITY_THRESHOLD = 0.25; // token-overlap threshold for fuzzy desc match

const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.2";

// ============================================================
// DATE / AMOUNT UTILITIES
// ============================================================
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Parses "01-May-26" or "2026-05-01" or Date objects
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;

  const s = String(val).trim();

  // DD-Mon-YY
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].toLowerCase()];
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (mon === undefined) return null;
    return new Date(year, mon, day);
  }

  // ISO-ish
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function dateDiffDays(d1, d2) {
  if (!d1 || !d2) return Infinity;
  return Math.abs((d1.getTime() - d2.getTime()) / 86400000);
}

function parseAmount(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Math.round(val * 100) / 100;
  const n = parseFloat(String(val).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function amountsEqual(a, b, tol = AMOUNT_TOLERANCE) {
  return Math.abs(a - b) <= tol;
}

function fmt(n) {
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// ============================================================
// TEXT UTILITIES
// ============================================================
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "at",
  "with", "by", "from", "via", "may", "2026", "2025", "pvt", "ltd",
]);

function tokenize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Token-overlap (Jaccard-like) similarity, robust for short business strings
function textSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size); // proportion of smaller set matched
}

// ============================================================
// REFERENCE EXTRACTION  (e.g. "INV-1010+INV-1011", "EMP004+EMP005...")
// ============================================================
// Handles single refs ("INV-1001") AND multi-refs in one cluster
// ("INV-1007+1008+1009", "INV-1010+INV-1011")
function extractInvoiceRefs(text) {
  const out = new Set();
  const groupRe = /INV[-\s]?\d{3,5}(?:\s*[+&]\s*(?:INV[-\s]?)?\d{3,5})*/gi;
  let g;
  while ((g = groupRe.exec(text || ""))) {
    const numRe = /\d{3,5}/g;
    let m;
    while ((m = numRe.exec(g[0]))) out.add(`INV-${m[0]}`);
  }
  return [...out];
}

// Only treat EMP refs as PAYROLL links when the description is actually a
// salary payment — avoids pulling in "Advance – EMP003 ..." or
// "Reimbursement – Travel Claims EMP002" (those are employee-related but
// are NOT payroll disbursements and are handled by Stage 4 instead).
function extractEmployeeRefs(text) {
  if (!/salary/i.test(text || "")) return [];
  const out = new Set();
  const groupRe = /EMP[-\s]?\d{2,4}(?:\s*[+&]\s*(?:EMP[-\s]?)?\d{2,4})*/gi;
  let g;
  while ((g = groupRe.exec(text || ""))) {
    const numRe = /\d{2,4}/g;
    let m;
    while ((m = numRe.exec(g[0]))) out.add(`EMP${m[0].padStart(3, "0")}`);
  }
  return [...out];
}

// ============================================================
// UNION-FIND
// ============================================================
class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
    return this.parent.get(x);
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ============================================================
// SUBSET-SUM COMBINATION FINDER
// ============================================================
function findCombinations(items, targetAmount, maxSize = MAX_COMBO_SIZE, tolerance = AMOUNT_TOLERANCE) {
  const results = [];
  const n = items.length;

  function backtrack(start, combo, sum) {
    if (combo.length > 0 && amountsEqual(sum, targetAmount, tolerance)) {
      results.push({ indexes: [...combo], sum, diff: Math.abs(sum - targetAmount) });
    }
    if (combo.length >= maxSize || sum > targetAmount + tolerance) return;
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1, combo, sum + items[i].amount);
      combo.pop();
    }
  }
  backtrack(0, [], 0);
  results.sort((a, b) => a.diff - b.diff || a.indexes.length - b.indexes.length);
  return results;
}
// ─── Ollama COA Categorization ────────────────────────────────────────────────
async function ollamaSuggestCategory(bankTxn, coaAccounts, matchedDocs = []) {
  if (!coaAccounts || coaAccounts.length === 0) return null;

  // Build a compact COA list for the prompt (only postable accounts)
  const postableAccounts = coaAccounts
    .filter((a) => a.allow_direct_posting !== false && a.is_active !== false)
    .map((a) => `${a.account_code} | ${a.account_name} | ${a.account_type} | ${a.category}${a.sub_category ? " > " + a.sub_category : ""}`)
    .join("\n");

  const docContext = matchedDocs.length > 0
    ? matchedDocs.map((d) => `- ${d._docType}: ${getDocLabel(d)}, amount=${toFloat(getDocAmount(d))}, desc="${d.description ?? ""}"`)
        .join("\n")
    : "No matched documents yet.";

  const prompt = `
You are an Indian accounting expert. Based on the bank transaction and matched documents below,
suggest the SINGLE most appropriate Chart of Accounts (COA) entry.

BANK TRANSACTION:
  Date:        ${bankTxn.txnDate ?? bankTxn.date ?? ""}
  Description: ${bankTxn.description ?? ""}
  Amount:      ₹${toFloat(bankTxn.amount)}
  Direction:   ${bankTxn.direction ?? ""} (credit = money received, debit = money paid out)
  Reference:   ${bankTxn.refNumber ?? bankTxn.reference_number ?? "none"}

MATCHED DOCUMENTS:
${docContext}

AVAILABLE COA ACCOUNTS (code | name | type | category):
${postableAccounts}

RULES:
1. For debit transactions: prefer Expense, Asset, or Liability accounts.
2. For credit transactions: prefer Revenue or Asset accounts.
3. Pick the account_code whose name/category best matches the transaction description and matched documents.
4. For salary/payroll debits: pick a Payroll Expense account.
5. For vendor payments: pick the relevant Expense account matching the vendor type.
6. For tax payments (GST/TDS): pick a Tax Expense or Tax Liability account.
7. Return ONLY the account_code from the list above — nothing else in that field.

Respond ONLY with valid JSON, no markdown:
{
  "account_code": "XXXX",
  "account_name": "Name from the list",
  "confidence": 0.0 to 1.0,
  "reason": "one sentence explanation"
}`.trim();

  try {
    const parsed = await callOllama(prompt);
    if (!parsed || !parsed.account_code) return null;

    // Verify the returned code actually exists in our COA
    const matched = coaAccounts.find(
      (a) => a.account_code === parsed.account_code
    );
    if (!matched) return null;

    return {
      account: matched,
      confidence: toFloat(parsed.confidence),
      reason: parsed.reason ?? "",
    };
  } catch {
    return null;
  }
}
// ============================================================
// NORMALIZATION OF INPUT DATA
// Adjust the field-mapping below if your spreadsheet headers differ.
// ============================================================
function normalize(bankRows, invoiceRows, payrollRows, expenseRows) {
  // ---- Bank Statement ----
  // Expected columns: Date, Description, Debit (₹), Credit (₹), Balance (₹)
  const bank = bankRows.map((r, i) => {
    const debit = parseAmount(r.debit ?? r["Debit (₹)"]);
    const credit = parseAmount(r.credit ?? r["Credit (₹)"]);
    return {
      txnId: r.txnId || `TXN-${String(i + 1).padStart(3, "0")}`,
      date: r.date ?? r["Date"],
      _date: parseDate(r.date ?? r["Date"]),
      description: r.description ?? r["Description"],
      debit,
      credit,
      amount: credit > 0 ? credit : debit, // working amount (always positive)
      direction: credit > 0 ? "credit" : "debit",
      _idx: i,
    };
  });

  // ---- Invoices ----
  // Expected columns: Invoice No, Invoice Date, Customer Name, ..., Total (₹), Due Date
  const invoices = invoiceRows.map((r, i) => ({
    docId: r.invoiceNo || r["Invoice No"],
    docType: "INVOICE",
    date: r.invoiceDate ?? r["Invoice Date"],
    _date: parseDate(r.invoiceDate ?? r["Invoice Date"]),
    name: r.customerName ?? r["Customer Name"],
    description: r.description ?? r["Service Description"],
    amount: parseAmount(r.total ?? r["Total (₹)"]),
    dueDate: r.dueDate ?? r["Due Date"],
    _idx: i,
  }));

  // ---- Payroll ----
  // Expected columns: Pay Date, Employee ID, Employee Name, Gross Pay, PF, Income Tax (Net Pay derived)
  const payroll = payrollRows.map((r, i) => {
    const gross = parseAmount(r.gross ?? r["Gross Pay (₹)"]);
    const pf = parseAmount(r.pf ?? r["PF (₹)"]);
    const tax = parseAmount(r.incomeTax ?? r["Income Tax (₹)"]);
    const netPay = r.netPay !== undefined ? parseAmount(r.netPay) : gross - pf - tax;
    return {
      docId: r.empId || r["Employee ID"],
      docType: "PAYROLL",
      date: r.payDate ?? r["Pay Date"],
      _date: parseDate(r.payDate ?? r["Pay Date"]),
      name: r.empName ?? r["Employee Name"],
      department: r.department ?? r["Department"],
      gross,
      amount: netPay, // amount actually disbursed via bank
      _idx: i,
    };
  });

  // ---- Expenses ----
  // Expected columns: Exp ID, Expense Date, Vendor, Category, Description, Amount (₹)
  const expenses = expenseRows.map((r, i) => ({
    docId: r.expId || r["Exp ID"],
    docType: "EXPENSE",
    date: r.date ?? r["Expense Date"],
    _date: parseDate(r.date ?? r["Expense Date"]),
    name: r.vendor ?? r["Vendor"],
    category: r.category ?? r["Category"],
    description: r.description ?? r["Description"],
    amount: parseAmount(r.amount ?? r["Amount (₹)"]),
    _idx: i,
  }));

  return { bank, invoices, payroll, expenses };
}

// ============================================================
// MAIN RECONCILIATION
// ============================================================
async function reconcile(bankRows, invoiceRows, payrollRows, expenseRows, opts = {}) {
  const { bank, invoices, payroll, expenses } = normalize(
    bankRows, invoiceRows, payrollRows, expenseRows
  );

  const matchedBank = new Set();
  const matchedInvoices = new Set();
  const matchedPayroll = new Set();
  const matchedExpenses = new Set();

  const matches = [];
  const duplicates = [];
  const anomalies = [];

  // Period end = latest bank date (used to detect future-dated records)
  const periodEnd = bank.reduce((max, t) => (t._date && (!max || t._date > max) ? t._date : max), null);

  // ----------------------------------------------------------
  // STAGE 0: Pre-flight anomaly checks (independent of matching)
  // ----------------------------------------------------------
  expenses.forEach((e) => {
    if (periodEnd && e._date && e._date > periodEnd) {
      anomalies.push({
        type: "FUTURE_DATED_RECORD",
        record: e,
        message: `Expense ${e.docId} is dated ${e.date}, which is after the statement period (${formatDate(periodEnd)}).`,
        severity: "high",
      });
    }
    if (e.amount < 0) {
      anomalies.push({
        type: "NEGATIVE_AMOUNT",
        record: e,
        message: `Expense ${e.docId} has a negative amount (${fmt(e.amount)}) — likely a credit note/refund. Verify intent.`,
        severity: "medium",
      });
    }
    if (!e.category) {
      anomalies.push({
        type: "MISSING_CATEGORY",
        record: e,
        message: `Expense ${e.docId} (${e.name}) has no category assigned.`,
        severity: "low",
      });
    }
  });

  // Payroll outlier detection (gross pay > mean + 2*stddev)
  if (payroll.length > 2) {
    const grossVals = payroll.map((p) => p.gross);
    const mean = grossVals.reduce((a, b) => a + b, 0) / grossVals.length;
    const variance = grossVals.reduce((a, b) => a + (b - mean) ** 2, 0) / grossVals.length;
    const stddev = Math.sqrt(variance);
    payroll.forEach((p) => {
      if (p.gross > mean + 2 * stddev) {
        anomalies.push({
          type: "PAYROLL_OUTLIER",
          record: p,
          message: `${p.docId} (${p.name}) gross pay ${fmt(p.gross)} is unusually high (>2σ from team average ${fmt(mean)}).`,
          severity: "medium",
        });
      }
    });
  }

  // Large bank transaction outlier (debits only)
  {
    const debits = bank.filter((b) => b.direction === "debit").map((b) => b.amount);
    if (debits.length > 2) {
      const mean = debits.reduce((a, b) => a + b, 0) / debits.length;
      const variance = debits.reduce((a, b) => a + (b - mean) ** 2, 0) / debits.length;
      const stddev = Math.sqrt(variance);
      bank.forEach((b) => {
        if (b.direction === "debit" && b.amount > mean + 3 * stddev) {
          anomalies.push({
            type: "LARGE_BANK_TRANSACTION",
            record: b,
            message: `${b.txnId} (${fmt(b.amount)}, "${b.description}") is unusually large vs typical debits (avg ${fmt(mean)}). Flag for manual review.`,
            severity: "high",
          });
        }
      });
    }
  }

  // ----------------------------------------------------------
  // STAGE 0b: Duplicate detection
  // ----------------------------------------------------------
  // Bank: same normalized description + same amount + same direction, different txn
  {
    const seen = new Map();
    bank.forEach((b) => {
      const key = `${b.direction}|${b.amount}|${normalizeDescForDup(b.description)}`;
      if (seen.has(key)) {
        const original = seen.get(key);
        duplicates.push({
          type: "DUPLICATE_BANK_TRANSACTION",
          original,
          duplicate: b,
          message: `${b.txnId} ("${b.description}") appears to be a duplicate of ${original.txnId} (same amount ${fmt(b.amount)} and description).`,
        });
      } else {
        seen.set(key, b);
      }
    });
  }

  // Expenses: same vendor + same amount + same date (or same description with [DUPLICATE] tag)
  {
    const seen = new Map();
    expenses.forEach((e) => {
      const key = `${normalizeDescForDup(e.name)}|${e.amount}|${e.date}`;
      if (seen.has(key)) {
        const original = seen.get(key);
        duplicates.push({
          type: "DUPLICATE_EXPENSE",
          original,
          duplicate: e,
          message: `${e.docId} (${e.name}, ${fmt(e.amount)}, ${e.date}) duplicates ${original.docId}.`,
        });
        matchedExpenses.add(e._idx); // exclude duplicate from matching pool
      } else {
        seen.set(key, e);
      }
    });
  }

  // Exclude future-dated / negative-amount expenses from the matching pool
  expenses.forEach((e) => {
    if ((periodEnd && e._date && e._date > periodEnd) || e.amount <= 0) {
      matchedExpenses.add(e._idx);
    }
  });

  // ----------------------------------------------------------
  // STAGE 1: Reference-based matching (Invoices & Payroll)
  // Bank descriptions explicitly mention INV-#### / EMP### —
  // this is the strongest signal and handles 1:1, 1:N, N:1, N:N.
  // ----------------------------------------------------------
  {
    const uf = new UnionFind();
    const nodeInfo = new Map(); // nodeKey -> {kind, ref}

    const bankNode = (b) => `B:${b._idx}`;
    const invNode = (inv) => `INV:${inv._idx}`;
    const empNode = (p) => `EMP:${p._idx}`;

    const invByNo = new Map(invoices.map((inv) => [inv.docId, inv]));
    const empById = new Map(payroll.map((p) => [p.docId, p]));

    bank.forEach((b) => {
      const invRefs = extractInvoiceRefs(b.description);
      const empRefs = extractEmployeeRefs(b.description);
      if (invRefs.length === 0 && empRefs.length === 0) return;

      uf.find(bankNode(b));
      nodeInfo.set(bankNode(b), { kind: "bank", ref: b });

      invRefs.forEach((ref) => {
        const inv = invByNo.get(ref);
        if (!inv) return;
        const node = invNode(inv);
        nodeInfo.set(node, { kind: "invoice", ref: inv });
        uf.union(bankNode(b), node);
      });

      empRefs.forEach((ref) => {
        const p = empById.get(ref);
        if (!p) return;
        const node = empNode(p);
        nodeInfo.set(node, { kind: "payroll", ref: p });
        uf.union(bankNode(b), node);
      });
    });

    // group nodes by root
    const groups = new Map();
    for (const node of nodeInfo.keys()) {
      const root = uf.find(node);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(node);
    }

    for (const nodes of groups.values()) {
      const bankItems = [], invItems = [], empItems = [];
      nodes.forEach((n) => {
        const info = nodeInfo.get(n);
        if (info.kind === "bank") bankItems.push(info.ref);
        else if (info.kind === "invoice") invItems.push(info.ref);
        else if (info.kind === "payroll") empItems.push(info.ref);
      });

      const docItems = [...invItems, ...empItems];
      if (bankItems.length === 0 || docItems.length === 0) continue;

      const bankTotal = bankItems.reduce((s, b) => s + b.amount, 0);
      const docTotal = docItems.reduce((s, d) => s + d.amount, 0);
      const diff = Math.abs(bankTotal - docTotal);
      const pctDiff = docTotal !== 0 ? diff / docTotal : 0;

      let matchType;
      if (bankItems.length === 1 && docItems.length === 1) matchType = "one_to_one";
      else if (bankItems.length > 1 && docItems.length === 1) matchType = "one_to_many"; // 1 doc, many txns
      else if (bankItems.length === 1 && docItems.length > 1) matchType = "many_to_one"; // many docs, 1 txn
      else matchType = "many_to_many";

      const docType = invItems.length > 0 ? "invoice(s)" : "payroll record(s)";
      const docLabel = docItems.map((d) => d.docId).join(" + ");
      const bankLabel = bankItems.map((b) => b.txnId).join(" + ");

      // Reference numbers are an explicit, near-certain link — confidence
      // reflects "are these the right records", not "do the amounts match".
      let confidence, explanation;

      if (amountsEqual(bankTotal, docTotal, AMOUNT_TOLERANCE)) {
        confidence = 1;
        explanation = `${docLabel} (${docType}, total ${fmt(docTotal)}) matched to ${bankLabel} (total ${fmt(bankTotal)}) via reference in bank description. Amounts reconcile exactly.`;
      } else {
        confidence = 0.95;
        explanation = `${docLabel} (${docType}, total ${fmt(docTotal)}) matched to ${bankLabel} (total ${fmt(bankTotal)}) via reference in bank description. Amounts differ by ${fmt(diff)} — see anomalies.`;

        if (bankTotal < docTotal) {
          anomalies.push({
            type: "SHORT_PAYMENT",
            record: { docItems, bankItems },
            message: `${docLabel} expected ${fmt(docTotal)} but received only ${fmt(bankTotal)} via ${bankLabel} (shortfall ${fmt(diff)}).`,
            severity: pctDiff > 0.05 ? "high" : "medium",
          });
        } else {
          anomalies.push({
            type: "OVERPAYMENT_OR_DISCREPANCY",
            record: { docItems, bankItems },
            message: `${docLabel} (${fmt(docTotal)}) vs ${bankLabel} (${fmt(bankTotal)}) — bank amount exceeds the document total by ${fmt(diff)}.`,
            severity: pctDiff > 0.05 ? "medium" : "low",
          });
        }
      }

      bankItems.forEach((b) => matchedBank.add(b._idx));
      invItems.forEach((inv) => matchedInvoices.add(inv._idx));
      empItems.forEach((p) => matchedPayroll.add(p._idx));

      matches.push({
        matchType,
        bankTransactions: bankItems,
        documents: docItems,
        confidence,
        explanation,
        suggestedCategory: invItems.length > 0 ? "REVENUE" : "PAYROLL",
        method: "reference_match",
      });
    }
  }

  // ----------------------------------------------------------
  // STAGE 1b: Classify obviously-internal bank transactions BEFORE
  //           expense matching, so e.g. "Reimbursement – ... EMP002"
  //           or "Advance – EMP003 ..." don't get fuzzy-matched to an
  //           unrelated expense that happens to share the same amount.
  // ----------------------------------------------------------
  const INTERNAL_PATTERNS = [
    { re: /\bGST\b/i, category: "TAX_PAYMENT" },
    { re: /\bTDS\b/i, category: "TAX_PAYMENT" },
    { re: /bank charges?/i, category: "BANK_CHARGE" },
    { re: /interest earned/i, category: "INTEREST_INCOME" },
    { re: /petty cash/i, category: "PETTY_CASH" },
    { re: /NEFT transfer fee/i, category: "BANK_CHARGE" },
    { re: /advance\s*[-–]\s*EMP/i, category: "EMPLOYEE_ADVANCE" },
    { re: /customer advance/i, category: "CUSTOMER_ADVANCE" },
    { re: /reimbursement/i, category: "EMPLOYEE_REIMBURSEMENT" },
    { re: /furniture repair/i, category: "OFFICE_MAINTENANCE" },
  ];

  const internalTransactions = [];
  bank
    .filter((b) => !matchedBank.has(b._idx))
    .forEach((b) => {
      for (const { re, category } of INTERNAL_PATTERNS) {
        if (re.test(b.description)) {
          matchedBank.add(b._idx);
          internalTransactions.push({
            bankTransaction: b,
            category,
            explanation: `${b.txnId} ("${b.description}", ${fmt(b.amount)}) classified as ${category.replace(/_/g, " ").toLowerCase()} — not expected to match an invoice/expense/payroll record.`,
          });
          break;
        }
      }
    });

  // ----------------------------------------------------------
  // STAGE 2: Expense <-> Bank matching (amount + date + description similarity)
  // No explicit IDs in bank descriptions, so use fuzzy matching.
  // ----------------------------------------------------------

  // 2a: One-to-one (single expense <-> single bank debit)
  // Build ALL plausible (expense, bank) pairs, score them, then assign
  // greedily by score so the *globally* best pairings win — this avoids
  // a weaker early match "stealing" a bank transaction that actually
  // belongs to a different expense with the same amount.
  {
    const pairs = [];
    expenses
      .filter((e) => !matchedExpenses.has(e._idx))
      .forEach((e) => {
        bank
          .filter((b) => !matchedBank.has(b._idx) && b.direction === "debit")
          .forEach((b) => {
            if (!amountsEqual(e.amount, b.amount)) return;
            const dDiff = dateDiffDays(e._date, b._date);
            if (dDiff > DATE_WINDOW_DAYS_LOOSE) return;

            const sim = Math.max(
              textSimilarity(e.name, b.description),
              textSimilarity(e.description, b.description)
            );
            const dateScore = Math.max(0, (DATE_WINDOW_DAYS_LOOSE - dDiff) / DATE_WINDOW_DAYS_LOOSE);
            const score = 0.5 + sim * 0.35 + dateScore * 0.15;

            if (score >= 0.6 || dDiff === 0) {
              pairs.push({ e, b, score });
            }
          });
      });

    pairs.sort((a, b) => b.score - a.score);

    for (const { e, b, score } of pairs) {
      if (matchedExpenses.has(e._idx) || matchedBank.has(b._idx)) continue;
      matchedExpenses.add(e._idx);
      matchedBank.add(b._idx);
      matches.push({
        matchType: "one_to_one",
        bankTransactions: [b],
        documents: [e],
        confidence: Math.min(1, score),
        explanation: `${e.docId} (${e.name}, ${fmt(e.amount)}, ${e.date}) matches ${b.txnId} ("${b.description}", ${fmt(b.amount)}, ${b.date}) — same amount, close date, matching description.`,
        suggestedCategory: "EXPENSE",
        method: "fuzzy_match",
      });
    }
  }

  // 2b: Many-to-one (group of expenses <-> single bank debit, e.g. corporate card settlement)
  bank
    .filter((b) => !matchedBank.has(b._idx) && b.direction === "debit")
    .forEach((b) => {
      const candidates = expenses
        .map((e, i) => ({ ...e, _origIdx: e._idx }))
        .filter(
          (e) =>
            !matchedExpenses.has(e._idx) &&
            dateDiffDays(e._date, b._date) <= DATE_WINDOW_DAYS_LOOSE
        );

      if (candidates.length < 2) return;

      const combos = findCombinations(candidates, b.amount, MAX_COMBO_SIZE, AMOUNT_TOLERANCE);
      if (combos.length === 0) return;

      // Multiple combos can sum to the same total (e.g. two expenses with
      // the same amount but different categories). Disambiguate by picking
      // the combo whose combined category/description best matches the
      // bank transaction's description.
      const minDiff = combos[0].diff;
      const tied = combos.filter((c) => c.diff === minDiff && c.indexes.length >= 2);
      if (tied.length === 0) return;

      let best = tied[0], bestSim = -1;
      for (const c of tied) {
        const group = c.indexes.map((i) => candidates[i]);
        const groupText = group.map((e) => `${e.category} ${e.name} ${e.description}`).join(" ");
        const sim = textSimilarity(groupText, b.description);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }

      const group = best.indexes.map((i) => candidates[i]);

      group.forEach((e) => matchedExpenses.add(e._idx));
      matchedBank.add(b._idx);

      matches.push({
        matchType: "many_to_one",
        bankTransactions: [b],
        documents: group,
        confidence: 0.8,
        explanation: `${group.map((e) => e.docId).join(" + ")} (${group.map((e) => fmt(e.amount)).join(" + ")} = ${fmt(best.sum)}) sum to ${b.txnId}'s amount (${fmt(b.amount)}, "${b.description}").`,
        suggestedCategory: "EXPENSE",
        method: "subset_sum",
      });
    });

  // ----------------------------------------------------------
  // STAGE 3: Generic amount+date one-to-one / one-to-many / many-to-one
  //          fallback for any remaining invoices/payroll without refs
  //          (defensive — in this dataset Stage 1 covers all of these)
  // ----------------------------------------------------------
  const remainingDocs = [
    ...invoices.filter((d) => !matchedInvoices.has(d._idx)),
    ...payroll.filter((d) => !matchedPayroll.has(d._idx)),
  ];

  remainingDocs.forEach((doc) => {
    let best = null, bestScore = -1;
    bank.forEach((b) => {
      if (matchedBank.has(b._idx)) return;
      if (!amountsEqual(doc.amount, b.amount)) return;
      const dDiff = dateDiffDays(doc._date, b._date);
      if (dDiff > DATE_WINDOW_DAYS_STRICT) return;
      const score = 0.6 + textSimilarity(doc.name || doc.description, b.description) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    });
    if (best) {
      matchedBank.add(best._idx);
      if (doc.docType === "INVOICE") matchedInvoices.add(doc._idx);
      else matchedPayroll.add(doc._idx);

      matches.push({
        matchType: "one_to_one",
        bankTransactions: [best],
        documents: [doc],
        confidence: Math.min(1, bestScore),
        explanation: `${doc.docId} (${fmt(doc.amount)}, ${doc.date}) matches ${best.txnId} (${fmt(best.amount)}, ${best.date}) by amount, date and description similarity.`,
        suggestedCategory: doc.docType === "INVOICE" ? "REVENUE" : "PAYROLL",
        method: "amount_date_match",
      });
    }
  });

  // ----------------------------------------------------------
  // STAGE 5: Ollama fallback for genuinely unresolved bank transactions
  // ----------------------------------------------------------
  const unresolvedBank = bank.filter((b) => !matchedBank.has(b._idx));
  const ollamaResults = [];

  if (!opts.skipOllama) {
    for (const b of unresolvedBank) {
      const candidates = [
        ...invoices.filter((d) => !matchedInvoices.has(d._idx)),
        ...payroll.filter((d) => !matchedPayroll.has(d._idx)),
        ...expenses.filter((d) => !matchedExpenses.has(d._idx)),
      ]
        .filter((d) => {
          const amtClose = Math.abs(d.amount - b.amount) <= Math.max(b.amount * 0.25, 100);
          const dateClose = dateDiffDays(d._date, b._date) <= 30;
          return amtClose || dateClose;
        })
        .slice(0, 15);

      let result;
      if (candidates.length === 0) {
        result = {
          matchType: "unmatched",
          selectedIndexes: [],
          confidence: 0,
          explanation: `${b.txnId} ("${b.description}", ${fmt(b.amount)}) has no documents within a plausible amount/date range. Likely an unrecorded transaction requiring investigation.`,
          suggestedCategory: "UNKNOWN",
        };
      } else {
        result = await callOllamaForMatch(b, candidates);
      }

      ollamaResults.push({ bankTransaction: b, candidates, result });

      if (result.matchType !== "unmatched" && result.selectedIndexes?.length > 0) {
        const docs = result.selectedIndexes.map((i) => candidates[i]).filter(Boolean);
        if (docs.length > 0) {
          docs.forEach((d) => {
            if (d.docType === "INVOICE") matchedInvoices.add(d._idx);
            else if (d.docType === "PAYROLL") matchedPayroll.add(d._idx);
            else matchedExpenses.add(d._idx);
          });
          matchedBank.add(b._idx);
          matches.push({
            matchType: result.matchType,
            bankTransactions: [b],
            documents: docs,
            confidence: result.confidence,
            explanation: result.explanation,
            suggestedCategory: result.suggestedCategory || "UNCATEGORIZED",
            method: "ollama",
          });
          continue;
        }
      }

      matches.push({
        matchType: "unmatched",
        bankTransactions: [b],
        documents: [],
        confidence: result.confidence || 0,
        explanation: result.explanation,
        suggestedCategory: result.suggestedCategory || "",
        method: "ollama",
      });
    }
  } else {
    unresolvedBank.forEach((b) => {
      matches.push({
        matchType: "unmatched",
        bankTransactions: [b],
        documents: [],
        confidence: 0,
        explanation: `${b.txnId} ("${b.description}", ${fmt(b.amount)}) could not be matched by any deterministic rule.`,
        suggestedCategory: "",
        method: "none",
      });
    });
  }

  // ----------------------------------------------------------
  // STAGE 6: Remaining unmatched documents -> unpaid / unreconciled
  // ----------------------------------------------------------
  const unmatchedDocuments = [];
  const today = periodEnd || new Date();

  invoices.filter((d) => !matchedInvoices.has(d._idx)).forEach((d) => {
    const due = parseDate(d.dueDate);
    const overdue = due && due < today;
    unmatchedDocuments.push({
      document: d,
      status: overdue ? "overdue_unpaid" : "unpaid",
      explanation: overdue
        ? `Invoice ${d.docId} (${d.name}, ${fmt(d.amount)}) is unpaid and past due date ${d.dueDate}.`
        : `Invoice ${d.docId} (${d.name}, ${fmt(d.amount)}) has no matching bank receipt yet.`,
    });
  });

  payroll.filter((d) => !matchedPayroll.has(d._idx)).forEach((d) => {
    unmatchedDocuments.push({
      document: d,
      status: "unpaid",
      explanation: `Payroll for ${d.docId} (${d.name}, net ${fmt(d.amount)}) has no matching bank debit.`,
    });
  });

  expenses.filter((d) => !matchedExpenses.has(d._idx)).forEach((d) => {
    // skip ones already excluded for being duplicates/future-dated/negative
    unmatchedDocuments.push({
      document: d,
      status: "unpaid",
      explanation: `Expense ${d.docId} (${d.name}, ${fmt(d.amount)}) has no matching bank debit.`,
    });
  });

  return {
    matches,
    duplicates,
    anomalies,
    internalTransactions,
    unmatchedDocuments,
    summary: buildSummary(matches, duplicates, anomalies, internalTransactions, unmatchedDocuments),
  };
}

function normalizeDescForDup(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\[duplicate\]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function formatDate(d) {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function buildSummary(matches, duplicates, anomalies, internalTransactions, unmatchedDocuments) {
  const byType = {};
  matches.forEach((m) => {
    byType[m.matchType] = (byType[m.matchType] || 0) + 1;
  });
  return {
    totalMatches: matches.length,
    byMatchType: byType,
    duplicatesFound: duplicates.length,
    anomaliesFound: anomalies.length,
    internalTransactions: internalTransactions.length,
    unmatchedDocuments: unmatchedDocuments.length,
  };
}

// ============================================================
// OLLAMA FALLBACK CALL
// ============================================================
async function callOllamaForMatch(txn, candidates) {
  const candidateList = candidates
    .map((c, idx) => {
      const label =
        c.docType === "INVOICE"
          ? `Invoice ${c.docId} for ${c.name}`
          : c.docType === "PAYROLL"
          ? `Payroll for ${c.name} (${c.docId})`
          : `Expense ${c.docId}: ${c.name} - ${c.description}`;
      return `[${idx}] ${label}, amount=${fmt(c.amount)}, date=${c.date}`;
    })
    .join("\n");

  const prompt = `
You are a financial reconciliation assistant. Match the BANK TRANSACTION below to one or more CANDIDATE DOCUMENTS (invoices, payroll, expenses).

BANK TRANSACTION:
${txn.direction === "credit" ? "Credit (money in)" : "Debit (money out)"} of ${fmt(txn.amount)} on ${txn.date}, description: "${txn.description}" (${txn.txnId})

CANDIDATE DOCUMENTS (indexed):
${candidateList}

Rules:
- "one_to_one": exactly one document matches this transaction (similar amount, close date, related vendor/customer/employee name).
- "one_to_many": this single transaction is a combined/batch payment covering multiple documents whose amounts sum approximately to the transaction amount.
- "many_to_one": this transaction is a partial payment toward one document (transaction amount is less than the document amount but clearly related).
- "unmatched": none of the candidates plausibly relate to this transaction.

Respond ONLY with valid JSON, no extra text:
{
  "matchType": "one_to_one" | "one_to_many" | "many_to_one" | "unmatched",
  "selectedIndexes": [array of candidate indexes from the list above],
  "confidence": number between 0 and 1,
  "explanation": "short explanation",
  "suggestedCategory": "REVENUE" | "EXPENSE" | "PAYROLL" | ""
}
`.trim();

  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.response);
    return {
      matchType: parsed.matchType || "unmatched",
      selectedIndexes: Array.isArray(parsed.selectedIndexes) ? parsed.selectedIndexes : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      explanation: parsed.explanation || "",
      suggestedCategory: parsed.suggestedCategory || "",
    };
  } catch (err) {
    return {
      matchType: "unmatched",
      selectedIndexes: [],
      confidence: 0,
      explanation: `Ollama call failed (${err.message}); flagged for manual review.`,
      suggestedCategory: "",
    };
  }
}

module.exports = { reconcile, normalize, findCombinations, textSimilarity, parseDate, parseAmount };