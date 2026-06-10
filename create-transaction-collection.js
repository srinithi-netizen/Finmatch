import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "bank_transactions";

async function createBankTransactionsCollection() {
  try {
    console.log("Creating bank_transactions collection...");

    // Create Collection
    const collection = await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Bank Transactions"
    );

    console.log(`✅ Collection created: ${collection.$id}`);

    // ─────────────────────────────────────────────
    // String Attributes
    // ─────────────────────────────────────────────

    const stringAttributes = [
      { key: "clientId", size: 100, required: true },
      { key: "documentRecordId", size: 100, required: true },
      { key: "uploadBatchId", size: 36, required: true },
      { key: "fingerprint", size: 64, required: true },

      { key: "txnDate", size: 20, required: true },
      { key: "valueDate", size: 20, required: false },

      { key: "description", size: 2000, required: true },
      { key: "descriptionNormalized", size: 2000, required: true },

      { key: "refNumber", size: 100, required: false },

      { key: "direction", size: 10, required: true },
      { key: "currency", size: 10, required: false },

      { key: "matchStatus", size: 20, required: true },
      { key: "matchedDocumentId", size: 100, required: false },

      { key: "reconciliationStatus", size: 30, required: true },

      { key: "processingStatus", size: 20, required: true },
      { key: "processingNotes", size: 1000, required: false },

      { key: "duplicateOfFingerprint", size: 64, required: false },

      { key: "sourceFileName", size: 500, required: true },
      { key: "documentType", size: 50, required: true },
    ];

    for (const attr of stringAttributes) {
      console.log(`Creating string attribute: ${attr.key}`);

      await databases.createStringAttribute(
        DATABASE_ID,
        COLLECTION_ID,
        attr.key,
        attr.size,
        attr.required
      );
    }

    // ─────────────────────────────────────────────
    // Float Attributes
    // ─────────────────────────────────────────────

    const floatAttributes = [
      { key: "debit", required: false },
      { key: "credit", required: false },
      { key: "balance", required: false },
      { key: "amount", required: true },
    ];

    for (const attr of floatAttributes) {
      console.log(`Creating float attribute: ${attr.key}`);

      await databases.createFloatAttribute(
        DATABASE_ID,
        COLLECTION_ID,
        attr.key,
        attr.required
      );
    }

    // ─────────────────────────────────────────────
    // Integer Attributes
    // ─────────────────────────────────────────────

    await databases.createIntegerAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "bankRowIndex",
      true
    );

    console.log("✅ Created integer attribute: bankRowIndex");

    // ─────────────────────────────────────────────
    // Boolean Attributes
    // ─────────────────────────────────────────────

    await databases.createBooleanAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "isDuplicate",
      true,
      false
    );

    console.log("✅ Created boolean attribute: isDuplicate");

    // Wait a few seconds before creating indexes
    console.log("Waiting for attributes to finish processing...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // ─────────────────────────────────────────────
    // Indexes
    // ─────────────────────────────────────────────

    // Unique fingerprint
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "fingerprint_unique",
      "unique",
      ["fingerprint"]
    );

    console.log("✅ Created unique index: fingerprint");

    // clientId lookup
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "clientId_index",
      "key",
      ["clientId"]
    );

    console.log("✅ Created index: clientId");

    // uploadBatchId lookup
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "uploadBatchId_index",
      "key",
      ["uploadBatchId"]
    );

    console.log("✅ Created index: uploadBatchId");

    // reconciliation queries
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "matchStatus_index",
      "key",
      ["matchStatus"]
    );

    console.log("✅ Created index: matchStatus");

    console.log("🎉 bank_transactions collection created successfully!");
  } catch (error) {
    console.error("❌ Error creating collection:");
    console.error(JSON.stringify(error, null, 2));
  }
}

createBankTransactionsCollection();