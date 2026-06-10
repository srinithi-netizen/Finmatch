import { Client, Databases } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "upload_validation_errors";

async function createUploadValidationErrorsCollection() {
  try {
    console.log("Creating Upload Validation Errors collection...");

    // Create Collection
    const collection = await databases.createCollection(
      DATABASE_ID,
      COLLECTION_ID,
      "Upload Validation Errors"
    );

    console.log(
      "✅ Collection created:",
      collection.$id
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
        size: 255,
        required: true,
      },
      {
        key: "documentType",
        size: 50,
        required: true,
      },
      {
        key: "severity",
        size: 20,
        required: true,
      },
      {
        key: "field",
        size: 100,
        required: true,
      },
      {
        key: "message",
        size: 1000,
        required: true,
      },
      {
        key: "rowData",
        size: 2000,
        required: true,
      },
      {
        key: "uploadBatchId",
        size: 100,
        required: true,
      },
    ];

    for (const attr of stringAttributes) {
      console.log(`Creating ${attr.key}`);

      await databases.createStringAttribute(
        DATABASE_ID,
        COLLECTION_ID,
        attr.key,
        attr.size,
        attr.required
      );

      console.log(`✅ ${attr.key}`);
    }

    // Integer Attribute
    await databases.createIntegerAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "rowNumber",
      true
    );

    console.log("✅ rowNumber");

    // Boolean Attribute
    await databases.createBooleanAttribute(
      DATABASE_ID,
      COLLECTION_ID,
      "acknowledged",
      true,
      false
    );

    console.log("✅ acknowledged");

    console.log(
      "🎉 Upload Validation Errors collection setup completed!"
    );
  } catch (error) {
    console.error("❌ Error:");
    console.error(JSON.stringify(error, null, 2));
  }
}

createUploadValidationErrorsCollection();