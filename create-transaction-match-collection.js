import {
  Client,
  Databases,
  ID,
  Permission,
  Role,
} from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DB_ID = "6a27fe0f0008e45ab951";

async function createCollection(collectionId, collectionName) {
  try {
    const collection = await databases.createCollection(
      DB_ID,
      collectionId,
      collectionName,
      [
        Permission.read(Role.any()),
        Permission.create(Role.any()),
        Permission.update(Role.any()),
        Permission.delete(Role.any()),
      ]
    );

    console.log(`✅ Created: ${collectionName}`);
    return collection;
  } catch (err) {
    console.error(`❌ Failed: ${collectionName}`);
    console.error(err.message);
  }
}

async function createString(collectionId, key, size, required = false) {
  await databases.createStringAttribute(
    DB_ID,
    collectionId,
    key,
    size,
    required
  );

  console.log(`   ➜ ${key}`);
}

async function createFloat(collectionId, key, required = false) {
  await databases.createFloatAttribute(
    DB_ID,
    collectionId,
    key,
    required
  );

  console.log(`   ➜ ${key}`);
}

async function createBoolean(collectionId, key, required = false) {
  await databases.createBooleanAttribute(
    DB_ID,
    collectionId,
    key,
    required
  );

  console.log(`   ➜ ${key}`);
}

async function main() {
  const COLLECTION_ID = "transaction_match";

  await createCollection(
    COLLECTION_ID,
    "Transaction Match"
  );

  await createString(COLLECTION_ID, "clientId", 50, true);
  await createString(COLLECTION_ID, "bankTxnId", 50, true);
  await createString(COLLECTION_ID, "sourceDocId", 50, true);
  await createString(COLLECTION_ID, "sourceDocType", 30, true);
  await createString(COLLECTION_ID, "matchType", 20, true);
  await createString(COLLECTION_ID, "status", 20, true);

  await createFloat(COLLECTION_ID, "confidenceScore");
  await createString(COLLECTION_ID, "matchReason", 1000);
  await createBoolean(COLLECTION_ID, "isManual");
  await createString(COLLECTION_ID, "matchedBy", 50);
  await createFloat(COLLECTION_ID, "matchedAmount");
  await createString(COLLECTION_ID, "currencyNote", 500);
  await createString(COLLECTION_ID, "reviewedAt", 30);
  await createString(COLLECTION_ID, "batchId", 50);

  console.log("🎉 Done");
}

main().catch(console.error);