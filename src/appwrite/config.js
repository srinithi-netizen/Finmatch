import { Client, Databases, Storage, ID, Query } from "appwrite";
import { FOREX_COA_CODES } from "../utils/forexEngine";
const client = new Client();

client
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed");

export const databases = new Databases(client);
export const storage = new Storage(client);

// ─── Collection & Bucket IDs ──────────────────────────────────────────────────
export const DB_ID = "6a27fe0f0008e45ab951";
export const DATABASE_ID = DB_ID;
export const CPA_COLLECTION_ID = "cpa_users";
export const CLIENTS_COLLECTION_ID = "clients";
export const DOCUMENTS_COLLECTION_ID = "uploaded_documents";
export const VALIDATION_ERRORS_COLLECTION_ID = "upload_validation_errors";
export const BUCKET_ID = "6a2903f8000fb8590cb1";
export const BANK_TRANSACTIONS_COLLECTION_ID = "bank_transactions";
export const INVOICES_COLLECTION_ID = "invoices";
export const PAYROLL_COLLECTION_ID = "payroll_transactions";
export const SALES_COLLECTION_ID = "sale_records";

// Re-export Appwrite helpers so other files only import from here
export { ID, Query };
// ── NEW collection IDs (add these to your existing config.js) ─────────────────
export const TRANSACTION_MATCH_COLLECTION_ID = "transaction_match";
export const ANOMALY_FLAG_COLLECTION_ID = "anomaly_flag";
export const REVIEW_ACTION_COLLECTION_ID = "review_action";
export const AUDIT_LOG_COLLECTION_ID = "audit_log";


// ─── Helper: extract month/year from a date string ───────────────────────────
export function getMonthYear(dateStr) {
  if (!dateStr) return { month: null, year: null };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { month: null, year: null };
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  } catch {
    return { month: null, year: null };
  }
}



// ─── Centralized Audit Helper ─────────────────────────────────────────────────
export async function logAudit({ clientId, entityType, entityId, action, performedBy, oldValue, newValue, note }) {
  if (!performedBy || performedBy === "system") return;

  try {
    return await databases.createDocument(
      DB_ID, AUDIT_LOG_COLLECTION_ID, ID.unique(),
      {
        clientId: String(clientId ?? ""),
        entityType: String(entityType ?? ""),
        entityId: String(entityId ?? ""),
        action: String(action ?? ""),
        performedBy: String(performedBy ?? ""),
        oldValue: oldValue != null ? String(oldValue).slice(0, 500) : "",
        newValue: newValue != null ? String(newValue).slice(0, 500) : "",
        note: note != null ? String(note).slice(0, 1000) : "",
      }
    );
  } catch (err) {
    console.error("logAudit failed:", err.message);
    // Don't throw — audit log failure shouldn't break the main action
  }
}

