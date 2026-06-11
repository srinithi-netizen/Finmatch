import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DB_ID = "6a27fe0f0008e45ab951";

async function createCollectionWithAttributes(
  collectionId,
  collectionName,
  attributes
) {
  try {
    await databases.createCollection(
      DB_ID,
      collectionId,
      collectionName
    );

    console.log(`✅ Collection created: ${collectionId}`);

    for (const [key, type, size, required] of attributes) {
      switch (type) {
        case "string":
          await databases.createStringAttribute(
            DB_ID,
            collectionId,
            key,
            size,
            required
          );
          break;

        case "float":
          await databases.createFloatAttribute(
            DB_ID,
            collectionId,
            key,
            required
          );
          break;

        case "boolean":
          await databases.createBooleanAttribute(
            DB_ID,
            collectionId,
            key,
            required
          );
          break;
      }

      console.log(`   ➜ ${key}`);
    }

    console.log(`🎉 ${collectionId} completed\n`);
  } catch (err) {
    console.error(`❌ ${collectionId}`, err.message);
  }
}

async function createCollections() {
  await createCollectionWithAttributes(
    "anomaly_flag",
    "Anomaly Flag",
    [
      ["clientId", "string", 50, true],
      ["relatedId", "string", 50, true],
      ["relatedType", "string", 20, true],
      ["flagType", "string", 50, true],
      ["severity", "string", 10, true],
      ["status", "string", 20, true],
      ["resolutionNote", "string", 1000, false],
      ["batchId", "string", 50, false],
    ]
  );

  await createCollectionWithAttributes(
    "review_action",
    "Review Action",
    [
      ["clientId", "string", 50, true],
      ["matchId", "string", 50, false],
      ["anomalyId", "string", 50, false],
      ["actionType", "string", 20, true],
      ["performedBy", "string", 50, true],
      ["comment", "string", 2000, false],
      ["batchId", "string", 50, false],
    ]
  );

  await createCollectionWithAttributes(
    "audit_log",
    "Audit Log",
    [
      ["clientId", "string", 50, true],
      ["entityType", "string", 30, true],
      ["entityId", "string", 50, true],
      ["action", "string", 30, true],
      ["performedBy", "string", 50, true],
      ["oldValue", "string", 500, false],
      ["newValue", "string", 500, false],
      ["note", "string", 1000, false],
    ]
  );

  await createCollectionWithAttributes(
    "category_suggestion",
    "Category Suggestion",
    [
      ["clientId", "string", 50, true],
      ["bankTxnId", "string", 50, true],
      ["categoryCode", "string", 50, true],
      ["categoryLabel", "string", 100, true],
      ["status", "string", 20, true],
      ["overriddenBy", "string", 50, false],
      ["batchId", "string", 50, false],
    ]
  );
}

createCollections();