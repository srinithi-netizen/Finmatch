// ReconciliationCenter.jsx

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import {
  getBankTransactions, getInvoices, getExpenseRecords,
  getPayrollRecords, getSaleRecords, getTransactionMatches,
  getCategorySuggestions, getAnomalyFlags,
  updateTransactionMatch, updateCategorySuggestion, updateAnomalyFlag,
  storeTransactionMatches, storeCategorySuggestions, storeAnomalyFlags,
  storeReviewAction, writeAuditLog, ID,
  updateBankTransaction, updateSourceDocument,
} from "../appwrite/config";
import {
  runReconciliation, CATEGORIES, getDocAmount, getDocLabel,
  getDocDate, getDocRef, computeGroupTotals,
} from "../utils/reconciliationEngine";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toFloat(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function fmt(v, currency) {
  if (v === null || v === undefined || v === "") return "—";
  const n = toFloat(v);
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : ((currency ?? "") + " ");
  return sym + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

// Derive display status from pending AI results (local state) or from DB matches
function getBankTxnStatus(txn, dbMatches, pendingSuggestions) {
  // ── 1. Trust the matchStatus field on the txn itself (set by handleConfirmGroup) ──
  if (txn.matchStatus === "matched" || txn.matchStatus === "reconciled") {
    return { label: "Matched", color: "green", confidence: 100 };
  }
  if (txn.matchStatus === "partial" || txn.matchStatus === "partially_reconciled") {
    const amount    = toFloat(txn.amount);
    const remaining = toFloat(txn.remainingAmount ?? amount);
    const pct       = amount > 0 ? Math.round(((amount - remaining) / amount) * 100) : 0;
    return { label: "Partial", color: "orange", confidence: pct };
  }

  // ── 2. Check DB confirmed matches ──────────────────────────────────────────
  const confirmed = dbMatches.filter(
    (m) => m.bankTxnId === txn.$id && ["accepted", "manual"].includes(m.status)
  );
  if (confirmed.length > 0) {
    const amount    = toFloat(txn.amount);
    const remaining = toFloat(txn.remainingAmount ?? amount);
    if (remaining <= 0) return { label: "Matched", color: "green", confidence: 100 };
    if (remaining < amount) {
      const pct = Math.round(((amount - remaining) / amount) * 100);
      return { label: "Partial", color: "orange", confidence: pct };
    }
    // confirmed rows exist but remainingAmount not yet updated — still show matched
    return { label: "Matched", color: "green", confidence: 100 };
  }

  // ── 3. Pending AI suggestions (not yet saved) ──────────────────────────────
  const pending = pendingSuggestions[txn.$id];
  if (pending) {
    if (pending.matches.length === 0) return { label: "Unmatched", color: "red", confidence: 0 };
    const topConf = pending.matches[0]?.confidence ?? 0;
    if (topConf >= 0.75) return { label: "AI Suggested", color: "purple", confidence: Math.round(topConf * 100) };
    return { label: "Needs Review", color: "blue", confidence: Math.round(topConf * 100) };
  }

  // ── 4. DB ai_suggested (run before but not yet accepted) ───────────────────
  const aiSuggested = dbMatches.filter(
    (m) => m.bankTxnId === txn.$id && m.status === "ai_suggested"
  );
  if (aiSuggested.length > 0) {
    const avgConf = aiSuggested.reduce((s, m) => s + toFloat(m.confidenceScore), 0) / aiSuggested.length;
    return { label: "Needs Review", color: "blue", confidence: Math.round(avgConf * 100) };
  }

  // ── 5. Default ─────────────────────────────────────────────────────────────
  return { label: "Unmatched", color: "red", confidence: 0 };
}

const STATUS_COLORS = {
  green:  { bg: "bg-green-50",  border: "border-green-300",  text: "text-green-700",  dot: "bg-green-500" },
  orange: { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-700", dot: "bg-orange-500" },
  red:    { bg: "bg-red-50",    border: "border-red-300",    text: "text-red-700",    dot: "bg-red-500" },
  blue:   { bg: "bg-blue-50",   border: "border-blue-300",   text: "text-blue-700",   dot: "bg-blue-500" },
  purple: { bg: "bg-purple-50", border: "border-purple-300", text: "text-purple-700", dot: "bg-purple-500" },
};

const DOC_TYPE_STYLES = {
  invoice: "bg-blue-50 text-blue-700 border border-blue-200",
  expense: "bg-amber-50 text-amber-700 border border-amber-200",
  payroll: "bg-violet-50 text-violet-700 border border-violet-200",
  sale:    "bg-teal-50 text-teal-700 border border-teal-200",
};

const SEV_STYLES = {
  high:   "bg-red-50 text-red-700 border border-red-200",
  medium: "bg-amber-50 text-amber-700 border border-amber-200",
  low:    "bg-yellow-50 text-yellow-700 border border-yellow-200",
};

function Pill({ label, styleClass }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${styleClass ?? ""}`}>
      {label}
    </span>
  );
}

const S = {
  card: { border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px", background: "#fff" },
  row: { display: "flex", alignItems: "flex-start", gap: "8px" },
  colMain: { flex: 1, minWidth: 0 },
  topRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "4px" },
  amountRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" },
  totalsBox: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px", marginBottom: "8px" },
  totalsLine: { display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "2px 0" },
  totalsLineFinal: { display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "6px 0 0 0", borderTop: "1px solid #f3f4f6", marginTop: "4px", fontWeight: 700 },
  detailRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f3f4f6" },
  detailLabel: { fontSize: "12px", color: "#6b7280", flexShrink: 0 },
  detailValue: { fontSize: "12px", fontWeight: 500, color: "#374151", textAlign: "right", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  detailValueHighlight: { fontSize: "12px", fontWeight: 700, color: "#d97706", textAlign: "right" },
  sectionBox: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" },
};

function pillStyle(bg, color, border) {
  return { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", background: bg, color, border: `1px solid ${border}` };
}

const PILL_STYLES = {
  invoice: pillStyle("#eff6ff", "#1d4ed8", "#bfdbfe"),
  expense: pillStyle("#fffbeb", "#b45309", "#fde68a"),
  payroll: pillStyle("#f5f3ff", "#6d28d9", "#ddd6fe"),
  sale:    pillStyle("#f0fdfa", "#0f766e", "#99f6e4"),
  accepted: pillStyle("#f0fdf4", "#15803d", "#bbf7d0"),
  manual:   pillStyle("#f0fdf4", "#15803d", "#bbf7d0"),
};

// ─── Confidence Bar ───────────────────────────────────────────────────────────
function ConfidenceBar({ score, breakdown, reason }) {
  const pct = Math.round(toFloat(score) * 100);
  const color   = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#ef4444";
  const bgColor = pct >= 75 ? "#dcfce7" : pct >= 50 ? "#fef3c7" : "#fee2e2";

  let parsed = {};
  if (breakdown) {
    try { parsed = typeof breakdown === "string" ? JSON.parse(breakdown) : breakdown; }
    catch { parsed = {}; }
  }

  const factors = [
    { label: "Amount",    key: "amountMatch",    icon: "💰" },
    { label: "Reference", key: "referenceMatch", icon: "🔖" },
    { label: "Vendor",    key: "vendorMatch",    icon: "🏢" },
    { label: "Date",      key: "dateMatch",      icon: "📅" },
  ];

  return (
    <div style={{ marginTop: "10px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>AI Confidence</span>
        <span style={{ fontSize: "18px", fontWeight: 800, color }}>{pct}%</span>
      </div>
      <div style={{ height: "6px", background: "#e5e7eb", borderRadius: "999px", marginBottom: "8px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "999px", transition: "width 0.4s ease" }} />
      </div>
      {Object.keys(parsed).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "6px" }}>
          {factors.map((f) => {
            const val  = toFloat(parsed[f.key]);
            const fPct = Math.round(val * 100);
            const fColor = fPct >= 75 ? "#16a34a" : fPct >= 50 ? "#d97706" : "#ef4444";
            return (
              <div key={f.key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "11px", width: "60px", color: "#9ca3af", flexShrink: 0 }}>{f.icon} {f.label}</span>
                <div style={{ flex: 1, height: "4px", background: "#e5e7eb", borderRadius: "999px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${fPct}%`, background: fColor, borderRadius: "999px" }} />
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: fColor, width: "28px", textAlign: "right" }}>{fPct}%</span>
              </div>
            );
          })}
        </div>
      )}
      {(parsed.explanation || reason) && (
        <p style={{ fontSize: "11px", color: "#6b7280", fontStyle: "italic", margin: 0, lineHeight: 1.4, borderTop: "1px solid #f3f4f6", paddingTop: "6px" }}>
          💬 {parsed.explanation || reason}
        </p>
      )}
      <div style={{ marginTop: "6px", display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: 700, background: bgColor, color }}>
        {pct >= 75 ? "✓ Strong Match" : pct >= 50 ? "⚠ Needs Review" : "✗ Weak Match"}
      </div>
    </div>
  );
}

