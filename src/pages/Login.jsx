import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { databases, DB_ID, CPA_COLLECTION_ID, Query } from "../appwrite/config";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!username || !password) {
      setError("Please enter both username and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await databases.listDocuments(DB_ID, CPA_COLLECTION_ID, [
        Query.equal("username", username),
        Query.equal("password", password),
      ]);
      if (res.total > 0) {
        sessionStorage.setItem("cpa_logged_in", "true");
        sessionStorage.setItem("cpa_username", username);
        navigate("/dashboard");
      } else {
        setError("Invalid username or password.");
      }
    } catch (err) {
      console.error(err);
      setError("Connection error. Check your Appwrite config.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>📊</div>
        <h2 style={s.title}>CPA Portal</h2>
        <p style={s.sub}>Sign in to manage your clients</p>
        <form onSubmit={handleLogin}>
          <label style={s.label}>Username</label>
          <input
            style={s.input}
            type="text"
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <label style={s.label}>Password</label>
          <input
            style={s.input}
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div style={s.error}>{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

const s = {
  page:  { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,#1e3a5f 0%,#2d6a9f 100%)" },
  card:  { background:"#fff", padding:"44px 40px", borderRadius:"16px", boxShadow:"0 8px 40px rgba(0,0,0,0.18)", width:"100%", maxWidth:"400px" },
  logo:  { fontSize:"36px", textAlign:"center", marginBottom:"8px" },
  title: { margin:"0 0 4px", fontSize:"26px", fontWeight:"800", color:"#1a202c", textAlign:"center" },
  sub:   { margin:"0 0 28px", color:"#718096", fontSize:"14px", textAlign:"center" },
  label: { display:"block", marginBottom:"6px", marginTop:"16px", fontWeight:"600", color:"#4a5568", fontSize:"13px" },
  input: { width:"100%", padding:"11px 14px", border:"1.5px solid #e2e8f0", borderRadius:"8px", fontSize:"15px", boxSizing:"border-box", outline:"none" },
  error: { marginTop:"14px", padding:"10px 14px", background:"#fff5f5", border:"1px solid #feb2b2", borderRadius:"8px", color:"#c53030", fontSize:"13px" },
  btn:   { marginTop:"24px", width:"100%", padding:"13px", background:"#2b6cb0", color:"#fff", border:"none", borderRadius:"8px", fontSize:"16px", fontWeight:"700", cursor:"pointer" },
};