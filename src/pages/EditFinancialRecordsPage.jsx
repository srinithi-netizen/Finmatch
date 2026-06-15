import React, { useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import {
  getBankTransactions,
  getInvoices,
  getExpenseRecords,
  getPayrollRecords,
  getSaleRecords,
  updateBankTransaction,
  updateSourceDocument,
} from "../appwrite/config";

// ─── Record type definitions ──────────────────────────────────────────────
const RECORD_TYPES = [
  { value: "bank", label: "Bank Transactions", fetcher: getBankTransactions },
  { value: "invoice", label: "Invoices", fetcher: getInvoices },
  { value: "expense", label: "Expenses", fetcher: getExpenseRecords },
  { value: "payroll", label: "Payroll", fetcher: getPayrollRecords },
  { value: "sale", label: "Sales", fetcher: getSaleRecords },
];

// ─── Only show/edit the fields that matter for each record type ───────────
// Other fields (clientId, fingerprint, remainingAmount, matchStatus,
// matchedDocumentId, descriptionNormalized, month, year, etc.) are
// managed by the reconciliation engine and intentionally hidden.
const FIELD_CONFIG = {
  bank: {
    fields: ["txnDate", "description", "amount", "debit", "credit", "currency", "direction"],
  },
  invoice: {
  fields: ["invoiceNumber", "invoiceDate", "vendorName", "customerName", "totalAmount", "originalCurrency", "exchangeRate", "amountINR", "amountPaid", "amountDue", "paymentStatus"],
},
sale: {
  fields: ["saleId", "saleDate", "customerName", "totalAmount", "originalCurrency", "exchangeRate", "amountINR", "paymentMode"],
},
expense: {
  fields: ["expenseId", "expenseDate", "vendorName", "amount", "originalCurrency", "exchangeRate", "amountINR", "totalAmount", "paymentStatus"],
},

  payroll: {
    fields: ["employeeId", "employeeName", "payDate", "netPay", "paymentStatus"],
  },
 
};

// Friendlier column headers
const FIELD_LABELS = {
  txnDate: "Date",
  description: "Description",
  amount: "Amount",
  debit: "Debit",
  credit: "Credit",
  currency: "Currency",
  direction: "Direction",
  invoiceNumber: "Invoice #",
  invoiceDate: "Date",
  vendorName: "Vendor",
  customerName: "Customer",
  totalAmount: "Total",
  amountPaid: "Paid",
  amountDue: "Due",
  paymentStatus: "Payment Status",
  expenseId: "Expense ID",
  expenseDate: "Date",
  employeeId: "Employee ID",
  employeeName: "Employee",
  payDate: "Pay Date",
  netPay: "Net Pay",
  saleId: "Sale ID",
  saleDate: "Date",
  paymentMode: "Payment Mode",
  originalCurrency: "Currency",
exchangeRate: "Exchange Rate",
amountINR: "Amount (INR)",
};

// Enum-style fields → render as a dropdown instead of free text
const ENUM_OPTIONS = {
  
  direction: ["CREDIT", "DEBIT"],
  paymentStatus: ["PAID", "UNPAID", "PARTIAL", "OVERDUE"],
  paymentMode: ["CASH", "CARD", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"],
  currency: ["INR", "USD", "EUR", "GBP"],
};

const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" }, { value: 4, label: "April" },
  { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" }, { value: 12, label: "December" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 4 + i);

export default function EditFinancialRecordsPage() {
  const { clientId } = useParams();
  const location = useLocation();
  const client = location.state?.client ?? { $id: clientId, client_name: "Client" };

  const [performedBy, setPerformedBy] = useState("");
  const [recordType, setRecordType] = useState("bank");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(currentYear);

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [savingId, setSavingId] = useState(null);

  const editableFields = FIELD_CONFIG[recordType].fields;

  // ─── Fetch records ───────────────────────────────────────────────────
  const fetchRecords = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    setEditingId(null);
    try {
      const typeDef = RECORD_TYPES.find((t) => t.value === recordType);
      const data = await typeDef.fetcher(clientId, month, year);
      setRecords(data || []);
      if (!data || data.length === 0) {
        setError("No records found for the selected month/year.");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch records: " + err.message);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  // ─── Start editing a row ─────────────────────────────────────────────
  const startEdit = (record) => {
    const values = {};
    editableFields.forEach((key) => {
      values[key] = record[key] ?? "";
    });
    setEditingId(record.$id);
    setEditValues(values);
    setSuccess("");
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({});
  };

  const handleFieldChange = (key, value) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  };

  // ─── Save edits ───────────────────────────────────────────────────────
  const saveEdit = async (record) => {
    if (!performedBy.trim()) {
      setError("Please enter your name / user ID in 'Updated By' — this is required so the audit log can record who made the change.");
      return;
    }

    const updates = {};
    editableFields.forEach((key) => {
      let newVal = editValues[key];
      const originalVal = record[key];

      if (typeof originalVal === "number") {
        newVal = newVal === "" ? 0 : Number(newVal);
      } else if (typeof originalVal === "boolean") {
        newVal = newVal === true || newVal === "true";
      }

      if (newVal !== originalVal) {
        updates[key] = newVal;
      }
    });

    if (Object.keys(updates).length === 0) {
      setSuccess("No changes to save.");
      setEditingId(null);
      return;
    }

    setSavingId(record.$id);
    setError("");
    setSuccess("");

    try {
      if (recordType === "bank") {
        await updateBankTransaction(record.$id, updates, clientId, performedBy.trim());
      } else {
        await updateSourceDocument(recordType, record.$id, updates, clientId, performedBy.trim());
      }
      setSuccess("Record updated successfully and logged to audit trail.");
      setEditingId(null);
      setEditValues({});
      await fetchRecords();
    } catch (err) {
      console.error(err);
      setError("Failed to update record: " + err.message);
    } finally {
      setSavingId(null);
    }
  };

  // ─── Render an input for a given field ──────────────────────────────
  const renderEditableCell = (record, col) => {
    const value = editValues[col];
    const original = record[col];

    if (ENUM_OPTIONS[col]) {
      return (
        <select
          value={value ?? ""}
          onChange={(e) => handleFieldChange(col, e.target.value)}
          style={styles.input}
        >
          {ENUM_OPTIONS[col].map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    if (typeof original === "number") {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleFieldChange(col, e.target.value)}
          style={styles.input}
        />
      );
    }

    if (col.toLowerCase().includes("date")) {
      return (
        <input
          type="date"
          value={value ? String(value).slice(0, 10) : ""}
          onChange={(e) => handleFieldChange(col, e.target.value)}
          style={styles.input}
        />
      );
    }

    return (
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => handleFieldChange(col, e.target.value)}
        style={styles.input}
      />
    );
  };

  return (
    <ClientLayout client={client}>
      <div style={styles.page}>
        <h1 style={styles.title}>Edit Financial Records</h1>

        {/* ─── Filters ─── */}
        <div style={styles.filterBar}>
          <div style={styles.filterGroup}>
            <label style={styles.label}>Updated By</label>
            <input
              type="text"
              value={performedBy}
              onChange={(e) => setPerformedBy(e.target.value)}
              placeholder="Your name / user ID"
              style={styles.input}
            />
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.label}>Record Type</label>
            <select
              value={recordType}
              onChange={(e) => { setRecordType(e.target.value); setRecords([]); setEditingId(null); }}
              style={styles.input}
            >
              {RECORD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.label}>Month</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={styles.input}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.label}>Year</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={styles.input}>
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.label}>&nbsp;</label>
            <button onClick={fetchRecords} disabled={loading} style={styles.button}>
              {loading ? "Loading..." : "Load Records"}
            </button>
          </div>
        </div>

        {/* ─── Messages ─── */}
        {error && <div style={styles.errorBox}>{error}</div>}
        {success && <div style={styles.successBox}>{success}</div>}

        {/* ─── Table ─── */}
        {records.length > 0 && (
          <div style={styles.tableWrapper}>
            <p style={styles.countText}>{records.length} record(s) found</p>
            <table style={styles.table}>
              <thead>
                <tr>
                  {editableFields.map((col) => (
                    <th key={col} style={styles.th}>{FIELD_LABELS[col] ?? col}</th>
                  ))}
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const isEditing = editingId === record.$id;
                  const isSaving = savingId === record.$id;
                  return (
                    <tr key={record.$id} style={isEditing ? styles.rowEditing : {}}>
                      {editableFields.map((col) => (
                        <td key={col} style={styles.td}>
                          {isEditing
                            ? renderEditableCell(record, col)
                            : String(record[col] ?? "")}
                        </td>
                      ))}
                      <td style={styles.td}>
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEdit(record)}
                              disabled={isSaving}
                              style={styles.saveButton}
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </button>
                            <button onClick={cancelEdit} disabled={isSaving} style={styles.cancelButton}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => startEdit(record)} style={styles.editButton}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
const styles = {
  page: { fontFamily: "Arial, sans-serif", maxWidth: "100%" },
  title: { fontSize: "22px", fontWeight: "600", marginBottom: "16px" },
  filterBar: {
    display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end",
    marginBottom: "16px", padding: "12px", background: "#f5f5f5", borderRadius: "8px",
  },
  filterGroup: { display: "flex", flexDirection: "column", minWidth: "140px" },
  label: { fontSize: "12px", fontWeight: "600", marginBottom: "4px", color: "#444" },
  input: {
    padding: "6px 8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "13px",
    width: "100%", boxSizing: "border-box",
  },
  button: {
    padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none",
    borderRadius: "4px", cursor: "pointer", fontSize: "13px", fontWeight: "600",
  },
  errorBox: {
    background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: "6px",
    marginBottom: "12px", fontSize: "13px",
  },
  successBox: {
    background: "#dcfce7", color: "#166534", padding: "10px 14px", borderRadius: "6px",
    marginBottom: "12px", fontSize: "13px",
  },
  countText: { fontSize: "13px", color: "#555", marginBottom: "8px" },
  tableWrapper: { overflowX: "auto", border: "1px solid #e5e5e5", borderRadius: "6px", background: "#fff" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: "13px" },
  th: {
    background: "#f0f0f0", padding: "8px 10px", textAlign: "left",
    borderBottom: "2px solid #ddd", whiteSpace: "nowrap",
  },
  td: { padding: "6px 10px", borderBottom: "1px solid #eee", minWidth: "110px" },
  rowEditing: { background: "#fffbe6" },
  editButton: {
    padding: "4px 10px", background: "#2563eb", color: "#fff", border: "none",
    borderRadius: "4px", cursor: "pointer", fontSize: "12px",
  },
  saveButton: {
    padding: "4px 10px", background: "#16a34a", color: "#fff", border: "none",
    borderRadius: "4px", cursor: "pointer", fontSize: "12px", marginRight: "6px",
  },
  cancelButton: {
    padding: "4px 10px", background: "#9ca3af", color: "#fff", border: "none",
    borderRadius: "4px", cursor: "pointer", fontSize: "12px",
  },
};