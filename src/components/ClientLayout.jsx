import { useLocation, useNavigate } from "react-router-dom";

export default function ClientLayout({ client, children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const sidebarItems = [
  {
    name: "Dashboard",
    icon: "🏠",
    path: `/client-dashboard/${client.$id}`,
  },
  {
    name: "Upload Center",
    icon: "📁",
    path: `/client-dashboard/${client.$id}/upload`,
  },
  {
    name: "Transactions",
    icon: "💳",
    path: `/client-dashboard/${client.$id}/transactions`,
  },
  {
    name: "Anomalies",
    icon: "⚠️",
    path: `/client-dashboard/${client.$id}/anomalies`,
  },
  {
    name: "Audit History",
    icon: "📜",
    path: `/client-dashboard/${client.$id}/audit-history`,
  },
  {
    name: "Chart of Accounts",
    icon: "📒",
    path: `/client-dashboard/${client.$id}/coa`,
  },

  // ADD HERE
  {
    name: "Reconciliation",
    icon: "🔄",
    path: `/client-dashboard/${client.$id}/reconciliation`,
  },
  {
  name: "Edit Records",
  icon: "✏️",
  path: `/client-dashboard/${client.$id}/edit-records`,
},
];

  return (
    <div style={styles.page}>
      <header style={styles.navbar}>
        <div style={styles.logo}>📊 FinMatch</div>

        <div style={styles.navRight}>
          <button style={styles.notification}>🔔</button>

          <div style={styles.profile}>
            👤 {client.client_name}
          </div>
        </div>
      </header>

      <div style={styles.mainLayout}>
        <aside style={styles.sidebar}>
          {sidebarItems.map((item) => (
            <div
              key={item.name}
              onClick={() =>
                navigate(item.path, {
                  state: { client },
                })
              }
              style={{
                ...styles.sidebarItem,
                ...(location.pathname === item.path
                  ? styles.activeSidebarItem
                  : {}),
              }}
            >
              <span>{item.icon}</span>
              <span>{item.name}</span>
            </div>
          ))}
        </aside>

        <main style={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#F8FAFC",
  },

  navbar: {
    height: "70px",
    background: "#FFFFFF",
    borderBottom: "1px solid #E2E8F0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 32px",
  },

  logo: {
    fontSize: "22px",
    fontWeight: "700",
    color: "#2563EB",
  },

  navRight: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },

  notification: {
    border: "none",
    background: "#EFF6FF",
    padding: "10px",
    borderRadius: "10px",
    cursor: "pointer",
  },

  profile: {
    fontWeight: "600",
  },

  mainLayout: {
   display: "flex",
  minHeight: "calc(100vh - 70px)",
  },

  sidebar: {
      width: "300px", // was 240px
  minHeight: "calc(100vh - 70px)",
  background: "#FFFFFF",
  borderRight: "1px solid #E2E8F0",
  paddingTop: "24px",
  flexShrink: 0,
  },

  sidebarItem: {
    display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "18px 24px", // bigger
  cursor: "pointer",
  color: "#334155",
  fontWeight: "500",
  fontSize: "15px",
  },

  activeSidebarItem: {
    background: "#EFF6FF",
    color: "#2563EB",
    borderRight: "3px solid #2563EB",
    fontWeight: "700",
  },

  content: {
      flex: 1,
  minWidth: 0, // IMPORTANT
  padding: "32px",
  overflow: "hidden",
  },
};