// ─── Transaction Match ────────────────────────────────────────────────────────
// Whitelist only the exact attribute names defined in your Appwrite transaction_match collection
function sanitizeMatchRow(row) {
  return {
    clientId: String(row.clientId ?? ""),
    bankTxnId: String(row.bankTxnId ?? ""),
    sourceDocId: String(row.sourceDocId ?? ""),
    sourceDocType: String(row.sourceDocType ?? ""),
    matchType: String(row.matchType ?? "one_to_one"),
    groupId: String(row.groupId ?? ""),
    status: String(row.status ?? "accepted"),
    confidenceScore: parseFloat(row.confidenceScore ?? 0),
    confidenceBreakdown: typeof row.confidenceBreakdown === "string"
      ? row.confidenceBreakdown
      : JSON.stringify(row.confidenceBreakdown ?? {}),
    matchReason: String(row.matchReason ?? "").slice(0, 1000),
    matchedBy: String(row.matchedBy ?? ""),
    matchedAmount: parseFloat(row.matchedAmount ?? 0),
    remainingBankAmount: parseFloat(row.remainingBankAmount ?? 0),
    remainingDocAmount: parseFloat(row.remainingDocAmount ?? 0),
    currencyNote: String(row.currencyNote ?? "").slice(0, 200),
    reviewedAt: String(row.reviewedAt ?? ""),
    batchId: String(row.batchId ?? ""),
    coaCode: String(row.coaCode ?? ""),  
    originalCurrency:  String(row.originalCurrency ?? "INR"),
    originalAmount:    parseFloat(row.originalAmount ?? 0),
    exchangeRateUsed:  parseFloat(row.exchangeRateUsed ?? 1),
    forexGainLoss:     parseFloat(row.forexGainLoss ?? 0),
    forexGainLossType: String(row.forexGainLossType ?? "NONE"),
    month:               row.month != null ? parseInt(row.month) : 0,
    year:                row.year  != null ? parseInt(row.year)  : 0,

  };
}
// ─── Forex COA Seeding ─────────────────────────────────────────────────────
export async function ensureForexCoaAccounts(performedBy = "system") {
  const existing = await getCoaAccounts();
  const codes = existing.map((a) => a.account_code);

  const seedAccounts = [
    {
      account_code: FOREX_COA_CODES.GAIN,
      account_name: "Foreign Exchange Gain",
      account_type: "Revenue",
      category: "Other Income",
      sub_category: "Foreign Exchange",
      description: "Realized gains from currency rate fluctuations on foreign-currency transactions",
      normal_balance: "Credit",
      is_active: true,
      is_system: true,
      allow_direct_posting: true,
      currency: "INR",
      parent_account_code: null,
      financial_statement: "Profit & Loss",
      tax_category: "Non Taxable",
    },
    {
      account_code: FOREX_COA_CODES.LOSS,
      account_name: "Foreign Exchange Loss",
      account_type: "Expense",
      category: "Operating Expenses",
      sub_category: "Foreign Exchange",
      description: "Realized losses from currency rate fluctuations on foreign-currency transactions",
      normal_balance: "Debit",
      is_active: true,
      is_system: true,
      allow_direct_posting: true,
      currency: "INR",
      parent_account_code: null,
      financial_statement: "Profit & Loss",
      tax_category: "Non Taxable",
    },
  ];

  for (const acc of seedAccounts) {
    if (!codes.includes(acc.account_code)) {
      const doc = await databases.createDocument(DB_ID, COA_ACCOUNTS_COLLECTION_ID, ID.unique(), acc);
      await logAudit({
        clientId: "",
        entityType: "coa_account",
        entityId: doc.$id,
        action: "COA_SEEDED",
        performedBy,
        oldValue: "",
        newValue: JSON.stringify(acc),
        note: `Seeded system COA account ${acc.account_code} - ${acc.account_name}`,
      });
    }
  }
}

export async function storeTransactionMatches(matches, performedBy) {
  if (!matches || matches.length === 0) return;
  const results = [];
  for (const match of matches) {
    try {
      const doc = await databases.createDocument(
        DB_ID, TRANSACTION_MATCH_COLLECTION_ID, ID.unique(), sanitizeMatchRow(match)
      );
      results.push(doc);

      await logAudit({
        clientId: match.clientId,
        entityType: "transaction_match",
        entityId: doc.$id,
        action: "MATCH_CREATED",
        performedBy: performedBy ?? match.matchedBy ?? "system",
        oldValue: "",
        newValue: JSON.stringify(sanitizeMatchRow(match)),
        note: `Match created for bank txn ${match.bankTxnId} -> doc ${match.sourceDocId || "(misc)"}`,
      });
    } catch (err) {
      console.error("storeTransactionMatches failed for row:", JSON.stringify(sanitizeMatchRow(match)), err.message);
      throw err; // re-throw so the UI shows the real error
    }
  }
  return results;
}
export async function getTransactionMatches(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.limit(2000)];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const res = await databases.listDocuments(DB_ID, TRANSACTION_MATCH_COLLECTION_ID, queries);
  return res.documents;
}


