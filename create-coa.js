import { Client, Databases, ID } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "coa";

// Replace with actual client id
const CLIENT_ID = "client_001";

const DEFAULT_COA = [
  // ASSETS
  { code: "1110", name: "Cash in Hand", category: "Asset", subcategory: "Current Assets" },
  { code: "1120", name: "Bank Account", category: "Asset", subcategory: "Current Assets" },
  { code: "1130", name: "Accounts Receivable", category: "Asset", subcategory: "Current Assets" },
  { code: "1140", name: "Inventory", category: "Asset", subcategory: "Current Assets" },
  { code: "1150", name: "Prepaid Expenses", category: "Asset", subcategory: "Current Assets" },
  { code: "1160", name: "GST Input Credit", category: "Asset", subcategory: "Current Assets" },

  { code: "1210", name: "Furniture & Fixtures", category: "Asset", subcategory: "Fixed Assets" },
  { code: "1220", name: "Computer & Equipment", category: "Asset", subcategory: "Fixed Assets" },
  { code: "1230", name: "Vehicles", category: "Asset", subcategory: "Fixed Assets" },

  // LIABILITIES
  { code: "2110", name: "Accounts Payable", category: "Liability", subcategory: "Current Liabilities" },
  { code: "2120", name: "GST Output Payable", category: "Liability", subcategory: "Current Liabilities" },
  { code: "2130", name: "TDS Payable", category: "Liability", subcategory: "Current Liabilities" },
  { code: "2140", name: "Salary Payable", category: "Liability", subcategory: "Current Liabilities" },
  { code: "2150", name: "Provident Fund Payable", category: "Liability", subcategory: "Current Liabilities" },
  { code: "2160", name: "ESI Payable", category: "Liability", subcategory: "Current Liabilities" },

  { code: "2210", name: "Bank Loan", category: "Liability", subcategory: "Long-Term Liabilities" },
  { code: "2220", name: "Vehicle Loan", category: "Liability", subcategory: "Long-Term Liabilities" },

  // EQUITY
  { code: "3100", name: "Owner's Capital", category: "Equity", subcategory: "Capital" },
  { code: "3200", name: "Retained Earnings", category: "Equity", subcategory: "Capital" },
  { code: "3300", name: "Drawings", category: "Equity", subcategory: "Capital" },

  // INCOME
  { code: "4100", name: "Sales Revenue", category: "Income", subcategory: "Revenue" },
  { code: "4110", name: "Service Revenue", category: "Income", subcategory: "Revenue" },
  { code: "4210", name: "Interest Income", category: "Income", subcategory: "Other Income" },
  { code: "4220", name: "Discount Received", category: "Income", subcategory: "Other Income" },

  // EXPENSES
  { code: "5210", name: "Travel", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5220", name: "Meals", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5230", name: "Software", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5240", name: "Office Supplies", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5250", name: "Utilities", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5260", name: "Rent", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5270", name: "Marketing", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5280", name: "Professional Fees", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5290", name: "Internet", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5300", name: "Training", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5310", name: "Repairs & Maintenance", category: "Expense", subcategory: "Operating Expenses" },
  { code: "5320", name: "Insurance", category: "Expense", subcategory: "Operating Expenses" },

  { code: "5330", name: "Salaries & Wages", category: "Expense", subcategory: "Payroll Expenses" },
  { code: "5340", name: "Employer PF Contribution", category: "Expense", subcategory: "Payroll Expenses" },
  { code: "5350", name: "Employer ESI Contribution", category: "Expense", subcategory: "Payroll Expenses" },

  { code: "5360", name: "Bank Charges", category: "Expense", subcategory: "Financial Expenses" },
  { code: "5370", name: "Depreciation", category: "Expense", subcategory: "Non-Cash Expenses" },
  { code: "5380", name: "Miscellaneous", category: "Expense", subcategory: "Other Expenses" },
];

async function seedCOA() {
  try {
    console.log(`Seeding ${DEFAULT_COA.length} accounts...`);

    for (const account of DEFAULT_COA) {
      await databases.createDocument(
        DATABASE_ID,
        COLLECTION_ID,
        ID.unique(),
        {
          clientId: CLIENT_ID,
          code: account.code,
          name: account.name,
          category: account.category,
          subcategory: account.subcategory,
          isActive: true,
        }
      );

      console.log(`✅ ${account.code} - ${account.name}`);
    }

    console.log("🎉 COA seeding completed");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

seedCOA();