import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "uploaded_documents";

async function createUploadedDocumentsCollection() {
  try {
    console.log("Creating uploaded_documents collection...");

    // Create Collection
    const collection = await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Uploaded Documents"
    );

    console.log(
      `✅ Collection created: ${collection.$id}`
    );

    // String Attributes
    const stringAttributes = [
      {
        key: "clientId",
        size: 100,
        required: true,
      },
      {
        key: "fileName",
        size: 500,
        required: true,
      },
      {
        key: "documentType",
        size: 100,
        required: true,
      },
      {
        key: "fileHash",
        size: 64,
        required: true,
      },
      {
        key: "uploadBatchId",
        size: 36,
        required: true,
      },
      {
        key: "storageFileId",
        size: 100,
        required: true,
      },
      {
        key: "logicalPath",
        size: 800,
        required: true,
      },
      {
        key: "uploadedAt",
        size: 30,
        required: true,
      },
    ];

    for (const attr of stringAttributes) {
      console.log(`Creating attribute: ${attr.key}`);

      await databases.createStringAttribute(
        DATABASE_ID,
        COLLECTION_ID,
        attr.key,
        attr.size,
        attr.required
      );

      console.log(`✅ Created: ${attr.key}`);
    }

    // Recommended Indexes

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "clientId_index",
      "key",
      ["clientId"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "fileHash_index",
      "key",
      ["fileHash"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "uploadBatchId_index",
      "key",
      ["uploadBatchId"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "documentType_index",
      "key",
      ["documentType"]
    );

    await databases.createIndex(
      DATABASE_ID,
      COLLECTION_ID,
      "client_fileHash_index",
      "key",
      ["clientId", "fileHash"]
    );

    console.log("✅ Indexes created");

    console.log(
      "🎉 uploaded_documents collection setup completed!"
    );
  } catch (error) {
    console.error("❌ Error creating collection:");
    console.error(JSON.stringify(error, null, 2));
  }
}

createUploadedDocumentsCollection();