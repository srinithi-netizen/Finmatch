import { Client, Databases, Storage, ID, Query } from "appwrite";

const client = new Client();

client
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed");

export const databases = new Databases(client);
export const storage   = new Storage(client);

// ─── Collection & Bucket IDs ──────────────────────────────────────────────────
export const DB_ID                           = "6a27fe0f0008e45ab951";
export const DATABASE_ID=DB_ID;
export const CPA_COLLECTION_ID               = "cpa_users";
export const CLIENTS_COLLECTION_ID           = "clients";
export const DOCUMENTS_COLLECTION_ID         = "uploaded_documents";
export const VALIDATION_ERRORS_COLLECTION_ID = "upload_validation_errors";
export const BUCKET_ID                       = "6a2903f8000fb8590cb1";
export const BANK_TRANSACTIONS_COLLECTION_ID = "bank_transactions";
export const INVOICES_COLLECTION_ID          = "invoices";
export const PAYROLL_COLLECTION_ID           = "payroll_transactions";
export const SALES_COLLECTION_ID             = "sale_records";

// Re-export Appwrite helpers so other files only import from here
export { ID, Query };
// ── NEW collection IDs (add these to your existing config.js) ─────────────────
export const TRANSACTION_MATCH_COLLECTION_ID  = "transaction_match";
export const CATEGORY_SUGGESTION_COLLECTION_ID = "category_suggestion";
export const ANOMALY_FLAG_COLLECTION_ID        = "anomaly_flag";
export const REVIEW_ACTION_COLLECTION_ID       = "review_action";
export const AUDIT_LOG_COLLECTION_ID           = "audit_log";

// ─── Transaction Match ────────────────────────────────────────────────────────
// Whitelist only the exact attribute names defined in your Appwrite transaction_match collection
function sanitizeMatchRow(row) {
  return {
    clientId:            String(row.clientId            ?? ""),
    bankTxnId:           String(row.bankTxnId           ?? ""),
    sourceDocId:         String(row.sourceDocId         ?? ""),
    sourceDocType:       String(row.sourceDocType       ?? ""),
    matchType:           String(row.matchType           ?? "one_to_one"),
    groupId:             String(row.groupId             ?? ""),
    status:              String(row.status              ?? "accepted"),
    confidenceScore:     parseFloat(row.confidenceScore ?? 0),
    confidenceBreakdown: typeof row.confidenceBreakdown === "string"
                           ? row.confidenceBreakdown
                           : JSON.stringify(row.confidenceBreakdown ?? {}),
    matchReason:         String(row.matchReason         ?? "").slice(0, 1000),
    matchedBy:           String(row.matchedBy           ?? ""),
    matchedAmount:       parseFloat(row.matchedAmount   ?? 0),
    remainingBankAmount: parseFloat(row.remainingBankAmount ?? 0),
    remainingDocAmount:  parseFloat(row.remainingDocAmount  ?? 0),
    currencyNote:        String(row.currencyNote        ?? "").slice(0, 200),
    reviewedAt:          String(row.reviewedAt          ?? ""),
    batchId:             String(row.batchId             ?? ""),
    coaCode:             String(row.coaCode             ?? ""),   // ← ADDED
  };
}

export async function storeTransactionMatches(matches) {
  if (!matches || matches.length === 0) return;
  const results = [];
  for (const match of matches) {
    try {
      const doc = await databases.createDocument(
        DB_ID, TRANSACTION_MATCH_COLLECTION_ID, ID.unique(), sanitizeMatchRow(match)
      );
      results.push(doc);
    } catch (err) {
      console.error("storeTransactionMatches failed for row:", JSON.stringify(sanitizeMatchRow(match)), err.message);
      throw err; // re-throw so the UI shows the real error
    }
  }
  return results;
}
export async function getTransactionMatches(clientId) {
  const res = await databases.listDocuments(
    DB_ID, TRANSACTION_MATCH_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.limit(2000)]
  );
  return res.documents;
}

export async function updateTransactionMatch(matchId, updates) {
  return databases.updateDocument(
    DB_ID, TRANSACTION_MATCH_COLLECTION_ID, matchId, updates
  );
}

// ─── Category Suggestion ──────────────────────────────────────────────────────
export async function storeCategorySuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) return;
  for (const s of suggestions) {
    await databases.createDocument(
      DB_ID, CATEGORY_SUGGESTION_COLLECTION_ID, ID.unique(), s
    );
  }
}

export async function getCategorySuggestions(clientId) {
  const res = await databases.listDocuments(
    DB_ID, CATEGORY_SUGGESTION_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.limit(2000)]
  );
  return res.documents;
}

export async function updateCategorySuggestion(docId, updates) {
  return databases.updateDocument(
    DB_ID, CATEGORY_SUGGESTION_COLLECTION_ID, docId, updates
  );
}

// ─── Anomaly Flag ─────────────────────────────────────────────────────────────
export async function storeAnomalyFlags(flags) {
  if (!flags || flags.length === 0) return;
  for (const f of flags) {
    await databases.createDocument(
      DB_ID, ANOMALY_FLAG_COLLECTION_ID, ID.unique(), f
    );
  }
}

export async function getAnomalyFlags(clientId) {
  const res = await databases.listDocuments(
    DB_ID, ANOMALY_FLAG_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.limit(2000)]
  );
  return res.documents;
}

