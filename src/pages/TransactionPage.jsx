import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import MonthYearPicker from "../components/MonthYearPicker";
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

// ── Status values actually stored by ReconciliationCenter ──────────────────
// "accepted" = manually confirmed by CPA
// "manual"   = manually added
// "rejected" = rejected
// "ai_suggested" = AI suggested but not yet reviewed
// "misc"     = no supporting document

const STATUS_COLORS = {
  accepted:        { bg: "#DCFCE7", color: "#16A34A" },
  manual:          { bg: "#DCFCE7", color: "#16A34A" },
  ai_suggested:    { bg: "#FEF9C3", color: "#CA8A04" },
  rejected:        { bg: "#FEE2E2", color: "#DC2626" },
  misc:            { bg: "#FEF3C7", color: "#92400E" },
  // legacy uppercase kept for any old records
  AUTO_MATCHED:      { bg: "#DCFCE7", color: "#16A34A" },
  PENDING_REVIEW:    { bg: "#FEF9C3", color: "#CA8A04" },
  MANUALLY_APPROVED: { bg: "#DBEAFE", color: "#2563EB" },
  REJECTED:          { bg: "#FEE2E2", color: "#DC2626" },
};

const MATCH_TYPE_LABELS = {
  EXACT:        "Exact",
  PARTIAL:      "Partial",
  MANY_TO_ONE:  "Many→One",
  ONE_TO_MANY:  "One→Many",
  one_to_one:   "One→One",
  one_to_many:  "One→Many",
  POSSIBLE:     "Possible",
  misc:         "Misc",
};

const SOURCE_TYPE_ICONS = {
  INVOICE: "🧾", invoice: "🧾",
  SALE:    "💰", sale:    "💰",
  PAYROLL: "👥", payroll: "👥",
  EXPENSE: "💸", expense: "💸",
  misc:    "📋",
};

