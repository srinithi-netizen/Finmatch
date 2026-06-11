// reconciliationEngine.js  — remove all DB writes from runReconciliation

import { updateBankTransaction, updateSourceDocument } from "../appwrite/config";

export const CATEGORIES = [
  { code: "PAYROLL",      label: "Payroll & Salaries" },
  { code: "VENDOR_PAY",   label: "Vendor Payment" },
  { code: "RENT",         label: "Rent & Lease" },
  { code: "UTILITIES",    label: "Utilities" },
  { code: "TRAVEL",       label: "Travel & Transport" },
  { code: "OFFICE_EXP",   label: "Office Expenses" },
  { code: "PROFESSIONAL", label: "Professional Services" },
  { code: "REVENUE",      label: "Revenue / Sales" },
  { code: "REFUND",       label: "Refund / Reversal" },
  { code: "TRANSFER",     label: "Internal Transfer" },
  { code: "TAX",          label: "Tax Payment" },
  { code: "LOAN",         label: "Loan / EMI" },
  { code: "MISC",         label: "Miscellaneous" },
];

function toFloat(v) {
  if (v === null || v === undefined || v === "") return 0;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, "")) || 0;
}

function dateSimilarity(d1, d2) {
  if (!d1 || !d2) return 0;
  const diff = Math.abs(new Date(d1) - new Date(d2)) / (1000 * 60 * 60 * 24);
  if (diff <= 3)  return 1;
  if (diff <= 7)  return 0.8;
  if (diff <= 14) return 0.6;
  if (diff <= 30) return 0.3;
  return 0;
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokensA = String(a).toLowerCase().split(/\s+/);
  const tokensB = String(b).toLowerCase().split(/\s+/);
  const setB    = new Set(tokensB);
  const hits    = tokensA.filter((t) => setB.has(t) && t.length > 2).length;
  return Math.min(hits / Math.max(tokensA.length, tokensB.length), 1);
}

export function getDocAmount(doc) {
  return toFloat(
    doc?.net_amount   ?? doc?.netAmount   ?? doc?.totalAmount ??
    doc?.total_amount ?? doc?.amount      ?? doc?.netPay      ?? doc?.net_pay
  );
}

export function getDocLabel(doc) {
  return (
    doc?.vendor_name    ?? doc?.vendorName    ?? doc?.employee_name ??
    doc?.employeeName   ?? doc?.client_name   ?? doc?.clientName    ??
    doc?.customer_name  ?? doc?.customerName  ??
    doc?.invoice_number ?? doc?.invoiceNumber ??
    doc?.$id?.slice(-8) ?? "—"
  );
}

export function getDocDate(doc) {
  return doc?.invoice_date ?? doc?.invoiceDate ?? doc?.date ??
    doc?.pay_date ?? doc?.payDate ?? doc?.txnDate ?? null;
}

export function getDocRef(doc) {
  return doc?.invoice_number ?? doc?.invoiceNumber ??
    doc?.reference ?? doc?.refNumber ?? null;
}

export function preScore(bankTxn, sourceDoc) {
  const amtBank      = toFloat(bankTxn.amount);
  const remainingDoc = toFloat(sourceDoc.remainingAmount ?? getDocAmount(sourceDoc));

  const amtScore =
    amtBank !== 0 && Math.abs(amtBank - remainingDoc) / Math.abs(amtBank) < 0.01 ? 1
    : amtBank !== 0 && Math.abs(amtBank - remainingDoc) / Math.abs(amtBank) < 0.05 ? 0.8
    : amtBank !== 0 && Math.abs(amtBank - remainingDoc) / Math.abs(amtBank) < 0.15 ? 0.6
    : remainingDoc > 0 && remainingDoc < amtBank ? 0.4
    : 0;

  const refBank  = String(bankTxn.refNumber ?? bankTxn.reference_number ?? bankTxn.referenceNumber ?? "").toLowerCase();
  const refDoc   = String(getDocRef(sourceDoc) ?? "").toLowerCase();
  const refScore = refBank && refDoc && refBank.length > 2 && refDoc.length > 2 &&
                   (refBank.includes(refDoc) || refDoc.includes(refBank)) ? 1 : 0;

  const vendorBank  = String(bankTxn.description ?? bankTxn.vendor ?? "").toLowerCase();
  const vendorDoc   = String(getDocLabel(sourceDoc)).toLowerCase();
  const vendorScore = stringSimilarity(vendorBank, vendorDoc);

  const dateScore = dateSimilarity(
    bankTxn.txnDate ?? bankTxn.transaction_date ?? bankTxn.date,
    getDocDate(sourceDoc)
  );

  const currencyBank     = String(bankTxn.currency ?? "").toUpperCase();
  const currencyDoc      = String(sourceDoc.currency ?? "").toUpperCase();
  const currencyMismatch = currencyBank && currencyDoc && currencyBank !== currencyDoc;

  const score =
    amtScore    * 0.40 +
    refScore    * 0.30 +
    vendorScore * 0.20 +
    dateScore   * 0.10;

  return { score, amtScore, refScore, vendorScore, dateScore, currencyMismatch };
}

