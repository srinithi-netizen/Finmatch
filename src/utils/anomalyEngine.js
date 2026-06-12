// src/utils/anomalyEngine.js
// ─── Proactive Anomaly Detection Engine ───────────────────────────────────────
// Call this after loading all data to detect anomalies across all collections.

export function detectAnomalies({
  bankTxns = [],
  sourceDocs = [],
  dbMatches = [],
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
    ["accepted", "manual"].includes(m.status)
  );

  const matchesByBankTxn  = {};
  const matchesBySourceDoc = {};
  for (const m of acceptedMatches) {
    if (!matchesByBankTxn[m.bankTxnId])   matchesByBankTxn[m.bankTxnId]   = [];
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
  // Two accepted bank txns matched to the same sourceDocId within 7 days
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
    const doc = sourceDocs.find((d) => d.$id === docId);
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
  const payrollDocs = sourceDocs.filter((d) => d._docType === "payroll");
  const payrollSeen = {}; // key: employeeId + period
  for (const doc of payrollDocs) {
    const empId  = doc.employee_id ?? doc.employeeId ?? doc.employeeCode ?? "";
    const period = doc.payroll_period ?? doc.period ?? doc.payDate ?? doc.pay_date ?? "";
    if (!empId || !period) continue;
    const key = `${empId}::${period}`;
    if (payrollSeen[key]) {
      flagOnce({
        relatedId: doc.$id, relatedType: "source_doc",
        flagType: "payroll_paid_twice", severity: "critical",
        expectedAmount: toF(payrollSeen[key].net_pay ?? payrollSeen[key].netPay),
        receivedAmount: toF(doc.net_pay ?? doc.netPay),
        differenceAmount: 0,
      });
    } else {
      payrollSeen[key] = doc;
    }
  }

  // ── 4. TDS NOT DEDUCTED (critical) ────────────────────────────────────────
  // Vendor payment above ₹30,000 with no TDS entry
  for (const txn of bankTxns) {
    if (toF(txn.amount) <= 30000) continue;
    if (txn.direction === "credit") continue;
    const desc = (txn.description ?? "").toLowerCase();
    const isVendorPayment = ["vendor", "supplier", "invoice", "purchase", "neft", "rtgs", "transfer"].some((k) => desc.includes(k));
    if (!isVendorPayment) continue;
    // Check if any source doc for this txn mentions TDS
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
  const invoices = sourceDocs.filter((d) => d._docType === "invoice");
  const invoiceSeen = {};
  for (const inv of invoices) {
    const num    = (inv.invoice_number ?? inv.invoiceNumber ?? "").toLowerCase().replace(/\s/g, "");
    const vendor = (inv.vendorName ?? inv.vendor_name ?? "").toLowerCase().trim();
    if (!num || !vendor) continue;
    const key = `${num}::${vendor}`;
    if (invoiceSeen[key]) {
      flagOnce({
        relatedId: inv.$id, relatedType: "source_doc",
        flagType: "duplicate_invoice", severity: "high",
        expectedAmount: toF(invoiceSeen[key].totalAmount ?? invoiceSeen[key].amount),
        receivedAmount: toF(inv.totalAmount ?? inv.amount),
        differenceAmount: 0,
      });
    } else {
      invoiceSeen[key] = inv;
    }
  }

  // ── 6. PAYMENT BEFORE INVOICE DATE (high) ────────────────────────────────
  for (const [docId, matches] of Object.entries(matchesBySourceDoc)) {
    const doc = sourceDocs.find((d) => d.$id === docId);
    if (!doc) continue;
    const docDate = doc.invoice_date ?? doc.invoiceDate ?? doc.expense_date ?? doc.date;
    if (!docDate) continue;
    for (const m of matches) {
      const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
      if (!txn) continue;
      const txnDate = txn.txnDate ?? txn.transaction_date;
      if (!txnDate) continue;
      if (new Date(txnDate) < new Date(docDate) &&
          days(txnDate, docDate) > 1) {
        flagOnce({
          relatedId: txn.$id, relatedType: "bank_txn",
          flagType: "payment_before_invoice_date", severity: "high",
          expectedAmount: 0, receivedAmount: 0,
          differenceAmount: days(txnDate, docDate),
        });
      }
    }
  }

  // ── 7. EXPENSE NO RECEIPT (high) ─────────────────────────────────────────
  const expenses = sourceDocs.filter((d) => d._docType === "expense");
  for (const exp of expenses) {
    const hasReceipt = exp.receipt_ref ?? exp.receiptRef ?? exp.receiptNumber ?? exp.receipt_number;
    if (!hasReceipt) {
      flagOnce({
        relatedId: exp.$id, relatedType: "source_doc",
        flagType: "expense_no_receipt", severity: "high",
        expectedAmount: toF(exp.totalAmount ?? exp.amount),
        receivedAmount: 0, differenceAmount: 0,
      });
    }
  }

  // ── 8. MISSING REQUIRED FIELD (high) ─────────────────────────────────────
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

  // ── 9. BANK BALANCE GAP (high) ────────────────────────────────────────────
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

  // ── 10. CURRENCY MISMATCH (medium) ───────────────────────────────────────
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

  // ── 11. LOW CONFIDENCE MATCH (medium) ────────────────────────────────────
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

  // ── 12. OVERDUE UNMATCHED DOCUMENT (medium) ──────────────────────────────
  for (const doc of sourceDocs) {
    const dueDate = doc.due_date ?? doc.dueDate;
    if (!dueDate) continue;
    if (new Date(dueDate) >= now) continue;
    const status = (doc.payment_status ?? doc.paymentStatus ?? "").toLowerCase();
    if (["paid", "matched"].includes(status)) continue;
    flagOnce({
      relatedId: doc.$id, relatedType: "source_doc",
      flagType: "overdue_unmatched_document", severity: "medium",
      expectedAmount: toF(doc.remainingAmount ?? doc.totalAmount ?? doc.amount),
      receivedAmount: 0,
      differenceAmount: toF(doc.remainingAmount ?? doc.totalAmount ?? doc.amount),
    });
  }

  // ── 13. PARTIAL MATCH OPEN (medium) ──────────────────────────────────────
  for (const doc of sourceDocs) {
    const dueDate = doc.due_date ?? doc.dueDate;
    const status  = (doc.payment_status ?? doc.paymentStatus ?? "").toLowerCase();
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

  // ── 14. AMOUNT MISMATCH SMALL (medium) ───────────────────────────────────
  for (const m of acceptedMatches) {
    const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
    const doc = sourceDocs.find((d) => d.$id === m.sourceDocId);
    if (!txn || !doc) continue;
    const txnAmt = toF(txn.amount);
    const docAmt = toF(doc.totalAmount ?? doc.amount ?? doc.net_pay ?? doc.netPay);
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

  // ── 15. DATE GAP LARGE (medium) ──────────────────────────────────────────
  for (const m of acceptedMatches) {
    const txn = bankTxns.find((t) => t.$id === m.bankTxnId);
    const doc = sourceDocs.find((d) => d.$id === m.sourceDocId);
    if (!txn || !doc) continue;
    const txnDate = txn.txnDate ?? txn.transaction_date;
    const docDate = doc.invoice_date ?? doc.invoiceDate ?? doc.expense_date ?? doc.date;
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

  // ── 16. UNMATCHED TRANSACTION (low) ──────────────────────────────────────
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

  // ── 17. OPTIONAL FIELD MISSING (low) ─────────────────────────────────────
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