export async function updateTransactionMatch(matchId, updates, clientId, performedBy) {
  const result = await databases.updateDocument(
    DB_ID, TRANSACTION_MATCH_COLLECTION_ID, matchId, updates
  );

  await logAudit({
    clientId,
    entityType: "transaction_match",
    entityId: matchId,
    action: "MATCH_UPDATED",
    performedBy: performedBy ?? "system",
    oldValue: "",
    newValue: JSON.stringify(updates),
    note: `Updated match fields: ${Object.keys(updates).join(", ")}`,
  });

  return result;
}

// ─── Category Suggestion deleted──────────────────────────────────────────────────────
// ─── Audit Log Read ────────────────────────────────────────────────────────────
export async function getAuditLogs(clientId, limit = 500) {
  const res = await databases.listDocuments(
    DB_ID,
    AUDIT_LOG_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(limit)]
  );
  return res.documents;
}
//getCoa-----
export async function getStandardCoaAccounts() {

  const res =
    await databases.listDocuments(
      DB_ID,
      COA_ACCOUNTS_COLLECTION_ID,
      [Query.limit(500)]
    );

  return res.documents.filter(
    a => a.is_active !== false
  );
}
// ─── Anomaly Flag ─────────────────────────────────────────────────────────────
export async function storeAnomalyFlags(flags, performedBy) {

  if (!flags || flags.length === 0) return;

  const clientId = flags[0].clientId;

  // Fetch ALL existing anomalies for this client (any status, not just "open")
  const existing = await databases.listDocuments(
    DB_ID,
    ANOMALY_FLAG_COLLECTION_ID,
    [
      Query.equal("clientId", clientId),
      Query.limit(5000)
    ]
  );

  // Consistent key format: relatedId::flagType
  const existingSet = new Set(
    existing.documents.map(
      a => `${a.relatedId}::${a.flagType}`
    )
  );

  const newFlags = [];
  for (const f of flags) {
    const key = `${f.relatedId}::${f.flagType}`;
    if (existingSet.has(key)) continue;
    existingSet.add(key); // also dedupe within this same batch
    newFlags.push(f);
  }

  if (newFlags.length === 0) {
    console.log("No new anomalies");
    return;
  }

  const BATCH_SIZE = 5;
  const DELAY_MS = 300;

  const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < newFlags.length; i += BATCH_SIZE) {

    const batch = newFlags.slice(i, i + BATCH_SIZE);

    await Promise.all(

      batch.map(async (f) => {

        try {

          const doc =
            await databases.createDocument(
              DB_ID,
              ANOMALY_FLAG_COLLECTION_ID,
              ID.unique(),
              f
            );

          if (performedBy) {

            logAudit({
              clientId: f.clientId,
              entityType: "anomaly_flag",
              entityId: doc.$id,
              action: "ANOMALY_CREATED",
              performedBy,
              oldValue: "",
              newValue: JSON.stringify(f),
              note:
                `Anomaly flagged: ${f.flagType}`
            }).catch(console.error);

          }

        } catch (err) {

          if (
            err?.code === 429 ||
            err?.message?.includes("Rate limit")
          ) {

            console.warn(
              `Rate limited: ${f.flagType}`
            );

            return;
          }

          console.error(err);

        }

      })

    );

    if (i + BATCH_SIZE < newFlags.length) {

      await sleep(DELAY_MS);

    }

  }

}

export async function getAnomalyFlags(clientId) {
  const res = await databases.listDocuments(
    DB_ID, ANOMALY_FLAG_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.limit(2000)]
  );
  return res.documents;
}

export async function updateAnomalyFlag(flagId, updates, clientId, performedBy) {
  const result = await databases.updateDocument(
    DB_ID, ANOMALY_FLAG_COLLECTION_ID, flagId, updates
  );

  await logAudit({
    clientId,
    entityType: "anomaly_flag",
    entityId: flagId,
    action: "ANOMALY_UPDATED",
    performedBy: performedBy ?? "system",
    oldValue: "",
    newValue: JSON.stringify(updates),
    note: `Updated anomaly fields: ${Object.keys(updates).join(", ")}`,
  });

  return result;
}

