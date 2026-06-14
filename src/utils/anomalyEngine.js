// src/utils/anomalyEngine.js
// ─── Proactive Anomaly Detection Engine ───────────────────────────────────────
// Call this after loading all data to detect anomalies across all collections.

export function detectAnomalies({
  bankTxns = [],
  sourceDocs = [],       // invoices (kept for backward compatibility)
  dbMatches = [],
  expenseRecords = [],
  salesRecords = [],
  payrollRecords = [],
  clientId = "",
}) {
  const flags = [];
  const now   = new Date();

  // Helper: push a flag
  function flag({ relatedId, relatedType, flagType, severity, expectedAmount = 0, receivedAmount = 0, differenceAmount = 0 }) {
    flags.push({
      clientId,
      relatedId:        String(relatedId ?? ""),
      relatedType:      String(relatedType ?? ""),
      flagType:         String(flagType ?? ""),
      severity:         String(severity ?? "low"),
      status:           "open",
      resolutionNote:   "",
      expectedAmount:   parseFloat(expectedAmount)   || 0,
      receivedAmount:   parseFloat(receivedAmount)   || 0,
      differenceAmount: parseFloat(differenceAmount) || 0,
      batchId:          `detect_${Date.now()}`,
    });
  }

  const toF  = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

  // Accepted matches grouped by bankTxnId and sourceDocId
  const acceptedMatches = dbMatches.filter((m) =>
    ["accepted", "manual", "matched"].includes(m.status)
  );

  const matchesByBankTxn   = {};
  const matchesBySourceDoc = {};
  for (const m of acceptedMatches) {
    if (!matchesByBankTxn[m.bankTxnId])     matchesByBankTxn[m.bankTxnId]     = [];
    if (!matchesBySourceDoc[m.sourceDocId]) matchesBySourceDoc[m.sourceDocId] = [];
    matchesByBankTxn[m.bankTxnId].push(m);
    matchesBySourceDoc[m.sourceDocId].push(m);
  }

  // Already-flagged set (relatedId + flagType) to avoid duplicates
  const alreadyFlagged = new Set();
  const flagKey = (relatedId, flagType) => `${relatedId}::${flagType}`;

  function flagOnce(opts) {
    const k = flagKey(opts.relatedId, opts.flagType);
    if (alreadyFlagged.has(k)) return;
    alreadyFlagged.add(k);
    flag(opts);
  }

  // ── 1. DUPLICATE PAYMENT MADE (critical) ─────────────────────────────────
  for (const [docId, matches] of Object.entries(matchesBySourceDoc)) {
    if (matches.length < 2) continue;
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const txnA = bankTxns.find((t) => t.$id === matches[i].bankTxnId);
        const txnB = bankTxns.find((t) => t.$id === matches[j].bankTxnId);
        if (!txnA || !txnB) continue;
        const dateA = txnA.txnDate ?? txnA.transaction_date;
        const dateB = txnB.txnDate ?? txnB.transaction_date;
        if (dateA && dateB && days(dateA, dateB) <= 7) {
          flagOnce({
            relatedId: txnB.$id, relatedType: "bank_txn",
            flagType: "duplicate_payment_made", severity: "critical",
            expectedAmount: toF(txnA.amount), receivedAmount: toF(txnB.amount),
            differenceAmount: 0,
          });
        }
      }
    }
  }

  // ── 2. PAYMENT EXCEEDS INVOICE (critical) ────────────────────────────────
  for (const [docId, matches] of Object.entries(matchesBySourceDoc)) {
    const doc = sourceDocs.find((d) => d.$id === docId)
             ?? [...expenseRecords, ...salesRecords, ...payrollRecords].find((d) => d.$id === docId);
    if (!doc) continue;
    const docTotal     = toF(doc.totalAmount ?? doc.amount ?? doc.gross_pay ?? doc.netPay ?? doc.net_pay);
    const totalMatched = matches.reduce((s, m) => s + toF(m.matchedAmount), 0);
    if (docTotal > 0 && totalMatched > docTotal * 1.01) {
      flagOnce({
        relatedId: docId, relatedType: "source_doc",
        flagType: "payment_exceeds_invoice", severity: "critical",
        expectedAmount: docTotal, receivedAmount: totalMatched,
        differenceAmount: totalMatched - docTotal,
      });
    }
  }

  // ── 3. PAYROLL PAID TWICE (critical) ─────────────────────────────────────
  const payrollDocs = payrollRecords.length ? payrollRecords : sourceDocs.filter((d) => d._docType === "payroll");
  const payrollSeen = {}; // key: employeeId + period
  for (const doc of payrollDocs) {
    const empId  = doc.employeeId ?? doc.employee_id ?? doc.employeeCode ?? "";
    const period = doc.payDate ?? doc.pay_date ?? doc.payroll_period ?? doc.period ?? "";
    if (!empId || !period) continue;
    const key = `${empId}::${period}`;
    if (payrollSeen[key]) {
      flagOnce({
        relatedId: doc.$id, relatedType: "payroll_record",
        flagType: "payroll_paid_twice", severity: "critical",
        expectedAmount: toF(payrollSeen[key].netPay ?? payrollSeen[key].net_pay),
        receivedAmount: toF(doc.netPay ?? doc.net_pay),
        differenceAmount: 0,
      });
    } else {
      payrollSeen[key] = doc;
    }
  }

  // ── 4. TDS NOT DEDUCTED (critical) ────────────────────────────────────────
  for (const txn of bankTxns) {
    if (toF(txn.amount) <= 30000) continue;
    if (txn.direction === "credit") continue;
    const desc = (txn.description ?? "").toLowerCase();
    const isVendorPayment = ["vendor", "supplier", "invoice", "purchase", "neft", "rtgs", "transfer"].some((k) => desc.includes(k));
    if (!isVendorPayment) continue;
    const txnMatches = matchesByBankTxn[txn.$id] ?? [];
    const hasTds = txnMatches.some((m) => {
      const doc = sourceDocs.find((d) => d.$id === m.sourceDocId);
      return doc && (toF(doc.tds_amount ?? doc.tdsAmount ?? 0) > 0);
    });
    if (!hasTds) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "tds_not_deducted", severity: "critical",
        expectedAmount: toF(txn.amount) * 0.1,
        receivedAmount: 0,
        differenceAmount: toF(txn.amount) * 0.1,
      });
    }
  }

  // ── 5. DUPLICATE INVOICE (high) ──────────────────────────────────────────
  // Two or more invoices with same invoiceNumber (+ vendor if available)
  const invoices = sourceDocs.filter((d) => d._docType === "invoice" || d.invoiceNumber || d.invoice_number);
  const invoiceSeen = {};
  for (const inv of invoices) {
    const num    = (inv.invoiceNumber ?? inv.invoice_number ?? "").toLowerCase().replace(/\s/g, "");
    const vendor = (inv.vendorName ?? inv.vendor_name ?? "").toLowerCase().trim();
    if (!num) continue;
    const key = vendor ? `${num}::${vendor}` : num;
    if (invoiceSeen[key]) {
      flagOnce({
        relatedId: inv.$id, relatedType: "invoice",
        flagType: "duplicate_invoice", severity: "high",
        expectedAmount: toF(invoiceSeen[key].totalAmount ?? invoiceSeen[key].amount),
        receivedAmount: toF(inv.totalAmount ?? inv.amount),
        differenceAmount: 0,
      });
    } else {
      invoiceSeen[key] = inv;
    }
  }

  // ── 6. DUPLICATE EXPENSE (high) - NEW ────────────────────────────────────
  // Same vendor + same amount + same date (or within 1 day) = likely duplicate entry
  const expenseSeen = {};
  for (const exp of expenseRecords) {
    const vendor = (exp.vendorName ?? exp.vendor_name ?? "").toLowerCase().trim();
    const amount = toF(exp.totalAmount ?? exp.amount);
    const date   = exp.expenseDate ?? exp.expense_date;
    if (!vendor || !amount || !date) continue;
    const key = `${vendor}::${amount}::${new Date(date).toISOString().slice(0, 10)}`;
    if (expenseSeen[key]) {
      flagOnce({
        relatedId: exp.$id, relatedType: "expense_record",
        flagType: "duplicate_expense", severity: "high",
        expectedAmount: toF(expenseSeen[key].totalAmount ?? expenseSeen[key].amount),
        receivedAmount: amount,
        differenceAmount: 0,
      });
    } else {
      expenseSeen[key] = exp;
    }
  }

  // ── 7. FUTURE DATED EXPENSE (high) - NEW ─────────────────────────────────
  for (const exp of expenseRecords) {
    const date = exp.expenseDate ?? exp.expense_date;
    if (!date) continue;
    if (new Date(date) > now) {
      flagOnce({
        relatedId: exp.$id, relatedType: "expense_record",
        flagType: "future_dated_expense", severity: "high",
        expectedAmount: toF(exp.totalAmount ?? exp.amount),
        receivedAmount: 0,
        differenceAmount: days(date, now),
      });
    }
  }

  // ── 8. MISSING CUSTOMER NAME IN SALES RECORD (high) - NEW ────────────────
  for (const sale of salesRecords) {
    const customer = sale.customerName ?? sale.customer_name;
    if (!customer || String(customer).trim() === "") {
      flagOnce({
        relatedId: sale.$id, relatedType: "sale_record",
        flagType: "missing_customer_name", severity: "high",
        expectedAmount: toF(sale.totalAmount ?? sale.amount),
        receivedAmount: 0, differenceAmount: 0,
      });
    }
  }

  // ── 9. MISSING EXPENSE CATEGORY (high) - NEW ─────────────────────────────
  for (const exp of expenseRecords) {
    const category = exp.category;
    if (!category || String(category).trim() === "") {
      flagOnce({
        relatedId: exp.$id, relatedType: "expense_record",
        flagType: "missing_expense_category", severity: "high",
        expectedAmount: toF(exp.totalAmount ?? exp.amount),
        receivedAmount: 0, differenceAmount: 0,
      });
    }
  }

  // ── 10. UNUSUALLY HIGH PAYROLL AMOUNT (high) - NEW ───────────────────────
  // Flag if netPay > 2x the average netPay across all payroll records
  if (payrollDocs.length >= 2) {
    const totalNet = payrollDocs.reduce((s, p) => s + toF(p.netPay ?? p.net_pay), 0);
    const avgNet   = totalNet / payrollDocs.length;
    for (const doc of payrollDocs) {
      const net = toF(doc.netPay ?? doc.net_pay);
      if (avgNet > 0 && net > avgNet * 2) {
        flagOnce({
          relatedId: doc.$id, relatedType: "payroll_record",
          flagType: "unusually_high_payroll", severity: "high",
          expectedAmount: avgNet,
          receivedAmount: net,
          differenceAmount: net - avgNet,
        });
      }
    }
  }

  // ── 11. PAYMENT BEFORE INVOICE DATE (high) ────────────────────────────────
  for (const [docId, matches] of Object.entries(matchesBySourceDoc)) {
    const doc = sourceDocs.find((d) => d.$id === docId);
    if (!doc) continue;
    const docDate = doc.invoiceDate ?? doc.invoice_date ?? doc.expenseDate ?? doc.expense_date ?? doc.date;
    if (!docDate) continue;
    for (const m of matches) {
      const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
      if (!txn) continue;
      const txnDate = txn.txnDate ?? txn.transaction_date;
      if (!txnDate) continue;
      if (new Date(txnDate) < new Date(docDate) && days(txnDate, docDate) > 1) {
        flagOnce({
          relatedId: txn.$id, relatedType: "bank_txn",
          flagType: "payment_before_invoice_date", severity: "high",
          expectedAmount: 0, receivedAmount: 0,
          differenceAmount: days(txnDate, docDate),
        });
      }
    }
  }

  // ── 12. EXPENSE NO RECEIPT (high) ─────────────────────────────────────────
  for (const exp of expenseRecords) {
    const hasReceipt = exp.receiptRef ?? exp.receipt_ref ?? exp.receiptNumber ?? exp.receipt_number;
    if (!hasReceipt) {
      flagOnce({
        relatedId: exp.$id, relatedType: "expense_record",
        flagType: "expense_no_receipt", severity: "high",
        expectedAmount: toF(exp.totalAmount ?? exp.amount),
        receivedAmount: 0, differenceAmount: 0,
      });
    }
  }

  // ── 13. MISSING REQUIRED FIELD - BANK TXN (high) ──────────────────────────
  for (const txn of bankTxns) {
    const amt  = toF(txn.amount);
    const date = txn.txnDate ?? txn.transaction_date;
    if (!amt || !date) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "missing_required_field", severity: "high",
        expectedAmount: 0, receivedAmount: 0, differenceAmount: 0,
      });
    }
  }

  // ── 14. BANK BALANCE GAP (high) ────────────────────────────────────────────
  const sortedTxns = [...bankTxns]
    .filter((t) => t.balance != null)
    .sort((a, b) => new Date(a.txnDate ?? a.transaction_date) - new Date(b.txnDate ?? b.transaction_date));
  for (let i = 1; i < sortedTxns.length; i++) {
    const prev    = sortedTxns[i - 1];
    const curr    = sortedTxns[i];
    const prevBal = toF(prev.balance);
    const currBal = toF(curr.balance);
    const amt     = toF(curr.amount);
    const dir     = (curr.direction ?? "").toLowerCase();
    const expected = dir === "credit" ? prevBal + amt : prevBal - amt;
    if (Math.abs(expected - currBal) > 1) {
      flagOnce({
        relatedId: curr.$id, relatedType: "bank_txn",
        flagType: "bank_balance_gap", severity: "high",
        expectedAmount: expected, receivedAmount: currBal,
        differenceAmount: Math.abs(expected - currBal),
      });
    }
  }

  // ── 15. SUSPICIOUSLY LARGE BANK TRANSACTION (high) - NEW ─────────────────
  // Flag any bank transaction whose amount is > 3x the average of all bank transactions
  if (bankTxns.length >= 2) {
    const totalAmt = bankTxns.reduce((s, t) => s + Math.abs(toF(t.amount)), 0);
    const avgAmt   = totalAmt / bankTxns.length;
    for (const txn of bankTxns) {
      const amt = Math.abs(toF(txn.amount));
      if (avgAmt > 0 && amt > avgAmt * 3) {
        flagOnce({
          relatedId: txn.$id, relatedType: "bank_txn",
          flagType: "unusually_large_amount", severity: "high",
          expectedAmount: avgAmt,
          receivedAmount: amt,
          differenceAmount: amt - avgAmt,
        });
      }
    }
  }

  // ── 16. CURRENCY MISMATCH (medium) ───────────────────────────────────────
  for (const m of acceptedMatches) {
    const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
    const doc = sourceDocs.find((d) => d.$id === m.sourceDocId);
    if (!txn || !doc) continue;
    const txnCur = (txn.currency ?? "").toUpperCase();
    const docCur = (doc.currency ?? "").toUpperCase();
    if (txnCur && docCur && txnCur !== docCur) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "currency_mismatch", severity: "medium",
        expectedAmount: toF(doc.totalAmount ?? doc.amount),
        receivedAmount: toF(txn.amount),
        differenceAmount: 0,
      });
    }
  }

  // ── 17. LOW CONFIDENCE MATCH (medium) ────────────────────────────────────
  for (const m of dbMatches.filter((m) => m.status === "ai_suggested" || m.status === "pending_review")) {
    const score = toF(m.confidenceScore);
    if (score >= 0.50 && score <= 0.69) {
      flagOnce({
        relatedId: m.bankTxnId, relatedType: "bank_txn",
        flagType: "low_confidence_match", severity: "medium",
        expectedAmount: toF(m.matchedAmount),
        receivedAmount: score * 100,
        differenceAmount: (0.75 - score) * 100,
      });
    }
  }

  // ── 18. OVERDUE UNMATCHED DOCUMENT (medium) ──────────────────────────────
  for (const doc of sourceDocs) {
    const dueDate = doc.dueDate ?? doc.due_date;
    if (!dueDate) continue;
    if (new Date(dueDate) >= now) continue;
    const status = (doc.paymentStatus ?? doc.payment_status ?? "").toLowerCase();
    if (["paid", "matched"].includes(status)) continue;
    flagOnce({
      relatedId: doc.$id, relatedType: "source_doc",
      flagType: "overdue_unmatched_document", severity: "medium",
      expectedAmount: toF(doc.remainingAmount ?? doc.totalAmount ?? doc.amount),
      receivedAmount: 0,
      differenceAmount: toF(doc.remainingAmount ?? doc.totalAmount ?? doc.amount),
    });
  }

  // ── 19. PARTIAL MATCH OPEN (medium) ──────────────────────────────────────
  for (const doc of sourceDocs) {
    const dueDate = doc.dueDate ?? doc.due_date;
    const status  = (doc.paymentStatus ?? doc.payment_status ?? "").toLowerCase();
    if (status !== "partially_paid" && status !== "partial") continue;
    if (dueDate && new Date(dueDate) < now) {
      flagOnce({
        relatedId: doc.$id, relatedType: "source_doc",
        flagType: "partial_match_open", severity: "medium",
        expectedAmount: toF(doc.totalAmount ?? doc.amount),
        receivedAmount: toF(doc.totalAmount ?? doc.amount) - toF(doc.remainingAmount),
        differenceAmount: toF(doc.remainingAmount),
      });
    }
  }

  // ── 20. INVOICE PAID WITH AMOUNT MISMATCH (medium) - NEW ─────────────────
  // Specific check: invoice has an accepted match but matched amount differs from invoice total
  for (const [docId, matches] of Object.entries(matchesBySourceDoc)) {
    const inv = sourceDocs.find((d) => d.$id === docId && (d._docType === "invoice" || d.invoiceNumber || d.invoice_number));
    if (!inv) continue;
    const invTotal = toF(inv.totalAmount ?? inv.amount);
    const totalMatched = matches.reduce((s, m) => s + toF(m.matchedAmount), 0);
    if (invTotal === 0) continue;
    const diff = Math.abs(invTotal - totalMatched);
    // Trigger if there's any mismatch but it's not already caught by "payment exceeds invoice"
    if (diff > 0.01 && totalMatched <= invTotal * 1.01) {
      flagOnce({
        relatedId: docId, relatedType: "invoice",
        flagType: "invoice_amount_mismatch", severity: "medium",
        expectedAmount: invTotal,
        receivedAmount: totalMatched,
        differenceAmount: diff,
      });
    }
  }

  // ── 21. AMOUNT MISMATCH SMALL (medium) ───────────────────────────────────
  for (const m of acceptedMatches) {
    const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
    const doc = sourceDocs.find((d) => d.$id === m.sourceDocId);
    if (!txn || !doc) continue;
    const txnAmt = toF(txn.amount);
    const docAmt = toF(doc.totalAmount ?? doc.amount ?? doc.netPay ?? doc.net_pay);
    if (docAmt === 0) continue;
    const pctDiff = Math.abs(txnAmt - docAmt) / docAmt;
    if (pctDiff >= 0.01 && pctDiff <= 0.05) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "amount_mismatch_small", severity: "medium",
        expectedAmount: docAmt, receivedAmount: txnAmt,
        differenceAmount: Math.abs(txnAmt - docAmt),
      });
    }
  }

  // ── 22. DATE GAP LARGE (medium) ──────────────────────────────────────────
  for (const m of acceptedMatches) {
    const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
    const doc = sourceDocs.find((d) => d.$id === m.sourceDocId);
    if (!txn || !doc) continue;
    const txnDate = txn.txnDate ?? txn.transaction_date;
    const docDate = doc.invoiceDate ?? doc.invoice_date ?? doc.expenseDate ?? doc.expense_date ?? doc.date;
    if (!txnDate || !docDate) continue;
    if (new Date(txnDate) > new Date(docDate) && days(txnDate, docDate) > 45) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "date_gap_large", severity: "medium",
        expectedAmount: 0, receivedAmount: 0,
        differenceAmount: days(txnDate, docDate),
      });
    }
  }

  // ── 23. UNMATCHED TRANSACTION (low) ──────────────────────────────────────
  for (const txn of bankTxns) {
    const hasAnyMatch = dbMatches.some((m) => m.bankTxnId === txn.$id);
    const matchStatus = (txn.matchStatus ?? "").toLowerCase();
    if (!hasAnyMatch && !["matched", "partial"].includes(matchStatus)) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "unmatched_transaction", severity: "low",
        expectedAmount: toF(txn.amount), receivedAmount: 0,
        differenceAmount: toF(txn.amount),
      });
    }
  }

  // ── 24. OPTIONAL FIELD MISSING (low) ─────────────────────────────────────
  for (const txn of bankTxns) {
    const bal = txn.balance ?? txn.balance_after;
    if (bal == null) {
      flagOnce({
        relatedId: txn.$id, relatedType: "bank_txn",
        flagType: "optional_field_missing", severity: "low",
        expectedAmount: 0, receivedAmount: 0, differenceAmount: 0,
      });
    }
  }

  return flags;
}