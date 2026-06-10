import { Client, Databases, Query } from "appwrite";

const client = new Client();

client
  .setEndpoint("https://cloud.appwrite.io/v1") // Appwrite cloud endpoint
  .setProject("6a27fc2800189d6cffed"); // 🔁 Replace with your Project ID

export const databases = new Databases(client);

export const DB_ID = "6a27fe0f0008e45ab951";       // 🔁 Replace with your Database ID
export const CPA_COLLECTION_ID = "cpa_users";    // 🔁 Replace
export const CLIENTS_COLLECTION_ID = "clients";  // 🔁 Replace
// ============ ADD TO EXISTING appwrite/config.js ============

// 1. Add a new env var / constant for the validation errors collection
export const VALIDATION_ERRORS_COLLECTION_ID = "upload_validation_errors";
// Validation error collection in Appwrite console with these attributes:
//   clientId       (string, required)
//   fileName       (string, required)
//   documentType   (string, required)
//   rowNumber      (integer, required)
//   severity       (string, required)        -> "error" | "warning"
//   field          (string, required)
//   message        (string, required, size 1000)
//   rowData        (string, required, size 2000)
//   acknowledged   (boolean, required, default false)
//   uploadBatchId  (string, required)         -> groups errors from same upload
//   $createdAt is automatic

/**
 * Logs validation errors for a file to the validation_errors collection.
 * Call this BEFORE or AFTER the file upload, regardless of whether
 * the CPA proceeds — so there's an audit trail.
 */
export async function logValidationErrors({
  clientId,
  fileName,
  documentType,
  errors,
  acknowledged,
  uploadBatchId,
}) {
  const promises = errors.map((err) =>
    databases.createDocument(
      DATABASE_ID,
      VALIDATION_ERRORS_COLLECTION_ID,
      ID.unique(),
      {
        clientId,
        fileName,
        documentType,
        rowNumber: err.rowNumber,
        severity: err.severity,
        field: err.field,
        message: err.message,
        rowData: err.rowData ? err.rowData.slice(0, 2000) : "",
        acknowledged: !!acknowledged,
        uploadBatchId,
      }
    )
  );

  return Promise.all(promises);
}

/**
 * Fetch existing file hashes for duplicate detection across sessions.
 * Assumes you have a 'documents' or 'uploads' collection storing hash + clientId.
 */
export async function getExistingFileHashes(clientId) {
  // Adjust DOCUMENTS_COLLECTION_ID and field name to match your schema
  const response = await databases.listDocuments(
    DATABASE_ID,
    DOCUMENTS_COLLECTION_ID,
    [Query.equal("clientId", clientId)]
  );
  return response.documents.map((doc) => doc.fileHash).filter(Boolean);
}
export { Query };
