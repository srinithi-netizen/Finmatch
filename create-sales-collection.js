import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "sale_records";

async function createSaleRecordsCollection() {
  try {
    console.log("Creating sale_records collection...");

    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Sale Records"
    );

    console.log("✅ Collection created");

    // STRING ATTRIBUTES
    const stringAttributes = [
      ["clientId", 100, true],
      ["documentRecordId", 100, true],
      ["uploadBatchId", 36, false],

      ["fingerprint", 64, true],

      ["saleId", 100, false],
      ["saleIdNormalized", 100, false],

      ["saleDate", 20, false],

      ["customerName", 500, false],
      ["customerNameNormalized", 500, false],

      ["customerId", 100, false],

      ["productName", 500, false],
      ["productNameNormalized", 500, false],

      ["category", 200, false],
      ["salesperson", 200, false],
      ["region", 200, false],

      ["paymentMode", 100, false],
      ["paymentStatus", 100, false],

      ["currency", 10, false],

      ["matchStatus", 20, false],
      ["matchedBankTxnId", 100, false],

      ["reconciliationStatus", 30, false],

      ["processingStatus", 30, false],
      ["processingNotes", 1000, false],

      ["duplicateOfFingerprint", 64, false],

      ["sourceFileName", 500, false],
      ["documentType", 50, false],
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
      ["quantity", false],
      ["unitPrice", false],

      ["discount", false],
      ["discountPct", false],

      ["subtotal", false],

      ["taxAmount", false],
      ["taxRate", false],

      ["totalAmount", true],
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
      "saleRowIndex",
      true
    );

    console.log("✅ saleRowIndex created");

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
      "sale_fingerprint_unique",
      "unique",
      ["fingerprint"]
    );

    // Client lookups
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_client_idx",
      "key",
      ["clientId"]
    );

    // Sale ID lookups
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_id_idx",
      "key",
      ["saleId"]
    );

    // Customer lookups
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_customer_idx",
      "key",
      ["customerNameNormalized"]
    );

    // Product lookups
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_product_idx",
      "key",
      ["productNameNormalized"]
    );

    // Matching engine queries
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_match_status_idx",
      "key",
      ["matchStatus"]
    );

    // Reconciliation dashboard
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_reconciliation_idx",
      "key",
      ["reconciliationStatus"]
    );

    // Upload batch processing
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "sale_batch_idx",
      "key",
      ["uploadBatchId"]
    );

    console.log("🎉 Sale Records collection setup completed");
  } catch (error) {
    console.error(
      "❌ Error creating collection:",
      JSON.stringify(error, null, 2)
    );
  }
}

createSaleRecordsCollection();