import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AddClient from "./pages/AddClient";
import ClientDashboard from "./pages/ClientDashboard";
import UploadCenter from "./pages/UploadCenter";
import ReconciliationCenter from "./pages/ReconciliationCenter";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import AuditHistory from "./pages/AuditHistory";
import AnomalyCenter from "./pages/AnomalyCenter";
import TransactionPage from "./pages/TransactionPage";

function PrivateRoute({ children }) {
  return sessionStorage.getItem("cpa_logged_in")
    ? children
    : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />

        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />

        <Route
          path="/add-client"
          element={
            <PrivateRoute>
              <AddClient />
            </PrivateRoute>
          }
        />
        <Route
  path="/client-dashboard/:id/coa"
  element={
    <PrivateRoute>
      <ChartOfAccounts />
    </PrivateRoute>
  }
/>

        <Route
          path="/client-dashboard/:id"
          element={
            <PrivateRoute>
              <ClientDashboard />
            </PrivateRoute>
          }
        />

        <Route
          path="/client-dashboard/:id/upload"
          element={
            <PrivateRoute>
              <UploadCenter />
            </PrivateRoute>
          }
        />
<Route
  path="/client-dashboard/:id/reconciliation"
  element={
    <PrivateRoute>
      <ReconciliationCenter />
    </PrivateRoute>
  }
/>

<Route
  path="/client-dashboard/:id/audit-history"
  element={
    <PrivateRoute>
      <AuditHistory />
    </PrivateRoute>
  }
/>
<Route
  path="/client-dashboard/:id/transactions"
  element={
    <PrivateRoute>
      <TransactionPage />
    </PrivateRoute>
  }
/>
<Route path="/client-dashboard/:id/anomalies" element={<AnomalyCenter />} />
       
      </Routes>
    </BrowserRouter>
  );
}