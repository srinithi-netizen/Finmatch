import { useEffect, useState } from "react";


import { processBankStatement }  from "../utils/bankStatementProcessor";
import { processInvoiceFile }    from "../utils/invoiceProcessor";
import { processPayrollFile }    from "../utils/payrollProcessor";  
import { processSalesReportFile } from "../utils/salesReportProcessor";   // ← ADD
import { processExpenseFile } from "../utils/expenseProcessor";

import {
  getUploadedDocuments,
  deleteUploadedDocument,
  storeBankTransactions,
  storeInvoices,
  storePayrollRecords,
  storeSaleRecords,                                                        // ← ADD
  storage,
  storeExpenseRecords,
  BUCKET_ID,
  logAudit,
} from "../appwrite/config";
export default function UploadedDocumentsList({ clientId }) {
  const [docs, setDocs]                   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [deletingId, setDeletingId]       = useState(null);
  const [processingId, setProcessingId]   = useState(null);
  const [processResult, setProcessResult] = useState(null);

  const cpaUserId = sessionStorage.getItem("cpa_user_id") ?? "cpa_user";

  useEffect(() => {
    if (clientId) load();
  }, [clientId]);

  async function load() {
    setLoading(true);
    try {
      const result = await getUploadedDocuments(clientId);
      setDocs(result);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }

  // ── Download file blob from Appwrite Storage ─────────────────────────────────
  async function downloadFileBlob(doc) {
    const downloadUrl = storage.getFileDownload(BUCKET_ID, doc.storageFileId);
    const urlString   = typeof downloadUrl === "string"
      ? downloadUrl
      : (downloadUrl.href || downloadUrl.toString());
    const fetchResponse = await fetch(urlString);
    if (!fetchResponse.ok) throw new Error(`Download failed: ${fetchResponse.statusText}`);
    const blob = await fetchResponse.blob();
    return new File([blob], doc.fileName, { type: blob.type || "application/octet-stream" });
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function handleDelete(doc) {
    if (!window.confirm(`Delete "${doc.fileName}"? This cannot be undone.`)) return;
    setDeletingId(doc.$id);
    try {
      await deleteUploadedDocument(doc.storageFileId, doc.$id, clientId, cpaUserId, doc.fileName);
      setDocs((prev) => prev.filter((d) => d.$id !== doc.$id));
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      setDeletingId(null);
    }
  }

  // ── Process dispatcher ────────────────────────────────────────────────────────
  async function handleProcess(doc) {
  setProcessingId(doc.$id);
  try {
    const file = await downloadFileBlob(doc);

    if (doc.documentType === "bank_statement") {
      await processBankStatementDoc(doc, file);
    } else if (doc.documentType === "invoice") {
      await processInvoiceDoc(doc, file);
    } else if (doc.documentType === "payroll") {
      await processPayrollDoc(doc, file);
    } else if (doc.documentType === "sales_report") {          // ← ADD
      await processSalesReportDoc(doc, file);
    } 
     else if (doc.documentType === "expense_report") {

  // Verify correct logical path
  if (
    !doc.logicalPath ||
    !doc.logicalPath.includes("/expense_report/")
  ) {
    throw new Error(
      `Incorrect document selected. Expected expense report but found: ${doc.logicalPath}`
    );
  }

  await processExpenseDoc(doc, file);
}
    else {
      alert(`Processing for "${doc.documentType}" is not yet supported.`);
    }
  } catch (err) {
    console.error("Processing failed:", err);
    alert("Processing failed: " + err.message);
  } finally {
    setProcessingId(null);
  }
}

  // ── Bank Statement processing ─────────────────────────────────────────────────
  async function processBankStatementDoc(doc, file) {
    const { transactions, warnings } = await processBankStatement(
      file, clientId, doc.$id, doc.uploadBatchId || "manual"
    );
    if (transactions.length === 0) {
      alert("No transactions extracted. Verify the file is a valid bank statement.");
      return;
    }
    const { saved, skipped } = await storeBankTransactions(transactions);

    await logAudit({
      clientId,
      entityType:  "uploaded_document",
      entityId:    doc.$id,
      action:      "DOCUMENT_PROCESSED",
      performedBy: cpaUserId,
      oldValue:    "",
      newValue:    "",
      note:        `Processed bank statement "${doc.fileName}": ${saved} saved, ${skipped} duplicates skipped (of ${transactions.length} extracted)`,
    });

    setProcessResult({
      type:     "bank_statement",
      docName:  doc.fileName,
      total:    transactions.length,
      saved,
      skipped,
      warnings,
      records:  transactions.slice(0, 15),
    });
  }

  // ── Invoice processing ────────────────────────────────────────────────────────
  async function processInvoiceDoc(doc, file) {
    const { invoices, warnings } = await processInvoiceFile(
      file, clientId, doc.$id, doc.uploadBatchId || "manual"
    );
    if (invoices.length === 0) {
      alert("No invoices extracted. Verify the file is a valid invoice file.");
      return;
    }
    const { saved, skipped } = await storeInvoices(invoices);

    await logAudit({
      clientId,
      entityType:  "uploaded_document",
      entityId:    doc.$id,
      action:      "DOCUMENT_PROCESSED",
      performedBy: cpaUserId,
      oldValue:    "",
      newValue:    "",
      note:        `Processed invoice file "${doc.fileName}": ${saved} saved, ${skipped} duplicates skipped (of ${invoices.length} extracted)`,
    });

    setProcessResult({
      type:     "invoice",
      docName:  doc.fileName,
      total:    invoices.length,
      saved,
      skipped,
      warnings,
      records:  invoices.slice(0, 15),
    });
  }
  // ── Payroll processing ───────────────────────────────────────────────────────
  async function processPayrollDoc(doc, file) {
  const { payrollRecords, warnings } = await processPayrollFile(
    file, clientId, doc.$id, doc.uploadBatchId || "manual"
  );
  if (payrollRecords.length === 0) {
    alert("No payroll records extracted. Verify the file is a valid payroll report.");
    return;
  }
  const { saved, skipped } = await storePayrollRecords(payrollRecords);

  await logAudit({
    clientId,
    entityType:  "uploaded_document",
    entityId:    doc.$id,
    action:      "DOCUMENT_PROCESSED",
    performedBy: cpaUserId,
    oldValue:    "",
    newValue:    "",
    note:        `Processed payroll file "${doc.fileName}": ${saved} saved, ${skipped} duplicates skipped (of ${payrollRecords.length} extracted)`,
  });

  setProcessResult({
    type:    "payroll",
    docName: doc.fileName,
    total:   payrollRecords.length,
    saved,
    skipped,
    warnings,
    records: payrollRecords.slice(0, 15),
  });
}
// ── Sales Report processing ───────────────────────────────────────────────── 
async function processSalesReportDoc(doc, file) {
  const { saleRecords, warnings } = await processSalesReportFile(
    file, clientId, doc.$id, doc.uploadBatchId || "manual"
  );
  if (saleRecords.length === 0) {
    alert("No sale records extracted. Verify the file is a valid sales report.");
    return;
  }
  const { saved, skipped } = await storeSaleRecords(saleRecords);

  await logAudit({
    clientId,
    entityType:  "uploaded_document",
    entityId:    doc.$id,
    action:      "DOCUMENT_PROCESSED",
    performedBy: cpaUserId,
    oldValue:    "",
    newValue:    "",
    note:        `Processed sales report "${doc.fileName}": ${saved} saved, ${skipped} duplicates skipped (of ${saleRecords.length} extracted)`,
  });

  setProcessResult({
    type:    "sales_report",
    docName: doc.fileName,
    total:   saleRecords.length,
    saved,
    skipped,
    warnings,
    records: saleRecords.slice(0, 15),
  });
}

// ── Expense Report processing ─────────────────────────────────────────────────

async function processExpenseDoc(doc, file) {

  // Validate logical path before parsing
  const expectedPath = `${clientId}/expense_report/`;

  if (
    !doc.logicalPath ||
    !doc.logicalPath.startsWith(expectedPath)
  ) {
    throw new Error(
      `Expense parser received incorrect document.
       Logical Path: ${doc.logicalPath}
       Expected Path: ${expectedPath}`
    );
  }

  console.log("Processing Expense File:", {
    fileName: file.name,
    documentType: doc.documentType,
    logicalPath: doc.logicalPath,
    storageFileId: doc.storageFileId,
  });

  const { expenses, warnings } = await processExpenseFile(
    file,
    clientId,
    doc.$id,
    doc.uploadBatchId || "manual"
  );

  if (warnings.length > 0) {
    console.warn("Expense Processing Warnings:", warnings);
  }

  if (expenses.length === 0) {
    alert(
      warnings[0] ||
      "No expense records extracted. Verify the uploaded file is an expense report."
    );
    return;
  }

  const { saved, skipped } = await storeExpenseRecords(expenses);

  await logAudit({
    clientId,
    entityType:  "uploaded_document",
    entityId:    doc.$id,
    action:      "DOCUMENT_PROCESSED",
    performedBy: cpaUserId,
    oldValue:    "",
    newValue:    "",
    note:        `Processed expense report "${doc.fileName}": ${saved} saved, ${skipped} duplicates skipped (of ${expenses.length} extracted)`,
  });

  setProcessResult({
    type: "expense_report",
    docName: doc.fileName,
    total: expenses.length,
    saved,
    skipped,
    warnings,
    records: expenses.slice(0, 15),
  });
}
  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <p style={{ color: "#64748B", padding: 16 }}>Loading documents...</p>;
  if (docs.length === 0) return (
    <div style={s.wrapper}>
      <h3 style={s.heading}>Uploaded Documents</h3>
      <p style={{ color: "#64748B", fontSize: 13 }}>No documents uploaded yet.</p>
    </div>
  );

const PROCESSABLE = ["bank_statement", "invoice", "payroll", "sales_report", "expense_report"];
  return (
    <div style={s.wrapper}>
      <h3 style={s.heading}>Uploaded Documents</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>File Name</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Uploaded At</th>
              <th style={s.th}>Path</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.$id} style={s.tr}>
                <td style={s.td}>📄 {doc.fileName}</td>
                <td style={s.td}>
                  <span style={{
                    ...s.badge,
                    background: doc.documentType === "bank_statement" ? "#EFF6FF" : "#F0FDF4",
                    color:      doc.documentType === "bank_statement" ? "#1D4ED8" : "#166534",
                  }}>
                    {doc.documentType}
                  </span>
                </td>
                <td style={s.td}>{new Date(doc.$createdAt).toLocaleString()}</td>
                <td style={{ ...s.td, color: "#64748B", fontSize: 11 }}>{doc.logicalPath || "—"}</td>
                <td style={s.td}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>

                    {/* Process button — shown for supported types */}
                    {PROCESSABLE.includes(doc.documentType) && (
                      <button
                        onClick={() => handleProcess(doc)}
                        disabled={processingId === doc.$id}
                        style={{
                          ...s.processBtn,
background:
  doc.documentType === "invoice"      ? "#8B5CF6" :
  doc.documentType === "payroll"      ? "#10B981" :
  doc.documentType === "sales_report" ? "#F59E0B" :
  "#0EA5E9",
                          opacity: processingId === doc.$id ? 0.6 : 1,
                          cursor:  processingId === doc.$id ? "not-allowed" : "pointer",
                        }}
                      >
                        {processingId === doc.$id ? "⏳ Processing..." : "⚙ Process"}
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(doc)}
                      disabled={deletingId === doc.$id}
                      style={{
                        ...s.deleteBtn,
                        opacity: deletingId === doc.$id ? 0.5 : 1,
                        cursor:  deletingId === doc.$id ? "not-allowed" : "pointer",
                      }}
                    >
                      {deletingId === doc.$id ? "Deleting..." : "🗑 Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Result Modal ───────────────────────────────────────────────────────── */}
      {processResult && (
        <div style={s.overlay}>
          <div style={s.modal}>

            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ color: "#1E293B", marginBottom: 4 }}>
{processResult.type === "invoice"       ? "🧾"
 : processResult.type === "payroll"     ? "👥"
 : processResult.type === "sales_report"? "📊"
 : processResult.type === "expense_report" ? "🧾💸"
 : "🏦"} Processing Complete              </h3>
                <p style={{ color: "#64748B", fontSize: 12 }}>{processResult.docName}</p>
              </div>
              <button onClick={() => setProcessResult(null)} style={s.closeXBtn}>✕</button>
            </div>

            {/* Summary cards */}
            <div style={s.summaryGrid}>
              <div style={s.summaryCard}>
                <div style={s.summaryLabel}>Total Extracted</div>
                <div style={s.summaryVal}>{processResult.total}</div>
              </div>
              <div style={s.summaryCard}>
                <div style={s.summaryLabel}>Saved to DB</div>
                <div style={{ ...s.summaryVal, color: "#166534" }}>{processResult.saved}</div>
              </div>
              <div style={s.summaryCard}>
                <div style={s.summaryLabel}>Duplicates Skipped</div>
                <div style={{ ...s.summaryVal, color: "#92400E" }}>{processResult.skipped}</div>
              </div>
              <div style={s.summaryCard}>
                <div style={s.summaryLabel}>Warnings</div>
                <div style={{ ...s.summaryVal, color: "#7C3AED" }}>{processResult.warnings.length}</div>
              </div>
            </div>

            {/* Warnings */}
            {processResult.warnings.length > 0 && (
              <div style={s.warnBox}>
                <strong style={{ fontSize: 12, color: "#92400E" }}>⚠ Processing Warnings</strong>
                <ul style={{ marginTop: 6, paddingLeft: 18, maxHeight: 100, overflowY: "auto" }}>
                  {processResult.warnings.map((w, i) => (
                    <li key={i} style={{ fontSize: 11, color: "#92400E", marginBottom: 2 }}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preview table — switches based on type */}
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>
                Preview (first {processResult.records.length} records)
              </p>
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #E2E8F0" }}>
           {processResult.type === "invoice"         ? <InvoicePreviewTable  records={processResult.records} />
 : processResult.type === "payroll"       ? <PayrollPreviewTable  records={processResult.records} />
 : processResult.type === "sales_report"  ? <SalesPreviewTable    records={processResult.records} />
 : processResult.type === "expense_report"? <ExpensePreviewTable  records={processResult.records} />
 : <BankPreviewTable records={processResult.records} />
}    </div>
            </div>

            <button onClick={() => setProcessResult(null)} style={s.closeBtn}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invoice preview table ──────────────────────────────────────────────────────
function InvoicePreviewTable({ records }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Row","Invoice No","Date","Due Date","Vendor","Customer","Subtotal","Tax","Total","Status"].map((h) => (
            <th key={h} style={pt.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((inv, i) => (
          <tr key={i} style={{ background: inv.isDuplicate ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#F8FAFC" }}>
            <td style={pt.td}>{inv.invoiceRowIndex}</td>
            <td style={pt.td}>
              <span style={pt.invBadge}>{inv.invoiceNumber}</span>
            </td>
            <td style={pt.td}>{inv.invoiceDate || "—"}</td>
            <td style={pt.td}>{inv.dueDate     || "—"}</td>
            <td style={{ ...pt.td, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={inv.vendorName}>
              {inv.vendorName || "—"}
            </td>
            <td style={{ ...pt.td, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={inv.customerName}>
              {inv.customerName || "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right" }}>
              {inv.subtotal ? `₹${inv.subtotal.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right" }}>
              {inv.taxAmount ? `₹${inv.taxAmount.toLocaleString("en-IN")}` : "—"}
              {inv.taxRate   ? <span style={{ color: "#94A3B8", fontSize: 10 }}> ({inv.taxRate}%)</span> : ""}
            </td>
            <td style={{ ...pt.td, textAlign: "right", fontWeight: 700, color: "#1E293B" }}>
              ₹{inv.totalAmount?.toLocaleString("en-IN")}
            </td>
            <td style={pt.td}>
              <span style={{
                padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: inv.isDuplicate ? "#FEE2E2" : "#D1FAE5",
                color:      inv.isDuplicate ? "#991B1B" : "#065F46",
              }}>
                {inv.processingStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Bank statement preview table ───────────────────────────────────────────────
function BankPreviewTable({ records }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Row","Date","Description","Ref No","Dir","Amount","Balance","Status"].map((h) => (
            <th key={h} style={pt.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((t, i) => (
          <tr key={i} style={{ background: t.isDuplicate ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#F8FAFC" }}>
            <td style={pt.td}>{t.bankRowIndex}</td>
            <td style={pt.td}>{t.txnDate}</td>
            <td style={{ ...pt.td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={t.description}>
              {t.description}
            </td>
            <td style={pt.td}>
              {t.refNumber
                ? <span style={pt.refBadge}>{t.refNumber}</span>
                : <span style={{ color: "#94A3B8" }}>—</span>}
            </td>
            <td style={{ ...pt.td, fontWeight: 700, color: t.direction === "CR" ? "#166534" : "#991B1B" }}>
              {t.direction}
            </td>
            <td style={{ ...pt.td, textAlign: "right", fontWeight: 600 }}>
              ₹{t.amount?.toLocaleString("en-IN")}
            </td>
            <td style={{ ...pt.td, textAlign: "right", color: "#475569" }}>
              {t.balance ? `₹${t.balance.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={pt.td}>
              <span style={{
                padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: t.isDuplicate ? "#FEE2E2" : "#D1FAE5",
                color:      t.isDuplicate ? "#991B1B" : "#065F46",
              }}>
                {t.processingStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Payroll preview table ───────────────────────────────────────────────────────
function PayrollPreviewTable({ records }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Row","Emp ID","Name","Department","Pay Date","Basic","HRA","Allowances","Gross","PF","TDS","Total Ded","Net Pay","Status"].map((h) => (
            <th key={h} style={pt.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((p, i) => (
          <tr key={i} style={{ background: p.isDuplicate ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#F8FAFC" }}>
            <td style={pt.td}>{p.payrollRowIndex}</td>
            <td style={pt.td}>
              <span style={pt.invBadge}>{p.employeeId || "—"}</span>
            </td>
            <td style={{ ...pt.td, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={p.employeeName}>
              {p.employeeName || "—"}
            </td>
            <td style={pt.td}>{p.department || "—"}</td>
            <td style={pt.td}>{p.payDate || p.payPeriod || "—"}</td>
            <td style={{ ...pt.td, textAlign: "right" }}>
              {p.basicSalary ? `₹${p.basicSalary.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right" }}>
              {p.hra ? `₹${p.hra.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right" }}>
              {p.allowances ? `₹${p.allowances.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right", fontWeight: 600, color: "#1D4ED8" }}>
              {p.grossPay ? `₹${p.grossPay.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right", color: "#DC2626" }}>
              {p.pfDeduction ? `₹${p.pfDeduction.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right", color: "#DC2626" }}>
              {p.taxDeduction ? `₹${p.taxDeduction.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right", color: "#DC2626" }}>
              {p.totalDeductions ? `₹${p.totalDeductions.toLocaleString("en-IN")}` : "—"}
            </td>
            <td style={{ ...pt.td, textAlign: "right", fontWeight: 700, color: "#065F46" }}>
              ₹{p.netPay?.toLocaleString("en-IN")}
            </td>
            <td style={pt.td}>
              <span style={{
                padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: p.isDuplicate ? "#FEE2E2" : "#D1FAE5",
                color:      p.isDuplicate ? "#991B1B" : "#065F46",
              }}>
                {p.processingStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
// ── Sales report preview table ───────────────────────────────────────────────
function SalesPreviewTable({ records }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Row","Sale ID","Date","Customer","Product","Category",
            "Qty","Unit Price","Discount","Subtotal","Tax","Total",
            "Payment Mode","Pay Status","Status"].map((h) => (
            <th key={h} style={pt.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((s, i) => (
          <tr key={i} style={{
            background: s.isDuplicate ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#F8FAFC"
          }}>
            <td style={pt.td}>{s.saleRowIndex}</td>

            <td style={pt.td}>
              <span style={{ ...pt.invBadge, background: "#FEF3C7", color: "#92400E" }}>
                {s.saleId}
              </span>
            </td>

            <td style={pt.td}>{s.saleDate || "—"}</td>

            <td style={{
              ...pt.td, maxWidth: 120,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }} title={s.customerName}>
              {s.customerName || "—"}
            </td>

            <td style={{
              ...pt.td, maxWidth: 120,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }} title={s.productName}>
              {s.productName || "—"}
            </td>

            <td style={pt.td}>
              {s.category
                ? <span style={{ background: "#EDE9FE", color: "#5B21B6", padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600 }}>
                    {s.category}
                  </span>
                : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right" }}>
              {s.quantity > 0 ? s.quantity : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right" }}>
              {s.unitPrice > 0 ? `₹${s.unitPrice.toLocaleString("en-IN")}` : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right", color: "#DC2626" }}>
              {s.discount > 0 ? `₹${s.discount.toLocaleString("en-IN")}` : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right" }}>
              {s.subtotal ? `₹${s.subtotal.toLocaleString("en-IN")}` : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right", color: "#D97706" }}>
              {s.taxAmount > 0
                ? <>
                    {`₹${s.taxAmount.toLocaleString("en-IN")}`}
                    {s.taxRate > 0 && (
                      <span style={{ color: "#94A3B8", fontSize: 10 }}> ({s.taxRate}%)</span>
                    )}
                  </>
                : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right", fontWeight: 700, color: "#1E293B" }}>
              ₹{s.totalAmount?.toLocaleString("en-IN")}
            </td>

            <td style={pt.td}>
              {s.paymentMode
                ? <span style={{ background: "#E0F2FE", color: "#0369A1", padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600 }}>
                    {s.paymentMode}
                  </span>
                : "—"}
            </td>

            <td style={pt.td}>
              {s.paymentStatus && s.paymentStatus !== "unknown"
                ? <span style={{
                    padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600,
                    background:
                      s.paymentStatus.toLowerCase().includes("paid")    ? "#D1FAE5" :
                      s.paymentStatus.toLowerCase().includes("pending") ? "#FEF3C7" :
                      s.paymentStatus.toLowerCase().includes("cancel")  ? "#FEE2E2" :
                      "#F1F5F9",
                    color:
                      s.paymentStatus.toLowerCase().includes("paid")    ? "#065F46" :
                      s.paymentStatus.toLowerCase().includes("pending") ? "#92400E" :
                      s.paymentStatus.toLowerCase().includes("cancel")  ? "#991B1B" :
                      "#475569",
                  }}>
                    {s.paymentStatus}
                  </span>
                : "—"}
            </td>

            <td style={pt.td}>
              <span style={{
                padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: s.isDuplicate ? "#FEE2E2" : "#D1FAE5",
                color:      s.isDuplicate ? "#991B1B" : "#065F46",
              }}>
                {s.processingStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
// ── Expense report preview table ───────────────────────────────────────────────
function ExpensePreviewTable({ records }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Row","Exp ID","Date","Vendor","Category","Description",
            "Amount","Tax","Total","Payment","Ref No","Status"].map((h) => (
            <th key={h} style={pt.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((e, i) => (
          <tr key={i} style={{
            background: e.isDuplicate ? "#FEF2F2" : i % 2 === 0 ? "#fff" : "#F8FAFC"
          }}>
            <td style={pt.td}>{e.expenseRowIndex}</td>

            <td style={pt.td}>
              <span style={{ ...pt.invBadge, background: "#FEF3C7", color: "#92400E" }}>
                {e.expenseId || "—"}
              </span>
            </td>

            <td style={pt.td}>{e.expenseDate || "—"}</td>

            <td style={{
              ...pt.td, maxWidth: 130,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }} title={e.vendorName}>
              {e.vendorName || "—"}
            </td>

            <td style={pt.td}>
              {e.categoryNormalized
                ? <span style={{
                    background: "#EDE9FE", color: "#5B21B6",
                    padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600
                  }}>
                    {e.categoryNormalized}
                  </span>
                : "—"}
            </td>

            <td style={{
              ...pt.td, maxWidth: 160,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }} title={e.description}>
              {e.description || "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right", fontWeight: 600 }}>
              {e.amount < 0
                ? <span style={{ color: "#DC2626" }}>₹{Math.abs(e.amount).toLocaleString("en-IN")}</span>
                : `₹${e.amount?.toLocaleString("en-IN")}`
              }
            </td>

            <td style={{ ...pt.td, textAlign: "right", color: "#D97706" }}>
              {e.taxAmount > 0
                ? <>
                    {`₹${e.taxAmount.toLocaleString("en-IN")}`}
                    {e.taxRate > 0 && (
                      <span style={{ color: "#94A3B8", fontSize: 10 }}> ({e.taxRate}%)</span>
                    )}
                  </>
                : "—"}
            </td>

            <td style={{ ...pt.td, textAlign: "right", fontWeight: 700, color: "#1E293B" }}>
              ₹{e.totalAmount?.toLocaleString("en-IN")}
            </td>

            <td style={pt.td}>
              {e.paymentMode
                ? <span style={{
                    background: "#E0F2FE", color: "#0369A1",
                    padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600
                  }}>
                    {e.paymentMode}
                  </span>
                : "—"}
            </td>

            <td style={pt.td}>
              {e.referenceNumber
                ? <span style={pt.refBadge}>{e.referenceNumber}</span>
                : <span style={{ color: "#94A3B8" }}>—</span>}
            </td>

            <td style={pt.td}>
              <span style={{
                padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                background: e.isDuplicate ? "#FEE2E2" : "#D1FAE5",
                color:      e.isDuplicate ? "#991B1B" : "#065F46",
              }}>
                {e.processingStatus}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  wrapper:      { marginTop: 24, background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #E2E8F0" },
  heading:      { marginBottom: 16, color: "#1E293B", fontSize: 16, fontWeight: 600 },
  table:        { width: "100%", borderCollapse: "collapse" },
  th:           { textAlign: "left", padding: "10px 12px", background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", fontSize: 12, fontWeight: 600, color: "#475569", whiteSpace: "nowrap" },
  tr:           { borderBottom: "1px solid #F1F5F9" },
  td:           { padding: "10px 12px", fontSize: 13, color: "#1E293B", verticalAlign: "middle" },
  badge:        { padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 },
  processBtn:   { color: "#fff", border: "none", padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  deleteBtn:    { background: "#EF4444", color: "#fff", border: "none", padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  overlay:      { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 },
  modal:        { background: "#fff", borderRadius: 16, padding: 28, width: "95%", maxWidth: 1000, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" },
  summaryGrid:  { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 },
  summaryCard:  { background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "12px 14px" },
  summaryLabel: { fontSize: 10, color: "#64748B", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 },
  summaryVal:   { fontSize: 26, fontWeight: 700, color: "#1E293B" },
  warnBox:      { background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 14px", marginTop: 12 },
  closeBtn:     { marginTop: 20, width: "100%", padding: 10, background: "#1E293B", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  closeXBtn:    { background: "none", border: "1px solid #E2E8F0", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14, color: "#64748B" },
};

const pt = {
  th:       { textAlign: "left", padding: "8px 10px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontSize: 11, fontWeight: 600, color: "#475569", whiteSpace: "nowrap" },
  td:       { padding: "7px 10px", fontSize: 11, color: "#1E293B", verticalAlign: "middle" },
  invBadge: { background: "#EDE9FE", color: "#5B21B6", padding: "1px 7px", borderRadius: 8, fontSize: 11, fontWeight: 700 },
  refBadge: { background: "#EDE9FE", color: "#5B21B6", padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 600 },
};