// ─── Document Info Card ───────────────────────────────────────────────────────
function DocInfoCard({ doc, matchedAmount, remainingDocAmount, currency }) {
  if (!doc) return null;
  const type = doc._docType;
  const rows = [];

  rows.push({ label: "Document Type", value: type ? type.charAt(0).toUpperCase() + type.slice(1) : "—" });
  rows.push({ label: "Reference No.", value: getDocRef(doc) ?? "—", mono: true });
  rows.push({ label: "Date", value: fmtDate(getDocDate(doc)) });

  if (type === "invoice") {
    rows.push({ label: "Vendor / Customer", value: getDocLabel(doc) });
    rows.push({ label: "Invoice Total", value: fmt(getDocAmount(doc), doc.currency) });
    rows.push({ label: "Tax", value: fmt(doc.tax ?? doc.tax_amount, doc.currency) });
    rows.push({ label: "Due Date", value: fmtDate(doc.due_date ?? doc.dueDate) });
    rows.push({ label: "Payment Status", value: doc.payment_status ?? doc.paymentStatus ?? "unpaid", badge: true });
  } else if (type === "expense") {
    rows.push({ label: "Vendor", value: getDocLabel(doc) });
    rows.push({ label: "Expense Category", value: doc.expense_category ?? doc.category ?? "—" });
    rows.push({ label: "Description", value: doc.description ?? "—" });
    rows.push({ label: "Total Amount", value: fmt(getDocAmount(doc), doc.currency) });
    rows.push({ label: "Payment Status", value: doc.payment_status ?? doc.paymentStatus ?? "unpaid", badge: true });
  } else if (type === "payroll") {
    rows.push({ label: "Employee Name", value: getDocLabel(doc) });
    rows.push({ label: "Department", value: doc.department ?? "—" });
    rows.push({ label: "Payroll Period", value: doc.payroll_period ?? doc.period ?? "—" });
    rows.push({ label: "Gross Pay", value: fmt(doc.gross_pay ?? doc.grossPay, doc.currency) });
    rows.push({ label: "Net Pay", value: fmt(doc.net_pay ?? doc.netPay, doc.currency) });
  } else if (type === "sale") {
    rows.push({ label: "Customer", value: getDocLabel(doc) });
    rows.push({ label: "Description", value: doc.description ?? "—" });
    rows.push({ label: "Total Amount", value: fmt(getDocAmount(doc), doc.currency) });
    rows.push({ label: "Status", value: doc.status ?? doc.payment_status ?? "—", badge: true });
  }

  rows.push({ label: "Matched Amount",   value: fmt(matchedAmount, currency ?? doc.currency), highlight: true });
  rows.push({ label: "Remaining on Doc", value: fmt(remainingDocAmount, currency ?? doc.currency), highlight: remainingDocAmount > 0 });

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", marginTop: "8px" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ ...S.detailRow, borderBottom: i === rows.length - 1 ? "none" : "1px solid #f1f5f9" }}>
          <span style={{ ...S.detailLabel, minWidth: "110px" }}>{r.label}</span>
          {r.badge ? (
            <span style={pillStyle("#eef2ff", "#4338ca", "#c7d2fe")}>{String(r.value).replace(/_/g, " ")}</span>
          ) : (
            <span style={{ ...(r.highlight ? S.detailValueHighlight : S.detailValue), fontFamily: r.mono ? "monospace" : "inherit" }}>
              {r.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── DetailRow ────────────────────────────────────────────────────────────────
function DetailRow({ label, value, mono, highlight, badge, last }) {
  return (
    <div style={{ ...S.detailRow, ...(last ? { borderBottom: "none" } : {}) }}>
      <span style={S.detailLabel}>{label}</span>
      {badge ? (
        <span style={pillStyle("#eef2ff", "#4338ca", "#c7d2fe")}>{String(value).replace(/_/g, " ")}</span>
      ) : (
        <span style={{ ...(highlight ? S.detailValueHighlight : S.detailValue), fontFamily: mono ? "monospace" : "inherit" }}>
          {value}
        </span>
      )}
    </div>
  );
}

// ─── Anomaly Dashboard ────────────────────────────────────────────────────────
function AnomalyDashboard({ anomalies, getBankTxn, getSourceDoc, actionLoading, onAction }) {
  const [noteDrafts, setNoteDrafts] = useState({});
  const [filter, setFilter]         = useState("open");

  const grouped = useMemo(() => {
    const g = { overpayment: [], underpayment: [], duplicate: [], unmatched_bank_transaction: [], unmatched_document: [], other: [] };
    anomalies.forEach((a) => {
      if (filter !== "all" && a.status !== filter) return;
      const ft = (a.flagType ?? "").toLowerCase();
      if (ft.includes("overpayment"))                            g.overpayment.push(a);
      else if (ft.includes("underpayment"))                      g.underpayment.push(a);
      else if (ft.includes("duplicate"))                         g.duplicate.push(a);
      else if (ft.includes("unmatched_bank"))                    g.unmatched_bank_transaction.push(a);
      else if (ft.includes("unmatched_document"))                g.unmatched_document.push(a);
      else                                                        g.other.push(a);
    });
    return g;
  }, [anomalies, filter]);

  const sections = [
    { key: "overpayment",              title: "Overpayments",               icon: "💰" },
    { key: "underpayment",             title: "Underpayments",              icon: "📉" },
    { key: "duplicate",                title: "Duplicate Payments",         icon: "⚠️" },
    { key: "unmatched_bank_transaction",title: "Unmatched Bank Transactions",icon: "🏦" },
    { key: "unmatched_document",       title: "Unmatched Documents",        icon: "📄" },
    { key: "other",                    title: "Other Anomalies",            icon: "🔍" },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex gap-2 mb-4">
        {["open", "resolved", "dismissed", "all"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors capitalize ${filter === f ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
            {f} ({f === "all" ? anomalies.length : anomalies.filter((a) => a.status === f).length})
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sections.map((sec) => {
          const items = grouped[sec.key];
          if (items.length === 0) return null;
          return (
            <div key={sec.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  {sec.icon} {sec.title}
                </span>
                <span className="text-xs font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
                {items.map((a) => {
                  const txn      = a.relatedType === "bank_txn"    ? getBankTxn(a.relatedId)    : null;
                  const doc      = a.relatedType === "source_doc"  ? getSourceDoc(a.relatedId)  : null;
                  const isOpen   = a.status === "open";
                  const expected = toFloat(a.expectedAmount);
                  const received = toFloat(a.receivedAmount);
                  const diff     = toFloat(a.differenceAmount);

                  return (
                    <div key={a.$id} className={`p-3 ${!isOpen ? "opacity-60" : ""}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <Pill label={a.severity} styleClass={SEV_STYLES[a.severity] ?? "bg-gray-100 text-gray-600"} />
                        <Pill label={a.status} styleClass={a.status === "open" ? "bg-amber-50 text-amber-700 border border-amber-200" : a.status === "resolved" ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-50 text-gray-500 border border-gray-200"} />
                      </div>
                      {(txn || doc) && (
                        <p className="text-sm font-medium text-gray-800 mb-1">
                          {txn ? (txn.description ?? `Txn ${txn.$id.slice(-8)}`) : getDocLabel(doc)}
                        </p>
                      )}
                      {(expected !== 0 || received !== 0) && (
                        <div className="bg-gray-50 rounded-lg p-2 my-1.5 space-y-0.5">
                          {expected !== 0 && <div className="flex justify-between text-xs"><span className="text-gray-500">Expected</span><span className="font-medium">{fmt(expected, txn?.currency ?? doc?.currency)}</span></div>}
                          {received !== 0 && <div className="flex justify-between text-xs"><span className="text-gray-500">Received</span><span className="font-medium">{fmt(received, txn?.currency ?? doc?.currency)}</span></div>}
                          {diff !== 0 && (
                            <div className="flex justify-between text-xs pt-0.5 border-t border-gray-200">
                              <span className="text-gray-500 font-medium">Difference</span>
                              <span className={`font-bold ${diff > 0 ? "text-red-600" : "text-amber-600"}`}>{fmt(Math.abs(diff), txn?.currency ?? doc?.currency)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {a.resolutionNote && <p className="text-xs text-gray-400 italic mt-1">{a.resolutionNote}</p>}
                      {isOpen && (
                        <div className="mt-2 space-y-1.5">
                          <input type="text" placeholder="Resolution note…" value={noteDrafts[a.$id] ?? ""}
                            onChange={(e) => setNoteDrafts((p) => ({ ...p, [a.$id]: e.target.value }))}
                            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <div className="flex gap-1.5">
                            <button onClick={() => onAction(a, "resolved", noteDrafts[a.$id])} disabled={actionLoading === a.$id + "_resolved"}
                              className="flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg disabled:opacity-50">✓ Resolve</button>
                            <button onClick={() => onAction(a, "dismissed", noteDrafts[a.$id])} disabled={actionLoading === a.$id + "_dismissed"}
                              className="flex-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg">Dismiss</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {sections.every((sec) => grouped[sec.key].length === 0) && (
          <div className="col-span-full text-center py-16 text-gray-400">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm">No anomalies found for this filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReconciliationCenter() {
  const { id: clientId } = useParams();
  const location = useLocation();
  const client   = location.state?.client;

  const [page,        setPage]        = useState("reconcile");
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [error,       setError]       = useState(null);
  const [successMsg,  setSuccessMsg]  = useState(null);
  const [progress,    setProgress]    = useState({ current: 0, total: 0 });

  // DB state
  const [bankTxns,   setBankTxns]   = useState([]);
  const [sourceDocs, setSourceDocs] = useState([]);
  const [dbMatches,  setDbMatches]  = useState([]);   // confirmed matches from DB
  const [categories, setCategories] = useState([]);
  const [anomalies,  setAnomalies]  = useState([]);

  // Local AI suggestions (NOT yet in DB) — keyed by bankTxnId
  // { [bankTxnId]: { matches: [...], categoryCode, anomalies } }
  const [pendingSuggestions, setPendingSuggestions] = useState({});

  const [selectedTxnId,      setSelectedTxnId]      = useState(null);
  const [expandedDocId,      setExpandedDocId]       = useState(null);
  const [checkedDocIds,      setCheckedDocIds]       = useState(new Set());
  const [bankFilter,         setBankFilter]          = useState("all");
  const [searchTerm,         setSearchTerm]          = useState("");
  const [actionLoading,      setAL]                  = useState(null);
  const [manualAddType,      setManualAddType]       = useState("invoice");
  const [manualAddDocId,     setManualAddDocId]      = useState("");
  const [localCategories,    setLocalCategories]     = useState({}); // [bankTxnId]: categoryCode

  const cpaUserId = sessionStorage.getItem("cpa_user_id") ?? "cpa_user";

  // ─── Load from DB ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [txns, invs, exps, pays, sales, mats, cats, anoms] = await Promise.all([
        getBankTransactions(clientId),
        getInvoices(clientId),
        getExpenseRecords(clientId),
        getPayrollRecords(clientId),
        getSaleRecords(clientId),
        getTransactionMatches(clientId),
        getCategorySuggestions(clientId),
        getAnomalyFlags(clientId),
      ]);
      setSourceDocs([
        ...invs.map((d)  => ({ ...d, _docType: "invoice" })),
        ...exps.map((d)  => ({ ...d, _docType: "expense" })),
        ...pays.map((d)  => ({ ...d, _docType: "payroll" })),
        ...sales.map((d) => ({ ...d, _docType: "sale"    })),
      ]);
      setBankTxns(txns);
      setDbMatches(mats);
      setCategories(cats);
      setAnomalies(anoms);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const getBankTxn  = (id) => bankTxns.find((t)   => t.$id === id);
  const getSourceDoc = (id) => sourceDocs.find((d) => d.$id === id);

  const selectedTxn = selectedTxnId ? getBankTxn(selectedTxnId) : null;

  // Build the list of suggestions to show for the selected txn
  // Priority: pending AI suggestions > DB ai_suggested
  const activeSuggestions = useMemo(() => {
    if (!selectedTxnId) return [];
    const pending = pendingSuggestions[selectedTxnId];
    if (pending) {
      // Map to a shape similar to DB match rows
      return pending.matches.map((m, i) => ({
        $id:             `pending_${selectedTxnId}_${i}`,
        bankTxnId:       selectedTxnId,
        sourceDocId:     m.sourceDocId,
        sourceDocType:   m.sourceDocType,
        matchedAmount:   m.matchedAmount,
        remainingDocAmount: m.remainingDocumentAmount,
        confidenceScore: m.confidence,
        confidenceBreakdown: m.confidenceBreakdown,
        matchReason:     m.reason,
        currencyNote:    m.currencyNote,
        status:          "pending",
        isPending:       true,
      }));
    }
    return dbMatches.filter((m) => m.bankTxnId === selectedTxnId && m.status !== "rejected");
  }, [selectedTxnId, pendingSuggestions, dbMatches]);

  // Pre-check boxes when txn changes
  useEffect(() => {
    if (!selectedTxnId) { setCheckedDocIds(new Set()); setExpandedDocId(null); return; }
    const pending = pendingSuggestions[selectedTxnId];
    let preChecked;
    if (pending) {
      // Auto-check docs with confidence >= 0.75
      preChecked = new Set(
        pending.matches
          .filter((m) => m.confidence >= 0.75)
          .map((m) => m.sourceDocId)
      );
    } else {
      preChecked = new Set(
        dbMatches
          .filter((m) => m.bankTxnId === selectedTxnId &&
            (["accepted","manual"].includes(m.status) || toFloat(m.confidenceScore) >= 0.85))
          .map((m) => m.sourceDocId)
      );
    }
    setCheckedDocIds(preChecked);
    setExpandedDocId(null);
  }, [selectedTxnId]); // eslint-disable-line

  // Category for selected txn
  const activeCategory = useMemo(() => {
    if (!selectedTxnId) return "";
    if (localCategories[selectedTxnId]) return localCategories[selectedTxnId];
    if (pendingSuggestions[selectedTxnId]) return pendingSuggestions[selectedTxnId].categoryCode ?? "";
    const c = categories.find((c) => c.bankTxnId === selectedTxnId && c.status === "manual")
           ?? categories.find((c) => c.bankTxnId === selectedTxnId && c.status === "ai_suggested");
    return c?.categoryCode ?? "";
  }, [selectedTxnId, localCategories, pendingSuggestions, categories]);

  // Counts for filter tabs
  const counts = useMemo(() => {
    const c = { all: bankTxns.length, matched: 0, partial: 0, unmatched: 0, review: 0, suggested: 0 };
    bankTxns.forEach((t) => {
      const st = getBankTxnStatus(t, dbMatches, pendingSuggestions);
      if (st.color === "green")  c.matched++;
      else if (st.color === "orange") c.partial++;
      else if (st.color === "red")    c.unmatched++;
      else if (st.color === "blue")   c.review++;
      else if (st.color === "purple") c.suggested++;
    });
    return c;
  }, [bankTxns, dbMatches, pendingSuggestions]);

  const filteredBankTxns = useMemo(() => {
    let list = bankTxns;
    if (bankFilter !== "all") {
      list = list.filter((t) => {
        const st = getBankTxnStatus(t, dbMatches, pendingSuggestions);
        if (bankFilter === "matched")   return st.color === "green";
        if (bankFilter === "partial")   return st.color === "orange";
        if (bankFilter === "unmatched") return st.color === "red";
        if (bankFilter === "review")    return st.color === "blue" || st.color === "purple";
        return true;
      });
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((t) =>
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.refNumber ?? t.reference_number ?? t.referenceNumber ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [bankTxns, dbMatches, pendingSuggestions, bankFilter, searchTerm]);

  const groupTotals = useMemo(() => {
    if (!selectedTxn) return { bankAmount: 0, selectedTotal: 0, remaining: 0 };
    const checkedDocs = [...checkedDocIds].map((id) => {
      const m   = activeSuggestions.find((mm) => mm.sourceDocId === id);
      const doc = getSourceDoc(id);
      return { ...doc, remainingAmount: m ? toFloat(m.matchedAmount) : toFloat(doc?.remainingAmount ?? getDocAmount(doc)) };
    });
    return computeGroupTotals(selectedTxn, checkedDocs);
  }, [selectedTxn, checkedDocIds, activeSuggestions, sourceDocs]); // eslint-disable-line

  const pendingDocsByType = useMemo(() => {
    const acceptedDocIds = new Set(
      dbMatches.filter((m) => ["accepted","manual"].includes(m.status)).map((m) => m.sourceDocId)
    );
    return {
      invoice: sourceDocs.filter((d) => d._docType === "invoice" && (!acceptedDocIds.has(d.$id) || toFloat(d.remainingAmount) > 0)),
      expense: sourceDocs.filter((d) => d._docType === "expense" && (!acceptedDocIds.has(d.$id) || toFloat(d.remainingAmount) > 0)),
      payroll: sourceDocs.filter((d) => d._docType === "payroll" && (!acceptedDocIds.has(d.$id) || toFloat(d.remainingAmount) > 0)),
      sale:    sourceDocs.filter((d) => d._docType === "sale"    && (!acceptedDocIds.has(d.$id) || toFloat(d.remainingAmount) > 0)),
    };
  }, [sourceDocs, dbMatches]);

  // ─── Run AI Reconciliation (LOCAL ONLY — no DB writes) ───────────────────
  const handleRunReconciliation = async () => {
    setRunning(true);
    setError(null);
    setProgress({ current: 0, total: 0 });
    setPendingSuggestions({});

    try {
      const results = await runReconciliation({
        bankTransactions: bankTxns,
        sourceDocs,
        onProgress: ({ current, total }) => setProgress({ current, total }),
      });

      // Index results by bankTxnId
      const newPending = {};
      for (const r of results) {
        newPending[r.bankTxnId] = r;
      }
      setPendingSuggestions(newPending);

      const total     = results.length;
      const matched   = results.filter((r) => r.matches.length > 0 && r.matches[0].confidence >= 0.75).length;
      const needsReview = results.filter((r) => r.matches.length > 0 && r.matches[0].confidence < 0.75).length;
      const unmatched = results.filter((r) => r.matches.length === 0).length;

      setSuccessMsg(`AI analysis complete: ${matched} auto-suggested · ${needsReview} need review · ${unmatched} unmatched. Review and click Accept to confirm.`);
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  // ─── Accept & Confirm (writes to DB) ─────────────────────────────────────
  const handleConfirmGroup = async () => {
    if (!selectedTxn || checkedDocIds.size === 0) return;
    setAL("confirm");

    try {
      const batchId  = ID.unique();
      const groupId  = `grp_${selectedTxn.$id}_${batchId}`;
      const now      = new Date().toISOString();
      const bankAmount = toFloat(selectedTxn.amount);
      const pending  = pendingSuggestions[selectedTxnId];

      // 1. Build match rows for accepted docs
      const matchRowsToStore = [];
      let totalMatchedAmount = 0;

      for (const docId of checkedDocIds) {
        const suggestion = activeSuggestions.find((m) => m.sourceDocId === docId);
        const doc        = getSourceDoc(docId);
        if (!doc) continue;

        const docRemaining   = toFloat(doc.remainingAmount ?? getDocAmount(doc));
        const bankRemaining  = toFloat(selectedTxn.remainingAmount ?? selectedTxn.amount);
        const matchedAmount  = suggestion
          ? toFloat(suggestion.matchedAmount)
          : Math.min(docRemaining, bankRemaining);
        totalMatchedAmount  += matchedAmount;

        const confScore = suggestion ? toFloat(suggestion.confidenceScore) : 1.0;
        const confBreakdown = suggestion?.confidenceBreakdown
          ? (typeof suggestion.confidenceBreakdown === "string"
              ? suggestion.confidenceBreakdown
              : JSON.stringify(suggestion.confidenceBreakdown))
          : "{}";

        matchRowsToStore.push({
          clientId,
          bankTxnId:           selectedTxn.$id,
          sourceDocId:         docId,
          sourceDocType:       doc._docType,
          matchType:           checkedDocIds.size === 1 ? "one_to_one" : "one_to_many",
          groupId,
          status:              "accepted",
          confidenceScore:     confScore,
          confidenceBreakdown: confBreakdown,
          matchReason:         suggestion?.matchReason ?? "Manually accepted",
          isManual:            !suggestion || suggestion.isPending === false,
          matchedBy:           cpaUserId,
          matchedAmount,
          remainingBankAmount: Math.max(0, bankAmount - totalMatchedAmount),
          remainingDocAmount:  Math.max(0, docRemaining - matchedAmount),
          currencyNote:        suggestion?.currencyNote ?? "",
          reviewedAt:          now,
          batchId,
        });
      }

      const remainingBankAmount = Math.max(0, bankAmount - totalMatchedAmount);
      const matchStatus = remainingBankAmount <= 0 ? "matched"
                        : remainingBankAmount < bankAmount ? "partial"
                        : "unmatched";

      // 2. Build category row
      const catCode  = localCategories[selectedTxnId] ?? pending?.categoryCode ?? "MISC";
      const catLabel = CATEGORIES.find((c) => c.code === catCode)?.label ?? "Miscellaneous";
      const catRow   = {
        clientId, bankTxnId: selectedTxn.$id,
        categoryCode: catCode, categoryLabel: catLabel,
        status: "manual", overriddenBy: cpaUserId, batchId,
      };

      // 3. Build anomaly rows from pending suggestions
      const anomalyRowsToStore = [];
      if (pending) {
        for (const anomaly of (pending.anomalies ?? [])) {
          if (!anomaly) continue;
          anomalyRowsToStore.push({
            clientId,
            relatedId:        selectedTxn.$id,
            relatedType:      "bank_txn",
            flagType:         (anomaly.type ?? "ai_detected").toLowerCase(),
            severity:         anomaly.severity ?? "medium",
            status:           "open",
            resolutionNote:   anomaly.note ?? "",
            expectedAmount:   toFloat(anomaly.expectedAmount),
            receivedAmount:   toFloat(anomaly.receivedAmount),
            differenceAmount: toFloat(anomaly.differenceAmount),
            batchId,
          });
        }
        // Unmatched docs in the suggestion set that were NOT accepted
        const notAccepted = pending.matches.filter((m) => !checkedDocIds.has(m.sourceDocId));
        for (const m of notAccepted) {
          const doc = getSourceDoc(m.sourceDocId);
          if (!doc) continue;
          anomalyRowsToStore.push({
            clientId,
            relatedId:        m.sourceDocId,
            relatedType:      "source_doc",
            flagType:         "unmatched_document",
            severity:         "low",
            status:           "open",
            resolutionNote:   "Suggested but not accepted by CPA",
            expectedAmount:   getDocAmount(doc),
            receivedAmount:   0,
            differenceAmount: getDocAmount(doc),
            batchId,
          });
        }
      }
      if (checkedDocIds.size === 0) {
        anomalyRowsToStore.push({
          clientId,
          relatedId:        selectedTxn.$id,
          relatedType:      "bank_txn",
          flagType:         "unmatched_bank_transaction",
          severity:         "high",
          status:           "open",
          resolutionNote:   "",
          expectedAmount:   0,
          receivedAmount:   bankAmount,
          differenceAmount: bankAmount,
          batchId,
        });
      }

      // 4. Persist everything
      if (matchRowsToStore.length)    await storeTransactionMatches(matchRowsToStore);
      await storeCategorySuggestions([catRow]);
      if (anomalyRowsToStore.length)  await storeAnomalyFlags(anomalyRowsToStore);

      // 5. Update bank transaction
     await updateBankTransaction(selectedTxn.$id, {
  matchStatus,               // "matched", "partial", or "unmatched"
  remainingAmount: remainingBankAmount,
  matchedDocumentId:    [...checkedDocIds][0] ?? null,
  reconciliationStatus: matchStatus === "matched" ? "reconciled" : "partially_reconciled",
});

      // 6. Update each accepted source document
      for (const docId of checkedDocIds) {
        const match = matchRowsToStore.find((m) => m.sourceDocId === docId);
        const doc   = getSourceDoc(docId);
        if (!doc || !match) continue;
        const docTotal     = toFloat(doc.remainingAmount ?? getDocAmount(doc));
        const newRemaining = Math.max(0, docTotal - match.matchedAmount);
        await updateSourceDocument(doc._docType, docId, {
          remainingAmount: newRemaining,
          paymentStatus:   newRemaining <= 0 ? "paid" : "partially_paid",
          matchStatus:     "matched",
          bankTxnId:       selectedTxn.$id,
        });
      }

      // 7. Audit log
      await storeReviewAction({
        clientId, matchId: groupId, anomalyId: "", actionType: "confirm_group",
        performedBy: cpaUserId,
        comment: `Accepted ${checkedDocIds.size} doc(s) for txn ${selectedTxn.$id}`,
        batchId,
      });
      await writeAuditLog({
        clientId, entityType: "transaction_match", entityId: selectedTxn.$id,
        action: "MANUALLY_APPROVED", performedBy: cpaUserId,
        oldValue: "pending", newValue: "accepted",
        note: `${checkedDocIds.size} document(s) confirmed`,
      });

      // 8. Remove from pending + reload
      setPendingSuggestions((prev) => {
        const next = { ...prev };
        delete next[selectedTxnId];
        return next;
      });

      await loadAll();
      setSuccessMsg(`✓ Match confirmed and saved: ${checkedDocIds.size} document(s) accepted.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setAL(null);
    }
  };

  // ─── Reject all pending for this txn ─────────────────────────────────────
  const handleRejectSuggestion = () => {
    setPendingSuggestions((prev) => {
      const next = { ...prev };
      delete next[selectedTxnId];
      return next;
    });
    setCheckedDocIds(new Set());
  };

  // ─── Category override (local until Accept) ───────────────────────────────
  const handleCategoryOverride = (bankTxnId, newCode) => {
    setLocalCategories((prev) => ({ ...prev, [bankTxnId]: newCode }));
  };

  // After Accept, also persist category override if user changed it for a confirmed txn
  const handleSaveCategory = async (bankTxnId, newCode) => {
    const existing = categories.find(
      (c) => c.bankTxnId === bankTxnId && ["ai_suggested", "manual"].includes(c.status)
    );
    const newCat = CATEGORIES.find((c) => c.code === newCode);
    if (!newCat) return;
    try {
      if (existing) await updateCategorySuggestion(existing.$id, { status: "overridden", overriddenBy: cpaUserId });
      await storeCategorySuggestions([{
        clientId, bankTxnId, categoryCode: newCat.code, categoryLabel: newCat.label,
        status: "manual", overriddenBy: cpaUserId, batchId: existing?.batchId ?? "",
      }]);
      await loadAll();
      setSuccessMsg("Category saved.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch (e) { setError(e.message); }
  };

  // ─── Manual add ──────────────────────────────────────────────────────────
  const handleAddManualSuggestion = async () => {
    if (!selectedTxn || !manualAddDocId) return;
    const doc = getSourceDoc(manualAddDocId);
    if (!doc) return;
    setAL("add_manual");
    try {
      const docRemaining  = toFloat(doc.remainingAmount ?? getDocAmount(doc));
      const bankRemaining = toFloat(selectedTxn.remainingAmount ?? selectedTxn.amount);
      const matchedAmount = Math.min(docRemaining, bankRemaining);

      // Add to pending suggestions instead of DB
      setPendingSuggestions((prev) => {
        const existing = prev[selectedTxn.$id] ?? { matches: [], categoryCode: "MISC", anomalies: [] };
        const alreadyIn = existing.matches.some((m) => m.sourceDocId === manualAddDocId);
        if (alreadyIn) return prev;
        return {
          ...prev,
          [selectedTxn.$id]: {
            ...existing,
            matches: [
              ...existing.matches,
              {
                sourceDocId:             manualAddDocId,
                sourceDocType:           manualAddType,
                matchedAmount,
                remainingDocumentAmount: Math.max(0, docRemaining - matchedAmount),
                confidence:              1.0,
                confidenceBreakdown: {
                  amountMatch: 1, referenceMatch: 0, vendorMatch: 0, dateMatch: 0,
                  explanation: "Manually added by accountant",
                },
                reason:      "Manually added by accountant",
                currencyNote: null,
                anomalies:   [],
              },
            ],
          },
        };
      });
      setCheckedDocIds((prev) => new Set([...prev, manualAddDocId]));
      setManualAddDocId("");
    } catch (e) { setError(e.message); }
    finally { setAL(null); }
  };

  // ─── Anomaly actions ──────────────────────────────────────────────────────
  const handleAnomalyAction = async (anomaly, action, note) => {
    setAL(anomaly.$id + "_" + action);
    try {
      await updateAnomalyFlag(anomaly.$id, { status: action, resolutionNote: note ?? "" });
      await storeReviewAction({ clientId, matchId: "", anomalyId: anomaly.$id, actionType: "anomaly_resolve", performedBy: cpaUserId, comment: note ?? "", batchId: anomaly.batchId ?? "" });
      await writeAuditLog({ clientId, entityType: "anomaly_flag", entityId: anomaly.$id, action, performedBy: cpaUserId, oldValue: "open", newValue: action, note: note ?? "" });
      setAnomalies((p) => p.map((a) => a.$id === anomaly.$id ? { ...a, status: action, resolutionNote: note ?? a.resolutionNote } : a));
    } finally { setAL(null); }
  };

  const toggleCheck       = (docId) => setCheckedDocIds((prev) => { const n = new Set(prev); n.has(docId) ? n.delete(docId) : n.add(docId); return n; });
  const toggleExpandDoc   = (docId) => setExpandedDocId((prev) => prev === docId ? null : docId);

  const hasPending = selectedTxnId && !!pendingSuggestions[selectedTxnId];

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <ClientLayout client={client}>
      <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading…
      </div>
    </ClientLayout>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <ClientLayout client={client}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="max-w-full px-4 py-5 flex flex-col h-[calc(100vh-80px)]">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Reconciliation Center</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {bankTxns.length} bank transactions · {sourceDocs.length} source documents
              {Object.keys(pendingSuggestions).length > 0 && (
                <span className="ml-2 text-purple-600 font-medium">
                  · {Object.keys(pendingSuggestions).length} pending AI suggestions (not yet saved)
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button onClick={() => setPage("reconcile")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${page === "reconcile" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                Reconcile
              </button>
              <button onClick={() => setPage("anomalies")}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${page === "anomalies" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                Anomaly Dashboard
                {anomalies.filter((a) => a.status === "open").length > 0 && (
                  <span className="bg-red-100 text-red-600 text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {anomalies.filter((a) => a.status === "open").length}
                  </span>
                )}
              </button>
            </div>
            <button onClick={handleRunReconciliation} disabled={running}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {running
                ? <><span style={{ width: "14px", height: "14px", border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Running…</>
                : "▶ Run AI Reconciliation"}
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
            ⚠ {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex gap-2">
            ✓ {successMsg}
            <button onClick={() => setSuccessMsg(null)} className="ml-auto text-green-400">✕</button>
          </div>
        )}
        {running && progress.total > 0 && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex justify-between text-xs text-blue-700 font-medium mb-1">
              <span>Analysing transactions…</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* ── Info banner when pending suggestions exist ── */}
        {Object.keys(pendingSuggestions).length > 0 && !running && (
          <div className="mb-3 p-3 bg-purple-50 border border-purple-200 text-purple-800 rounded-lg text-sm flex items-center gap-2">
            <span className="text-base">🤖</span>
            <span>AI suggestions ready. Select a transaction, review the matches, then click <strong>Accept & Confirm</strong> to save to database.</span>
          </div>
        )}

        {/* ── Reconcile Page ── */}
        {page === "reconcile" && (
          <div className="flex gap-3 flex-1 min-h-0">

            {/* LEFT: Bank Transactions */}
            <div className="w-[28%] min-w-[280px] flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="p-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800 mb-2">Bank Transactions</h2>
                <input type="text" placeholder="Search…" value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-blue-300" />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: "all",       label: "All",       count: counts.all },
                    { key: "unmatched", label: "Unmatched", count: counts.unmatched, dot: "bg-red-500" },
                    { key: "review",    label: "Review",    count: counts.review + counts.suggested, dot: "bg-purple-500" },
                    { key: "partial",   label: "Partial",   count: counts.partial, dot: "bg-orange-500" },
                    { key: "matched",   label: "Matched",   count: counts.matched, dot: "bg-green-500" },
                  ].map((f) => (
                    <button key={f.key} onClick={() => setBankFilter(f.key)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors ${bankFilter === f.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
                      {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                      {f.label} ({f.count})
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredBankTxns.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">No transactions found.</div>
                ) : filteredBankTxns.map((txn) => {
                  const status = getBankTxnStatus(txn, dbMatches, pendingSuggestions);
                  const colors = STATUS_COLORS[status.color] ?? STATUS_COLORS.red;
                  const isSelected = selectedTxnId === txn.$id;
                  const isPendingTxn = !!pendingSuggestions[txn.$id];

                  return (
                    <button key={txn.$id} onClick={() => setSelectedTxnId(txn.$id)}
                      className={`w-full text-left p-3 border-b border-gray-100 transition-colors ${isSelected ? "bg-blue-50 border-l-4 border-l-blue-500" : "hover:bg-gray-50 border-l-4 border-l-transparent"}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs text-gray-400">{fmtDate(txn.txnDate ?? txn.transaction_date ?? txn.date)}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
                          {isPendingTxn && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block" />}
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{fmt(txn.amount, txn.currency)}</p>
                      <p className="text-xs text-gray-600 mt-1 leading-snug truncate" title={txn.description}>{txn.description}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-gray-400 font-mono truncate max-w-[55%]">
                          {txn.refNumber ?? txn.reference_number ?? txn.referenceNumber ?? "—"}
                        </span>
                        {status.confidence > 0 && (
                          <span className={`text-xs font-semibold ${colors.text}`}>{status.confidence}%</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* MIDDLE: Suggestions */}
            <div className="w-[40%] min-w-[360px] flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
              {!selectedTxn ? (
                <div className="flex-1 flex items-center justify-center text-center px-6">
                  <div>
                    <p className="text-3xl mb-2">👈</p>
                    <p className="text-sm text-gray-400">Select a bank transaction to view suggested matches</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Bank Txn Summary */}
                  <div className="p-3 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-sm font-semibold text-gray-800">
                        {hasPending ? "🤖 AI Suggestions (Not saved yet)" : "Confirmed Matches"}
                      </h2>
                      {selectedTxn.direction && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selectedTxn.direction === "credit" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {selectedTxn.direction === "credit" ? "↑ Credit" : "↓ Debit"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                      {[
                        { label: "Date",   value: fmtDate(selectedTxn.txnDate ?? selectedTxn.transaction_date ?? selectedTxn.date) },
                        { label: "Amount", value: fmt(selectedTxn.amount, selectedTxn.currency), bold: true },
                        { label: "Ref No.", value: selectedTxn.refNumber ?? selectedTxn.reference_number ?? "—", mono: true },
                        { label: "Currency", value: selectedTxn.currency ?? "—" },
                      ].map((item, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase" }}>{item.label}</span>
                          <span style={{ fontSize: "12px", fontWeight: item.bold ? 700 : 500, color: "#1f2937", fontFamily: item.mono ? "monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2 truncate">{selectedTxn.description}</p>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2">
                    {activeSuggestions.length === 0 ? (
                      <div className="text-center py-8 text-gray-400 text-sm px-3">
                        {hasPending
                          ? "No documents matched for this transaction."
                          : "No AI suggestions yet. Run reconciliation or add manually below."}
                      </div>
                    ) : (
                      activeSuggestions.map((m) => {
                        const doc       = getSourceDoc(m.sourceDocId);
                        if (!doc) return null;
                        const isChecked  = checkedDocIds.has(m.sourceDocId);
                        const isExpanded = expandedDocId === m.sourceDocId;
                        const conf       = Math.round(toFloat(m.confidenceScore) * 100);
                        const confColor  = conf >= 75 ? "#16a34a" : conf >= 50 ? "#d97706" : "#ef4444";
                        const remaining  = toFloat(m.remainingDocAmount ?? m.remainingDocumentAmount);

                        return (
                          <div key={m.$id} style={{
                            ...S.card,
                            border: isChecked
                              ? "1px solid #86efac"
                              : isExpanded ? "1px solid #93c5fd" : "1px solid #e5e7eb",
                            background: isChecked ? "#f0fdf4" : isExpanded ? "#eff6ff" : "#fff",
                          }}>
                            <div style={S.row}>
                              <input type="checkbox" checked={isChecked}
                                onChange={() => toggleCheck(m.sourceDocId)}
                                style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: "#16a34a", cursor: "pointer", flexShrink: 0 }} />
                              <div style={S.colMain}>
                                <div style={S.topRow}>
                                  <span style={PILL_STYLES[m.sourceDocType] ?? pillStyle("#f3f4f6","#4b5563","#e5e7eb")}>{m.sourceDocType}</span>
                                  {getDocRef(doc) && (
                                    <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#6b7280", background: "#f3f4f6", padding: "1px 6px", borderRadius: "4px" }}>
                                      {getDocRef(doc)}
                                    </span>
                                  )}
                                  {m.isPending && (
                                    <span style={pillStyle("#f5f3ff","#6d28d9","#ddd6fe")}>AI</span>
                                  )}
                                  {["accepted","manual"].includes(m.status) && (
                                    <span style={PILL_STYLES.accepted}>{m.status}</span>
                                  )}
                                  {conf < 75 && conf > 0 && (
                                    <span style={pillStyle("#fffbeb","#b45309","#fde68a")}>Needs Review</span>
                                  )}
                                </div>
                                <p style={{ fontSize: "13px", fontWeight: 600, color: "#1f2937", margin: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {getDocLabel(doc)}
                                </p>
                                <div style={S.amountRow}>
                                  <div>
                                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{fmt(m.matchedAmount, doc.currency)}</span>
                                    {remaining > 0 && (
                                      <span style={{ fontSize: "11px", color: "#d97706", marginLeft: "6px" }}>+{fmt(remaining, doc.currency)} due</span>
                                    )}
                                  </div>
                                  <span style={{ fontSize: "13px", fontWeight: 800, color: confColor }}>{conf}%</span>
                                </div>
                                <button onClick={() => toggleExpandDoc(m.sourceDocId)}
                                  style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "4px" }}>
                                  {isExpanded ? "▲ Hide details" : "▼ View document & confidence details"}
                                </button>
                                {isExpanded && (
                                  <>
                                    <DocInfoCard doc={doc} matchedAmount={m.matchedAmount} remainingDocAmount={remaining} currency={selectedTxn.currency} />
                                    <ConfidenceBar score={m.confidenceScore} breakdown={m.confidenceBreakdown} reason={m.matchReason} />
                                  </>
                                )}
                                {m.currencyNote && (
                                  <p style={{ fontSize: "11px", color: "#f97316", marginTop: "4px" }}>⚠ {m.currencyNote}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Manual add */}
                    <div className="mt-3 p-2.5 border border-dashed border-gray-300 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 mb-2">+ Add document manually</p>
                      <div className="flex gap-1.5">
                        <select value={manualAddType} onChange={(e) => { setManualAddType(e.target.value); setManualAddDocId(""); }}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                          <option value="invoice">Invoice</option>
                          <option value="expense">Expense</option>
                          <option value="payroll">Payroll</option>
                          <option value="sale">Sale</option>
                        </select>
                        <select value={manualAddDocId} onChange={(e) => setManualAddDocId(e.target.value)}
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white min-w-0">
                          <option value="">— select {manualAddType} —</option>
                          {(pendingDocsByType[manualAddType] ?? []).map((doc) => (
                            <option key={doc.$id} value={doc.$id}>
                              {getDocLabel(doc)} · {fmt(doc.remainingAmount ?? getDocAmount(doc), doc.currency)}
                            </option>
                          ))}
                        </select>
                        <button onClick={handleAddManualSuggestion} disabled={!manualAddDocId || actionLoading === "add_manual"}
                          className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg disabled:opacity-40 whitespace-nowrap">
                          {actionLoading === "add_manual" ? "…" : "Add"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bottom: Category + Totals + Accept */}
                  <div className="border-t border-gray-200 p-3 bg-gray-50">
                    {/* Category */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 font-medium">Category:</span>
                      <select className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                        value={activeCategory}
                        onChange={(e) => handleCategoryOverride(selectedTxn.$id, e.target.value)}>
                        <option value="">— select —</option>
                        {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </select>
                      {/* Show Save Category button only for already-confirmed txns */}
                      {!hasPending && localCategories[selectedTxnId] && (
                        <button onClick={() => handleSaveCategory(selectedTxnId, localCategories[selectedTxnId])}
                          className="text-xs px-2 py-1.5 bg-indigo-600 text-white rounded-lg whitespace-nowrap">
                          Save
                        </button>
                      )}
                    </div>

                    {/* Totals */}
                    <div style={S.totalsBox}>
                      <div style={S.totalsLine}>
                        <span style={{ color: "#6b7280" }}>Bank Amount</span>
                        <span style={{ fontWeight: 700 }}>{fmt(groupTotals.bankAmount, selectedTxn.currency)}</span>
                      </div>
                      <div style={S.totalsLine}>
                        <span style={{ color: "#6b7280" }}>Selected Docs ({checkedDocIds.size})</span>
                        <span style={{ fontWeight: 700 }}>{fmt(groupTotals.selectedTotal, selectedTxn.currency)}</span>
                      </div>
                      <div style={S.totalsLineFinal}>
                        <span style={{ color: "#4b5563" }}>Remaining</span>
                        <span style={{ color: groupTotals.remaining === 0 ? "#16a34a" : groupTotals.remaining > 0 ? "#d97706" : "#dc2626" }}>
                          {fmt(groupTotals.remaining, selectedTxn.currency)}
                          {groupTotals.remaining < 0 && " ⚠ Overpaid"}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {hasPending && (
                        <button onClick={handleRejectSuggestion}
                          className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg border border-gray-200">
                          ✕ Discard
                        </button>
                      )}
                      <button onClick={handleConfirmGroup}
                        disabled={actionLoading === "confirm" || checkedDocIds.size === 0}
                        style={{
                          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                          gap: "8px", padding: "10px 16px",
                          background: checkedDocIds.size === 0 ? "#86efac" : "#16a34a",
                          color: "#fff", fontSize: "14px", fontWeight: 600, borderRadius: "8px",
                          border: "none", cursor: checkedDocIds.size === 0 ? "not-allowed" : "pointer",
                          opacity: actionLoading === "confirm" ? 0.7 : 1,
                        }}>
                        {actionLoading === "confirm"
                          ? <><span style={{ width: "14px", height: "14px", border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Saving…</>
                          : `✓ Accept & Save to DB (${checkedDocIds.size} docs)`}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* RIGHT: Full Details */}
            <div className="flex-1 min-w-[260px] flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="p-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800">Full Details</h2>
                {selectedTxn && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {expandedDocId ? "Showing selected document" : "Click ▼ on a match card to expand"}
                  </p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {!selectedTxn ? (
                  <div className="text-center py-12 text-gray-400 text-sm">Select a transaction to view details.</div>
                ) : (
                  <>
                    <div>
                      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Bank Transaction</h3>
                      <div style={S.sectionBox}>
                        <DetailRow label="Date"          value={fmtDate(selectedTxn.txnDate ?? selectedTxn.transaction_date ?? selectedTxn.date)} />
                        <DetailRow label="Amount"        value={fmt(selectedTxn.amount, selectedTxn.currency)} />
                        <DetailRow label="Debit"         value={selectedTxn.debit  != null ? fmt(selectedTxn.debit,  selectedTxn.currency) : "—"} />
                        <DetailRow label="Credit"        value={selectedTxn.credit != null ? fmt(selectedTxn.credit, selectedTxn.currency) : "—"} />
                        <DetailRow label="Balance"       value={selectedTxn.balance!= null ? fmt(selectedTxn.balance,selectedTxn.currency) : "—"} />
                        <DetailRow label="Currency"      value={selectedTxn.currency  ?? "—"} />
                        <DetailRow label="Direction"     value={selectedTxn.direction ?? "—"} />
                        <DetailRow label="Description"   value={selectedTxn.description ?? "—"} />
                        <DetailRow label="Reference No." value={selectedTxn.refNumber ?? selectedTxn.reference_number ?? "—"} mono />
                        <DetailRow label="Match Status"  value={selectedTxn.matchStatus ?? "—"} badge />
                        <DetailRow label="Remaining"     value={fmt(selectedTxn.remainingAmount ?? selectedTxn.amount, selectedTxn.currency)} highlight last />
                      </div>
                    </div>

                    {expandedDocId && (() => {
                      const m   = activeSuggestions.find((mm) => mm.sourceDocId === expandedDocId);
                      const doc = getSourceDoc(expandedDocId);
                      if (!doc) return null;
                      const remaining = toFloat(m?.remainingDocAmount ?? m?.remainingDocumentAmount ?? 0);
                      return (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Supporting Document</h3>
                            <Pill label={doc._docType} styleClass={DOC_TYPE_STYLES[doc._docType]} />
                          </div>
                          <DocInfoCard doc={doc} matchedAmount={m?.matchedAmount} remainingDocAmount={remaining} currency={selectedTxn.currency} />
                          {m && <ConfidenceBar score={m.confidenceScore} breakdown={m.confidenceBreakdown} reason={m.matchReason} />}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Anomaly Dashboard */}
        {page === "anomalies" && (
          <AnomalyDashboard
            anomalies={anomalies}
            getBankTxn={getBankTxn}
            getSourceDoc={getSourceDoc}
            actionLoading={actionLoading}
            onAction={handleAnomalyAction}
          />
        )}
      </div>
    </ClientLayout>
  );
}