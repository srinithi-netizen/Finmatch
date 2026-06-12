import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import {
  databases,
  DB_ID,
  TRANSACTION_MATCH_COLLECTION_ID,
  BANK_TRANSACTIONS_COLLECTION_ID,
  INVOICES_COLLECTION_ID,
  SALES_COLLECTION_ID,
  PAYROLL_COLLECTION_ID,
  EXPENSE_COLLECTION_ID,
  Query,
} from "../appwrite/config";

const STATUS_COLORS = {
  AUTO_MATCHED:       { bg: "#DCFCE7", color: "#16A34A" },
  PENDING_REVIEW:     { bg: "#FEF9C3", color: "#CA8A04" },
  MANUALLY_APPROVED:  { bg: "#DBEAFE", color: "#2563EB" },
  REJECTED:           { bg: "#FEE2E2", color: "#DC2626" },
};

const MATCH_TYPE_LABELS = {
  EXACT:        "Exact",
  PARTIAL:      "Partial",
  MANY_TO_ONE:  "Many→One",
  ONE_TO_MANY:  "One→Many",
  POSSIBLE:     "Possible",
};

const SOURCE_TYPE_ICONS = {
  INVOICE: "🧾",
  SALE:    "💰",
  PAYROLL: "👥",
  EXPENSE: "💸",
};