export async function updateAnomalyFlag(flagId, updates) {
  return databases.updateDocument(
    DB_ID, ANOMALY_FLAG_COLLECTION_ID, flagId, updates
  );
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
      await databases.createDocument(DB_ID, EXPENSE_COLLECTION_ID, ID.unique(), record);
      saved++;
    } catch (err) {
      console.error("storeExpenseRecords: failed row", record.expenseRowIndex, err.message);
    }
  }

  return { saved, skipped };
}

export async function getExpenseRecords(clientId) {
  const response = await databases.listDocuments(
    DB_ID,
    EXPENSE_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)]
  );
  return response.documents;
}

// ─── Uploaded Documents ───────────────────────────────────────────────────────

export async function uploadDocument({ file, clientId, documentType, fileHash, uploadBatchId }) {
  const storageResponse = await storage.createFile(BUCKET_ID, ID.unique(), file);
  const storageFileId   = storageResponse.$id;

  const dbResponse = await databases.createDocument(
    DB_ID,
    DOCUMENTS_COLLECTION_ID,
    ID.unique(),
    {
      clientId,
      fileName:     file.name,
      documentType,
      fileHash,
      uploadBatchId,
      storageFileId,
      logicalPath:  `${clientId}/${documentType}/${file.name}`,
      uploadedAt:   new Date().toISOString(),
    }
  );

  return {
    storageFileId,
    documentRecordId: dbResponse.$id,
    logicalPath:      dbResponse.logicalPath,
  };
}

export async function getUploadedDocuments(clientId) {
  const response = await databases.listDocuments(
    DB_ID,
    DOCUMENTS_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt")]
  );
  return response.documents;
}

export async function deleteUploadedDocument(storageFileId, documentRecordId) {
  await storage.deleteFile(BUCKET_ID, storageFileId);
  await databases.deleteDocument(DB_ID, DOCUMENTS_COLLECTION_ID, documentRecordId);
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
        rowNumber:    err.rowNumber ?? 0,
        severity:     err.severity  ?? "error",
        field:        err.field     ?? "",
        message:      (err.message  ?? "").slice(0, 1000),
        rowData:      (typeof err.rowData === "object"
                        ? JSON.stringify(err.rowData)
                        : (err.rowData ?? "")
                      ).slice(0, 2000),
        acknowledged: !!acknowledged,
        uploadBatchId,
      }
    )
  );

  await Promise.all(promises);
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
      await databases.createDocument(DB_ID, BANK_TRANSACTIONS_COLLECTION_ID, ID.unique(), txn);
      saved++;
    } catch (err) {
      console.error("storeBankTransactions: failed row", txn.bankRowIndex, err.message);
    }
  }

  return { saved, skipped };
}

export async function getBankTransactions(clientId) {
  const response = await databases.listDocuments(
    DB_ID,
    BANK_TRANSACTIONS_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)]
  );
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
      await databases.createDocument(DB_ID, INVOICES_COLLECTION_ID, ID.unique(), inv);
      saved++;
    } catch (err) {
      console.error("storeInvoices: failed row", inv.invoiceRowIndex, err.message);
    }
  }

  return { saved, skipped };
}

export async function getInvoices(clientId) {
  const response = await databases.listDocuments(
    DB_ID,
    INVOICES_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)]
  );
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
      await databases.createDocument(DB_ID, PAYROLL_COLLECTION_ID, ID.unique(), record);
      saved++;
    } catch (err) {
      console.error("storePayrollRecords: failed row", record.payrollRowIndex, err.message);
    }
  }

  return { saved, skipped };
}

export async function getPayrollRecords(clientId) {
  const response = await databases.listDocuments(
    DB_ID,
    PAYROLL_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)]
  );
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
      await databases.createDocument(DB_ID, SALES_COLLECTION_ID, ID.unique(), record);
      saved++;
    } catch (err) {
      console.error("storeSaleRecords: failed row", record.saleRowIndex, err.message);
    }
  }

  return { saved, skipped };
}
// ─── Update bank transaction (remaining amount / match status) ──────────────
export async function updateBankTransaction(txnId, data) {
  return databases.updateDocument(DATABASE_ID, BANK_TRANSACTIONS_COLLECTION_ID, txnId, data);
}

// ─── Update source document (invoice/expense/payroll/sale) ──────────────────
const SOURCE_DOC_COLLECTIONS = {
  invoice: INVOICES_COLLECTION_ID,
  expense: EXPENSE_COLLECTION_ID,
  payroll: PAYROLL_COLLECTION_ID,
  sale: SALES_COLLECTION_ID,
};

export async function updateSourceDocument(docType, docId, data) {
  const collectionId = SOURCE_DOC_COLLECTIONS[docType];
  if (!collectionId) throw new Error(`Unknown doc type: ${docType}`);
  return databases.updateDocument(DATABASE_ID, collectionId, docId, data);
}

export async function getSaleRecords(clientId) {
  const response = await databases.listDocuments(
    DB_ID,
    SALES_COLLECTION_ID,
    [Query.equal("clientId", clientId), Query.orderDesc("$createdAt"), Query.limit(1000)]
  );
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

export async function updateCoaAccount(accountId, data) {
  return databases.updateDocument(DB_ID, COA_ACCOUNTS_COLLECTION_ID, accountId, data);
}