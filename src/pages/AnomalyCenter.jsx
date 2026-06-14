// src/pages/AnomalyCenter.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";
import AnomalyDashboard from "../components/AnomalyDashboard";
import { detectAnomalies } from "../utils/anomalyEngine";
import {
  getBankTransactions, getInvoices, getExpenseRecords,
  getPayrollRecords, getSaleRecords,
  getAnomalyFlags, updateAnomalyFlag, storeReviewAction,
  getTransactionMatches, storeAnomalyFlags,   // ← add these two
} from "../appwrite/config";

export default function AnomalyCenter() {
  const { id: clientId } = useParams();
  const location = useLocation();
  const client   = location.state?.client;

  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [bankTxns,  setBankTxns]  = useState([]);
  const [sourceDocs, setSourceDocs] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [actionLoading, setAL]    = useState(null);

  const cpaUserId = sessionStorage.getItem("cpa_user_id") ?? "cpa_user";
  const loadingRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const [txns, invs, exps, pays, sales, anoms] = await Promise.all([
        getBankTransactions(clientId),
        getInvoices(clientId),
        getExpenseRecords(clientId),
        getPayrollRecords(clientId),
        getSaleRecords(clientId),
        getAnomalyFlags(clientId),
      ]);

      const allSourceDocs = [
        ...invs.map((d)  => ({ ...d, _docType: "invoice" })),
        ...exps.map((d)  => ({ ...d, _docType: "expense" })),
        ...pays.map((d)  => ({ ...d, _docType: "payroll" })),
        ...sales.map((d) => ({ ...d, _docType: "sale"    })),
      ];

      setBankTxns(txns);
      setSourceDocs(allSourceDocs);
      setAnomalies(anoms);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [clientId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const getBankTxn   = (id) => bankTxns.find((t) => t.$id === id);
  const getSourceDoc = (id) => sourceDocs.find((d) => d.$id === id);
const [detecting, setDetecting] = useState(false);

const runDetection = async () => {
  setDetecting(true);
  setError(null);
  try {
    const [txns, invs, exps, pays, sales, matches] = await Promise.all([
      getBankTransactions(clientId),
      getInvoices(clientId),
      getExpenseRecords(clientId),
      getPayrollRecords(clientId),
      getSaleRecords(clientId),
      getTransactionMatches(clientId),
    ]);

    const allSourceDocs = [
      ...invs.map((d)  => ({ ...d, _docType: "invoice" })),
      ...exps.map((d)  => ({ ...d, _docType: "expense" })),
      ...pays.map((d)  => ({ ...d, _docType: "payroll" })),
      ...sales.map((d) => ({ ...d, _docType: "sale"    })),
    ];

    const flags = detectAnomalies({
      bankTxns: txns,
      sourceDocs: allSourceDocs,
      dbMatches: matches,
      expenseRecords: exps,
      salesRecords: sales,
      payrollRecords: pays,
      clientId,
    });

    await storeAnomalyFlags(flags, cpaUserId);

    setSuccessMsg(`✓ Detection complete. ${flags.length} anomaly(ies) checked.`);
    setTimeout(() => setSuccessMsg(null), 5000);

    // Reload anomalies to show new flags
    await loadAll();
  } catch (e) {
    setError(e.message);
  } finally {
    setDetecting(false);
  }
};
  // ── Single anomaly action ──
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
    } catch (e) {
      setError(e.message);
    } finally {
      setAL(null);
    }
  };

  // ── Bulk action: apply the same action + note to a list of anomalies ──
  const handleBulkAction = async (anomalyList, action, note) => {
    if (!anomalyList || anomalyList.length === 0) return;
    setError(null);
    const results = { success: 0, failed: 0 };

    for (const anomaly of anomalyList) {
      try {
        await updateAnomalyFlag(anomaly.$id, { status: action, resolutionNote: note ?? "" }, clientId, cpaUserId);
        await storeReviewAction({
          clientId, matchId: "", anomalyId: anomaly.$id,
          actionType: action === "open" ? "anomaly_reopen" : "anomaly_resolve",
          performedBy: cpaUserId,
          comment: note ?? "",
          batchId: anomaly.batchId ?? "",
        });
        results.success++;
      } catch (e) {
        console.error(`Bulk action failed for ${anomaly.$id}:`, e.message);
        results.failed++;
      }
    }

    // Update local state for all successfully-updated anomalies
    const updatedIds = new Set(anomalyList.map((a) => a.$id));
    setAnomalies((p) => p.map((a) =>
      updatedIds.has(a.$id) ? { ...a, status: action, resolutionNote: note ?? a.resolutionNote } : a
    ));

    setSuccessMsg(
      results.failed > 0
        ? `✓ ${results.success} anomaly(ies) updated, ⚠ ${results.failed} failed.`
        : `✓ ${results.success} anomaly(ies) marked as ${action}.`
    );
    setTimeout(() => setSuccessMsg(null), 5000);
  };

  if (loading) return (
    <ClientLayout client={client}>
      <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        Loading…
      </div>
    </ClientLayout>
  );

  return (
    <ClientLayout client={client}>
      <div className="max-w-full px-4 py-5 flex flex-col h-[calc(100vh-80px)]">

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
  <div>
    <h1 className="text-xl font-semibold text-gray-900">Anomaly Dashboard</h1>
    <p className="text-xs text-gray-400 mt-0.5">
      {anomalies.length} total anomalies ·{" "}
      {anomalies.filter((a) => a.status === "open").length} open
    </p>
  </div>
  <div className="flex gap-2">
    <button onClick={runDetection} disabled={detecting}
      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50">
      {detecting ? "Scanning…" : "🔍 Run Anomaly Detection"}
    </button>
    <button onClick={loadAll}
      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg border border-gray-200">
      ↻ Refresh
    </button>
  </div>
</div>

        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
            ⚠ {error}<button onClick={() => setError(null)} className="ml-auto text-red-400">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex gap-2">
            {successMsg}<button onClick={() => setSuccessMsg(null)} className="ml-auto text-green-400">✕</button>
          </div>
        )}

        <AnomalyDashboard
          anomalies={anomalies}
          getBankTxn={getBankTxn}
          getSourceDoc={getSourceDoc}
          actionLoading={actionLoading}
          onAction={handleAnomalyAction}
          onBulkAction={handleBulkAction}
        />
      </div>
    </ClientLayout>
  );
}