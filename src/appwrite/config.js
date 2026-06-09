import { Client, Databases, Query } from "appwrite";

const client = new Client();

client
  .setEndpoint("https://cloud.appwrite.io/v1") // Appwrite cloud endpoint
  .setProject("6a27fc2800189d6cffed"); // 🔁 Replace with your Project ID

export const databases = new Databases(client);

export const DB_ID = "6a27fe0f0008e45ab951";       // 🔁 Replace with your Database ID
export const CPA_COLLECTION_ID = "cpa_users";    // 🔁 Replace
export const CLIENTS_COLLECTION_ID = "clients";  // 🔁 Replace

export { Query };