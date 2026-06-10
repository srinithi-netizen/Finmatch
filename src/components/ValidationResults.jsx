import { useState } from "react";

export default function ValidationResults({ results, onAcknowledge, onRevalidate }) {
  const [acknowledged, setAcknowledged] = useState({});

  if (!results || results.length === 0) return null;

  const toggleAcknowledge = (fileName) => {
    setAcknowledged((prev) => ({ ...prev, [fileName]: !prev[fileName] }));
  };

  const allCriticalAcknowledged = results
    .filter((r) => r.errorCount > 0)
    .every((r) => acknowledged[r.fileName]);

  return (
    <div style={styles.container}>
      <h3>Validation Results</h3>

      {results.map((result) => (
        <div key={result.fileName} style={styles.fileBlock}>
          <div style={styles.fileHeader}>
            <strong>{result.fileName}</strong>
            <span style={styles.docTypeBadge}>{result.documentTypeLabel}</span>
            <span style={styles.rowCount}>{result.totalRows} rows</span>
            {result.errorCount === 0 && result.warningCount === 0 && (
              <span style={styles.successBadge}>✓ All checks passed</span>
            )}
            {result.errorCount > 0 && (
              <span style={styles.errorBadge}>{result.errorCount} error(s)</span>
            )}
            {result.warningCount > 0 && (
              <span style={styles.warningBadge}>{result.warningCount} warning(s)</span>
            )}
          </div>

          {result.errors.length > 0 && (
            <div style={styles.errorTableWrapper}>
              <table style={styles.errorTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Row</th>
                    <th style={styles.th}>Severity</th>
                    <th style={styles.th}>Field</th>
                    <th style={styles.th}>Issue</th>
                    <th style={styles.th}>Row Data</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((err, i) => (
                    <tr key={i}>
                      <td style={styles.td}>{err.rowNumber === 0 ? "—" : err.rowNumber}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.severityTag,
                            background: err.severity === "error" ? "#FEE2E2" : "#FEF3C7",
                            color: err.severity === "error" ? "#B91C1C" : "#92400E",
                          }}
                        >
                          {err.severity}
                        </span>
                      </td>
                      <td style={styles.td}>{err.field}</td>
                      <td style={styles.td}>{err.message}</td>
                      <td style={{ ...styles.td, ...styles.rowDataCell }}>{err.rowData || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.errorCount > 0 && (
            <div style={styles.acknowledgeRow}>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={!!acknowledged[result.fileName]}
                  onChange={() => toggleAcknowledge(result.fileName)}
                />
                {" "}I acknowledge these errors. Proceed with upload despite issues
                listed above (errors will be logged for review).
              </label>
            </div>
          )}
        </div>
      ))}

      <div style={styles.actionRow}>
        <button
          style={styles.proceedBtn}
          disabled={!allCriticalAcknowledged}
          onClick={() => onAcknowledge(acknowledged)}
        >
          {allCriticalAcknowledged
            ? "Proceed with Upload"
            : "Acknowledge all errors to proceed"}
        </button>
        {onRevalidate && (
          <button style={styles.revalidateBtn} onClick={onRevalidate}>
            Re-check Files
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    marginTop: "16px",
    padding: "16px",
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: "8px",
  },
  fileBlock: {
    marginBottom: "20px",
    paddingBottom: "16px",
    borderBottom: "1px solid #E2E8F0",
  },
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "10px",
  },
  docTypeBadge: {
    background: "#E0E7FF",
    color: "#3730A3",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: 12,
  },
  rowCount: {
    color: "#64748B",
    fontSize: 13,
  },
  successBadge: {
    background: "#DCFCE7",
    color: "#166534",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: 12,
  },
  errorBadge: {
    background: "#FEE2E2",
    color: "#B91C1C",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: 12,
    fontWeight: 600,
  },
  warningBadge: {
    background: "#FEF3C7",
    color: "#92400E",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: 12,
    fontWeight: 600,
  },
  errorTableWrapper: {
    maxHeight: "300px",
    overflowY: "auto",
    border: "1px solid #E2E8F0",
    borderRadius: "6px",
  },
  errorTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    position: "sticky",
    top: 0,
    background: "#F1F5F9",
    textAlign: "left",
    padding: "8px",
    borderBottom: "1px solid #E2E8F0",
  },
  td: {
    padding: "8px",
    borderBottom: "1px solid #F1F5F9",
    verticalAlign: "top",
  },
  rowDataCell: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#64748B",
    maxWidth: "300px",
    wordBreak: "break-word",
  },
  severityTag: {
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
  },
  acknowledgeRow: {
    marginTop: "10px",
    padding: "8px",
    background: "#FFFBEB",
    border: "1px solid #FDE68A",
    borderRadius: "6px",
  },
  checkboxLabel: {
    fontSize: 13,
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    cursor: "pointer",
  },
  actionRow: {
    display: "flex",
    gap: "10px",
    marginTop: "12px",
  },
  proceedBtn: {
    padding: "10px 20px",
    background: "#3B82F6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600,
  },
  revalidateBtn: {
    padding: "10px 20px",
    background: "#fff",
    color: "#3B82F6",
    border: "1px solid #3B82F6",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: 600,
  },
};