// ─── Review Action ────────────────────────────────────────────────────────────
export async function storeReviewAction(action) {
  return databases.createDocument(
    DB_ID, REVIEW_ACTION_COLLECTION_ID, ID.unique(), action
  );
}

// ─── Audit Log ────────────────────────────────────────────────────────────────
export async function writeAuditLog(entry) {
  return databases.createDocument(
    DB_ID, AUDIT_LOG_COLLECTION_ID, ID.unique(), entry
  );
}
// ─── Expense Records ──────────────────────────────────────────────────────────
export const EXPENSE_COLLECTION_ID = "expense_records";

export async function storeExpenseRecords(expenses) {
  if (!expenses || expenses.length === 0) return { saved: 0, skipped: 0 };

  const clientId = expenses[0].clientId;
  const existingFingerprints = new Set();

  try {
    const existing = await databases.listDocuments(
      DB_ID,
      EXPENSE_COLLECTION_ID,
      [Query.equal("clientId", clientId), Query.limit(5000)]
    );
    existing.documents.forEach((d) => existingFingerprints.add(d.fingerprint));
  } catch (err) {
    console.warn("storeExpenseRecords: could not fetch existing fingerprints:", err.message);
  }

  let saved = 0;
  let skipped = 0;

  for (const record of expenses) {
    if (existingFingerprints.has(record.fingerprint)) {
      skipped++;
      continue;
    }
    try {
const { month, year } = getMonthYear(record.expenseDate ?? record.expense_date);
      await databases.createDocument(DB_ID, EXPENSE_COLLECTION_ID, ID.unique(), {
        ...record,
        month: month ?? 0,
        year:  year  ?? 0,
      });      saved++;
    } catch (err) {
      console.error("storeExpenseRecords: failed row", record.expenseRowIndex, err.message);
    }
  }

  if (saved > 0) {
    await logAudit({
      clientId,
      entityType: "expense_record",
      entityId: "",
      action: "EXPENSE_RECORDS_IMPORTED",
      performedBy: "system",
      oldValue: "",
      newValue: "",
      note: `Imported ${saved} expense record(s), skipped ${skipped} duplicate(s)`,
    });
  }

  return { saved, skipped };
}

export async function getExpenseRecords(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const response = await databases.listDocuments(DB_ID, EXPENSE_COLLECTION_ID, queries);
  return response.documents;
}

// ─── Uploaded Documents ───────────────────────────────────────────────────────

export async function uploadDocument({ file, clientId, documentType, fileHash, uploadBatchId, performedBy, month = null, year = null }) {
  const storageResponse = await storage.createFile(BUCKET_ID, ID.unique(), file);
  const storageFileId   = storageResponse.$id;
  const now = new Date();
  const docMonth = month ?? (now.getMonth() + 1);  // ← NEW
  const docYear  = year  ?? now.getFullYear();      // ← NEW

  const dbResponse = await databases.createDocument(
    DB_ID, DOCUMENTS_COLLECTION_ID, ID.unique(),
    {
      clientId,
      fileName:     file.name,
      documentType,
      fileHash,
      uploadBatchId,
      storageFileId,
      logicalPath:  `${clientId}/${documentType}/${file.name}`,
      uploadedAt:   now.toISOString(),
      month:        docMonth,  // ← NEW
      year:         docYear,   // ← NEW
    }
  );
  // ...
  return {
    storageFileId,
    documentRecordId: dbResponse.$id,
    logicalPath:      dbResponse.logicalPath,
    month:            docMonth,  // ← NEW
    year:             docYear,   // ← NEW
  };
}

export async function getUploadedDocuments(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.orderDesc("$createdAt")];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const response = await databases.listDocuments(DB_ID, DOCUMENTS_COLLECTION_ID, queries);
  return response.documents;
}

export async function deleteUploadedDocument(storageFileId, documentRecordId, clientId, performedBy, fileName) {
  await storage.deleteFile(BUCKET_ID, storageFileId);
  await databases.deleteDocument(DB_ID, DOCUMENTS_COLLECTION_ID, documentRecordId);

  await logAudit({
    clientId: clientId ?? "",
    entityType: "uploaded_document",
    entityId: documentRecordId,
    action: "FILE_DELETED",
    performedBy: performedBy ?? "system",
    oldValue: fileName ?? "",
    newValue: "",
    note: `Deleted file "${fileName ?? documentRecordId}"`,
  });

  return true;
}