function buildExplanation(bankTxn, doc, amtScore, refScore, vendorScore, dateScore) {
  const parts = [];
  if (refScore === 1) parts.push("reference numbers match");
  if (amtScore >= 0.8) parts.push("amounts match closely");
  else if (amtScore >= 0.4) parts.push("partial amount match");
  if (vendorScore >= 0.5) parts.push(`vendor names similar (${getDocLabel(doc)})`);
  if (dateScore >= 0.8) parts.push("dates within 3 days");
  else if (dateScore >= 0.6) parts.push("dates within 7 days");
  else if (dateScore >= 0.3) parts.push("dates within 30 days");
  if (parts.length === 0) parts.push("weak match based on available data");
  return parts.join(", ") + ".";
}

function guessCategory(bankTxn, topDoc) {
  const desc = (bankTxn.description ?? "").toLowerCase();
  const dir  = (bankTxn.direction   ?? "").toLowerCase();
  if (topDoc?._docType === "payroll")                          return "PAYROLL";
  if (topDoc?._docType === "sale" || dir === "credit")         return "REVENUE";
  if (topDoc?._docType === "invoice")                          return "VENDOR_PAY";
  if (topDoc?._docType === "expense") {
    const cat = (topDoc.expense_category ?? topDoc.category ?? "").toLowerCase();
    if (cat.includes("rent") || cat.includes("lease"))         return "RENT";
    if (cat.includes("util") || cat.includes("electric"))      return "UTILITIES";
    if (cat.includes("travel"))                                return "TRAVEL";
    if (cat.includes("office"))                                return "OFFICE_EXP";
    if (cat.includes("professional") || cat.includes("legal")) return "PROFESSIONAL";
  }
  if (desc.includes("salary") || desc.includes("payroll"))     return "PAYROLL";
  if (desc.includes("rent")   || desc.includes("lease"))       return "RENT";
  if (desc.includes("tax")    || desc.includes("gst"))         return "TAX";
  if (desc.includes("loan")   || desc.includes("emi"))         return "LOAN";
  if (desc.includes("refund") || desc.includes("reversal"))    return "REFUND";
  if (desc.includes("transfer"))                               return "TRANSFER";
  if (dir === "credit")                                        return "REVENUE";
  return "MISC";
}