export default function TransactionPage() {
  const { id: clientId } = useParams();
  const location = useLocation();
  const client = location.state?.client;

  const [matches, setMatches]         = useState([]);
  const [bankMap, setBankMap]         = useState({});
  const [sourceMap, setSourceMap]     = useState({});
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // Filters
  const [statusFilter, setStatusFilter]     = useState("ALL");
  const [typeFilter, setTypeFilter]         = useState("ALL");
  const [matchTypeFilter, setMatchTypeFilter] = useState("ALL");
  const [search, setSearch]                 = useState("");
  const [page, setPage]                     = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (!clientId) return;
    loadAll();
  }, [clientId]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      // 1. Load all matches for this client
      const matchRes = await databases.listDocuments(
        DB_ID,
        TRANSACTION_MATCH_COLLECTION_ID,
        [Query.equal("clientId", clientId), Query.limit(2000)]
      );
      const matchDocs = matchRes.documents;

      // 2. Load bank transactions
      const bankRes = await databases.listDocuments(
        DB_ID,
        BANK_TRANSACTIONS_COLLECTION_ID,
        [Query.equal("clientId", clientId), Query.limit(2000)]
      );
      const bMap = {};
      bankRes.documents.forEach((t) => (bMap[t.$id] = t));
      setBankMap(bMap);

      // 3. Load all source docs (invoices, sales, payroll, expenses)
      const [invRes, saleRes, payRes, expRes] = await Promise.all([
        databases.listDocuments(DB_ID, INVOICES_COLLECTION_ID,  [Query.equal("clientId", clientId), Query.limit(2000)]),
        databases.listDocuments(DB_ID, SALES_COLLECTION_ID,     [Query.equal("clientId", clientId), Query.limit(2000)]),
        databases.listDocuments(DB_ID, PAYROLL_COLLECTION_ID,   [Query.equal("clientId", clientId), Query.limit(2000)]),
        databases.listDocuments(DB_ID, EXPENSE_COLLECTION_ID,   [Query.equal("clientId", clientId), Query.limit(2000)]),
      ]);
      const sMap = {};
      [...invRes.documents, ...saleRes.documents, ...payRes.documents, ...expRes.documents]
        .forEach((d) => (sMap[d.$id] = d));
      setSourceMap(sMap);

      setMatches(matchDocs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Derived label helpers ──────────────────────────────────────────────────
  function getBankLabel(bankTxnId) {
    const t = bankMap[bankTxnId];
    if (!t) return bankTxnId ?? "—";
    const date = t.txnDate ? t.txnDate.slice(0, 10) : "";
    const desc = t.description ?? t.descriptionNormalized ?? "";
    const amt  = t.amount != null ? `₹${Number(t.amount).toLocaleString("en-IN")}` : "";
    return [date, desc, amt].filter(Boolean).join(" · ");
  }

  function getSourceLabel(sourceDocId, sourceDocType) {
    const d = sourceMap[sourceDocId];
    if (!d) return sourceDocId ?? "—";
    switch (sourceDocType) {
      case "INVOICE":
        return `INV #${d.invoiceNumber ?? "—"} · ${d.vendorName ?? d.customerName ?? ""} · ₹${Number(d.totalAmount ?? 0).toLocaleString("en-IN")}`;
      case "SALE":
        return `Sale ${d.saleId ?? "—"} · ${d.customerName ?? ""} · ₹${Number(d.totalAmount ?? 0).toLocaleString("en-IN")}`;
      case "PAYROLL":
        return `${d.employeeName ?? "—"} · Pay ${d.payDate?.slice(0,10) ?? ""} · ₹${Number(d.netPay ?? 0).toLocaleString("en-IN")}`;
      case "EXPENSE":
        return `${d.vendorName ?? "—"} · ₹${Number(d.totalAmount ?? d.amount ?? 0).toLocaleString("en-IN")}`;
      default:
        return sourceDocId ?? "—";
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = matches.filter((m) => {
    if (statusFilter    !== "ALL" && m.status        !== statusFilter)    return false;
    if (typeFilter      !== "ALL" && m.sourceDocType !== typeFilter)      return false;
    if (matchTypeFilter !== "ALL" && m.matchType     !== matchTypeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const bankLabel   = getBankLabel(m.bankTxnId).toLowerCase();
      const sourceLabel = getSourceLabel(m.sourceDocId, m.sourceDocType).toLowerCase();
      if (!bankLabel.includes(q) && !sourceLabel.includes(q) && !m.matchReason?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary counts
  const counts = {
    total:    matches.length,
    auto:     matches.filter((m) => m.status === "AUTO_MATCHED").length,
    pending:  matches.filter((m) => m.status === "PENDING_REVIEW").length,
    approved: matches.filter((m) => m.status === "MANUALLY_APPROVED").length,
    rejected: matches.filter((m) => m.status === "REJECTED").length,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!client) return <div style={s.msg}>Client data missing. Please navigate from the dashboard.</div>;

  return (
    <ClientLayout client={client}>
      <div style={s.page}>

        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Matched Transactions</h1>
            <p style={s.sub}>AI-reconciled bank transactions linked to source documents</p>
          </div>
          <button onClick={loadAll} style={s.refreshBtn}>🔄 Refresh</button>
        </div>

        {/* Summary cards */}
        <div style={s.cards}>
          {[
            { label: "Total Matches", value: counts.total,    bg: "#EFF6FF", color: "#2563EB" },
            { label: "Auto Matched",  value: counts.auto,     bg: "#DCFCE7", color: "#16A34A" },
            { label: "Pending Review",value: counts.pending,  bg: "#FEF9C3", color: "#CA8A04" },
            { label: "Approved",      value: counts.approved, bg: "#DBEAFE", color: "#1D4ED8" },
            { label: "Rejected",      value: counts.rejected, bg: "#FEE2E2", color: "#DC2626" },
          ].map((c) => (
            <div key={c.label} style={{ ...s.card, background: c.bg }}>
              <div style={{ ...s.cardVal, color: c.color }}>{c.value}</div>
              <div style={s.cardLabel}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={s.filters}>
          <input
            style={s.search}
            placeholder="🔍  Search by bank txn, source doc, reason…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />

          <select style={s.select} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="ALL">All Statuses</option>
            <option value="AUTO_MATCHED">Auto Matched</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="MANUALLY_APPROVED">Manually Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>

          <select style={s.select} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="ALL">All Types</option>
            <option value="INVOICE">Invoice</option>
            <option value="SALE">Sale</option>
            <option value="PAYROLL">Payroll</option>
            <option value="EXPENSE">Expense</option>
          </select>

          <select style={s.select} value={matchTypeFilter} onChange={(e) => { setMatchTypeFilter(e.target.value); setPage(1); }}>
            <option value="ALL">All Match Types</option>
            <option value="EXACT">Exact</option>
            <option value="PARTIAL">Partial</option>
            <option value="MANY_TO_ONE">Many→One</option>
            <option value="ONE_TO_MANY">One→Many</option>
            <option value="POSSIBLE">Possible</option>
          </select>
        </div>

        {/* Error */}
        {error && <div style={s.error}>⚠️ {error}</div>}

        {/* Table */}
        {loading ? (
          <div style={s.msg}>Loading matched transactions…</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyIcon}>🔍</div>
            <div>No matched transactions found.</div>
            {(statusFilter !== "ALL" || typeFilter !== "ALL" || search) && (
              <button style={s.clearBtn} onClick={() => { setStatusFilter("ALL"); setTypeFilter("ALL"); setMatchTypeFilter("ALL"); setSearch(""); }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr style={s.thead}>
                    <th style={s.th}>Bank Transaction</th>
                    <th style={s.th}>Source Document</th>
                    <th style={s.th}>Type</th>
                    <th style={s.th}>Match Type</th>
                    <th style={s.th}>Matched Amt</th>
                    <th style={s.th}>Confidence</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((m) => {
                    const sc = STATUS_COLORS[m.status] ?? { bg: "#F1F5F9", color: "#334155" };
                    const conf = m.confidenceScore != null ? Math.round(m.confidenceScore * 100) : null;
                    return (
                      <tr key={m.$id} style={s.tr}>
                        <td style={s.td}>
                          <div style={s.bankLabel}>{getBankLabel(m.bankTxnId)}</div>
                          {bankMap[m.bankTxnId]?.direction && (
                            <span style={{
                              ...s.dirBadge,
                              background: bankMap[m.bankTxnId].direction === "CREDIT" ? "#DCFCE7" : "#FEE2E2",
                              color:      bankMap[m.bankTxnId].direction === "CREDIT" ? "#16A34A" : "#DC2626",
                            }}>
                              {bankMap[m.bankTxnId].direction}
                            </span>
                          )}
                        </td>

                        <td style={s.td}>
                          <span style={s.srcIcon}>{SOURCE_TYPE_ICONS[m.sourceDocType] ?? "📄"}</span>
                          <span style={s.srcLabel}>{getSourceLabel(m.sourceDocId, m.sourceDocType)}</span>
                        </td>

                        <td style={s.td}>
                          <span style={s.typeBadge}>{m.sourceDocType ?? "—"}</span>
                        </td>

                        <td style={s.td}>
                          <span style={s.matchTypeBadge}>{MATCH_TYPE_LABELS[m.matchType] ?? m.matchType ?? "—"}</span>
                        </td>

                        <td style={{ ...s.td, fontWeight: 600, color: "#0F172A" }}>
                          {m.matchedAmount != null
                            ? `₹${Number(m.matchedAmount).toLocaleString("en-IN")}`
                            : "—"}
                        </td>

                        <td style={s.td}>
                          {conf != null ? (
                            <div style={s.confWrap}>
                              <div style={s.confBar}>
                                <div style={{
                                  ...s.confFill,
                                  width: `${conf}%`,
                                  background: conf >= 80 ? "#16A34A" : conf >= 50 ? "#CA8A04" : "#DC2626",
                                }} />
                              </div>
                              <span style={s.confText}>{conf}%</span>
                            </div>
                          ) : "—"}
                        </td>

                        <td style={s.td}>
                          <span style={{ ...s.statusBadge, background: sc.bg, color: sc.color }}>
                            {m.status?.replace("_", " ") ?? "—"}
                          </span>
                        </td>

                        <td style={{ ...s.td, maxWidth: 220 }}>
                          <span style={s.reason} title={m.matchReason}>{m.matchReason ?? "—"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={s.pagination}>
              <span style={s.pageInfo}>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div style={s.pageButtons}>
                <button style={s.pageBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const p = i + 1;
                  return (
                    <button
                      key={p}
                      style={{ ...s.pageBtn, ...(p === page ? s.pageBtnActive : {}) }}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  );
                })}
                <button style={s.pageBtn} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          </>
        )}
      </div>
    </ClientLayout>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  page:       { fontFamily: "'Inter', sans-serif", color: "#0F172A" },
  header:     { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  title:      { fontSize: 24, fontWeight: 700, margin: 0 },
  sub:        { color: "#64748B", marginTop: 4, fontSize: 14 },
  refreshBtn: { padding: "10px 20px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },

  cards:      { display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" },
  card:       { flex: "1 1 140px", borderRadius: 12, padding: "16px 20px" },
  cardVal:    { fontSize: 28, fontWeight: 700 },
  cardLabel:  { fontSize: 13, color: "#475569", marginTop: 4 },

  filters:    { display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  search:     { flex: 2, minWidth: 220, padding: "10px 14px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, outline: "none" },
  select:     { flex: 1, minWidth: 150, padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer" },

  error:      { background: "#FEE2E2", color: "#DC2626", padding: "12px 16px", borderRadius: 8, marginBottom: 16 },
  msg:        { padding: 40, textAlign: "center", color: "#64748B" },
  empty:      { padding: 60, textAlign: "center", color: "#94A3B8" },
  emptyIcon:  { fontSize: 40, marginBottom: 12 },
  clearBtn:   { marginTop: 12, padding: "8px 16px", background: "#EFF6FF", color: "#2563EB", border: "none", borderRadius: 8, cursor: "pointer" },

  tableWrap:  { overflowX: "auto", borderRadius: 12, border: "1px solid #E2E8F0" },
  table:      { width: "100%", borderCollapse: "collapse", background: "#fff" },
  thead:      { background: "#F8FAFC" },
  th:         { padding: "12px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #E2E8F0" },
  tr:         { borderBottom: "1px solid #F1F5F9", transition: "background 0.15s" },
  td:         { padding: "12px 14px", fontSize: 14, verticalAlign: "middle" },

  bankLabel:  { fontWeight: 500, color: "#1E293B", marginBottom: 4 },
  dirBadge:   { display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999 },
  srcIcon:    { marginRight: 6 },
  srcLabel:   { color: "#334155" },
  typeBadge:  { background: "#F1F5F9", color: "#475569", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  matchTypeBadge: { background: "#EFF6FF", color: "#2563EB", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  statusBadge:{ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  reason:     { display: "block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748B", fontSize: 13 },

  confWrap:   { display: "flex", alignItems: "center", gap: 8 },
  confBar:    { width: 60, height: 6, background: "#E2E8F0", borderRadius: 999, overflow: "hidden" },
  confFill:   { height: "100%", borderRadius: 999 },
  confText:   { fontSize: 13, fontWeight: 600, color: "#334155" },

  pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, flexWrap: "wrap", gap: 12 },
  pageInfo:   { fontSize: 14, color: "#64748B" },
  pageButtons:{ display: "flex", gap: 6 },
  pageBtn:    { padding: "6px 12px", border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 },
  pageBtnActive: { background: "#2563EB", color: "#fff", border: "1px solid #2563EB" },
};