export async function getExistingFileHashes(clientId) {
  try {
    const response = await databases.listDocuments(
      DB_ID,
      DOCUMENTS_COLLECTION_ID,
      [Query.equal("clientId", clientId)]
    );
    return response.documents.map((doc) => doc.fileHash).filter(Boolean);
  } catch (err) {
    console.error("getExistingFileHashes failed:", err);
    return [];
  }
}

// ─── Validation Error Logging ─────────────────────────────────────────────────

export async function logValidationErrors({
  clientId,
  fileName,
  documentType,
  errors,
  acknowledged,
  uploadBatchId,
}) {
  if (!errors || errors.length === 0) return;

  const promises = errors.map((err) =>
    databases.createDocument(
      DB_ID,
      VALIDATION_ERRORS_COLLECTION_ID,
      ID.unique(),
      {
        clientId,
        fileName,
        documentType,
        rowNumber: err.rowNumber ?? 0,
        severity: err.severity ?? "error",
        field: err.field ?? "",
        message: (err.message ?? "").slice(0, 1000),
        rowData: (typeof err.rowData === "object"
          ? JSON.stringify(err.rowData)
          : (err.rowData ?? "")
        ).slice(0, 2000),
        acknowledged: !!acknowledged,
        uploadBatchId,
      }
    )
  );

  await Promise.all(promises);

  await logAudit({
    clientId,
    entityType: "validation_error",
    entityId: "",
    action: "VALIDATION_ERRORS_LOGGED",
    performedBy: "system",
    oldValue: "",
    newValue: "",
    note: `${errors.length} validation issue(s) logged for "${fileName}" (${documentType})`,
  });
}

// ─── Bank Transactions ────────────────────────────────────────────────────────

export async function storeBankTransactions(transactions) {
  if (!transactions || transactions.length === 0) return { saved: 0, skipped: 0 };

  const clientId = transactions[0].clientId;
  const existingFingerprints = new Set();

  try {
    const existing = await databases.listDocuments(
      DB_ID,
      BANK_TRANSACTIONS_COLLECTION_ID,
      [Query.equal("clientId", clientId), Query.limit(5000)]
    );
    existing.documents.forEach((d) => existingFingerprints.add(d.fingerprint));
  } catch (err) {
    console.warn("storeBankTransactions: could not fetch existing fingerprints:", err.message);
  }

  let saved = 0;
  let skipped = 0;

  for (const txn of transactions) {
    if (existingFingerprints.has(txn.fingerprint)) {
      skipped++;
      continue;
    }
    try {
      const { month, year } = getMonthYear(txn.txnDate ?? txn.transaction_date ?? txn.date);
      await databases.createDocument(DB_ID, BANK_TRANSACTIONS_COLLECTION_ID, ID.unique(), {
        ...txn,
        month: month ?? 0,
        year:  year  ?? 0,
      });
      saved++;
    } catch (err) {
      console.error("storeBankTransactions: failed row", txn.bankRowIndex, err.message);
    }
  }

  if (saved > 0) {
    await logAudit({
      clientId,
      entityType: "bank_transaction",
      entityId: "",
      action: "BANK_TRANSACTIONS_IMPORTED",
      performedBy: "system",
      oldValue: "",
      newValue: "",
      note: `Imported ${saved} bank transaction(s), skipped ${skipped} duplicate(s)`,
    });
  }

  return { saved, skipped };
}

