import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "expense_records";

async function createExpenseRecordsCollection() {
  try {
    console.log("Creating expense_records collection...");

    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Expense Records"
    );

    console.log("✅ Collection created");

    // STRING ATTRIBUTES
    const stringAttributes = [
      ["clientId", 100, true],
      ["documentRecordId", 100, true],
      ["uploadBatchId", 36, true],

      ["fingerprint", 64, true],

      ["expenseId", 100, false],
      ["expenseIdNormalized", 100, false],

      ["expenseDate", 20, true],

      ["vendorName", 500, false],
      ["vendorNameNormalized", 500, false],

      ["category", 200, false],
      ["categoryNormalized", 200, false],

      ["description", 2000, false],

      ["currency", 10, false],

      ["paymentMode", 100, false],
      ["referenceNumber", 100, false],

      ["approvedBy", 200, false],
      ["department", 200, false],
      ["projectCode", 100, false],

      ["matchStatus", 20, true],
      ["matchedBankTxnId", 100, false],

      ["reconciliationStatus", 30, true],

      ["processingStatus", 20, true],
      ["processingNotes", 1000, false],

      ["duplicateOfFingerprint", 64, false],

      ["sourceFileName", 500, true],
      ["documentType", 50, true],
    ];

    for (const [key, size, required] of stringAttributes) {
      console.log(`Creating string attribute: ${key}`);

      await databases.createStringAttribute(
        DATABASE_ID,
        COLLECTION_ID,
        key,
        size,
        required
      );
    }

    // FLOAT ATTRIBUTES
    const floatAttributes = [
      ["amount", true],
      ["taxAmount", false],
      ["taxRate", false],
      ["totalAmount", false],
    ];

    for (const [key, required] of floatAttributes) {
      console.log(`Creating float attribute: ${key}`);

      await databases.createFloatAttribute(
        DATABASE_ID,
        COLLECTION_ID,
        key,
        required
      );
    }

    // INTEGER ATTRIBUTE
    await databases.createIntegerAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "expenseRowIndex",
      true
    );

    console.log("✅ expenseRowIndex created");

    // BOOLEAN ATTRIBUTE
    await databases.createBooleanAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "isDuplicate",
      true,
      false
    );

    console.log("✅ isDuplicate created");

    // Wait for Appwrite attribute processing
    console.log("⏳ Waiting for attributes...");
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // INDEXES

    // Duplicate detection
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_fingerprint_unique",
      "unique",
      ["fingerprint"]
    );

    // Client lookup
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_client_idx",
      "key",
      ["clientId"]
    );

    // Expense ID lookup
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_id_idx",
      "key",
      ["expenseId"]
    );

    // Vendor matching
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_vendor_idx",
      "key",
      ["vendorNameNormalized"]
    );

    // Category analytics
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_category_idx",
      "key",
      ["categoryNormalized"]
    );

    // Matching engine
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_match_status_idx",
      "key",
      ["matchStatus"]
    );

    // Reconciliation workflow
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_reconciliation_idx",
      "key",
      ["reconciliationStatus"]
    );

    // Batch processing
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "expense_batch_idx",
      "key",
      ["uploadBatchId"]
    );

    console.log("🎉 Expense Records collection setup completed");
  } catch (error) {
    console.error(
      "❌ Error creating collection:",
      JSON.stringify(error, null, 2)
    );
  }
}

createExpenseRecordsCollection();