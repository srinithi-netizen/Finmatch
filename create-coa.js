import { Client, Databases, ID } from "node-appwrite";

const client = new Client()
  .setEndpoint("https://cloud.appwrite.io/v1")
  .setProject("6a27fc2800189d6cffed")
  .setKey("standard_ec202a020e3ed7a850c52d78a5f0f839be1d5e0a1b42c70542a0f01801912723d09870ddb815bf25f965ed89992c23e393fea3af4be0425157f9dec01d88207d94e367073a227f43aa7a6fd572d96fa277948b7d048975f1d45c0a2c692378cb7a19c9366b8a726881e0395906f6aefd6db96dc8f2348d2aaeb2e438e7837deb");

const databases = new Databases(client);

const DATABASE_ID = "6a27fe0f0008e45ab951";
const COLLECTION_ID = "coa_accounts";

// ─── Account Data ────────────────────────────────────────────────────────────

const accounts = [
  // ── Assets ──────────────────────────────────────
  // Current Assets
  { account_code: "1010", account_name: "Cash on hand",                           account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1020", account_name: "Petty cash",                              account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1030", account_name: "Bank — current account",                  account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1040", account_name: "Bank — savings account",                  account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1100", account_name: "Accounts receivable",                     account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1110", account_name: "Allowance for doubtful debts",            account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1120", account_name: "Notes receivable (short-term)",           account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1200", account_name: "Inventory — raw materials",               account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1210", account_name: "Inventory — WIP",                         account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1220", account_name: "Inventory — finished goods",              account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1300", account_name: "Prepaid expenses",                        account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1310", account_name: "Advance to suppliers",                    account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1320", account_name: "Input tax credit (GST/VAT)",              account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1400", account_name: "Short-term investments",                  account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1410", account_name: "Marketable securities",                   account_type: "Asset", category: "Current Assets",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  // Travel & Transportation
{
  account_code: "6230",
  account_name: "Travel Expense",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "General business travel expenses"
},
{
  account_code: "6240",
  account_name: "Local Conveyance",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Taxi, auto, metro, cab and local transportation"
},
{
  account_code: "6250",
  account_name: "Airfare Expense",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Domestic and international flight expenses"
},
{
  account_code: "6260",
  account_name: "Hotel & Accommodation",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Business lodging and accommodation expenses"
},
{
  account_code: "6270",
  account_name: "Meals While Traveling",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Employee meals incurred during business travel"
},
{
  account_code: "6280",
  account_name: "Mileage Reimbursement",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Employee-owned vehicle reimbursement"
},
{
  account_code: "6290",
  account_name: "Fuel Expense",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Fuel costs for business travel"
},
{
  account_code: "6295",
  account_name: "Parking & Toll Charges",
  account_type: "Expense",
  category: "Operating & Admin Expenses",
  sub_category: "Travel & Transportation",
  normal_balance: "Debit",
  financial_statement: "Profit & Loss",
  description: "Parking fees and highway tolls"
},
  // Non-Current Assets
  { account_code: "1500", account_name: "Land",                                    account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1510", account_name: "Buildings",                               account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1515", account_name: "Accumulated depreciation — buildings",    account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1520", account_name: "Plant & machinery",                       account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1525", account_name: "Accumulated depreciation — plant",        account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1530", account_name: "Furniture & fixtures",                    account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1535", account_name: "Accumulated depreciation — furniture",    account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1540", account_name: "Vehicles",                                account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1545", account_name: "Accumulated depreciation — vehicles",     account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1550", account_name: "Computer & IT equipment",                 account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1555", account_name: "Accumulated depreciation — IT",           account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1560", account_name: "Capital work in progress (CWIP)",         account_type: "Asset", category: "Non-Current Assets",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  // Intangible Assets
  { account_code: "1600", account_name: "Goodwill",                                account_type: "Asset", category: "Intangible Assets",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1610", account_name: "Patents & trademarks",                    account_type: "Asset", category: "Intangible Assets",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1620", account_name: "Software licenses",                       account_type: "Asset", category: "Intangible Assets",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1625", account_name: "Accumulated amortisation",                account_type: "Asset", category: "Intangible Assets",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "1630", account_name: "Franchise rights",                        account_type: "Asset", category: "Intangible Assets",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  // Other Assets
  { account_code: "1700", account_name: "Security deposits (long-term)",           account_type: "Asset", category: "Other Assets",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1710", account_name: "Notes receivable (long-term)",            account_type: "Asset", category: "Other Assets",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1720", account_name: "Long-term investments",                   account_type: "Asset", category: "Other Assets",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  { account_code: "1730", account_name: "Deferred tax asset",                      account_type: "Asset", category: "Other Assets",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },

  // ── Liabilities ─────────────────────────────────
  // Current Liabilities
  { account_code: "2010", account_name: "Accounts payable",                        account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2020", account_name: "Notes payable (short-term)",              account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2030", account_name: "Accrued expenses",                        account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2040", account_name: "Accrued salaries & wages",                account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2050", account_name: "Advance from customers",                  account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2060", account_name: "Output tax payable (GST/VAT)",            account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2070", account_name: "TDS / withholding tax payable",           account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2080", account_name: "Income tax payable",                      account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2090", account_name: "Current portion of long-term debt",       account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2100", account_name: "Short-term bank overdraft",               account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2110", account_name: "Dividends payable",                       account_type: "Liability", category: "Current Liabilities",     sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  // Non-Current Liabilities
  { account_code: "2200", account_name: "Long-term loans — bank",                  account_type: "Liability", category: "Non-Current Liabilities", sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2210", account_name: "Bonds / debentures payable",              account_type: "Liability", category: "Non-Current Liabilities", sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2220", account_name: "Finance lease liabilities",               account_type: "Liability", category: "Non-Current Liabilities", sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2230", account_name: "Deferred tax liability",                  account_type: "Liability", category: "Non-Current Liabilities", sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2240", account_name: "Provision for gratuity / pension",        account_type: "Liability", category: "Non-Current Liabilities", sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "2250", account_name: "Other long-term provisions",              account_type: "Liability", category: "Non-Current Liabilities", sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },

  // ── Equity ──────────────────────────────────────
  // Owners' Equity / Share Capital
  { account_code: "3010", account_name: "Equity share capital",                    account_type: "Equity", category: "Share Capital",           sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3020", account_name: "Preference share capital",                account_type: "Equity", category: "Share Capital",           sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3030", account_name: "Capital contribution (partnership/proprietor)", account_type: "Equity", category: "Share Capital",    sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  // Retained Earnings & Reserves
  { account_code: "3100", account_name: "Retained earnings",                       account_type: "Equity", category: "Retained Earnings",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3110", account_name: "General reserve",                         account_type: "Equity", category: "Retained Earnings",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3120", account_name: "Capital reserve",                         account_type: "Equity", category: "Retained Earnings",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3130", account_name: "Securities premium",                      account_type: "Equity", category: "Retained Earnings",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3140", account_name: "Dividend declared",                       account_type: "Equity", category: "Retained Earnings",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Balance Sheet" },
  // Other Comprehensive Income
  { account_code: "3200", account_name: "Revaluation surplus",                     account_type: "Equity", category: "Other Comprehensive Income", sub_category: null,                       normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3210", account_name: "Foreign currency translation reserve",    account_type: "Equity", category: "Other Comprehensive Income", sub_category: null,                       normal_balance: "Credit", financial_statement: "Balance Sheet" },
  { account_code: "3220", account_name: "Fair value reserve",                      account_type: "Equity", category: "Other Comprehensive Income", sub_category: null,                       normal_balance: "Credit", financial_statement: "Balance Sheet" },

  // ── Revenue ─────────────────────────────────────
  // Operating Revenue
  { account_code: "4010", account_name: "Sales — products",                        account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4020", account_name: "Sales — services",                        account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4030", account_name: "Sales returns & allowances",              account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "4040", account_name: "Trade discounts given",                   account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "4050", account_name: "Subscription / SaaS revenue",             account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4060", account_name: "Project / contract revenue",              account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4070", account_name: "Franchise revenue",                       account_type: "Revenue", category: "Operating Revenue",       sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  // Other Income
  { account_code: "4200", account_name: "Interest income",                         account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4210", account_name: "Dividend income",                         account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4220", account_name: "Rental income",                           account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4230", account_name: "Gain on sale of assets",                  account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4240", account_name: "Foreign exchange gain",                   account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4250", account_name: "Miscellaneous income",                    account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "4260", account_name: "Grant / subsidy income",                  account_type: "Revenue", category: "Other Income",            sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },

  // ── Expenses ────────────────────────────────────
  // COGS
  { account_code: "5010", account_name: "Opening stock",                           account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "5020", account_name: "Purchases — raw materials",               account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "5030", account_name: "Purchase returns & allowances",           account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  { account_code: "5040", account_name: "Direct labour / manufacturing wages",     account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "5050", account_name: "Factory overhead",                        account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "5060", account_name: "Freight inward",                          account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "5070", account_name: "Closing stock (credit)",                  account_type: "Expense", category: "Cost of Goods Sold",      sub_category: null,                          normal_balance: "Credit", financial_statement: "Profit & Loss" },
  // Personnel Expenses
  { account_code: "6010", account_name: "Salaries & wages",                        account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6020", account_name: "Bonus & incentives",                      account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6030", account_name: "Employer provident fund (PF)",            account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6040", account_name: "Employee state insurance (ESI)",          account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6050", account_name: "Gratuity expense",                        account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6060", account_name: "Staff welfare & training",                account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6070", account_name: "Recruitment costs",                       account_type: "Expense", category: "Personnel Expenses",      sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  // Operating & Admin Expenses
  { account_code: "6100", account_name: "Rent expense",                            account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6110", account_name: "Utilities (electricity, water)",          account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6120", account_name: "Office supplies & stationery",            account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6130", account_name: "Printing & postage",                      account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6140", account_name: "Communication (internet, phone)",         account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6150", account_name: "Insurance expense",                       account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6160", account_name: "Legal & professional fees",               account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6170", account_name: "Audit fees",                              account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6180", account_name: "Bank charges",                            account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6190", account_name: "Software subscription (SaaS)",            account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6200", account_name: "Repairs & maintenance",                   account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6210", account_name: "Security charges",                        account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6220", account_name: "Housekeeping & facilities",               account_type: "Expense", category: "Operating & Admin",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  // Sales & Marketing Expenses
  { account_code: "6300", account_name: "Advertising & promotion",                 account_type: "Expense", category: "Sales & Marketing",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6310", account_name: "Sales commission",                        account_type: "Expense", category: "Sales & Marketing",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6320", account_name: "Trade show & events",                     account_type: "Expense", category: "Sales & Marketing",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6330", account_name: "Distribution & delivery",                 account_type: "Expense", category: "Sales & Marketing",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6340", account_name: "Freight outward",                         account_type: "Expense", category: "Sales & Marketing",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6350", account_name: "Customer support costs",                  account_type: "Expense", category: "Sales & Marketing",       sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  // Depreciation & Amortisation
  { account_code: "6400", account_name: "Depreciation — plant & machinery",        account_type: "Expense", category: "Depreciation & Amortisation", sub_category: null,                     normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6410", account_name: "Depreciation — buildings",                account_type: "Expense", category: "Depreciation & Amortisation", sub_category: null,                     normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6420", account_name: "Depreciation — vehicles",                 account_type: "Expense", category: "Depreciation & Amortisation", sub_category: null,                     normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6430", account_name: "Depreciation — IT equipment",             account_type: "Expense", category: "Depreciation & Amortisation", sub_category: null,                     normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6440", account_name: "Amortisation — intangibles",              account_type: "Expense", category: "Depreciation & Amortisation", sub_category: null,                     normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  // Finance Costs
  { account_code: "6500", account_name: "Interest on bank loans",                  account_type: "Expense", category: "Finance Costs",           sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6510", account_name: "Interest on overdraft",                   account_type: "Expense", category: "Finance Costs",           sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6520", account_name: "Loan processing charges",                 account_type: "Expense", category: "Finance Costs",           sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6530", account_name: "Foreign exchange loss",                   account_type: "Expense", category: "Finance Costs",           sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6540", account_name: "Interest on finance leases",              account_type: "Expense", category: "Finance Costs",           sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  // Tax Expenses
  { account_code: "6600", account_name: "Income tax expense — current",            account_type: "Expense", category: "Tax Expenses",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6610", account_name: "Deferred tax expense",                    account_type: "Expense", category: "Tax Expenses",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6620", account_name: "GST / VAT expense (non-recoverable)",     account_type: "Expense", category: "Tax Expenses",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6630", account_name: "Other statutory levies",                  account_type: "Expense", category: "Tax Expenses",            sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  // Other Expenses
  { account_code: "6700", account_name: "Bad debt expense",                        account_type: "Expense", category: "Other Expenses",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6710", account_name: "Loss on disposal of assets",              account_type: "Expense", category: "Other Expenses",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6720", account_name: "Donations & CSR",                         account_type: "Expense", category: "Other Expenses",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6730", account_name: "Prior period adjustments",                account_type: "Expense", category: "Other Expenses",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
  { account_code: "6740", account_name: "Miscellaneous expenses",                  account_type: "Expense", category: "Other Expenses",          sub_category: null,                          normal_balance: "Debit",  financial_statement: "Profit & Loss" },
];

// ─── Seeder ──────────────────────────────────────────────────────────────────

async function seedCOA() {
  let success = 0;
  let failed = 0;

  console.log(`\n🌱 Seeding ${accounts.length} accounts into collection "${COLLECTION_ID}"...\n`);

  for (const account of accounts) {
    try {
      const doc = {
        account_code:       account.account_code,
        account_name:       account.account_name,
        account_type:       account.account_type,
        category:           account.category,
        normal_balance:     account.normal_balance,
        financial_statement: account.financial_statement,
        is_active:          true,
        is_system:          true,
        allow_direct_posting: true,
      };

      // Only set optional fields if non-null
      if (account.sub_category)      doc.sub_category      = account.sub_category;
      if (account.description)       doc.description       = account.description;
      if (account.currency)          doc.currency          = account.currency;
      if (account.parent_account_code) doc.parent_account_code = account.parent_account_code;
      if (account.tax_category)      doc.tax_category      = account.tax_category;

      await databases.createDocument(DATABASE_ID, COLLECTION_ID, ID.unique(), doc);
      console.log(`  ✅  ${account.account_code}  ${account.account_name}`);
      success++;
    } catch (err) {
      console.error(`  ❌  ${account.account_code}  ${account.account_name}  →  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`✅ Inserted : ${success}`);
  console.log(`❌ Failed   : ${failed}`);
  console.log(`Total       : ${accounts.length}`);
}

seedCOA();