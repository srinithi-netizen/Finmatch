/**
 * Foreign Exchange Gain/Loss calculation engine.
 *
 * Concept:
 * - A foreign-currency invoice/sale/expense is "booked" at the exchange rate
 *   on its document date → bookedAmountINR.
 * - When the bank settles the transaction (always in INR for Indian accounts),
 *   the actual INR amount may differ because the exchange rate moved between
 *   the document date and the settlement date.
 * - The difference is a realized Forex GAIN or LOSS, and the SIGN of that
 *   difference depends on whether the document is a receivable (AR) or a
 *   payable (AP):
 *
 *     Receivable (invoice / sales_report):
 *       settled > booked  → GAIN  (we received more INR than expected)
 *       settled < booked  → LOSS  (we received less INR than expected)
 *
 *     Payable (expense_report / payroll):
 *       settled < booked  → GAIN  (we paid out less INR than expected)
 *       settled > booked  → LOSS  (we paid out more INR than expected)
 */

import { convertToINR } from "./currencyUtils";

/** Document types that represent money OWED BY us (payables). */
const PAYABLE_DOCUMENT_TYPES = new Set(["expense_report", "payroll"]);

export function isPayableDocumentType(documentType) {
  return PAYABLE_DOCUMENT_TYPES.has(documentType);
}

/**
 * @param {object} params
 * @param {number} params.bookedAmountINR   - INR value recorded at document date
 * @param {number} params.settledAmountINR  - actual INR amount in the bank transaction
 * @param {string} params.originalCurrency  - e.g. "USD"
 * @param {number} params.originalAmount    - amount in foreign currency
 * @param {string} [params.documentType]    - "invoice" | "sales_report" | "expense_report" | "payroll" | ...
 *                                             Determines whether this is a receivable (AR) or
 *                                             payable (AP) for sign purposes. Defaults to
 *                                             receivable behaviour if omitted.
 * @returns {{ gainLoss: number, gainLossType: "GAIN"|"LOSS"|"NONE", bookedAmountINR: number, settledAmountINR: number, originalAmount: number, originalCurrency: string }}
 */
export function calculateForexGainLoss({
  bookedAmountINR,
  settledAmountINR,
  originalCurrency,
  originalAmount,
  documentType,
}) {
  const booked = Number(bookedAmountINR) || 0;
  const settled = Number(settledAmountINR) || 0;

  if (!originalCurrency || originalCurrency === "INR") {
    return {
      gainLoss: 0,
      gainLossType: "NONE",
      bookedAmountINR: booked,
      settledAmountINR: settled,
      originalAmount: originalAmount ?? 0,
      originalCurrency: originalCurrency || "INR",
    };
  }

  // Raw movement in INR between booking and settlement.
  const rawDiff = settled - booked;

  // For payables, the sign is inverted: paying MORE than booked is a LOSS,
  // paying LESS than booked is a GAIN.
  const signedDiff = isPayableDocumentType(documentType) ? -rawDiff : rawDiff;
  const diff = parseFloat(signedDiff.toFixed(2));

  let gainLossType = "NONE";
  if (diff > 0.01) gainLossType = "GAIN";
  else if (diff < -0.01) gainLossType = "LOSS";

  return {
    gainLoss: Math.abs(diff),
    gainLossType,
    bookedAmountINR: booked,
    settledAmountINR: settled,
    originalAmount: originalAmount ?? 0,
    originalCurrency,
  };
}

/** Recommended COA codes for posting forex gain/loss. */
export const FOREX_COA_CODES = {
  GAIN: "7100", // Other Income → Foreign Exchange Gain
  LOSS: "8900", // Operating Expenses → Foreign Exchange Loss
};

export function getForexCoaCode(gainLossType) {
  if (gainLossType === "GAIN") return FOREX_COA_CODES.GAIN;
  if (gainLossType === "LOSS") return FOREX_COA_CODES.LOSS;
  return "";
}

/**
 * Given a source document (invoice/sale/expense) and the settled bank amount
 * (INR), compute the forex result — re-deriving bookedAmountINR if it wasn't
 * stored on the document at import time.
 *
 * @param {object} sourceDoc - invoice/sale/expense/payroll record from Appwrite
 * @param {number} settledAmountINR - bank txn amount (INR)
 */
export async function calculateForexForMatch(sourceDoc, settledAmountINR) {
  const originalCurrency = sourceDoc.originalCurrency || sourceDoc.currency || "INR";
  const originalAmount =
    sourceDoc.originalAmount ?? sourceDoc.totalAmount ?? sourceDoc.amount ?? 0;

  let bookedAmountINR = sourceDoc.amountINR;

  if (bookedAmountINR === undefined || bookedAmountINR === null) {
    const docDate =
      sourceDoc.invoiceDate ||
      sourceDoc.saleDate ||
      sourceDoc.expenseDate ||
      sourceDoc.payDate ||
      "";
    const converted = await convertToINR(originalAmount, originalCurrency, docDate);
    bookedAmountINR = converted.amountINR;
  }

  return calculateForexGainLoss({
    bookedAmountINR,
    settledAmountINR,
    originalCurrency,
    originalAmount,
    documentType: sourceDoc.documentType,
  });
}