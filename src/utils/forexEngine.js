/**
 * Foreign Exchange Gain/Loss calculation engine.
 *
 * Concept:
 * - A foreign-currency invoice/sale/expense is "booked" at the exchange rate
 *   on its document date → bookedAmountINR.
 * - When the bank settles the transaction (always in INR for Indian accounts),
 *   the actual INR amount may differ because the exchange rate moved between
 *   the document date and the settlement date.
 * - The difference is a realized Forex GAIN (more INR received/paid than booked
 *   for receivables, or less INR paid than booked for payables) or LOSS.
 */

import { convertToINR } from "./currencyUtils";

/**
 * @param {object} params
 * @param {number} params.bookedAmountINR   - INR value recorded at document date
 * @param {number} params.settledAmountINR  - actual INR amount in the bank transaction
 * @param {string} params.originalCurrency  - e.g. "USD"
 * @param {number} params.originalAmount    - amount in foreign currency
 * @returns {{ gainLoss: number, gainLossType: "GAIN"|"LOSS"|"NONE", bookedAmountINR: number, settledAmountINR: number, originalAmount: number, originalCurrency: string }}
 */
export function calculateForexGainLoss({
  bookedAmountINR,
  settledAmountINR,
  originalCurrency,
  originalAmount,
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

  const diff = parseFloat((settled - booked).toFixed(2));

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
 * @param {object} sourceDoc - invoice/sale/expense record from Appwrite
 * @param {number} settledAmountINR - bank txn amount (INR)
 */
export async function calculateForexForMatch(sourceDoc, settledAmountINR) {
  const originalCurrency = sourceDoc.originalCurrency || sourceDoc.currency || "INR";
  const originalAmount =
    sourceDoc.originalAmount ?? sourceDoc.totalAmount ?? sourceDoc.amount ?? 0;

  let bookedAmountINR = sourceDoc.amountINR;

  if (bookedAmountINR === undefined || bookedAmountINR === null) {
    const docDate = sourceDoc.invoiceDate || sourceDoc.saleDate || sourceDoc.expenseDate || "";
    const converted = await convertToINR(originalAmount, originalCurrency, docDate);
    bookedAmountINR = converted.amountINR;
  }

  return calculateForexGainLoss({
    bookedAmountINR,
    settledAmountINR,
    originalCurrency,
    originalAmount,
  });
}