import { useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import ValidationResults from "../components/ValidationResults";
import { validateFile } from "../utils/fileValidation";
import { parseFileToRows } from "../utils/fileParser";
import { validateRows, DOCUMENT_TYPES } from "../utils/rowValidation";
import UploadedDocumentsList from "./UploadedDocumentsList";

import MonthYearPicker from "../components/MonthYearPicker";
import {
  logValidationErrors,
  uploadDocument,
  deleteUploadedDocument,
  ID,
} from "../appwrite/config";

export default function UploadCenter() {
  const fileInputRef = useRef(null);
  const location = useLocation();
  const client = location.state?.client;

  const [pendingFiles, setPendingFiles] = useState([]);
  const [fileLevelErrors, setFileLevelErrors] = useState([]);
  const [validationResults, setValidationResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState("select"); // select | classify | validate | done
  const [uploadSummary, setUploadSummary] = useState([]); // per-file upload results
  const [uploadMonth, setUploadMonth] = useState(() => new Date().getMonth() + 1);
const [uploadYear,  setUploadYear]  = useState(() => new Date().getFullYear());

  if (!client) return <div>Client not found</div>;

  const cpaUserId = sessionStorage.getItem("cpa_user_id") ?? "cpa_user";

  const handleBrowse = () => fileInputRef.current?.click();

  // ── Step 1: File-level validation ────────────────────────────────────────────
  const processFiles = async (fileList) => {
    setIsProcessing(true);
    const newErrors = [];
    const newFiles = [];
    const hashesSoFar = pendingFiles.map((f) => f.hash);

    for (const file of Array.from(fileList)) {
      const result = await validateFile(file, hashesSoFar);
      if (!result.valid) {
        newErrors.push(result.error);
        continue;
      }
      hashesSoFar.push(result.hash);
      newFiles.push({
        file,
        name: file.name,
        size: file.size,
        hash: result.hash,
        documentType: guessDocumentType(file.name),
      });
    }

    setPendingFiles((prev) => [...prev, ...newFiles]);
    setFileLevelErrors(newErrors);
    setIsProcessing(false);
    if (newFiles.length > 0) setStage("classify");
  };

  const handleFileInputChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) processFiles(files);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) processFiles(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // ── Step 2: Document type classification ─────────────────────────────────────
  function guessDocumentType(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes("payroll") || lower.includes("salary")) return "payroll";
    if (lower.includes("invoice")) return "invoice";
    if (lower.includes("sales")) return "sales_report";
    if (lower.includes("revenue")) return "revenue_report";
    if (lower.includes("expense")) return "expense_report";
    if (lower.includes("bank") || lower.includes("statement")) return "bank_statement";
    return "bank_statement";
  }

  const updateDocumentType = (hash, newType) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.hash === hash ? { ...f, documentType: newType } : f))
    );
  };

  const removeFile = (hash) => {
    setPendingFiles((prev) => prev.filter((f) => f.hash !== hash));
  };

  // ── Step 3: Row-level validation ─────────────────────────────────────────────
  const runRowValidation = async () => {
    setIsProcessing(true);
    const results = [];

    for (const pf of pendingFiles) {
      const ext = pf.name.split(".").pop().toLowerCase();

      if (ext === "pdf") {
        results.push({
          fileName: pf.name,
          documentType: pf.documentType,
          documentTypeLabel:
            DOCUMENT_TYPES.find((d) => d.value === pf.documentType)?.label ||
            pf.documentType,
          errors: [],
          errorCount: 0,
          warningCount: 0,
          totalRows: 0,
          skipped: true,
        });
        continue;
      }

      try {
        const parsed = await parseFileToRows(pf.file);
        const validation = validateRows(pf.documentType, parsed.rows);
        results.push({
          fileName: pf.name,
          documentType: pf.documentType,
          documentTypeLabel:
            DOCUMENT_TYPES.find((d) => d.value === pf.documentType)?.label ||
            pf.documentType,
          ...validation,
        });
      } catch (err) {
        results.push({
          fileName: pf.name,
          documentType: pf.documentType,
          documentTypeLabel:
            DOCUMENT_TYPES.find((d) => d.value === pf.documentType)?.label ||
            pf.documentType,
          errors: [
            {
              rowNumber: 0,
              severity: "error",
              field: "file",
              message: `Failed to parse file: ${err.message}`,
              rowData: "",
            },
          ],
          errorCount: 1,
          warningCount: 0,
          totalRows: 0,
        });
      }
    }

    setValidationResults(results);
    setIsProcessing(false);
    setStage("validate");
  };

  // ── Step 4: Acknowledge → log errors → upload ────────────────────────────────
  const handleAcknowledge = async (acknowledgedMap) => {
    setIsProcessing(true);

    // ✅ FIX: ID.unique() — not DB_ID.unique()
    const uploadBatchId = ID.unique();

    try {
      // 4a. Log all row-level validation errors to Appwrite (audit trail)
      for (const result of validationResults) {
        if (result.errors.length > 0) {
          await logValidationErrors({
            clientId: client.$id || client.id,
            fileName: result.fileName,
            documentType: result.documentType,
            errors: result.errors,
            acknowledged: !!acknowledgedMap[result.fileName],
            uploadBatchId,
          });
        }
      }

      // 4b. Upload each file to Appwrite Storage
      const results = [];
      for (const pf of pendingFiles) {
        try {
          const result = await uploadDocument({
            file: pf.file,
            clientId: client.$id || client.id,
            documentType: pf.documentType,
            fileHash: pf.hash,
            uploadBatchId,
            performedBy: cpaUserId,
             month: uploadMonth,  // ← ADD
  year:  uploadYear,   // ← ADD
          });
          results.push({
            name: pf.name,
            success: true,
            path: result.logicalPath,
            storageFileId: result.storageFileId,
            documentRecordId: result.documentRecordId,
          });
        } catch (err) {
          results.push({ name: pf.name, success: false, error: err.message });
        }
      }

      setUploadSummary(results);
      setStage("done"); // ✅ FIX: only called once (was duplicated before)
    } catch (err) {
      console.error("Upload process failed:", err);
      alert("Something went wrong during the upload. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteUpload = async (item) => {
    const confirmed = window.confirm(
      `Delete ${item.name}?`
    );

    if (!confirmed) return;

    try {
      await deleteUploadedDocument(
        item.storageFileId,
        item.documentRecordId,
        client.$id || client.id,
        cpaUserId,
        item.name
      );

      setUploadSummary((prev) =>
        prev.filter(
          (f) =>
            f.documentRecordId !==
            item.documentRecordId
        )
      );

      alert("File deleted successfully");
    } catch (err) {
      console.error(err);
      alert("Failed to delete file");
    }
  };

  const resetAll = () => {
    setPendingFiles([]);
    setFileLevelErrors([]);
    setValidationResults([]);
    setUploadSummary([]);
    setStage("select");
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <ClientLayout client={client}>
      <div style={styles.uploadCard}>
        <h2>Upload Financial Documents</h2>
        <p>
          Upload bank statements, invoices, payroll reports, sales reports and
          expense reports.
        </p>

        {/* Dropzone */}
        {stage !== "done" && (
          <div
            style={{
              ...styles.dropzone,
              borderColor: isDragging ? "#3B82F6" : "#CBD5E1",
              background: isDragging ? "#EFF6FF" : "transparent",
            }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <div style={{ fontSize: 60 }}>📁</div>
            <h3>Drag files here</h3>
            <p>OR</p>
            <button onClick={handleBrowse} disabled={isProcessing}>
              {isProcessing ? "Processing..." : "Browse Files"}
            </button>
            <p>CSV • XLSX • PDF (max 25 MB each)</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,.pdf"
              style={{ display: "none" }}
              onChange={handleFileInputChange}
            />
          </div>
        )}

        {/* File-level errors */}
        {fileLevelErrors.length > 0 && (
          <div style={styles.errorBox}>
            <strong>⚠ Some files could not be added:</strong>
            <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
              {fileLevelErrors.map((err, i) => (
                <li key={i} style={{ color: "#B91C1C", fontSize: 14 }}>
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Step 2: Classify */}
        {stage === "classify" && pendingFiles.length > 0 && (
          <div style={styles.fileListBox}>
            <h4>Confirm document type for each file</h4>
             {/* Month/Year selector */}
    <div style={{ marginBottom: 16, padding: "12px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#0369a1", marginBottom: 8 }}>
        📅 Which period do these documents belong to?
      </p>
      <MonthYearPicker
        month={uploadMonth}
        year={uploadYear}
        onChange={(m, y) => { setUploadMonth(m); setUploadYear(y); }}
        label="Document Period"
      />
    </div>
            {pendingFiles.map((pf) => (
              <div key={pf.hash} style={styles.fileRow}>
                <span style={{ flex: 2 }}>📄 {pf.name}</span>
                <span style={{ flex: 1, color: "#64748B", fontSize: 13 }}>
                  {formatSize(pf.size)}
                </span>
                <select
                  value={pf.documentType}
                  onChange={(e) => updateDocumentType(pf.hash, e.target.value)}
                  style={{ flex: 1.5 }}
                >
                  {DOCUMENT_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>
                      {dt.label}
                    </option>
                  ))}
                </select>
                <button
                  style={styles.removeBtn}
                  onClick={() => removeFile(pf.hash)}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              style={styles.uploadBtn}
              onClick={runRowValidation}
              disabled={isProcessing || pendingFiles.length === 0}
            >
              {isProcessing ? "Validating rows..." : "Validate Files"}
            </button>
          </div>
        )}

        {/* Step 3 & 4: Row validation results + acknowledgement */}
        {stage === "validate" && (
          <ValidationResults
            results={validationResults}
            onAcknowledge={handleAcknowledge}
            onRevalidate={runRowValidation}
          />
        )}

        {/* Step 5: Done */}
        {stage === "done" && (
          <div style={styles.successBox}>
            <h3>✅ Upload Complete</h3>

            {/* Per-file upload summary */}
            {uploadSummary.length > 0 && (
              <div style={styles.summaryList}>
                {uploadSummary.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.summaryRow,
                      color: r.success ? "#166534" : "#B91C1C",
                    }}
                  >
                    <span>{r.success ? "✓" : "✗"}</span>
                    <span style={{ flex: 1 }}>{r.name}</span>
                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 12 }}>
                        {r.success ? r.path : `Failed: ${r.error}`}
                      </span>

                      {r.success && (
                        <button
                          onClick={() => handleDeleteUpload(r)}
                          style={{
                            background: "#EF4444",
                            color: "#fff",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p style={{ color: "#475569", fontSize: 14 }}>
              Validation results have been recorded for audit.
            </p>
            <button style={styles.uploadBtn} onClick={resetAll}>
              Upload More Files
            </button>
          </div>
        )}
      </div>
      <div>
        <UploadedDocumentsList clientId={client.$id} />
      </div>
    </ClientLayout>
  );
}

const styles = {
  uploadCard: { background: "#fff", borderRadius: "16px", padding: "32px" },
  dropzone: {
    minHeight: "250px",
    border: "2px dashed #CBD5E1",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    transition: "all 0.2s ease",
  },
  errorBox: {
    marginTop: "16px",
    padding: "12px 16px",
    background: "#FEF2F2",
    border: "1px solid #FCA5A5",
    borderRadius: "8px",
  },
  fileListBox: {
    marginTop: "16px",
    padding: "16px",
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: "8px",
  },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 0",
    borderBottom: "1px solid #E2E8F0",
  },
  removeBtn: {
    background: "none",
    border: "1px solid #CBD5E1",
    borderRadius: "6px",
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 13,
  },
  uploadBtn: {
    marginTop: "16px",
    width: "100%",
    padding: "10px",
    background: "#3B82F6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600,
  },
  successBox: {
    marginTop: "16px",
    padding: "24px",
    background: "#F0FDF4",
    border: "1px solid #BBF7D0",
    borderRadius: "8px",
  },
  summaryList: {
    marginBottom: "12px",
    border: "1px solid #E2E8F0",
    borderRadius: "6px",
    overflow: "hidden",
  },
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 12px",
    borderBottom: "1px solid #F1F5F9",
    fontSize: 13,
    background: "#fff",
  },
};