// src/components/AnomalyDashboard.jsx
import { useState, useMemo } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────
export function toFloat(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function fmt(v, currency) {
  if (v === null || v === undefined || v === "") return "—";
  const n = toFloat(v);
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : ((currency ?? "") + " ");
  return sym + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

export function pillStyle(bg, color, border) {
  return { display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", background: bg, color, border: `1px solid ${border}` };
}

// ─── Anomaly Type Metadata ────────────────────────────────────────────────
export const ANOMALY_META = {
  duplicate_payment_made:      { severity: "critical", icon: "💳", label: "Duplicate Payment Made",        trigger: "Two debits of same amount to same vendor within 7 days, both matched/accepted",                          action: "Must confirm which is correct and void the other" },
  payroll_paid_twice:          { severity: "critical", icon: "👥", label: "Payroll Paid Twice",             trigger: "Same employee_id + same pay_period already has an accepted match — another match attempted",             action: "Reject duplicate, verify with HR" },
  unapproved_expense_paid:     { severity: "critical", icon: "🚫", label: "Unapproved Expense Paid",        trigger: "source_document.approval_status = unapproved AND a bank match exists for it",                          action: "Get approval first or flag for investigation" },
  tds_not_deducted:            { severity: "critical", icon: "⚠️", label: "TDS Not Deducted",              trigger: "Vendor payment above ₹30,000 and no corresponding TDS payable entry in source documents",               action: "Compliance violation — must correct before closing" },
  payment_exceeds_invoice:     { severity: "critical", icon: "💰", label: "Payment Exceeds Invoice",        trigger: "Sum of matched bank payments to a source document exceeds total_amount by more than 1%",                action: "Overpayment — investigate and recover" },
  duplicate_invoice:           { severity: "high",     icon: "📄", label: "Duplicate Invoice",             trigger: "Same doc_number_normalized + same vendor_id already exists in source document (not yet paid)",          action: "Vendor may have resubmitted — verify and reject duplicate" },
  unusually_large_amount:      { severity: "high",     icon: "📈", label: "Unusually Large Amount",         trigger: "Transaction amount > 3× the rolling 90-day average for that COA category",                             action: "Confirm legitimate business reason" },
  payment_before_invoice_date: { severity: "high",     icon: "📅", label: "Payment Before Invoice Date",   trigger: "bank_transaction.txn_date is earlier than source_document.doc_date by more than 1 day",                 action: "Advance payment or data entry error — confirm intent" },
  expense_no_receipt:          { severity: "high",     icon: "🧾", label: "Expense No Receipt",            trigger: "doc_type = expense AND receipt_ref is null",                                                           action: "Attach receipt or reject claim" },
  missing_required_field:      { severity: "high",     icon: "❗", label: "Missing Required Field",        trigger: "A mandatory field (amount, date, doc_number) is null after parsing",                                    action: "Manually fill in the missing value" },
  bank_balance_gap:            { severity: "high",     icon: "🏦", label: "Bank Balance Gap",              trigger: "balance_after of row N does not equal balance_after of row N-1 ± amount of row N",                     action: "Missing transactions in bank file — re-upload or get full statement" },
  currency_mismatch:           { severity: "medium",   icon: "💱", label: "Currency Mismatch",             trigger: "bank_transaction.currency ≠ source_document.currency on a suggested match",                            action: "Confirm FX conversion is intentional" },
  low_confidence_match:        { severity: "medium",   icon: "🤖", label: "Low Confidence Match",          trigger: "AI confidence_score between 0.50 and 0.69 — match suggested but weak signals",                         action: "Verify manually before accepting" },
  overdue_unmatched_document:  { severity: "medium",   icon: "⏰", label: "Overdue Unmatched Document",    trigger: "source_document.due_date has passed and payment_status is still unpaid",                                action: "Chase payment or write off" },
  partial_match_open:          { severity: "medium",   icon: "🔀", label: "Partial Match Open",            trigger: "source_document.payment_status = partial and due_date has passed",                                     action: "Check if remaining balance was paid elsewhere" },
  amount_mismatch_small:       { severity: "medium",   icon: "🔢", label: "Amount Mismatch (Small)",       trigger: "Matched bank amount differs from source doc net_amount by 1–5% (likely bank charges or rounding)",      action: "Confirm if difference is a fee — split categorize if needed" },
  date_gap_large:              { severity: "medium",   icon: "📆", label: "Date Gap Large",                trigger: "bank_transaction.txn_date is more than 45 days after source_document.doc_date",                        action: "Late payment — confirm it's for this document" },
  new_vendor_detected:         { severity: "low",      icon: "🏢", label: "New Vendor Detected",           trigger: "vendor_name from invoice did not match any existing vendor record — new vendor created automatically",  action: "None required — review vendor list periodically" },
  unmatched_transaction:       { severity: "low",      icon: "❓", label: "Unmatched Transaction",         trigger: "Bank transaction has no AI match suggestion (confidence below 0.50) — not yet reviewed",                action: "Manual match or mark as unreconciled" },
  optional_field_missing:      { severity: "low",      icon: "📝", label: "Optional Field Missing",        trigger: "A non-mandatory field (balance_after, tax_amount) is null — won't break matching but reduces accuracy",  action: "None required — informational only" },
  duplicate_file_content:      { severity: "low",      icon: "📁", label: "Duplicate File Content",        trigger: "File hash matches a previously uploaded file — rejected at upload stage",                               action: "None — file was already blocked" },
  category_auto_assigned:      { severity: "low",      icon: "🏷️", label: "Category Auto Assigned",       trigger: "AI assigned a category with confidence > 0.85 without accountant review — logged for traceability",     action: "None required — visible for audit" },
};

export const SEV_CONFIG = {
  critical: { dot: "#ef4444", bg: "#fef2f2", border: "#fecaca", text: "#dc2626", headerBg: "#fff1f2", label: "CRITICAL", desc: "Blocks approval until resolved", icon: "🔴" },
  high:     { dot: "#f97316", bg: "#fff7ed", border: "#fed7aa", text: "#ea580c", headerBg: "#fff7ed", label: "HIGH",     desc: "Must review before final approval", icon: "🟠" },
  medium:   { dot: "#eab308", bg: "#fefce8", border: "#fef08a", text: "#ca8a04", headerBg: "#fefce8", label: "MEDIUM",   desc: "Flag for review, does not block",   icon: "🟡" },
  low:      { dot: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a", headerBg: "#f0fdf4", label: "LOW",      desc: "Informational, visible in audit log only", icon: "🟢" },
};

// ─── Anomaly Dashboard ────────────────────────────────────────────────────
export default function AnomalyDashboard({ anomalies, getBankTxn, getSourceDoc, actionLoading, onAction, onBulkAction }) {
  const [noteDrafts,    setNoteDrafts]    = useState({});
  const [statusFilter,  setStatusFilter]  = useState("open");
  const [sevFilter,     setSevFilter]     = useState("all");
  const [expandedId,    setExpandedId]    = useState(null);
  const [searchTerm,    setSearchTerm]    = useState("");

  // ── Bulk selection state ──
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkNote,    setBulkNote]    = useState("");
  const [bulkBusy,    setBulkBusy]    = useState(null); // "resolved" | "dismissed" | null

  const enriched = useMemo(() => anomalies.map((a) => ({
    ...a,
    _meta: ANOMALY_META[a.flagType] ?? { severity: a.severity ?? "low", icon: "🔍", label: a.flagType, trigger: "—", action: "Review manually" },
    _sev:  (ANOMALY_META[a.flagType]?.severity ?? a.severity ?? "low"),
  })), [anomalies]);

  const filtered = useMemo(() => enriched.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (sevFilter    !== "all" && a._sev  !== sevFilter)     return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const txn = a.relatedType === "bank_txn"   ? getBankTxn(a.relatedId)   : null;
      const doc = a.relatedType === "source_doc" ? getSourceDoc(a.relatedId) : null;
      const haystack = [
        a.flagType, a._meta?.label,
        txn?.description, txn?.refNumber, txn?.reference_number,
        doc?.invoice_number, doc?.vendorName, doc?.employeeName,
        a.resolutionNote,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }), [enriched, statusFilter, sevFilter, searchTerm, getBankTxn, getSourceDoc]);

  const counts = useMemo(() => {
    const c = { all: anomalies.length, open: 0, resolved: 0, dismissed: 0, critical: 0, high: 0, medium: 0, low: 0 };
    enriched.forEach((a) => {
      if (a.status === "open")      c.open++;
      if (a.status === "resolved")  c.resolved++;
      if (a.status === "dismissed") c.dismissed++;
      if (a._sev === "critical")    c.critical++;
      if (a._sev === "high")        c.high++;
      if (a._sev === "medium")      c.medium++;
      if (a._sev === "low")         c.low++;
    });
    return c;
  }, [enriched]);

  const grouped = useMemo(() => {
    const g = { critical: [], high: [], medium: [], low: [] };
    filtered.forEach((a) => { if (g[a._sev]) g[a._sev].push(a); });
    return g;
  }, [filtered]);

  // ── Per-flagType counts of OPEN items within the current filtered view ──
  const openByFlagType = useMemo(() => {
    const m = {};
    filtered.forEach((a) => {
      if (a.status !== "open") return;
      if (!m[a.flagType]) m[a.flagType] = [];
      m[a.flagType].push(a);
    });
    return m;
  }, [filtered]);

  const severityOrder = ["critical", "high", "medium", "low"];

  // ── Selection helpers ──
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const selectAllOfType = (flagType) => {
    const items = openByFlagType[flagType] ?? [];
    setSelectedIds((prev) => {
      const n = new Set(prev);
      const allSelected = items.every((a) => n.has(a.$id));
      if (allSelected) {
        items.forEach((a) => n.delete(a.$id));
      } else {
        items.forEach((a) => n.add(a.$id));
      }
      return n;
    });
  };

  const clearSelection = () => { setSelectedIds(new Set()); setBulkNote(""); };

  const selectedAnomalies = useMemo(
    () => filtered.filter((a) => selectedIds.has(a.$id) && a.status === "open"),
    [filtered, selectedIds]
  );

  const handleBulkAction = async (action) => {
    if (selectedAnomalies.length === 0) return;
    if (action === "resolved" && !bulkNote.trim()) return; // resolution note required
    setBulkBusy(action);
    try {
      await onBulkAction(selectedAnomalies, action, bulkNote);
      clearSelection();
    } finally {
      setBulkBusy(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">

      {/* ── Summary Stats Bar ── */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
        {severityOrder.map((sev) => {
          const cfg = SEV_CONFIG[sev];
          const cnt = counts[sev];
          if (cnt === 0) return null;
          const openCnt = enriched.filter((a) => a._sev === sev && a.status === "open").length;
          return (
            <div key={sev} onClick={() => setSevFilter(sevFilter === sev ? "all" : sev)}
              style={{
                flex: "1 1 140px", padding: "12px 14px", borderRadius: "12px", cursor: "pointer",
                border: `1.5px solid ${sevFilter === sev ? cfg.dot : cfg.border}`,
                background: sevFilter === sev ? cfg.bg : "#fff",
                boxShadow: sevFilter === sev ? `0 0 0 3px ${cfg.dot}22` : "0 1px 3px rgba(0,0,0,0.05)",
                transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: cfg.text, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {cfg.icon} {cfg.label}
                </span>
                <span style={{ fontSize: "18px", fontWeight: 800, color: cfg.text }}>{cnt}</span>
              </div>
              <p style={{ fontSize: "10px", color: "#9ca3af", margin: 0 }}>
                {openCnt} open · {cnt - openCnt} resolved/dismissed
              </p>
            </div>
          );
        })}
      </div>

      {/* ── Filter Bar ── */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "4px", background: "#f3f4f6", borderRadius: "8px", padding: "3px" }}>
          {[
            { key: "open",      label: "Open",      count: counts.open },
            { key: "resolved",  label: "Resolved",  count: counts.resolved },
            { key: "dismissed", label: "Dismissed", count: counts.dismissed },
            { key: "all",       label: "All",        count: counts.all },
          ].map((f) => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              style={{
                padding: "4px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                border: "none", cursor: "pointer", whiteSpace: "nowrap",
                background: statusFilter === f.key ? "#fff" : "transparent",
                color:      statusFilter === f.key ? "#1d4ed8" : "#6b7280",
                boxShadow:  statusFilter === f.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}>
              {f.label} ({f.count})
            </button>
          ))}
        </div>
        <input type="text" placeholder="Search anomalies…" value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1, minWidth: "160px", fontSize: "12px",
            padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "8px",
            outline: "none",
          }} />
        {(sevFilter !== "all" || statusFilter !== "open" || searchTerm) && (
          <button onClick={() => { setSevFilter("all"); setStatusFilter("open"); setSearchTerm(""); }}
            style={{ fontSize: "11px", color: "#6b7280", background: "#f3f4f6", border: "none", padding: "4px 10px", borderRadius: "6px", cursor: "pointer" }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* ── Bulk Action Bar ── */}
      {selectedAnomalies.length > 0 && (
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px",
          padding: "10px 12px", marginBottom: "14px",
          display: "flex", flexDirection: "column", gap: "8px",
          boxShadow: "0 2px 8px rgba(59,130,246,0.12)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#1d4ed8" }}>
              ✅ {selectedAnomalies.length} anomal{selectedAnomalies.length === 1 ? "y" : "ies"} selected
            </span>
            <button onClick={clearSelection}
              style={{ fontSize: "11px", color: "#6b7280", background: "#fff", border: "1px solid #e5e7eb", padding: "3px 8px", borderRadius: "6px", cursor: "pointer" }}>
              ✕ Clear selection
            </button>
          </div>
          <textarea
            rows={2}
            placeholder={`Shared resolution note for all selected anomalies…\ne.g. "Receipts not tracked for these vendors — bulk acknowledged by accountant"`}
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            style={{
              width: "100%", fontSize: "12px",
              border: "1px solid #d1d5db", borderRadius: "8px",
              padding: "8px 10px", resize: "vertical",
              outline: "none", boxSizing: "border-box",
              fontFamily: "inherit", lineHeight: 1.5,
            }} />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => handleBulkAction("resolved")}
              disabled={bulkBusy !== null || !bulkNote.trim()}
              style={{
                flex: 1, padding: "9px 0", borderRadius: "8px", border: "none", cursor: "pointer",
                background: bulkNote.trim() ? "#16a34a" : "#d1d5db",
                color: "#fff", fontSize: "12px", fontWeight: 700,
                opacity: bulkBusy === "resolved" ? 0.6 : 1,
              }}>
              {bulkBusy === "resolved" ? "Resolving…" : `✓ Mark ${selectedAnomalies.length} as Resolved`}
            </button>
            <button
              onClick={() => handleBulkAction("dismissed")}
              disabled={bulkBusy !== null}
              style={{
                padding: "9px 16px", borderRadius: "8px",
                border: "1px solid #e5e7eb", cursor: "pointer",
                background: "#fff", color: "#6b7280",
                fontSize: "12px", fontWeight: 600,
                opacity: bulkBusy === "dismissed" ? 0.6 : 1,
              }}>
              {bulkBusy === "dismissed" ? "Dismissing…" : `Dismiss ${selectedAnomalies.length}`}
            </button>
          </div>
          {!bulkNote.trim() && (
            <p style={{ fontSize: "10px", color: "#6b7280", margin: 0, fontStyle: "italic" }}>
              A resolution note is required to bulk-resolve (optional for bulk dismiss).
            </p>
          )}
        </div>
      )}

      {/* ── Anomaly Sections by Severity ── */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
          <p style={{ fontSize: "36px", marginBottom: "8px" }}>✅</p>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>No anomalies match your filters</p>
          <p style={{ fontSize: "12px" }}>Try adjusting the status or severity filter above</p>
        </div>
      ) : severityOrder.map((sev) => {
        const items = grouped[sev];
        if (items.length === 0) return null;
        const cfg = SEV_CONFIG[sev];

        // Track which flagTypes we've already shown a "select all" button for in this section
        const shownFlagTypes = new Set();

        return (
          <div key={sev} style={{ marginBottom: "20px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "8px 14px", borderRadius: "8px 8px 0 0",
              background: cfg.headerBg, border: `1px solid ${cfg.border}`,
              borderBottom: "none",
            }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
              <span style={{ fontSize: "12px", fontWeight: 700, color: cfg.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {cfg.label}
              </span>
              <span style={{ fontSize: "11px", color: cfg.text, opacity: 0.7 }}>— {cfg.desc}</span>
              <span style={{
                marginLeft: "auto", fontSize: "11px", fontWeight: 700,
                background: cfg.dot, color: "#fff",
                padding: "1px 8px", borderRadius: "99px",
              }}>{items.length}</span>
            </div>

            <div style={{
              display: "grid", gridTemplateColumns: "28px 200px 1fr 1fr 180px 120px",
              gap: "0 12px", padding: "6px 14px",
              background: "#f9fafb", border: `1px solid ${cfg.border}`,
              borderBottom: "1px solid #e5e7eb",
            }}>
              <span />
              {["Anomaly Type", "Related Transaction / Document", "When Triggered", "Accountant Action", "Status"].map((h) => (
                <span key={h} style={{ fontSize: "10px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</span>
              ))}
            </div>

            <div style={{ border: `1px solid ${cfg.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
              {items.map((a, idx) => {
                const txn     = a.relatedType === "bank_txn"   ? getBankTxn(a.relatedId)   : null;
                const doc     = a.relatedType === "source_doc" ? getSourceDoc(a.relatedId) : null;
                const isOpen  = a.status === "open";
                const isExp   = expandedId === a.$id;
                const meta    = a._meta;
                const isSelected = selectedIds.has(a.$id);

                const expected = toFloat(a.expectedAmount);
                const received = toFloat(a.receivedAmount);
                const diff     = toFloat(a.differenceAmount);

                const relatedLabel = txn
                  ? (txn.description ?? `Txn …${txn.$id?.slice(-6)}`)
                  : doc
                    ? (doc.vendorName ?? doc.customerName ?? doc.employeeName ?? doc.invoice_number ?? `Doc …${doc.$id?.slice(-6)}`)
                    : a.relatedId ? `ID: ${a.relatedId.slice(-8)}` : "—";

                const relatedSub = txn
                  ? `${fmtDate(txn.txnDate ?? txn.transaction_date)} · ${fmt(txn.amount, txn.currency)}`
                  : doc
                    ? `${fmtDate(doc.invoice_date ?? doc.expense_date ?? doc.pay_date ?? doc.sale_date ?? doc.date)} · ${fmt(doc.totalAmount ?? doc.amount ?? doc.net_pay, doc.currency)}`
                    : a.relatedType;

                // "Select all of this type" — show once per flagType, only for open items with 2+ open in this filtered view
                const typeGroup = openByFlagType[a.flagType] ?? [];
                const showSelectAllForType = isOpen && typeGroup.length > 1 && !shownFlagTypes.has(a.flagType);
                if (showSelectAllForType) shownFlagTypes.add(a.flagType);
                const allOfTypeSelected = typeGroup.length > 0 && typeGroup.every((x) => selectedIds.has(x.$id));

                return (
                  <div key={a.$id}>
                    {/* "Select all of this type" banner */}
                    {showSelectAllForType && (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 14px", background: "#f5f3ff", borderBottom: "1px solid #ede9fe",
                        fontSize: "11px",
                      }}>
                        <span style={{ color: "#6d28d9" }}>
                          {typeGroup.length} open <strong>{a.flagType}</strong> anomalies of this type in the current view
                        </span>
                        <button
                          onClick={() => selectAllOfType(a.flagType)}
                          style={{
                            fontSize: "11px", fontWeight: 700, color: "#6d28d9",
                            background: "#fff", border: "1px solid #ddd6fe",
                            padding: "3px 10px", borderRadius: "6px", cursor: "pointer",
                          }}>
                          {allOfTypeSelected ? "✓ All selected — click to deselect" : `Select all ${typeGroup.length}`}
                        </button>
                      </div>
                    )}

                    {/* Main row */}
                    <div
                      style={{
                        display: "grid", gridTemplateColumns: "28px 200px 1fr 1fr 180px 120px",
                        gap: "0 12px", padding: "10px 14px",
                        background: isExp ? cfg.bg : idx % 2 === 0 ? "#fff" : "#fafafa",
                        borderBottom: isExp ? "none" : "1px solid #f3f4f6",
                        alignItems: "start",
                        transition: "background 0.1s",
                      }}>

                      {/* Checkbox column */}
                      <div style={{ paddingTop: "2px" }}>
                        {isOpen ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(a.$id)}
                            style={{ width: "15px", height: "15px", cursor: "pointer", accentColor: "#3b82f6" }}
                          />
                        ) : null}
                      </div>

                      {/* Col 1: Anomaly type */}
                      <div onClick={() => setExpandedId(isExp ? null : a.$id)} style={{ cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "2px" }}>
                          <span style={{ fontSize: "13px" }}>{meta.icon}</span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: cfg.text, fontFamily: "monospace", letterSpacing: "-0.01em" }}>
                            {a.flagType}
                          </span>
                        </div>
                        <p style={{ fontSize: "10px", color: "#6b7280", margin: 0, lineHeight: 1.3 }}>{meta.label}</p>
                      </div>

                      {/* Col 2: Related entity */}
                      <div onClick={() => setExpandedId(isExp ? null : a.$id)} style={{ cursor: "pointer" }}>
                        <p style={{ fontSize: "12px", fontWeight: 600, color: "#1f2937", margin: "0 0 2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {relatedLabel}
                        </p>
                        <p style={{ fontSize: "10px", color: "#9ca3af", margin: 0 }}>{relatedSub}</p>
                        {(expected !== 0 || received !== 0) && (
                          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                            {expected !== 0 && (
                              <span style={{ fontSize: "10px", background: "#f3f4f6", padding: "1px 6px", borderRadius: "4px", color: "#6b7280" }}>
                                Exp: {fmt(expected, txn?.currency ?? doc?.currency)}
                              </span>
                            )}
                            {received !== 0 && (
                              <span style={{ fontSize: "10px", background: "#f3f4f6", padding: "1px 6px", borderRadius: "4px", color: "#6b7280" }}>
                                Rcv: {fmt(received, txn?.currency ?? doc?.currency)}
                              </span>
                            )}
                            {diff !== 0 && (
                              <span style={{ fontSize: "10px", fontWeight: 700, background: diff > 0 ? "#fef2f2" : "#fef3c7", padding: "1px 6px", borderRadius: "4px", color: diff > 0 ? "#dc2626" : "#d97706" }}>
                                Δ {fmt(Math.abs(diff), txn?.currency ?? doc?.currency)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Col 3: Trigger */}
                      <p onClick={() => setExpandedId(isExp ? null : a.$id)} style={{ fontSize: "11px", color: "#6b7280", margin: 0, lineHeight: 1.4, cursor: "pointer" }}>{meta.trigger}</p>

                      {/* Col 4: Action */}
                      <div onClick={() => setExpandedId(isExp ? null : a.$id)} style={{
                        fontSize: "11px", fontWeight: 600, color: cfg.text,
                        background: cfg.bg, border: `1px solid ${cfg.border}`,
                        borderRadius: "6px", padding: "4px 8px", lineHeight: 1.4, cursor: "pointer",
                      }}>
                        <span style={{ fontSize: "9px", fontWeight: 700, background: cfg.dot, color: "#fff", padding: "1px 5px", borderRadius: "3px", marginRight: "4px", letterSpacing: "0.04em" }}>
                          {sev === "critical" ? "BLOCKS" : "REVIEW"}
                        </span>
                        {meta.action}
                      </div>

                      {/* Col 5: Status + expand */}
                      <div onClick={() => setExpandedId(isExp ? null : a.$id)} style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start", cursor: "pointer" }}>
                        <span style={{
                          fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "99px",
                          background: a.status === "open" ? "#fef3c7" : a.status === "resolved" ? "#dcfce7" : "#f3f4f6",
                          color:      a.status === "open" ? "#92400e" : a.status === "resolved" ? "#15803d" : "#6b7280",
                          border:     `1px solid ${a.status === "open" ? "#fde68a" : a.status === "resolved" ? "#bbf7d0" : "#e5e7eb"}`,
                        }}>
                          {a.status === "open" ? "⏳ Open" : a.status === "resolved" ? "✓ Resolved" : "— Dismissed"}
                        </span>
                        <span style={{ fontSize: "10px", color: "#9ca3af" }}>
                          {isExp ? "▲ collapse" : "▼ details"}
                        </span>
                      </div>
                    </div>

                    {/* Expanded resolution panel */}
                    {isExp && (
                      <div style={{
                        padding: "14px 16px 16px",
                        background: cfg.bg,
                        borderBottom: "1px solid #f3f4f6",
                        borderTop: `1px solid ${cfg.border}`,
                      }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: "12px" }}>

                          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
                            <div style={{ padding: "6px 10px", background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
                              <span style={{ fontSize: "10px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>
                                {a.relatedType === "bank_txn" ? "🏦 Bank Transaction" : "📄 Source Document"}
                              </span>
                            </div>
                            {txn && (
                              <div style={{ padding: "8px 10px" }}>
                                {[
                                  ["Date",      fmtDate(txn.txnDate ?? txn.transaction_date)],
                                  ["Amount",    fmt(txn.amount, txn.currency)],
                                  ["Direction", txn.direction ?? "—"],
                                  ["Ref No.",   txn.refNumber ?? txn.reference_number ?? "—"],
                                  ["Description", txn.description ?? "—"],
                                  ["Match Status", txn.matchStatus ?? "—"],
                                ].map(([l, v]) => (
                                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "2px 0", borderBottom: "1px solid #f9fafb" }}>
                                    <span style={{ color: "#9ca3af" }}>{l}</span>
                                    <span style={{ fontWeight: 500, color: "#374151", maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {doc && (
                              <div style={{ padding: "8px 10px" }}>
                                {[
                                  ["Type",    doc._docType ?? a.relatedType],
                                  ["Date",    fmtDate(doc.invoice_date ?? doc.expense_date ?? doc.pay_date ?? doc.sale_date ?? doc.date)],
                                  ["Ref",     doc.invoice_number ?? doc.expense_id ?? doc.saleId ?? "—"],
                                  ["Vendor/Customer", doc.vendorName ?? doc.customerName ?? doc.employeeName ?? "—"],
                                  ["Amount",  fmt(doc.totalAmount ?? doc.amount ?? doc.net_pay, doc.currency)],
                                  ["Status",  doc.payment_status ?? doc.paymentStatus ?? doc.status ?? "—"],
                                ].map(([l, v]) => (
                                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "2px 0", borderBottom: "1px solid #f9fafb" }}>
                                    <span style={{ color: "#9ca3af" }}>{l}</span>
                                    <span style={{ fontWeight: 500, color: "#374151", maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {!txn && !doc && (
                              <p style={{ padding: "10px", fontSize: "11px", color: "#9ca3af", fontStyle: "italic" }}>
                                Related record not found (ID: {a.relatedId})
                              </p>
                            )}
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
                              <div style={{ padding: "6px 10px", background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" }}>🔍 Anomaly Detail</span>
                              </div>
                              <div style={{ padding: "8px 10px" }}>
                                {[
                                  ["Flag Type",  a.flagType],
                                  ["Severity",   a._sev.toUpperCase()],
                                  ["Batch ID",   a.batchId || "—"],
                                  ["Detected",   fmtDate(a.$createdAt)],
                                ].map(([l, v]) => (
                                  <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "2px 0", borderBottom: "1px solid #f9fafb" }}>
                                    <span style={{ color: "#9ca3af" }}>{l}</span>
                                    <span style={{ fontWeight: 500, color: l === "Severity" ? cfg.text : "#374151" }}>{v}</span>
                                  </div>
                                ))}
                                {(expected !== 0 || received !== 0 || diff !== 0) && (
                                  <div style={{ marginTop: "8px", padding: "8px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: "6px" }}>
                                    {expected !== 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "2px 0" }}><span style={{ color: "#6b7280" }}>Expected</span><span style={{ fontWeight: 700 }}>{fmt(expected, txn?.currency ?? doc?.currency)}</span></div>}
                                    {received !== 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "2px 0" }}><span style={{ color: "#6b7280" }}>Received</span><span style={{ fontWeight: 700 }}>{fmt(received, txn?.currency ?? doc?.currency)}</span></div>}
                                    {diff !== 0 && (
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "4px 0 0", borderTop: "1px solid #e5e7eb", marginTop: "2px" }}>
                                        <span style={{ fontWeight: 700, color: "#374151" }}>Difference</span>
                                        <span style={{ fontWeight: 800, color: diff > 0 ? "#dc2626" : "#d97706" }}>{fmt(Math.abs(diff), txn?.currency ?? doc?.currency)}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {a.resolutionNote && (
                              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 10px" }}>
                                <p style={{ fontSize: "10px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", margin: "0 0 4px" }}>📝 Previous Note</p>
                                <p style={{ fontSize: "11px", color: "#374151", fontStyle: "italic", margin: 0 }}>{a.resolutionNote}</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {isOpen ? (
                          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px" }}>
                            <p style={{ fontSize: "11px", fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                              ✍️ Resolution Note <span style={{ color: "#9ca3af", fontWeight: 400 }}>(required for Resolve; optional for Dismiss)</span>
                            </p>
                            <textarea
                              rows={3}
                              placeholder={`Describe how you resolved this anomaly…\ne.g. "Confirmed with vendor — duplicate invoice rejected" or "TDS certificate obtained and filed"`}
                              value={noteDrafts[a.$id] ?? ""}
                              onChange={(e) => setNoteDrafts((p) => ({ ...p, [a.$id]: e.target.value }))}
                              style={{
                                width: "100%", fontSize: "12px",
                                border: "1px solid #d1d5db", borderRadius: "8px",
                                padding: "8px 10px", resize: "vertical",
                                outline: "none", boxSizing: "border-box",
                                fontFamily: "inherit", lineHeight: 1.5,
                                marginBottom: "10px",
                              }} />
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                onClick={() => onAction(a, "resolved", noteDrafts[a.$id])}
                                disabled={actionLoading === a.$id + "_resolved" || !noteDrafts[a.$id]?.trim()}
                                style={{
                                  flex: 1, padding: "9px 0", borderRadius: "8px", border: "none", cursor: "pointer",
                                  background: noteDrafts[a.$id]?.trim() ? "#16a34a" : "#d1d5db",
                                  color: "#fff", fontSize: "12px", fontWeight: 700,
                                  opacity: actionLoading === a.$id + "_resolved" ? 0.6 : 1,
                                }}>
                                {actionLoading === a.$id + "_resolved" ? "Saving…" : "✓ Mark as Resolved"}
                              </button>
                              <button
                                onClick={() => onAction(a, "dismissed", noteDrafts[a.$id])}
                                disabled={actionLoading === a.$id + "_dismissed"}
                                style={{
                                  padding: "9px 16px", borderRadius: "8px",
                                  border: "1px solid #e5e7eb", cursor: "pointer",
                                  background: "#fff", color: "#6b7280",
                                  fontSize: "12px", fontWeight: 600,
                                  opacity: actionLoading === a.$id + "_dismissed" ? 0.6 : 1,
                                }}>
                                Dismiss
                              </button>
                            </div>
                            {(sev === "critical") && (
                              <p style={{ fontSize: "10px", color: "#dc2626", marginTop: "6px", fontStyle: "italic" }}>
                                ⚠ This is a CRITICAL anomaly. A resolution note is required before marking as resolved.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div style={{ background: a.status === "resolved" ? "#f0fdf4" : "#f9fafb", border: `1px solid ${a.status === "resolved" ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: "8px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <p style={{ fontSize: "11px", fontWeight: 700, color: a.status === "resolved" ? "#15803d" : "#6b7280", margin: "0 0 2px" }}>
                                {a.status === "resolved" ? "✓ Resolved" : "— Dismissed"}
                              </p>
                              {a.resolutionNote && <p style={{ fontSize: "11px", color: "#374151", margin: 0, fontStyle: "italic" }}>{a.resolutionNote}</p>}
                            </div>
                            <button
                              onClick={() => onAction(a, "open", "")}
                              disabled={actionLoading === a.$id + "_open"}
                              style={{ fontSize: "11px", color: "#6b7280", background: "#fff", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: "6px", cursor: "pointer" }}>
                              ↩ Reopen
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}