export async function getBankTransactions(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const response = await databases.listDocuments(DB_ID, BANK_TRANSACTIONS_COLLECTION_ID, queries);
  return response.documents;
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function storeInvoices(invoices) {
  if (!invoices || invoices.length === 0) return { saved: 0, skipped: 0 };

  const clientId = invoices[0].clientId;
  const existingFingerprints = new Set();

  try {
    const existing = await databases.listDocuments(
      DB_ID,
      INVOICES_COLLECTION_ID,
      [Query.equal("clientId", clientId), Query.limit(5000)]
    );
    existing.documents.forEach((d) => existingFingerprints.add(d.fingerprint));
  } catch (err) {
    console.warn("storeInvoices: could not fetch existing fingerprints:", err.message);
  }

  let saved = 0;
  let skipped = 0;

  for (const inv of invoices) {
    if (existingFingerprints.has(inv.fingerprint)) {
      skipped++;
      continue;
    }
    try {
const { month, year } = getMonthYear(inv.invoiceDate ?? inv.invoice_date);
      await databases.createDocument(DB_ID, INVOICES_COLLECTION_ID, ID.unique(), {
        ...inv,
        month: month ?? 0,
        year:  year  ?? 0,
      });      saved++;
    } catch (err) {
      console.error("storeInvoices: failed row", inv.invoiceRowIndex, err.message);
    }
  }

  if (saved > 0) {
    await logAudit({
      clientId,
      entityType: "invoice",
      entityId: "",
      action: "INVOICES_IMPORTED",
      performedBy: "system",
      oldValue: "",
      newValue: "",
      note: `Imported ${saved} invoice(s), skipped ${skipped} duplicate(s)`,
    });
  }

  return { saved, skipped };
}

export async function getInvoices(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const response = await databases.listDocuments(DB_ID, INVOICES_COLLECTION_ID, queries);
  return response.documents;
}

// ─── Payroll Records ──────────────────────────────────────────────────────────

export async function storePayrollRecords(payrollRecords) {
  if (!payrollRecords || payrollRecords.length === 0) return { saved: 0, skipped: 0 };

  const clientId = payrollRecords[0].clientId;
  const existingFingerprints = new Set();

  try {
    const existing = await databases.listDocuments(
      DB_ID,
      PAYROLL_COLLECTION_ID,
      [Query.equal("clientId", clientId), Query.limit(5000)]
    );
    existing.documents.forEach((d) => existingFingerprints.add(d.fingerprint));
  } catch (err) {
    console.warn("storePayrollRecords: could not fetch existing fingerprints:", err.message);
  }

  let saved = 0;
  let skipped = 0;

  for (const record of payrollRecords) {
    if (existingFingerprints.has(record.fingerprint)) {
      skipped++;
      continue;
    }
    try {
const { month, year } = getMonthYear(record.payDate ?? record.pay_date);
      await databases.createDocument(DB_ID, PAYROLL_COLLECTION_ID, ID.unique(), {
        ...record,
        month: month ?? 0,
        year:  year  ?? 0,
      });      saved++;
    } catch (err) {
      console.error("storePayrollRecords: failed row", record.payrollRowIndex, err.message);
    }
  }

  if (saved > 0) {
    await logAudit({
      clientId,
      entityType: "payroll_record",
      entityId: "",
      action: "PAYROLL_RECORDS_IMPORTED",
      performedBy: "system",
      oldValue: "",
      newValue: "",
      note: `Imported ${saved} payroll record(s), skipped ${skipped} duplicate(s)`,
    });
  }

  return { saved, skipped };
}

export async function getPayrollRecords(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const response = await databases.listDocuments(DB_ID, PAYROLL_COLLECTION_ID, queries);
  return response.documents;
}
// ─── Sale Records ─────────────────────────────────────────────────────────────

export async function storeSaleRecords(saleRecords) {
  if (!saleRecords || saleRecords.length === 0) return { saved: 0, skipped: 0 };

  const clientId = saleRecords[0].clientId;
  const existingFingerprints = new Set();

  try {
    const existing = await databases.listDocuments(
      DB_ID,
      SALES_COLLECTION_ID,
      [Query.equal("clientId", clientId), Query.limit(5000)]
    );
    existing.documents.forEach((d) => existingFingerprints.add(d.fingerprint));
  } catch (err) {
    console.warn("storeSaleRecords: could not fetch existing fingerprints:", err.message);
  }

  let saved = 0;
  let skipped = 0;

  for (const record of saleRecords) {
    if (existingFingerprints.has(record.fingerprint)) {
      skipped++;
      continue;
    }
    try {
const { month, year } = getMonthYear(record.saleDate ?? record.sale_date);
      await databases.createDocument(DB_ID, SALES_COLLECTION_ID, ID.unique(), {
        ...record,
        month: month ?? 0,
        year:  year  ?? 0,
      });      saved++;
    } catch (err) {
      console.error("storeSaleRecords: failed row", record.saleRowIndex, err.message);
    }
  }

  if (saved > 0) {
    await logAudit({
      clientId,
      entityType: "sale_record",
      entityId: "",
      action: "SALE_RECORDS_IMPORTED",
      performedBy: "system",
      oldValue: "",
      newValue: "",
      note: `Imported ${saved} sale record(s), skipped ${skipped} duplicate(s)`,
    });
  }

  return { saved, skipped };
}
// ─── Update bank transaction (remaining amount / match status) ──────────────
export async function updateBankTransaction(txnId, data, clientId, performedBy) {
  const result = await databases.updateDocument(DATABASE_ID, BANK_TRANSACTIONS_COLLECTION_ID, txnId, data);

  await logAudit({
    clientId: clientId ?? "",
    entityType: "bank_transaction",
    entityId: txnId,
    action: "BANK_TXN_UPDATED",
    performedBy: performedBy ?? "system",
    oldValue: "",
    newValue: JSON.stringify(data),
    note: `Updated fields: ${Object.keys(data).join(", ")}`,
  });

  return result;
}

// ─── Update source document (invoice/expense/payroll/sale) ──────────────────
const SOURCE_DOC_COLLECTIONS = {
  invoice: INVOICES_COLLECTION_ID,
  expense: EXPENSE_COLLECTION_ID,
  payroll: PAYROLL_COLLECTION_ID,
  sale: SALES_COLLECTION_ID,
};

export async function updateSourceDocument(docType, docId, data, clientId, performedBy) {
  const collectionId = SOURCE_DOC_COLLECTIONS[docType];
  if (!collectionId) throw new Error(`Unknown doc type: ${docType}`);
  const result = await databases.updateDocument(DATABASE_ID, collectionId, docId, data);

  await logAudit({
    clientId: clientId ?? "",
    entityType: `${docType}_record`,
    entityId: docId,
    action: "SOURCE_DOC_UPDATED",
    performedBy: performedBy ?? "system",
    oldValue: "",
    newValue: JSON.stringify(data),
    note: `Updated ${docType} fields: ${Object.keys(data).join(", ")}`,
  });

  return result;
}

export async function getSaleRecords(clientId, month = null, year = null) {
  const queries = [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)];
  if (month) queries.push(Query.equal("month", month));
  if (year)  queries.push(Query.equal("year",  year));
  const response = await databases.listDocuments(DB_ID, SALES_COLLECTION_ID, queries);
  return response.documents;
}
// ─── Chart of Accounts ────────────────────────────────────────────────────────
export const COA_ACCOUNTS_COLLECTION_ID = "coa_accounts";

export async function getCoaAccounts(clientId) {
  const res = await databases.listDocuments(
    DB_ID,
    COA_ACCOUNTS_COLLECTION_ID,
    [
      Query.limit(500),
    ]
  );
  // Filter active accounts client-side (handles missing/different is_active field gracefully)
  return res.documents.filter((a) => a.is_active !== false);
}

export async function updateCoaAccount(accountId, data, clientId, performedBy) {
  const result = await databases.updateDocument(DB_ID, COA_ACCOUNTS_COLLECTION_ID, accountId, data);

  await logAudit({
    clientId: clientId ?? "",
    entityType: "coa_account",
    entityId: accountId,
    action: "COA_UPDATED",
    performedBy: performedBy ?? "system",
    oldValue: "",
    newValue: JSON.stringify(data),
    note: `Updated COA account fields: ${Object.keys(data).join(", ")}`,
  });

  return result;
}