import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { databases, DB_ID, CLIENTS_COLLECTION_ID } from "../appwrite/config";
import { ID } from "appwrite";

const BLANK = {
  client_name:"", business_name:"", business_type:"", industry:"",
  tax_identification_number:"", website:"", email:"", phone_number:"",
  country:"", state:"", city:"", address:"",
  primary_contact_name:"", primary_contact_designation:"",
  primary_contact_email:"", primary_contact_phone:"",
  fiscal_year_start:"", accounting_software:"", notes:"",
  onboarding_status:"Pending",
};

// ✅ Moved OUTSIDE AddClient so React doesn't recreate it on every render
function F({ label, name, type="text", req=false, opts, value, onChange }) {
  return (
    <div style={s.field}>
      <label style={s.label}>
        {label}{req && <span style={{color:"#e53e3e"}}> *</span>}
      </label>
      {opts ? (
        <select name={name} value={value} onChange={onChange} style={s.input}>
          {opts.map(o => <option key={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          style={{...s.input, height:"80px", resize:"vertical"}}
        />
      ) : (
        <input
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          style={s.input}
        />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sec.box}>
      <h4 style={sec.title}>{title}</h4>
      {children}
    </div>
  );
}

export default function AddClient() {
  const [form, setForm]       = useState(BLANK);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.client_name || !form.business_name || !form.email) {
      setError("Client Name, Business Name and Email are required.");
      return;
    }
    setLoading(true);
    try {
      await databases.createDocument(DB_ID, CLIENTS_COLLECTION_ID, ID.unique(), {
        ...form,
        created_by: sessionStorage.getItem("cpa_username"),
      });
      setSuccess("✅ Client added successfully! Redirecting…");
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      console.error(err);
      setError("Failed to save. Check your Appwrite collection permissions.");
    } finally {
      setLoading(false);
    }
  };

  // Shorthand to pass value + onChange to every field
  const fp = (name) => ({ value: form[name], onChange: handleChange });

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <span style={s.brand}>📊 CPA Portal</span>
        <button style={s.back} onClick={() => navigate("/dashboard")}>← Dashboard</button>
      </nav>

      <div style={s.content}>
        <h2 style={s.heading}>Add New Client</h2>
        <p style={s.sub}>Fields marked <span style={{color:"#e53e3e"}}>*</span> are required</p>

        <form onSubmit={handleSubmit}>

          <Section title="Business Information">
            <div style={s.grid2}>
              <F label="Client Name"               name="client_name"              req {...fp("client_name")} />
              <F label="Business Name"              name="business_name"            req {...fp("business_name")} />
              <F label="Business Type"              name="business_type"                {...fp("business_type")} />
              <F label="Industry"                   name="industry"                     {...fp("industry")} />
              <F label="Tax Identification Number"  name="tax_identification_number"    {...fp("tax_identification_number")} />
              <F label="Website"                    name="website"                      {...fp("website")} />
            </div>
          </Section>

          <Section title="Contact Information">
            <div style={s.grid2}>
              <F label="Email"        name="email"        type="email" req {...fp("email")} />
              <F label="Phone Number" name="phone_number"                  {...fp("phone_number")} />
              <F label="Country"      name="country"                       {...fp("country")} />
              <F label="State"        name="state"                         {...fp("state")} />
              <F label="City"         name="city"                          {...fp("city")} />
            </div>
            <F label="Address" name="address" type="textarea" {...fp("address")} />
          </Section>

          <Section title="Primary Contact">
            <div style={s.grid2}>
              <F label="Contact Name"   name="primary_contact_name"        {...fp("primary_contact_name")} />
              <F label="Designation"    name="primary_contact_designation" {...fp("primary_contact_designation")} />
              <F label="Contact Email"  name="primary_contact_email" type="email" {...fp("primary_contact_email")} />
              <F label="Contact Phone"  name="primary_contact_phone"       {...fp("primary_contact_phone")} />
            </div>
          </Section>

          <Section title="Accounting Details">
            <div style={s.grid2}>
              <F label="Fiscal Year Start"   name="fiscal_year_start"   type="date"                              {...fp("fiscal_year_start")} />
              <F label="Accounting Software" name="accounting_software"                                          {...fp("accounting_software")} />
              <F label="Onboarding Status"   name="onboarding_status"   opts={["Pending","In Progress","Completed"]} {...fp("onboarding_status")} />
            </div>
            <F label="Notes" name="notes" type="textarea" {...fp("notes")} />
          </Section>

          {error   && <div style={s.error}>{error}</div>}
          {success && <div style={s.success}>{success}</div>}

          <button type="submit" style={s.submit} disabled={loading}>
            {loading ? "Saving…" : "Add Client"}
          </button>
        </form>
      </div>
    </div>
  );
}

const sec = {
  box:   { background:"#fff", borderRadius:"12px", padding:"24px", marginBottom:"20px", boxShadow:"0 1px 6px rgba(0,0,0,0.07)" },
  title: { margin:"0 0 18px", fontSize:"15px", fontWeight:"700", color:"#1e3a5f", borderBottom:"2px solid #ebf4ff", paddingBottom:"10px" },
};

const s = {
  page:    { minHeight:"100vh", background:"#f0f4f8" },
  nav:     { background:"#1e3a5f", padding:"0 32px", height:"60px", display:"flex", alignItems:"center", justifyContent:"space-between" },
  brand:   { color:"#fff", fontWeight:"800", fontSize:"20px" },
  back:    { padding:"8px 16px", background:"transparent", color:"#bee3f8", border:"1px solid #4a90d9", borderRadius:"8px", cursor:"pointer", fontWeight:"600" },
  content: { padding:"32px", maxWidth:"960px", margin:"0 auto" },
  heading: { margin:"0 0 4px", fontSize:"24px", fontWeight:"800", color:"#1a202c" },
  sub:     { margin:"0 0 24px", color:"#718096", fontSize:"14px" },
  grid2:   { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" },
  field:   { marginBottom:"4px" },
  label:   { display:"block", marginBottom:"6px", fontWeight:"600", color:"#4a5568", fontSize:"13px" },
  input:   { width:"100%", padding:"10px 14px", border:"1.5px solid #e2e8f0", borderRadius:"8px", fontSize:"14px", boxSizing:"border-box", outline:"none" },
  error:   { padding:"12px 16px", background:"#fff5f5", border:"1px solid #feb2b2", borderRadius:"8px", color:"#c53030", fontSize:"14px", marginBottom:"16px" },
  success: { padding:"12px 16px", background:"#f0fff4", border:"1px solid #9ae6b4", borderRadius:"8px", color:"#276749", fontSize:"14px", marginBottom:"16px", fontWeight:"600" },
  submit:  { padding:"13px 40px", background:"#2b6cb0", color:"#fff", border:"none", borderRadius:"8px", fontSize:"16px", fontWeight:"700", cursor:"pointer" },
};