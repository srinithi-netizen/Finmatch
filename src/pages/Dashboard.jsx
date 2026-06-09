import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { databases, DB_ID, CLIENTS_COLLECTION_ID } from "../appwrite/config";

export default function Dashboard() {
  const [clients, setClients]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const navigate    = useNavigate();
  const username    = sessionStorage.getItem("cpa_username");

  useEffect(() => { fetchClients(); }, []);

  const fetchClients = async () => {
    try {
      const res = await databases.listDocuments(DB_ID, CLIENTS_COLLECTION_ID);
      setClients(res.documents);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => { sessionStorage.clear(); navigate("/"); };

  const statusStyle = (st) => ({
    padding:"3px 10px", borderRadius:"20px", fontSize:"12px", fontWeight:"700",
    background: st === "Completed" ? "#c6f6d5" : st === "In Progress" ? "#fefcbf" : "#e2e8f0",
    color:      st === "Completed" ? "#276749" : st === "In Progress" ? "#744210" : "#4a5568",
  });

  const filtered = clients.filter(c =>
    (c.client_name + c.business_name + c.email).toLowerCase().includes(search.toLowerCase())
  );

  const stats = [
    { label:"Total Clients",   value: clients.length, color:"#2b6cb0" },
    { label:"Completed",       value: clients.filter(c=>c.onboarding_status==="Completed").length,   color:"#276749" },
    { label:"In Progress",     value: clients.filter(c=>c.onboarding_status==="In Progress").length, color:"#744210" },
    { label:"Pending",         value: clients.filter(c=>!c.onboarding_status||c.onboarding_status==="Pending").length, color:"#553c9a" },
  ];

  return (
    <div style={s.page}>
      {/* Navbar */}
      <nav style={s.nav}>
        <span style={s.brand}>📊 CPA Portal</span>
        <div style={s.navRight}>
          <span style={s.welcome}>👤 {username}</span>
          <button style={s.addBtn} onClick={() => navigate("/add-client")}>+ Add Client</button>
          <button style={s.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </nav>

      <div style={s.content}>
        {/* Stat Cards */}
        <div style={s.statRow}>
          {stats.map(st => (
            <div key={st.label} style={{ ...s.statCard, borderTop:`4px solid ${st.color}` }}>
              <div style={{ ...s.statNum, color: st.color }}>{st.value}</div>
              <div style={s.statLabel}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* Search + Table */}
        <div style={s.tableBox}>
          <div style={s.tableTop}>
            <h3 style={s.tableTitle}>All Clients</h3>
            <input
              style={s.search}
              placeholder="🔍 Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <p style={s.msg}>Loading…</p>
          ) : filtered.length === 0 ? (
            <div style={s.empty}>
              {clients.length === 0
                ? <>No clients yet. <b>Click "+ Add Client"</b> to get started.</>
                : "No results match your search."}
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={s.table}>
                <thead>
                  <tr style={s.thead}>
                    <th style={s.th}>#</th>
                    <th style={s.th}>Client Name</th>
                    <th style={s.th}>Business Name</th>
                    <th style={s.th}>Email</th>
                    <th style={s.th}>Phone</th>
                    <th style={s.th}>Industry</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={c.$id} style={i % 2 === 0 ? s.rowEven : s.rowOdd}>
                      <td style={s.td}>{i + 1}</td>
                      <td style={{ ...s.td, fontWeight:"600" }}>{c.client_name}</td>
                      <td style={s.td}>{c.business_name}</td>
                      <td style={s.td}>{c.email}</td>
                      <td style={s.td}>{c.phone_number || "—"}</td>
                      <td style={s.td}>{c.industry || "—"}</td>
                      <td style={s.td}>
                        <span style={statusStyle(c.onboarding_status)}>
                          {c.onboarding_status || "Pending"}
                        </span>
                      </td>
                      <td style={s.td}>
                        <button
                          style={s.viewBtn}
                          onClick={() => navigate(`/client-dashboard/${c.$id}`, { state: { client: c } })}
                          onMouseEnter={e => Object.assign(e.currentTarget.style, s.viewBtnHover)}
                          onMouseLeave={e => Object.assign(e.currentTarget.style, s.viewBtn)}
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  page:        { minHeight:"100vh", background:"#f0f4f8" },
  nav:         { background:"#1e3a5f", padding:"0 32px", height:"60px", display:"flex", alignItems:"center", justifyContent:"space-between" },
  brand:       { color:"#fff", fontWeight:"800", fontSize:"20px" },
  navRight:    { display:"flex", gap:"12px", alignItems:"center" },
  welcome:     { color:"#bee3f8", fontSize:"14px" },
  addBtn:      { padding:"8px 18px", background:"#3182ce", color:"#fff", border:"none", borderRadius:"8px", cursor:"pointer", fontWeight:"700", fontSize:"14px" },
  logoutBtn:   { padding:"8px 18px", background:"transparent", color:"#fed7d7", border:"1px solid #fc8181", borderRadius:"8px", cursor:"pointer", fontWeight:"600", fontSize:"14px" },
  content:     { padding:"32px" },
  statRow:     { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"16px", marginBottom:"28px" },
  statCard:    { background:"#fff", borderRadius:"12px", padding:"20px 24px", boxShadow:"0 1px 6px rgba(0,0,0,0.07)" },
  statNum:     { fontSize:"40px", fontWeight:"800", lineHeight:1.1 },
  statLabel:   { fontSize:"13px", color:"#718096", marginTop:"4px", fontWeight:"600" },
  tableBox:    { background:"#fff", borderRadius:"12px", boxShadow:"0 1px 6px rgba(0,0,0,0.07)", overflow:"hidden" },
  tableTop:    { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"20px 24px", borderBottom:"1px solid #e2e8f0" },
  tableTitle:  { margin:0, color:"#1a202c", fontSize:"17px", fontWeight:"700" },
  search:      { padding:"8px 14px", border:"1.5px solid #e2e8f0", borderRadius:"8px", fontSize:"14px", width:"260px", outline:"none" },
  table:       { width:"100%", borderCollapse:"collapse" },
  thead:       { background:"#f7fafc" },
  th:          { padding:"12px 16px", textAlign:"left", fontSize:"12px", fontWeight:"700", color:"#4a5568", textTransform:"uppercase", letterSpacing:"0.05em" },
  td:          { padding:"13px 16px", fontSize:"14px", color:"#2d3748" },
  rowEven:     { background:"#fff" },
  rowOdd:      { background:"#f7fafc" },
  msg:         { padding:"40px", textAlign:"center", color:"#718096" },
  empty:       { padding:"48px", textAlign:"center", color:"#718096", fontSize:"15px" },
  viewBtn:     { padding:"6px 16px", background:"#ebf8ff", color:"#2b6cb0", border:"1.5px solid #bee3f8", borderRadius:"8px", cursor:"pointer", fontWeight:"700", fontSize:"13px", transition:"all 0.15s" },
  viewBtnHover:{ padding:"6px 16px", background:"#2b6cb0", color:"#fff",   border:"1.5px solid #2b6cb0", borderRadius:"8px", cursor:"pointer", fontWeight:"700", fontSize:"13px", transition:"all 0.15s" },
};