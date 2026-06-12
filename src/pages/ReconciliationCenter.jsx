// ReconciliationCenter.jsx
// At the top, add this import:
import { detectAnomalies } from "../utils/anomalyEngine";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import {
  getBankTransactions, getInvoices, getExpenseRecords,
  getPayrollRecords, getSaleRecords, getTransactionMatches,
   getAnomalyFlags,
  updateTransactionMatch, updateAnomalyFlag,
  storeTransactionMatches, storeAnomalyFlags,
  storeReviewAction, writeAuditLog, ID,
  updateBankTransaction, updateSourceDocument,
  getCoaAccounts,
} from "../appwrite/config";
import {
  runReconciliation, getDocAmount, getDocLabel,
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

const CATEGORY_TO_COA_HINTS = {
  PAYROLL:      { accountType: "Expense",   keywords: ["salary", "payroll", "wages", "compensation"] },
  VENDOR_PAY:   { accountType: "Expense",   keywords: ["vendor", "supplier", "purchase", "accounts payable"] },
  RENT:         { accountType: "Expense",   keywords: ["rent", "lease"] },
  UTILITIES:    { accountType: "Expense",   keywords: ["utilities", "electricity", "water", "internet"] },
  TRAVEL:       { accountType: "Expense",   keywords: ["travel", "transport", "fuel", "accommodation"] },
  OFFICE_EXP:   { accountType: "Expense",   keywords: ["office", "stationery", "supplies"] },
  PROFESSIONAL: { accountType: "Expense",   keywords: ["professional", "legal", "consulting", "audit"] },
  REVENUE:      { accountType: "Revenue",   keywords: ["revenue", "sales", "income", "receipts"] },
  REFUND:       { accountType: "Asset",     keywords: ["refund", "reversal", "return"] },
  TRANSFER:     { accountType: "Asset",     keywords: ["transfer", "internal"] },
  TAX:          { accountType: "Liability", keywords: ["tax", "gst", "vat", "tds"] },
  LOAN:         { accountType: "Liability", keywords: ["loan", "emi", "borrowing", "repayment"] },
  MISC:         { accountType: "Expense",   keywords: ["miscellaneous"] },
};

function findBestCoaMatch(description, coaAccounts, docType = null, amount = 0) {
  if (!coaAccounts || coaAccounts.length === 0) return null;
  const desc = (description ?? "").toLowerCase();
  const pool = coaAccounts.filter((a) => a.allow_direct_posting !== false);

  // Map docType → expected COA account_type
  const docTypeAccountMap = {
    invoice: "Expense",   // vendor invoice = expense
    expense: "Expense",
    payroll: "Expense",
    sale:    "Revenue",
  };

  // Map docType → strong keyword hints
  const docTypeKeywords = {
    invoice: ["vendor", "supplier", "purchase", "accounts payable", "payable"],
    expense: ["expense", "office", "travel", "utilities", "rent", "professional"],
    payroll: ["salary", "payroll", "wages", "compensation", "employee"],
    sale:    ["revenue", "sales", "income", "receipts", "customer"],
  };

  const expectedAccountType = docType ? docTypeAccountMap[docType] : null;
  const primaryKeywords     = docType ? (docTypeKeywords[docType] ?? []) : [];

  let best = null, bestScore = -1;

  for (const acct of pool) {
    const searchStr = [
      acct.account_name,
      acct.category,
      acct.sub_category,
      acct.description ?? "",
    ].join(" ").toLowerCase();

    let score = 0;

    // 1. Strong boost if account_type matches expected for this doc type
    if (expectedAccountType && acct.account_type === expectedAccountType) {
      score += 10;
    }
    // Penalty if account_type is completely wrong for doc type
    if (expectedAccountType && acct.account_type !== expectedAccountType) {
      score -= 8;
    }

    // 2. Primary doc-type keyword matches (high weight)
    for (const kw of primaryKeywords) {
      if (searchStr.includes(kw)) score += 4;
      if (desc.includes(kw) && searchStr.includes(kw)) score += 3;
    }

    // 3. Description word overlap with account name/category
    const descWords = desc.split(/\s+/).filter((w) => w.length > 3);
    for (const word of descWords) {
      if (searchStr.includes(word)) score += 2;
    }

    // 4. All hint keywords (lower weight, just for tie-breaking)
    const allKeywords = Object.values(CATEGORY_TO_COA_HINTS).flatMap((h) => h.keywords);
    for (const kw of allKeywords) {
      if (desc.includes(kw) && searchStr.includes(kw)) score += 1;
    }

    // 5. Penalise tax/liability accounts unless description explicitly mentions tax
    const isTaxAccount = searchStr.includes("tax") || searchStr.includes("gst") || searchStr.includes("vat");
    const descMentionsTax = desc.includes("tax") || desc.includes("gst") || desc.includes("vat") || desc.includes("tds");
    if (isTaxAccount && !descMentionsTax) score -= 6;

    if (score > bestScore) { bestScore = score; best = acct; }
  }

  return best;
}

function getBankTxnStatus(txn, dbMatches, pendingSuggestions) {
  const confirmed = dbMatches.filter(
    (m) => m.bankTxnId === txn.$id && ["accepted", "manual"].includes(m.status)
  );
  if (confirmed.length > 0) {
    const remaining = toFloat(txn.remainingAmount ?? txn.amount);
    const amount    = toFloat(txn.amount);
    if (remaining <= 0) return { label: "Matched", color: "green", confidence: 100 };
    if (remaining < amount) return { label: "Partial", color: "orange", confidence: Math.round(((amount - remaining) / amount) * 100) };
  }
  const pending = pendingSuggestions[txn.$id];
  if (pending) {
    if (pending.isMiscOnly) return { label: "Misc / No Doc", color: "orange", confidence: 0 };
    if (pending.matches.length === 0) return { label: "Unmatched", color: "red", confidence: 0 };
    const topConf = pending.matches[0]?.confidence ?? 0;
    if (topConf >= 0.75) return { label: "AI Suggested", color: "purple", confidence: Math.round(topConf * 100) };
    return { label: "Needs Review", color: "blue", confidence: Math.round(topConf * 100) };
  }
  const aiSuggested = dbMatches.filter((m) => m.bankTxnId === txn.$id && m.status === "ai_suggested");
  if (aiSuggested.length > 0) {
    const avgConf = aiSuggested.reduce((s, m) => s + toFloat(m.confidenceScore), 0) / aiSuggested.length;
    return { label: "Needs Review", color: "blue", confidence: Math.round(avgConf * 100) };
  }
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
  invoice:  pillStyle("#eff6ff", "#1d4ed8", "#bfdbfe"),
  expense:  pillStyle("#fffbeb", "#b45309", "#fde68a"),
  payroll:  pillStyle("#f5f3ff", "#6d28d9", "#ddd6fe"),
  sale:     pillStyle("#f0fdfa", "#0f766e", "#99f6e4"),
  accepted: pillStyle("#f0fdf4", "#15803d", "#bbf7d0"),
  manual:   pillStyle("#f0fdf4", "#15803d", "#bbf7d0"),
  misc:     pillStyle("#f3f4f6", "#6b7280", "#e5e7eb"),
};

// ─── MISC / No Supporting Document virtual doc ────────────────────────────────
const MISC_DOC_ID = "__MISC_NO_DOC__";
function makeMiscDoc(bankTxn) {
  return {
    $id:       MISC_DOC_ID,
    _docType:  "misc",
    _isMisc:   true,
    amount:    toFloat(bankTxn?.amount),
    currency:  bankTxn?.currency ?? "",
    date:      bankTxn?.txnDate ?? bankTxn?.transaction_date ?? bankTxn?.date ?? new Date().toISOString(),
    description: "No supporting document — classified as Miscellaneous",
  };
}

// ─── COA Category Selector ────────────────────────────────────────────────────
function CoaCategorySelector({ coaAccounts, selectedAccountCode, onSelect, suggestedAccount, label = "COA Account" }) {
  const [search, setSearch] = useState("");
  const [open, setOpen]     = useState(false);
  const [filter, setFilter] = useState("all");

  const accountTypes = useMemo(() => {
    const types = new Set(coaAccounts.map((a) => a.account_type));
    return ["all", ...Array.from(types)];
  }, [coaAccounts]);

  const filtered = useMemo(() => {
    let list = coaAccounts.filter((a) => a.allow_direct_posting !== false);
    if (filter !== "all") list = list.filter((a) => a.account_type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        (a.account_name ?? "").toLowerCase().includes(q) ||
        (a.account_code ?? "").toLowerCase().includes(q) ||
        (a.category ?? "").toLowerCase().includes(q) ||
        (a.sub_category ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [coaAccounts, filter, search]);

  const grouped = useMemo(() => {
    const g = {};
    for (const a of filtered) {
      const key = a.category ?? "Other";
      if (!g[key]) g[key] = [];
      g[key].push(a);
    }
    return g;
  }, [filtered]);

  const selected = coaAccounts.find((a) => a.account_code === selectedAccountCode);

  const typeColors = {
    Asset:     { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    Liability: { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
    Equity:    { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    Revenue:   { bg: "#f0fdfa", color: "#0f766e", border: "#99f6e4" },
    Expense:   { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  };

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </span>
        {suggestedAccount && suggestedAccount.account_code !== selectedAccountCode && (
          <span style={{ ...pillStyle("#f5f3ff", "#6d28d9", "#ddd6fe"), fontSize: "10px" }}>
            🤖 AI: {suggestedAccount.account_code} · {suggestedAccount.account_name}
          </span>
        )}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: "8px",
          background: "#fff", cursor: "pointer", fontSize: "12px",
          boxShadow: open ? "0 0 0 2px #6366f133" : "none",
        }}>
        {selected ? (
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#374151" }}>{selected.account_code}</span>
            <span style={{ color: "#4b5563" }}>{selected.account_name}</span>
            {selected.account_type && (
              <span style={{ ...pillStyle(
                typeColors[selected.account_type]?.bg ?? "#f3f4f6",
                typeColors[selected.account_type]?.color ?? "#374151",
                typeColors[selected.account_type]?.border ?? "#e5e7eb",
              ), fontSize: "10px" }}>{selected.account_type}</span>
            )}
          </span>
        ) : (
          <span style={{ color: "#9ca3af" }}>— Select COA Account —</span>
        )}
        <span style={{ color: "#9ca3af", fontSize: "10px" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", zIndex: 50, left: 0, right: 0, top: "calc(100% + 4px)",
          background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
            <input autoFocus type="text" placeholder="Search account name, code, category…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", fontSize: "12px", padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: "6px", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: "4px", padding: "6px 8px", borderBottom: "1px solid #f3f4f6", flexWrap: "wrap" }}>
            {accountTypes.map((t) => (
              <button key={t} onClick={() => setFilter(t)}
                style={{
                  padding: "2px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600,
                  border: "none", cursor: "pointer",
                  background: filter === t ? "#3b82f6" : "#f3f4f6",
                  color: filter === t ? "#fff" : "#6b7280",
                }}>
                {t === "all" ? "All" : t}
              </button>
            ))}
          </div>
          {suggestedAccount && (
            <div style={{ padding: "6px 10px", background: "#faf5ff", borderBottom: "1px solid #ede9fe" }}>
              <span style={{ fontSize: "11px", color: "#7c3aed", fontWeight: 600 }}>🤖 AI Suggestion:</span>
              <button
                onClick={() => { onSelect(suggestedAccount.account_code); setOpen(false); setSearch(""); }}
                style={{ marginLeft: "8px", fontSize: "12px", fontWeight: 600, color: "#6d28d9", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                {suggestedAccount.account_code} · {suggestedAccount.account_name}
                <span style={{ color: "#9ca3af", fontWeight: 400, marginLeft: "4px" }}>({suggestedAccount.category})</span>
              </button>
            </div>
          )}
          <div style={{ maxHeight: "280px", overflowY: "auto" }}>
            {Object.keys(grouped).length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>No accounts found.</div>
            ) : Object.entries(grouped).map(([cat, accounts]) => (
              <div key={cat}>
                <div style={{ padding: "4px 10px", fontSize: "10px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
                  {cat}
                </div>
                {accounts.map((a) => {
                  const tc = typeColors[a.account_type] ?? { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb" };
                  const isSelected = a.account_code === selectedAccountCode;
                  return (
                    <button key={a.$id}
                      onClick={() => { onSelect(a.account_code); setOpen(false); setSearch(""); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: "8px",
                        padding: "7px 10px", background: isSelected ? "#eff6ff" : "transparent",
                        border: "none", borderBottom: "1px solid #f9fafb", cursor: "pointer", textAlign: "left",
                      }}>
                      <span style={{ fontFamily: "monospace", fontSize: "11px", fontWeight: 700, color: "#374151", minWidth: "44px" }}>{a.account_code}</span>
                      <span style={{ flex: 1, fontSize: "12px", color: "#1f2937", fontWeight: isSelected ? 600 : 400 }}>{a.account_name}</span>
                      {a.sub_category && <span style={{ fontSize: "10px", color: "#9ca3af" }}>{a.sub_category}</span>}
                      <span style={{ ...pillStyle(tc.bg, tc.color, tc.border), fontSize: "10px" }}>{a.account_type}</span>
                      {isSelected && <span style={{ color: "#3b82f6", fontSize: "12px" }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {selectedAccountCode && (
            <div style={{ padding: "6px 10px", borderTop: "1px solid #f3f4f6" }}>
              <button onClick={() => { onSelect(null); setOpen(false); }}
                style={{ fontSize: "11px", color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>
                ✕ Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

// ─── Document Info Card — date is ALWAYS shown first for every doc type ───────
function DocInfoCard({ doc, matchedAmount, remainingDocAmount, currency }) {
  if (!doc) return null;

  // Special render for Misc / No Supporting Doc
  if (doc._isMisc) {
    return (
      <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", overflow: "hidden", marginTop: "8px" }}>
        <div style={{ padding: "10px 12px", background: "#fef3c7", borderBottom: "1px solid #fde68a", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "18px" }}>📋</span>
          <div>
            <p style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", margin: 0 }}>No Supporting Document</p>
            <p style={{ fontSize: "11px", color: "#b45309", margin: 0 }}>Classified as Miscellaneous</p>
          </div>
        </div>
        <div style={S.detailRow}>
          <span style={S.detailLabel}>Transaction Date</span>
          <span style={{ ...S.detailValue, fontWeight: 700, color: "#1f2937" }}>{fmtDate(doc.date)}</span>
        </div>
        <div style={S.detailRow}>
          <span style={S.detailLabel}>Amount</span>
          <span style={{ ...S.detailValueHighlight }}>{fmt(doc.amount, doc.currency)}</span>
        </div>
        <div style={{ ...S.detailRow, borderBottom: "none" }}>
          <span style={S.detailLabel}>Note</span>
          <span style={{ ...S.detailValue, fontStyle: "italic", color: "#9ca3af" }}>{doc.description}</span>
        </div>
      </div>
    );
  }

  const type = doc._docType;

  // ── Always-first: Transaction / Document Date ──
  const txnDate =
    doc.invoice_date ?? doc.invoiceDate ??
    doc.expense_date ?? doc.expenseDate ??
    doc.pay_date     ?? doc.payDate     ??
    doc.sale_date    ?? doc.saleDate    ??
    doc.date         ?? doc.txnDate     ?? null;

  const rows = [];

  // DATE IS ALWAYS FIRST — mandatory for all document types
  rows.push({
    label: "Transaction Date",
    value: txnDate ? fmtDate(txnDate) : "⚠ Date not available",
    bold: true,
    highlight: !txnDate,
  });

  rows.push({ label: "Document Type", value: type ? type.charAt(0).toUpperCase() + type.slice(1) : "—" });
  rows.push({ label: "Reference No.", value: getDocRef(doc) ?? "—", mono: true });

  if (type === "invoice") {
    rows.push({ label: "Vendor / Customer", value: getDocLabel(doc) });
    rows.push({ label: "Invoice Total",     value: fmt(getDocAmount(doc), doc.currency) });
    rows.push({ label: "Tax",               value: fmt(doc.tax ?? doc.tax_amount, doc.currency) });
    rows.push({ label: "Due Date",          value: fmtDate(doc.due_date ?? doc.dueDate) });
    rows.push({ label: "Payment Status",    value: doc.payment_status ?? doc.paymentStatus ?? "unpaid", badge: true });
  } else if (type === "expense") {
    rows.push({ label: "Vendor",            value: getDocLabel(doc) });
    rows.push({ label: "Expense Category",  value: doc.expense_category ?? doc.category ?? "—" });
    rows.push({ label: "Description",       value: doc.description ?? "—" });
    rows.push({ label: "Total Amount",      value: fmt(getDocAmount(doc), doc.currency) });
    rows.push({ label: "Payment Status",    value: doc.payment_status ?? doc.paymentStatus ?? "unpaid", badge: true });
  } else if (type === "payroll") {
    rows.push({ label: "Employee Name",     value: getDocLabel(doc) });
    rows.push({ label: "Department",        value: doc.department ?? "—" });
    rows.push({ label: "Payroll Period",    value: doc.payroll_period ?? doc.period ?? "—" });
    rows.push({ label: "Pay Date",          value: fmtDate(doc.pay_date ?? doc.payDate) });
    rows.push({ label: "Gross Pay",         value: fmt(doc.gross_pay ?? doc.grossPay, doc.currency) });
    rows.push({ label: "Net Pay",           value: fmt(doc.net_pay ?? doc.netPay, doc.currency) });
  } else if (type === "sale") {
    rows.push({ label: "Customer",          value: getDocLabel(doc) });
    rows.push({ label: "Sale Date",         value: fmtDate(doc.sale_date ?? doc.saleDate ?? doc.date) });
    rows.push({ label: "Description",       value: doc.description ?? "—" });
    rows.push({ label: "Total Amount",      value: fmt(getDocAmount(doc), doc.currency) });
    rows.push({ label: "Status",            value: doc.status ?? doc.payment_status ?? "—", badge: true });
  }

  rows.push({ label: "Matched Amount",   value: fmt(matchedAmount, currency ?? doc.currency), highlight: true });
  rows.push({ label: "Remaining on Doc", value: fmt(remainingDocAmount, currency ?? doc.currency), highlight: remainingDocAmount > 0 });

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", marginTop: "8px" }}>
      {rows.map((r, i) => (
        <div key={i} style={{ ...S.detailRow, borderBottom: i === rows.length - 1 ? "none" : "1px solid #f1f5f9", background: i === 0 ? "#f0f9ff" : "transparent" }}>
          <span style={{ ...S.detailLabel, minWidth: "130px", fontWeight: i === 0 ? 700 : 400, color: i === 0 ? "#0369a1" : "#6b7280" }}>
            {i === 0 && "📅 "}{r.label}
          </span>
          {r.badge ? (
            <span style={pillStyle("#eef2ff", "#4338ca", "#c7d2fe")}>{String(r.value).replace(/_/g, " ")}</span>
          ) : (
            <span style={{
              ...(r.highlight ? S.detailValueHighlight : S.detailValue),
              fontFamily: r.mono ? "monospace" : "inherit",
              fontWeight: r.bold ? 700 : undefined,
              color: r.highlight && !r.bold ? "#d97706"
                   : r.bold && !r.value?.toString().includes("⚠") ? "#1e40af"
                   : r.value?.toString().includes("⚠") ? "#dc2626"
                   : undefined,
            }}>
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



// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReconciliationCenter() {
  const { id: clientId } = useParams();
  const location = useLocation();
  const client   = location.state?.client;

  const [page,       setPage]       = useState("reconcile");
  const [loading,    setLoading]    = useState(true);
  const [running,    setRunning]    = useState(false);
  const [error,      setError]      = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [progress,   setProgress]   = useState({ current: 0, total: 0 });

  const [bankTxns,    setBankTxns]    = useState([]);
  const [sourceDocs,  setSourceDocs]  = useState([]);
  const [dbMatches,   setDbMatches]   = useState([]);
  const [anomalies,   setAnomalies]   = useState([]);
  const [coaAccounts, setCoaAccounts] = useState([]);

  const [pendingSuggestions, setPendingSuggestions] = useState({});

  const [selectedTxnId,  setSelectedTxnId]  = useState(null);
  const [expandedDocId,  setExpandedDocId]  = useState(null);
  const [checkedDocIds,  setCheckedDocIds]  = useState(new Set());
  const [bankFilter,     setBankFilter]     = useState("all");
  const [searchTerm,     setSearchTerm]     = useState("");
  const [actionLoading,  setAL]             = useState(null);
  const [manualAddType,  setManualAddType]  = useState("invoice");
  const [manualAddDocId, setManualAddDocId] = useState("");
  const [localOverrides, setLocalOverrides] = useState({});

  const cpaUserId = sessionStorage.getItem("cpa_user_id") ?? "cpa_user";

  // ─── Load ─────────────────────────────────────────────────────────────────
 const loadingRef = useRef(false);

const loadAll = useCallback(async () => {
  if (loadingRef.current) return; // prevent overlapping/duplicate runs
  loadingRef.current = true;
  setLoading(true);
  try {
    const [txns, invs, exps, pays, sales, mats, existingAnoms, coa] = await Promise.all([
      getBankTransactions(clientId),
      getInvoices(clientId),
      getExpenseRecords(clientId),
      getPayrollRecords(clientId),
      getSaleRecords(clientId),
      getTransactionMatches(clientId),
      getAnomalyFlags(clientId),
      getCoaAccounts(clientId).catch(() => []),
    ]);

    const allSourceDocs = [
      ...invs.map((d)  => ({ ...d, _docType: "invoice" })),
      ...exps.map((d)  => ({ ...d, _docType: "expense" })),
      ...pays.map((d)  => ({ ...d, _docType: "payroll" })),
      ...sales.map((d) => ({ ...d, _docType: "sale"    })),
    ];

    setSourceDocs(allSourceDocs);
    setBankTxns(txns);
    setDbMatches(mats);
    setCoaAccounts(coa);

    // Use ALL existing anomalies (any status) for dedup — match storeAnomalyFlags
    const existingKeys = new Set(
      existingAnoms.map((a) => `${a.relatedId}::${a.flagType}`)
    );

    const detected = detectAnomalies({
      bankTxns:   txns,
      sourceDocs: allSourceDocs,
      dbMatches:  mats,
      clientId,
    });

    const newAnoms = detected.filter(
      (a) => !existingKeys.has(`${a.relatedId}::${a.flagType}`)
    );

    if (newAnoms.length > 0) {
      const toStore = newAnoms.slice(0, 20);
      console.log(`Detected ${newAnoms.length} new anomalies, storing ${toStore.length} this load`);
      await storeAnomalyFlags(toStore);
      const fresh = await getAnomalyFlags(clientId);
      setAnomalies(fresh);
    } else {
      setAnomalies(existingAnoms);
    }

  } catch (e) {
    setError(e.message);
  } finally {
    setLoading(false);
    loadingRef.current = false;
  }
}, [clientId]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const getBankTxn   = (id) => bankTxns.find((t)   => t.$id === id);
  const getSourceDoc = (id) => {
    if (id === MISC_DOC_ID) return null; // misc has no real source doc
    return sourceDocs.find((d) => d.$id === id);
  };

  const selectedTxn = selectedTxnId ? getBankTxn(selectedTxnId) : null;

  // Active suggestions including virtual misc doc
  const activeSuggestions = useMemo(() => {
    if (!selectedTxnId) return [];
    const pending = pendingSuggestions[selectedTxnId];
    if (pending) {
      // If isMiscOnly, inject the virtual misc entry
      if (pending.isMiscOnly) {
        return [{
          $id:             `misc_${selectedTxnId}`,
          bankTxnId:       selectedTxnId,
          sourceDocId:     MISC_DOC_ID,
          sourceDocType:   "misc",
          matchedAmount:   toFloat(getBankTxn(selectedTxnId)?.amount),
          remainingDocAmount: 0,
          confidenceScore: 0,
          confidenceBreakdown: {},
          matchReason:     "No supporting document — classified as Miscellaneous",
          currencyNote:    null,
          status:          "pending",
          isPending:       true,
          isMisc:          true,
        }];
      }
      return pending.matches.map((m, i) => ({
        $id:              `pending_${selectedTxnId}_${i}`,
        bankTxnId:        selectedTxnId,
        sourceDocId:      m.sourceDocId,
        sourceDocType:    m.sourceDocType,
        matchedAmount:    m.matchedAmount,
        remainingDocAmount: m.remainingDocumentAmount,
        confidenceScore:  m.confidence,
        confidenceBreakdown: m.confidenceBreakdown,
        matchReason:      m.reason,
        currencyNote:     m.currencyNote,
        status:           "pending",
        isPending:        true,
      }));
    }
    return dbMatches.filter((m) => m.bankTxnId === selectedTxnId && m.status !== "rejected");
  }, [selectedTxnId, pendingSuggestions, dbMatches, bankTxns]); // eslint-disable-line

  // Pre-check
  useEffect(() => {
    if (!selectedTxnId) { setCheckedDocIds(new Set()); setExpandedDocId(null); return; }
    const pending = pendingSuggestions[selectedTxnId];
    let preChecked;
    if (pending) {
      if (pending.isMiscOnly) {
        preChecked = new Set([MISC_DOC_ID]);
      } else {
        preChecked = new Set(
          pending.matches.filter((m) => m.confidence >= 0.75).map((m) => m.sourceDocId)
        );
      }
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

  // categoryCode removed — classification driven by COA account_type

  const activeCoaCode = useMemo(() => {
    if (!selectedTxnId) return null;
    if (localOverrides[selectedTxnId]?.coaAccountCode !== undefined) return localOverrides[selectedTxnId].coaAccountCode;
    const txn = getBankTxn(selectedTxnId);
    return txn?.coaCode ?? null;
  }, [selectedTxnId, localOverrides, bankTxns]); // eslint-disable-line

  const aiSuggestedCoaAccount = useMemo(() => {
  if (!selectedTxn || coaAccounts.length === 0) return null;

  // Infer doc type from checked/suggested documents for better COA matching
  const checkedDocTypes = [...checkedDocIds]
    .filter((id) => id !== MISC_DOC_ID)
    .map((id) => getSourceDoc(id)?._docType)
    .filter(Boolean);

  const inferredDocType = checkedDocTypes.length > 0
    ? checkedDocTypes[0]
    : activeSuggestions[0]?.sourceDocType ?? null;

  return findBestCoaMatch(
    selectedTxn.description,
    coaAccounts,
    inferredDocType,
    toFloat(selectedTxn.amount)
  );
}, [selectedTxn, coaAccounts, checkedDocIds, activeSuggestions]);

  const counts = useMemo(() => {
    const c = { all: bankTxns.length, matched: 0, partial: 0, unmatched: 0, review: 0, suggested: 0 };
    bankTxns.forEach((t) => {
      const st = getBankTxnStatus(t, dbMatches, pendingSuggestions);
      if (st.color === "green")       c.matched++;
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
    // For misc-only, selectedTotal = full bank amount
    if (checkedDocIds.has(MISC_DOC_ID)) {
      const bankAmount = toFloat(selectedTxn.amount);
      return { bankAmount, selectedTotal: bankAmount, remaining: 0 };
    }
    const checkedDocs = [...checkedDocIds].map((id) => {
      const m   = activeSuggestions.find((mm) => mm.sourceDocId === id);
      const doc = getSourceDoc(id);
      return { ...doc, remainingAmount: m ? toFloat(m.matchedAmount) : toFloat(doc?.remainingAmount ?? getDocAmount(doc)) };
    }).filter(Boolean);
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

  const hasPending = selectedTxnId && !!pendingSuggestions[selectedTxnId];

  // ─── Overrides ────────────────────────────────────────────────────────────
  const setOverride = (txnId, patch) =>
    setLocalOverrides((prev) => ({ ...prev, [txnId]: { ...(prev[txnId] ?? {}), ...patch } }));



  const handleCoaChange = (txnId, newCode) => setOverride(txnId, { coaAccountCode: newCode });

  // ─── Mark as Misc / No Supporting Document ────────────────────────────────
  const handleMarkAsMisc = () => {
    if (!selectedTxn) return;
    setPendingSuggestions((prev) => ({
      ...prev,
      [selectedTxn.$id]: {
        bankTxnId:   selectedTxn.$id,
        matches:     [],
        categoryCode: "MISC",
        anomalies:   [],
        isMiscOnly:  true,
      },
    }));
    setLocalOverrides((prev) => ({
      ...prev,
      [selectedTxn.$id]: { ...(prev[selectedTxn.$id] ?? {}), },
    }));
    setCheckedDocIds(new Set([MISC_DOC_ID]));
    setExpandedDocId(null);
  };

  // ─── Run AI Reconciliation ────────────────────────────────────────────────
  const handleRunReconciliation = async () => {
    setRunning(true); setError(null);
    setProgress({ current: 0, total: 0 });
    setPendingSuggestions({});
    try {
      const results = await runReconciliation({
        bankTransactions: bankTxns,
        sourceDocs,
        onProgress: ({ current, total }) => setProgress({ current, total }),
      });
      const newPending = {};
      for (const r of results) newPending[r.bankTxnId] = r;
      setPendingSuggestions(newPending);
      const total       = results.length;
      const matched     = results.filter((r) => r.matches.length > 0 && r.matches[0].confidence >= 0.75).length;
      const needsReview = results.filter((r) => r.matches.length > 0 && r.matches[0].confidence < 0.75).length;
      const unmatched   = results.filter((r) => r.matches.length === 0).length;
      setSuccessMsg(`AI analysis complete: ${matched} auto-suggested · ${needsReview} need review · ${unmatched} unmatched.`);
      setTimeout(() => setSuccessMsg(null), 6000);
    } catch (e) { setError(e.message); }
    finally { setRunning(false); setProgress({ current: 0, total: 0 }); }
  };

  // ─── Accept & Confirm ─────────────────────────────────────────────────────
  const handleConfirmGroup = async () => {
    if (!selectedTxn) return;
    // Allow confirm even with only MISC_DOC_ID checked (no real docs)
    const realDocIds = [...checkedDocIds].filter((id) => id !== MISC_DOC_ID);
    const isMiscConfirm = checkedDocIds.has(MISC_DOC_ID) && realDocIds.length === 0;
    if (!isMiscConfirm && checkedDocIds.size === 0) return;

    setAL("confirm");
    try {
      const batchId    = ID.unique();
      const groupId    = `grp_${selectedTxn.$id}_${batchId}`;
      const now        = new Date().toISOString();
      const bankAmount = toFloat(selectedTxn.amount);

      const finalCoaCode = activeCoaCode
        ?? (aiSuggestedCoaAccount ? aiSuggestedCoaAccount.account_code : null);
      const finalCoaAccount = finalCoaCode
        ? coaAccounts.find((a) => a.account_code === finalCoaCode) ?? null
        : null;

      const matchRowsToStore = [];
      let totalMatchedAmount = 0;

      if (isMiscConfirm) {
        // Store a single "misc" match row with no sourceDocId
        matchRowsToStore.push({
          clientId,
          bankTxnId:           selectedTxn.$id,
          sourceDocId:         "",           // no real doc
          sourceDocType:       "misc",
          matchType:           "misc",
          groupId,
          status:              "accepted",
          confidenceScore:     0,
          confidenceBreakdown: "{}",
          matchReason:         "No supporting document — classified as Miscellaneous by accountant",
          isManual:            true,
          matchedBy:           cpaUserId,
          matchedAmount:       bankAmount,
          remainingBankAmount: 0,
          remainingDocAmount:  0,
          currencyNote:        "",
          reviewedAt:          now,
          batchId,
          coaCode:             finalCoaCode ?? "",
        });
        totalMatchedAmount = bankAmount;
      } else {
        for (const docId of realDocIds) {
          const suggestion   = activeSuggestions.find((m) => m.sourceDocId === docId);
          const doc          = getSourceDoc(docId);
          if (!doc) continue;
          const docRemaining  = toFloat(doc.remainingAmount ?? getDocAmount(doc));
          const bankRemaining = toFloat(selectedTxn.remainingAmount ?? selectedTxn.amount);
          const matchedAmount = suggestion
            ? toFloat(suggestion.matchedAmount)
            : Math.min(docRemaining, bankRemaining);
          totalMatchedAmount += matchedAmount;

          const confScore     = suggestion ? toFloat(suggestion.confidenceScore) : 1.0;
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
            matchType:           realDocIds.length === 1 ? "one_to_one" : "one_to_many",
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
            coaCode:             finalCoaCode ?? "",
          });
        }
      }

      const remainingBankAmount = Math.max(0, bankAmount - totalMatchedAmount);
      const matchStatus = remainingBankAmount <= 0 ? "matched"
                        : remainingBankAmount < bankAmount ? "partial"
                        : "unmatched";

  

      // Anomalies
      const anomalyRowsToStore = [];
      const pending = pendingSuggestions[selectedTxnId];
      if (pending && !pending.isMiscOnly) {
        for (const anomaly of (pending.anomalies ?? [])) {
          if (!anomaly) continue;
          anomalyRowsToStore.push({
            clientId, relatedId: selectedTxn.$id, relatedType: "bank_txn",
            flagType: (anomaly.type ?? "ai_detected").toLowerCase(),
            severity: anomaly.severity ?? "medium", status: "open",
            resolutionNote: anomaly.note ?? "",
            expectedAmount: toFloat(anomaly.expectedAmount),
            receivedAmount: toFloat(anomaly.receivedAmount),
            differenceAmount: toFloat(anomaly.differenceAmount),
            batchId,
          });
        }
        const notAccepted = pending.matches.filter((m) => !realDocIds.includes(m.sourceDocId));
        for (const m of notAccepted) {
          const doc = getSourceDoc(m.sourceDocId);
          if (!doc) continue;
          anomalyRowsToStore.push({
            clientId, relatedId: m.sourceDocId, relatedType: "source_doc",
            flagType: "unmatched_document", severity: "low", status: "open",
            resolutionNote: "Suggested but not accepted by CPA",
            expectedAmount: getDocAmount(doc), receivedAmount: 0, differenceAmount: getDocAmount(doc),
            batchId,
          });
        }
      }

      if (matchRowsToStore.length)   await storeTransactionMatches(matchRowsToStore);
      if (anomalyRowsToStore.length) await storeAnomalyFlags(anomalyRowsToStore);

     const bankTxnUpdate = {
  matchStatus,
  remainingAmount: remainingBankAmount,
  matchedDocumentId: isMiscConfirm
    ? ""
    : (realDocIds[0] ?? "")
};

await updateBankTransaction(
  selectedTxn.$id,
  bankTxnUpdate,
  clientId,
  cpaUserId
);

      // Update source documents (skip for misc)
      if (!isMiscConfirm) {
        for (const docId of realDocIds) {
          const match = matchRowsToStore.find((m) => m.sourceDocId === docId);
          const doc   = getSourceDoc(docId);
          if (!doc || !match) continue;
          const docTotal     = toFloat(doc.remainingAmount ?? getDocAmount(doc));
          const newRemaining = Math.max(0, docTotal - match.matchedAmount);
          await updateSourceDocument(doc._docType, docId, {
  remainingAmount:  newRemaining,
  paymentStatus:    newRemaining <= 0 ? "paid" : "partially_paid",
  matchStatus:      "matched",
  matchedBankTxnId: selectedTxn.$id,
}, clientId, cpaUserId);
        }
      }

      await storeReviewAction({
        clientId, matchId: groupId, anomalyId: "", actionType: "confirm_group",
        performedBy: cpaUserId,
        comment: isMiscConfirm
  ? `Marked as Miscellaneous (no supporting document) for txn ${selectedTxn.$id}`
  : `Accepted ${realDocIds.length} doc(s) for txn ${selectedTxn.$id}${finalCoaCode ? ` | COA: ${finalCoaCode}` : ""}`,
        batchId,
      });
      await writeAuditLog({
        clientId, entityType: "transaction_match", entityId: selectedTxn.$id,
        action: isMiscConfirm ? "MISC_NO_DOC" : "MANUALLY_APPROVED",
        performedBy: cpaUserId,
        oldValue: "pending", newValue: "accepted",
        note: isMiscConfirm
          ? "Classified as Miscellaneous — no supporting document"
          : `${realDocIds.length} document(s) confirmed${finalCoaCode ? ` | COA: ${finalCoaCode} (${finalCoaAccount?.account_name ?? ""})` : ""}`,
      });

      setPendingSuggestions((prev) => { const n = { ...prev }; delete n[selectedTxnId]; return n; });
      setLocalOverrides((prev)      => { const n = { ...prev }; delete n[selectedTxnId]; return n; });
      await loadAll();
      setSuccessMsg(isMiscConfirm
        ? `✓ Transaction marked as Miscellaneous (no supporting document).`
        : `✓ Match confirmed: ${realDocIds.length} document(s) accepted${finalCoaCode ? ` · COA: ${finalCoaCode}` : ""}.`
      );
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e) { setError(e.message); }
    finally { setAL(null); }
  };

  const handleRejectSuggestion = () => {
    setPendingSuggestions((prev) => { const n = { ...prev }; delete n[selectedTxnId]; return n; });
    setCheckedDocIds(new Set());
  };

  

  const handleAddManualSuggestion = async () => {
    if (!selectedTxn || !manualAddDocId) return;
    const doc = getSourceDoc(manualAddDocId);
    if (!doc) return;
    setAL("add_manual");
    try {
      const docRemaining  = toFloat(doc.remainingAmount ?? getDocAmount(doc));
      const bankRemaining = toFloat(selectedTxn.remainingAmount ?? selectedTxn.amount);
      const matchedAmount = Math.min(docRemaining, bankRemaining);
      setPendingSuggestions((prev) => {
        const existing = prev[selectedTxn.$id] ?? { matches: [], anomalies: [], isMiscOnly: false };
        const alreadyIn = existing.matches.some((m) => m.sourceDocId === manualAddDocId);
        if (alreadyIn) return prev;
        return {
          ...prev,
          [selectedTxn.$id]: {
            ...existing,
            isMiscOnly: false,
            matches: [...existing.matches, {
              sourceDocId: manualAddDocId, sourceDocType: manualAddType,
              matchedAmount,
              remainingDocumentAmount: Math.max(0, docRemaining - matchedAmount),
              confidence: 1.0,
              confidenceBreakdown: { amountMatch: 1, referenceMatch: 0, vendorMatch: 0, dateMatch: 0, explanation: "Manually added by accountant" },
              reason: "Manually added by accountant",
              currencyNote: null, anomalies: [],
            }],
          },
        };
      });
      // Remove MISC_DOC_ID from checked if a real doc is being added
      setCheckedDocIds((prev) => {
        const n = new Set(prev);
        n.delete(MISC_DOC_ID);
        n.add(manualAddDocId);
        return n;
      });
      setManualAddDocId("");
    } catch (e) { setError(e.message); }
    finally { setAL(null); }
  };

  // In handleAnomalyAction:
const handleAnomalyAction = async (anomaly, action, note) => {
  setAL(anomaly.$id + "_" + action);
  try {
    await updateAnomalyFlag(anomaly.$id, { status: action, resolutionNote: note ?? "" }, clientId, cpaUserId);
    await storeReviewAction({
      clientId, matchId: "", anomalyId: anomaly.$id,
      actionType: action === "open" ? "anomaly_reopen" : "anomaly_resolve",
      performedBy: cpaUserId, comment: note ?? "", batchId: anomaly.batchId ?? ""
    });
    setAnomalies((p) => p.map((a) =>
      a.$id === anomaly.$id ? { ...a, status: action, resolutionNote: note ?? a.resolutionNote } : a
    ));
  } finally { setAL(null); }
};

  const toggleCheck     = (docId) => setCheckedDocIds((prev) => { const n = new Set(prev); n.has(docId) ? n.delete(docId) : n.add(docId); return n; });
  const toggleExpandDoc = (docId) => setExpandedDocId((prev) => prev === docId ? null : docId);

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <ClientLayout client={client}>
      <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading…
      </div>
    </ClientLayout>
  );

  const isMiscOnlySelected = checkedDocIds.has(MISC_DOC_ID) && [...checkedDocIds].filter(id => id !== MISC_DOC_ID).length === 0;

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
              {bankTxns.length} bank transactions · {sourceDocs.length} source documents · {coaAccounts.length} COA accounts
              {Object.keys(pendingSuggestions).length > 0 && (
                <span className="ml-2 text-purple-600 font-medium">
                  · {Object.keys(pendingSuggestions).length} pending AI suggestions
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
            ⚠ {error}<button onClick={() => setError(null)} className="ml-auto text-red-400">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex gap-2">
            ✓ {successMsg}<button onClick={() => setSuccessMsg(null)} className="ml-auto text-green-400">✕</button>
          </div>
        )}
        {running && progress.total > 0 && (
          <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex justify-between text-xs text-blue-700 font-medium mb-1">
              <span>Analysing transactions…</span><span>{progress.current} / {progress.total}</span>
            </div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} />
            </div>
          </div>
        )}
        {Object.keys(pendingSuggestions).length > 0 && !running && (
          <div className="mb-3 p-3 bg-purple-50 border border-purple-200 text-purple-800 rounded-lg text-sm flex items-center gap-2">
            <span className="text-base">🤖</span>
            <span>AI suggestions ready. Review matches, assign a COA account, then click <strong>Accept & Confirm</strong> to save. If no document matches, use <strong>Mark as Misc</strong>.</span>
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

  <div className="flex-1 overflow-y-auto py-1">
    {filteredBankTxns.length === 0 ? (
      <div className="text-center py-12 text-gray-400 text-sm">No transactions found.</div>
    ) : filteredBankTxns.map((txn) => {
      const status       = getBankTxnStatus(txn, dbMatches, pendingSuggestions);
      const isSelected   = selectedTxnId === txn.$id;
      const isPendingTxn = !!pendingSuggestions[txn.$id];
      const isCredit     = txn.direction === "credit";
      const isDebit      = txn.direction === "debit";

      const statusDotColor = {
        green:  "#22c55e",
        orange: "#f97316",
        red:    "#ef4444",
        blue:   "#3b82f6",
        purple: "#a855f7",
      }[status.color] ?? "#9ca3af";

      const statusBg = {
        green:  "#f0fdf4", orange: "#fff7ed", red: "#fef2f2",
        blue:   "#eff6ff", purple: "#faf5ff",
      }[status.color] ?? "#f9fafb";

      const statusBorder = {
        green: "#bbf7d0", orange: "#fed7aa", red: "#fecaca",
        blue:  "#bfdbfe", purple: "#e9d5ff",
      }[status.color] ?? "#e5e7eb";

      return (
        <button
          key={txn.$id}
          onClick={() => setSelectedTxnId(txn.$id)}
          style={{ width: "100%", textAlign: "left", padding: 0, border: "none", background: "none", cursor: "pointer", display: "block" }}
        >
          <div style={{
            margin: "6px 10px",
            borderRadius: "12px",
            border: isSelected ? `2px solid #3b82f6` : "1.5px solid #e5e7eb",
            background: isSelected ? "#eff6ff" : "#fff",
            boxShadow: isSelected
              ? "0 4px 16px rgba(59,130,246,0.13)"
              : "0 1px 3px rgba(0,0,0,0.05)",
            transition: "all 0.15s ease",
            overflow: "hidden",
            position: "relative",
          }}>
            {/* Status accent bar on left */}
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: "4px",
              borderRadius: "12px 0 0 12px",
              background: statusDotColor,
            }} />

            <div style={{ padding: "10px 12px 10px 16px" }}>

              {/* Row 1: Date + Status badge */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {fmtDate(txn.txnDate ?? txn.transaction_date ?? txn.date)}
                  </span>
                  {isPendingTxn && (
                    <span style={{
                      fontSize: "9px", fontWeight: 700,
                      background: "#f5f3ff", color: "#7c3aed",
                      border: "1px solid #ddd6fe",
                      padding: "1px 5px", borderRadius: "99px",
                    }}>🤖 AI</span>
                  )}
                </div>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: "4px",
                  padding: "2px 7px", borderRadius: "99px",
                  fontSize: "10px", fontWeight: 700,
                  background: statusBg, color: statusDotColor,
                  border: `1px solid ${statusBorder}`,
                  whiteSpace: "nowrap",
                }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: statusDotColor, flexShrink: 0 }} />
                  {status.label}
                </span>
              </div>

              {/* Row 2: Amount + direction + confidence */}
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                <span style={{
                  fontSize: "16px", fontWeight: 800, letterSpacing: "-0.02em",
                  color: isCredit ? "#15803d" : isDebit ? "#dc2626" : "#111827",
                  lineHeight: 1,
                }}>
                  {isCredit ? "+" : isDebit ? "−" : ""}{fmt(txn.amount, txn.currency)}
                </span>
                {txn.direction && (
                  <span style={{
                    fontSize: "9px", fontWeight: 700,
                    color: isCredit ? "#15803d" : "#dc2626",
                    background: isCredit ? "#f0fdf4" : "#fef2f2",
                    border: `1px solid ${isCredit ? "#bbf7d0" : "#fecaca"}`,
                    padding: "1px 5px", borderRadius: "99px",
                  }}>
                    {isCredit ? "↑ Credit" : "↓ Debit"}
                  </span>
                )}
                {status.confidence > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, color: statusDotColor }}>
                    {status.confidence}%
                  </span>
                )}
              </div>

              {/* Row 3: Description */}
              <p style={{
                fontSize: "11px", fontWeight: 500, color: "#374151",
                margin: "0 0 6px 0",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                lineHeight: 1.4,
              }} title={txn.description}>
                {txn.description ?? "—"}
              </p>

              {/* Row 4: Ref + COA tag */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                <span style={{
                  fontSize: "10px", fontFamily: "monospace", color: "#9ca3af",
                  background: "#f9fafb", border: "1px solid #f0f0f0",
                  padding: "1px 6px", borderRadius: "4px",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: txn.coaCode ? "55%" : "100%",
                }}>
                  {txn.refNumber ?? txn.reference_number ?? txn.referenceNumber ?? "No ref"}
                </span>
                {txn.coaCode && (
                  <span style={{
                    fontSize: "9px", fontWeight: 700,
                    background: "#f0fdf4", color: "#15803d",
                    border: "1px solid #bbf7d0",
                    padding: "1px 6px", borderRadius: "99px",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    📒 {txn.coaCode}
                  </span>
                )}
              </div>

            </div>
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
                        {hasPending
                          ? (pendingSuggestions[selectedTxnId]?.isMiscOnly
                              ? "📋 Classified as Miscellaneous"
                              : "🤖 AI Suggestions (Not saved yet)")
                          : "Confirmed Matches"}
                      </h2>
                      {selectedTxn.direction && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selectedTxn.direction === "credit" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {selectedTxn.direction === "credit" ? "↑ Credit" : "↓ Debit"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                      {[
                        { label: "Date",     value: fmtDate(selectedTxn.txnDate ?? selectedTxn.transaction_date ?? selectedTxn.date) },
                        { label: "Amount",   value: fmt(selectedTxn.amount, selectedTxn.currency), bold: true },
                        { label: "Ref No.",  value: selectedTxn.refNumber ?? selectedTxn.reference_number ?? "—", mono: true },
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
                    {/* ── Misc banner when no matches and no misc set ── */}
                    {!hasPending && activeSuggestions.length === 0 && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                        <p className="font-semibold mb-1">📋 No matching documents found</p>
                        <p className="mb-2 text-amber-700">If there is genuinely no supporting document for this transaction, you can mark it as <strong>Miscellaneous</strong>.</p>
                        <button onClick={handleMarkAsMisc}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg">
                          Mark as Misc / No Supporting Document
                        </button>
                      </div>
                    )}

                    {activeSuggestions.length === 0 && hasPending && !pendingSuggestions[selectedTxnId]?.isMiscOnly ? (
                      <div className="text-center py-8 text-gray-400 text-sm px-3">
                        No documents matched for this transaction.
                      </div>
                    ) : (
                      activeSuggestions.map((m) => {
                        const isMiscEntry = m.sourceDocId === MISC_DOC_ID || m.isMisc;
                        const doc         = isMiscEntry ? makeMiscDoc(selectedTxn) : getSourceDoc(m.sourceDocId);
                        if (!doc) return null;
                        const isChecked  = checkedDocIds.has(m.sourceDocId);
                        const isExpanded = expandedDocId === m.sourceDocId;
                        const conf       = isMiscEntry ? 0 : Math.round(toFloat(m.confidenceScore) * 100);
                        const confColor  = conf >= 75 ? "#16a34a" : conf >= 50 ? "#d97706" : "#9ca3af";

                        return (
                          <div key={m.$id} style={{
                            ...S.card,
                            border: isChecked
                              ? (isMiscEntry ? "1px solid #fde68a" : "1px solid #86efac")
                              : isExpanded ? "1px solid #93c5fd" : "1px solid #e5e7eb",
                            background: isChecked
                              ? (isMiscEntry ? "#fffbeb" : "#f0fdf4")
                              : isExpanded ? "#eff6ff" : "#fff",
                          }}>
                            <div style={S.row}>
                              <input type="checkbox" checked={isChecked}
                                onChange={() => toggleCheck(m.sourceDocId)}
                                style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: isMiscEntry ? "#d97706" : "#16a34a", cursor: "pointer", flexShrink: 0 }} />
                              <div style={S.colMain}>
                                <div style={S.topRow}>
                                  {isMiscEntry ? (
                                    <span style={pillStyle("#fffbeb","#b45309","#fde68a")}>📋 Misc / No Doc</span>
                                  ) : (
                                    <span style={PILL_STYLES[m.sourceDocType] ?? pillStyle("#f3f4f6","#4b5563","#e5e7eb")}>{m.sourceDocType}</span>
                                  )}
                                  {!isMiscEntry && getDocRef(doc) && (
                                    <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#6b7280", background: "#f3f4f6", padding: "1px 6px", borderRadius: "4px" }}>
                                      {getDocRef(doc)}
                                    </span>
                                  )}
                                  {m.isPending && !isMiscEntry && <span style={pillStyle("#f5f3ff","#6d28d9","#ddd6fe")}>AI</span>}
                                  {["accepted","manual"].includes(m.status) && !isMiscEntry && (
                                    <span style={PILL_STYLES.accepted}>{m.status}</span>
                                  )}
                                </div>
                                <p style={{ fontSize: "13px", fontWeight: 600, color: isMiscEntry ? "#92400e" : "#1f2937", margin: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {isMiscEntry ? "No Supporting Document" : getDocLabel(doc)}
                                </p>
                                <div style={S.amountRow}>
                                  <div>
                                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{fmt(m.matchedAmount, doc.currency ?? selectedTxn.currency)}</span>
                                    {!isMiscEntry && toFloat(m.remainingDocAmount ?? m.remainingDocumentAmount) > 0 && (
                                      <span style={{ fontSize: "11px", color: "#d97706", marginLeft: "6px" }}>
                                        +{fmt(m.remainingDocAmount ?? m.remainingDocumentAmount, doc.currency)} due
                                      </span>
                                    )}
                                  </div>
                                  {!isMiscEntry && conf > 0 && (
                                    <span style={{ fontSize: "13px", fontWeight: 800, color: confColor }}>{conf}%</span>
                                  )}
                                  {isMiscEntry && (
                                    <span style={{ fontSize: "11px", color: "#9ca3af", fontStyle: "italic" }}>No doc</span>
                                  )}
                                </div>
                                {/* Date always shown on the card too */}
                                {!isMiscEntry && (() => {
                                  const docDate = getDocDate(doc);
                                  return docDate ? (
                                    <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>
                                      📅 {fmtDate(docDate)}
                                    </p>
                                  ) : (
                                    <p style={{ fontSize: "11px", color: "#dc2626", marginTop: "3px" }}>
                                      ⚠ Date not available
                                    </p>
                                  );
                                })()}
                                <button onClick={() => toggleExpandDoc(m.sourceDocId)}
                                  style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: "4px" }}>
                                  {isExpanded ? "▲ Hide details" : "▼ View document details"}
                                </button>
                                {isExpanded && (
                                  <>
                                    <DocInfoCard doc={doc} matchedAmount={m.matchedAmount} remainingDocAmount={toFloat(m.remainingDocAmount ?? m.remainingDocumentAmount)} currency={selectedTxn.currency} />
                                    {!isMiscEntry && <ConfidenceBar score={m.confidenceScore} breakdown={m.confidenceBreakdown} reason={m.matchReason} />}
                                  </>
                                )}
                                {m.currencyNote && !isMiscEntry && (
                                  <p style={{ fontSize: "11px", color: "#f97316", marginTop: "4px" }}>⚠ {m.currencyNote}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}

                    {/* Manual add — hidden when misc-only is active */}
                    {!pendingSuggestions[selectedTxnId]?.isMiscOnly && (
                      <div className="mt-3 p-2.5 border border-dashed border-gray-300 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-gray-500">+ Add document manually</p>
                          <button onClick={handleMarkAsMisc}
                            className="text-xs px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg whitespace-nowrap">
                            📋 No Doc? Mark as Misc
                          </button>
                        </div>
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
                            {(pendingDocsByType[manualAddType] ?? []).map((doc) => {
  const isPayroll = doc._docType === "payroll";
  const empCode   = doc.employee_code ?? doc.employeeCode ?? doc.employeeId ?? "";
  const empName   = doc.employee_name ?? doc.employeeName ?? getDocLabel(doc);
  const salary    = fmt(doc.net_pay ?? doc.netPay ?? doc.gross_pay ?? doc.grossPay ?? getDocAmount(doc), doc.currency);
  const docDate   = getDocDate(doc) ? fmtDate(getDocDate(doc)) : "⚠ no date";

 const isInvoice = doc._docType === "invoice";
const isExpense = doc._docType === "expense";

const invNumber = doc.invoice_number ?? doc.invoiceNumber ?? "";
const expId     = doc.expense_id ?? doc.expenseId ?? doc.expenseRowIndex ?? "";

const label = isPayroll
  ? `${empCode ? `[${empCode}] ` : ""}${empName} · ${salary} · ${docDate}`
  : isInvoice
  ? `${invNumber ? `[${invNumber}] ` : ""}${getDocLabel(doc)} · ${fmt(doc.remainingAmount ?? getDocAmount(doc), doc.currency)} · ${docDate}`
  : isExpense
  ? `${expId ? `[${expId}] ` : ""}${getDocLabel(doc)} · ${fmt(doc.remainingAmount ?? getDocAmount(doc), doc.currency)} · ${docDate}`
  : `${getDocLabel(doc)} · ${fmt(doc.remainingAmount ?? getDocAmount(doc), doc.currency)}${getDocDate(doc) ? ` · ${fmtDate(getDocDate(doc))}` : " · ⚠ no date"}`;
  return (
    <option key={doc.$id} value={doc.$id}>
      {label}
    </option>
  );
})}
                          </select>
                          <button onClick={handleAddManualSuggestion} disabled={!manualAddDocId || actionLoading === "add_manual"}
                            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg disabled:opacity-40 whitespace-nowrap">
                            {actionLoading === "add_manual" ? "…" : "Add"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Un-misc button when misc is active */}
                    {pendingSuggestions[selectedTxnId]?.isMiscOnly && (
                      <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                        <p className="font-medium mb-1.5">Transaction marked as Miscellaneous — no supporting document.</p>
                        <button onClick={handleRejectSuggestion}
                          className="text-xs px-2 py-1 bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 rounded-lg">
                          ✕ Cancel — search for a document instead
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Bottom: Category + COA + Totals + Accept */}
                  <div className="border-t border-gray-200 p-3 bg-gray-50">
                    {/* Category removed — COA account drives classification */}

                    {coaAccounts.length > 0 && (
                      <div className="mb-3">
                        <CoaCategorySelector
                          coaAccounts={coaAccounts}
                          selectedAccountCode={activeCoaCode}
                          onSelect={(code) => handleCoaChange(selectedTxn.$id, code)}
                          suggestedAccount={aiSuggestedCoaAccount}
                          label="Chart of Accounts"
                        />
                        {activeCoaCode && (() => {
                          const acct = coaAccounts.find((a) => a.account_code === activeCoaCode);
                          if (!acct) return null;
                          return (
                            <div style={{ display: "flex", gap: "6px", marginTop: "5px", flexWrap: "wrap" }}>
                              {acct.category    && <span style={pillStyle("#f3f4f6","#4b5563","#e5e7eb")} className="text-xs">📁 {acct.category}</span>}
                              {acct.sub_category && <span style={pillStyle("#f3f4f6","#6b7280","#e5e7eb")} className="text-xs">{acct.sub_category}</span>}
                              {acct.normal_balance && <span style={pillStyle("#eef2ff","#4338ca","#c7d2fe")} className="text-xs">{acct.normal_balance} side</span>}
                              {acct.tax_category && <span style={pillStyle("#fff7ed","#c2410c","#fed7aa")} className="text-xs">🧾 {acct.tax_category}</span>}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Totals */}
                    <div style={S.totalsBox}>
                      <div style={S.totalsLine}>
                        <span style={{ color: "#6b7280" }}>Bank Amount</span>
                        <span style={{ fontWeight: 700 }}>{fmt(groupTotals.bankAmount, selectedTxn.currency)}</span>
                      </div>
                      <div style={S.totalsLine}>
                        <span style={{ color: "#6b7280" }}>
                          {isMiscOnlySelected ? "Misc (no doc)" : `Selected Docs (${[...checkedDocIds].filter(id => id !== MISC_DOC_ID).length})`}
                        </span>
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
                        disabled={actionLoading === "confirm" || (checkedDocIds.size === 0)}
                        style={{
                          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                          gap: "8px", padding: "10px 16px",
                          background: checkedDocIds.size === 0 ? "#d1d5db"
                            : isMiscOnlySelected ? "#d97706"
                            : "#16a34a",
                          color: "#fff", fontSize: "14px", fontWeight: 600, borderRadius: "8px",
                          border: "none", cursor: checkedDocIds.size === 0 ? "not-allowed" : "pointer",
                          opacity: actionLoading === "confirm" ? 0.7 : 1,
                        }}>
                        {actionLoading === "confirm"
                          ? <><span style={{ width: "14px", height: "14px", border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Saving…</>
                          : isMiscOnlySelected
                            ? "📋 Accept as Misc / No Supporting Doc"
                            : `✓ Accept & Save to DB (${[...checkedDocIds].filter(id => id !== MISC_DOC_ID).length} docs)`}
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
                        <DetailRow label="Balance"       value={selectedTxn.balance != null ? fmt(selectedTxn.balance, selectedTxn.currency) : "—"} />
                        <DetailRow label="Currency"      value={selectedTxn.currency  ?? "—"} />
                        <DetailRow label="Direction"     value={selectedTxn.direction ?? "—"} />
                        <DetailRow label="Description"   value={selectedTxn.description ?? "—"} />
                        <DetailRow label="Reference No." value={selectedTxn.refNumber ?? selectedTxn.reference_number ?? "—"} mono />
                        <DetailRow label="Match Status"  value={selectedTxn.matchStatus ?? "—"} badge />
<DetailRow label="Category" value={selectedTxn.categoryLabel ?? "—"} />                        {selectedTxn.coaCode && (
                          <>
                            <DetailRow label="COA Code"     value={selectedTxn.coaCode} mono />
                            <DetailRow label="COA Account"  value={selectedTxn.coaAccountName ?? "—"} />
                            <DetailRow label="COA Category" value={selectedTxn.coaCategory ?? "—"} />
                            {selectedTxn.coaSubCategory && <DetailRow label="COA Sub-Cat" value={selectedTxn.coaSubCategory} />}
                          </>
                        )}
                        <DetailRow label="Remaining" value={fmt(selectedTxn.remainingAmount ?? selectedTxn.amount, selectedTxn.currency)} highlight last />
                      </div>
                    </div>

                    {activeCoaCode && !selectedTxn.coaCode && (() => {
                      const acct = coaAccounts.find((a) => a.account_code === activeCoaCode);
                      if (!acct) return null;
                      return (
                        <div>
                          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📒 COA Account (pending save)</h3>
                          <div style={{ ...S.sectionBox, border: "1px solid #ddd6fe" }}>
                            <DetailRow label="Code"          value={acct.account_code} mono />
                            <DetailRow label="Name"          value={acct.account_name} />
                            <DetailRow label="Type"          value={acct.account_type} badge />
                            <DetailRow label="Category"      value={acct.category ?? "—"} />
                            {acct.sub_category    && <DetailRow label="Sub-Category"  value={acct.sub_category} />}
                            {acct.normal_balance  && <DetailRow label="Normal Balance" value={acct.normal_balance} />}
                            {acct.tax_category    && <DetailRow label="Tax Category"   value={acct.tax_category} />}
                            {acct.financial_statement && <DetailRow label="Statement"  value={acct.financial_statement} />}
                            {acct.description     && <DetailRow label="Description"    value={acct.description} last />}
                          </div>
                        </div>
                      );
                    })()}

                    {expandedDocId && (() => {
                      const isMiscExp = expandedDocId === MISC_DOC_ID;
                      const m   = activeSuggestions.find((mm) => mm.sourceDocId === expandedDocId);
                      const doc = isMiscExp ? makeMiscDoc(selectedTxn) : getSourceDoc(expandedDocId);
                      if (!doc) return null;
                      const remaining = toFloat(m?.remainingDocAmount ?? m?.remainingDocumentAmount ?? 0);
                      return (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Supporting Document</h3>
                            {isMiscExp ? (
                              <span style={pillStyle("#fffbeb","#b45309","#fde68a")}>📋 Misc / No Doc</span>
                            ) : (
                              <Pill label={doc._docType} styleClass={DOC_TYPE_STYLES[doc._docType]} />
                            )}
                          </div>
                          <DocInfoCard doc={doc} matchedAmount={m?.matchedAmount} remainingDocAmount={remaining} currency={selectedTxn.currency} />
                          {m && !isMiscExp && <ConfidenceBar score={m.confidenceScore} breakdown={m.confidenceBreakdown} reason={m.matchReason} />}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        
        
      </div>
    </ClientLayout>
  );
}