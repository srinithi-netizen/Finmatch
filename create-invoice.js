import { Client, Databases, ID } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "invoices";

async function createInvoicesCollection() {
  try {
    console.log("Creating invoices collection...");

    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Invoices"
    );

    console.log("✅ Collection created");

    // STRING ATTRIBUTES
    const stringAttributes = [
      ["clientId", 100, true],
      ["documentRecordId", 100, true],
      ["uploadBatchId", 36, true],
      ["fingerprint", 64, true],

      ["invoiceNumber", 100, true],
      ["invoiceNumberNormalized", 100, true],

      ["invoiceDate", 20, true],
      ["dueDate", 20, false],

      ["vendorName", 500, false],
      ["vendorNameNormalized", 500, false],

      ["customerName", 500, false],
      ["customerNameNormalized", 500, false],

      ["description", 2000, false],

      ["currency", 10, false],

      ["lineItems", 5000, false],

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
      ["subtotal", false],
      ["taxAmount", false],
      ["taxRate", false],
      ["totalAmount", true],
      ["amountPaid", false],
      ["amountDue", false],
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

    // INTEGER ATTRIBUTES
    await databases.createIntegerAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "invoiceRowIndex",
      true
    );

    console.log("✅ invoiceRowIndex created");

    // BOOLEAN ATTRIBUTES
    await databases.createBooleanAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "isDuplicate",
      true,
      false
    );

    console.log("✅ isDuplicate created");

    console.log("⏳ Waiting for attributes to finish processing...");
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // INDEXES

    // Unique fingerprint index
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "invoice_fingerprint_unique",
      "unique",
      ["fingerprint"]
    );

    console.log("✅ Unique fingerprint index created");

    // Client lookup index
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "invoice_client_idx",
      "key",
      ["clientId"]
    );

    console.log("✅ ClientId index created");

    // Invoice number lookup
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "invoice_number_idx",
      "key",
      ["invoiceNumber"]
    );

    console.log("✅ Invoice number index created");

    // Match status lookup
    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "invoice_match_status_idx",
      "key",
      ["matchStatus"]
    );

    console.log("✅ Match status index created");

    console.log("🎉 Invoices collection setup completed");
  } catch (error) {
    console.error(
      "❌ Error:",
      JSON.stringify(error, null, 2)
    );
  }
}

createInvoicesCollection();