function localMatchTxn(bankTxn, candidateDocs) {
  const bankAmount = toFloat(bankTxn.amount);
  const results    = [];

  for (const doc of candidateDocs) {
    const { score, amtScore, refScore, vendorScore, dateScore, currencyMismatch } = preScore(bankTxn, doc);
    if (score < 0.20) continue;

    const remainingDoc    = toFloat(doc.remainingAmount ?? getDocAmount(doc));
    const matchedAmount   = Math.min(bankAmount, remainingDoc);
    const remainingDocAmt = Math.max(0, remainingDoc - matchedAmount);

    const confidenceBreakdown = {
      amountMatch:    amtScore,
      referenceMatch: refScore,
      vendorMatch:    vendorScore,
      dateMatch:      dateScore,
      explanation:    buildExplanation(bankTxn, doc, amtScore, refScore, vendorScore, dateScore),
    };

    const anomalies = [];
    if (currencyMismatch) {
      anomalies.push({
        type: "CURRENCY_MISMATCH", severity: "medium",
        note: `Bank: ${bankTxn.currency}, Doc: ${doc.currency}`,
        expectedAmount: 0, receivedAmount: 0, differenceAmount: 0,
      });
    }
    if (bankAmount > remainingDoc && remainingDoc > 0 && score >= 0.5) {
      anomalies.push({
        type: "OVERPAYMENT", severity: "high",
        note: `Bank paid ${bankAmount}, document requires ${remainingDoc}`,
        expectedAmount: remainingDoc, receivedAmount: bankAmount,
        differenceAmount: bankAmount - remainingDoc,
      });
    }
    if (bankAmount < remainingDoc && score >= 0.50) {
      anomalies.push({
        type: "UNDERPAYMENT", severity: "medium",
        note: `Bank paid ${bankAmount}, document requires ${remainingDoc}`,
        expectedAmount: remainingDoc, receivedAmount: bankAmount,
        differenceAmount: remainingDoc - bankAmount,
      });
    }

    results.push({
      sourceDocId:             doc.$id,
      sourceDocType:           doc._docType,
      documentAmount:          getDocAmount(doc),
      matchedAmount,
      remainingDocumentAmount: remainingDocAmt,
      confidence:              Math.min(score, 1),
      confidenceBreakdown,
      reason:                  confidenceBreakdown.explanation,
      currencyNote:            currencyMismatch
        ? `Currency mismatch: ${bankTxn.currency} vs ${doc.currency}`
        : null,
      anomalies,
    });
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

function buildLocalResult(bankTxn, candidateDocs) {
  const bankAmount   = toFloat(bankTxn.amount);
  const localHits    = localMatchTxn(bankTxn, candidateDocs).filter((m) => m.confidence >= 0.30);
  const matchedTotal = localHits.reduce((s, m) => s + toFloat(m.matchedAmount), 0);
  const remainingBank = Math.max(0, bankAmount - matchedTotal);
  const allAnomalies = localHits.flatMap((m) => m.anomalies ?? []);

  return {
    bankTxnId:           bankTxn.$id,
    bankAmount,
    matchedAmount:       matchedTotal,
    remainingBankAmount: remainingBank,
    matchType:           localHits.length === 0 ? "unmatched"
                       : localHits.length === 1 ? "one_to_one"
                       : "one_to_many",
    categoryCode:        guessCategory(bankTxn, localHits[0]
      ? candidateDocs.find((d) => d.$id === localHits[0].sourceDocId)
      : null),
    matches:             localHits,
    anomalies:           allAnomalies,
  };
}

// ─── Main — returns results WITHOUT writing to DB ─────────────────────────────
export async function runReconciliation({ bankTransactions, sourceDocs, onProgress }) {
  const validBankTxns = bankTransactions.filter(
    (t) => t.validation_status === "valid" || !t.validation_status
  );

  if (validBankTxns.length === 0) return [];

  const candidatesByTxn = new Map();
  for (const txn of validBankTxns) {
    const candidates = [];
    for (const doc of sourceDocs) {
      const { score } = preScore(txn, doc);
      if (score >= 0.20) candidates.push({ doc, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    candidatesByTxn.set(txn.$id, candidates.slice(0, 20).map((c) => c.doc));
  }

  const results = [];
  const total   = validBankTxns.length;

  for (let i = 0; i < validBankTxns.length; i++) {
    const txn           = validBankTxns[i];
    const candidateDocs = candidatesByTxn.get(txn.$id) ?? [];

    if (onProgress) onProgress({ current: i + 1, total, txnId: txn.$id });

    const result = buildLocalResult(txn, candidateDocs);
    results.push(result);
  }

  return results;
}

export function computeGroupTotals(bankTxn, selectedDocs) {
  const bankAmount    = toFloat(bankTxn?.amount);
  const selectedTotal = selectedDocs.reduce(
    (sum, d) => sum + toFloat(d.remainingAmount ?? getDocAmount(d)),
    0
  );
  return { bankAmount, selectedTotal, remaining: bankAmount - selectedTotal };
}