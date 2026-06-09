import { useRef } from "react";
import { useLocation } from "react-router-dom";
import ClientLayout from "../components/ClientLayout";

export default function UploadCenter() {
  const fileInputRef = useRef(null);

  const location = useLocation();
  const client = location.state?.client;

  if (!client) return <div>Client not found</div>;

  const handleBrowse = () => {
    fileInputRef.current?.click();
  };

  return (
    <ClientLayout client={client}>
      <div style={styles.uploadCard}>
        <h2>Upload Financial Documents</h2>

        <p>
          Upload bank statements, invoices,
          payroll reports, sales reports and
          expense reports.
        </p>

        <div style={styles.dropzone}>
          <div style={{ fontSize: 60 }}>📁</div>

          <h3>Drag files here</h3>

          <p>OR</p>

          <button onClick={handleBrowse}>
            Browse Files
          </button>

          <p>CSV • XLSX • PDF</p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls,.pdf"
            style={{ display: "none" }}
          />
        </div>
      </div>
    </ClientLayout>
  );
}

const styles = {
  uploadCard: {
    background: "#fff",
    borderRadius: "16px",
    padding: "32px",
  },

  dropzone: {
    minHeight: "350px",
    border: "2px dashed #CBD5E1",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
};