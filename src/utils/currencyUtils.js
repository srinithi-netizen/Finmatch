/**
 * Currency conversion utilities for FinMatch.
 * Converts foreign-currency amounts to INR using historical exchange rates
 * from the Frankfurter API (https://www.frankfurter.app) — free, no API key required.
 * Falls back to a static rate table if the API is unreachable.
 */

const BASE_CURRENCY = "INR";

// Fallback rates (approximate, used only if the API call fails)
// Expressed as: 1 unit of foreign currency = X INR
const FALLBACK_RATES = {
  USD: 83.5,
  EUR: 90.0,
  GBP: 105.0,
  AED: 22.7,
  SGD: 62.0,
  AUD: 55.0,
  CAD: 61.0,
  JPY: 0.56,
};

// In-memory cache: key = `${currency}_${date}` → rate (1 unit foreign = X INR)
const rateCache = new Map();

/**
 * Fetch the exchange rate for 1 unit of `currency` → INR, on a given date.
 * @param {string} currency - 3-letter ISO code (e.g. "USD")
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<number>} rate (1 currency = rate INR)
 */
export async function getExchangeRate(currency, date) {
  const cur = (currency || "INR").toUpperCase();
  if (cur === BASE_CURRENCY) return 1;

  const datePart = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
  const cacheKey = `${cur}_${datePart}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey);

  try {
    const url = `https://api.frankfurter.app/${datePart}?from=${cur}&to=${BASE_CURRENCY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
    const data = await res.json();
    const rate = data?.rates?.[BASE_CURRENCY];
    if (!rate) throw new Error("Rate not found in response");
    rateCache.set(cacheKey, rate);
    return rate;
  } catch (err) {
    console.warn(`getExchangeRate: falling back for ${cur} on ${datePart}:`, err.message);
    const fallback = FALLBACK_RATES[cur] ?? 1;
    rateCache.set(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Convert an amount from a foreign currency to INR using the rate on `date`.
 * @param {number} amount
 * @param {string} currency
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{ amountINR: number, exchangeRate: number, rateDate: string, originalAmount: number, originalCurrency: string }>}
 */
export async function convertToINR(amount, currency, date) {
  const cur = (currency || "INR").toUpperCase();
  const numAmount = Number(amount) || 0;

  if (cur === BASE_CURRENCY) {
    return {
      amountINR: numAmount,
      exchangeRate: 1,
      rateDate: date || "",
      originalAmount: numAmount,
      originalCurrency: "INR",
    };
  }

  const rate = await getExchangeRate(cur, date);
  const amountINR = parseFloat((numAmount * rate).toFixed(2));

  return {
    amountINR,
    exchangeRate: rate,
    rateDate: date || "",
    originalAmount: numAmount,
    originalCurrency: cur,
  };
}

/**
 * Pre-fetch and cache exchange rates for a batch of (currency, date) pairs
 * BEFORE looping through rows — avoids redundant API calls.
 * @param {Array<{currency: string, date: string}>} pairs
 */
export async function preloadExchangeRates(pairs) {
  const unique = new Map();
  for (const { currency, date } of pairs) {
    const cur = (currency || "INR").toUpperCase();
    if (cur === BASE_CURRENCY) continue;
    const datePart = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
    unique.set(`${cur}_${datePart}`, { currency: cur, date });
  }
  await Promise.all(
    Array.from(unique.values()).map(({ currency, date }) => getExchangeRate(currency, date))
  );
}

export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY"];