export default function TransactionPage() {
  const { id: clientId } = useParams();
  const location = useLocation();
  const client = location.state?.client;

  const [matches,    setMatches]    = useState([]);
  const [bankMap,    setBankMap]    = useState({});
  const [sourceMap,  setSourceMap]  = useState({});
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  // Month/Year filter
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterYear,  setFilterYear]  = useState(null);

  // Filters
  const [statusFilter,    setStatusFilter]    = useState("ALL");
  const [typeFilter,      setTypeFilter]      = useState("ALL");
  const [matchTypeFilter, setMatchTypeFilter] = useState("ALL");
  const [search,          setSearch]          = useState("");
  const [page,            setPage]            = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (!clientId) return;
    loadAll();
  }, [clientId, filterMonth, filterYear]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      // 1. Build match queries with optional month/year
      const matchQueries = [
        Query.equal("clientId", clientId),
        Query.limit(2000),
      ];
      if (filterMonth) matchQueries.push(Query.equal("month", filterMonth));
      if (filterYear)  matchQueries.push(Query.equal("year",  filterYear));

      const matchRes = await databases.listDocuments(
        DB_ID, TRANSACTION_MATCH_COLLECTION_ID, matchQueries
      );
      const matchDocs = matchRes.documents;

      // 2. Build bank transaction queries with optional month/year
      const bankQueries = [
        Query.equal("clientId", clientId),
        Query.limit(2000),
      ];
      if (filterMonth) bankQueries.push(Query.equal("month", filterMonth));
      if (filterYear)  bankQueries.push(Query.equal("year",  filterYear));

      const bankRes = await databases.listDocuments(
        DB_ID, BANK_TRANSACTIONS_COLLECTION_ID, bankQueries
      );
      const bMap = {};
      bankRes.documents.forEach((t) => (bMap[t.$id] = t));
      setBankMap(bMap);

      // 3. Load all source docs with optional month/year
      const sourceQueries = (extra = []) => [
        Query.equal("clientId", clientId),
        Query.limit(2000),
        ...(filterMonth ? [Query.equal("month", filterMonth)] : []),
        ...(filterYear  ? [Query.equal("year",  filterYear)]  : []),
        ...extra,
      ];

      const [invRes, saleRes, payRes, expRes] = await Promise.all([
        databases.listDocuments(DB_ID, INVOICES_COLLECTION_ID,  sourceQueries()),
        databases.listDocuments(DB_ID, SALES_COLLECTION_ID,     sourceQueries()),
        databases.listDocuments(DB_ID, PAYROLL_COLLECTION_ID,   sourceQueries()),
        databases.listDocuments(DB_ID, EXPENSE_COLLECTION_ID,   sourceQueries()),
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

  // ── Label helpers ──────────────────────────────────────────────────────────
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
    if (!d) return sourceDocId ? sourceDocId.slice(-8) : "—";
    const type = (sourceDocType ?? "").toLowerCase();
    switch (type) {
      case "invoice":
        return `INV #${d.invoiceNumber ?? d.invoice_number ?? "—"} · ${d.vendorName ?? d.customerName ?? ""} · ₹${Number(d.totalAmount ?? 0).toLocaleString("en-IN")}`;
      case "sale":
        return `Sale ${d.saleId ?? "—"} · ${d.customerName ?? ""} · ₹${Number(d.totalAmount ?? 0).toLocaleString("en-IN")}`;
      case "payroll":
        return `${d.employeeName ?? d.employee_name ?? "—"} · Pay ${(d.payDate ?? d.pay_date ?? "").slice(0,10)} · ₹${Number(d.netPay ?? d.net_pay ?? 0).toLocaleString("en-IN")}`;
      case "expense":
        return `${d.vendorName ?? d.vendor_name ?? "—"} · ₹${Number(d.totalAmount ?? d.amount ?? 0).toLocaleString("en-IN")}`;
      case "misc":
        return "No Supporting Document (Misc)";
      default:
        return sourceDocId ?? "—";
    }
  }

  // ── Normalize status for display ───────────────────────────────────────────
  function normalizeStatus(status) {
    const map = {
      accepted:          "Accepted",
      manual:            "Accepted",
      ai_suggested:      "Pending Review",
      rejected:          "Rejected",
      misc:              "Misc / No Doc",
      AUTO_MATCHED:      "Auto Matched",
      PENDING_REVIEW:    "Pending Review",
      MANUALLY_APPROVED: "Approved",
      REJECTED:          "Rejected",
    };
    return map[status] ?? (status ?? "—");
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = matches.filter((m) => {
    // Status filter — handle both old uppercase and new lowercase
    if (statusFilter !== "ALL") {
      const isAccepted  = ["accepted", "manual", "AUTO_MATCHED", "MANUALLY_APPROVED"].includes(m.status);
      const isPending   = ["ai_suggested", "PENDING_REVIEW"].includes(m.status);
      const isRejected  = ["rejected", "REJECTED"].includes(m.status);
      const isMisc      = m.status === "misc" || m.sourceDocType === "misc";

      if (statusFilter === "ACCEPTED"  && !isAccepted)  return false;
      if (statusFilter === "PENDING"   && !isPending)   return false;
      if (statusFilter === "REJECTED"  && !isRejected)  return false;
      if (statusFilter === "MISC"      && !isMisc)      return false;
    }

    if (typeFilter !== "ALL") {
      const docType = (m.sourceDocType ?? "").toLowerCase();
      if (docType !== typeFilter.toLowerCase()) return false;
    }

    if (matchTypeFilter !== "ALL" && m.matchType !== matchTypeFilter) return false;

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

  // ── Summary counts using actual stored status values ───────────────────────
  const counts = {
    total:    matches.length,
    accepted: matches.filter((m) => ["accepted", "manual", "AUTO_MATCHED", "MANUALLY_APPROVED"].includes(m.status)).length,
    pending:  matches.filter((m) => ["ai_suggested", "PENDING_REVIEW"].includes(m.status)).length,
    rejected: matches.filter((m) => ["rejected", "REJECTED"].includes(m.status)).length,
    misc:     matches.filter((m) => m.status === "misc" || m.sourceDocType === "misc").length,
  };

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
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <MonthYearPicker
              month={filterMonth}
              year={filterYear}
              onChange={(m, y) => { setFilterMonth(m); setFilterYear(y); setPage(1); }}
              label="Period"
            />
            <button onClick={loadAll} style={s.refreshBtn}>🔄 Refresh</button>
          </div>
        </div>

        {/* Summary cards */}
        <div style={s.cards}>
          {[
            { label: "Total Matches", value: counts.total,    bg: "#EFF6FF", color: "#2563EB" },
            { label: "Accepted",      value: counts.accepted, bg: "#DCFCE7", color: "#16A34A" },
            { label: "Pending Review",value: counts.pending,  bg: "#FEF9C3", color: "#CA8A04" },
            { label: "Misc / No Doc", value: counts.misc,     bg: "#FEF3C7", color: "#92400E" },
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
            <option value="ACCEPTED">Accepted</option>
            <option value="PENDING">Pending Review</option>
            <option value="MISC">Misc / No Doc</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <select style={s.select} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="ALL">All Types</option>
            <option value="invoice">Invoice</option>
            <option value="sale">Sale</option>
            <option value="payroll">Payroll</option>
            <option value="expense">Expense</option>
            <option value="misc">Misc</option>
          </select>
          <select style={s.select} value={matchTypeFilter} onChange={(e) => { setMatchTypeFilter(e.target.value); setPage(1); }}>
            <option value="ALL">All Match Types</option>
            <option value="one_to_one">One→One</option>
            <option value="one_to_many">One→Many</option>
            <option value="EXACT">Exact</option>
            <option value="PARTIAL">Partial</option>
            <option value="misc">Misc</option>
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
                    const sc   = STATUS_COLORS[m.status] ?? { bg: "#F1F5F9", color: "#334155" };
                    const conf = m.confidenceScore != null ? Math.round(m.confidenceScore * 100) : null;
                    const isMiscRow = m.sourceDocType === "misc";

                    return (
                      <tr key={m.$id} style={s.tr}>

                        {/* Bank Transaction */}
                        <td style={s.td}>
                          <div style={s.bankLabel}>{getBankLabel(m.bankTxnId)}</div>
                          {bankMap[m.bankTxnId]?.direction && (
                            <span style={{
                              ...s.dirBadge,
                              background: ["credit","CREDIT"].includes(bankMap[m.bankTxnId].direction) ? "#DCFCE7" : "#FEE2E2",
                              color:      ["credit","CREDIT"].includes(bankMap[m.bankTxnId].direction) ? "#16A34A" : "#DC2626",
                            }}>
                              {bankMap[m.bankTxnId].direction}
                            </span>
                          )}
                          {/* Show month/year badge */}
                          {(m.month > 0 || m.year > 0) && (
                            <span style={{ display: "inline-block", marginTop: 3, fontSize: 10, color: "#6b7280", background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>
                              {m.month > 0 ? new Date(0, m.month - 1).toLocaleString("en-IN", { month: "short" }) : ""} {m.year > 0 ? m.year : ""}
                            </span>
                          )}
                        </td>

                        {/* Source Document */}
                        <td style={s.td}>
                          <span style={s.srcIcon}>
                            {SOURCE_TYPE_ICONS[(m.sourceDocType ?? "").toLowerCase()] ?? "📄"}
                          </span>
                          <span style={s.srcLabel}>
                            {isMiscRow
                              ? <span style={{ color: "#92400e", fontStyle: "italic" }}>No Supporting Document</span>
                              : getSourceLabel(m.sourceDocId, m.sourceDocType)
                            }
                          </span>
                        </td>

                        {/* Type */}
                        <td style={s.td}>
                          <span style={{
                            ...s.typeBadge,
                            background: isMiscRow ? "#FEF3C7" : "#F1F5F9",
                            color:      isMiscRow ? "#92400E" : "#475569",
                          }}>
                            {m.sourceDocType ?? "—"}
                          </span>
                        </td>

                        {/* Match Type */}
                        <td style={s.td}>
                          <span style={s.matchTypeBadge}>
                            {MATCH_TYPE_LABELS[m.matchType] ?? m.matchType ?? "—"}
                          </span>
                        </td>

                        {/* Matched Amount */}
                        <td style={{ ...s.td, fontWeight: 600, color: "#0F172A" }}>
                          {m.matchedAmount != null
                            ? `₹${Number(m.matchedAmount).toLocaleString("en-IN")}`
                            : "—"}
                        </td>

                        {/* Confidence */}
                        <td style={s.td}>
                          {isMiscRow ? (
                            <span style={{ fontSize: 11, color: "#9ca3af" }}>N/A</span>
                          ) : conf != null ? (
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

                        {/* Status */}
                        <td style={s.td}>
                          <span style={{ ...s.statusBadge, background: sc.bg, color: sc.color }}>
                            {normalizeStatus(m.status)}
                          </span>
                        </td>

                        {/* Reason */}
                        <td style={{ ...s.td, maxWidth: 220 }}>
                          <span style={s.reason} title={m.matchReason}>
                            {m.matchReason ?? "—"}
                          </span>
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
                    <button key={p}
                      style={{ ...s.pageBtn, ...(p === page ? s.pageBtnActive : {}) }}
                      onClick={() => setPage(p)}>
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

const s = {
  page:        { fontFamily: "'Inter', sans-serif", color: "#0F172A" },
  header:      { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 },
  title:       { fontSize: 24, fontWeight: 700, margin: 0 },
  sub:         { color: "#64748B", marginTop: 4, fontSize: 14 },
  refreshBtn:  { padding: "10px 20px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  cards:       { display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" },
  card:        { flex: "1 1 140px", borderRadius: 12, padding: "16px 20px" },
  cardVal:     { fontSize: 28, fontWeight: 700 },
  cardLabel:   { fontSize: 13, color: "#475569", marginTop: 4 },
  filters:     { display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  search:      { flex: 2, minWidth: 220, padding: "10px 14px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, outline: "none" },
  select:      { flex: 1, minWidth: 150, padding: "10px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, background: "#fff", cursor: "pointer" },
  error:       { background: "#FEE2E2", color: "#DC2626", padding: "12px 16px", borderRadius: 8, marginBottom: 16 },
  msg:         { padding: 40, textAlign: "center", color: "#64748B" },
  empty:       { padding: 60, textAlign: "center", color: "#94A3B8" },
  emptyIcon:   { fontSize: 40, marginBottom: 12 },
  clearBtn:    { marginTop: 12, padding: "8px 16px", background: "#EFF6FF", color: "#2563EB", border: "none", borderRadius: 8, cursor: "pointer" },
  tableWrap:   { overflowX: "auto", borderRadius: 12, border: "1px solid #E2E8F0" },
  table:       { width: "100%", borderCollapse: "collapse", background: "#fff" },
  thead:       { background: "#F8FAFC" },
  th:          { padding: "12px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #E2E8F0" },
  tr:          { borderBottom: "1px solid #F1F5F9" },
  td:          { padding: "12px 14px", fontSize: 14, verticalAlign: "middle" },
  bankLabel:   { fontWeight: 500, color: "#1E293B", marginBottom: 4 },
  dirBadge:    { display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999 },
  srcIcon:     { marginRight: 6 },
  srcLabel:    { color: "#334155" },
  typeBadge:   { background: "#F1F5F9", color: "#475569", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  matchTypeBadge: { background: "#EFF6FF", color: "#2563EB", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  statusBadge: { display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  reason:      { display: "block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748B", fontSize: 13 },
  confWrap:    { display: "flex", alignItems: "center", gap: 8 },
  confBar:     { width: 60, height: 6, background: "#E2E8F0", borderRadius: 999, overflow: "hidden" },
  confFill:    { height: "100%", borderRadius: 999 },
  confText:    { fontSize: 13, fontWeight: 600, color: "#334155" },
  pagination:  { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, flexWrap: "wrap", gap: 12 },
  pageInfo:    { fontSize: 14, color: "#64748B" },
  pageButtons: { display: "flex", gap: 6 },
  pageBtn:     { padding: "6px 12px", border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 },
  pageBtnActive: { background: "#2563EB", color: "#fff", border: "1px solid #2563EB" },
};