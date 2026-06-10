import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "payroll_transactions";

async function createPayrollCollection() {
  try {
    console.log("Creating payroll_transactions collection...");

    await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Payroll Transactions"
    );

    console.log("✅ Collection created");

    // STRING ATTRIBUTES
    const stringAttributes = [
      ["clientId", 100, true],
      ["documentRecordId", 100, true],
      ["uploadBatchId", 36, false],

      ["fingerprint", 64, true],

      ["employeeId", 100, false],
      ["employeeIdNormalized", 100, false],

      ["employeeName", 500, false],
      ["employeeNameNormalized", 500, false],

      ["department", 200, false],
      ["designation", 200, false],

      ["payDate", 20, false],
      ["payPeriod", 50, false],

      ["bankAccount", 100, false],
      ["bankName", 200, false],
      ["ifscCode", 50, false],

      ["panNumber", 50, false],
      ["uanNumber", 50, false],

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
      ["basicSalary", false],
      ["hra", false],
      ["allowances", false],
      ["grossPay", false],

      ["pfDeduction", false],
      ["taxDeduction", false],
      ["otherDeductions", false],
      ["totalDeductions", false],

      ["netPay", true],
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
      "payrollRowIndex",
      true
    );

    console.log("✅ payrollRowIndex created");

    // BOOLEAN ATTRIBUTE
    await databases.createBooleanAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "isDuplicate",
      true,
      false
    );

    console.log("✅ isDuplicate created");

    console.log("Waiting for attributes...");
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // INDEXES

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "payroll_fingerprint_unique",
      "unique",
      ["fingerprint"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "payroll_client_idx",
      "key",
      ["clientId"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "payroll_employee_idx",
      "key",
      ["employeeId"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "payroll_match_status_idx",
      "key",
      ["matchStatus"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "payroll_reconciliation_idx",
      "key",
      ["reconciliationStatus"]
    );

    console.log("🎉 Payroll collection setup completed");
  } catch (error) {
    console.error(
      "❌ Error:",
      JSON.stringify(error, null, 2)
    );
  }
}

createPayrollCollection();