import { useEffect, useState, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import { getAuditLogs } from "../appwrite/config";

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

const ACTION_COLORS = {
  FILE_UPLOADED:        { bg: "#EFF6FF", color: "#1D4ED8" },
  FILE_DELETED:         { bg: "#FEF2F2", color: "#DC2626" },
  DOCUMENT_PROCESSED:   { bg: "#F0FDF4", color: "#16A34A" },
  MATCH_CREATED:        { bg: "#F5F3FF", color: "#7C3AED" },
  MATCH_UPDATED:        { bg: "#F5F3FF", color: "#7C3AED" },
  MANUALLY_APPROVED:    { bg: "#F0FDF4", color: "#16A34A" },
  MISC_NO_DOC:          { bg: "#FFFBEB", color: "#B45309" },
  ANOMALY_CREATED:      { bg: "#FEF3C7", color: "#92400E" },
  ANOMALY_UPDATED:      { bg: "#FEF3C7", color: "#92400E" },
  BANK_TXN_UPDATED:     { bg: "#EFF6FF", color: "#1D4ED8" },
  SOURCE_DOC_UPDATED:   { bg: "#EFF6FF", color: "#1D4ED8" },
  COA_UPDATED:          { bg: "#ECFEFF", color: "#0E7490" },
};

function actionStyle(action) {
  return ACTION_COLORS[action] ?? { bg: "#F3F4F6", color: "#475569" };
}

export default function AuditHistory() {
  const { id: clientId } = useParams();
  const location = useLocation();
  const client = location.state?.client;

  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [searchTerm, setSearchTerm]   = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");

  useEffect(() => {
    load();
  }, [clientId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getAuditLogs(clientId);
      setLogs(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const actionTypes = useMemo(() => {
    const set = new Set(logs.map((l) => l.action).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const entityTypes = useMemo(() => {
    const set = new Set(logs.map((l) => l.entityType).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    let list = logs;
    if (actionFilter !== "all") list = list.filter((l) => l.action === actionFilter);
    if (entityFilter !== "all") list = list.filter((l) => l.entityType === entityFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((l) =>
        (l.note ?? "").toLowerCase().includes(q) ||
        (l.entityId ?? "").toLowerCase().includes(q) ||
        (l.performedBy ?? "").toLowerCase().includes(q) ||
        (l.action ?? "").toLowerCase().includes(q) ||
        (l.entityType ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [logs, actionFilter, entityFilter, searchTerm]);

  if (!client) return <div>Client not found</div>;

  return (
    <ClientLayout client={client}>
      <div style={s.wrapper}>
        <div style={s.headerRow}>
          <div>
            <h2 style={s.heading}>📜 Audit History</h2>
            <p style={s.subheading}>
              Every action performed on this client's data — uploads, deletes, matches,
              approvals, and edits — is recorded here for compliance.
            </p>
          </div>
          <button onClick={load} disabled={loading} style={s.refreshBtn}>
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        {error && (
          <div style={s.errorBox}>⚠ {error}</div>
        )}

        {/* Filters */}
        <div style={s.filterBar}>
          <input
            type="text"
            placeholder="Search by note, user, entity, action…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={s.searchInput}
          />
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={s.select}>
            {actionTypes.map((a) => (
              <option key={a} value={a}>{a === "all" ? "All Actions" : a}</option>
            ))}
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} style={s.select}>
            {entityTypes.map((e) => (
              <option key={e} value={e}>{e === "all" ? "All Entities" : e}</option>
            ))}
          </select>
          <span style={s.countBadge}>{filteredLogs.length} of {logs.length} entries</span>
        </div>

        {/* Table */}
        {loading ? (
          <div style={s.emptyState}>Loading audit history…</div>
        ) : filteredLogs.length === 0 ? (
          <div style={s.emptyState}>
            {logs.length === 0
              ? "No audit history found for this client yet."
              : "No entries match your filters."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Date / Time</th>
                  <th style={s.th}>Action</th>
                  <th style={s.th}>Entity Type</th>
                  <th style={s.th}>Entity ID</th>
                  <th style={s.th}>Performed By</th>
                  <th style={s.th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const style = actionStyle(log.action);
                  return (
                    <tr key={log.$id} style={s.tr}>
                      <td style={{ ...s.td, whiteSpace: "nowrap", color: "#64748B" }}>
                        {fmtDateTime(log.$createdAt)}
                      </td>
                      <td style={s.td}>
                        <span style={{ ...s.actionPill, background: style.bg, color: style.color }}>
                          {(log.action ?? "—").replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={s.td}>{log.entityType || "—"}</td>
                      <td style={{ ...s.td, fontFamily: "monospace", fontSize: 11, color: "#64748B" }}>
                        {log.entityId ? log.entityId.slice(-10) : "—"}
                      </td>
                      <td style={s.td}>{log.performedBy || "—"}</td>
                      <td style={{ ...s.td, maxWidth: 480 }}>
                        {log.note ? (
                          <span>{log.note}</span>
                        ) : (
                          <span style={{ color: "#94A3B8" }}>—</span>
                        )}
                        {(log.oldValue || log.newValue) && (
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ fontSize: 11, color: "#7C3AED", cursor: "pointer" }}>
                              View raw change
                            </summary>
                            <div style={s.rawBox}>
                              {log.oldValue && (
                                <div><strong>Old:</strong> {log.oldValue}</div>
                              )}
                              {log.newValue && (
                                <div><strong>New:</strong> {log.newValue}</div>
                              )}
                            </div>
                          </details>
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

const s = {
  wrapper:     { background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #E2E8F0" },
  headerRow:   { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  heading:     { fontSize: 20, fontWeight: 700, color: "#1E293B", margin: 0 },
  subheading:  { fontSize: 13, color: "#64748B", marginTop: 6, maxWidth: 560, lineHeight: 1.5 },
  refreshBtn:  { padding: "8px 16px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" },
  errorBox:    { marginBottom: 16, padding: "10px 14px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, color: "#B91C1C", fontSize: 13 },
  filterBar:   { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" },
  searchInput: { flex: "2 1 240px", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13 },
  select:      { padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, background: "#fff", minWidth: 150 },
  countBadge:  { fontSize: 12, color: "#64748B", marginLeft: "auto", whiteSpace: "nowrap" },
  emptyState:  { textAlign: "center", padding: "48px 16px", color: "#94A3B8", fontSize: 14 },
  table:       { width: "100%", borderCollapse: "collapse" },
  th:          { textAlign: "left", padding: "10px 12px", background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" },
  tr:          { borderBottom: "1px solid #F1F5F9" },
  td:          { padding: "10px 12px", fontSize: 12.5, color: "#1E293B", verticalAlign: "top" },
  actionPill:  { display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
  rawBox:      { marginTop: 4, padding: "6px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 11, color: "#475569", fontFamily: "monospace", wordBreak: "break-all", maxHeight: 150, overflowY: "auto" },
};